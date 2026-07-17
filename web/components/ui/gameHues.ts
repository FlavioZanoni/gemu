// Per-game palettes (Gemu System · 02 GAME HUES). `base` is the flat hue,
// grad* the button/header gradient, `ink` the text color on that hue, `drop`
// the hard shadow beneath it.
export type GameHue = {
  base: string;
  gradFrom: string;
  gradTo: string;
  ink: string;
  drop: string;
};

export const gameHues: Record<string, GameHue> = {
  stop: {
    base: "#ffd23f",
    gradFrom: "#ffd23f",
    gradTo: "#f5b32a",
    ink: "#3d1f0e",
    drop: "#c2452d",
  },
  gartic: {
    base: "#35d4b9",
    gradFrom: "#41e0c4",
    gradTo: "#28b89e",
    ink: "#0c3d33",
    drop: "#0f6e5c",
  },
  garticphone: {
    base: "#b78bff",
    gradFrom: "#c9a4ff",
    gradTo: "#a678f2",
    ink: "#2d1650",
    drop: "#5f3d99",
  },
  cah: {
    base: "#ff4f6f",
    gradFrom: "#ff6b85",
    gradTo: "#e84863",
    ink: "#ffffff",
    drop: "#8f1f33",
  },
  invention: {
    base: "#ff9d3f",
    gradFrom: "#ffb05c",
    gradTo: "#f28a2a",
    ink: "#3d1f0e",
    drop: "#a04f14",
  },
  trivia: {
    base: "#4f9dff",
    gradFrom: "#6fb0ff",
    gradTo: "#3f83f2",
    ink: "#0a2547",
    drop: "#1f4f99",
  },
  fibber: {
    base: "#ff6fd8",
    gradFrom: "#ff8ce0",
    gradTo: "#e84fbf",
    ink: "#3d0f33",
    drop: "#992f7a",
  },
};

export const fallbackHue: GameHue = gameHues.stop;

export const hueFor = (gameType: string | undefined | null): GameHue =>
  (gameType && gameHues[gameType]) || fallbackHue;

// Player accent colors for doodle-avatar strokes and chip borders,
// assigned round-robin by join order.
export const playerColors = [
  "#ffd23f",
  "#35d4b9",
  "#ff4f6f",
  "#b78bff",
  "#ff9d3f",
  "#8ceedd",
  "#ff8a9b",
  "#ffe9a8",
];

export const playerColorFor = (index: number) =>
  playerColors[index % playerColors.length];
