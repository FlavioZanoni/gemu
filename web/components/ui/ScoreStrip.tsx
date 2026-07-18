"use client";

import { useState } from "react";
import type { Player, Standing, PlayedGame } from "@/lib/protocol";
import { SessionScoreboard } from "@/components/screens/SessionScoreboard";

/** Live "who's winning" strip for the in-game shell — renders the uniform
 *  `standings` field every game.state carries, so it works for every game. */
export function ScoreStrip({
  standings,
  players,
  playerId,
  className = "",
  sessionScores,
  playedGames,
}: {
  standings: Standing[];
  players: Player[];
  playerId: string | null;
  className?: string;
  sessionScores?: Record<string, number>;
  playedGames?: PlayedGame[];
}) {
  const [boardOpen, setBoardOpen] = useState(false);

  if (standings.length === 0) return null;
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? "?";

  // Show board button only if we have session data
  const canOpenBoard = sessionScores && playedGames;

  return (
    <>
      <div
        className={`flex items-center gap-2 overflow-x-auto cursor-pointer ${className}`}
        data-testid="score-strip"
        onClick={() => canOpenBoard && setBoardOpen(true)}
      >
        {standings.map((standing, i) => {
          const leader = i === 0 && standing.score > 0;
          const you = standing.playerId === playerId;
          return (
            <span
              key={standing.playerId}
              className={`flex flex-none items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] font-bold ${
                leader
                  ? "bg-(--accent) text-(--dark-ink) border-2 border-(--accent) drop-shadow-md"
                  : "border-2 border-(--line) bg-(--panel) text-(--ink)/80"
              } ${you ? "ring-2 ring-(--accent-2)" : ""}`}
            >
              <span>{i + 1}</span>
              <span className="max-w-24 truncate font-sans font-bold">
                {nameOf(standing.playerId)}
              </span>
              <span>{standing.score}</span>
            </span>
          );
        })}
      </div>

      {canOpenBoard && (
        <SessionScoreboard
          open={boardOpen}
          onClose={() => setBoardOpen(false)}
          sessionScores={sessionScores}
          players={players}
          playedGames={playedGames}
        />
      )}
    </>
  );
}
