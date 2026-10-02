import type { GameSummary } from "./protocol";

export type CuratedGame = GameSummary & {
  tag: string;
  players: string;
  description: { en: string; "pt-BR": string };
  /** Number of `howto.<type>.<n>` steps in lib/i18n/games.ts. */
  howToSteps: number;
};

// Static catalog metadata layered over the server's lobby.games.list.
export const gamesCatalog: CuratedGame[] = [
  {
    type: "stop",
    howToSteps: 4,
    name: "Stop!",
    minPlayers: 2,
    tag: "Words",
    players: "2-10",
    description: {
      en: "One letter, eight categories, no mercy. First done yells STOP!",
      "pt-BR": "Uma letra, oito categorias, sem piedade. Quem terminar grita STOP!",
    },
  },
  {
    type: "gartic",
    howToSteps: 3,
    name: "Gartic",
    minPlayers: 2,
    tag: "Drawing",
    players: "2-10",
    description: {
      en: "Draw the secret word while everyone guesses. Fast guesses score big.",
      "pt-BR": "Desenhe a palavra secreta enquanto todos chutam. Rapidez vale mais.",
    },
  },
  {
    type: "garticphone",
    howToSteps: 4,
    name: "Gartic Phone",
    minPlayers: 3,
    tag: "Drawing",
    players: "3-10",
    description: {
      en: "Telephone with drawings. Watch your sentence mutate into chaos.",
      "pt-BR": "Telefone sem fio com desenhos. Veja sua frase virar caos.",
    },
  },
  {
    type: "cah",
    howToSteps: 3,
    name: "Cartas",
    minPlayers: 3,
    tag: "Cards",
    players: "3-10",
    description: {
      en: "Fill the blank with the worst card in your hand. The judge decides.",
      "pt-BR": "Complete a lacuna com a pior carta da mão. O juiz decide.",
    },
  },
  {
    type: "trivia",
    howToSteps: 3,
    name: "Trivia",
    minPlayers: 2,
    tag: "Quiz",
    players: "2-10",
    description: {
      en: "Timed multiple-choice trivia. Answer fast — speed is worth points.",
      "pt-BR": "Perguntas de múltipla escolha com tempo. Responda rápido — velocidade dá pontos.",
    },
  },
  {
    type: "fibber",
    howToSteps: 3,
    name: "Fibber",
    minPlayers: 3,
    tag: "Bluff",
    players: "3-10",
    description: {
      en: "Write a convincing fake answer, then spot the real one. Fool your friends.",
      "pt-BR": "Escreva uma resposta falsa convincente e ache a verdadeira. Engane os amigos.",
    },
  },
  {
    type: "invention",
    howToSteps: 4,
    name: "Patently Silly",
    minPlayers: 2,
    tag: "Drawing",
    players: "2-12",
    description: {
      en: "Invent ridiculous products and pitch them. The best funding wins!",
      "pt-BR": "Invente produtos ridículos e faça o pitch. O melhor financiamento vence!",
    },
  },
];

/** Compact label for chips and pills (design: "G. PHONE", "P. SILLY"). */
export const shortGameName = (type: string, fallback = type) =>
  (
    {
      stop: "Stop!",
      gartic: "Gartic",
      garticphone: "G. Phone",
      cah: "CAH",
      trivia: "Trivia",
      fibber: "Fibber",
      invention: "P. Silly",
    } as Record<string, string>
  )[type] ?? fallback;

/** Localized compact game label (i18n `gameShort.<type>`), e.g. CAH is
 *  "CARTAS" in pt-BR. Falls back to the catalog/server name. */
export const gameLabel = (
  type: string,
  t: (key: string) => string,
  fallback?: string,
) => {
  const key = `gameShort.${type}`;
  const text = t(key);
  return text === key ? (fallback ?? shortGameName(type)) : text;
};

export const minPlayersFor = (type: string) =>
  gamesCatalog.find((g) => g.type === type)?.minPlayers ?? 2;

/** One host-tunable knob for the intro screen. `key` is the server's
 *  game.start settings key; options sit inside the server's clamp range and
 *  `def` mirrors the server default (server/internal/games/*.go). */
export type SettingSpec = {
  key: string;
  kind: "rounds" | "timer";
  options: number[];
  def: number;
};

export const gameSettings: Record<string, SettingSpec[]> = {
  stop: [
    { key: "rounds", kind: "rounds", options: [1, 3, 5, 10], def: 3 },
    { key: "answerSeconds", kind: "timer", options: [60, 90, 150], def: 90 },
  ],
  gartic: [
    { key: "rounds", kind: "rounds", options: [1, 2, 3, 5], def: 2 },
    { key: "turnSeconds", kind: "timer", options: [45, 75, 120], def: 75 },
  ],
  garticphone: [{ key: "drawSeconds", kind: "timer", options: [60, 120, 180], def: 120 }],
  cah: [{ key: "rounds", kind: "rounds", options: [3, 5, 8, 12], def: 8 }],
  trivia: [
    { key: "rounds", kind: "rounds", options: [5, 8, 12, 16], def: 8 },
    { key: "answerSeconds", kind: "timer", options: [10, 20, 30], def: 20 },
  ],
  fibber: [
    { key: "rounds", kind: "rounds", options: [3, 4, 6, 8], def: 4 },
    { key: "writeSeconds", kind: "timer", options: [30, 45, 90], def: 45 },
  ],
  invention: [{ key: "rounds", kind: "rounds", options: [1, 2, 3, 5], def: 3 }],
};
