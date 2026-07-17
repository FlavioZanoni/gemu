# Prompt for the design session

Copy everything below into a Claude design session.

---

I'm building **Gemu**, a Jackbox-style party platform where my friends and I gather in a room and play a night of browser party games. I need you to design the full UI/UX. Read `docs/roadmap.md` in the repo for the complete product spec.

## Product in one paragraph

Host creates a room (gets a 6-char code + optional password), friends join on their phones or laptops with a nickname (no accounts). The host picks a **playlist** of games from a catalog. The first game is chosen at random; after each game a results screen shows that game's standings, then everyone **votes on the next game** (up to 5 options from the playlist, 30s, live vote counts, tie → random). Session points are awarded by placement (100/75/60/50, then −5 per place, floor 10), and a running **session scoreboard** builds toward a final podium when the host ends the night.

## Tech constraints

- Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4. No component library currently; hand-rolled hook stores (`web/lib/roomStore.ts`, `web/lib/lobbyStore.ts`).
- All state comes over a single WebSocket (`web/lib/ws.ts`, JSON envelopes `{type, requestId, roomId, payload}`); no REST. Server pushes `room.updated`, `game.state` (public + per-player private), and session events (`session.gameResult`, `session.vote`, `session.vote.update`, `session.vote.result`, `session.final`) — see `docs/session-protocol.md`.
- **Mobile-first**: most players are on phones; the host may cast/share a laptop screen. Design every screen for a phone in portrait first.
- **i18n from day one**: all strings through a tiny `t()` dictionary, pt-BR and English, language toggle. No i18n library.
- Games plug into `web/components/GameSurface.tsx` keyed by `gameType`.

## Screens to design

1. **Home**: create room (name, public/private, optional password, max players) / join room (code + password) / public room list. Nickname + avatar pick.
2. **Room lobby**: player list with ready states + admin controls (kick, playlist editor), the game playlist picker (catalog cards with name, tags, player count, description), join code + password share affordance, start button (admin), language toggle.
3. **Pre-game intro**: "up next: <game>" with **How to play** content shown automatically, ready-up to skip.
4. **In-game shell**: persistent slim header (game name, round, timer, always-visible **How to play** button reopening the rules modal, session score peek), game content area below.
5. **Game results**: standings for the game just played (raw score + session points gained), animated.
6. **Vote screen**: up to 5 game cards, tap to vote, live vote counts, countdown, winner reveal moment.
7. **Session scoreboard / final podium**: running totals between games; celebratory final podium when the host ends the night (1st/2nd/3rd + everyone else, per-game history).
8. **Game screens** for: Stop (Scattergories: letter + categories form, STOP moment, answer-validation voting), Gartic (drawing canvas + guess chat), Gartic Phone (write/draw alternation + chain-by-chain reveal — the reveal is the money screen, polish it most), Cards Against Humanity (hand of cards, judge view, winner reveal), and the existing "Patently Silly" invention game.
9. Edge states: disconnected/reconnecting banner, kicked, room not found, waiting-for-players.

## Special design tasks

- **Drawing canvas redesign**: the current `web/components/DrawingCanvas.tsx` is being rebuilt. Design the drawing toolbar/UX: brush sizes, color palette, eraser, undo, clear, mobile touch-friendly, with a timer visible. It must feel great on a phone.
- **Fun is the product**: this is a party night with friends — playful visual identity, juicy transitions between phases, drumroll moments (random game pick, vote winner, podium), sound-effect moments flagged in the design. Avoid corporate/dashboard aesthetics.
- Dark-friendly palette (living-room TV + phones at night).

## Deliverables

- Visual direction (palette, type, tone) + component system (buttons, cards, modals, timers, player chips/avatars).
- Screen designs for everything above, phone portrait first, with a note on the host/TV large-screen variant where relevant (vote screen, results, reveals).
- The How-to-play modal pattern (works for all games, localized).
