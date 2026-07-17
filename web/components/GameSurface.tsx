"use client";

import { ComponentType } from "react";
import { InventionGame } from "./games/InventionGame";
import { StopGame } from "./games/StopGame";
import { GarticGame } from "./games/GarticGame";
import { GarticPhoneGame } from "./games/GarticPhoneGame";
import { CahGame } from "./games/CahGame";
import { TriviaGame } from "./games/TriviaGame";
import { FibberGame } from "./games/FibberGame";
import type { GameProps } from "./games/types";

type GameSurfaceProps = GameProps & {
  gameType: string;
  onLeave?: () => void;
};

const Games: Record<string, ComponentType<GameProps & { onLeave?: () => void }>> = {
  invention: InventionGame,
  stop: StopGame,
  gartic: GarticGame,
  garticphone: GarticPhoneGame,
  cah: CahGame,
  trivia: TriviaGame,
  fibber: FibberGame,
};

export function GameSurface({
  gameType,
  playerId,
  players,
  publicState,
  privateState,
  sendAction,
  sendStream,
  isAdmin,
  onLeave,
}: GameSurfaceProps) {
  const gameProps: GameProps = {
    playerId,
    players,
    publicState,
    privateState,
    sendAction,
    sendStream,
    isAdmin,
  };

  const GameComponent = Games[gameType];
  if (!GameComponent) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-(--line) bg-(--panel) p-8 text-center text-sm text-(--ink)/60">
        Unknown game: {gameType}
      </div>
    );
  }

  return gameType === "invention" ? (
    <GameComponent {...gameProps} onLeave={onLeave} />
  ) : (
    <GameComponent {...gameProps} />
  );
}
