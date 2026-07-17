# Gemu Server

WebSocket backend for a Jackbox-style party-games platform. Hosts multiple game
types behind a self-driving adapter interface, with a shared lobby/room/session
protocol. Guest-only. In-memory by default, with optional Redis durability.

Games: `stop`, `gartic`, `garticphone`, `cah`, `invention`, `trivia`, `fibber`.

## Features

- Room creation/join/leave/kick; admin chain (creator is admin, next player promoted on leave)
- Public vs private rooms (join code + optional password)
- Session layer: playlist, per-game placement scoring, vote-next, final podium
- Self-driving game adapters (timers, standings, phases) via a registry
- Per-IP + global rate limiting; optional Redis durability
- WebSocket JSON protocol

## Quick start

```bash
go mod download
go run ./cmd/server
go test ./... -race          # unit + full-night integration tests
```

## Environment

| Var | Default | Purpose |
|-----|---------|---------|
| `WS_ADDR` | `:8080` | listen address |
| `REDIS_URL` | *(unset)* | enable durability (rooms survive restarts). Unset = pure in-memory |
| `GEMU_TRUST_PROXY` | `false` | honor `X-Forwarded-For`. Enable ONLY behind a proxy that strips inbound XFF |
| `GEMU_MAX_CLIENTS` | `5000` | global connection cap |
| `GEMU_MAX_ROOMS` | `1000` | global room cap |

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

Games are self-driving: the hub calls into the adapter and re-arms a single timer
from `NextDeadline()` after every mutating call. The authoritative interface is in
`internal/games/adapter.go`:

```go
type Adapter interface {
  Start(roomID string, opts Options)
  OnPlayerJoin(playerID string)
  OnPlayerLeave(playerID string)
  OnRoomChange()                                  // re-check "everyone submitted" gates on disconnect
  OnAction(playerID string, payload map[string]any) error
  OnTimer(name string)                            // fires when NextDeadline elapses
  NextDeadline() (name string, at time.Time, ok bool)
  Shift(delta time.Duration)                      // move the deadline after a host pause/resume
  Status() Status
  Standings() []Standing                          // live running totals; final once Status()==Finished
  PublicState() map[string]any
  PrivateState(playerID string) map[string]any
}
```

Register adapters (`Factory`) in `cmd/server/main.go`. See `docs/session-protocol.md`
for how phases, timers, and standings fit together.

## Rate limiting & capacity

Per-IP token buckets throttle new connections and room creation; global caps
(`GEMU_MAX_CLIENTS`, `GEMU_MAX_ROOMS`) bound total load. Loopback is exempt (health
checks / same-host tooling). The client IP is the real TCP peer unless
`GEMU_TRUST_PROXY` is set. There is intentionally no per-message rate cap — drawing
games stream strokes at high rate.

## Durability

Without `REDIS_URL` the server is pure in-memory; a restart clears all rooms. With
`REDIS_URL`, rooms are snapshotted to Redis every 10s (atomic full-replace) and
reloaded on startup: a room caught mid-game or mid-vote drops back to a clean lobby
with session scores intact, and players reconnect via their persisted session id.
In-progress adapter state (the current round) is not resumed.

## Notes

- Guest-only; no accounts.
- Custom CAH decks live on the in-memory session and are lost on restart.
