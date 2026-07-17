package rooms

import "encoding/json"

// Durability serialization. A Room marshals almost completely via its json
// tags, but Password and Player.SessionID are json:"-" (they must never reach
// clients) — yet restore needs both (private-room auth, reconnect matching).
// So we wrap the room's normal JSON alongside those two secrets.
type roomEnvelope struct {
	Room       json.RawMessage   `json:"room"`
	Password   string            `json:"pw"`
	SessionIDs map[string]string `json:"sids"` // playerID -> sessionID
}

// MarshalState returns the full persistable state of the room, including the
// fields hidden from clients.
func (r *Room) MarshalState() ([]byte, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	roomJSON, err := json.Marshal(r) // struct tags drop pw + sessionID
	if err != nil {
		return nil, err
	}
	sids := make(map[string]string, len(r.Players))
	for id, p := range r.Players {
		sids[id] = p.SessionID
	}
	return json.Marshal(roomEnvelope{Room: roomJSON, Password: r.Password, SessionIDs: sids})
}

// RoomFromState reconstructs a Room from MarshalState output, re-injecting the
// password and per-player session ids.
func RoomFromState(b []byte) (*Room, error) {
	var env roomEnvelope
	if err := json.Unmarshal(b, &env); err != nil {
		return nil, err
	}
	var room Room
	if err := json.Unmarshal(env.Room, &room); err != nil {
		return nil, err
	}
	room.Password = env.Password
	if room.Players == nil {
		room.Players = make(map[string]Player)
	}
	for id, sid := range env.SessionIDs {
		if p, ok := room.Players[id]; ok {
			p.SessionID = sid
			room.Players[id] = p
		}
	}
	if room.SessionScores == nil {
		room.SessionScores = make(map[string]int)
	}
	return &room, nil
}

// All returns a snapshot slice of every live room, for periodic persistence.
func (m *Manager) All() []*Room {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]*Room, 0, len(m.rooms))
	for _, r := range m.rooms {
		out = append(out, r)
	}
	return out
}
