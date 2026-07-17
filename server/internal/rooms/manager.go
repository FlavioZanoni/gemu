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
	m.rooms[room.ID] = room
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

func (m *Manager) AddPlayer(roomID string, player Player) (*Room, error) {
	room, ok := m.Get(roomID)
	if !ok {
		return nil, errors.New("room not found")
	}
	room.mu.RLock()
	maxPlayers := room.MaxPlayers
	playerCount := len(room.Players)
	room.mu.RUnlock()
	if maxPlayers > 0 && playerCount >= maxPlayers {
		return nil, errors.New("room full")
	}
	room.AddPlayer(player)
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
