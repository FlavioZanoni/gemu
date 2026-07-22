# Gemu — per-game UI references

Standalone, self-running demos of each game's UI (open directly in the browser). Extracted from the full-night flow in `../Gemu Prototype.dc.html` so agents can work on one game in isolation.

- `Stop.dc.html` — Scattergories. Phases: fill form (letter tile, live scoreboard right) → STOP slam overlay (5s grace) → validation vote (valid/nonsense, live tally) → results standings. Hue `#ffd23f`.
- `Gartic.dc.html` — draw & guess, drawer view. Layout: scoreboard left · canvas + color/eraser/undo/clear center · guess chat right. Hue `#35d4b9`. The full-featured canvas (shapes, bucket, sizes) is `../DrawingCanvas.dc.html`.
- `CAH.dc.html` — card table. Stages: hand fan (hover lifts, tap plays) → face-down pile → flip reveal → winner pop → round 2 you judge. Hue `#ff4f6f`. ROUND WINS panel left of table.

Shared conventions (see `../Gemu System.dc.html` for full tokens):
- Fonts: Alfa Slab One (display) / Space Grotesk (UI) / Space Mono (captions, timers, codes)
- Surfaces: bg `#1c1230`, panel `#2b1a3d`, border `#5a3f7a`, cream ink `#ffe9a8`, shadow-drop `#c2452d`
- Timer flips coral + pulses (`tick` keyframe) under 10s
- Platform shell header (game chip · round · timer · pause · how-to-play · score peek) is the platform's, mocked inside each demo for context
- Bot friends are scripted with an `elapsed`-seconds tick; a real build replaces the demo logic with WS `game.state`
