# Gemu

Generic multiplayer WebSocket platform for party games. The backend is Go and hosts multiple games simultaneously. The frontend is Next.js and provides a shared lobby and room shell so every game feels consistent.

## Repo layout

- `server` Go WebSocket backend
- `web` Next.js frontend

## Running locally (two deploys with docker-compose)

```bash
docker compose up --build
```

## Dev mode with HMR + Air

```bash
docker compose -f docker-compose.dev.yml up --build
```

Services:

- Backend: `ws://localhost:8080/ws`
- Frontend: `http://localhost:3000`

## Key concepts

- **Lobby**: lists games + public rooms
- **Rooms**: create, join, leave, kick, admin chain
- **Game adapters**: backend modules for each game type
- **Shared UI**: frontend room shell used across games

## Notes

- Guest-only, no database; all in-memory for now.
- Add Redis later if you need persistence or scale.

## Frontend environment

Create `web/.env.local` with:

```
NEXT_PUBLIC_WS_URL=ws://localhost:8080/ws
```
