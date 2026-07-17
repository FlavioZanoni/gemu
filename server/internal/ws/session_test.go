package ws

import (
	"sort"
	"testing"
	"time"

	"gemu-server/internal/games"
	"gemu-server/internal/rooms"
)

// stubAdapter is a minimal games.Adapter used to drive the session-end /
// vote flow without depending on invention's phase machinery. It "finishes"
// when it receives an OnAction payload {"action":"finish","scores":{...}}.
type stubAdapter struct {
	roomID string
	room   games.RoomInfo
	done   bool
	scores map[string]int
}

func (s *stubAdapter) Type() string { return "stub" }

func (s *stubAdapter) Start(roomID string, opts games.Options) {
	s.roomID = roomID
	s.room = opts.Room
	s.done = false
	s.scores = nil
}

func (s *stubAdapter) OnPlayerJoin(playerID string)  {}
func (s *stubAdapter) OnPlayerLeave(playerID string) {}
func (s *stubAdapter) OnRoomChange()                 {}

func (s *stubAdapter) OnAction(playerID string, payload map[string]any) error {
	action, _ := payload["action"].(string)
	if action != "finish" {
		return nil
	}
	rawScores, _ := payload["scores"].(map[string]any)
	scores := make(map[string]int, len(rawScores))
	for id, v := range rawScores {
		switch n := v.(type) {
		case float64:
			scores[id] = int(n)
		case int:
			scores[id] = n
		}
	}
	s.scores = scores
	s.done = true
	return nil
}

func (s *stubAdapter) OnTimer(name string) {}

func (s *stubAdapter) Shift(delta time.Duration) {}

func (s *stubAdapter) NextDeadline() (string, time.Time, bool) {
	return "", time.Time{}, false
}

func (s *stubAdapter) Status() games.Status {
	if s.done {
		return games.StatusFinished
	}
	return games.StatusRunning
}

func (s *stubAdapter) Standings() []games.Standing {
	standings := make([]games.Standing, 0, len(s.scores))
	for id, score := range s.scores {
		standings = append(standings, games.Standing{PlayerID: id, Score: score})
	}
	sort.SliceStable(standings, func(i, j int) bool { return standings[i].Score > standings[j].Score })
	return standings
}

func (s *stubAdapter) PublicState() map[string]any {
	return map[string]any{"done": s.done}
}

func (s *stubAdapter) PrivateState(playerID string) map[string]any {
	return map[string]any{}
}

func newStubFactory() games.Factory {
	return games.Factory{
		Type: "stub",
		Name: "Stub",
		New: func() games.Adapter {
			return &stubAdapter{}
		},
	}
}

func newSessionTestHub() *Hub {
	registry := games.NewRegistry()
	registry.Register(games.NewInventionFactory())
	registry.Register(newStubFactory())
	return NewHub(registry)
}

func TestPlacementRowsTies(t *testing.T) {
	room := &rooms.Room{
		ID: "room-1",
		Players: map[string]rooms.Player{
			"a": {ID: "a", Name: "Alice"},
			"b": {ID: "b", Name: "Bob"},
			"c": {ID: "c", Name: "Carol"},
		},
	}

	standings := []games.Standing{
		{PlayerID: "a", Score: 50},
		{PlayerID: "b", Score: 50},
		{PlayerID: "c", Score: 10},
	}

	rows := placementRows(room, standings)
	if len(rows) != 3 {
		t.Fatalf("expected 3 rows, got %d", len(rows))
	}

	byID := make(map[string]rooms.PlacementRow, len(rows))
	for _, row := range rows {
		byID[row.PlayerID] = row
	}

	if byID["a"].Place != 1 || byID["a"].Points != 100 {
		t.Fatalf("expected a place 1 / points 100, got %+v", byID["a"])
	}
	if byID["b"].Place != 1 || byID["b"].Points != 100 {
		t.Fatalf("expected b place 1 / points 100, got %+v", byID["b"])
	}
	if byID["c"].Place != 3 || byID["c"].Points != 60 {
		t.Fatalf("expected c place 3 / points 60, got %+v", byID["c"])
	}
}

// setupFinishedStubGame creates a room with the given playlist, joins a
// second player, force-starts the game (which picks the stub adapter), and
// finishes it with the given scores. It returns the host/joiner clients with
// their assigned player IDs populated.
func setupFinishedStubGame(t *testing.T, hub *Hub, playlist []any, hostScore, joinerScore float64) (*Client, *Client) {
	t.Helper()

	host := &Client{ID: "host"}
	hub.handleRoomCreate(host, Envelope{
		Type: "room.create",
		Payload: map[string]any{
			"name":        "Session",
			"playlist":    playlist,
			"displayName": "Host",
			"sessionId":   "sess-host",
		},
	})
	if host.RoomID == "" {
		t.Fatalf("expected room to be created")
	}

	joiner := &Client{ID: "joiner"}
	hub.handleRoomJoin(joiner, Envelope{
		Type: "room.join",
		Payload: map[string]any{
			"roomId":      host.RoomID,
			"displayName": "Joiner",
			"sessionId":   "sess-joiner",
		},
	})
	if joiner.RoomID == "" {
		t.Fatalf("expected joiner to join")
	}

	// Pin the next game to "stub" so the random playlist pick in
	// handleGameStart doesn't flakily choose another game from the playlist.
	if room, ok := hub.rooms.Get(host.RoomID); ok {
		room.SetNextGame("stub", "Stub")
	}

	hub.handleGameStart(host, Envelope{Type: "game.start", Payload: map[string]any{"force": true}})

	session, ok := hub.sessions[host.RoomID]
	if !ok || session.adapter == nil {
		t.Fatalf("expected adapter to be running after force start")
	}

	hub.handleGameAction(host, Envelope{
		Type: "game.action",
		Payload: map[string]any{
			"action": "finish",
			"scores": map[string]any{
				host.Player.ID:   hostScore,
				joiner.Player.ID: joinerScore,
			},
		},
	})

	return host, joiner
}

func TestGameFinishAwardsSessionPoints(t *testing.T) {
	hub := newSessionTestHub()
	host, joiner := setupFinishedStubGame(t, hub, []any{"stub"}, 10, 5)

	session, ok := hub.sessions[host.RoomID]
	if !ok {
		t.Fatalf("expected session to exist")
	}
	if session.adapter != nil {
		t.Fatalf("expected adapter to be cleared after finish")
	}

	room, ok := hub.rooms.Get(host.RoomID)
	if !ok {
		t.Fatalf("expected room to exist")
	}
	if room.GetStatus() != rooms.StatusResults {
		t.Fatalf("expected room status results, got %s", room.GetStatus())
	}

	snapshot := room.Snapshot()
	scores, ok := snapshot["sessionScores"].(map[string]int)
	if !ok {
		t.Fatalf("expected sessionScores map[string]int, got %T", snapshot["sessionScores"])
	}
	if scores[host.Player.ID] != 100 {
		t.Fatalf("expected host to have 100 points, got %d", scores[host.Player.ID])
	}
	if scores[joiner.Player.ID] != 75 {
		t.Fatalf("expected joiner to have 75 points, got %d", scores[joiner.Player.ID])
	}

	played, ok := snapshot["playedGames"].([]rooms.PlayedGame)
	if !ok {
		t.Fatalf("expected playedGames []rooms.PlayedGame, got %T", snapshot["playedGames"])
	}
	if len(played) != 1 {
		t.Fatalf("expected 1 played game, got %d", len(played))
	}

	hub.handleSessionVoteStart(host, Envelope{Type: "session.vote.start"})

	if room.GetStatus() != rooms.StatusLobby {
		t.Fatalf("expected room status lobby after single-game vote start, got %s", room.GetStatus())
	}
	if room.GetNextGameType() != "stub" {
		t.Fatalf("expected next game type stub, got %s", room.GetNextGameType())
	}
}

func TestVoteResolvesOnAllVotes(t *testing.T) {
	hub := newSessionTestHub()
	host, joiner := setupFinishedStubGame(t, hub, []any{"stub", "invention"}, 10, 5)

	room, ok := hub.rooms.Get(host.RoomID)
	if !ok {
		t.Fatalf("expected room to exist")
	}

	hub.handleSessionVoteStart(host, Envelope{Type: "session.vote.start"})
	if room.GetStatus() != rooms.StatusVoting {
		t.Fatalf("expected room status voting, got %s", room.GetStatus())
	}

	hub.handleSessionVoteCast(host, Envelope{
		Type:    "session.vote.cast",
		Payload: map[string]any{"gameType": "invention"},
	})
	if room.GetStatus() != rooms.StatusVoting {
		t.Fatalf("expected room status still voting after first vote, got %s", room.GetStatus())
	}

	hub.handleSessionVoteCast(joiner, Envelope{
		Type:    "session.vote.cast",
		Payload: map[string]any{"gameType": "invention"},
	})

	if room.GetStatus() != rooms.StatusLobby {
		t.Fatalf("expected room status lobby after all votes cast, got %s", room.GetStatus())
	}
	if room.GetNextGameType() != "invention" {
		t.Fatalf("expected next game type invention, got %s", room.GetNextGameType())
	}
}

func TestSessionReplayQueuesSameGame(t *testing.T) {
	hub := newSessionTestHub()
	host, joiner := setupFinishedStubGame(t, hub, []any{"stub", "invention"}, 10, 5)

	room, ok := hub.rooms.Get(host.RoomID)
	if !ok {
		t.Fatalf("expected room to exist")
	}
	if room.GetStatus() != rooms.StatusResults {
		t.Fatalf("expected results status, got %s", room.GetStatus())
	}

	// Non-admin replay rejected.
	hub.handleSessionReplay(joiner, Envelope{Type: "session.replay"})
	if room.GetStatus() != rooms.StatusResults {
		t.Fatalf("expected non-admin replay ignored")
	}

	hub.handleSessionReplay(host, Envelope{Type: "session.replay"})
	if room.GetStatus() != rooms.StatusLobby {
		t.Fatalf("expected lobby after replay, got %s", room.GetStatus())
	}
	if room.GetNextGameType() != "stub" {
		t.Fatalf("expected same game queued, got %q", room.GetNextGameType())
	}
}

func TestGameStartRespectsMinPlayers(t *testing.T) {
	registry := games.NewRegistry()
	registry.Register(games.Factory{Type: "big", Name: "Big", MinPlayers: 3, New: func() games.Adapter { return &stubAdapter{} }})
	hub := NewHub(registry)

	host := &Client{ID: "host"}
	hub.handleRoomCreate(host, Envelope{Type: "room.create", Payload: map[string]any{
		"name": "Min", "playlist": []any{"big"}, "displayName": "Host", "sessionId": "sess-host",
	}})
	joiner := &Client{ID: "joiner"}
	hub.handleRoomJoin(joiner, Envelope{Type: "room.join", Payload: map[string]any{
		"roomId": host.RoomID, "displayName": "Joiner", "sessionId": "sess-joiner",
	}})

	hub.handleGameStart(host, Envelope{Type: "game.start", Payload: map[string]any{"force": true}})
	s, _ := hub.session(host.RoomID)
	if s.adapter != nil {
		t.Fatalf("expected start rejected with 2 players for a 3-player game")
	}

	third := &Client{ID: "third"}
	hub.handleRoomJoin(third, Envelope{Type: "room.join", Payload: map[string]any{
		"roomId": host.RoomID, "displayName": "Third", "sessionId": "sess-third",
	}})
	hub.handleGameStart(host, Envelope{Type: "game.start", Payload: map[string]any{"force": true}})
	if s.adapter == nil {
		t.Fatalf("expected start allowed with 3 players")
	}
}

func TestRoomJoinRejectsDuplicateName(t *testing.T) {
	hub := newSessionTestHub()
	host := &Client{ID: "host"}
	hub.handleRoomCreate(host, Envelope{Type: "room.create", Payload: map[string]any{
		"name": "Names", "playlist": []any{"stub"}, "displayName": "Ana", "sessionId": "sess-host",
	}})

	dup := &Client{ID: "dup"}
	hub.handleRoomJoin(dup, Envelope{Type: "room.join", Payload: map[string]any{
		"roomId": host.RoomID, "displayName": "  ana ", "sessionId": "sess-dup",
	}})
	if dup.RoomID != "" {
		t.Fatalf("expected duplicate name rejected")
	}

	ok := &Client{ID: "ok"}
	hub.handleRoomJoin(ok, Envelope{Type: "room.join", Payload: map[string]any{
		"roomId": host.RoomID, "displayName": "Bia", "sessionId": "sess-ok",
	}})
	if ok.RoomID == "" {
		t.Fatalf("expected distinct name accepted")
	}
}

func TestPauseFreezesTimerAndActions(t *testing.T) {
	registry := games.NewRegistry()
	registry.Register(games.NewStopFactory())
	hub := NewHub(registry)

	host := &Client{ID: "host"}
	hub.handleRoomCreate(host, Envelope{Type: "room.create", Payload: map[string]any{
		"name": "Pause", "playlist": []any{"stop"}, "displayName": "Host", "sessionId": "sess-host",
	}})
	joiner := &Client{ID: "joiner"}
	hub.handleRoomJoin(joiner, Envelope{Type: "room.join", Payload: map[string]any{
		"roomId": host.RoomID, "displayName": "Joiner", "sessionId": "sess-joiner",
	}})
	hub.handleGameStart(host, Envelope{Type: "game.start", Payload: map[string]any{"force": true}})

	room, _ := hub.rooms.Get(host.RoomID)
	s, _ := hub.session(host.RoomID)

	// Non-admin pause rejected.
	hub.handleSessionPause(joiner, Envelope{Type: "session.pause"})
	if room.IsPaused() {
		t.Fatalf("expected non-admin pause rejected")
	}

	s.mu.Lock()
	_, before, ok := s.adapter.NextDeadline()
	s.mu.Unlock()
	if !ok {
		t.Fatalf("expected a pending deadline while answering")
	}

	hub.handleSessionPause(host, Envelope{Type: "session.pause"})
	if !room.IsPaused() {
		t.Fatalf("expected room paused")
	}
	s.mu.Lock()
	if s.timer != nil {
		t.Fatalf("expected timer stopped while paused")
	}
	pausedActionState := s.adapter.PublicState()["answersFilled"]
	s.mu.Unlock()

	// Actions rejected while paused.
	hub.handleGameAction(host, Envelope{Type: "game.action", Payload: map[string]any{
		"action": "set_answers", "answers": map[string]any{},
	}})
	s.mu.Lock()
	if len(s.adapter.PublicState()["answersFilled"].(map[string]int)) != len(pausedActionState.(map[string]int)) {
		t.Fatalf("expected action ignored while paused")
	}
	s.mu.Unlock()

	// Simulate one second of frozen time, then resume: deadline shifts forward.
	s.mu.Lock()
	s.pausedAt = s.pausedAt.Add(-1 * time.Second)
	s.mu.Unlock()
	hub.handleSessionResume(host, Envelope{Type: "session.resume"})
	if room.IsPaused() {
		t.Fatalf("expected room resumed")
	}
	s.mu.Lock()
	_, after, _ := s.adapter.NextDeadline()
	rearmed := s.timer != nil
	s.mu.Unlock()
	if !after.After(before.Add(900 * time.Millisecond)) {
		t.Fatalf("expected deadline shifted by ~1s, before=%v after=%v", before, after)
	}
	if !rearmed {
		t.Fatalf("expected timer re-armed after resume")
	}
}
