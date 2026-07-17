# Gemu — Party Platform Roadmap

Gemu evolves from "one room = one game" into a Jackbox-style party night: create a room, gather friends, pick a playlist of games, play them in sequence with voting between games, and crown an overall winner at the end.

## Status (2026-07-17)

Milestones 0–5 below are **shipped**: the platform refactor, session/vote-next
layer, all games (Stop, Gartic, Gartic Phone, CAH with deck import, plus Trivia
and Fibber), the canvas rebuild, i18n, auto-reconnect, sound effects, and the
podium. On top of the original plan the project now also has: lucide icons,
a Playwright E2E suite (`web/e2e`), per-IP + global rate limiting, and optional
Redis durability. Remaining before a public (non-friends) release: CI, metrics,
graceful drain, and — only if needed — multi-instance scaling. The sections below
are kept as the original design record.

## Product decisions (locked 2026-07-17)

- **Build order:** Stop (Scattergories) → Gartic (draw & guess) → Gartic Phone → Cards Against Humanity.
- **Identity:** nickname per room, no accounts.
- **Scores:** per-session only; no DB, no persistent leaderboard.
- **Language:** pt-BR and English, switchable (i18n from the start). Game content (cards, categories, word lists) ships per-locale; the room uses the host's language for shared content.
- **Every game has a "How to play" button** — always visible in the game header, and shown automatically before round 1 (skippable by ready-up).

## The night, end to end

1. Host creates a room → 6-char code + optional password.
2. Friends join with the code (+pass), pick nicknames.
3. Host selects a **playlist** from the game catalog.
4. First game is chosen at random from the playlist; how-to-play intro screen; play.
5. Game-over screen shows that game's standings.
6. **Vote screen:** up to 5 games sampled from the playlist, 20s vote with live counts, most votes wins (tie → random among tied). Repeats allowed.
7. Session scoreboard updates after each game. Host ends the night → final podium.

## Scoring

Games have incomparable point scales, so raw points are never summed across games. Each game reports **placements**; the platform awards fixed session points by placement: 1st = 100, 2nd = 75, 3rd = 60, 4th = 50, then −5 per place, floor 10 (everyone scores for playing). Per-game raw scores still shown on that game's own results screen.

## Milestone 0 — Platform (prerequisite refactor)

- **Generic game lifecycle.** Today phase advancement is invention-specific, hardcoded in `server/internal/ws/hub.go` via type-assertions. Extend the `Adapter` contract so games drive themselves (`OnAction`/`OnTimer` return effects; `Standings()` reports final rankings), add a per-room timer service, delete the hardcoded transitions, and port Patently Silly onto the new contract.
- **Session layer on Room:** playlist, current game, per-game score history, session totals; room state machine `lobby → playing → intermission(vote) → … → finale`.
- **Vote-next flow** (server-side sampling, timed vote, live counts).
- **Optional room password** on top of the join code.
- **How-to-play** registration per game + shared modal (frontend).
- **i18n:** two JSON dictionaries (pt-BR, en) + tiny `t()` context, language toggle in header. No i18n library.
- **Client auto-reconnect** with backoff + resubscribe (`web/lib/ws.ts` currently just dies on close; server-side rejoin already works).
- **Canvas refactor:** the current drawing logic in `web/components/DrawingCanvas.tsx` is poor and must be rebuilt before Gartic — proper pointer-event handling, smooth strokes, stroke model that can be serialized/streamed (Gartic needs live streaming, Gartic Phone needs submit-at-timeout replay), undo, colors/brush sizes, mobile-first touch support.

## Milestone 1 — Stop (Scattergories)

Letter + ~8 categories, timed round, first to finish yells STOP (5s grace), then a **validation phase** where everyone votes answers valid/invalid. Scoring: unique valid = 10, duplicate = 5, invalid = 0. Simplest game — proves the whole M0 pipeline. Per-locale category lists.

## Milestone 2 — Gartic (draw & guess)

One player draws a secret word per round, others guess in chat; faster guess = more points, drawer scores when people guess. Live stroke streaming over the WS (batched stroke events). Close-guess masking ("you're close!"). Per-locale word lists.

## Milestone 3 — Gartic Phone (telephone)

Everyone writes a prompt → chains rotate → draw → describe → alternate until chains complete → animated chain-by-chain reveal, host-paced. Canvas is submit-at-timeout (no live streaming). Points come from reactions/votes for favorite moments during the reveal. The reveal screen deserves the most polish — it is the game.

## Milestone 4 — Cards Against Humanity

Rotating judge, hand of white cards, judge picks the round winner, fixed rounds so the night keeps moving. JSON deck format so decks can be dropped in/curated: official CAH (CC BY-NC-SA, fine for personal use) for EN, community "Cartas Contra a Humanidade" for pt-BR, plus optional custom house decks.

## Milestone 5 — Fun polish

Sounds + music stingers, round-transition animations, final-podium ceremony, per-night awards ("best artist", "fastest guesser" — computed from stats already in hand), emoji reactions during reveals/votes.

## Defaults (change on request)

- Max players ~10 per room (Gartic Phone chains get long past that).
- Next-game vote tie → random among tied.
- Playlist editable by host between games only.
