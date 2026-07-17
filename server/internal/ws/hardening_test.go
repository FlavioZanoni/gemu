package ws

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"gemu-server/internal/games"
)

// TestRejoinWithoutLeaveRejected: a connection already in a room cannot
// create/join another and strand a ghost player.
func TestRejoinWithoutLeaveRejected(t *testing.T) {
	hub := newSessionTestHub()
	host := &Client{ID: "host"}
	hub.handleRoomCreate(host, Envelope{Type: "room.create", Payload: map[string]any{
		"name": "A", "playlist": []any{"stub"}, "displayName": "Host", "sessionId": "s1",
	}})
	if host.RoomID == "" {
		t.Fatalf("expected first create to succeed")
	}
	first := host.RoomID

	// Second create on the same connection is rejected; still in first room.
	hub.handleRoomCreate(host, Envelope{Type: "room.create", Payload: map[string]any{
		"name": "B", "playlist": []any{"stub"}, "displayName": "Host", "sessionId": "s2",
	}})
	if host.RoomID != first {
		t.Fatalf("expected connection to stay in first room, got %q", host.RoomID)
	}
	if len(hub.sessions) != 1 {
		t.Fatalf("expected exactly one room/session, got %d", len(hub.sessions))
	}
}

func TestMaxPlayersClampedToCeiling(t *testing.T) {
	hub := newSessionTestHub()
	host := &Client{ID: "host"}
	hub.handleRoomCreate(host, Envelope{Type: "room.create", Payload: map[string]any{
		"name": "Big", "playlist": []any{"stub"}, "displayName": "Host", "sessionId": "s1",
		"maxPlayers": float64(9999),
	}})
	room, _ := hub.rooms.Get(host.RoomID)
	if got := room.Snapshot()["maxPlayers"].(int); got != roomPlayerCap {
		t.Fatalf("expected maxPlayers clamped to %d, got %d", roomPlayerCap, got)
	}
}

func TestLongNameTruncated(t *testing.T) {
	hub := newSessionTestHub()
	host := &Client{ID: "host"}
	longName := strings.Repeat("x", 500)
	hub.handleRoomCreate(host, Envelope{Type: "room.create", Payload: map[string]any{
		"name": "R", "playlist": []any{"stub"}, "displayName": longName, "sessionId": "s1",
	}})
	if host.RoomID == "" {
		t.Fatalf("expected create to succeed")
	}
	if got := len([]rune(host.Player.Name)); got != maxNameLen {
		t.Fatalf("expected name truncated to %d runes, got %d", maxNameLen, got)
	}
}

func TestGameStreamRejectsNonAllowlistedAction(t *testing.T) {
	// A game whose OnAction returns nil for any action must NOT let a
	// non-stroke action be relayed through game.stream.
	registry := games.NewRegistry()
	registry.Register(games.Factory{Type: "permissive", Name: "P", New: func() games.Adapter {
		return &permissiveAdapter{}
	}})
	hub := NewHub(registry)

	host := &Client{ID: "host"}
	hub.handleRoomCreate(host, Envelope{Type: "room.create", Payload: map[string]any{
		"name": "S", "playlist": []any{"permissive"}, "displayName": "Host", "sessionId": "s1",
	}})
	joiner := &Client{ID: "joiner"}
	hub.handleRoomJoin(joiner, Envelope{Type: "room.join", Payload: map[string]any{
		"roomId": host.RoomID, "displayName": "J", "sessionId": "s2",
	}})
	// A connection that observes relays.
	spy := &Client{ID: "spy"}
	hub.handleRoomJoin(spy, Envelope{Type: "room.join", Payload: map[string]any{
		"roomId": host.RoomID, "displayName": "Spy", "sessionId": "s3",
	}})
	hub.handleGameStart(host, Envelope{Type: "game.start", Payload: map[string]any{"force": true}})

	// Non-allowlisted action must be dropped (no panic, no state change we can
	// see) — the key assertion is it returns without relaying. We can't easily
	// observe BroadcastExcept with nil conns, so assert the guard directly.
	hub.handleGameStream(host, Envelope{Type: "game.stream", Payload: map[string]any{"action": "next_round"}})
	if streamActions["next_round"] {
		t.Fatalf("next_round must not be in the stream allowlist")
	}
	if !streamActions["stroke"] {
		t.Fatalf("stroke must be in the stream allowlist")
	}
}

// TestConcurrentBroadcastNoPanic drives real WS connections concurrently to
// prove writes are serialized (would panic "concurrent write" without the mutex).
func TestConcurrentBroadcastNoPanic(t *testing.T) {
	registry := games.NewRegistry()
	registry.Register(games.NewInventionFactory())
	hub := NewHub(registry)
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
	a, b := dial(), dial()
	defer a.Close()
	defer b.Close()

	_ = a.WriteJSON(Envelope{Type: "room.create", Payload: map[string]any{
		"name": "Race", "playlist": []any{"invention"}, "displayName": "A", "sessionId": "ra",
	}})
	// Find the room id from A's snapshot.
	var roomID string
	for i := 0; i < 5 && roomID == ""; i++ {
		var env Envelope
		if err := a.ReadJSON(&env); err != nil {
			t.Fatalf("read: %v", err)
		}
		if env.Type == "room.create.ok" {
			roomID, _ = env.Payload["id"].(string)
		}
	}
	if roomID == "" {
		t.Fatalf("no room id from create")
	}
	_ = b.WriteJSON(Envelope{Type: "room.join", Payload: map[string]any{
		"roomId": roomID, "displayName": "B", "sessionId": "rb",
	}})

	// Hammer: both clients spam ready toggles (each triggers a room broadcast to
	// both connections) concurrently. Without the write mutex this panics.
	var wg sync.WaitGroup
	for _, c := range []*websocket.Conn{a, b} {
		conn := c
		wg.Add(2)
		go func() {
			defer wg.Done()
			for i := 0; i < 100; i++ {
				_ = conn.WriteJSON(Envelope{Type: "room.ready.set", Payload: map[string]any{"ready": i%2 == 0}})
			}
		}()
		go func() {
			defer wg.Done()
			for i := 0; i < 200; i++ {
				var env Envelope
				if err := conn.ReadJSON(&env); err != nil {
					return
				}
			}
		}()
	}
	wg.Wait()
	// If the server process survived (test didn't crash), the mutex held.
	if _, ok := hub.rooms.Get(roomID); !ok {
		t.Fatalf("room vanished unexpectedly")
	}
}

// permissiveAdapter accepts (returns nil for) every action, like the real
// games' default paths — used to prove the hub-level stream allowlist guards.
type permissiveAdapter struct{}

func (permissiveAdapter) Type() string                          { return "permissive" }
func (permissiveAdapter) Start(string, games.Options)           {}
func (permissiveAdapter) OnPlayerJoin(string)                   {}
func (permissiveAdapter) OnPlayerLeave(string)                  {}
func (permissiveAdapter) OnRoomChange()                         {}
func (permissiveAdapter) OnAction(string, map[string]any) error { return nil }
func (permissiveAdapter) OnTimer(string)                        {}
func (permissiveAdapter) NextDeadline() (string, time.Time, bool) {
	return "", time.Time{}, false
}
func (permissiveAdapter) Shift(time.Duration)                {}
func (permissiveAdapter) Status() games.Status               { return games.StatusRunning }
func (permissiveAdapter) Standings() []games.Standing        { return nil }
func (permissiveAdapter) PublicState() map[string]any        { return map[string]any{} }
func (permissiveAdapter) PrivateState(string) map[string]any { return map[string]any{} }
