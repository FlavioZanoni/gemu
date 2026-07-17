package ws

import (
	"testing"

	"gemu-server/internal/games"
	"gemu-server/internal/rooms"
)

// fakeStore is an in-memory RoomStore for testing restore without Redis.
type fakeStore struct{ data map[string][]byte }

func newFakeStore() *fakeStore { return &fakeStore{data: map[string][]byte{}} }

func (f *fakeStore) SaveRooms(m map[string][]byte) error {
	for k, v := range m {
		f.data[k] = v
	}
	return nil
}
func (f *fakeStore) LoadRooms() (map[string][]byte, error) { return f.data, nil }
func (f *fakeStore) DeleteRoom(id string) error            { delete(f.data, id); return nil }

func TestSnapshotAndRestore(t *testing.T) {
	store := newFakeStore()

	// A room caught mid-game with accumulated session scores.
	hub1 := NewHub(games.NewRegistry())
	hub1.SetStore(store)
	room := &rooms.Room{
		ID:            "r1",
		Status:        rooms.StatusPlaying,
		GameType:      "trivia",
		GameName:      "Trivia",
		JoinCode:      "ABC123",
		Password:      "secret",
		Players:       map[string]rooms.Player{"p1": {ID: "p1", SessionID: "s1", Connected: true}},
		AdminChain:    []string{"p1"},
		Playlist:      []string{"trivia"},
		SessionScores: map[string]int{"p1": 50},
	}
	hub1.rooms.Create(room)
	hub1.SnapshotToStore()

	if _, ok := store.data["r1"]; !ok {
		t.Fatalf("room not persisted")
	}

	// Fresh process: restore into a new hub.
	hub2 := NewHub(games.NewRegistry())
	hub2.SetStore(store)
	hub2.RestoreFromStore()

	got, ok := hub2.rooms.Get("r1")
	if !ok {
		t.Fatalf("room not restored")
	}
	if got.Status != rooms.StatusLobby {
		t.Errorf("mid-game room should restore to lobby, got %s", got.Status)
	}
	if got.GameType != "" {
		t.Errorf("current game should be cleared on restore, got %q", got.GameType)
	}
	if got.Players["p1"].Connected {
		t.Errorf("restored players should start disconnected")
	}
	if got.Players["p1"].SessionID != "s1" {
		t.Errorf("session id lost on restore: %q", got.Players["p1"].SessionID)
	}
	if got.Password != "secret" {
		t.Errorf("password lost on restore: %q", got.Password)
	}
	if got.SessionScores["p1"] != 50 {
		t.Errorf("session scores lost on restore: %v", got.SessionScores)
	}
	if _, ok := hub2.sessions["r1"]; !ok {
		t.Errorf("game session not recreated for restored room")
	}

	// Removing the room prunes it from durable storage.
	hub2.removeRoom("r1")
	if _, ok := store.data["r1"]; ok {
		t.Errorf("removed room should be pruned from store")
	}
}
