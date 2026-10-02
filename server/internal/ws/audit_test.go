package ws

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"regexp"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"gemu-server/internal/games"
	"gemu-server/internal/rooms"
)

// ---- helpers ---------------------------------------------------------------

// newTestClient builds an in-process client whose outbound messages are
// captured on its send queue (no socket, no writer goroutine).
func newTestClient(hub *Hub, id string) *Client {
	c := &Client{ID: id, send: make(chan []byte, 4096), done: make(chan struct{})}
	hub.mu.Lock()
	hub.clients[id] = c
	hub.mu.Unlock()
	return c
}

// drain returns every message queued for c so far.
func drain(c *Client) []Envelope {
	var out []Envelope
	for {
		select {
		case b := <-c.send:
			c.queued.Add(-int64(len(b)))
			var env Envelope
			_ = json.Unmarshal(b, &env)
			out = append(out, env)
		default:
			return out
		}
	}
}

// awaitMsg drains c until a message of type typ shows up or timeout passes
// (for broadcasts that may trail, like coalesced game.state).
func awaitMsg(c *Client, typ string, timeout time.Duration) (Envelope, bool) {
	deadline := time.Now().Add(timeout)
	for {
		if m, ok := findMsg(drain(c), typ); ok {
			return m, true
		}
		if time.Now().After(deadline) {
			return Envelope{}, false
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func findMsg(msgs []Envelope, typ string) (Envelope, bool) {
	for _, m := range msgs {
		if m.Type == typ {
			return m, true
		}
	}
	return Envelope{}, false
}

func errCode(msgs []Envelope, typ string) string {
	if m, ok := findMsg(msgs, typ); ok {
		code, _ := m.Payload["code"].(string)
		return code
	}
	return ""
}

func create(hub *Hub, c *Client, playlist []any, name, session string) {
	hub.handleRoomCreate(c, Envelope{Type: "room.create", Payload: map[string]any{
		"name": "Room", "playlist": playlist, "displayName": name, "sessionId": session,
	}})
}

func join(hub *Hub, c *Client, roomID, name, session string) {
	hub.handleRoomJoin(c, Envelope{Type: "room.join", Payload: map[string]any{
		"roomId": roomID, "displayName": name, "sessionId": session,
	}})
}

// recAdapter records hook calls; it finishes when told to and can panic on
// demand.
type recAdapter struct {
	calls     []string
	done      bool
	scores    map[string]int
	deadline  time.Time
	panicOn   string
	shiftedBy time.Duration
}

func (a *recAdapter) rec(call string) {
	a.calls = append(a.calls, call)
	if a.panicOn == call {
		panic("boom in " + call)
	}
}
func (a *recAdapter) Start(string, games.Options) { a.deadline = time.Now().Add(time.Hour) }
func (a *recAdapter) OnPlayerJoin(id string)      { a.rec("join:" + id) }
func (a *recAdapter) OnPlayerLeave(id string)     { a.rec("leave:" + id) }
func (a *recAdapter) OnRoomChange()               { a.rec("roomChange") }
func (a *recAdapter) OnAction(id string, p map[string]any) error {
	a.rec("action")
	if p["action"] == "finish" {
		a.done = true
	}
	if p["action"] == "bad" {
		return errors.New("bad")
	}
	return nil
}
func (a *recAdapter) OnTimer(string) {}
func (a *recAdapter) NextDeadline() (string, time.Time, bool) {
	return "t", a.deadline, !a.deadline.IsZero()
}
func (a *recAdapter) Shift(d time.Duration) {
	a.rec("shift")
	a.shiftedBy += d
	a.deadline = a.deadline.Add(d)
}
func (a *recAdapter) Status() games.Status {
	if a.done {
		return games.StatusFinished
	}
	return games.StatusRunning
}
func (a *recAdapter) Standings() []games.Standing {
	out := []games.Standing{}
	for id, sc := range a.scores {
		out = append(out, games.Standing{PlayerID: id, Score: sc})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Score > out[j].Score })
	return out
}
func (a *recAdapter) PublicState() map[string]any        { return map[string]any{"done": a.done} }
func (a *recAdapter) PrivateState(string) map[string]any { return map[string]any{} }

// recHub registers "rec" (shared adapter instance per test) and "stub".
func recHub(adapter *recAdapter) *Hub {
	registry := games.NewRegistry()
	registry.Register(games.Factory{Type: "rec", Name: "Rec", New: func() games.Adapter { return adapter }})
	registry.Register(newStubFactory())
	return NewHub(registry)
}

// threePlayers sets up host + two joiners in a rec room, all captured.
func threePlayers(t *testing.T, hub *Hub) (*Client, *Client, *Client, *rooms.Room) {
	t.Helper()
	host := newTestClient(hub, "host")
	create(hub, host, []any{"rec", "stub"}, "Host", "s-host")
	a := newTestClient(hub, "a")
	join(hub, a, host.RoomID, "A", "s-a")
	b := newTestClient(hub, "b")
	join(hub, b, host.RoomID, "B", "s-b")
	room, _ := hub.rooms.Get(host.RoomID)
	if a.RoomID == "" || b.RoomID == "" {
		t.Fatalf("setup joins failed")
	}
	return host, a, b, room
}

func startRec(t *testing.T, hub *Hub, host *Client, room *rooms.Room) *gameSession {
	t.Helper()
	room.SetNextGame("rec", "Rec")
	hub.handleGameStart(host, Envelope{Type: "game.start", Payload: map[string]any{"force": true}})
	s, _ := hub.session(room.ID)
	if s.adapter == nil {
		t.Fatalf("game did not start: %v", drain(host))
	}
	return s
}

// ---- 1. outbound queue / slow clients --------------------------------------

func TestFullQueueDropsClientWithoutBlocking(t *testing.T) {
	hub := newSessionTestHub()
	host := newTestClient(hub, "host")
	create(hub, host, []any{"stub"}, "Host", "s-host")
	slow := &Client{ID: "slow", send: make(chan []byte, 4), done: make(chan struct{})}
	hub.mu.Lock()
	hub.clients[slow.ID] = slow
	hub.mu.Unlock()
	join(hub, slow, host.RoomID, "Slow", "s-slow")

	finished := make(chan struct{})
	go func() {
		for i := 0; i < 50; i++ {
			hub.Broadcast(host.RoomID, Envelope{Type: "x"})
		}
		close(finished)
	}()
	select {
	case <-finished:
	case <-time.After(2 * time.Second):
		t.Fatalf("broadcast blocked on a client that isn't reading")
	}
	select {
	case <-slow.done:
	default:
		t.Fatalf("expected the overflowing client to be closed")
	}
}

func TestNonReadingSocketDoesNotStallRoom(t *testing.T) {
	hub := newSessionTestHub()
	router := NewRouter(hub)
	srv := httptest.NewServer(http.HandlerFunc(router.HandleWS))
	defer srv.Close()
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	dial := func() *websocket.Conn {
		c, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
		if err != nil {
			t.Fatalf("dial: %v", err)
		}
		return c
	}
	reader, stuck := dial(), dial()
	defer reader.Close()
	defer stuck.Close()

	_ = reader.WriteJSON(Envelope{Type: "room.create", Payload: map[string]any{
		"name": "R", "playlist": []any{"stub"}, "displayName": "A", "sessionId": "ra"}})
	var roomID string
	for roomID == "" {
		var env Envelope
		if err := reader.ReadJSON(&env); err != nil {
			t.Fatalf("read: %v", err)
		}
		if env.Type == "room.create.ok" {
			roomID, _ = env.Payload["id"].(string)
		}
	}
	_ = stuck.WriteJSON(Envelope{Type: "room.join", Payload: map[string]any{
		"roomId": roomID, "displayName": "B", "sessionId": "rb"}})
	// Wait until both are seated.
	deadline := time.Now().Add(2 * time.Second)
	for {
		room, _ := hub.rooms.Get(roomID)
		if len(room.ConnectedPlayerIDs()) == 2 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("join never landed")
		}
		time.Sleep(10 * time.Millisecond)
	}

	// The reader keeps draining; the stuck client never reads.
	go func() {
		for {
			if _, _, err := reader.ReadMessage(); err != nil {
				return
			}
		}
	}()
	big := strings.Repeat("x", 256*1024)
	start := time.Now()
	for i := 0; i < 200; i++ {
		hub.Broadcast(roomID, Envelope{Type: "blob", Payload: map[string]any{"b": big}})
		time.Sleep(2 * time.Millisecond) // let the healthy reader keep up
	}
	if elapsed := time.Since(start); elapsed > 3*time.Second {
		t.Fatalf("broadcasts stalled behind a non-reading client: %v", elapsed)
	}
	// The stuck client is dropped and marked disconnected.
	deadline = time.Now().Add(3 * time.Second)
	for hub.ClientCount() != 1 {
		if time.Now().After(deadline) {
			t.Fatalf("expected the non-reading client to be dropped, have %d", hub.ClientCount())
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// ---- 2. reconnect takeover -------------------------------------------------

func TestReconnectTakesOverLiveSocketInSameRoom(t *testing.T) {
	hub := newSessionTestHub()
	host := newTestClient(hub, "host")
	create(hub, host, []any{"stub"}, "Host", "s-host")
	old := newTestClient(hub, "old")
	join(hub, old, host.RoomID, "Bea", "s-bea")
	playerID := old.Player.ID
	drain(old)

	// Same session, new socket, while the old one is still "alive".
	fresh := newTestClient(hub, "fresh")
	join(hub, fresh, host.RoomID, "Bea", "s-bea")
	if fresh.RoomID != host.RoomID {
		t.Fatalf("expected takeover, got %v", drain(fresh))
	}
	if fresh.Player.ID != playerID {
		t.Fatalf("takeover must keep the same seat")
	}
	if old.RoomID != "" {
		t.Fatalf("old socket must be unbound")
	}
	if _, ok := findMsg(drain(old), "room.sessionReplaced"); !ok {
		t.Fatalf("old socket should be told it was replaced")
	}

	// The old socket finally drains: the player must stay connected.
	hub.RemoveClient(old.ID)
	room, _ := hub.rooms.Get(host.RoomID)
	if !room.Players[playerID].Connected {
		t.Fatalf("old socket's disconnect flipped the reconnected player offline")
	}
}

func TestRemoveClientSkipsPlayerBoundElsewhere(t *testing.T) {
	hub := newSessionTestHub()
	host := newTestClient(hub, "host")
	create(hub, host, []any{"stub"}, "Host", "s-host")
	old := newTestClient(hub, "old")
	join(hub, old, host.RoomID, "Bea", "s-bea")
	// Simulate the race: a second connection is bound to the same player
	// while the old one still carries its (stale) binding.
	other := newTestClient(hub, "other")
	hub.bindClient(other, host.RoomID, old.Player, "")
	hub.RemoveClient(old.ID)
	room, _ := hub.rooms.Get(host.RoomID)
	if !room.Players[old.Player.ID].Connected {
		t.Fatalf("player bound to another live client must not be marked disconnected")
	}
}

// ---- 3. pause cleared on finish/start/remove ------------------------------

func TestGameFinishingWhilePausedDoesNotPauseNextGame(t *testing.T) {
	adapter := &recAdapter{}
	hub := recHub(adapter)
	host, _, _, room := threePlayers(t, hub)
	s := startRec(t, hub, host, room)
	hub.handleSessionPause(host, Envelope{Type: "session.pause"})
	if !room.Snapshot()["paused"].(bool) {
		t.Fatalf("expected paused")
	}
	func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		adapter.done = true
		hub.afterAdapterCall(room.ID, s)
	}()
	if !s.pausedAt.IsZero() || room.Snapshot()["paused"].(bool) {
		t.Fatalf("finishing must clear the pause")
	}
	// Next game runs unpaused.
	adapter.done = false
	room.SetStatus(rooms.StatusLobby)
	startRec(t, hub, host, room)
	drain(host)
	hub.handleGameAction(host, Envelope{Type: "game.action", Payload: map[string]any{"action": "x"}})
	if code := errCode(drain(host), "game.action.error"); code != "" {
		t.Fatalf("next game should accept actions, got %s", code)
	}
}

// ---- 4. kick scope ---------------------------------------------------------

func TestKickCannotTouchOtherRooms(t *testing.T) {
	hub := newSessionTestHub()
	adminA := newTestClient(hub, "adminA")
	create(hub, adminA, []any{"stub"}, "AdminA", "s-aa")
	adminB := newTestClient(hub, "adminB")
	create(hub, adminB, []any{"stub"}, "AdminB", "s-bb")
	victim := newTestClient(hub, "victim")
	join(hub, victim, adminB.RoomID, "Victim", "s-v")

	hub.handleRoomKick(adminA, Envelope{Type: "room.kick", Payload: map[string]any{"playerId": victim.Player.ID}})
	if code := errCode(drain(adminA), "room.kick.error"); code != "not_found" {
		t.Fatalf("expected not_found for a player in another room, got %q", code)
	}
	if victim.RoomID != adminB.RoomID {
		t.Fatalf("victim in another room was unbound")
	}

	hub.handleRoomKick(adminB, Envelope{Type: "room.kick", Payload: map[string]any{"playerId": victim.Player.ID}})
	if victim.RoomID != "" {
		t.Fatalf("expected in-room kick to unbind the victim")
	}
	if _, ok := findMsg(drain(victim), "room.kicked"); !ok {
		t.Fatalf("victim should get room.kicked")
	}
}

// ---- 5. client identity race (run with -race) -----------------------------

func TestKickRacesHandlersWithoutDataRace(t *testing.T) {
	hub := newSessionTestHub()
	host := newTestClient(hub, "host")
	create(hub, host, []any{"stub"}, "Host", "s-host")
	victim := newTestClient(hub, "victim")
	join(hub, victim, host.RoomID, "V", "s-v")
	victimID := victim.Player.ID

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for i := 0; i < 50; i++ {
			hub.handleRoomReadySet(victim, Envelope{Type: "room.ready.set", Payload: map[string]any{"ready": true}})
			hub.handleGameAction(victim, Envelope{Type: "game.action"})
			hub.handleDecksList(victim, Envelope{Type: "lobby.decks.list"})
		}
	}()
	go func() {
		defer wg.Done()
		hub.handleRoomKick(host, Envelope{Type: "room.kick", Payload: map[string]any{"playerId": victimID}})
	}()
	wg.Wait()
}

// ---- 6. adapter panics release the session lock ---------------------------

func TestAdapterPanicReleasesSessionLock(t *testing.T) {
	adapter := &recAdapter{}
	hub := recHub(adapter)
	host, a, _, room := threePlayers(t, hub)
	s := startRec(t, hub, host, room)

	adapter.panicOn = "roomChange"
	hub.RemoveClient(a.ID) // must recover, not crash
	if !s.mu.TryLock() {
		t.Fatalf("session lock left held after a panic in RemoveClient")
	}
	s.mu.Unlock()

	adapter.panicOn = "action"
	func() {
		defer func() { _ = recover() }() // the router's per-message recover
		hub.handleGameAction(host, Envelope{Type: "game.action", Payload: map[string]any{}})
	}()
	if !s.mu.TryLock() {
		t.Fatalf("session lock left held after a panic in OnAction")
	}
	s.mu.Unlock()
}

// ---- 7. votes count connected members only --------------------------------

func toVoting(t *testing.T, hub *Hub, host *Client, room *rooms.Room) *gameSession {
	t.Helper()
	room.SetStatus(rooms.StatusResults)
	hub.handleSessionVoteStart(host, Envelope{Type: "session.vote.start"})
	s, _ := hub.session(room.ID)
	if room.GetStatus() != rooms.StatusVoting {
		t.Fatalf("vote did not open")
	}
	return s
}

func TestVoteIgnoresBallotsOfPlayersWhoLeft(t *testing.T) {
	hub := recHub(&recAdapter{})
	host, a, b, room := threePlayers(t, hub)
	s := toVoting(t, hub, host, room)
	option := s.voteOptions[0]

	hub.handleSessionVoteCast(a, Envelope{Payload: map[string]any{"gameType": option}})
	hub.handleRoomLeave(a, Envelope{Type: "room.leave"})
	hub.handleSessionVoteCast(b, Envelope{Payload: map[string]any{"gameType": option}})
	if room.GetStatus() != rooms.StatusVoting {
		t.Fatalf("vote closed before the host voted (a departed player's ballot was counted)")
	}
	hub.handleSessionVoteCast(host, Envelope{Payload: map[string]any{"gameType": option}})
	if room.GetStatus() != rooms.StatusLobby {
		t.Fatalf("expected the vote to resolve once every remaining player voted")
	}
}

func TestVoteResolvesWhenLastHoldoutDisconnects(t *testing.T) {
	hub := recHub(&recAdapter{})
	host, a, b, room := threePlayers(t, hub)
	s := toVoting(t, hub, host, room)
	option := s.voteOptions[0]
	hub.handleSessionVoteCast(host, Envelope{Payload: map[string]any{"gameType": option}})
	hub.handleSessionVoteCast(a, Envelope{Payload: map[string]any{"gameType": option}})
	hub.RemoveClient(b.ID)
	if room.GetStatus() != rooms.StatusLobby {
		t.Fatalf("expected the vote to resolve when the only non-voter disconnected")
	}
}

// ---- 8. rate limits, codes, playlists, decks ------------------------------

func TestPerConnectionRateLimit(t *testing.T) {
	hub := newSessionTestHub()
	c := newClient(nil, "203.0.113.20")
	hub.mu.Lock()
	hub.clients[c.ID] = c
	hub.mu.Unlock()
	limited := 0
	for i := 0; i < 100; i++ {
		hub.HandleMessage(c, Envelope{Type: "room.ready.set", Payload: map[string]any{"ready": true}})
	}
	for _, m := range drain(c) {
		if m.Type == "system.error" && m.Payload["code"] == "rate_limited" {
			limited++
		}
	}
	if limited == 0 {
		t.Fatalf("expected a ready-toggle flood to be rate limited")
	}
	// Streams have their own, larger bucket.
	allowed := 0
	for i := 0; i < 200; i++ {
		if c.allow("game.stream") {
			allowed++
		}
	}
	if allowed < streamBurst || allowed >= 200 {
		t.Fatalf("stream bucket should allow ~%d then throttle, allowed %d", streamBurst, allowed)
	}
}

func TestFailedJoinsAreRateLimitedPerIP(t *testing.T) {
	hub := newSessionTestHub()
	host := newTestClient(hub, "host")
	hub.handleRoomCreate(host, Envelope{Type: "room.create", Payload: map[string]any{
		"name": "R", "playlist": []any{"stub"}, "displayName": "Host", "sessionId": "s-host", "visibility": "private",
	}})
	guesser := newTestClient(hub, "guesser")
	guesser.IP = "203.0.113.30"
	sawLimit := false
	for i := 0; i < joinFailBurst+5; i++ {
		hub.handleRoomJoin(guesser, Envelope{Type: "room.join", Payload: map[string]any{
			"joinCode": "ZZZZZ" + string(rune('A'+i%20)), "displayName": "G", "sessionId": "s-g",
		}})
		if errCode(drain(guesser), "room.join.error") == "rate_limited" {
			sawLimit = true
			break
		}
	}
	if !sawLimit {
		t.Fatalf("expected repeated failed joins to hit the per-IP limit")
	}
	// Loopback (tests, local tooling) is exempt.
	local := newTestClient(hub, "local")
	local.IP = "127.0.0.1"
	for i := 0; i < joinFailBurst+5; i++ {
		hub.handleRoomJoin(local, Envelope{Type: "room.join", Payload: map[string]any{
			"joinCode": "QQQQQQ", "displayName": "L", "sessionId": "s-l",
		}})
	}
	if errCode(drain(local), "room.join.error") == "rate_limited" {
		t.Fatalf("loopback must stay exempt")
	}
}

func TestJoinCodesAreUnambiguousAndUnique(t *testing.T) {
	valid := regexp.MustCompile(`^[2-9A-HJ-NP-Z]{6}$`)
	seen := map[string]bool{}
	for i := 0; i < 2000; i++ {
		code := rooms.NewJoinCode()
		if !valid.MatchString(code) {
			t.Fatalf("bad join code %q", code)
		}
		seen[code] = true
	}
	if len(seen) < 1990 {
		t.Fatalf("join codes look non-random: %d distinct of 2000", len(seen))
	}
	m := rooms.NewManager()
	m.Create(&rooms.Room{ID: "a", JoinCode: "ABCDEF"})
	b := &rooms.Room{ID: "b", JoinCode: "ABCDEF"}
	m.Create(b)
	if b.JoinCode == "ABCDEF" {
		t.Fatalf("colliding join code must be re-rolled")
	}
}

func TestPlaylistDedupedAndValidated(t *testing.T) {
	hub := newSessionTestHub()
	host := newTestClient(hub, "host")
	create(hub, host, []any{"stub", "stub", "invention", "stub"}, "Host", "s-host")
	room, _ := hub.rooms.Get(host.RoomID)
	if got := room.GetPlaylist(); len(got) != 2 || got[0] != "stub" || got[1] != "invention" {
		t.Fatalf("expected deduped playlist, got %v", got)
	}
	hub.handleSessionPlaylistSet(host, Envelope{Payload: map[string]any{"playlist": []any{"invention", "invention"}}})
	if got := room.GetPlaylist(); len(got) != 1 {
		t.Fatalf("expected deduped playlist on set, got %v", got)
	}
	drain(host)
	hub.handleSessionPlaylistSet(host, Envelope{Payload: map[string]any{"playlist": []any{"invention", "nope"}}})
	if code := errCode(drain(host), "session.playlist.set.error"); code != "invalid_game" {
		t.Fatalf("expected invalid_game, got %q", code)
	}
	hub.handleCahDecksSet(host, Envelope{Payload: map[string]any{"decks": []any{"base_en", "base_en", "nope"}}})
	if got := room.GetCahDeckIDs(); len(got) != 1 || got[0] != "base_en" {
		t.Fatalf("expected deduped deck ids, got %v", got)
	}
}

func testDeck(name string, whiteText string) map[string]any {
	black := []any{}
	for i := 0; i < 3; i++ {
		black = append(black, map[string]any{"text": "Why ____?", "pick": 1.0})
	}
	white := []any{}
	for i := 0; i < 12; i++ {
		white = append(white, whiteText+" "+string(rune('a'+i)))
	}
	return map[string]any{"name": name, "black": black, "white": white}
}

func TestCustomDeckCapsAndReplace(t *testing.T) {
	hub := newSessionTestHub()
	host := newTestClient(hub, "host")
	create(hub, host, []any{"stub"}, "Host", "s-host")
	s, _ := hub.session(host.RoomID)

	hub.handleDeckAdd(host, Envelope{Payload: map[string]any{"deck": testDeck("Long", strings.Repeat("w", maxCardTextLen))}})
	if code := errCode(drain(host), "session.deck.add.error"); code != "invalid_deck" {
		t.Fatalf("expected an over-long card to be refused, got %q", code)
	}
	huge := testDeck("Huge", "card")
	white := []any{}
	for i := 0; i < maxDeckCards; i++ {
		white = append(white, "c")
	}
	huge["white"] = white
	hub.handleDeckAdd(host, Envelope{Payload: map[string]any{"deck": huge}})
	if code := errCode(drain(host), "session.deck.add.error"); code != "invalid_deck" {
		t.Fatalf("expected an oversized deck to be refused, got %q", code)
	}

	for i := 0; i < maxCustomDecks; i++ {
		hub.handleDeckAdd(host, Envelope{Payload: map[string]any{"deck": testDeck("Deck "+string(rune('A'+i)), "card")}})
	}
	if len(s.customDecks) != maxCustomDecks {
		t.Fatalf("expected %d decks, got %d", maxCustomDecks, len(s.customDecks))
	}
	drain(host)
	// Re-uploading an existing deck at the cap replaces it.
	hub.handleDeckAdd(host, Envelope{Payload: map[string]any{"deck": testDeck("Deck A", "new card")}})
	msgs := drain(host)
	if code := errCode(msgs, "session.deck.add.error"); code != "" {
		t.Fatalf("re-upload at the cap should replace, got %q", code)
	}
	if !strings.HasPrefix(s.customDecks[0].White[0], "new card") {
		t.Fatalf("expected the deck to be replaced")
	}
	// A brand-new deck at the cap is refused.
	hub.handleDeckAdd(host, Envelope{Payload: map[string]any{"deck": testDeck("One Too Many", "card")}})
	if code := errCode(drain(host), "session.deck.add.error"); code != "too_many_decks" {
		t.Fatalf("expected too_many_decks, got %q", code)
	}
}

// ---- 9. persistence --------------------------------------------------------

type failingStore struct{ saves int }

func (f *failingStore) SaveRooms(map[string][]byte) error { f.saves++; return nil }
func (f *failingStore) LoadRooms() (map[string][]byte, error) {
	return nil, errors.New("redis down")
}
func (f *failingStore) DeleteRoom(string) error { return nil }

func TestRestoreFailureIsReported(t *testing.T) {
	hub := NewHub(games.NewRegistry())
	store := &failingStore{}
	hub.SetStore(store)
	if err := hub.RestoreFromStore(); err == nil {
		t.Fatalf("a failed load must be returned so the saver isn't started")
	}
	hub.DisableStore()
	hub.SnapshotToStore()
	if store.saves != 0 {
		t.Fatalf("a disabled store must never be overwritten")
	}
}

func TestCustomDecksPersistWithRoom(t *testing.T) {
	store := newFakeStore()
	hub := newSessionTestHub()
	hub.SetStore(store)
	host := newTestClient(hub, "host")
	create(hub, host, []any{"stub"}, "Host", "s-host")
	hub.handleDeckAdd(host, Envelope{Payload: map[string]any{"deck": testDeck("Party Pack", "card")}})
	hub.SnapshotToStore()

	hub2 := newSessionTestHub()
	hub2.SetStore(store)
	if err := hub2.RestoreFromStore(); err != nil {
		t.Fatalf("restore: %v", err)
	}
	s, ok := hub2.session(host.RoomID)
	if !ok || len(s.customDecks) != 1 || s.customDecks[0].ID != games.CustomDeckID("Party Pack") {
		t.Fatalf("custom deck not restored: %+v", s)
	}
	if len(s.customDecks[0].White) != 12 || len(s.customDecks[0].Black) == 0 || s.customDecks[0].Black[0].Pick != 1 {
		t.Fatalf("restored deck lost its cards: %+v", s.customDecks[0])
	}
}

// ---- 10. proxy hops --------------------------------------------------------

func TestClientIPHonoursProxyHops(t *testing.T) {
	origTrust, origHops := trustProxy, proxyHops
	defer func() { trustProxy, proxyHops = origTrust, origHops }()
	trustProxy = true
	proxyHops = 2
	req := &http.Request{RemoteAddr: "10.0.0.1:1", Header: http.Header{
		"X-Forwarded-For": {"1.1.1.1, 198.51.100.4", "10.0.0.9"},
	}}
	if got := clientIP(req); got != "198.51.100.4" {
		t.Fatalf("want the entry 2 hops from the right, got %q", got)
	}
	req.Header = http.Header{"X-Forwarded-For": {"10.0.0.9"}}
	if got := clientIP(req); got != "10.0.0.1" {
		t.Fatalf("too-short XFF must fall back to the peer, got %q", got)
	}
}

// ---- 11/12. standings filtered; rejoin state; mid-game join ---------------

func TestStandingsExcludePlayersWhoLeft(t *testing.T) {
	adapter := &recAdapter{}
	hub := recHub(adapter)
	host, a, b, room := threePlayers(t, hub)
	startRec(t, hub, host, room)
	leaverID := b.Player.ID
	adapter.scores = map[string]int{host.Player.ID: 3, a.Player.ID: 2, leaverID: 9}
	hub.handleRoomLeave(b, Envelope{Type: "room.leave"})
	drain(host)

	hub.handleGameAction(host, Envelope{Type: "game.action", Payload: map[string]any{"action": "x"}})
	for _, m := range drain(host) {
		if m.Type != "game.state" || m.Payload["standings"] == nil {
			continue
		}
		for _, row := range m.Payload["standings"].([]any) {
			if row.(map[string]any)["playerId"] == leaverID {
				t.Fatalf("live standings still include a player who left")
			}
		}
	}

	hub.handleGameAction(host, Envelope{Type: "game.action", Payload: map[string]any{"action": "finish"}})
	played := room.Snapshot()["playedGames"].([]rooms.PlayedGame)
	for _, row := range played[0].Standings {
		if row.PlayerID == leaverID {
			t.Fatalf("results include a player who left")
		}
		if row.Name == "" {
			t.Fatalf("result row without a name: %+v", row)
		}
	}
	if played[0].Standings[0].PlayerID != host.Player.ID || played[0].Standings[0].Place != 1 {
		t.Fatalf("places should be recomputed without the leaver: %+v", played[0].Standings)
	}
}

func TestRejoinGetsStandingsAndMidGameJoinBroadcasts(t *testing.T) {
	adapter := &recAdapter{}
	hub := recHub(adapter)
	host, a, _, room := threePlayers(t, hub)
	startRec(t, hub, host, room)
	adapter.scores = map[string]int{host.Player.ID: 1}

	// Rejoin (refresh): new socket, same session.
	hub.RemoveClient(a.ID)
	again := newTestClient(hub, "a2")
	join(hub, again, room.ID, "A", "s-a")
	gs, ok := findMsg(drain(again), "game.state")
	if !ok || gs.Payload["standings"] == nil || gs.Payload["public"] == nil || gs.Payload["private"] == nil {
		t.Fatalf("rejoin game.state must carry public, private and standings: %+v", gs)
	}

	// Brand-new player mid-game: the game hears about it and everyone gets
	// fresh state.
	drain(host)
	late := newTestClient(hub, "late")
	join(hub, late, room.ID, "Late", "s-late")
	if len(adapter.calls) == 0 || adapter.calls[len(adapter.calls)-1] != "join:"+late.Player.ID {
		t.Fatalf("expected OnPlayerJoin, calls=%v", adapter.calls)
	}
	// game.state broadcasts are coalesced: this one may trail by up to
	// stateCoalesceWindow.
	if _, ok := awaitMsg(host, "game.state", time.Second); !ok {
		t.Fatalf("expected a game.state broadcast after a mid-game join")
	}
}

// ---- 13. pause defers leaves/room changes until resume ---------------------

func TestPauseDefersLeavesUntilAfterShift(t *testing.T) {
	adapter := &recAdapter{}
	hub := recHub(adapter)
	host, a, b, room := threePlayers(t, hub)
	startRec(t, hub, host, room)
	hub.handleSessionPause(host, Envelope{Type: "session.pause"})
	adapter.calls = nil

	leaverID := a.Player.ID
	hub.handleRoomLeave(a, Envelope{Type: "room.leave"})
	hub.RemoveClient(b.ID)
	if len(adapter.calls) != 0 {
		t.Fatalf("adapter must not see leaves/room changes while paused, got %v", adapter.calls)
	}
	hub.handleSessionResume(host, Envelope{Type: "session.resume"})
	want := []string{"shift", "leave:" + leaverID, "roomChange"}
	if strings.Join(adapter.calls, ",") != strings.Join(want, ",") {
		t.Fatalf("expected %v on resume, got %v", want, adapter.calls)
	}
}

// ---- 14. drawing validation helper -----------------------------------------

func TestValidImageDataURL(t *testing.T) {
	cases := map[string]bool{
		"data:image/png;base64,iVBORw0KGgo=":                                  true,
		"data:image/jpeg;base64,/9j/4AAQ":                                     true,
		"data:image/webp;base64,UklGRg==":                                     true,
		"data:image/svg+xml;base64,PHN2Zz4=":                                  false,
		"https://evil.example/x.png":                                          false,
		"data:image/png;base64,":                                              false,
		"data:image/png;base64,abc\"><script>":                                false,
		"data:image/png;base64," + strings.Repeat("A", games.MaxDrawingBytes): false,
	}
	for in, want := range cases {
		if got := games.ValidImageDataURL(in); got != want {
			t.Errorf("ValidImageDataURL(%.40q) = %v, want %v", in, got, want)
		}
	}
}

// ---- session.next.random ---------------------------------------------------

func TestSessionNextRandomQueuesEligibleGame(t *testing.T) {
	hub := recHub(&recAdapter{})
	registry := hub.registry
	registry.Register(games.Factory{Type: "big", Name: "Big", MinPlayers: 8, New: func() games.Adapter { return &stubAdapter{} }})
	host, a, _, room := threePlayers(t, hub)
	room.SetPlaylist([]string{"big", "stub"})
	drain(a)

	hub.handleSessionNextRandom(a, Envelope{Type: "session.next.random"})
	if code := errCode(drain(a), "session.next.random.error"); code != "not_admin" {
		t.Fatalf("expected not_admin, got %q", code)
	}
	drain(host)
	hub.handleSessionNextRandom(host, Envelope{Type: "session.next.random"})
	msgs := drain(host)
	ok, found := findMsg(msgs, "session.next.random.ok")
	if !found || ok.Payload["gameType"] != "stub" {
		t.Fatalf("expected the only eligible game (stub), got %+v", msgs)
	}
	res, found := findMsg(drain(a), "session.vote.result")
	if !found || res.Payload["gameType"] != "stub" {
		t.Fatalf("everyone should get a vote.result for the drumroll")
	}
	if room.GetNextGameType() != "stub" || room.GetStatus() != rooms.StatusLobby {
		t.Fatalf("expected stub queued in lobby")
	}
	// Already queued → wrong_status.
	hub.handleSessionNextRandom(host, Envelope{Type: "session.next.random"})
	if code := errCode(drain(host), "session.next.random.error"); code != "wrong_status" {
		t.Fatalf("expected wrong_status once a game is queued, got %q", code)
	}
	// A queued game still enforces min players on start.
	room.SetNextGame("big", "Big")
	hub.handleGameStart(host, Envelope{Type: "game.start", Payload: map[string]any{"force": true}})
	m, _ := findMsg(drain(host), "game.start.error")
	if m.Payload["code"] != "not_enough_players" || m.Payload["minPlayers"] != float64(8) {
		t.Fatalf("expected not_enough_players with minPlayers 8, got %+v", m.Payload)
	}
}
