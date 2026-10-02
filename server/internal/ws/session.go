package ws

import (
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"sort"
	"strings"
	"sync"
	"time"

	"gemu-server/internal/games"
	"gemu-server/internal/rooms"
)

const (
	voteDuration   = 30 * time.Second
	maxVoteOptions = 5
	// stateCoalesceWindow is the minimum gap between two game.state
	// broadcasts to a room. Bursts of actions (reactions, guesses) inside it
	// collapse into one trailing broadcast carrying the latest state: with
	// drawings in public state each broadcast can be large, and a broadcast per
	// action would swamp slow phones' send queues.
	stateCoalesceWindow = 120 * time.Millisecond
	// timerBackoff is how long the hub waits before re-firing a timer whose
	// deadline is still in the past right after OnTimer handled it (an adapter
	// bug that would otherwise spin OnTimer as fast as the CPU allows).
	timerBackoff = time.Second
)

// gameSession is the per-room play-session state: the running game adapter
// (nil between games), the single pending timer, and next-game vote state.
// All adapter calls are serialized under mu.
type gameSession struct {
	mu       sync.Mutex
	adapter  games.Adapter
	timer    *time.Timer
	timerSeq int
	pausedAt time.Time // zero when not paused
	// While paused, leaves and connectivity changes are queued instead of
	// reaching the adapter (they could advance a phase whose deadline resume
	// would then push out by the whole pause). Replayed on resume, after Shift.
	pendingLeaves     []string
	pendingJoins      []string
	pendingRoomChange bool

	// game.state broadcast coalescing (see stateCoalesceWindow). lastState is
	// when the last broadcast went out; statePending marks a scheduled
	// trailing broadcast (stateTimer), which reads the adapter at send time.
	lastState    time.Time
	statePending bool
	stateTimer   *time.Timer
	stateSeq     int
	lastPhase    string // phaseKey of the last broadcast; a change skips the window

	// firing names the timer whose OnTimer is being handled right now, so
	// armGameTimer can spot an adapter re-reporting the same past deadline.
	firing        string
	timerLoopWarn bool // hot-loop backoff already logged for this game

	voteOptions  []string
	votes        map[string]string
	voteDeadline time.Time

	// customDecks are host-uploaded CAH decks for this room, selectable
	// alongside the built-ins.
	customDecks []games.Deck
}

// resolveCahDecks turns selected deck ids into decks (built-in ∪ custom),
// defaulting to the locale's base deck when nothing valid is selected.
func (s *gameSession) resolveCahDecks(ids []string, locale string) []games.Deck {
	var decks []games.Deck
	for _, id := range ids {
		if d, ok := games.BuiltinDeck(id); ok {
			decks = append(decks, d)
			continue
		}
		for _, c := range s.customDecks {
			if c.ID == id {
				decks = append(decks, c)
				break
			}
		}
	}
	if len(decks) == 0 {
		if base, ok := games.BuiltinDeck(games.DefaultDeckID(locale)); ok {
			decks = []games.Deck{base}
		}
	}
	return decks
}

// deckMetas lists every deck the room can pick (built-in + custom).
func (s *gameSession) deckMetas() []games.DeckMeta {
	metas := games.BuiltinDeckMetas()
	for _, c := range s.customDecks {
		metas = append(metas, c.Meta())
	}
	return metas
}

func (h *Hub) session(roomID string) (*gameSession, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	s, ok := h.sessions[roomID]
	return s, ok
}

// clearPause drops pause state and anything queued during it. s.mu held.
func (s *gameSession) clearPause() {
	s.pausedAt = time.Time{}
	s.pendingLeaves = nil
	s.pendingJoins = nil
	s.pendingRoomChange = false
}

// cancelPendingState drops a scheduled trailing game.state broadcast. s.mu held.
func (s *gameSession) cancelPendingState() {
	if s.stateTimer != nil {
		s.stateTimer.Stop()
		s.stateTimer = nil
	}
	s.statePending = false
	s.stateSeq++
}

// stopSessionTimer must be called with s.mu held.
func (s *gameSession) stopTimer() {
	if s.timer != nil {
		s.timer.Stop()
		s.timer = nil
	}
	s.timerSeq++
}

// placementPoints converts a placement (1-indexed) into session points:
// 100/75/60/50, then -5 per place, floor 10.
func placementPoints(place int) int {
	switch place {
	case 1:
		return 100
	case 2:
		return 75
	case 3:
		return 60
	case 4:
		return 50
	}
	points := 50 - 5*(place-4)
	if points < 10 {
		return 10
	}
	return points
}

// memberStandings keeps only current room members (connected or not):
// adapters may still score players who left mid-game, who'd otherwise show
// up as nameless ghost rows on the scoreboard.
func memberStandings(room *rooms.Room, standings []games.Standing) []games.Standing {
	out := make([]games.Standing, 0, len(standings))
	for _, st := range standings {
		if room.HasPlayer(st.PlayerID) {
			out = append(out, st)
		}
	}
	return out
}

// placementRows ranks standings (already sorted best-first) into placement
// rows with session points, keeping only current room members. Equal scores
// share a place and its points. Names are captured now, so the rows (kept in
// playedGames) still read right after a player leaves.
func placementRows(room *rooms.Room, standings []games.Standing) []rooms.PlacementRow {
	standings = memberStandings(room, standings)
	rows := make([]rooms.PlacementRow, 0, len(standings))
	place := 0
	prevScore := 0
	for i, standing := range standings {
		if i == 0 || standing.Score != prevScore {
			place = i + 1
			prevScore = standing.Score
		}
		rows = append(rows, rooms.PlacementRow{
			PlayerID: standing.PlayerID,
			Name:     room.KnownName(standing.PlayerID),
			Place:    place,
			Score:    standing.Score,
			Points:   placementPoints(place),
		})
	}
	return rows
}

// broadcastGameState pushes public state + standings to the room and each
// seat's private view, right now. public may be nil (computed here). s.mu held.
func (h *Hub) broadcastGameState(roomID string, s *gameSession, public map[string]any) {
	adapter := s.adapter
	if adapter == nil {
		return
	}
	s.cancelPendingState()
	if public == nil {
		public = adapter.PublicState()
	}
	s.lastState = time.Now()
	s.lastPhase = phaseKey(public)
	standings := adapter.Standings()
	if room, ok := h.rooms.Get(roomID); ok {
		standings = memberStandings(room, standings)
	}
	h.Broadcast(roomID, Envelope{Type: "game.state", RoomID: roomID, Payload: map[string]any{
		"public":    public,
		"standings": standings,
	}})
	h.hydratePrivateState(roomID, adapter)
}

// requestGameState broadcasts game state with trailing coalescing: the first
// request after a quiet period (or one that changes the public phase) goes
// out at once; further requests inside stateCoalesceWindow schedule a single
// trailing broadcast that reads the adapter's state when it fires. Only the
// broadcast is deferred — adapter calls and timer arming stay synchronous.
// s.mu held.
func (h *Hub) requestGameState(roomID string, s *gameSession) {
	if s.adapter == nil {
		return
	}
	since := time.Since(s.lastState)
	if since >= stateCoalesceWindow {
		h.broadcastGameState(roomID, s, nil)
		return
	}
	public := s.adapter.PublicState()
	if phaseKey(public) != s.lastPhase {
		h.broadcastGameState(roomID, s, public)
		return
	}
	if s.statePending {
		return
	}
	s.statePending = true
	seq := s.stateSeq
	s.stateTimer = time.AfterFunc(stateCoalesceWindow-since, func() {
		defer recoverTimer("stateBroadcast", roomID)
		h.fireStateBroadcast(roomID, s, seq)
	})
}

func (h *Hub) fireStateBroadcast(roomID string, s *gameSession, seq int) {
	if cur, ok := h.session(roomID); !ok || cur != s {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stateSeq != seq || !s.statePending {
		return
	}
	s.statePending = false
	s.stateTimer = nil
	h.broadcastGameState(roomID, s, nil)
}

// phaseKey identifies the game's step for coalescing: a new phase, round,
// turn or deadline is broadcast at once rather than trailing behind a burst
// of actions. Only scalar keys, so formatting stays cheap.
func phaseKey(public map[string]any) string {
	return fmt.Sprint(public["phase"], "|", public["round"], "|", public["turnIndex"], "|", public["deadline"])
}

func (h *Hub) broadcastRoom(roomID string) {
	if room, ok := h.rooms.Get(roomID); ok {
		h.Broadcast(roomID, Envelope{Type: "room.updated", RoomID: roomID, Payload: room.Snapshot()})
	}
}

// afterAdapterCall runs with s.mu held after any mutating adapter call:
// finishes the game if it is over, otherwise pushes state and re-arms the
// adapter's pending timer.
func (h *Hub) afterAdapterCall(roomID string, s *gameSession) {
	adapter := s.adapter
	if adapter == nil {
		return
	}
	if adapter.Status() == games.StatusFinished {
		h.finishGame(roomID, s)
		return
	}
	h.requestGameState(roomID, s)
	// While paused (e.g. a player left mid-pause) the timer stays frozen;
	// resume re-arms it after shifting the deadline.
	if s.pausedAt.IsZero() {
		h.armGameTimer(roomID, s)
	}
}

// armGameTimer must be called with s.mu held.
func (h *Hub) armGameTimer(roomID string, s *gameSession) {
	s.stopTimer()
	adapter := s.adapter
	if adapter == nil {
		return
	}
	name, at, ok := adapter.NextDeadline()
	if !ok {
		return
	}
	delay := time.Until(at)
	// Safety net: an adapter whose OnTimer leaves the same deadline in the
	// past would be re-fired immediately, forever (~100k OnTimer/s). Back off
	// instead and say so once per game.
	if delay <= 0 && s.firing != "" && name == s.firing {
		if !s.timerLoopWarn {
			s.timerLoopWarn = true
			log.Printf("room %s: game timer %q still overdue after OnTimer; backing off %s (adapter bug)", roomID, name, timerBackoff)
		}
		delay = timerBackoff
	}
	seq := s.timerSeq
	s.timer = time.AfterFunc(delay, func() {
		defer recoverTimer("gameTimer", roomID)
		h.fireGameTimer(roomID, seq, name)
	})
}

// recoverTimer keeps a panic inside a timer goroutine from crashing the
// process (timer callbacks run detached, unguarded by the read loop's recover).
func recoverTimer(name, roomID string) {
	if rec := recover(); rec != nil {
		log.Printf("recovered panic in %s timer for room %s: %v", name, roomID, rec)
	}
}

func (h *Hub) fireGameTimer(roomID string, seq int, name string) {
	s, ok := h.session(roomID)
	if !ok {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.timerSeq != seq || s.adapter == nil {
		return
	}
	s.firing = name
	defer func() { s.firing = "" }()
	s.adapter.OnTimer(name)
	h.afterAdapterCall(roomID, s)
}

// finishGame must be called with s.mu held.
func (h *Hub) finishGame(roomID string, s *gameSession) {
	adapter := s.adapter
	if adapter == nil {
		return
	}
	// A game can finish while paused (e.g. the last opponent left): the
	// pause must not leak into every later game.
	s.clearPause()
	room, ok := h.rooms.Get(roomID)
	if !ok {
		s.adapter = nil
		s.stopTimer()
		s.cancelPendingState()
		return
	}

	// Push the final game state once — immediately, superseding any pending
	// coalesced broadcast — so clients render the last phase before the
	// session.gameResult below.
	h.broadcastGameState(roomID, s, nil)

	standings := adapter.Standings()
	rows := placementRows(room, standings)
	pg := rooms.PlayedGame{GameType: room.GameType, GameName: room.GameName, Standings: rows}

	s.adapter = nil
	s.stopTimer()
	s.cancelPendingState()
	room.RecordPlayedGame(pg)
	room.SetCurrentGame("", "")
	room.SetStatus(rooms.StatusResults) // also clears room.Paused

	h.Broadcast(roomID, Envelope{Type: "session.gameResult", RoomID: roomID, Payload: map[string]any{
		"gameType":  pg.GameType,
		"gameName":  pg.GameName,
		"standings": rows,
	}})
	h.broadcastRoom(roomID)
}

func (h *Hub) gameOption(gameType string) map[string]string {
	name := gameType
	if factory, ok := h.registry.Get(gameType); ok {
		name = factory.Name
	}
	return map[string]string{"type": gameType, "name": name}
}

// startVote must be called with s.mu held; room status must be results.
// With a single-game playlist there is nothing to vote on: that game is
// queued and the room returns to the lobby.
func (h *Hub) startVote(roomID string, room *rooms.Room, s *gameSession) {
	playlist := room.GetPlaylist()
	if len(playlist) <= 1 {
		next := ""
		if len(playlist) == 1 {
			next = playlist[0]
		}
		room.SetNextGame(next, h.gameOption(next)["name"])
		room.SetStatus(rooms.StatusLobby)
		room.ResetReady()
		h.broadcastRoom(roomID)
		return
	}

	// Offer only games the current group is big enough for; if that filters
	// everything out, fall back to the full playlist so the flow never stalls.
	options := h.eligibleGames(room)
	rand.Shuffle(len(options), func(i, j int) { options[i], options[j] = options[j], options[i] })
	if len(options) > maxVoteOptions {
		options = options[:maxVoteOptions]
	}

	s.voteOptions = options
	s.votes = make(map[string]string)
	s.voteDeadline = time.Now().Add(voteDuration)
	room.SetStatus(rooms.StatusVoting)

	s.stopTimer()
	seq := s.timerSeq
	s.timer = time.AfterFunc(voteDuration, func() {
		defer recoverTimer("voteTimer", roomID)
		h.fireVoteTimer(roomID, seq)
	})

	optionPayload := make([]map[string]string, 0, len(options))
	for _, gameType := range options {
		optionPayload = append(optionPayload, h.gameOption(gameType))
	}
	h.Broadcast(roomID, Envelope{Type: "session.vote", RoomID: roomID, Payload: map[string]any{
		"options":  optionPayload,
		"deadline": s.voteDeadline.UnixMilli(),
	}})
	h.broadcastRoom(roomID)
}

func (h *Hub) fireVoteTimer(roomID string, seq int) {
	s, ok := h.session(roomID)
	if !ok {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.timerSeq != seq || s.votes == nil {
		return
	}
	room, ok := h.rooms.Get(roomID)
	if !ok {
		return
	}
	h.resolveVote(roomID, room, s)
}

func voteCounts(s *gameSession) map[string]int {
	counts := make(map[string]int)
	for _, gameType := range s.voteOptions {
		counts[gameType] = 0
	}
	for _, gameType := range s.votes {
		counts[gameType]++
	}
	return counts
}

// maybeResolveVote closes the vote once every CONNECTED member has a ballot
// (ballots of disconnected players still count toward the tally but not
// toward "everyone voted"). Returns true if it resolved. s.mu held.
func (h *Hub) maybeResolveVote(roomID string, room *rooms.Room, s *gameSession) bool {
	if s.votes == nil || len(s.voteOptions) == 0 || room.GetStatus() != rooms.StatusVoting {
		return false
	}
	connected := room.ConnectedPlayerIDs()
	if len(connected) == 0 {
		return false // nobody here; the vote timer resolves it
	}
	for _, id := range connected {
		if _, ok := s.votes[id]; !ok {
			return false
		}
	}
	h.resolveVote(roomID, room, s)
	return true
}

// resolveVote must be called with s.mu held.
func (h *Hub) resolveVote(roomID string, room *rooms.Room, s *gameSession) {
	counts := voteCounts(s)
	best := -1
	winners := []string{}
	for _, gameType := range s.voteOptions {
		if counts[gameType] > best {
			best = counts[gameType]
			winners = []string{gameType}
		} else if counts[gameType] == best {
			winners = append(winners, gameType)
		}
	}
	winner := winners[rand.Intn(len(winners))]

	s.voteOptions = nil
	s.votes = nil
	s.stopTimer()

	room.SetNextGame(winner, h.gameOption(winner)["name"])
	room.SetStatus(rooms.StatusLobby)
	room.ResetReady()

	h.Broadcast(roomID, Envelope{Type: "session.vote.result", RoomID: roomID, Payload: map[string]any{
		"gameType": winner,
		"gameName": h.gameOption(winner)["name"],
		"counts":   counts,
	}})
	h.broadcastRoom(roomID)
}

func (h *Hub) handleSessionVoteStart(client *Client, env Envelope) {
	roomID, playerID := h.ident(client)
	room, s, errCode := h.roomAndSession(roomID)
	if errCode != "" {
		h.sendError(client, "session.vote.start.error", env.RequestID, errCode)
		return
	}
	if room.AdminID() != playerID {
		h.sendError(client, "session.vote.start.error", env.RequestID, "not_admin")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if room.GetStatus() != rooms.StatusResults {
		h.sendError(client, "session.vote.start.error", env.RequestID, "wrong_status")
		return
	}
	h.startVote(roomID, room, s)
	h.Send(client, Envelope{Type: "session.vote.start.ok", RequestID: env.RequestID})
}

func (h *Hub) handleSessionVoteCast(client *Client, env Envelope) {
	roomID, playerID := h.ident(client)
	room, s, errCode := h.roomAndSession(roomID)
	if errCode != "" {
		h.sendError(client, "session.vote.cast.error", env.RequestID, errCode)
		return
	}
	gameType := decodeString(env.Payload, "gameType")

	s.mu.Lock()
	defer s.mu.Unlock()
	if room.GetStatus() != rooms.StatusVoting || s.votes == nil {
		h.sendError(client, "session.vote.cast.error", env.RequestID, "no_vote_active")
		return
	}
	valid := false
	for _, option := range s.voteOptions {
		if option == gameType {
			valid = true
			break
		}
	}
	if !valid {
		h.sendError(client, "session.vote.cast.error", env.RequestID, "invalid_option")
		return
	}
	s.votes[playerID] = gameType
	h.Send(client, Envelope{Type: "session.vote.cast.ok", RequestID: env.RequestID})

	if h.maybeResolveVote(roomID, room, s) {
		return
	}
	h.Broadcast(roomID, Envelope{Type: "session.vote.update", RoomID: roomID, Payload: map[string]any{"counts": voteCounts(s)}})
}

// handleSessionReplay queues the game that just finished instead of voting
// on the next one — "same again" from the results screen.
func (h *Hub) handleSessionReplay(client *Client, env Envelope) {
	roomID, playerID := h.ident(client)
	room, s, errCode := h.roomAndSession(roomID)
	if errCode != "" {
		h.sendError(client, "session.replay.error", env.RequestID, errCode)
		return
	}
	if room.AdminID() != playerID {
		h.sendError(client, "session.replay.error", env.RequestID, "not_admin")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if room.GetStatus() != rooms.StatusResults {
		h.sendError(client, "session.replay.error", env.RequestID, "wrong_status")
		return
	}
	gameType, gameName := room.LastPlayedGame()
	if gameType == "" {
		h.sendError(client, "session.replay.error", env.RequestID, "nothing_played")
		return
	}
	room.SetNextGame(gameType, gameName)
	room.SetStatus(rooms.StatusLobby)
	room.ResetReady()
	h.Send(client, Envelope{Type: "session.replay.ok", RequestID: env.RequestID, Payload: map[string]any{"gameType": gameType, "gameName": gameName}})
	h.broadcastRoom(roomID)
}

// handleSessionPause freezes the show: the pending game timer stops and all
// game actions/streams are rejected until resume. Host only, mid-game only.
func (h *Hub) handleSessionPause(client *Client, env Envelope) {
	roomID, playerID := h.ident(client)
	room, s, errCode := h.roomAndSession(roomID)
	if errCode != "" {
		h.sendError(client, "session.pause.error", env.RequestID, errCode)
		return
	}
	if room.AdminID() != playerID {
		h.sendError(client, "session.pause.error", env.RequestID, "not_admin")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if room.GetStatus() != rooms.StatusPlaying || s.adapter == nil || !s.pausedAt.IsZero() {
		h.sendError(client, "session.pause.error", env.RequestID, "wrong_status")
		return
	}
	s.pausedAt = time.Now()
	s.stopTimer()
	room.SetPaused(true)
	h.Send(client, Envelope{Type: "session.pause.ok", RequestID: env.RequestID})
	h.broadcastRoom(roomID)
}

func (h *Hub) handleSessionResume(client *Client, env Envelope) {
	roomID, playerID := h.ident(client)
	room, s, errCode := h.roomAndSession(roomID)
	if errCode != "" {
		h.sendError(client, "session.resume.error", env.RequestID, errCode)
		return
	}
	if room.AdminID() != playerID {
		h.sendError(client, "session.resume.error", env.RequestID, "not_admin")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pausedAt.IsZero() || s.adapter == nil {
		h.sendError(client, "session.resume.error", env.RequestID, "not_paused")
		return
	}
	frozen := time.Since(s.pausedAt)
	joins, leaves, roomChanged := s.pendingJoins, s.pendingLeaves, s.pendingRoomChange
	s.clearPause()
	s.adapter.Shift(frozen)
	room.SetPaused(false)
	// Replay what happened during the pause against the shifted deadlines,
	// so a phase it completes starts with its full time. Joins first: a
	// player who joined and left mid-pause was already dropped from both
	// queues (see notifyPlayerLeft), and a leaver can't rejoin under the
	// same id, so joins-then-leaves preserves every real ordering.
	for _, id := range joins {
		if s.adapter == nil {
			break
		}
		s.adapter.OnPlayerJoin(id)
	}
	for _, id := range leaves {
		if s.adapter == nil {
			break
		}
		s.adapter.OnPlayerLeave(id)
	}
	if roomChanged && s.adapter != nil {
		s.adapter.OnRoomChange()
	}
	h.Send(client, Envelope{Type: "session.resume.ok", RequestID: env.RequestID})
	h.broadcastRoom(roomID)
	// Re-broadcast state (shifted deadlines) and re-arm the timer — or finish
	// the game if a replayed leave ended it.
	h.afterAdapterCall(roomID, s)
}

// handleDecksList returns the decks this room can pick from (built-in +
// this room's custom uploads). Works with or without a running game.
func (h *Hub) handleDecksList(client *Client, env Envelope) {
	roomID, _ := h.ident(client)
	metas := games.BuiltinDeckMetas()
	if s, ok := h.session(roomID); ok {
		func() {
			s.mu.Lock()
			defer s.mu.Unlock()
			metas = s.deckMetas()
		}()
	}
	h.Send(client, Envelope{Type: "lobby.decks.list.ok", RequestID: env.RequestID, Payload: map[string]any{"decks": metas}})
}

const (
	maxCustomDecks   = 20
	maxSelectedDecks = 40 // built-ins + every custom deck, with room to spare
	maxDeckNameLen   = 60
	maxCardTextLen   = 200
	maxDeckCards     = 1000 // black + white
)

// handleCahDecksSet records which decks CAH will use. Admin, lobby/results.
func (h *Hub) handleCahDecksSet(client *Client, env Envelope) {
	roomID, playerID := h.ident(client)
	room, s, errCode := h.roomAndSession(roomID)
	if errCode != "" {
		h.sendError(client, "session.cahdecks.set.error", env.RequestID, errCode)
		return
	}
	if room.AdminID() != playerID {
		h.sendError(client, "session.cahdecks.set.error", env.RequestID, "not_admin")
		return
	}
	ids := decodeStringSlice(env.Payload, "decks")
	// Keep only distinct ids that resolve to a real deck (built-in or custom).
	valid := func() []string {
		s.mu.Lock()
		defer s.mu.Unlock()
		valid := make([]string, 0, len(ids))
		for _, id := range ids {
			if len(valid) >= maxSelectedDecks {
				break
			}
			if containsString(valid, id) {
				continue
			}
			if _, ok := games.BuiltinDeck(id); ok {
				valid = append(valid, id)
				continue
			}
			for _, c := range s.customDecks {
				if c.ID == id {
					valid = append(valid, id)
					break
				}
			}
		}
		return valid
	}()
	room.SetCahDeckIDs(valid)
	h.Send(client, Envelope{Type: "session.cahdecks.set.ok", RequestID: env.RequestID})
	h.broadcastRoom(roomID)
}

// checkDeckSize enforces the hub's custom-deck caps before the deck reaches
// games.ParseDeck: the name is truncated, oversized cards/decks are refused.
// Returns the (possibly adjusted) deck object or an error message.
func checkDeckSize(raw any) (map[string]any, string) {
	deck, ok := raw.(map[string]any)
	if !ok {
		return nil, "deck must be an object"
	}
	out := make(map[string]any, len(deck))
	for k, v := range deck {
		out[k] = v
	}
	if name, ok := deck["name"].(string); ok {
		out["name"] = games.TruncateText(strings.TrimSpace(name), maxDeckNameLen)
	}
	black, _ := deck["black"].([]any)
	white, _ := deck["white"].([]any)
	if len(black)+len(white) > maxDeckCards {
		return nil, "deck has too many cards (max 1000)"
	}
	tooLong := func(text string) bool { return len([]rune(text)) > maxCardTextLen }
	for _, b := range black {
		card, _ := b.(map[string]any)
		if text, _ := card["text"].(string); tooLong(text) {
			return nil, "card text too long (max 200 characters)"
		}
	}
	for _, w := range white {
		if text, _ := w.(string); tooLong(text) {
			return nil, "card text too long (max 200 characters)"
		}
	}
	return out, ""
}

// handleDeckAdd validates and stores a host-uploaded custom CAH deck for the
// room, then selects it. Admin only. Re-uploading a deck with the same name
// replaces it.
func (h *Hub) handleDeckAdd(client *Client, env Envelope) {
	roomID, playerID := h.ident(client)
	room, s, errCode := h.roomAndSession(roomID)
	if errCode != "" {
		h.sendError(client, "session.deck.add.error", env.RequestID, errCode)
		return
	}
	if room.AdminID() != playerID {
		h.sendError(client, "session.deck.add.error", env.RequestID, "not_admin")
		return
	}
	sized, reason := checkDeckSize(env.Payload["deck"])
	if reason != "" {
		h.Send(client, Envelope{Type: "session.deck.add.error", RequestID: env.RequestID, Payload: map[string]any{"code": "invalid_deck", "message": reason}})
		return
	}
	raw, err := json.Marshal(sized)
	if err != nil {
		h.sendError(client, "session.deck.add.error", env.RequestID, "invalid_deck")
		return
	}
	deck, err := games.ParseDeck(raw)
	if err != nil {
		h.Send(client, Envelope{Type: "session.deck.add.error", RequestID: env.RequestID, Payload: map[string]any{"code": "invalid_deck", "message": err.Error()}})
		return
	}
	// Custom deck ids are namespaced so they can't shadow a built-in.
	deck.ID = games.CustomDeckID(deck.Name)

	errCode = func() string {
		s.mu.Lock()
		defer s.mu.Unlock()
		for i, c := range s.customDecks {
			if c.ID == deck.ID {
				s.customDecks[i] = deck
				h.persistDecks(room, s)
				return ""
			}
		}
		if len(s.customDecks) >= maxCustomDecks {
			return "too_many_decks"
		}
		s.customDecks = append(s.customDecks, deck)
		h.persistDecks(room, s)
		return ""
	}()
	if errCode != "" {
		h.sendError(client, "session.deck.add.error", env.RequestID, errCode)
		return
	}

	// Auto-select the freshly added deck.
	selected := room.GetCahDeckIDs()
	if !containsString(selected, deck.ID) {
		room.SetCahDeckIDs(append(selected, deck.ID))
	}

	h.Send(client, Envelope{Type: "session.deck.add.ok", RequestID: env.RequestID, Payload: map[string]any{"deck": deck.Meta()}})
	h.broadcastRoom(roomID)
}

// persistDecks mirrors the session's custom decks onto the room so they are
// saved with it. s.mu held.
func (h *Hub) persistDecks(room *rooms.Room, s *gameSession) {
	blob, err := json.Marshal(s.customDecks)
	if err != nil {
		log.Printf("marshal custom decks for %s: %v", room.ID, err)
		return
	}
	room.SetCustomDecks(blob)
}

func (h *Hub) handleSessionPlaylistSet(client *Client, env Envelope) {
	roomID, playerID := h.ident(client)
	room, _, errCode := h.roomAndSession(roomID)
	if errCode != "" {
		h.sendError(client, "session.playlist.set.error", env.RequestID, errCode)
		return
	}
	if room.AdminID() != playerID {
		h.sendError(client, "session.playlist.set.error", env.RequestID, "not_admin")
		return
	}
	status := room.GetStatus()
	if status != rooms.StatusLobby && status != rooms.StatusResults {
		h.sendError(client, "session.playlist.set.error", env.RequestID, "wrong_status")
		return
	}
	playlist := decodeStringSlice(env.Payload, "playlist")
	if len(playlist) == 0 {
		h.sendError(client, "session.playlist.set.error", env.RequestID, "empty_playlist")
		return
	}
	playlist, ok := h.cleanPlaylist(playlist)
	if !ok {
		h.sendError(client, "session.playlist.set.error", env.RequestID, "invalid_game")
		return
	}
	room.SetPlaylist(playlist)
	h.Send(client, Envelope{Type: "session.playlist.set.ok", RequestID: env.RequestID})
	h.broadcastRoom(roomID)
}

// eligibleGames returns the playlist games the current connected group is big
// enough for, falling back to the whole playlist if none qualify (so the flow
// never stalls).
func (h *Hub) eligibleGames(room *rooms.Room) []string {
	playlist := room.GetPlaylist()
	connectedCount := len(room.ConnectedPlayerIDs())
	options := make([]string, 0, len(playlist))
	for _, gameType := range playlist {
		if factory, ok := h.registry.Get(gameType); ok && connectedCount >= factory.MinConnected() {
			options = append(options, gameType)
		}
	}
	if len(options) == 0 {
		options = append(options, playlist...)
	}
	return options
}

// handleSessionNextRandom picks the first (or any un-voted) game at random
// and announces it exactly like a vote result, so every client plays the same
// drumroll → intro flow. Admin, lobby, only while no next game is queued.
func (h *Hub) handleSessionNextRandom(client *Client, env Envelope) {
	roomID, playerID := h.ident(client)
	room, s, errCode := h.roomAndSession(roomID)
	if errCode != "" {
		h.sendError(client, "session.next.random.error", env.RequestID, errCode)
		return
	}
	if room.AdminID() != playerID {
		h.sendError(client, "session.next.random.error", env.RequestID, "not_admin")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if room.GetStatus() != rooms.StatusLobby || s.adapter != nil || room.GetNextGameType() != "" {
		h.sendError(client, "session.next.random.error", env.RequestID, "wrong_status")
		return
	}
	options := h.eligibleGames(room)
	if len(options) == 0 {
		h.sendError(client, "session.next.random.error", env.RequestID, "empty_playlist")
		return
	}
	gameType := options[rand.Intn(len(options))]
	gameName := h.gameOption(gameType)["name"]
	room.SetNextGame(gameType, gameName)
	room.ResetReady()

	h.Send(client, Envelope{Type: "session.next.random.ok", RequestID: env.RequestID, Payload: map[string]any{"gameType": gameType, "gameName": gameName}})
	h.Broadcast(roomID, Envelope{Type: "session.vote.result", RoomID: roomID, Payload: map[string]any{
		"gameType": gameType,
		"gameName": gameName,
		"counts":   map[string]int{},
	}})
	h.broadcastRoom(roomID)
}

func (h *Hub) handleSessionEnd(client *Client, env Envelope) {
	roomID, playerID := h.ident(client)
	room, s, errCode := h.roomAndSession(roomID)
	if errCode != "" {
		h.sendError(client, "session.end.error", env.RequestID, errCode)
		return
	}
	if room.AdminID() != playerID {
		h.sendError(client, "session.end.error", env.RequestID, "not_admin")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	status := room.GetStatus()
	if status == rooms.StatusPlaying {
		h.sendError(client, "session.end.error", env.RequestID, "game_in_progress")
		return
	}

	snapshot := room.Snapshot()
	scores, _ := snapshot["sessionScores"].(map[string]int)
	standings := make([]games.Standing, 0, len(scores))
	for playerID, points := range scores {
		standings = append(standings, games.Standing{PlayerID: playerID, Score: points})
	}
	sort.SliceStable(standings, func(i, j int) bool { return standings[i].Score > standings[j].Score })
	rows := placementRows(room, standings)

	s.voteOptions = nil
	s.votes = nil
	s.stopTimer()

	h.Broadcast(roomID, Envelope{Type: "session.final", RoomID: roomID, Payload: map[string]any{
		"standings":   rows,
		"playedGames": snapshot["playedGames"],
	}})
	room.ResetSession()
	h.Send(client, Envelope{Type: "session.end.ok", RequestID: env.RequestID})
	h.broadcastRoom(roomID)
}

func (h *Hub) roomAndSession(roomID string) (*rooms.Room, *gameSession, string) {
	if roomID == "" {
		return nil, nil, "not_in_room"
	}
	room, ok := h.rooms.Get(roomID)
	if !ok {
		return nil, nil, "not_found"
	}
	s, ok := h.session(roomID)
	if !ok {
		return nil, nil, "not_found"
	}
	return room, s, ""
}

func (h *Hub) sendError(client *Client, msgType, requestID, code string) {
	h.Send(client, Envelope{Type: msgType, RequestID: requestID, Payload: map[string]any{"code": code, "message": code}})
}

func decodeStringSlice(payload map[string]any, key string) []string {
	if payload == nil {
		return nil
	}
	raw, ok := payload[key].([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(raw))
	for _, item := range raw {
		if s, ok := item.(string); ok && s != "" {
			out = append(out, s)
		}
	}
	return out
}
