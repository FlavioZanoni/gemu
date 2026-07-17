package ws

import (
	"math/rand"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"

	"gemu-server/internal/games"
	"gemu-server/internal/rooms"
)

type Client struct {
	ID        string
	Conn      *websocket.Conn
	RoomID    string
	Player    rooms.Player
	SessionID string
	// writeMu serializes writes to Conn: gorilla/websocket forbids concurrent
	// WriteJSON on one connection, and any goroutine can broadcast to any
	// client. Without this, ordinary concurrent traffic panics the process.
	writeMu sync.Mutex
}

// write serializes and recovers around a single connection write so a broken
// pipe or concurrent-write panic degrades one client, never the whole server.
func (c *Client) write(env Envelope) {
	if c == nil || c.Conn == nil {
		return
	}
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	defer func() { _ = recover() }()
	_ = c.Conn.WriteJSON(env)
}

type Hub struct {
	mu       sync.RWMutex
	clients  map[string]*Client
	rooms    *rooms.Manager
	registry *games.Registry
	sessions map[string]*gameSession
}

func NewHub(registry *games.Registry) *Hub {
	return &Hub{
		clients:  make(map[string]*Client),
		rooms:    rooms.NewManager(),
		registry: registry,
		sessions: make(map[string]*gameSession),
	}
}

func (h *Hub) AddClient(conn *websocket.Conn) *Client {
	client := &Client{ID: uuid.NewString(), Conn: conn}
	h.mu.Lock()
	h.clients[client.ID] = client
	h.mu.Unlock()
	return client
}

// bindClient sets a connection's room identity under h.mu, which is the same
// lock the broadcast/lookup paths read those fields under.
func (h *Hub) bindClient(client *Client, roomID string, player rooms.Player, sessionID string) {
	h.mu.Lock()
	client.RoomID = roomID
	client.Player = player
	client.SessionID = sessionID
	h.mu.Unlock()
}

func (h *Hub) unbindClient(client *Client) {
	h.bindClient(client, "", rooms.Player{}, "")
}

func (h *Hub) RemoveClient(clientID string) {
	h.mu.Lock()
	client, ok := h.clients[clientID]
	delete(h.clients, clientID)
	h.mu.Unlock()

	if ok && client.RoomID != "" {
		roomID := client.RoomID
		playerID := client.Player.ID
		room, err := h.rooms.UpdatePlayer(roomID, playerID, func(player *rooms.Player) {
			player.Connected = false
			player.LastSeen = time.Now()
		})
		if err == nil {
			h.Broadcast(roomID, Envelope{Type: "room.updated", RoomID: roomID, Payload: encodeRoomSnapshot(room)})
			h.Broadcast(roomID, Envelope{Type: "room.playerDisconnected", RoomID: roomID, Payload: map[string]any{"playerId": playerID}})
			// A disconnect can complete an "everyone submitted" gate.
			if s, ok := h.session(roomID); ok {
				s.mu.Lock()
				if s.adapter != nil {
					s.adapter.OnRoomChange()
					h.afterAdapterCall(roomID, s)
				}
				s.mu.Unlock()
			}
		}
	}
}

func (h *Hub) Send(client *Client, env Envelope) {
	client.write(env)
}

func (h *Hub) findClientBySession(sessionID string) (*Client, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, client := range h.clients {
		if client.SessionID == sessionID && client.RoomID != "" {
			return client, true
		}
	}
	return nil, false
}

// sessionBlocked reports whether a session may NOT bind to a new room. A
// session actively held by a live connection (a second open tab) is blocked;
// a session left only as a disconnected ghost in some old room (the common
// "closed the tab earlier" case) is evicted from that room and allowed
// through, so the player isn't trapped by an abandoned session.
func (h *Hub) sessionBlocked(sessionID string, exceptRoomID string) bool {
	if _, ok := h.findClientBySession(sessionID); ok {
		return true
	}
	roomID, player, ok := h.rooms.FindPlayerBySession(sessionID)
	if !ok || roomID == exceptRoomID {
		return false
	}
	if room, err := h.rooms.RemovePlayer(roomID, player.ID); err == nil {
		h.notifyPlayerLeft(roomID, player.ID)
		h.Broadcast(roomID, Envelope{Type: "room.playerLeft", RoomID: roomID, Payload: map[string]any{"playerId": player.ID}})
		h.Broadcast(roomID, Envelope{Type: "room.updated", RoomID: roomID, Payload: room.Snapshot()})
		h.cleanupIfEmpty(roomID, room)
	}
	return false
}

func (h *Hub) Broadcast(roomID string, env Envelope) {
	h.BroadcastExcept(roomID, "", env)
}

func (h *Hub) BroadcastExcept(roomID string, exceptClientID string, env Envelope) {
	// Snapshot targets under the lock, then write outside it: a client's
	// writeMu can block, and we must not hold h.mu (which every handler needs)
	// while a slow socket drains.
	h.mu.RLock()
	targets := make([]*Client, 0, len(h.clients))
	for _, client := range h.clients {
		if client.RoomID == roomID && client.ID != exceptClientID {
			targets = append(targets, client)
		}
	}
	h.mu.RUnlock()
	for _, client := range targets {
		client.write(env)
	}
}

// streamActions is the allowlist of relay-only actions. Restricting at the hub
// (not per-game OnAction, which defaults to accepting unknown actions) stops a
// non-drawer from routing real game actions — or arbitrary keys — through the
// broadcast relay.
var streamActions = map[string]bool{
	"stroke":       true,
	"canvas_clear": true,
	"canvas_undo":  true,
}

// handleGameStream relays high-frequency transient payloads (canvas strokes)
// to the rest of the room WITHOUT the full-state broadcast game.action does.
// The adapter's OnAction is still consulted so games can reject illegal
// senders (e.g. strokes from a non-drawer); rejected or gameless streams are
// dropped silently — no error replies at stroke frequency.
func (h *Hub) handleGameStream(client *Client, env Envelope) {
	roomID := client.RoomID
	if roomID == "" {
		return
	}
	action, _ := env.Payload["action"].(string)
	if !streamActions[action] {
		return
	}
	s, ok := h.session(roomID)
	if !ok {
		return
	}
	s.mu.Lock()
	if s.adapter == nil || !s.pausedAt.IsZero() {
		s.mu.Unlock()
		return
	}
	err := s.adapter.OnAction(client.Player.ID, env.Payload)
	s.mu.Unlock()
	if err != nil {
		return
	}
	payload := make(map[string]any, len(env.Payload)+1)
	for k, v := range env.Payload {
		payload[k] = v
	}
	payload["playerId"] = client.Player.ID
	h.BroadcastExcept(roomID, client.ID, Envelope{Type: "game.stream", RoomID: roomID, Payload: payload})
}

func (h *Hub) HandleMessage(client *Client, env Envelope) {
	switch env.Type {
	case "lobby.games.list":
		h.Send(client, Envelope{Type: "lobby.games.list.ok", RequestID: env.RequestID, Payload: map[string]any{"games": h.registry.List()}})
	case "lobby.rooms.list":
		h.Send(client, Envelope{Type: "lobby.rooms.list.ok", RequestID: env.RequestID, Payload: map[string]any{"rooms": h.rooms.ListPublic()}})
	case "room.create":
		h.handleRoomCreate(client, env)
	case "room.join":
		h.handleRoomJoin(client, env)
	case "room.leave":
		h.handleRoomLeave(client, env)
	case "room.ready.set":
		h.handleRoomReadySet(client, env)
	case "room.kick":
		h.handleRoomKick(client, env)
	case "game.start":
		h.handleGameStart(client, env)
	case "game.action":
		h.handleGameAction(client, env)
	case "game.stream":
		h.handleGameStream(client, env)
	case "session.playlist.set":
		h.handleSessionPlaylistSet(client, env)
	case "session.vote.start":
		h.handleSessionVoteStart(client, env)
	case "session.replay":
		h.handleSessionReplay(client, env)
	case "session.pause":
		h.handleSessionPause(client, env)
	case "session.resume":
		h.handleSessionResume(client, env)
	case "session.vote.cast":
		h.handleSessionVoteCast(client, env)
	case "session.end":
		h.handleSessionEnd(client, env)
	default:
		h.Send(client, Envelope{Type: "system.error", RequestID: env.RequestID, Payload: map[string]any{"code": "unknown_type", "message": "unknown message type"}})
	}
}

func decodeString(payload map[string]any, key string) string {
	if payload == nil {
		return ""
	}
	if v, ok := payload[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func decodeInt(payload map[string]any, key string) int {
	if payload == nil {
		return 0
	}
	if v, ok := payload[key]; ok {
		switch n := v.(type) {
		case float64:
			return int(n)
		case int:
			return n
		}
	}
	return 0
}

func encodeRoomSnapshot(room *rooms.Room) map[string]any {
	return room.Snapshot()
}

const (
	maxNameLen     = 40
	maxRoomNameLen = 60
	maxAvatarLen   = 256 * 1024 // doodle avatars are small data: URLs
	maxPasswordLen = 100
	roomPlayerCap  = 16 // hard ceiling regardless of client maxPlayers
)

// sanitizeAvatar drops any avatar URL that isn't an inline image or https,
// so a player can't point everyone's client at an attacker-controlled URL
// (tracking pixel / IP+UA collection). Cosmetic field, so bad values become
// empty rather than failing the join.
func sanitizeAvatar(url string) string {
	if strings.HasPrefix(url, "data:image/") || strings.HasPrefix(url, "https://") {
		return url
	}
	return ""
}

// truncate caps a rune length so client strings can't bloat every broadcast.
func truncate(s string, max int) string {
	r := []rune(s)
	if len(r) > max {
		return string(r[:max])
	}
	return s
}

// clampMaxPlayers turns a client value into a sane room size; 0/negative means
// "no explicit limit", which we still cap at roomPlayerCap.
func clampMaxPlayers(v int) int {
	if v <= 0 || v > roomPlayerCap {
		return roomPlayerCap
	}
	return v
}

func (h *Hub) handleRoomCreate(client *Client, env Envelope) {
	// A connection already bound to a room must leave it first; otherwise
	// rebinding orphans a connected ghost player that never gets cleaned up.
	if client.RoomID != "" {
		h.Send(client, Envelope{Type: "room.create.error", RequestID: env.RequestID, Payload: map[string]any{"code": "already_in_room", "message": "leave your current room first"}})
		return
	}
	name := truncate(decodeString(env.Payload, "name"), maxRoomNameLen)
	visibility := decodeString(env.Payload, "visibility")
	maxPlayers := clampMaxPlayers(decodeInt(env.Payload, "maxPlayers"))
	displayName := truncate(decodeString(env.Payload, "displayName"), maxNameLen)
	avatarURL := sanitizeAvatar(truncate(decodeString(env.Payload, "avatarUrl"), maxAvatarLen))
	sessionID := decodeString(env.Payload, "sessionId")
	password := truncate(decodeString(env.Payload, "password"), maxPasswordLen)
	locale := decodeString(env.Payload, "locale")
	if locale == "" {
		locale = "en"
	}

	playlist := decodeStringSlice(env.Payload, "playlist")
	if len(playlist) == 0 {
		// Back-compat: a single gameType becomes a one-game playlist.
		if gameType := decodeString(env.Payload, "gameType"); gameType != "" {
			playlist = []string{gameType}
		}
	}

	if name == "" || len(playlist) == 0 || displayName == "" || sessionID == "" {
		h.Send(client, Envelope{Type: "room.create.error", RequestID: env.RequestID, Payload: map[string]any{"code": "invalid_payload", "message": "missing required fields"}})
		return
	}
	for _, gameType := range playlist {
		if _, ok := h.registry.Get(gameType); !ok {
			h.Send(client, Envelope{Type: "room.create.error", RequestID: env.RequestID, Payload: map[string]any{"code": "invalid_game", "message": "game not found"}})
			return
		}
	}

	if visibility == "" {
		visibility = string(rooms.Public)
	}
	if visibility != string(rooms.Public) && visibility != string(rooms.Private) {
		h.Send(client, Envelope{Type: "room.create.error", RequestID: env.RequestID, Payload: map[string]any{"code": "invalid_visibility", "message": "invalid visibility"}})
		return
	}

	if h.sessionBlocked(sessionID, "") {
		h.Send(client, Envelope{Type: "room.create.error", RequestID: env.RequestID, Payload: map[string]any{"code": "session_in_room", "message": "session already in room"}})
		return
	}

	// Every room gets a shareable code so friends can join by code alone
	// (design's "OR JOIN THE PARTY"), regardless of public/private listing.
	joinCode := strings.ToUpper(uuid.NewString()[:6])

	room := &rooms.Room{
		ID:         uuid.NewString(),
		Name:       name,
		Visibility: rooms.Visibility(visibility),
		JoinCode:   joinCode,
		Password:   password,
		MaxPlayers: maxPlayers,
		Locale:     locale,
		Playlist:   playlist,
	}
	h.rooms.Create(room)

	h.mu.Lock()
	h.sessions[room.ID] = &gameSession{}
	h.mu.Unlock()

	player := rooms.Player{ID: uuid.NewString(), Name: displayName, AvatarURL: avatarURL, SessionID: sessionID, Connected: true, Ready: false, LastSeen: time.Now()}
	if _, err := h.rooms.AddPlayer(room.ID, player); err != nil {
		h.Send(client, Envelope{Type: "room.create.error", RequestID: env.RequestID, Payload: map[string]any{"code": "room_full", "message": "room full"}})
		return
	}

	h.bindClient(client, room.ID, player, sessionID)

	h.Send(client, Envelope{Type: "room.create.ok", RequestID: env.RequestID, RoomID: room.ID, Payload: encodeRoomSnapshot(room)})
	h.Broadcast(room.ID, Envelope{Type: "room.updated", RoomID: room.ID, Payload: encodeRoomSnapshot(room)})
}

func (h *Hub) handleRoomJoin(client *Client, env Envelope) {
	roomID := decodeString(env.Payload, "roomId")
	joinCode := decodeString(env.Payload, "joinCode")
	displayName := truncate(decodeString(env.Payload, "displayName"), maxNameLen)
	avatarURL := sanitizeAvatar(truncate(decodeString(env.Payload, "avatarUrl"), maxAvatarLen))
	sessionID := decodeString(env.Payload, "sessionId")
	isRejoin := false

	if displayName == "" || sessionID == "" {
		h.Send(client, Envelope{Type: "room.join.error", RequestID: env.RequestID, Payload: map[string]any{"code": "invalid_payload", "message": "missing required fields"}})
		return
	}

	// Resolve the room by id, or by join code when only a code is supplied
	// (the "join the party" flow enters just a code).
	var room *rooms.Room
	var ok bool
	if roomID != "" {
		room, ok = h.rooms.Get(roomID)
	} else if joinCode != "" {
		room, ok = h.rooms.FindByCode(joinCode)
	}
	if !ok || room == nil {
		h.Send(client, Envelope{Type: "room.join.error", RequestID: env.RequestID, Payload: map[string]any{"code": "not_found", "message": "room not found"}})
		return
	}
	roomID = room.ID

	// Reject a join from a connection already bound to a different room; without
	// this, rebinding strands a connected ghost player in the old room.
	if client.RoomID != "" && client.RoomID != roomID {
		h.Send(client, Envelope{Type: "room.join.error", RequestID: env.RequestID, Payload: map[string]any{"code": "already_in_room", "message": "leave your current room first"}})
		return
	}

	// Evict a stale session from a different old room; block only if a live
	// connection still holds it (a second tab).
	if h.sessionBlocked(sessionID, roomID) {
		h.Send(client, Envelope{Type: "room.join.error", RequestID: env.RequestID, Payload: map[string]any{"code": "session_in_room", "message": "session already in room"}})
		return
	}

	if room.Visibility == rooms.Private && room.JoinCode != strings.ToUpper(joinCode) {
		h.Send(client, Envelope{Type: "room.join.error", RequestID: env.RequestID, Payload: map[string]any{"code": "invalid_code", "message": "invalid join code"}})
		return
	}

	_, alreadyMember := room.FindPlayerBySession(sessionID)
	if !alreadyMember && room.Password != "" && decodeString(env.Payload, "password") != room.Password {
		h.Send(client, Envelope{Type: "room.join.error", RequestID: env.RequestID, Payload: map[string]any{"code": "invalid_password", "message": "invalid password"}})
		return
	}

	var player rooms.Player
	if existing, ok := room.FindPlayerBySession(sessionID); ok {
		player = existing
		isRejoin = true
		// On rejoin a conflicting rename silently keeps the old name rather
		// than blocking the reconnect.
		nameConflict := room.NameTaken(displayName, existing.ID)
		if _, err := h.rooms.UpdatePlayer(room.ID, player.ID, func(p *rooms.Player) {
			p.Connected = true
			p.LastSeen = time.Now()
			if !nameConflict {
				p.Name = displayName
			}
			if avatarURL != "" {
				p.AvatarURL = avatarURL
			}
		}); err != nil {
			h.Send(client, Envelope{Type: "room.join.error", RequestID: env.RequestID, Payload: map[string]any{"code": "not_found", "message": "player not found"}})
			return
		}
	} else {
		if room.NameTaken(displayName, "") {
			h.Send(client, Envelope{Type: "room.join.error", RequestID: env.RequestID, Payload: map[string]any{"code": "name_taken", "message": "display name already in use"}})
			return
		}
		player = rooms.Player{ID: uuid.NewString(), Name: displayName, AvatarURL: avatarURL, SessionID: sessionID, Connected: true, Ready: false, LastSeen: time.Now()}
		if _, err := h.rooms.AddPlayer(room.ID, player); err != nil {
			h.Send(client, Envelope{Type: "room.join.error", RequestID: env.RequestID, Payload: map[string]any{"code": "room_full", "message": "room full"}})
			return
		}
		if s, ok := h.session(room.ID); ok {
			s.mu.Lock()
			if s.adapter != nil {
				s.adapter.OnPlayerJoin(player.ID)
			}
			s.mu.Unlock()
		}
	}

	if isRejoin {
		if updated, ok := room.FindPlayerBySession(sessionID); ok {
			player = updated
		}
	}

	h.bindClient(client, room.ID, player, sessionID)

	h.Send(client, Envelope{Type: "room.join.ok", RequestID: env.RequestID, RoomID: room.ID, Payload: room.Snapshot()})
	if !isRejoin {
		h.Broadcast(room.ID, Envelope{Type: "room.playerJoined", RoomID: room.ID, Payload: map[string]any{"player": player}})
	}
	h.Broadcast(room.ID, Envelope{Type: "room.updated", RoomID: room.ID, Payload: room.Snapshot()})
	if s, ok := h.session(room.ID); ok {
		s.mu.Lock()
		if s.adapter != nil {
			h.Send(client, Envelope{Type: "game.state", RoomID: room.ID, Payload: map[string]any{"public": s.adapter.PublicState(), "private": s.adapter.PrivateState(player.ID)}})
		}
		// Replay the open next-game vote so a rejoiner isn't stuck on a blank
		// voting screen (the session.vote push already fired before they joined).
		if s.votes != nil && len(s.voteOptions) > 0 {
			options := make([]map[string]string, 0, len(s.voteOptions))
			for _, gameType := range s.voteOptions {
				options = append(options, h.gameOption(gameType))
			}
			h.Send(client, Envelope{Type: "session.vote", RoomID: room.ID, Payload: map[string]any{
				"options":  options,
				"deadline": s.voteDeadline.UnixMilli(),
			}})
			h.Send(client, Envelope{Type: "session.vote.update", RoomID: room.ID, Payload: map[string]any{"counts": voteCounts(s)}})
		}
		s.mu.Unlock()
	}
}

func (h *Hub) handleRoomLeave(client *Client, env Envelope) {
	roomID := client.RoomID
	if roomID == "" {
		h.Send(client, Envelope{Type: "room.leave.error", RequestID: env.RequestID, Payload: map[string]any{"code": "not_in_room", "message": "not in room"}})
		return
	}

	room, err := h.rooms.RemovePlayer(roomID, client.Player.ID)
	if err != nil {
		h.Send(client, Envelope{Type: "room.leave.error", RequestID: env.RequestID, Payload: map[string]any{"code": "not_found", "message": "room not found"}})
		return
	}

	playerID := client.Player.ID
	h.unbindClient(client)
	h.notifyPlayerLeft(roomID, playerID)
	h.Send(client, Envelope{Type: "room.leave.ok", RequestID: env.RequestID})
	h.Broadcast(roomID, Envelope{Type: "room.playerLeft", RoomID: roomID, Payload: map[string]any{"playerId": playerID}})
	h.Broadcast(roomID, Envelope{Type: "room.updated", RoomID: roomID, Payload: encodeRoomSnapshot(room)})
	h.cleanupIfEmpty(roomID, room)
}

// notifyPlayerLeft forwards a permanent leave to the running game, if any.
func (h *Hub) notifyPlayerLeft(roomID, playerID string) {
	s, ok := h.session(roomID)
	if !ok {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.adapter != nil {
		s.adapter.OnPlayerLeave(playerID)
		h.afterAdapterCall(roomID, s)
	}
}

func (h *Hub) cleanupIfEmpty(roomID string, room *rooms.Room) {
	if room.PlayerCount() != 0 {
		return
	}
	h.removeRoom(roomID)
}

// removeRoom deletes a room and tears down its session/timer.
func (h *Hub) removeRoom(roomID string) {
	h.rooms.Remove(roomID)
	h.mu.Lock()
	s, ok := h.sessions[roomID]
	delete(h.sessions, roomID)
	h.mu.Unlock()
	if ok {
		s.mu.Lock()
		s.adapter = nil
		s.stopTimer()
		s.mu.Unlock()
	}
}

const roomAbandonGrace = 5 * time.Minute

// StartSweeper reclaims rooms whose players have all disconnected and stayed
// gone past the grace window (browser-close leaves them in memory forever
// otherwise, since disconnect only marks players absent, never removes them).
// The grace window lets a whole group reconnect after a wifi blip.
func (h *Hub) StartSweeper() {
	ticker := time.NewTicker(time.Minute)
	go func() {
		for range ticker.C {
			h.sweepAbandoned(time.Now().Add(-roomAbandonGrace))
		}
	}()
}

// sweepAbandoned removes every room fully disconnected since before cutoff.
func (h *Hub) sweepAbandoned(cutoff time.Time) {
	for _, roomID := range h.rooms.AbandonedRooms(cutoff) {
		h.removeRoom(roomID)
	}
}

func (h *Hub) handleRoomKick(client *Client, env Envelope) {
	roomID := client.RoomID
	targetID := decodeString(env.Payload, "playerId")
	if roomID == "" || targetID == "" {
		h.Send(client, Envelope{Type: "room.kick.error", RequestID: env.RequestID, Payload: map[string]any{"code": "invalid_payload", "message": "missing required fields"}})
		return
	}

	room, ok := h.rooms.Get(roomID)
	if !ok {
		h.Send(client, Envelope{Type: "room.kick.error", RequestID: env.RequestID, Payload: map[string]any{"code": "not_found", "message": "room not found"}})
		return
	}

	if room.AdminID() != client.Player.ID {
		h.Send(client, Envelope{Type: "room.kick.error", RequestID: env.RequestID, Payload: map[string]any{"code": "not_admin", "message": "admin only"}})
		return
	}

	if _, err := h.rooms.RemovePlayer(roomID, targetID); err != nil {
		h.Send(client, Envelope{Type: "room.kick.error", RequestID: env.RequestID, Payload: map[string]any{"code": "not_found", "message": "player not found"}})
		return
	}

	h.notifyPlayerLeft(roomID, targetID)

	var kickedClient *Client
	h.mu.Lock()
	for _, c := range h.clients {
		if c.Player.ID == targetID {
			c.RoomID = ""
			c.Player = rooms.Player{}
			c.SessionID = ""
			kickedClient = c
			break
		}
	}
	h.mu.Unlock()

	h.Send(client, Envelope{Type: "room.kick.ok", RequestID: env.RequestID})
	if kickedClient != nil {
		h.Send(kickedClient, Envelope{Type: "room.kicked", RoomID: roomID, Payload: map[string]any{"reason": "kicked"}})
	}
	h.Broadcast(roomID, Envelope{Type: "room.playerLeft", RoomID: roomID, Payload: map[string]any{"playerId": targetID}})
	h.Broadcast(roomID, Envelope{Type: "room.updated", RoomID: roomID, Payload: room.Snapshot()})
	h.cleanupIfEmpty(roomID, room)
}

func (h *Hub) handleRoomReadySet(client *Client, env Envelope) {
	roomID := client.RoomID
	if roomID == "" {
		h.Send(client, Envelope{Type: "room.ready.set.error", RequestID: env.RequestID, Payload: map[string]any{"code": "not_in_room", "message": "not in room"}})
		return
	}
	ready := false
	if env.Payload != nil {
		if v, ok := env.Payload["ready"]; ok {
			if b, ok := v.(bool); ok {
				ready = b
			}
		}
	}
	room, err := h.rooms.UpdatePlayer(roomID, client.Player.ID, func(player *rooms.Player) {
		player.Ready = ready
		player.LastSeen = time.Now()
	})
	if err != nil {
		h.Send(client, Envelope{Type: "room.ready.set.error", RequestID: env.RequestID, Payload: map[string]any{"code": "not_found", "message": "room not found"}})
		return
	}
	h.Send(client, Envelope{Type: "room.ready.set.ok", RequestID: env.RequestID})
	h.Broadcast(roomID, Envelope{Type: "room.updated", RoomID: roomID, Payload: encodeRoomSnapshot(room)})
}

func (h *Hub) ReadEnvelope(client *Client) (Envelope, error) {
	var env Envelope
	err := client.Conn.ReadJSON(&env)
	if err != nil {
		return env, err
	}
	return env, nil
}

func (h *Hub) handleGameStart(client *Client, env Envelope) {
	roomID := client.RoomID
	if roomID == "" {
		h.Send(client, Envelope{Type: "game.start.error", RequestID: env.RequestID, Payload: map[string]any{"code": "not_in_room", "message": "not in room"}})
		return
	}

	room, ok := h.rooms.Get(roomID)
	if !ok {
		h.Send(client, Envelope{Type: "game.start.error", RequestID: env.RequestID, Payload: map[string]any{"code": "not_found", "message": "room not found"}})
		return
	}

	if room.AdminID() != client.Player.ID {
		h.Send(client, Envelope{Type: "game.start.error", RequestID: env.RequestID, Payload: map[string]any{"code": "not_admin", "message": "admin only"}})
		return
	}
	if len(room.ConnectedPlayerIDs()) < 2 {
		h.Send(client, Envelope{Type: "game.start.error", RequestID: env.RequestID, Payload: map[string]any{"code": "not_enough_players", "message": "need at least 2 players"}})
		return
	}
	readyCheck := true
	if env.Payload != nil {
		if v, ok := env.Payload["force"]; ok {
			if b, ok := v.(bool); ok && b {
				readyCheck = false
			}
		}
	}
	if readyCheck && !room.AllConnectedReady() {
		h.Send(client, Envelope{Type: "game.start.error", RequestID: env.RequestID, Payload: map[string]any{"code": "not_ready", "message": "not all players are ready"}})
		return
	}

	s, ok := h.session(roomID)
	if !ok {
		h.Send(client, Envelope{Type: "game.start.error", RequestID: env.RequestID, Payload: map[string]any{"code": "game_missing", "message": "session not initialized"}})
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if room.GetStatus() != rooms.StatusLobby || s.adapter != nil {
		h.Send(client, Envelope{Type: "game.start.error", RequestID: env.RequestID, Payload: map[string]any{"code": "wrong_status", "message": "game already running"}})
		return
	}

	// The next game is either the vote winner or a random playlist pick.
	gameType := room.GetNextGameType()
	if gameType == "" {
		playlist := room.GetPlaylist()
		if len(playlist) == 0 {
			h.Send(client, Envelope{Type: "game.start.error", RequestID: env.RequestID, Payload: map[string]any{"code": "empty_playlist", "message": "no games in playlist"}})
			return
		}
		gameType = playlist[rand.Intn(len(playlist))]
	}
	factory, ok := h.registry.Get(gameType)
	if !ok {
		h.Send(client, Envelope{Type: "game.start.error", RequestID: env.RequestID, Payload: map[string]any{"code": "invalid_game", "message": "game not found"}})
		return
	}
	if len(room.ConnectedPlayerIDs()) < factory.MinConnected() {
		h.Send(client, Envelope{Type: "game.start.error", RequestID: env.RequestID, Payload: map[string]any{"code": "not_enough_players", "message": "not enough players for this game", "minPlayers": factory.MinConnected()}})
		return
	}

	settings, _ := env.Payload["settings"].(map[string]any)
	adapter := factory.New()
	adapter.Start(roomID, games.Options{Room: room, Locale: room.Locale, Settings: settings})
	s.adapter = adapter
	room.SetCurrentGame(factory.Type, factory.Name)
	room.SetNextGame("", "")
	room.SetStatus(rooms.StatusPlaying)
	room.ResetReady()

	h.Send(client, Envelope{Type: "game.start.ok", RequestID: env.RequestID, Payload: map[string]any{"gameType": factory.Type, "gameName": factory.Name}})
	h.broadcastRoom(roomID)
	h.broadcastGameState(roomID, adapter)
	h.armGameTimer(roomID, s)
}

func (h *Hub) handleGameAction(client *Client, env Envelope) {
	roomID := client.RoomID
	if roomID == "" {
		h.Send(client, Envelope{Type: "game.action.error", RequestID: env.RequestID, Payload: map[string]any{"code": "not_in_room", "message": "not in room"}})
		return
	}

	s, ok := h.session(roomID)
	if !ok {
		h.Send(client, Envelope{Type: "game.action.error", RequestID: env.RequestID, Payload: map[string]any{"code": "game_missing", "message": "session not initialized"}})
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.adapter == nil {
		h.Send(client, Envelope{Type: "game.action.error", RequestID: env.RequestID, Payload: map[string]any{"code": "no_active_game", "message": "no game running"}})
		return
	}
	if !s.pausedAt.IsZero() {
		h.Send(client, Envelope{Type: "game.action.error", RequestID: env.RequestID, Payload: map[string]any{"code": "paused", "message": "game is paused"}})
		return
	}

	if err := s.adapter.OnAction(client.Player.ID, env.Payload); err != nil {
		h.Send(client, Envelope{Type: "game.action.error", RequestID: env.RequestID, Payload: map[string]any{"code": "bad_action", "message": "invalid action"}})
		return
	}

	h.afterAdapterCall(roomID, s)
	h.Send(client, Envelope{Type: "game.action.ok", RequestID: env.RequestID})
}

func (h *Hub) hydratePrivateState(roomID string, game games.Adapter) {
	h.mu.RLock()
	clients := make([]*Client, 0)
	for _, client := range h.clients {
		if client.RoomID == roomID {
			clients = append(clients, client)
		}
	}
	h.mu.RUnlock()

	for _, client := range clients {
		h.Send(client, Envelope{Type: "game.state", RoomID: roomID, Payload: map[string]any{"private": game.PrivateState(client.Player.ID)}})
	}
}
