# Backend overview

This document describes the Go WebSocket backend that powers the Gemu multiplayer
platform. It is designed for guest-only rooms and multiple concurrent game types
using an adapter model.

## Goals

- Provide a stable room + lobby protocol for multiple games
- Keep common room features (admin chain, player list, visibility, join code)
- Stay fast and in-memory for early development
- Allow game logic to be plugged in without changing core server code

## Architecture

- `cmd/server/main.go` bootstraps the HTTP server and WS endpoint
- `internal/ws` handles WebSocket upgrades and message routing
- `internal/rooms` stores room state, players, and admin chain
- `internal/games` registers game adapters

The WebSocket server holds an in-memory hub of clients and rooms. Each room is bound to a game type and can be extended by a game adapter in the future.

## WebSocket protocol

All messages use an envelope:

```json
{
  "type": "room.create",
  "requestId": "uuid",
  "roomId": "optional",
  "payload": {}
}
```

### Lobby messages

- `lobby.games.list` -> list available games from the registry
- `lobby.rooms.list` -> list public rooms

### Room messages

- `room.create` -> create room and join as admin
- `room.join` -> join room with name + optional join code
- `room.leave` -> leave room
- `room.ready.set` -> mark ready/unready
- `room.kick` -> kick player (admin only)

### Room push events

- `room.updated` -> full room snapshot
- `room.playerJoined` -> player added
- `room.playerLeft` -> player removed
- `room.playerDisconnected` -> player disconnected (soft)

## Room snapshot

```json
{
  "id": "room-id",
  "name": "Room name",
  "gameType": "invention",
  "visibility": "public",
  "maxPlayers": 10,
  "joinCode": "ABC123",
  "adminId": "player-id",
  "players": [
    { "id": "player-id", "name": "Kai", "avatarUrl": "https://...", "connected": true, "ready": false, "lastSeen": "2026-05-18T00:00:00Z" }
  ]
}
```

## Game adapters

Adapters let you plug in new game logic without modifying the core lobby/room features.

```go
type Adapter interface {
  Type() string
  Name() string
  Init(roomID string)
  OnPlayerJoin(playerID string)
  OnPlayerLeave(playerID string)
  OnAction(playerID string, payload map[string]any) error
  PublicState() map[string]any
  PrivateState(playerID string) map[string]any
}
```

Register adapters in `cmd/server/main.go`. The current placeholder adapter is `invention`.

## Session identity

Clients must send a `sessionId` on `room.create` and `room.join` payloads. The server uses this to prevent duplicate joins from the same browser session and to allow reconnects after a refresh.

## Ready / force start

`room.ready.set` payload:

```json
{ "ready": true }
```

`game.start` payload supports optional admin force:

```json
{ "force": true }
```

## In-memory state

- Rooms and players are in-memory only
- Restarting the server clears all rooms
- Suitable for early development and small-scale usage

## Next steps (future work)

- Add game action routing (`game.action` messages)
- Add server-side validation for display names and avatar URLs
- Optional Redis backing for room/game persistence
