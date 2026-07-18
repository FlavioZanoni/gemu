# Gemu — Web

Next.js (App Router) + React + Tailwind v4 frontend for Gemu. Renders the ticket-booth
home, the green-room lobby, and every game surface using the shared "Technicolor
Broadcast" design system and a module-level room store over a WebSocket connection.

## Develop

```bash
pnpm install
pnpm dev        # http://localhost:3000
```

Create `.env.local`:

```
NEXT_PUBLIC_WS_URL=ws://localhost:8080/ws
```

## Layout

- `app/` — routes: `/` (home) and `/room/[roomId]`
- `components/screens/` — lobby, playing, results, voting, podium, intro, join gate
- `components/games/` — one component per game surface
- `components/ui/` — design-system kit (Button, Timer, ScoreStrip, HowToPlayModal, …) + lucide icons
- `lib/` — `roomStore`/`lobbyStore` (WebSocket state), `ws` client (auto-reconnect), `i18n` (en / pt-BR), `sfx` (Web Audio cues)

## Tests

```bash
pnpm test:e2e   # Playwright — boots a dedicated Go server (:8099) + Next (:3939)
```

The E2E suite drives real multi-player flows in separate browser contexts and fails any
test on a React render error (see `e2e/fixtures.ts`).
