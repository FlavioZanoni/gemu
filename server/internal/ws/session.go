package ws

import (
	"math/rand"
	"sort"
	"sync"
	"time"

	"gemu-server/internal/games"
	"gemu-server/internal/rooms"
)

const (
	voteDuration   = 30 * time.Second
	maxVoteOptions = 5
)

// gameSession is the per-room play-session state: the running game adapter
// (nil between games), the single pending timer, and next-game vote state.
// All adapter calls are serialized under mu.
type gameSession struct {
	mu       sync.Mutex
	adapter  games.Adapter
	timer    *time.Timer
	timerSeq int

	voteOptions  []string
	votes        map[string]string
	voteDeadline time.Time
}

func (h *Hub) session(roomID string) (*gameSession, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	s, ok := h.sessions[roomID]
	return s, ok
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

// placementRows ranks standings (already sorted best-first) into placement
// rows with session points. Equal scores share a place and its points.
func placementRows(room *rooms.Room, standings []games.Standing) []rooms.PlacementRow {
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
			Name:     room.PlayerName(standing.PlayerID),
			Place:    place,
			Score:    standing.Score,
			Points:   placementPoints(place),
		})
	}
	return rows
}

func (h *Hub) broadcastGameState(roomID string, adapter games.Adapter) {
	h.Broadcast(roomID, Envelope{Type: "game.state", RoomID: roomID, Payload: map[string]any{
		"public":    adapter.PublicState(),
		"standings": adapter.Standings(),
	}})
	h.hydratePrivateState(roomID, adapter)
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
	h.broadcastGameState(roomID, adapter)
	h.armGameTimer(roomID, s)
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
	seq := s.timerSeq
	s.timer = time.AfterFunc(time.Until(at), func() {
		h.fireGameTimer(roomID, seq, name)
	})
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
	s.adapter.OnTimer(name)
	h.afterAdapterCall(roomID, s)
}

// finishGame must be called with s.mu held.
func (h *Hub) finishGame(roomID string, s *gameSession) {
	adapter := s.adapter
	if adapter == nil {
		return
	}
	room, ok := h.rooms.Get(roomID)
	if !ok {
		s.adapter = nil
		s.stopTimer()
		return
	}

	// Push the final game state once so clients can render the last phase.
	h.broadcastGameState(roomID, adapter)

	standings := adapter.Standings()
	rows := placementRows(room, standings)
	pg := rooms.PlayedGame{GameType: room.GameType, GameName: room.GameName, Standings: rows}

	s.adapter = nil
	s.stopTimer()
	room.RecordPlayedGame(pg)
	room.SetCurrentGame("", "")
	room.SetStatus(rooms.StatusResults)

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
	roomID := client.RoomID
	room, s, errCode := h.roomAndSession(roomID)
	if errCode != "" {
		h.sendError(client, "session.vote.start.error", env.RequestID, errCode)
		return
	}
	if room.AdminID() != client.Player.ID {
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
	roomID := client.RoomID
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
	s.votes[client.Player.ID] = gameType
	h.Send(client, Envelope{Type: "session.vote.cast.ok", RequestID: env.RequestID})

	if len(s.votes) >= len(room.ConnectedPlayerIDs()) {
		h.resolveVote(roomID, room, s)
		return
	}
	h.Broadcast(roomID, Envelope{Type: "session.vote.update", RoomID: roomID, Payload: map[string]any{"counts": voteCounts(s)}})
}

// handleSessionReplay queues the game that just finished instead of voting
// on the next one — "same again" from the results screen.
func (h *Hub) handleSessionReplay(client *Client, env Envelope) {
	roomID := client.RoomID
	room, s, errCode := h.roomAndSession(roomID)
	if errCode != "" {
		h.sendError(client, "session.replay.error", env.RequestID, errCode)
		return
	}
	if room.AdminID() != client.Player.ID {
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

func (h *Hub) handleSessionPlaylistSet(client *Client, env Envelope) {
	roomID := client.RoomID
	room, _, errCode := h.roomAndSession(roomID)
	if errCode != "" {
		h.sendError(client, "session.playlist.set.error", env.RequestID, errCode)
		return
	}
	if room.AdminID() != client.Player.ID {
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
	for _, gameType := range playlist {
		if _, ok := h.registry.Get(gameType); !ok {
			h.sendError(client, "session.playlist.set.error", env.RequestID, "invalid_game")
			return
		}
	}
	room.SetPlaylist(playlist)
	h.Send(client, Envelope{Type: "session.playlist.set.ok", RequestID: env.RequestID})
	h.broadcastRoom(roomID)
}

func (h *Hub) handleSessionEnd(client *Client, env Envelope) {
	roomID := client.RoomID
	room, s, errCode := h.roomAndSession(roomID)
	if errCode != "" {
		h.sendError(client, "session.end.error", env.RequestID, errCode)
		return
	}
	if room.AdminID() != client.Player.ID {
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
