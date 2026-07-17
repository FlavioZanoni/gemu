# Session protocol (playlist, voting, scoring)

Additions to the WS protocol for the party-session layer. Envelope format is unchanged: `{type, requestId?, roomId?, payload?}`; requests get `<type>.ok` / `<type>.error` replies, server pushes have no `requestId`.

## Room lifecycle

`room.status` (in every room snapshot): `lobby → playing → results → voting → lobby → …`

- **lobby** — ready-up. If `nextGameType` is set, that game is queued; otherwise the first `game.start` picks randomly from the playlist.
- **playing** — a game adapter is running; `gameType`/`gameName` describe it.
- **results** — last game finished; its standings were pushed via `session.gameResult`. Admin advances with `session.vote.start` (or `session.end` to end the night).
- **voting** — next-game vote is open.

## Changed requests

### room.create
New payload fields:
- `playlist: string[]` — game types for the night (≥1, all must be registered). Back-compat: a lone `gameType` string still works and becomes a 1-game playlist.
- `password?: string` — optional room password.
- `locale?: string` — `"en"` (default) or `"pt-BR"`; used for game content.

`gameType`/`gameName` in snapshots are now the *currently running* game (empty in lobby).

### room.join
- `password?: string` — required when the room snapshot/public view has `hasPassword: true` (not needed on rejoin of an existing session).
- New error codes: `invalid_password`; `name_taken` when another player already uses the display name (case-insensitive). On a rejoin, a conflicting rename silently keeps the old name instead of blocking the reconnect.

### game.start (admin)
Payload: `{force?: bool, settings?: {…}}`. Only valid in `lobby` status; starts `nextGameType` if set, else a random playlist game. Resets ready flags. `game.start.ok` payload: `{gameType, gameName}`. Error codes: `wrong_status`, `empty_playlist`, `not_enough_players` (payload includes `minPlayers`), plus the old ones.

**Game settings** (host options panel; all optional ints, server clamps to sane ranges):
- invention: `rounds` (1–5, default 3)
- stop: `rounds` (1–10, default 3), `answerSeconds` (30–300, default 90)
- gartic: `rounds` (1–10, default 2), `turnSeconds` (30–180, default 75)
- garticphone: `drawSeconds` (30–300, default 120)
- cah: `rounds` (3–20, default 8)

**Minimum players**: `lobby.games.list` entries now include `minPlayers` (garticphone and cah need 3, the rest 2). `game.start` enforces it, and the next-game vote only offers games the current group is big enough for (falling back to the full playlist if none qualify).

### game.action
Unchanged, but errors with `no_active_game` between games.

### game.stream (new)
High-frequency transient channel for canvas strokes. Client sends `{type: "game.stream", payload: {action: "stroke" | "canvas_clear" | "canvas_undo", ...opaque stroke data}}`. The server consults the game (e.g. Gartic accepts these only from the current drawer during the drawing phase), then relays the payload verbatim — plus `playerId` — to everyone else in the room as a `game.stream` push. No full-state broadcast, no ok/error replies (illegal streams are dropped silently). Strokes are not persisted server-side: a reconnecting player gets a blank canvas mid-turn.

## New requests

- `session.playlist.set` `{playlist: string[]}` — admin, in `lobby`/`results`. Replaces the playlist (≥1 registered games). If the queued `nextGameType` is removed, it is cleared.
- `session.vote.start` — admin, in `results`. Opens the next-game vote. If the playlist has ≤1 game there is nothing to vote on: the room goes straight to `lobby` with `nextGameType` queued.
- `session.replay` — admin, in `results`. "Same again": queues the game that just finished (status → `lobby` with `nextGameType` set, ready flags cleared) instead of voting. Each play is scored as its own game in the session.
- `session.vote.cast` `{gameType}` — any player, in `voting`. One vote per player, revotable until resolved. Errors: `no_vote_active`, `invalid_option`.
- `session.end` — admin, any status except `playing`. Pushes the final podium then resets scores/history to a fresh lobby.

## Live in-game scoreboard

Every `game.state` broadcast now carries `standings: [{playerId, score}]` (best first, game-native running totals) alongside `public` — render the persistent "who's winning" scoreboard from this one field for every game instead of digging into per-game keys like `wins`/`totalScores`/`scores`.

## New pushes

- `session.gameResult` `{gameType, gameName, standings: PlacementRow[]}` — after a game finishes. Also implies status → `results` (see the `room.updated` that follows).
- `session.vote` `{options: [{type, name}], deadline: epochMillis}` — vote opened; up to 5 options sampled from the playlist, 30s window.
- `session.vote.update` `{counts: {gameType: n}}` — live tally after each cast.
- `session.vote.result` `{gameType, gameName, counts}` — winner (most votes; tie → random). Status → `lobby` with `nextGameType` set and ready flags cleared.
- `session.final` `{standings: PlacementRow[], playedGames: PlayedGame[]}` — final podium for the night.

`PlacementRow = {playerId, name, place, score, points}` — `score` is game-native (raw), `points` are session points: place 1→100, 2→75, 3→60, 4→50, then −5 per place (floor 10). Tied raw scores share a place and its points.

`PlayedGame = {gameType, gameName, standings: PlacementRow[]}`

## Room snapshot additions

`status`, `playlist`, `nextGameType`, `nextGameName`, `sessionScores: {playerId: points}`, `playedGames`, `hasPassword`, `locale`. Public room list entries add `hasPassword`, `status`, `playlist`.

## Implemented games

- **invention** ("Patently Silly") — phases `collecting → drawing → presenting → voting → results → finalResults`; unchanged from before, standings = total funding.
- **gartic** ("Gartic") — phases `drawing → turnResults`, rotating drawer, 2 rounds (everyone draws once per round), 75s turns, 6s reveal. Public state: `drawer`, `deadline` (ms), `wordLength` (or `word` during reveal), `scores`, `guessed`, masked `guesses` chat (last 30). Private: the drawer gets `word`; a near-miss guesser gets `closeGuess`. Actions: `{action:"guess", text}` via `game.action`; strokes via `game.stream`. Scoring: 1st correct guess 100, then −10 each (floor 50); drawer +25 per correct guesser.
- **stop** ("Stop!") — phases `answering → validating → roundResults`, 3 rounds. See the constants and per-phase payloads in `server/internal/games/stop.go`. Answers via `{action:"set_answers", answers:{category: text}}`, early stop via `{action:"stop"}` (5s grace for everyone else), validity votes via `{action:"validate", rejected:["category|playerId"]}`, admin `{action:"next_round"}`. Scoring: unique valid 10, duplicate 5, invalid 0.

- **garticphone** ("Gartic Phone") — phases `prompt → drawing → writing → … → reveal`. Everyone writes a prompt (60s); chains rotate each step, alternating draw-the-text (120s) and describe-the-drawing (60s) until each chain passed through every player; missed submissions are autofilled ("…" / blank drawing). Reveal is admin-paced: `{action:"reveal_next"}` shows one entry at a time (public state carries `chains` masked to the revealed prefix, plus `revealChain`/`revealPos`/`likes`); a final extra press ends the game. During the reveal anyone can `{action:"react", chain, entry}` — one like per player per revealed entry, not on your own entries, +10 to the entry's author; likes are the score. Work-phase submissions: `{action:"submit_prompt"|"submit_description", text}` and `{action:"submit_drawing", draw: dataURL}`; private state carries the player's `prevEntry` to draw/describe.

- **cah** ("Cartas") — phases `answering (75s) → judging (60s) → roundResults (8s, auto)`, 8 rounds, rotating judge, hand of 5. Answering: non-judges `{action:"submit", cards:[handIndex,...]}` (exactly `blackCard.pick` distinct indices; locked once submitted). Judging: anonymized shuffled `submissions`; judge `{action:"pick_winner", index}`; judge timeout or disconnect → random winner. Round results reveal who played what. Raw score = round wins. Decks are embedded JSON (`server/internal/games/decks/cah_{en,pt-BR}.json`, format `{locale, black:[{text,pick}], white:[...]}`) — drop in extra cards by editing those files (original content, not real CAH text).

## For game implementers (backend)

Games implement `games.Adapter` (`server/internal/games/adapter.go`): a self-driving state machine. Advance phases inside `OnAction`/`OnTimer`/`OnRoomChange` (roster via `Options.Room.ConnectedPlayerIDs()`), report a single pending countdown via `NextDeadline()` (the hub re-arms it after every call and calls `OnTimer(name)` when it fires), flip `Status()` to finished and expose `Standings()` when done. The hub handles everything else: scoring, results, votes. No hub changes needed to add a game — register a `Factory` in `cmd/server/main.go` and add the frontend component in `web/components/GameSurface.tsx`.

## Pause (host)

- `session.pause` — admin, `playing` status only. Freezes the show: the pending game timer stops, `game.action`/`game.stream` are rejected (`paused`) until resume, and the room snapshot carries `paused: true` (render the pause overlay from it).
- `session.resume` — admin. Shifts every pending game deadline forward by the frozen duration (games implement `Shift`), re-arms the timer, and re-broadcasts `game.state` so client countdowns pick up the shifted deadline.
