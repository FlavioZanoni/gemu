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
- `room.kick` -> kick player (admin only; target must be in the admin's room)

### Room push events

- `room.updated` -> full room snapshot
- `room.playerJoined` -> player added
- `room.playerLeft` -> player removed
- `room.playerDisconnected` -> player disconnected (soft)
- `room.sessionReplaced` -> sent to an old connection whose seat was taken over by a reconnect of the same session; it is unbound (do not auto-rejoin)

## Room snapshot

```json
{
  "id": "room-id",
  "name": "Room name",
  "gameType": "invention",
  "visibility": "public",
  "maxPlayers": 10,
  "joinCode": "K7PX2M",
  "adminId": "player-id",
  "players": [
    { "id": "player-id", "name": "Kai", "avatarUrl": "https://...", "connected": true, "ready": false, "lastSeen": "2026-05-18T00:00:00Z" }
  ]
}
```

## Game adapters

Adapters let you plug in new game logic without modifying the core lobby/room features. The authoritative interface lives in `server/internal/games/adapter.go`; how to implement one (self-driving phases, timers, standings) is documented in `docs/session-protocol.md`.

Register adapters in `cmd/server/main.go`. The first adapter is `invention` ("Patently Silly").

## Embedding (awful.chat)

Gemu can run as an app tile inside an awful.chat call (`web/lib/awful.ts` holds
the client side of the host contract). The tile sends `room.join` with
`awfulSession` (the host's app-session id, ≤128 chars) and no `roomId`: the
server finds the room bound to that session or creates it on first open
(`Manager.FindOrCreateExternal`, one lock, so simultaneous openers share one
room; the first opener is host). The room is private, passwordless, seats 16,
and takes `locale`, `playlist` (default: every registered game) and `roomName`
from the join payload. Only a SHA-256 of the session id is stored (persisted
with the room as its external key). Joining through the session skips the
join-code/password checks. Host display names aren't unique, so a taken name is
suffixed ("Ana 2") rather than refused; every `room.join.ok`/`room.create.ok`
carries `playerId` so the client knows its seat without matching names. See
`docs/session-protocol.md` (room.join) for the exact fields.

## Session identity

Clients must send a `sessionId` on `room.create` and `room.join` payloads. The server uses this to prevent duplicate joins from the same browser session and to allow reconnects after a refresh. A reconnect into the same room takes the seat over from a still-open old socket (which gets `room.sessionReplaced`); a session live in a different room is refused with `session_in_room`.

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
  Custom CAH decks are persisted with their room.
- If loading at boot fails (after a few retries), durability is disabled for that
  run: the full-replace saver would otherwise erase every stored room.
- SIGINT/SIGTERM shut the HTTP server down gracefully and write a final snapshot.

## Rate limiting & capacity

- Per-IP token buckets throttle new connections, room creation and failed
  `room.join` attempts (code/password brute force).
- Per-connection token buckets: `game.stream` 60/s (burst 120), everything else
  20/s (burst 40); excess gets `system.error {code: "rate_limited"}`.
- Each connection has a bounded outbound queue (256 messages / 32MB) and a single
  writer goroutine with a 10s write deadline; a client that stops reading is
  disconnected instead of blocking broadcasts.
- `game.state` broadcasts are coalesced per room (immediate after a quiet
  period or on a phase/round/turn/deadline change, otherwise one trailing
  broadcast per ~120ms carrying the latest state), so action bursts don't
  multiply large state payloads.
- Room capacity and display-name uniqueness are enforced atomically on join
  (`Room.TryAddPlayer`); `maxPlayers` is clamped to 2–16.
- A game timer that stays overdue after `OnTimer` (an adapter bug) is re-fired
  with a 1s backoff instead of in a hot loop, and logged once per game.
- Global caps: `GEMU_MAX_CLIENTS` (5000), `GEMU_MAX_ROOMS` (1000).
- Loopback is exempt. The client IP is the real TCP peer unless `GEMU_TRUST_PROXY`
  is set; then it is the `X-Forwarded-For` entry `GEMU_PROXY_HOPS` (default 1)
  places from the right — the address your outermost proxy saw; anything to its
  left is client-supplied. A forwarded loopback address never gets the exemption.
- The HTTP server sets `ReadHeaderTimeout` (10s) and `IdleTimeout` (120s).
- Display names and avatar URLs are truncated/sanitized on `room.create`/`room.join`.

## Next steps (future work)

- CI to run the test suites on push; metrics/observability; closing live
  WebSockets with a "server restarting" frame on shutdown.
- Multi-instance scaling (shared state + pub/sub) — a separate, larger effort.
