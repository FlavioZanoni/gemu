# Gemu Server

WebSocket backend for a generic multiplayer room system. Designed to host multiple game types simultaneously with a shared lobby/room protocol and a pluggable game adapter interface. Guest-only and in-memory for now.

## Features

- Room creation/join/leave/kick
- Admin chain (creator is admin; next player promoted on leave)
- Public vs private rooms (private rooms use a join code)
- Game registry for multiple game types
- WebSocket JSON protocol

## Quick start

```bash
go mod download
go run ./cmd/server
```

Environment:

- `WS_ADDR` (default `:8080`)

Health check:

- `GET /healthz` -> `ok`

WebSocket endpoint:

- `ws://localhost:8080/ws`

## Folder layout

- `cmd/server` HTTP entrypoint
- `internal/ws` WebSocket router + message handling
- `internal/rooms` Room manager + admin chain
- `internal/games` Game registry + adapter interface

## Protocol overview

All messages are JSON envelopes:

```json
{
  "type": "room.create",
  "requestId": "uuid",
  "roomId": "optional",
  "payload": {}
}
```

Server responses use the same `requestId` with `.ok` or `.error` suffixes. Server push events omit `requestId`.

### Lobby

- `lobby.games.list` -> `lobby.games.list.ok` (payload: `{ games }`)
- `lobby.rooms.list` -> `lobby.rooms.list.ok` (payload: `{ rooms }`)

### Room

- `room.create` -> `room.create.ok` or `room.create.error`
- `room.join` -> `room.join.ok` or `room.join.error`
- `room.leave` -> `room.leave.ok` or `room.leave.error`
- `room.kick` -> `room.kick.ok` or `room.kick.error`

### Room events

- `room.updated` (full snapshot)
- `room.playerJoined` (payload: `{ player }`)
- `room.playerLeft` (payload: `{ playerId }`)

## Room snapshot payload

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
    { "id": "player-id", "name": "Kai", "avatarUrl": "https://..." }
  ]
}
```

## Game adapter interface

Game logic lives behind a common interface:

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

Register adapters in `cmd/server/main.go`.

## Notes

- State is in-memory; restarting the server clears rooms.
- There is no auth yet; every connection is a guest.
- For small-scale play, this is enough. Add Redis later if needed.
