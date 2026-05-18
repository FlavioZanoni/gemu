package rooms

import "testing"

func TestManagerCreateAndGet(t *testing.T) {
	manager := NewManager()
	room := &Room{ID: "room-1", Players: make(map[string]Player)}
	manager.Create(room)

	got, ok := manager.Get("room-1")
	if !ok || got.ID != "room-1" {
		t.Fatalf("expected room to be retrievable")
	}
}

func TestManagerAddPlayerRespectsMaxPlayers(t *testing.T) {
	manager := NewManager()
	room := &Room{ID: "room-1", MaxPlayers: 1, Players: make(map[string]Player)}
	manager.Create(room)

	if _, err := manager.AddPlayer("room-1", Player{ID: "p1"}); err != nil {
		t.Fatalf("expected first player to join")
	}
	if _, err := manager.AddPlayer("room-1", Player{ID: "p2"}); err == nil {
		t.Fatalf("expected room full error")
	}
}

func TestManagerRemovePlayer(t *testing.T) {
	manager := NewManager()
	room := &Room{ID: "room-1", Players: make(map[string]Player)}
	manager.Create(room)
	manager.AddPlayer("room-1", Player{ID: "p1"})

	if _, err := manager.RemovePlayer("room-1", "p1"); err != nil {
		t.Fatalf("expected remove to succeed")
	}
	if len(room.Players) != 0 {
		t.Fatalf("expected player removed")
	}
}

func TestManagerFindPlayerBySession(t *testing.T) {
	manager := NewManager()
	room := &Room{ID: "room-1", Players: make(map[string]Player)}
	manager.Create(room)
	manager.AddPlayer("room-1", Player{ID: "p1", SessionID: "sess-1"})

	roomID, player, ok := manager.FindPlayerBySession("sess-1")
	if !ok || roomID != "room-1" || player.ID != "p1" {
		t.Fatalf("expected to find player by session")
	}
}
