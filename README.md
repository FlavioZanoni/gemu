# Gemu

A Jackbox-style party-games platform: create a room, gather friends by nickname,
pick a playlist of games, and play them in sequence with voting between games and
a per-session podium. Go WebSocket backend, Next.js frontend.

## Games

Stop (Scattergories), Gartic (draw & guess), Gartic Phone, Cards Against Humanity
(with deck selection + custom deck import), Patently Silly (invention), Trivia,
and Fibber. Every game has a "How to play" button.

## Repo layout

- `server` — Go WebSocket backend: game adapters, rooms, rate limiting, optional Redis durability
- `web` — Next.js frontend: shared room shell, "Technicolor Broadcast" design system, Playwright E2E

## Run with docker-compose

```bash
docker compose up --build                              # prod-ish, two services
docker compose -f docker-compose.dev.yml up --build    # dev: HMR + Air live reload
```

- Backend: `ws://localhost:8080/ws`
- Frontend: `http://localhost:3000`

## Run locally without Docker

```bash
cd server && go run ./cmd/server     # backend on :8080
cd web && pnpm install && pnpm dev  # frontend on :3000 (separate shell)
```

The frontend needs `web/.env.local`:

```
NEXT_PUBLIC_WS_URL=ws://localhost:8080/ws
```

## Configuration (server env vars)

| Var | Default | Purpose |
|-----|---------|---------|
| `WS_ADDR` | `:8080` | listen address |
| `REDIS_URL` | *(unset)* | enable durability — rooms survive restarts/deploys. Unset = pure in-memory (friends mode) |
| `GEMU_TRUST_PROXY` | `false` | honor `X-Forwarded-For` for the client IP. **Enable only behind a proxy that strips inbound XFF**, or per-IP rate limits can be spoofed |
| `GEMU_MAX_CLIENTS` | `5000` | global concurrent-connection cap |
| `GEMU_MAX_ROOMS` | `1000` | global live-room cap |

## Tests

```bash
cd server && go test ./... -race     # backend unit + full-night integration
cd web && pnpm test:e2e           # Playwright E2E (boots its own server + web on isolated ports)
```

## Docs

- `docs/backend.md` — backend architecture
- `docs/session-protocol.md` — game adapter + session protocol
- `docs/roadmap.md` — product roadmap and status
