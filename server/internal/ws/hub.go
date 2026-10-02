package ws

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"math/rand"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"

	"gemu-server/internal/games"
	"gemu-server/internal/rooms"
)

type Hub struct {
	mu            sync.RWMutex
	clients       map[string]*Client
	rooms         *rooms.Manager
	registry      *games.Registry
	sessions      map[string]*gameSession
	connLimit     *ipLimiters // per-IP new connections
	createLimit   *ipLimiters // per-IP room creation
	joinFailLimit *ipLimiters // per-IP failed joins (code/password guessing)
	store         RoomStore   // optional durability (nil = in-memory only)
}

func NewHub(registry *games.Registry) *Hub {
	return &Hub{
		clients:       make(map[string]*Client),
		rooms:         rooms.NewManager(),
		registry:      registry,
		sessions:      make(map[string]*gameSession),
		connLimit:     newIPLimiters(connRatePerSec, connBurst),
		createLimit:   newIPLimiters(roomCreateRatePerSec, roomCreateBurst),
		joinFailLimit: newIPLimiters(joinFailRatePerSec, joinFailBurst),
	}
}

func (h *Hub) AddClient(conn *websocket.Conn, ip string) *Client {
	client := newClient(conn, ip)
	h.mu.Lock()
	h.clients[client.ID] = client
	h.mu.Unlock()
	return client
}

// ClientCount reports the number of live connections, for the global cap.
func (h *Hub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// AllowConnection rate-limits new connections per client IP (loopback exempt).
func (h *Hub) AllowConnection(ip string) bool {
	if isLoopback(ip) {
		return true
	}
	return h.connLimit.allow(ip)
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

// ident snapshots a connection's room identity. Another goroutine (a kick, a
// session takeover) may rebind any client, so handlers read these fields
// through here rather than straight off the struct.
func (h *Hub) ident(client *Client) (roomID, playerID string) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return client.RoomID, client.Player.ID
}

// boundToPlayerLocked reports whether any client other than except is bound
// to playerID in roomID (or holds sessionID there). Requires h.mu.
func (h *Hub) boundToPlayerLocked(roomID, playerID, sessionID string, except *Client) bool {
	for _, other := range h.clients {
		if other == except || other.RoomID != roomID {
			continue
		}
		if other.Player.ID == playerID || (sessionID != "" && other.SessionID == sessionID) {
			return true
		}
	}
	return false
}

func (h *Hub) RemoveClient(clientID string) {
	// Runs from the read loop's defer, outside the per-message recover: an
	// adapter panic in here must not take the whole process down.
	defer func() {
		if rec := recover(); rec != nil {
			log.Printf("recovered panic removing client %s: %v", clientID, rec)
		}
	}()

	h.mu.Lock()
	client, ok := h.clients[clientID]
	delete(h.clients, clientID)
	if !ok {
		h.mu.Unlock()
		return
	}
	roomID, playerID := client.RoomID, client.Player.ID
	var room *rooms.Room
	// Mark the player disconnected only if no other connection is bound to
	// them (a reconnect/takeover that landed before this old socket drained).
	// The check and the update happen under h.mu, the same lock a join binds
	// under, so a concurrent rejoin can't be flipped back to disconnected.
	if roomID != "" && !h.boundToPlayerLocked(roomID, playerID, client.SessionID, client) {
		if r, err := h.rooms.UpdatePlayer(roomID, playerID, func(player *rooms.Player) {
			player.Connected = false
			player.LastSeen = time.Now()
		}); err == nil {
			room = r
		}
	}
	h.mu.Unlock()
	client.close()

	if room == nil {
		return
	}
	h.Broadcast(roomID, Envelope{Type: "room.updated", RoomID: roomID, Payload: room.Snapshot()})
	h.Broadcast(roomID, Envelope{Type: "room.playerDisconnected", RoomID: roomID, Payload: map[string]any{"playerId": playerID}})
	h.onConnectivityChange(roomID, room)
}

// onConnectivityChange lets the running game re-check "everyone submitted"
// gates (deferred until resume while paused) and re-checks an open vote,
// since a disconnected voter no longer counts toward "everyone voted".
func (h *Hub) onConnectivityChange(roomID string, room *rooms.Room) {
	s, ok := h.session(roomID)
	if !ok {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.adapter != nil {
		if !s.pausedAt.IsZero() {
			s.pendingRoomChange = true
		} else {
			s.adapter.OnRoomChange()
			h.afterAdapterCall(roomID, s)
		}
	}
	h.maybeResolveVote(roomID, room, s)
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

// liveHolderElsewhere reports whether a connection other than client holds
// sessionID bound to a room other than roomID (a second tab in another
// room): that still blocks the join. A holder in the SAME room is the old
// socket of a reconnecting player and gets taken over instead.
func (h *Hub) liveHolderElsewhere(client *Client, sessionID, roomID string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, other := range h.clients {
		if other != client && other.SessionID == sessionID && other.RoomID != "" && other.RoomID != roomID {
			return true
		}
	}
	return false
}

// takeOverSession unbinds every other connection holding sessionID in roomID
// and tells it so. The old socket is left open (not closed): the web client
// auto-reconnects on close, and two live tabs would then steal the seat back
// and forth forever. An actually-dead socket times out on its own.
func (h *Hub) takeOverSession(client *Client, sessionID, roomID string) {
	h.mu.Lock()
	var replaced []*Client
	for _, other := range h.clients {
		if other != client && other.SessionID == sessionID && other.RoomID == roomID {
			other.RoomID = ""
			other.Player = rooms.Player{}
			other.SessionID = ""
			replaced = append(replaced, other)
		}
	}
	h.mu.Unlock()
	for _, old := range replaced {
		h.Send(old, Envelope{Type: "room.sessionReplaced", RoomID: roomID, Payload: map[string]any{"reason": "session_replaced"}})
	}
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
	h.evictStaleSession(sessionID, exceptRoomID)
	return false
}

// evictStaleSession removes sessionID's disconnected ghost from any room
// other than exceptRoomID.
func (h *Hub) evictStaleSession(sessionID string, exceptRoomID string) {
	roomID, player, ok := h.rooms.FindPlayerBySession(sessionID)
	if !ok || roomID == exceptRoomID {
		return
	}
	if room, err := h.rooms.RemovePlayer(roomID, player.ID); err == nil {
		h.notifyPlayerLeft(roomID, player.ID)
		h.Broadcast(roomID, Envelope{Type: "room.playerLeft", RoomID: roomID, Payload: map[string]any{"playerId": player.ID}})
		h.Broadcast(roomID, Envelope{Type: "room.updated", RoomID: roomID, Payload: room.Snapshot()})
		h.cleanupIfEmpty(roomID, room)
	}
}

func (h *Hub) Broadcast(roomID string, env Envelope) {
	h.BroadcastExcept(roomID, "", env)
}

func (h *Hub) BroadcastExcept(roomID string, exceptClientID string, env Envelope) {
	// Snapshot targets under the lock, serialize once, then enqueue: enqueue
	// never blocks, so a stalled socket can't hold up the room.
	h.mu.RLock()
	targets := make([]*Client, 0, len(h.clients))
	for _, client := range h.clients {
		if client.RoomID == roomID && client.ID != exceptClientID {
			targets = append(targets, client)
		}
	}
	h.mu.RUnlock()
	if len(targets) == 0 {
		return
	}
	b, err := json.Marshal(env)
	if err != nil {
		log.Printf("marshal %s for room %s: %v", env.Type, roomID, err)
		return
	}
	for _, client := range targets {
		client.enqueue(b)
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
// Only games implementing games.Streamer relay, and only for senders they
// accept (e.g. the current drawer); everything else is dropped silently — no
// error replies at stroke frequency.
func (h *Hub) handleGameStream(client *Client, env Envelope) {
	roomID, playerID := h.ident(client)
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
	allowed := func() bool {
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.adapter == nil || !s.pausedAt.IsZero() {
			return false
		}
		streamer, ok := s.adapter.(games.Streamer)
		return ok && streamer.AcceptStream(playerID, action)
	}()
	if !allowed {
		return
	}
	payload := make(map[string]any, len(env.Payload)+1)
	for k, v := range env.Payload {
		payload[k] = v
	}
	payload["playerId"] = playerID
	h.BroadcastExcept(roomID, client.ID, Envelope{Type: "game.stream", RoomID: roomID, Payload: payload})
}

func (h *Hub) HandleMessage(client *Client, env Envelope) {
	// Per-connection token bucket over every message type (ready toggles and
	// other snapshot-triggering requests included). Streams drop silently.
	if !client.allow(env.Type) {
		if env.Type != "game.stream" {
			h.Send(client, Envelope{Type: "system.error", RequestID: env.RequestID, Payload: map[string]any{"code": "rate_limited", "message": "too many messages, slow down"}})
		}
		return
	}
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
	case "lobby.decks.list":
		h.handleDecksList(client, env)
	case "session.cahdecks.set":
		h.handleCahDecksSet(client, env)
	case "session.deck.add":
		h.handleDeckAdd(client, env)
	case "session.next.random":
		h.handleSessionNextRandom(client, env)
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

const (
	maxNameLen     = 40
	maxRoomNameLen = 60
	maxAvatarLen   = 256 * 1024 // doodle avatars are small data: URLs
	maxPasswordLen = 100
	roomPlayerCap  = 16 // hard ceiling regardless of client maxPlayers
	roomPlayerMin  = 2  // every game needs at least two players
	// awful.chat session ids are short random tokens; anything longer is junk.
	maxExternalKeyLen = 128
	// Client session ids are UUIDs; cap junk so it can't bloat persistence.
	maxSessionIDLen = 128
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

// clampMaxPlayers turns a client value into a sane room size in
// [roomPlayerMin, roomPlayerCap]; 0/negative means "no explicit limit", which
// we still cap at roomPlayerCap. Every game needs at least two players, so a
// one-seat room could never start anything.
func clampMaxPlayers(v int) int {
	if v <= 0 || v > roomPlayerCap {
		return roomPlayerCap
	}
	if v < roomPlayerMin {
		return roomPlayerMin
	}
	return v
}

func (h *Hub) handleRoomCreate(client *Client, env Envelope) {
	// A connection already bound to a room must leave it first; otherwise
	// rebinding orphans a connected ghost player that never gets cleaned up.
	if currentRoom, _ := h.ident(client); currentRoom != "" {
		h.Send(client, Envelope{Type: "room.create.error", RequestID: env.RequestID, Payload: map[string]any{"code": "already_in_room", "message": "leave your current room first"}})
		return
	}
	if !isLoopback(client.IP) && !h.createLimit.allow(client.IP) {
		h.Send(client, Envelope{Type: "room.create.error", RequestID: env.RequestID, Payload: map[string]any{"code": "rate_limited", "message": "too many rooms created, slow down"}})
		return
	}
	if h.rooms.Count() >= maxRooms {
		h.Send(client, Envelope{Type: "room.create.error", RequestID: env.RequestID, Payload: map[string]any{"code": "server_full", "message": "server is at capacity, try again later"}})
		return
	}
	name := games.TruncateText(decodeString(env.Payload, "name"), maxRoomNameLen)
	visibility := decodeString(env.Payload, "visibility")
	maxPlayers := clampMaxPlayers(decodeInt(env.Payload, "maxPlayers"))
	displayName := games.TruncateText(decodeString(env.Payload, "displayName"), maxNameLen)
	avatarURL := sanitizeAvatar(games.TruncateText(decodeString(env.Payload, "avatarUrl"), maxAvatarLen))
	sessionID := games.TruncateText(decodeString(env.Payload, "sessionId"), maxSessionIDLen)
	password := games.TruncateText(decodeString(env.Payload, "password"), maxPasswordLen)
	locale := decodeString(env.Payload, "locale")
	if locale != "pt-BR" {
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
	playlist, ok := h.cleanPlaylist(playlist)
	if !ok {
		h.Send(client, Envelope{Type: "room.create.error", RequestID: env.RequestID, Payload: map[string]any{"code": "invalid_game", "message": "game not found"}})
		return
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
	// The manager re-rolls it on a collision.
	room := &rooms.Room{
		ID:         uuid.NewString(),
		Name:       name,
		Visibility: rooms.Visibility(visibility),
		JoinCode:   rooms.NewJoinCode(),
		Password:   password,
		MaxPlayers: maxPlayers,
		Locale:     locale,
		Playlist:   playlist,
	}
	h.rooms.Create(room)

	h.mu.Lock()
	h.sessions[room.ID] = &gameSession{}
	h.mu.Unlock()

	player, err := room.TryAddPlayer(rooms.Player{ID: uuid.NewString(), Name: displayName, AvatarURL: avatarURL, SessionID: sessionID, Connected: true, Ready: false, LastSeen: time.Now()}, false)
	if err != nil {
		h.Send(client, Envelope{Type: "room.create.error", RequestID: env.RequestID, Payload: map[string]any{"code": "room_full", "message": "room full"}})
		return
	}

	h.bindClient(client, room.ID, player, sessionID)

	h.Send(client, Envelope{Type: "room.create.ok", RequestID: env.RequestID, RoomID: room.ID, Payload: withPlayerID(room.Snapshot(), player.ID)})
	h.Broadcast(room.ID, Envelope{Type: "room.updated", RoomID: room.ID, Payload: room.Snapshot()})
}

// cleanPlaylist dedupes a client playlist (order kept) and rejects unknown
// games. Every entry is a distinct registered game, so the length is bounded
// by the registry size.
func (h *Hub) cleanPlaylist(playlist []string) ([]string, bool) {
	out := make([]string, 0, len(playlist))
	for _, gameType := range playlist {
		if _, ok := h.registry.Get(gameType); !ok {
			return nil, false
		}
		if !containsString(out, gameType) {
			out = append(out, gameType)
		}
	}
	return out, len(out) > 0
}

// joinFailed replies with a join error and, for guessable failures (unknown
// room/code, wrong password), spends the IP's failed-join budget.
func (h *Hub) joinFailed(client *Client, env Envelope, code, message string) {
	switch code {
	case "not_found", "invalid_code", "invalid_password":
		if !isLoopback(client.IP) {
			h.joinFailLimit.allow(client.IP)
		}
	}
	h.Send(client, Envelope{Type: "room.join.error", RequestID: env.RequestID, Payload: map[string]any{"code": code, "message": message}})
}

func (h *Hub) handleRoomJoin(client *Client, env Envelope) {
	roomID := decodeString(env.Payload, "roomId")
	joinCode := decodeString(env.Payload, "joinCode")
	displayName := games.TruncateText(decodeString(env.Payload, "displayName"), maxNameLen)
	avatarURL := sanitizeAvatar(games.TruncateText(decodeString(env.Payload, "avatarUrl"), maxAvatarLen))
	sessionID := games.TruncateText(decodeString(env.Payload, "sessionId"), maxSessionIDLen)
	isRejoin := false

	if displayName == "" || sessionID == "" {
		h.Send(client, Envelope{Type: "room.join.error", RequestID: env.RequestID, Payload: map[string]any{"code": "invalid_payload", "message": "missing required fields"}})
		return
	}
	// Brute-force guard: an IP that keeps failing code/password checks is
	// refused outright until its budget refills.
	if !isLoopback(client.IP) && h.joinFailLimit.exhausted(client.IP) {
		h.Send(client, Envelope{Type: "room.join.error", RequestID: env.RequestID, Payload: map[string]any{"code": "rate_limited", "message": "too many failed join attempts, slow down"}})
		return
	}

	// Resolve the room by id, or by join code when only a code is supplied
	// (the "join the party" flow enters just a code), or by the embedding
	// host's session (awful.chat): everyone opening the same app card lands
	// in the same room, created by whoever opens it first.
	var room *rooms.Room
	var ok bool
	awfulSession := decodeString(env.Payload, "awfulSession")
	viaExternal := false
	if roomID != "" {
		room, ok = h.rooms.Get(roomID)
	} else if joinCode != "" {
		room, ok = h.rooms.FindByCode(joinCode)
	}
	// Embedded in awful.chat without an explicit room (or the code it was
	// started with is gone): use the room bound to the host's app session.
	if (!ok || room == nil) && roomID == "" && awfulSession != "" {
		var code string
		room, code = h.awfulRoom(client, env, awfulSession)
		if room == nil {
			h.Send(client, Envelope{Type: "room.join.error", RequestID: env.RequestID, Payload: map[string]any{"code": code, "message": "could not open the room"}})
			return
		}
		ok, viaExternal = true, true
	}
	if !ok || room == nil {
		h.joinFailed(client, env, "not_found", "room not found")
		return
	}
	roomID = room.ID

	// Reject a join from a connection already bound to a different room; without
	// this, rebinding strands a connected ghost player in the old room.
	if currentRoom, _ := h.ident(client); currentRoom != "" && currentRoom != roomID {
		h.Send(client, Envelope{Type: "room.join.error", RequestID: env.RequestID, Payload: map[string]any{"code": "already_in_room", "message": "leave your current room first"}})
		return
	}

	// A live connection holding this session in ANOTHER room (a second tab)
	// blocks the join. One in THIS room is the old socket of a reconnecting
	// player; it is taken over below.
	if h.liveHolderElsewhere(client, sessionID, roomID) {
		h.Send(client, Envelope{Type: "room.join.error", RequestID: env.RequestID, Payload: map[string]any{"code": "session_in_room", "message": "session already in room"}})
		return
	}

	// A member reconnecting by session doesn't need the code or password
	// again: they proved it when they first joined.
	_, alreadyMember := room.FindPlayerBySession(sessionID)
	if !viaExternal && !alreadyMember && room.Visibility == rooms.Private && room.JoinCode != strings.ToUpper(strings.TrimSpace(joinCode)) {
		h.joinFailed(client, env, "invalid_code", "invalid join code")
		return
	}

	if !viaExternal && !alreadyMember && room.Password != "" && decodeString(env.Payload, "password") != room.Password {
		h.joinFailed(client, env, "invalid_password", "invalid password")
		return
	}

	// Past auth: take the seat over from a stale socket of this session in
	// this room, and evict the session's ghost from any other room.
	h.takeOverSession(client, sessionID, roomID)
	h.evictStaleSession(sessionID, roomID)

	var player rooms.Player
	if existing, ok := room.FindPlayerBySession(sessionID); ok {
		isRejoin = true
		// On rejoin a conflicting rename silently keeps the old name rather
		// than blocking the reconnect.
		nameConflict := room.NameTaken(displayName, existing.ID)
		// Mark connected and bind in one h.mu section: RemoveClient checks
		// "is anyone bound to this player" under the same lock, so the old
		// socket draining concurrently can't flip us back to disconnected.
		h.mu.Lock()
		_, err := h.rooms.UpdatePlayer(room.ID, existing.ID, func(p *rooms.Player) {
			p.Connected = true
			p.LastSeen = time.Now()
			if !nameConflict {
				p.Name = displayName
			}
			if avatarURL != "" {
				p.AvatarURL = avatarURL
			}
			player = *p
		})
		if err == nil {
			client.RoomID = room.ID
			client.Player = player
			client.SessionID = sessionID
		}
		h.mu.Unlock()
		if err != nil {
			h.Send(client, Envelope{Type: "room.join.error", RequestID: env.RequestID, Payload: map[string]any{"code": "not_found", "message": "player not found"}})
			return
		}
	} else {
		// Capacity, name check and insert happen atomically in the room, so
		// concurrent joins can't overfill it or share a name. Embedded in
		// awful.chat the host's names are labels, not unique: two people can
		// share one, so it's suffixed instead of refusing someone already in
		// the call.
		seated, err := room.TryAddPlayer(rooms.Player{ID: uuid.NewString(), Name: displayName, AvatarURL: avatarURL, SessionID: sessionID, Connected: true, Ready: false, LastSeen: time.Now()}, awfulSession != "")
		switch {
		case errors.Is(err, rooms.ErrNameTaken):
			h.Send(client, Envelope{Type: "room.join.error", RequestID: env.RequestID, Payload: map[string]any{"code": "name_taken", "message": "display name already in use"}})
			return
		case err != nil:
			h.Send(client, Envelope{Type: "room.join.error", RequestID: env.RequestID, Payload: map[string]any{"code": "room_full", "message": "room full"}})
			return
		}
		player = seated
		h.bindClient(client, room.ID, player, sessionID)
	}

	h.Send(client, Envelope{Type: "room.join.ok", RequestID: env.RequestID, RoomID: room.ID, Payload: withPlayerID(room.Snapshot(), player.ID)})
	if !isRejoin {
		h.Broadcast(room.ID, Envelope{Type: "room.playerJoined", RoomID: room.ID, Payload: map[string]any{"player": player}})
	}
	h.Broadcast(room.ID, Envelope{Type: "room.updated", RoomID: room.ID, Payload: room.Snapshot()})
	if s, ok := h.session(room.ID); ok {
		h.syncJoiner(client, room, s, player.ID, isRejoin)
	}
}

// syncJoiner hands a (re)joining player the live game and vote state. A
// brand-new player is announced to the running game first, then the usual
// post-adapter routine broadcasts state and re-arms the timer. While paused
// the announcement is queued (replayed on resume after Shift, like leaves):
// the game must not change phase while frozen.
func (h *Hub) syncJoiner(client *Client, room *rooms.Room, s *gameSession, playerID string, isRejoin bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	roomID := room.ID
	if s.adapter != nil && !isRejoin {
		if !s.pausedAt.IsZero() {
			s.pendingJoins = append(s.pendingJoins, playerID)
		} else {
			s.adapter.OnPlayerJoin(playerID)
			h.afterAdapterCall(roomID, s)
		}
	}
	if s.adapter != nil {
		h.Send(client, Envelope{Type: "game.state", RoomID: roomID, Payload: map[string]any{
			"public":    s.adapter.PublicState(),
			"private":   s.adapter.PrivateState(playerID),
			"standings": memberStandings(room, s.adapter.Standings()),
		}})
		if isRejoin {
			// A reconnect changes who's connected: let the game re-check its
			// gates now (e.g. a Gartic drawer back from a refresh resumes the
			// turn instead of waiting out the grace timer).
			if s.pausedAt.IsZero() {
				s.adapter.OnRoomChange()
				h.afterAdapterCall(roomID, s)
			} else {
				s.pendingRoomChange = true
			}
		}
	}
	// Replay the open next-game vote so a rejoiner isn't stuck on a blank
	// voting screen (the session.vote push already fired before they joined).
	if s.votes != nil && len(s.voteOptions) > 0 {
		options := make([]map[string]string, 0, len(s.voteOptions))
		for _, gameType := range s.voteOptions {
			options = append(options, h.gameOption(gameType))
		}
		h.Send(client, Envelope{Type: "session.vote", RoomID: roomID, Payload: map[string]any{
			"options":  options,
			"deadline": s.voteDeadline.UnixMilli(),
		}})
		h.Send(client, Envelope{Type: "session.vote.update", RoomID: roomID, Payload: map[string]any{"counts": voteCounts(s)}})
	}
}

// awfulRoom finds or creates the room bound to an awful.chat app session. The
// session id is a bearer value shared by the host's room members, so only
// its hash is kept. On failure it returns nil and an error code.
func (h *Hub) awfulRoom(client *Client, env Envelope, awfulSession string) (*rooms.Room, string) {
	if len(awfulSession) > maxExternalKeyLen {
		return nil, "invalid_payload"
	}
	sum := sha256.Sum256([]byte("awful/1\n" + awfulSession))
	key := hex.EncodeToString(sum[:])

	refusal := ""
	room, _ := h.rooms.FindOrCreateExternal(key, func(roomCount int) *rooms.Room {
		if !isLoopback(client.IP) && !h.createLimit.allow(client.IP) {
			refusal = "rate_limited"
			return nil
		}
		if roomCount >= maxRooms {
			refusal = "server_full"
			return nil
		}
		locale := decodeString(env.Payload, "locale")
		if locale != "pt-BR" {
			locale = "en"
		}
		playlist := make([]string, 0)
		for _, gameType := range decodeStringSlice(env.Payload, "playlist") {
			if _, ok := h.registry.Get(gameType); ok && !containsString(playlist, gameType) {
				playlist = append(playlist, gameType)
			}
		}
		if len(playlist) == 0 {
			playlist = h.registry.Types()
		}
		name := games.TruncateText(decodeString(env.Payload, "roomName"), maxRoomNameLen)
		if name == "" {
			name = "Gemu"
		}
		return &rooms.Room{
			ID:         uuid.NewString(),
			Name:       name,
			Visibility: rooms.Private,
			JoinCode:   rooms.NewJoinCode(),
			MaxPlayers: roomPlayerCap,
			Locale:     locale,
			Playlist:   playlist,
		}
	})
	if room == nil {
		if refusal == "" {
			refusal = "invalid_payload"
		}
		return nil, refusal
	}
	// Ensure the session exists even when a concurrent opener created the
	// room an instant ago and hasn't registered it yet.
	h.mu.Lock()
	if _, ok := h.sessions[room.ID]; !ok {
		h.sessions[room.ID] = &gameSession{}
	}
	h.mu.Unlock()
	return room, ""
}

// withPlayerID tells the joining client which seat is theirs, so it never has
// to guess from display names (which the server may have suffixed).
func withPlayerID(snapshot map[string]any, playerID string) map[string]any {
	snapshot["playerId"] = playerID
	return snapshot
}

func containsString(list []string, value string) bool {
	return indexString(list, value) >= 0
}

func indexString(list []string, value string) int {
	for i, item := range list {
		if item == value {
			return i
		}
	}
	return -1
}

func (h *Hub) handleRoomLeave(client *Client, env Envelope) {
	roomID, playerID := h.ident(client)
	if roomID == "" {
		h.Send(client, Envelope{Type: "room.leave.error", RequestID: env.RequestID, Payload: map[string]any{"code": "not_in_room", "message": "not in room"}})
		return
	}

	room, err := h.rooms.RemovePlayer(roomID, playerID)
	if err != nil {
		h.Send(client, Envelope{Type: "room.leave.error", RequestID: env.RequestID, Payload: map[string]any{"code": "not_found", "message": "room not found"}})
		return
	}

	h.unbindClient(client)
	h.notifyPlayerLeft(roomID, playerID)
	h.Send(client, Envelope{Type: "room.leave.ok", RequestID: env.RequestID})
	h.Broadcast(roomID, Envelope{Type: "room.playerLeft", RoomID: roomID, Payload: map[string]any{"playerId": playerID}})
	h.Broadcast(roomID, Envelope{Type: "room.updated", RoomID: roomID, Payload: room.Snapshot()})
	h.cleanupIfEmpty(roomID, room)
}

// notifyPlayerLeft forwards a permanent leave (leave/kick/eviction; the player
// is already removed from the room) to the running game — deferred until
// resume while paused — and drops their next-game ballot, re-checking whether
// everyone still present has now voted.
func (h *Hub) notifyPlayerLeft(roomID, playerID string) {
	s, ok := h.session(roomID)
	if !ok {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.adapter != nil {
		if !s.pausedAt.IsZero() {
			// Joined and left within the same pause: the game never heard of
			// them, so drop the queued join instead of replaying both.
			if i := indexString(s.pendingJoins, playerID); i >= 0 {
				s.pendingJoins = append(s.pendingJoins[:i], s.pendingJoins[i+1:]...)
			} else {
				s.pendingLeaves = append(s.pendingLeaves, playerID)
			}
		} else {
			s.adapter.OnPlayerLeave(playerID)
			h.afterAdapterCall(roomID, s)
		}
	}
	if s.votes != nil {
		_, hadBallot := s.votes[playerID]
		delete(s.votes, playerID)
		room, ok := h.rooms.Get(roomID)
		if ok && !h.maybeResolveVote(roomID, room, s) && hadBallot {
			h.Broadcast(roomID, Envelope{Type: "session.vote.update", RoomID: roomID, Payload: map[string]any{"counts": voteCounts(s)}})
		}
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
	h.persistDelete(roomID)
	h.mu.Lock()
	s, ok := h.sessions[roomID]
	delete(h.sessions, roomID)
	h.mu.Unlock()
	if ok {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.adapter = nil
		s.stopTimer()
		s.cancelPendingState()
		s.clearPause()
		s.voteOptions = nil
		s.votes = nil
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
	roomID, adminID := h.ident(client)
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

	if room.AdminID() != adminID {
		h.Send(client, Envelope{Type: "room.kick.error", RequestID: env.RequestID, Payload: map[string]any{"code": "not_admin", "message": "admin only"}})
		return
	}
	if targetID == adminID {
		h.Send(client, Envelope{Type: "room.kick.error", RequestID: env.RequestID, Payload: map[string]any{"code": "invalid_target", "message": "use room.leave to leave"}})
		return
	}
	// The target must be a member of the admin's room: an admin of one room
	// must not be able to unbind players of another.
	if !room.HasPlayer(targetID) {
		h.Send(client, Envelope{Type: "room.kick.error", RequestID: env.RequestID, Payload: map[string]any{"code": "not_found", "message": "player not found"}})
		return
	}

	if _, err := h.rooms.RemovePlayer(roomID, targetID); err != nil {
		h.Send(client, Envelope{Type: "room.kick.error", RequestID: env.RequestID, Payload: map[string]any{"code": "not_found", "message": "player not found"}})
		return
	}

	// Unbind only connections seated as the target in THIS room.
	var kicked []*Client
	h.mu.Lock()
	for _, c := range h.clients {
		if c.RoomID == roomID && c.Player.ID == targetID {
			c.RoomID = ""
			c.Player = rooms.Player{}
			c.SessionID = ""
			kicked = append(kicked, c)
		}
	}
	h.mu.Unlock()

	h.notifyPlayerLeft(roomID, targetID)

	h.Send(client, Envelope{Type: "room.kick.ok", RequestID: env.RequestID})
	for _, c := range kicked {
		h.Send(c, Envelope{Type: "room.kicked", RoomID: roomID, Payload: map[string]any{"reason": "kicked"}})
	}
	h.Broadcast(roomID, Envelope{Type: "room.playerLeft", RoomID: roomID, Payload: map[string]any{"playerId": targetID}})
	h.Broadcast(roomID, Envelope{Type: "room.updated", RoomID: roomID, Payload: room.Snapshot()})
	h.cleanupIfEmpty(roomID, room)
}

func (h *Hub) handleRoomReadySet(client *Client, env Envelope) {
	roomID, playerID := h.ident(client)
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
	room, err := h.rooms.UpdatePlayer(roomID, playerID, func(player *rooms.Player) {
		player.Ready = ready
		player.LastSeen = time.Now()
	})
	if err != nil {
		h.Send(client, Envelope{Type: "room.ready.set.error", RequestID: env.RequestID, Payload: map[string]any{"code": "not_found", "message": "room not found"}})
		return
	}
	h.Send(client, Envelope{Type: "room.ready.set.ok", RequestID: env.RequestID})
	h.Broadcast(roomID, Envelope{Type: "room.updated", RoomID: roomID, Payload: room.Snapshot()})
}

func (h *Hub) handleGameStart(client *Client, env Envelope) {
	roomID, playerID := h.ident(client)
	if roomID == "" {
		h.Send(client, Envelope{Type: "game.start.error", RequestID: env.RequestID, Payload: map[string]any{"code": "not_in_room", "message": "not in room"}})
		return
	}

	room, ok := h.rooms.Get(roomID)
	if !ok {
		h.Send(client, Envelope{Type: "game.start.error", RequestID: env.RequestID, Payload: map[string]any{"code": "not_found", "message": "room not found"}})
		return
	}

	if room.AdminID() != playerID {
		h.Send(client, Envelope{Type: "game.start.error", RequestID: env.RequestID, Payload: map[string]any{"code": "not_admin", "message": "admin only"}})
		return
	}
	if len(room.ConnectedPlayerIDs()) < 2 {
		h.Send(client, Envelope{Type: "game.start.error", RequestID: env.RequestID, Payload: map[string]any{"code": "not_enough_players", "message": "need at least 2 players", "minPlayers": 2}})
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

	// The next game is either the vote winner / random pick, or (back-compat)
	// a random playlist game chosen right now.
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
	opts := games.Options{Room: room, Locale: room.Locale, Settings: settings}
	if factory.Type == "cah" {
		opts.Decks = s.resolveCahDecks(room.GetCahDeckIDs(), room.Locale)
	}
	// A previous game that ended mid-pause must not leave this one frozen.
	s.clearPause()
	room.SetPaused(false)
	adapter := factory.New()
	adapter.Start(roomID, opts)
	s.adapter = adapter
	s.timerLoopWarn = false
	s.cancelPendingState()
	s.lastState = time.Time{} // a new game's first state never waits
	room.SetCurrentGame(factory.Type, factory.Name)
	room.SetNextGame("", "")
	room.SetStatus(rooms.StatusPlaying)
	room.ResetReady()

	h.Send(client, Envelope{Type: "game.start.ok", RequestID: env.RequestID, Payload: map[string]any{"gameType": factory.Type, "gameName": factory.Name}})
	h.broadcastRoom(roomID)
	// Same routine as every other adapter call: a game that is already over
	// after Start (e.g. Gartic with too few connected players) is finalised
	// instead of left running with no timer.
	h.afterAdapterCall(roomID, s)
}

func (h *Hub) handleGameAction(client *Client, env Envelope) {
	roomID, playerID := h.ident(client)
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

	if err := s.adapter.OnAction(playerID, env.Payload); err != nil {
		h.Send(client, Envelope{Type: "game.action.error", RequestID: env.RequestID, Payload: map[string]any{"code": "bad_action", "message": err.Error()}})
		return
	}

	h.afterAdapterCall(roomID, s)
	h.Send(client, Envelope{Type: "game.action.ok", RequestID: env.RequestID})
}

// hydratePrivateState sends each seated client its private view. Caller holds
// s.mu (PrivateState reads adapter state).
func (h *Hub) hydratePrivateState(roomID string, game games.Adapter) {
	type seat struct {
		client   *Client
		playerID string
	}
	h.mu.RLock()
	seats := make([]seat, 0)
	for _, client := range h.clients {
		if client.RoomID == roomID {
			seats = append(seats, seat{client: client, playerID: client.Player.ID})
		}
	}
	h.mu.RUnlock()

	for _, st := range seats {
		h.Send(st.client, Envelope{Type: "game.state", RoomID: roomID, Payload: map[string]any{"private": game.PrivateState(st.playerID)}})
	}
}
