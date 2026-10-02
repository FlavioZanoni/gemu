package rooms

import (
	"testing"
	"time"
)

func TestRoomAdminPrefersConnected(t *testing.T) {
	room := &Room{
		ID:         "room-1",
		Players:    make(map[string]Player),
		AdminChain: []string{},
	}

	room.AddPlayer(Player{ID: "p1", Name: "One", Connected: false})
	room.AddPlayer(Player{ID: "p2", Name: "Two", Connected: true})

	if room.AdminID() != "p2" {
		t.Fatalf("expected connected player to be admin")
	}
}

func TestRoomFindPlayerBySession(t *testing.T) {
	room := &Room{Players: make(map[string]Player)}
	room.AddPlayer(Player{ID: "p1", SessionID: "sess-1"})

	player, ok := room.FindPlayerBySession("sess-1")
	if !ok || player.ID != "p1" {
		t.Fatalf("expected to find player by session")
	}
}

func TestRoomUpdatePlayer(t *testing.T) {
	room := &Room{Players: make(map[string]Player)}
	room.AddPlayer(Player{ID: "p1", Name: "One"})

	updated := room.UpdatePlayer("p1", func(p *Player) {
		p.Ready = true
		p.LastSeen = time.Unix(123, 0)
	})
	if !updated {
		t.Fatalf("expected update to succeed")
	}

	player := room.Players["p1"]
	if !player.Ready {
		t.Fatalf("expected ready to be true")
	}
	if player.LastSeen.IsZero() {
		t.Fatalf("expected lastSeen to be set")
	}
}

func TestRoomAllConnectedReady(t *testing.T) {
	room := &Room{Players: make(map[string]Player)}
	room.AddPlayer(Player{ID: "p1", Connected: true, Ready: true})
	room.AddPlayer(Player{ID: "p2", Connected: false, Ready: false})

	if !room.AllConnectedReady() {
		t.Fatalf("expected all connected players to be ready")
	}
}

func TestTryAddPlayerCapacityAndNames(t *testing.T) {
	room := &Room{Players: map[string]Player{}, MaxPlayers: 3}
	if _, err := room.TryAddPlayer(Player{ID: "p1", Name: "Ana"}, false); err != nil {
		t.Fatalf("first add: %v", err)
	}
	if _, err := room.TryAddPlayer(Player{ID: "p2", Name: " ana "}, false); err != ErrNameTaken {
		t.Fatalf("want ErrNameTaken, got %v", err)
	}
	p, err := room.TryAddPlayer(Player{ID: "p2", Name: "Ana"}, true)
	if err != nil || p.Name != "Ana 2" {
		t.Fatalf("dedupe should suffix, got %q %v", p.Name, err)
	}
	if _, err := room.TryAddPlayer(Player{ID: "p3", Name: "Bo"}, false); err != nil {
		t.Fatalf("third add: %v", err)
	}
	if _, err := room.TryAddPlayer(Player{ID: "p4", Name: "Cy"}, false); err != ErrRoomFull {
		t.Fatalf("want ErrRoomFull, got %v", err)
	}
	if len(room.AdminChain) != 3 {
		t.Fatalf("admin chain should track seated players, got %v", room.AdminChain)
	}
}
