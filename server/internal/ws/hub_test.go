package ws

import (
	"strings"
	"testing"

	"gemu-server/internal/games"
	"gemu-server/internal/rooms"
)

func newTestHub() *Hub {
	registry := games.NewRegistry()
	registry.Register(games.NewInventionFactory())
	return NewHub(registry)
}

func TestRoomCreateDefaultsVisibilityAndJoinCode(t *testing.T) {
	hub := newTestHub()
	client := &Client{ID: "client-1"}

	env := Envelope{
		Type:      "room.create",
		RequestID: "req-1",
		Payload: map[string]any{
			"name":        "Test Room",
			"gameType":    "invention",
			"displayName": "Host",
			"sessionId":   "sess-1",
		},
	}

	hub.handleRoomCreate(client, env)

	if client.RoomID == "" {
		t.Fatalf("expected client to join created room")
	}

	room, ok := hub.rooms.Get(client.RoomID)
	if !ok {
		t.Fatalf("expected room to be created")
	}

	if room.Visibility != rooms.Public {
		t.Fatalf("expected default visibility to be public, got %s", room.Visibility)
	}

	if room.JoinCode != "" {
		t.Fatalf("expected no join code for public room")
	}

	if _, ok := hub.sessions[client.RoomID]; !ok {
		t.Fatalf("expected game initialized for room")
	}
}

func TestGameStartRequiresAdmin(t *testing.T) {
	hub := newTestHub()
	host := &Client{ID: "host"}

	createEnv := Envelope{
		Type: "room.create",
		Payload: map[string]any{
			"name":        "Game",
			"gameType":    "invention",
			"displayName": "Host",
			"sessionId":   "sess-host",
		},
	}
	hub.handleRoomCreate(host, createEnv)

	joiner := &Client{ID: "joiner"}
	joinEnv := Envelope{
		Type: "room.join",
		Payload: map[string]any{
			"roomId":      host.RoomID,
			"displayName": "Joiner",
			"sessionId":   "sess-joiner",
		},
	}
	hub.handleRoomJoin(joiner, joinEnv)

	hub.handleGameStart(joiner, Envelope{Type: "game.start"})

	session, ok := hub.sessions[host.RoomID]
	if !ok {
		t.Fatalf("expected session initialized")
	}
	if session.adapter != nil {
		t.Fatalf("expected no adapter to start for non-admin start")
	}
}

func TestGameActionUpdatesState(t *testing.T) {
	hub := newTestHub()
	host := &Client{ID: "host"}

	createEnv := Envelope{
		Type: "room.create",
		Payload: map[string]any{
			"name":        "Game",
			"gameType":    "invention",
			"displayName": "Host",
			"sessionId":   "sess-host",
		},
	}
	hub.handleRoomCreate(host, createEnv)

	joiner := &Client{ID: "joiner"}
	joinEnv := Envelope{
		Type: "room.join",
		Payload: map[string]any{
			"roomId":      host.RoomID,
			"displayName": "Joiner",
			"sessionId":   "sess-joiner",
		},
	}
	hub.handleRoomJoin(joiner, joinEnv)

	hub.handleGameStart(host, Envelope{Type: "game.start", Payload: map[string]any{"force": true}})

	hub.handleGameAction(host, Envelope{
		Type: "game.action",
		Payload: map[string]any{
			"problem": "Need a faster kettle.",
		},
	})

	session, ok := hub.sessions[host.RoomID]
	if !ok || session.adapter == nil {
		t.Fatalf("expected game initialized")
	}
	submitted, ok := session.adapter.PublicState()["problemsSubmitted"].(int)
	if !ok || submitted != 1 {
		t.Fatalf("expected one problem submitted")
	}
}

func TestRoomCreatePrivateAssignsJoinCode(t *testing.T) {
	hub := newTestHub()
	client := &Client{ID: "client-1"}

	env := Envelope{
		Type:      "room.create",
		RequestID: "req-1",
		Payload: map[string]any{
			"name":        "Private Room",
			"gameType":    "invention",
			"displayName": "Host",
			"visibility":  "private",
			"sessionId":   "sess-1",
		},
	}

	hub.handleRoomCreate(client, env)

	room, ok := hub.rooms.Get(client.RoomID)
	if !ok {
		t.Fatalf("expected room to be created")
	}

	if room.Visibility != rooms.Private {
		t.Fatalf("expected private visibility, got %s", room.Visibility)
	}

	if room.JoinCode == "" {
		t.Fatalf("expected join code for private room")
	}

	if _, ok := hub.sessions[client.RoomID]; !ok {
		t.Fatalf("expected game initialized for room")
	}
}

func TestRoomLeaveRemovesRoomWhenEmpty(t *testing.T) {
	hub := newTestHub()
	client := &Client{ID: "client-1"}

	createEnv := Envelope{
		Type: "room.create",
		Payload: map[string]any{
			"name":        "Empty Room",
			"gameType":    "invention",
			"displayName": "Host",
			"sessionId":   "sess-1",
		},
	}

	hub.handleRoomCreate(client, createEnv)
	roomID := client.RoomID
	if roomID == "" {
		t.Fatalf("expected room id after creation")
	}

	hub.handleRoomLeave(client, Envelope{Type: "room.leave"})

	if _, ok := hub.rooms.Get(roomID); ok {
		t.Fatalf("expected room to be removed when empty")
	}

	if _, ok := hub.sessions[roomID]; ok {
		t.Fatalf("expected game to be removed when empty")
	}
}

func TestRoomCreateInvalidVisibility(t *testing.T) {
	hub := newTestHub()
	client := &Client{ID: "client-1"}

	env := Envelope{
		Type: "room.create",
		Payload: map[string]any{
			"name":        "Bad Room",
			"gameType":    "invention",
			"displayName": "Host",
			"visibility":  "secret",
			"sessionId":   "sess-1",
		},
	}

	hub.handleRoomCreate(client, env)
	if client.RoomID != "" {
		t.Fatalf("expected room not to be created with invalid visibility")
	}

	if len(hub.sessions) != 0 {
		t.Fatalf("expected no game initialized on invalid room create")
	}
}

func TestRoomJoinRejectsInvalidCode(t *testing.T) {
	hub := newTestHub()
	host := &Client{ID: "host"}

	createEnv := Envelope{
		Type: "room.create",
		Payload: map[string]any{
			"name":        "Private",
			"gameType":    "invention",
			"displayName": "Host",
			"visibility":  "private",
			"sessionId":   "sess-host",
		},
	}
	hub.handleRoomCreate(host, createEnv)
	roomID := host.RoomID

	joiner := &Client{ID: "joiner"}
	joinEnv := Envelope{
		Type: "room.join",
		Payload: map[string]any{
			"roomId":      roomID,
			"displayName": "Joiner",
			"joinCode":    "wrong",
			"sessionId":   "sess-joiner",
		},
	}
	hub.handleRoomJoin(joiner, joinEnv)

	if joiner.RoomID != "" {
		t.Fatalf("expected joiner not to join with invalid code")
	}

	if _, ok := hub.sessions[roomID]; !ok {
		t.Fatalf("expected game initialized for room")
	}
}

func TestRoomJoinCaseInsensitiveCode(t *testing.T) {
	hub := newTestHub()
	host := &Client{ID: "host"}

	createEnv := Envelope{
		Type: "room.create",
		Payload: map[string]any{
			"name":        "Private",
			"gameType":    "invention",
			"displayName": "Host",
			"visibility":  "private",
			"sessionId":   "sess-host",
		},
	}
	hub.handleRoomCreate(host, createEnv)
	room, ok := hub.rooms.Get(host.RoomID)
	if !ok {
		t.Fatalf("expected room to exist")
	}

	joiner := &Client{ID: "joiner"}
	joinEnv := Envelope{
		Type: "room.join",
		Payload: map[string]any{
			"roomId":      room.ID,
			"displayName": "Joiner",
			"joinCode":    strings.ToLower(room.JoinCode),
			"sessionId":   "sess-joiner",
		},
	}
	hub.handleRoomJoin(joiner, joinEnv)
	if joiner.RoomID == "" {
		t.Fatalf("expected joiner to join with lowercase join code")
	}

	if _, ok := hub.sessions[room.ID]; !ok {
		t.Fatalf("expected game initialized for room")
	}
}

func TestRoomJoinRespectsMaxPlayers(t *testing.T) {
	hub := newTestHub()
	host := &Client{ID: "host"}

	createEnv := Envelope{
		Type: "room.create",
		Payload: map[string]any{
			"name":        "Limit",
			"gameType":    "invention",
			"displayName": "Host",
			"maxPlayers":  1,
			"sessionId":   "sess-host",
		},
	}
	hub.handleRoomCreate(host, createEnv)

	joiner := &Client{ID: "joiner"}
	joinEnv := Envelope{
		Type: "room.join",
		Payload: map[string]any{
			"roomId":      host.RoomID,
			"displayName": "Joiner",
			"sessionId":   "sess-joiner",
		},
	}
	hub.handleRoomJoin(joiner, joinEnv)

	if joiner.RoomID != "" {
		t.Fatalf("expected joiner to be rejected when room is full")
	}

	if _, ok := hub.sessions[host.RoomID]; !ok {
		t.Fatalf("expected game initialized for room")
	}
}

func TestRoomKickRequiresAdmin(t *testing.T) {
	hub := newTestHub()
	host := &Client{ID: "host"}

	createEnv := Envelope{
		Type: "room.create",
		Payload: map[string]any{
			"name":        "Kick",
			"gameType":    "invention",
			"displayName": "Host",
			"sessionId":   "sess-host",
		},
	}
	hub.handleRoomCreate(host, createEnv)

	joiner := &Client{ID: "joiner"}
	joinEnv := Envelope{
		Type: "room.join",
		Payload: map[string]any{
			"roomId":      host.RoomID,
			"displayName": "Joiner",
			"sessionId":   "sess-joiner",
		},
	}
	hub.handleRoomJoin(joiner, joinEnv)

	hub.mu.Lock()
	hub.clients[host.ID] = host
	hub.clients[joiner.ID] = joiner
	hub.mu.Unlock()

	kickEnv := Envelope{
		Type: "room.kick",
		Payload: map[string]any{
			"playerId": host.Player.ID,
		},
	}
	hub.handleRoomKick(joiner, kickEnv)

	room, ok := hub.rooms.Get(host.RoomID)
	if !ok {
		t.Fatalf("expected room to exist")
	}
	if _, ok := room.Players[host.Player.ID]; !ok {
		t.Fatalf("expected non-admin kick to be rejected")
	}

	if _, ok := hub.sessions[host.RoomID]; !ok {
		t.Fatalf("expected game initialized for room")
	}
}

func TestRoomKickRemovesPlayerAndClearsClient(t *testing.T) {
	hub := newTestHub()
	host := &Client{ID: "host"}

	createEnv := Envelope{
		Type: "room.create",
		Payload: map[string]any{
			"name":        "Kick",
			"gameType":    "invention",
			"displayName": "Host",
			"sessionId":   "sess-host",
		},
	}
	hub.handleRoomCreate(host, createEnv)

	joiner := &Client{ID: "joiner"}
	joinEnv := Envelope{
		Type: "room.join",
		Payload: map[string]any{
			"roomId":      host.RoomID,
			"displayName": "Joiner",
			"sessionId":   "sess-joiner",
		},
	}
	hub.handleRoomJoin(joiner, joinEnv)

	hub.mu.Lock()
	hub.clients[host.ID] = host
	hub.clients[joiner.ID] = joiner
	hub.mu.Unlock()

	kickEnv := Envelope{
		Type: "room.kick",
		Payload: map[string]any{
			"playerId": joiner.Player.ID,
		},
	}
	hub.handleRoomKick(host, kickEnv)

	if joiner.RoomID != "" {
		t.Fatalf("expected kicked client room to be cleared")
	}
	if joiner.Player.ID != "" {
		t.Fatalf("expected kicked client player to be cleared")
	}

	if _, ok := hub.sessions[host.RoomID]; !ok {
		t.Fatalf("expected game to remain while room has players")
	}
}

func TestRemoveClientMarksPlayerDisconnected(t *testing.T) {
	hub := newTestHub()
	host := &Client{ID: "host"}

	createEnv := Envelope{
		Type: "room.create",
		Payload: map[string]any{
			"name":        "Disconnect",
			"gameType":    "invention",
			"displayName": "Host",
			"sessionId":   "sess-host",
		},
	}
	hub.handleRoomCreate(host, createEnv)

	hub.mu.Lock()
	hub.clients[host.ID] = host
	hub.mu.Unlock()

	roomID := host.RoomID
	hub.RemoveClient(host.ID)

	room, ok := hub.rooms.Get(roomID)
	if !ok {
		t.Fatalf("expected room to remain after disconnect")
	}
	if player, ok := room.Players[host.Player.ID]; !ok || player.Connected {
		t.Fatalf("expected player to be marked disconnected")
	}
}

func TestAdminChainPromotesNextPlayer(t *testing.T) {
	hub := newTestHub()
	host := &Client{ID: "host"}

	createEnv := Envelope{
		Type: "room.create",
		Payload: map[string]any{
			"name":        "Admin",
			"gameType":    "invention",
			"displayName": "Host",
			"sessionId":   "sess-host",
		},
	}
	hub.handleRoomCreate(host, createEnv)

	joiner := &Client{ID: "joiner"}
	joinEnv := Envelope{
		Type: "room.join",
		Payload: map[string]any{
			"roomId":      host.RoomID,
			"displayName": "Joiner",
			"sessionId":   "sess-joiner",
		},
	}
	hub.handleRoomJoin(joiner, joinEnv)

	room, ok := hub.rooms.Get(host.RoomID)
	if !ok {
		t.Fatalf("expected room to exist")
	}
	if room.AdminID() != host.Player.ID {
		t.Fatalf("expected host to be admin")
	}

	hub.handleRoomLeave(host, Envelope{Type: "room.leave"})

	room, ok = hub.rooms.Get(room.ID)
	if !ok {
		t.Fatalf("expected room to still exist")
	}
	if room.AdminID() != joiner.Player.ID {
		t.Fatalf("expected joiner to be promoted to admin")
	}

	if _, ok := hub.sessions[room.ID]; !ok {
		t.Fatalf("expected game initialized for room")
	}
}

func TestLobbyRoomsListReturnsOnlyPublic(t *testing.T) {
	hub := newTestHub()

	publicClient := &Client{ID: "public"}
	hub.handleRoomCreate(publicClient, Envelope{
		Type: "room.create",
		Payload: map[string]any{
			"name":        "Public",
			"gameType":    "invention",
			"displayName": "Host",
			"visibility":  "public",
			"sessionId":   "sess-public",
		},
	})

	privateClient := &Client{ID: "private"}
	hub.handleRoomCreate(privateClient, Envelope{
		Type: "room.create",
		Payload: map[string]any{
			"name":        "Private",
			"gameType":    "invention",
			"displayName": "Host",
			"visibility":  "private",
			"sessionId":   "sess-private",
		},
	})

	roomsList := hub.rooms.ListPublic()
	if len(roomsList) != 1 {
		t.Fatalf("expected only one public room, got %d", len(roomsList))
	}
	if roomsList[0]["name"].(string) != "Public" {
		t.Fatalf("expected public room to be listed")
	}

	if _, ok := hub.sessions[publicClient.RoomID]; !ok {
		t.Fatalf("expected game initialized for public room")
	}
}

func TestRoomCreateRequiresSessionID(t *testing.T) {
	hub := newTestHub()
	client := &Client{ID: "client-1"}

	env := Envelope{
		Type: "room.create",
		Payload: map[string]any{
			"name":        "Test Room",
			"gameType":    "invention",
			"displayName": "Host",
		},
	}

	hub.handleRoomCreate(client, env)
	if client.RoomID != "" {
		t.Fatalf("expected room not to be created without session id")
	}
}

func TestRoomJoinRequiresSessionID(t *testing.T) {
	hub := newTestHub()
	host := &Client{ID: "host"}
	hub.handleRoomCreate(host, Envelope{
		Type: "room.create",
		Payload: map[string]any{
			"name":        "Test Room",
			"gameType":    "invention",
			"displayName": "Host",
			"sessionId":   "sess-host",
		},
	})

	joiner := &Client{ID: "joiner"}
	hub.handleRoomJoin(joiner, Envelope{
		Type: "room.join",
		Payload: map[string]any{
			"roomId":      host.RoomID,
			"displayName": "Joiner",
		},
	})

	if joiner.RoomID != "" {
		t.Fatalf("expected join to be rejected without session id")
	}
}

func TestRoomJoinReusesSessionPlayer(t *testing.T) {
	hub := newTestHub()
	host := &Client{ID: "host"}
	hub.handleRoomCreate(host, Envelope{
		Type: "room.create",
		Payload: map[string]any{
			"name":        "Rejoin Room",
			"gameType":    "invention",
			"displayName": "Host",
			"sessionId":   "sess-host",
		},
	})

	joiner := &Client{ID: "joiner"}
	hub.handleRoomJoin(joiner, Envelope{
		Type: "room.join",
		Payload: map[string]any{
			"roomId":      host.RoomID,
			"displayName": "Joiner",
			"sessionId":   "sess-joiner",
		},
	})

	hub.mu.Lock()
	hub.clients[joiner.ID] = joiner
	hub.mu.Unlock()
	hub.RemoveClient(joiner.ID)

	rejoin := &Client{ID: "joiner-2"}
	hub.handleRoomJoin(rejoin, Envelope{
		Type: "room.join",
		Payload: map[string]any{
			"roomId":      host.RoomID,
			"displayName": "Joiner",
			"sessionId":   "sess-joiner",
		},
	})

	if rejoin.Player.ID != joiner.Player.ID {
		t.Fatalf("expected rejoin to reuse same player id")
	}
	room, ok := hub.rooms.Get(host.RoomID)
	if !ok {
		t.Fatalf("expected room to exist")
	}
	if player, ok := room.Players[rejoin.Player.ID]; !ok || !player.Connected {
		t.Fatalf("expected player to be connected after rejoin")
	}
}

func TestRoomJoinRejectsSessionAlreadyInOtherRoom(t *testing.T) {
	hub := newTestHub()
	hostA := &Client{ID: "host-a"}
	hub.handleRoomCreate(hostA, Envelope{
		Type: "room.create",
		Payload: map[string]any{
			"name":        "Room A",
			"gameType":    "invention",
			"displayName": "HostA",
			"sessionId":   "sess-same",
		},
	})

	// hostA is a LIVE connection holding sess-same.
	hub.mu.Lock()
	hub.clients[hostA.ID] = hostA
	hub.mu.Unlock()

	hostB := &Client{ID: "host-b"}
	hub.handleRoomCreate(hostB, Envelope{
		Type: "room.create",
		Payload: map[string]any{
			"name":        "Room B",
			"gameType":    "invention",
			"displayName": "HostB",
			"sessionId":   "sess-host-b",
		},
	})

	joiner := &Client{ID: "joiner"}
	hub.handleRoomJoin(joiner, Envelope{
		Type: "room.join",
		Payload: map[string]any{
			"roomId":      hostB.RoomID,
			"displayName": "Joiner",
			"sessionId":   "sess-same",
		},
	})

	// A session actively held by a live connection is still rejected from a
	// second room (stale sessions, by contrast, are evicted — see hardening_test).
	if joiner.RoomID != "" {
		t.Fatalf("expected join rejected when session is live in another room")
	}
}

func TestRoomReadySetUpdatesPlayer(t *testing.T) {
	hub := newTestHub()
	host := &Client{ID: "host"}
	hub.handleRoomCreate(host, Envelope{
		Type: "room.create",
		Payload: map[string]any{
			"name":        "Ready",
			"gameType":    "invention",
			"displayName": "Host",
			"sessionId":   "sess-host",
		},
	})

	hub.handleRoomReadySet(host, Envelope{
		Type: "room.ready.set",
		Payload: map[string]any{
			"ready": true,
		},
	})

	room, ok := hub.rooms.Get(host.RoomID)
	if !ok {
		t.Fatalf("expected room to exist")
	}
	if player, ok := room.Players[host.Player.ID]; !ok || !player.Ready {
		t.Fatalf("expected player ready to be true")
	}
}

func TestGameStartRequiresReadyUnlessForced(t *testing.T) {
	hub := newTestHub()
	host := &Client{ID: "host"}
	hub.handleRoomCreate(host, Envelope{
		Type: "room.create",
		Payload: map[string]any{
			"name":        "Start",
			"gameType":    "invention",
			"displayName": "Host",
			"sessionId":   "sess-host",
		},
	})

	joiner := &Client{ID: "joiner"}
	hub.handleRoomJoin(joiner, Envelope{
		Type: "room.join",
		Payload: map[string]any{
			"roomId":      host.RoomID,
			"displayName": "Joiner",
			"sessionId":   "sess-joiner",
		},
	})

	hub.handleGameStart(host, Envelope{Type: "game.start"})
	session, ok := hub.sessions[host.RoomID]
	if !ok {
		t.Fatalf("expected session initialized")
	}
	if session.adapter != nil {
		t.Fatalf("expected no adapter to start when not ready")
	}

	hub.handleGameStart(host, Envelope{Type: "game.start", Payload: map[string]any{"force": true}})
	if session.adapter == nil {
		t.Fatalf("expected game to start when forced")
	}

	room, ok := hub.rooms.Get(host.RoomID)
	if !ok {
		t.Fatalf("expected room to exist")
	}
	if room.GetStatus() != rooms.StatusPlaying {
		t.Fatalf("expected room status playing, got %s", room.GetStatus())
	}
	if session.adapter.PublicState()["phase"] != "collecting" {
		t.Fatalf("expected game to start in collecting phase")
	}
}
