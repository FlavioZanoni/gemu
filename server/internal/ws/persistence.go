package ws

import (
	"encoding/json"
	"log"
	"time"

	"gemu-server/internal/games"
	"gemu-server/internal/rooms"
)

// RoomStore is the durability backend (implemented by internal/persist). All
// methods are best-effort; the hub never blocks gameplay on them.
type RoomStore interface {
	SaveRooms(map[string][]byte) error
	LoadRooms() (map[string][]byte, error)
	DeleteRoom(string) error
}

// SetStore attaches a durability backend. Call once at startup before serving.
func (h *Hub) SetStore(s RoomStore) { h.store = s }

// persistDelete removes a room from durable storage, best-effort.
func (h *Hub) persistDelete(roomID string) {
	if h.store == nil {
		return
	}
	if err := h.store.DeleteRoom(roomID); err != nil {
		log.Printf("persist delete %s: %v", roomID, err)
	}
}

// SnapshotToStore serializes every live room to durable storage.
func (h *Hub) SnapshotToStore() {
	if h.store == nil {
		return
	}
	live := h.rooms.All()
	blob := make(map[string][]byte, len(live))
	for _, r := range live {
		b, err := r.MarshalState()
		if err != nil {
			log.Printf("persist marshal %s: %v", r.ID, err)
			continue
		}
		blob[r.ID] = b
	}
	if err := h.store.SaveRooms(blob); err != nil {
		log.Printf("persist save: %v", err)
	}
}

// StartPersistence periodically snapshots all rooms so a restart loses at most
// `interval` of state.
func (h *Hub) StartPersistence(interval time.Duration) {
	if h.store == nil {
		return
	}
	ticker := time.NewTicker(interval)
	go func() {
		for range ticker.C {
			h.SnapshotToStore()
		}
	}()
}

// RestoreFromStore reloads persisted rooms at startup. A live game can't be
// resumed (its adapter + timers are gone), so a room caught mid-game drops back
// to the lobby with session scores intact — players reconnect and the host
// starts the next game. Everyone is marked disconnected so reconnects
// re-associate; the sweeper reclaims rooms nobody returns to.
//
// A load error is returned, not swallowed: the saver does a full replace of
// the persisted set, so starting it after a failed load would wipe every
// stored room. The caller must retry or run without durability.
func (h *Hub) RestoreFromStore() error {
	if h.store == nil {
		return nil
	}
	blob, err := h.store.LoadRooms()
	if err != nil {
		return err
	}
	now := time.Now()
	restored := 0
	for _, b := range blob {
		room, err := rooms.RoomFromState(b)
		if err != nil {
			log.Printf("persist restore: %v", err)
			continue
		}
		// No live game or vote survives a restart (adapter, timers, and vote
		// state are all in-memory). Drop both back to a clean lobby with session
		// scores intact; results/lobby restore fine as-is (results recovers its
		// standings from the persisted playedGames history).
		if room.Status == rooms.StatusPlaying || room.Status == rooms.StatusVoting {
			room.Status = rooms.StatusLobby
			room.GameType = ""
			room.GameName = ""
			room.NextGameType = ""
			room.NextGameName = ""
		}
		room.Paused = false
		for id, p := range room.Players {
			p.Connected = false
			p.LastSeen = now
			room.Players[id] = p
		}
		session := &gameSession{}
		if decks := room.CustomDecks(); len(decks) > 0 {
			var custom []games.Deck
			if err := json.Unmarshal(decks, &custom); err != nil {
				log.Printf("persist restore decks %s: %v", room.ID, err)
			} else {
				session.customDecks = custom
			}
		}
		h.rooms.Create(room)
		h.mu.Lock()
		h.sessions[room.ID] = session
		h.mu.Unlock()
		restored++
	}
	if restored > 0 {
		log.Printf("restored %d room(s) from storage", restored)
	}
	return nil
}

// DisableStore detaches the durability backend (e.g. after a failed boot
// load), so nothing overwrites the persisted rooms.
func (h *Hub) DisableStore() { h.store = nil }
