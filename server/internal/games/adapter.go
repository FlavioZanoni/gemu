package games

import "time"

type Status string

const (
	StatusRunning  Status = "running"
	StatusFinished Status = "finished"
)

// RoomInfo is the live room view a game may consult while running.
// *rooms.Room satisfies it.
type RoomInfo interface {
	ConnectedPlayerIDs() []string
	IsAdmin(playerID string) bool
}

type Options struct {
	Room   RoomInfo
	Locale string
}

// Standing is a player's final result in one game. Score is game-native and
// only comparable within that game; the platform converts placements into
// session points.
type Standing struct {
	PlayerID string `json:"playerId"`
	Score    int    `json:"score"`
}

// Adapter is a self-driving game state machine: it advances its own phases
// from actions, timers, and room changes. The hub serializes all calls per
// room, so implementations need no internal locking.
type Adapter interface {
	Type() string
	Start(roomID string, opts Options)
	OnPlayerJoin(playerID string)
	OnPlayerLeave(playerID string)
	// OnRoomChange fires when connectivity changes (e.g. a disconnect), so
	// games gated on "everyone submitted" can re-check and advance.
	OnRoomChange()
	OnAction(playerID string, payload map[string]any) error
	// OnTimer fires when the deadline reported by NextDeadline elapses.
	OnTimer(name string)
	// NextDeadline reports the single pending timer, if any. The hub re-arms
	// it after every mutating call.
	NextDeadline() (name string, at time.Time, ok bool)
	Status() Status
	// Standings returns the CURRENT running totals, best first — callable at
	// any time (the hub broadcasts them with every game.state for the live
	// scoreboard); once Status() == StatusFinished they are the final result.
	Standings() []Standing
	PublicState() map[string]any
	PrivateState(playerID string) map[string]any
}
