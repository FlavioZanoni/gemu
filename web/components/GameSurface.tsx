"use client";

import type { Player } from "@/lib/protocol";
import { InventionGame } from "./games/InventionGame";
import { StopGame } from "./games/StopGame";
import { GarticGame } from "./games/GarticGame";
import { GarticPhoneGame } from "./games/GarticPhoneGame";
import { CahGame } from "./games/CahGame";
import type { GameProps } from "./games/types";

type GameSurfaceProps = GameProps & {
  gameType: string;
  onFullscreenToggle?: () => void;
  onLeave?: () => void;
};

export function GameSurface({
  gameType,
  roomId,
  playerId,
  players,
  publicState,
  privateState,
  sendAction,
  sendStream,
  isAdmin,
  onFullscreenToggle,
  onLeave,
}: GameSurfaceProps) {
  const gameProps: GameProps = {
    roomId,
    playerId,
    players,
    publicState,
    privateState,
    sendAction,
    sendStream,
    isAdmin,
  };

  switch (gameType) {
    case "invention":
      return (
        <InventionGame
          roomId={roomId}
          playerId={playerId}
          players={players as Player[]}
          publicState={publicState}
          privateState={privateState}
          sendAction={sendAction}
          onFullscreenToggle={onFullscreenToggle}
          isAdmin={isAdmin}
          onLeave={onLeave}
        />
      );
    case "stop":
      return <StopGame {...gameProps} />;
    case "gartic":
      return <GarticGame {...gameProps} />;
    case "garticphone":
      return <GarticPhoneGame {...gameProps} />;
    case "cah":
      return <CahGame {...gameProps} />;
    default:
      return (
        <div className="rounded-2xl border-2 border-dashed border-(--line) bg-(--panel) p-8 text-center text-sm text-(--ink)/60">
          Unknown game: {gameType}
        </div>
      );
  }
}
