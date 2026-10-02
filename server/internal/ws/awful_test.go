package ws

import (
	"testing"

	"gemu-server/internal/games"
	"gemu-server/internal/rooms"
)

func awfulJoin(hub *Hub, client *Client, awfulSession, name, sessionID string, extra map[string]any) {
	payload := map[string]any{
		"awfulSession": awfulSession,
		"displayName":  name,
		"sessionId":    sessionID,
	}
	for k, v := range extra {
		payload[k] = v
	}
	hub.handleRoomJoin(client, Envelope{Type: "room.join", Payload: payload})
}

func TestAwfulSessionSharesOneRoom(t *testing.T) {
	registry := games.NewRegistry()
	registry.Register(games.NewStopFactory())
	registry.Register(games.NewGarticFactory())
	hub := NewHub(registry)

	ana := &Client{ID: "ana", IP: "127.0.0.1"}
	awfulJoin(hub, ana, "s_4f9c2a7e1b8dQx0m", "Ana", "sess-ana", map[string]any{"locale": "pt-BR"})
	if ana.RoomID == "" {
		t.Fatalf("first opener should create and join the room")
	}
	room, _ := hub.rooms.Get(ana.RoomID)
	if room.Visibility != rooms.Private {
		t.Fatalf("awful rooms must not be listed publicly, got %s", room.Visibility)
	}
	if room.Locale != "pt-BR" {
		t.Fatalf("locale from the host should seed the room, got %q", room.Locale)
	}
	if got := room.Playlist; len(got) != 2 || got[0] != "stop" || got[1] != "gartic" {
		t.Fatalf("default playlist should be every game in registration order, got %v", got)
	}
	if _, ok := hub.sessions[room.ID]; !ok {
		t.Fatalf("expected a game session for the awful room")
	}

	// Same card, second person with the same name: same room, suffixed name,
	// no join code or password needed.
	other := &Client{ID: "other", IP: "127.0.0.1"}
	awfulJoin(hub, other, "s_4f9c2a7e1b8dQx0m", "Ana", "sess-other", nil)
	if other.RoomID != ana.RoomID {
		t.Fatalf("same awful session must land in the same room")
	}
	if other.Player.Name != "Ana 2" {
		t.Fatalf("duplicate host names should be suffixed, got %q", other.Player.Name)
	}
	if room.AdminID() != ana.Player.ID {
		t.Fatalf("first opener should be the host")
	}

	// A new card is a new session: a different room.
	bo := &Client{ID: "bo", IP: "127.0.0.1"}
	awfulJoin(hub, bo, "s_different", "Bo", "sess-bo", nil)
	if bo.RoomID == "" || bo.RoomID == ana.RoomID {
		t.Fatalf("a different awful session must get its own room")
	}

	// Reconnect with the same gemu session id is a rejoin, not a new seat.
	hub.RemoveClient(ana.ID)
	again := &Client{ID: "ana-again", IP: "127.0.0.1"}
	awfulJoin(hub, again, "s_4f9c2a7e1b8dQx0m", "Ana", "sess-ana", nil)
	if again.RoomID != ana.RoomID || again.Player.ID != ana.Player.ID {
		t.Fatalf("rejoin should restore the same player in the same room")
	}
	if room.PlayerCount() != 2 {
		t.Fatalf("expected 2 players after rejoin, got %d", room.PlayerCount())
	}
}

func TestAwfulSessionHonoursPlaylistAndRejectsJunk(t *testing.T) {
	registry := games.NewRegistry()
	registry.Register(games.NewStopFactory())
	registry.Register(games.NewGarticFactory())
	hub := NewHub(registry)

	c := &Client{ID: "c", IP: "127.0.0.1"}
	awfulJoin(hub, c, "s_playlist", "Cy", "sess-c", map[string]any{"playlist": []any{"gartic", "nope", "gartic"}})
	room, ok := hub.rooms.Get(c.RoomID)
	if !ok {
		t.Fatalf("expected a room")
	}
	if len(room.Playlist) != 1 || room.Playlist[0] != "gartic" {
		t.Fatalf("playlist should keep only known, unique games, got %v", room.Playlist)
	}

	long := make([]byte, maxExternalKeyLen+1)
	for i := range long {
		long[i] = 'x'
	}
	d := &Client{ID: "d", IP: "127.0.0.1"}
	awfulJoin(hub, d, string(long), "Di", "sess-d", nil)
	if d.RoomID != "" {
		t.Fatalf("an oversized session id must be refused")
	}
}

func TestAwfulRoomSurvivesPersistence(t *testing.T) {
	room := &rooms.Room{ID: "r1", Name: "x", ExternalKey: "abc", Players: map[string]rooms.Player{}}
	b, err := room.MarshalState()
	if err != nil {
		t.Fatal(err)
	}
	back, err := rooms.RoomFromState(b)
	if err != nil {
		t.Fatal(err)
	}
	if back.ExternalKey != "abc" {
		t.Fatalf("external key lost across persistence")
	}
}

func TestAwfulJoinByCodeFallsBackToSessionRoom(t *testing.T) {
	hub := newTestHub()
	host := &Client{ID: "host", IP: "127.0.0.1"}
	hub.handleRoomCreate(host, Envelope{Type: "room.create", Payload: map[string]any{
		"name": "Week-long", "gameType": "invention", "displayName": "Ana",
		"sessionId": "sess-host", "visibility": "private",
	}})
	room, _ := hub.rooms.Get(host.RoomID)

	// /app <url> CODE: an existing room, joined by code from inside awful;
	// the clashing name is suffixed rather than refused.
	ana := &Client{ID: "ana", IP: "127.0.0.1"}
	awfulJoin(hub, ana, "s_card", "Ana", "sess-ana", map[string]any{"joinCode": room.JoinCode})
	if ana.RoomID != room.ID || ana.Player.Name != "Ana 2" {
		t.Fatalf("expected to join the coded room as Ana 2, got room %q name %q", ana.RoomID, ana.Player.Name)
	}

	// A member reconnecting to a private room by id needs no code.
	hub.RemoveClient(ana.ID)
	back := &Client{ID: "back", IP: "127.0.0.1"}
	hub.handleRoomJoin(back, Envelope{Type: "room.join", Payload: map[string]any{
		"roomId": room.ID, "displayName": "Ana 2", "sessionId": "sess-ana",
	}})
	if back.RoomID != room.ID {
		t.Fatalf("member rejoin of a private room should not need the code")
	}

	// A stale code falls back to the card's own room.
	bo := &Client{ID: "bo", IP: "127.0.0.1"}
	awfulJoin(hub, bo, "s_card2", "Bo", "sess-bo", map[string]any{"joinCode": "ZZZZZZ"})
	if bo.RoomID == "" || bo.RoomID == room.ID {
		t.Fatalf("unknown code should fall back to the awful session room")
	}
}
