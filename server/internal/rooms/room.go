package rooms

import (
	"strings"
	"sync"
	"time"
)

type Visibility string

const (
	Public  Visibility = "public"
	Private Visibility = "private"
)

type Status string

const (
	// StatusLobby: waiting/ready-up, possibly with a NextGameType decided.
	StatusLobby Status = "lobby"
	// StatusPlaying: a game adapter is running.
	StatusPlaying Status = "playing"
	// StatusResults: last game finished, showing its result screen.
	StatusResults Status = "results"
	// StatusVoting: voting on the next game.
	StatusVoting Status = "voting"
)

// PlacementRow is one player's final result in one played game. Name is
// captured at finish time so the row survives the player leaving.
type PlacementRow struct {
	PlayerID string `json:"playerId"`
	Name     string `json:"name"`
	Place    int    `json:"place"`
	Score    int    `json:"score"`
	Points   int    `json:"points"`
}

type PlayedGame struct {
	GameType  string         `json:"gameType"`
	GameName  string         `json:"gameName"`
	Standings []PlacementRow `json:"standings"`
}

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
	ID   string `json:"id"`
	Name string `json:"name"`
	// GameType/GameName describe the currently running game; empty in lobby.
	GameType   string     `json:"gameType"`
	GameName   string     `json:"gameName"`
	Visibility Visibility `json:"visibility"`
	JoinCode   string     `json:"joinCode"`
	Password   string     `json:"-"`
	MaxPlayers int        `json:"maxPlayers"`
	Locale     string     `json:"locale"`
	CreatedAt  time.Time  `json:"createdAt"`

	mu         sync.RWMutex
	Players    map[string]Player `json:"players"`
	AdminChain []string          `json:"adminChain"`

	Status        Status         `json:"status"`
	Paused        bool           `json:"paused"`
	Playlist      []string       `json:"playlist"`
	NextGameType  string         `json:"nextGameType"`
	NextGameName  string         `json:"nextGameName"`
	SessionScores map[string]int `json:"sessionScores"`
	PlayedGames   []PlayedGame   `json:"playedGames"`
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
	scores := make(map[string]int, len(r.SessionScores))
	for id, points := range r.SessionScores {
		scores[id] = points
	}
	played := make([]PlayedGame, len(r.PlayedGames))
	copy(played, r.PlayedGames)
	playlist := make([]string, len(r.Playlist))
	copy(playlist, r.Playlist)
	return map[string]any{
		"id":            r.ID,
		"name":          r.Name,
		"gameType":      r.GameType,
		"gameName":      r.GameName,
		"visibility":    r.Visibility,
		"maxPlayers":    r.MaxPlayers,
		"joinCode":      r.JoinCode,
		"hasPassword":   r.Password != "",
		"locale":        r.Locale,
		"adminId":       adminID,
		"players":       players,
		"status":        r.Status,
		"paused":        r.Paused,
		"playlist":      playlist,
		"nextGameType":  r.NextGameType,
		"nextGameName":  r.NextGameName,
		"sessionScores": scores,
		"playedGames":   played,
	}
}

func (r *Room) PublicView() map[string]any {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return map[string]any{
		"id":          r.ID,
		"name":        r.Name,
		"gameType":    r.GameType,
		"gameName":    r.GameName,
		"visibility":  r.Visibility,
		"maxPlayers":  r.MaxPlayers,
		"playerCount": len(r.Players),
		"hasPassword": r.Password != "",
		"status":      r.Status,
		"playlist":    r.Playlist,
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

// NameTaken reports whether another player (excluding excludePlayerID)
// already uses this display name, case-insensitively.
func (r *Room) NameTaken(name string, excludePlayerID string) bool {
	name = strings.TrimSpace(name)
	r.mu.RLock()
	defer r.mu.RUnlock()
	for id, player := range r.Players {
		if id == excludePlayerID {
			continue
		}
		if strings.EqualFold(strings.TrimSpace(player.Name), name) {
			return true
		}
	}
	return false
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

func (r *Room) IsAdmin(playerID string) bool {
	return r.AdminID() == playerID
}

func (r *Room) GetStatus() Status {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.Status
}

func (r *Room) SetStatus(status Status) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.Status = status
	if status != StatusPlaying {
		r.Paused = false
	}
}

func (r *Room) SetPaused(paused bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.Paused = paused
}

func (r *Room) IsPaused() bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.Paused
}

func (r *Room) SetPlaylist(playlist []string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.Playlist = playlist
	if r.NextGameType != "" {
		found := false
		for _, t := range playlist {
			if t == r.NextGameType {
				found = true
				break
			}
		}
		if !found {
			r.NextGameType = ""
			r.NextGameName = ""
		}
	}
}

func (r *Room) GetPlaylist() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]string, len(r.Playlist))
	copy(out, r.Playlist)
	return out
}

func (r *Room) SetNextGame(gameType, gameName string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.NextGameType = gameType
	r.NextGameName = gameName
}

func (r *Room) GetNextGameType() string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.NextGameType
}

func (r *Room) SetCurrentGame(gameType, gameName string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.GameType = gameType
	r.GameName = gameName
}

// LastPlayedGame returns the type and name of the most recently finished
// game, or empty strings if none has been played yet.
func (r *Room) LastPlayedGame() (string, string) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if len(r.PlayedGames) == 0 {
		return "", ""
	}
	last := r.PlayedGames[len(r.PlayedGames)-1]
	return last.GameType, last.GameName
}

// RecordPlayedGame appends the game record and adds its points to the
// session totals.
func (r *Room) RecordPlayedGame(pg PlayedGame) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.PlayedGames = append(r.PlayedGames, pg)
	if r.SessionScores == nil {
		r.SessionScores = make(map[string]int)
	}
	for _, row := range pg.Standings {
		r.SessionScores[row.PlayerID] += row.Points
	}
}

func (r *Room) ResetReady() {
	r.mu.Lock()
	defer r.mu.Unlock()
	for id, player := range r.Players {
		player.Ready = false
		r.Players[id] = player
	}
}

// ResetSession clears scores and history for a fresh game night.
func (r *Room) ResetSession() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.Status = StatusLobby
	r.GameType = ""
	r.GameName = ""
	r.NextGameType = ""
	r.NextGameName = ""
	r.SessionScores = make(map[string]int)
	r.PlayedGames = nil
	for id, player := range r.Players {
		player.Ready = false
		r.Players[id] = player
	}
}

func (r *Room) PlayerName(playerID string) string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.Players[playerID].Name
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
