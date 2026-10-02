package rooms

import (
	"errors"
	"strings"
	"sync"
	"time"
)

type Manager struct {
	mu    sync.RWMutex
	rooms map[string]*Room
}

func NewManager() *Manager {
	return &Manager{rooms: make(map[string]*Room)}
}

func (m *Manager) Create(room *Room) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if room.Players == nil {
		room.Players = make(map[string]Player)
	}
	if room.Status == "" {
		room.Status = StatusLobby
	}
	if room.SessionScores == nil {
		room.SessionScores = make(map[string]int)
	}
	m.ensureUniqueCodeLocked(room)
	m.rooms[room.ID] = room
}

// ensureUniqueCodeLocked re-rolls a join code that collides with another live
// room's. Must be called with m.mu held for writing.
func (m *Manager) ensureUniqueCodeLocked(room *Room) {
	if room.JoinCode == "" {
		return
	}
	for attempt := 0; attempt < 32 && m.codeTakenLocked(room.JoinCode, room.ID); attempt++ {
		room.JoinCode = NewJoinCode()
	}
}

func (m *Manager) codeTakenLocked(code, exceptRoomID string) bool {
	for id, other := range m.rooms {
		if id != exceptRoomID && other.JoinCode == code {
			return true
		}
	}
	return false
}

func (m *Manager) Get(roomID string) (*Room, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	room, ok := m.rooms[roomID]
	return room, ok
}

func (m *Manager) Remove(roomID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.rooms, roomID)
}

// Count returns the number of live rooms, for the global room cap.
func (m *Manager) Count() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.rooms)
}

// AbandonedRooms returns the ids of rooms whose players are all disconnected
// and whose last activity predates cutoff.
func (m *Manager) AbandonedRooms(cutoff time.Time) []string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	var ids []string
	for id, room := range m.rooms {
		allDisconnected, latest := room.LastActivity()
		if allDisconnected && latest.Before(cutoff) {
			ids = append(ids, id)
		}
	}
	return ids
}

// FindByCode returns the room whose join code matches (case-insensitive).
func (m *Manager) FindByCode(code string) (*Room, bool) {
	code = strings.ToUpper(strings.TrimSpace(code))
	if code == "" {
		return nil, false
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, room := range m.rooms {
		if room.JoinCode == code {
			return room, true
		}
	}
	return nil, false
}

// FindOrCreateExternal returns the room bound to an embedding host's session
// key, creating it with build() when none exists. Find and create happen under
// one lock so two players opening the same session at once share one room.
// build gets the live room count (for caps) and may return nil to refuse
// creation. It runs under the manager lock: it must not call back into m.
func (m *Manager) FindOrCreateExternal(key string, build func(roomCount int) *Room) (room *Room, created bool) {
	if key == "" {
		return nil, false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, r := range m.rooms {
		if r.ExternalKey == key {
			return r, false
		}
	}
	room = build(len(m.rooms))
	if room == nil {
		return nil, false
	}
	room.ExternalKey = key
	if room.Players == nil {
		room.Players = make(map[string]Player)
	}
	if room.Status == "" {
		room.Status = StatusLobby
	}
	if room.SessionScores == nil {
		room.SessionScores = make(map[string]int)
	}
	m.ensureUniqueCodeLocked(room)
	m.rooms[room.ID] = room
	return room, true
}

func (m *Manager) ListPublic() []map[string]any {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]map[string]any, 0)
	for _, room := range m.rooms {
		if room.Visibility == Public {
			out = append(out, room.PublicView())
		}
	}
	return out
}

func (m *Manager) FindPlayerBySession(sessionID string) (string, Player, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for roomID, room := range m.rooms {
		if player, ok := room.FindPlayerBySession(sessionID); ok {
			return roomID, player, true
		}
	}
	return "", Player{}, false
}

// AddPlayer seats a player, refusing when the room is full. The capacity
// check and insert are atomic (see Room.TryAddPlayer); names aren't checked
// here — callers that need unique names use Room.TryAddPlayer directly.
func (m *Manager) AddPlayer(roomID string, player Player) (*Room, error) {
	room, ok := m.Get(roomID)
	if !ok {
		return nil, errors.New("room not found")
	}
	room.mu.Lock()
	defer room.mu.Unlock()
	if room.MaxPlayers > 0 && len(room.Players) >= room.MaxPlayers {
		return nil, ErrRoomFull
	}
	if room.Players == nil {
		room.Players = make(map[string]Player)
	}
	room.Players[player.ID] = player
	room.AdminChain = append(room.AdminChain, player.ID)
	return room, nil
}

func (m *Manager) RemovePlayer(roomID string, playerID string) (*Room, error) {
	room, ok := m.Get(roomID)
	if !ok {
		return nil, errors.New("room not found")
	}
	room.RemovePlayer(playerID)
	return room, nil
}

func (m *Manager) UpdatePlayer(roomID string, playerID string, update func(*Player)) (*Room, error) {
	room, ok := m.Get(roomID)
	if !ok {
		return nil, errors.New("room not found")
	}
	if !room.UpdatePlayer(playerID, update) {
		return nil, errors.New("player not found")
	}
	return room, nil
}
