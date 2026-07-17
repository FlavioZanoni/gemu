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
