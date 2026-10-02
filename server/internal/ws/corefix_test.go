package ws

import (
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"gemu-server/internal/games"
	"gemu-server/internal/rooms"
)

// countAdapter counts actions into its public state; "phase" flips the
// phase, "finish" ends the game. Optionally its timer is permanently overdue.
type countAdapter struct {
	n        int
	phase    string
	done     bool
	overdue  bool
	timerHit atomic.Int64
}

func (a *countAdapter) Start(string, games.Options) { a.phase = "play" }
func (a *countAdapter) OnPlayerJoin(string)         {}
func (a *countAdapter) OnPlayerLeave(string)        {}
func (a *countAdapter) OnRoomChange()               {}
func (a *countAdapter) OnAction(_ string, p map[string]any) error {
	switch p["action"] {
	case "phase":
		a.phase = "other"
	case "finish":
		a.done = true
	default:
		a.n++
	}
	return nil
}
func (a *countAdapter) OnTimer(string) { a.timerHit.Add(1) }
func (a *countAdapter) NextDeadline() (string, time.Time, bool) {
	if a.overdue {
		return "tick", time.Now().Add(-time.Minute), true
	}
	return "", time.Time{}, false
}
func (a *countAdapter) Shift(time.Duration) {}
func (a *countAdapter) Status() games.Status {
	if a.done {
		return games.StatusFinished
	}
	return games.StatusRunning
}
func (a *countAdapter) Standings() []games.Standing { return []games.Standing{} }
func (a *countAdapter) PublicState() map[string]any {
	return map[string]any{"phase": a.phase, "n": a.n}
}
func (a *countAdapter) PrivateState(string) map[string]any { return map[string]any{"mine": a.n} }

func countHub(adapter *countAdapter) *Hub {
	registry := games.NewRegistry()
	registry.Register(games.Factory{Type: "count", Name: "Count", New: func() games.Adapter { return adapter }})
	return NewHub(registry)
}

// startCount seats host + one guest and starts the count game.
func startCount(t *testing.T, hub *Hub) (*Client, *rooms.Room) {
	t.Helper()
	host := newTestClient(hub, "host")
	create(hub, host, []any{"count"}, "Host", "s-host")
	guest := newTestClient(hub, "guest")
	join(hub, guest, host.RoomID, "Guest", "s-guest")
	room, _ := hub.rooms.Get(host.RoomID)
	room.SetNextGame("count", "Count")
	hub.handleGameStart(host, Envelope{Type: "game.start", Payload: map[string]any{"force": true}})
	if s, _ := hub.session(room.ID); s.adapter == nil {
		t.Fatalf("game did not start: %v", drain(host))
	}
	return host, room
}

// publicStates returns the public game.state broadcasts among msgs.
func publicStates(msgs []Envelope) []map[string]any {
	var out []map[string]any
	for _, m := range msgs {
		if m.Type == "game.state" && m.Payload["public"] != nil {
			out = append(out, m.Payload["public"].(map[string]any))
		}
	}
	return out
}

func TestGameStateBroadcastsAreCoalesced(t *testing.T) {
	adapter := &countAdapter{}
	hub := countHub(adapter)
	host, _ := startCount(t, hub)
	if len(publicStates(drain(host))) != 1 {
		t.Fatalf("game start must broadcast its first state immediately")
	}

	// After a quiet period the first action's broadcast goes out at once...
	time.Sleep(stateCoalesceWindow + 30*time.Millisecond)
	const actions = 50
	act := func(action string) {
		hub.handleGameAction(host, Envelope{Type: "game.action", Payload: map[string]any{"action": action}})
	}
	act("react")
	first := publicStates(drain(host))
	if len(first) != 1 || first[0]["n"] != float64(1) {
		t.Fatalf("first action after a quiet period should broadcast immediately, got %v", first)
	}
	// ...and a burst inside the window collapses into one trailing broadcast.
	for i := 1; i < actions; i++ {
		act("react")
	}
	if got := publicStates(drain(host)); len(got) != 0 {
		t.Fatalf("burst inside the window should not broadcast synchronously, got %d", len(got))
	}
	time.Sleep(3 * stateCoalesceWindow)
	msgs := drain(host)
	trailing := publicStates(msgs)
	if len(trailing) != 1 {
		t.Fatalf("expected exactly one trailing broadcast for the burst, got %d", len(trailing))
	}
	if trailing[0]["n"] != float64(actions) {
		t.Fatalf("trailing broadcast must carry the final state, got n=%v", trailing[0]["n"])
	}
	privates := 0
	for _, m := range msgs {
		if m.Type == "game.state" && m.Payload["private"] != nil {
			privates++
			if m.Payload["private"].(map[string]any)["mine"] != float64(actions) {
				t.Fatalf("trailing private state is stale: %v", m.Payload)
			}
		}
	}
	if privates != 1 {
		t.Fatalf("private hydration should be coalesced too, got %d", privates)
	}

	// A phase change inside the window is not held back.
	act("react")
	drain(host)
	act("phase")
	if got := publicStates(drain(host)); len(got) != 1 || got[0]["phase"] != "other" {
		t.Fatalf("phase change must broadcast immediately, got %v", got)
	}
}

func TestFinishFlushesPendingStateBeforeResult(t *testing.T) {
	adapter := &countAdapter{}
	hub := countHub(adapter)
	host, room := startCount(t, hub)
	drain(host)
	// Inside the window after start: this action's broadcast is pending.
	hub.handleGameAction(host, Envelope{Type: "game.action", Payload: map[string]any{"action": "react"}})
	hub.handleGameAction(host, Envelope{Type: "game.action", Payload: map[string]any{"action": "finish"}})
	msgs := drain(host)
	stateAt, resultAt := -1, -1
	for i, m := range msgs {
		if m.Type == "game.state" && m.Payload["public"] != nil {
			stateAt = i
			if m.Payload["public"].(map[string]any)["n"] != float64(1) {
				t.Fatalf("final state must include every action: %v", m.Payload)
			}
		}
		if m.Type == "session.gameResult" && resultAt < 0 {
			resultAt = i
		}
	}
	if stateAt < 0 || resultAt < 0 || stateAt > resultAt {
		t.Fatalf("want final game.state before session.gameResult, got state@%d result@%d", stateAt, resultAt)
	}
	if room.GetStatus() != rooms.StatusResults {
		t.Fatalf("room should be in results, got %s", room.GetStatus())
	}
	time.Sleep(3 * stateCoalesceWindow)
	if got := publicStates(drain(host)); len(got) != 0 {
		t.Fatalf("no game.state may trail the result, got %v", got)
	}
}

func TestOverdueTimerBacksOff(t *testing.T) {
	adapter := &countAdapter{overdue: true}
	hub := countHub(adapter)
	startCount(t, hub)
	time.Sleep(1500 * time.Millisecond)
	if hits := adapter.timerHit.Load(); hits < 1 || hits > 4 {
		t.Fatalf("an always-overdue timer should fire about once a second, got %d in 1.5s", hits)
	}
}

func TestGameFinishedInsideStartIsFinalised(t *testing.T) {
	adapter := &countAdapter{done: true}
	hub := countHub(adapter)
	host := newTestClient(hub, "host")
	create(hub, host, []any{"count"}, "Host", "s-host")
	guest := newTestClient(hub, "guest")
	join(hub, guest, host.RoomID, "Guest", "s-guest")
	room, _ := hub.rooms.Get(host.RoomID)
	room.SetNextGame("count", "Count")
	hub.handleGameStart(host, Envelope{Type: "game.start", Payload: map[string]any{"force": true}})
	s, _ := hub.session(room.ID)
	if s.adapter != nil {
		t.Fatalf("a game finished inside Start must not stay running")
	}
	if room.GetStatus() != rooms.StatusResults {
		t.Fatalf("room should move to results, got %s", room.GetStatus())
	}
	if _, ok := findMsg(drain(host), "session.gameResult"); !ok {
		t.Fatalf("expected session.gameResult")
	}
}

func TestJoinDuringPauseIsReplayedOnResume(t *testing.T) {
	adapter := &recAdapter{}
	hub := recHub(adapter)
	host, _, _, room := threePlayers(t, hub)
	startRec(t, hub, host, room)
	hub.handleSessionPause(host, Envelope{Type: "session.pause"})
	adapter.calls = nil

	late := newTestClient(hub, "late")
	join(hub, late, room.ID, "Late", "s-late")
	if late.RoomID == "" {
		t.Fatalf("joining a paused game should still seat the player")
	}
	if len(adapter.calls) != 0 {
		t.Fatalf("adapter must not hear joins while paused, got %v", adapter.calls)
	}
	if gs, ok := findMsg(drain(late), "game.state"); !ok || gs.Payload["public"] == nil {
		t.Fatalf("a paused joiner still gets the current game.state")
	}
	// Joined and left within the same pause: the game never hears of them.
	ghost := newTestClient(hub, "ghost")
	join(hub, ghost, room.ID, "Ghost", "s-ghost")
	hub.handleRoomLeave(ghost, Envelope{Type: "room.leave"})
	if len(adapter.calls) != 0 {
		t.Fatalf("adapter must not hear joins/leaves while paused, got %v", adapter.calls)
	}

	hub.handleSessionResume(host, Envelope{Type: "session.resume"})
	want := []string{"shift", "join:" + late.Player.ID}
	if strings.Join(adapter.calls, ",") != strings.Join(want, ",") {
		t.Fatalf("expected %v on resume, got %v", want, adapter.calls)
	}
}

func TestConcurrentJoinsRespectCapacityAndNames(t *testing.T) {
	hub := newSessionTestHub()
	host := newTestClient(hub, "host")
	hub.handleRoomCreate(host, Envelope{Type: "room.create", Payload: map[string]any{
		"name": "Room", "playlist": []any{"stub"}, "displayName": "Host", "sessionId": "s-host", "maxPlayers": 5,
	}})
	room, _ := hub.rooms.Get(host.RoomID)

	var wg sync.WaitGroup
	var joined atomic.Int64
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			c := newTestClient(hub, fmt.Sprintf("c%d", i))
			join(hub, c, room.ID, fmt.Sprintf("P%d", i), fmt.Sprintf("s-%d", i))
			if r, _ := hub.ident(c); r != "" {
				joined.Add(1)
			}
		}(i)
	}
	wg.Wait()
	if room.PlayerCount() != 5 || joined.Load() != 4 {
		t.Fatalf("maxPlayers 5 overfilled: %d players, %d joins accepted", room.PlayerCount(), joined.Load())
	}

	// Same name, many at once: exactly one wins it.
	hub2 := newSessionTestHub()
	host2 := newTestClient(hub2, "host")
	create(hub2, host2, []any{"stub"}, "Host", "s-host")
	room2, _ := hub2.rooms.Get(host2.RoomID)
	joined.Store(0)
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			c := newTestClient(hub2, fmt.Sprintf("d%d", i))
			join(hub2, c, room2.ID, "Same", fmt.Sprintf("s-d%d", i))
			if r, _ := hub2.ident(c); r != "" {
				joined.Add(1)
			}
		}(i)
	}
	wg.Wait()
	if joined.Load() != 1 {
		t.Fatalf("expected exactly one player named Same, got %d", joined.Load())
	}
}

func TestConcurrentAwfulJoinsGetUniqueNames(t *testing.T) {
	registry := games.NewRegistry()
	registry.Register(newStubFactory())
	hub := NewHub(registry)
	first := newTestClient(hub, "first")
	first.IP = "127.0.0.1"
	awfulJoin(hub, first, "s_concurrent", "Ana", "s-first", nil)
	room, _ := hub.rooms.Get(first.RoomID)

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			c := newTestClient(hub, fmt.Sprintf("a%d", i))
			c.IP = "127.0.0.1"
			awfulJoin(hub, c, "s_concurrent", "Ana", fmt.Sprintf("s-a%d", i), nil)
		}(i)
	}
	wg.Wait()
	snapshot := room.Snapshot()
	players := snapshot["players"].([]rooms.Player)
	seen := map[string]bool{}
	for _, p := range players {
		key := strings.ToLower(p.Name)
		if seen[key] {
			t.Fatalf("duplicate name %q after concurrent awful joins", p.Name)
		}
		seen[key] = true
	}
	if len(players) != 11 {
		t.Fatalf("expected 11 seated players, got %d", len(players))
	}
}

func TestClampMaxPlayers(t *testing.T) {
	cases := map[int]int{-3: 16, 0: 16, 1: 2, 2: 2, 8: 8, 16: 16, 40: 16}
	for in, want := range cases {
		if got := clampMaxPlayers(in); got != want {
			t.Fatalf("clampMaxPlayers(%d) = %d, want %d", in, got, want)
		}
	}
}
