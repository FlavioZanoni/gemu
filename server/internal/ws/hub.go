package ws

import (
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
}

type Hub struct {
	mu       sync.RWMutex
	clients  map[string]*Client
	rooms    *rooms.Manager
	registry *games.Registry
	games    map[string]games.Adapter
}

func NewHub(registry *games.Registry) *Hub {
	return &Hub{
		clients:  make(map[string]*Client),
		rooms:    rooms.NewManager(),
		registry: registry,
		games:    make(map[string]games.Adapter),
	}
}

func (h *Hub) AddClient(conn *websocket.Conn) *Client {
	client := &Client{ID: uuid.NewString(), Conn: conn}
	h.mu.Lock()
	h.clients[client.ID] = client
	h.mu.Unlock()
	return client
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
		}
	}
}

func (h *Hub) Send(client *Client, env Envelope) {
	if client == nil || client.Conn == nil {
		return
	}
	_ = client.Conn.WriteJSON(env)
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

func (h *Hub) Broadcast(roomID string, env Envelope) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, client := range h.clients {
		if client.RoomID == roomID {
			if client.Conn == nil {
				continue
			}
			_ = client.Conn.WriteJSON(env)
		}
	}
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

func (h *Hub) handleRoomCreate(client *Client, env Envelope) {
	name := decodeString(env.Payload, "name")
	gameType := decodeString(env.Payload, "gameType")
	visibility := decodeString(env.Payload, "visibility")
	maxPlayers := decodeInt(env.Payload, "maxPlayers")
	displayName := decodeString(env.Payload, "displayName")
	avatarURL := decodeString(env.Payload, "avatarUrl")
	sessionID := decodeString(env.Payload, "sessionId")

	if name == "" || gameType == "" || displayName == "" || sessionID == "" {
		h.Send(client, Envelope{Type: "room.create.error", RequestID: env.RequestID, Payload: map[string]any{"code": "invalid_payload", "message": "missing required fields"}})
		return
	}
	factory, ok := h.registry.Get(gameType)
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

	if _, _, ok := h.rooms.FindPlayerBySession(sessionID); ok {
		h.Send(client, Envelope{Type: "room.create.error", RequestID: env.RequestID, Payload: map[string]any{"code": "session_in_room", "message": "session already in room"}})
		return
	}

	joinCode := ""
	if visibility == string(rooms.Private) {
		joinCode = strings.ToUpper(uuid.NewString()[:6])
	}

	room := &rooms.Room{
		ID: uuid.NewString(),
		Name: name,
		GameType: gameType,
		GameName: factory.Name,
		Visibility: rooms.Visibility(visibility),
		JoinCode: joinCode,
		MaxPlayers: maxPlayers,
	}
	h.rooms.Create(room)

	game := factory.New()
	game.Init(room.ID)
	h.games[room.ID] = game

	if _, ok := h.findClientBySession(sessionID); ok {
		h.Send(client, Envelope{Type: "room.create.error", RequestID: env.RequestID, Payload: map[string]any{"code": "session_in_room", "message": "session already in room"}})
		return
	}

	player := rooms.Player{ID: uuid.NewString(), Name: displayName, AvatarURL: avatarURL, SessionID: sessionID, Connected: true, Ready: false, LastSeen: time.Now()}
	if _, err := h.rooms.AddPlayer(room.ID, player); err != nil {
		h.Send(client, Envelope{Type: "room.create.error", RequestID: env.RequestID, Payload: map[string]any{"code": "room_full", "message": "room full"}})
		return
	}

	client.RoomID = room.ID
	client.Player = player
	client.SessionID = sessionID

	if game, ok := h.games[room.ID]; ok {
		game.OnPlayerJoin(player.ID)
	}

	h.Send(client, Envelope{Type: "room.create.ok", RequestID: env.RequestID, RoomID: room.ID, Payload: encodeRoomSnapshot(room)})
	h.Broadcast(room.ID, Envelope{Type: "room.updated", RoomID: room.ID, Payload: encodeRoomSnapshot(room)})
	h.Broadcast(room.ID, Envelope{Type: "game.state", RoomID: room.ID, Payload: map[string]any{"public": game.PublicState(), "private": game.PrivateState(player.ID)}})
}

func (h *Hub) handleRoomJoin(client *Client, env Envelope) {
	roomID := decodeString(env.Payload, "roomId")
	joinCode := decodeString(env.Payload, "joinCode")
	displayName := decodeString(env.Payload, "displayName")
	avatarURL := decodeString(env.Payload, "avatarUrl")
	sessionID := decodeString(env.Payload, "sessionId")
	isRejoin := false

	if roomID == "" || displayName == "" || sessionID == "" {
		h.Send(client, Envelope{Type: "room.join.error", RequestID: env.RequestID, Payload: map[string]any{"code": "invalid_payload", "message": "missing required fields"}})
		return
	}

	room, ok := h.rooms.Get(roomID)
	if !ok {
		h.Send(client, Envelope{Type: "room.join.error", RequestID: env.RequestID, Payload: map[string]any{"code": "not_found", "message": "room not found"}})
		return
	}

	if existingRoomID, _, ok := h.rooms.FindPlayerBySession(sessionID); ok && existingRoomID != roomID {
		h.Send(client, Envelope{Type: "room.join.error", RequestID: env.RequestID, Payload: map[string]any{"code": "session_in_room", "message": "session already in room"}})
		return
	}

	if room.Visibility == rooms.Private && room.JoinCode != strings.ToUpper(joinCode) {
		h.Send(client, Envelope{Type: "room.join.error", RequestID: env.RequestID, Payload: map[string]any{"code": "invalid_code", "message": "invalid join code"}})
		return
	}

	var player rooms.Player
	if existing, ok := room.FindPlayerBySession(sessionID); ok {
		player = existing
		isRejoin = true
		if _, err := h.rooms.UpdatePlayer(room.ID, player.ID, func(p *rooms.Player) {
			p.Connected = true
			p.LastSeen = time.Now()
			p.Name = displayName
			if avatarURL != "" {
				p.AvatarURL = avatarURL
			}
		}); err != nil {
			h.Send(client, Envelope{Type: "room.join.error", RequestID: env.RequestID, Payload: map[string]any{"code": "not_found", "message": "player not found"}})
			return
		}
	} else {
		if _, ok := h.findClientBySession(sessionID); ok {
			h.Send(client, Envelope{Type: "room.join.error", RequestID: env.RequestID, Payload: map[string]any{"code": "session_in_room", "message": "session already in room"}})
			return
		}
		player = rooms.Player{ID: uuid.NewString(), Name: displayName, AvatarURL: avatarURL, SessionID: sessionID, Connected: true, Ready: false, LastSeen: time.Now()}
		if _, err := h.rooms.AddPlayer(room.ID, player); err != nil {
			h.Send(client, Envelope{Type: "room.join.error", RequestID: env.RequestID, Payload: map[string]any{"code": "room_full", "message": "room full"}})
			return
		}
		if game, ok := h.games[room.ID]; ok {
			game.OnPlayerJoin(player.ID)
		}
	}

	if isRejoin {
		if updated, ok := room.FindPlayerBySession(sessionID); ok {
			player = updated
		}
	}

	client.RoomID = room.ID
	client.Player = player
	client.SessionID = sessionID

	h.Send(client, Envelope{Type: "room.join.ok", RequestID: env.RequestID, RoomID: room.ID, Payload: room.Snapshot()})
	if !isRejoin {
		h.Broadcast(room.ID, Envelope{Type: "room.playerJoined", RoomID: room.ID, Payload: map[string]any{"player": player}})
	}
	h.Broadcast(room.ID, Envelope{Type: "room.updated", RoomID: room.ID, Payload: room.Snapshot()})
	if game, ok := h.games[room.ID]; ok {
		h.Send(client, Envelope{Type: "game.state", RoomID: room.ID, Payload: map[string]any{"public": game.PublicState(), "private": game.PrivateState(player.ID)}})
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
	client.RoomID = ""
	client.Player = rooms.Player{}
	client.SessionID = ""
	if game, ok := h.games[roomID]; ok {
		game.OnPlayerLeave(playerID)
	}
	h.Send(client, Envelope{Type: "room.leave.ok", RequestID: env.RequestID})
	h.Broadcast(roomID, Envelope{Type: "room.playerLeft", RoomID: roomID, Payload: map[string]any{"playerId": playerID}})
	h.Broadcast(roomID, Envelope{Type: "room.updated", RoomID: roomID, Payload: encodeRoomSnapshot(room)})
	if room.PlayerCount() == 0 {
		h.rooms.Remove(roomID)
		delete(h.games, roomID)
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

	if game, ok := h.games[roomID]; ok {
		game.OnPlayerLeave(targetID)
	}

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
	if room.PlayerCount() == 0 {
		h.rooms.Remove(roomID)
		delete(h.games, roomID)
	}
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

	game, ok := h.games[roomID]
	if !ok {
		h.Send(client, Envelope{Type: "game.start.error", RequestID: env.RequestID, Payload: map[string]any{"code": "game_missing", "message": "game not initialized"}})
		return
	}

	if invention, ok := game.(interface{ StartAssign([]string) }); ok {
		invention.StartAssign(room.ConnectedPlayerIDs())
	}

	h.Broadcast(roomID, Envelope{Type: "game.state", RoomID: roomID, Payload: map[string]any{"public": game.PublicState()}})
	h.hydratePrivateState(roomID, game)
	h.Send(client, Envelope{Type: "game.start.ok", RequestID: env.RequestID})
}

func (h *Hub) handleGameAction(client *Client, env Envelope) {
	roomID := client.RoomID
	if roomID == "" {
		h.Send(client, Envelope{Type: "game.action.error", RequestID: env.RequestID, Payload: map[string]any{"code": "not_in_room", "message": "not in room"}})
		return
	}

	game, ok := h.games[roomID]
	if !ok {
		h.Send(client, Envelope{Type: "game.action.error", RequestID: env.RequestID, Payload: map[string]any{"code": "game_missing", "message": "game not initialized"}})
		return
	}

	if err := game.OnAction(client.Player.ID, env.Payload); err != nil {
		h.Send(client, Envelope{Type: "game.action.error", RequestID: env.RequestID, Payload: map[string]any{"code": "bad_action", "message": "invalid action"}})
		return
	}

	if phase, ok := game.PublicState()["phase"].(string); ok {
		switch phase {
		case "collecting":
			if invention, ok := game.(interface{ StartAssign([]string) }); ok {
				room, _ := h.rooms.Get(roomID)
				if room != nil {
					connected := room.ConnectedPlayerIDs()
					if len(connected) >= 2 {
						if submitted, ok := game.PublicState()["problemsSubmitted"].(int); ok {
							if submitted >= len(connected)*2 {
								invention.StartAssign(connected)
							}
						}
					}
				}
			}
		case "drawing":
			if invention, ok := game.(interface{ AdvanceToPresenting() error }); ok {
				room, _ := h.rooms.Get(roomID)
				if room != nil {
					connected := room.ConnectedPlayerIDs()
					if len(connected) >= 2 {
						if submitted, ok := game.PublicState()["drawingsSubmitted"].(int); ok {
							if submitted >= len(connected) {
								_ = invention.AdvanceToPresenting()
							}
						}
					}
				}
			}
		case "voting":
			if invention, ok := game.(interface{ FinalizeFunding() }); ok {
				room, _ := h.rooms.Get(roomID)
				if room != nil {
					connected := room.ConnectedPlayerIDs()
					if len(connected) >= 2 {
						if count, ok := game.PublicState()["voteCount"].(int); ok {
							if count >= len(connected) {
								invention.FinalizeFunding()
							}
						}
					}
				}
			}
		case "results":
			if invention, ok := game.(interface{ StartNextRound([]string) }); ok {
				if action, _ := env.Payload["action"].(string); action == "next_round" {
					room, _ := h.rooms.Get(roomID)
					if room != nil && room.AdminID() == client.Player.ID {
						invention.StartNextRound(room.ConnectedPlayerIDs())
					}
				}
			}
		}
	}

	h.Broadcast(roomID, Envelope{Type: "game.state", RoomID: roomID, Payload: map[string]any{"public": game.PublicState()}})
	h.hydratePrivateState(roomID, game)
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
