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

The WebSocket server holds a hub of clients and rooms. Each room runs a session
(playlist, scores, vote state) and, while a game is live, a self-driving game
adapter that owns its own phases and timer. Seven games are registered:
`stop`, `gartic`, `garticphone`, `cah`, `invention`, `trivia`, `fibber`.

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

Adapters let you plug in new game logic without modifying the core lobby/room features. The authoritative interface lives in `server/internal/games/adapter.go`; how to implement one (self-driving phases, timers, standings) is documented in `docs/session-protocol.md`.

Register adapters in `cmd/server/main.go`. The first adapter is `invention` ("Patently Silly").

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

## State & durability

- Rooms and players live in-memory by default; restarting clears all rooms.
- Set `REDIS_URL` to enable durability: rooms are snapshotted to Redis every 10s
  (atomic full-replace) and reloaded on startup. A room caught mid-game or
  mid-vote drops back to a clean lobby with session scores intact; players
  reconnect via their persisted session id. In-progress round state is not resumed.

## Rate limiting & capacity

- Per-IP token buckets throttle new connections and room creation.
- Global caps: `GEMU_MAX_CLIENTS` (5000), `GEMU_MAX_ROOMS` (1000).
- Loopback is exempt. The client IP is the real TCP peer unless `GEMU_TRUST_PROXY`
  is set (only enable behind a proxy that strips inbound `X-Forwarded-For`).
- Display names and avatar URLs are truncated/sanitized on `room.create`/`room.join`.

## Next steps (future work)

- CI to run the test suites on push; metrics/observability; graceful drain.
- Multi-instance scaling (shared state + pub/sub) — a separate, larger effort.
