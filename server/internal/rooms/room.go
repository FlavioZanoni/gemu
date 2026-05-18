package rooms

import (
	"sync"
	"time"
)

type Visibility string

const (
	Public  Visibility = "public"
	Private Visibility = "private"
)

type Player struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	AvatarURL string    `json:"avatarUrl"`
	SessionID string    `json:"-"`
	Connected bool      `json:"connected"`
	Ready     bool      `json:"ready"`
	LastSeen  time.Time `json:"lastSeen"`
}

type Room struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	GameType   string     `json:"gameType"`
	Visibility Visibility `json:"visibility"`
	JoinCode   string     `json:"joinCode"`
	MaxPlayers int        `json:"maxPlayers"`
	CreatedAt  time.Time  `json:"createdAt"`

	mu         sync.RWMutex
	Players    map[string]Player `json:"players"`
	AdminChain []string          `json:"adminChain"`
}

func (r *Room) Snapshot() map[string]any {
	r.mu.RLock()
	defer r.mu.RUnlock()
	players := make([]Player, 0, len(r.Players))
	if len(r.AdminChain) > 0 {
		for _, id := range r.AdminChain {
			if player, ok := r.Players[id]; ok {
				players = append(players, player)
			}
		}
	} else {
		for _, player := range r.Players {
			players = append(players, player)
		}
	}
	adminID := ""
	for _, id := range r.AdminChain {
		if player, ok := r.Players[id]; ok && player.Connected {
			adminID = id
			break
		}
	}
	if adminID == "" && len(r.AdminChain) > 0 {
		adminID = r.AdminChain[0]
	}
	return map[string]any{
		"id":         r.ID,
		"name":       r.Name,
		"gameType":   r.GameType,
		"visibility": r.Visibility,
		"maxPlayers": r.MaxPlayers,
		"joinCode":   r.JoinCode,
		"adminId":    adminID,
		"players":    players,
	}
}

func (r *Room) PublicView() map[string]any {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return map[string]any{
		"id":          r.ID,
		"name":        r.Name,
		"gameType":    r.GameType,
		"visibility":  r.Visibility,
		"maxPlayers":  r.MaxPlayers,
		"playerCount": len(r.Players),
	}
}

func (r *Room) AdminID() string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, id := range r.AdminChain {
		if player, ok := r.Players[id]; ok && player.Connected {
			return id
		}
	}
	if len(r.AdminChain) == 0 {
		return ""
	}
	return r.AdminChain[0]
}

func (r *Room) PlayerCount() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.Players)
}

func (r *Room) AddPlayer(player Player) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.Players[player.ID] = player
	r.AdminChain = append(r.AdminChain, player.ID)
}

func (r *Room) FindPlayerBySession(sessionID string) (Player, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, player := range r.Players {
		if player.SessionID == sessionID {
			return player, true
		}
	}
	return Player{}, false
}

func (r *Room) UpdatePlayer(playerID string, update func(*Player)) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	player, ok := r.Players[playerID]
	if !ok {
		return false
	}
	update(&player)
	r.Players[playerID] = player
	return true
}

func (r *Room) RemovePlayer(playerID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.Players, playerID)
	newChain := make([]string, 0, len(r.AdminChain))
	for _, id := range r.AdminChain {
		if id != playerID {
			newChain = append(newChain, id)
		}
	}
	r.AdminChain = newChain
}

func (r *Room) PlayerIDs() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	ids := make([]string, 0, len(r.Players))
	for id := range r.Players {
		ids = append(ids, id)
	}
	return ids
}

func (r *Room) ConnectedPlayerIDs() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	ids := make([]string, 0, len(r.Players))
	for id, player := range r.Players {
		if player.Connected {
			ids = append(ids, id)
		}
	}
	return ids
}

func (r *Room) AllConnectedReady() bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, player := range r.Players {
		if player.Connected && !player.Ready {
			return false
		}
	}
	return true
}
