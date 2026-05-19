import type { GameSummary } from "./protocol";

export type CuratedGame = GameSummary & {
  tag: string;
  players: string;
  description: string;
};

export const gamesCatalog: CuratedGame[] = [
  {
    type: "invention",
    name: "Patently Silly",
    tag: "Ready",
    players: "2-12",
    description:
      "Invent ridiculous products and pitch them to your friends. The best invention wins!",
  },
];
