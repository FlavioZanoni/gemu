"use client";

import { useState } from "react";
import type { Player, Standing, PlayedGame } from "@/lib/protocol";
import { SessionScoreboard } from "@/components/screens/SessionScoreboard";
import { Avatar } from "./PlayerChip";
import { playerColorFor } from "./gameHues";

/** Live "who's winning" panel for the in-game shell — renders the uniform
 *  `standings` field every game.state carries, so it works for every game.
 *  Vertical list with doodle avatars, meant for the right-hand sidebar. */
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

  // Show board button only if we have session data
  const canOpenBoard = sessionScores && playedGames;

  return (
    <>
      <div
        className={`flex flex-col gap-2 ${canOpenBoard ? "cursor-pointer" : ""} ${className}`}
        data-testid="score-strip"
        onClick={() => canOpenBoard && setBoardOpen(true)}
      >
        <span className="mono-caption">Contestants</span>
        {standings.map((standing, i) => {
          const player = players.find((p) => p.id === standing.playerId);
          const leader = i === 0 && standing.score > 0;
          const you = standing.playerId === playerId;
          const colorIndex = players.findIndex((p) => p.id === standing.playerId);
          return (
            <div
              key={standing.playerId}
              className={`flex items-center gap-2.5 rounded-full border-2 py-1.5 pl-1.5 pr-3.5 ${
                leader
                  ? "border-(--accent) bg-(--accent) text-(--dark-ink)"
                  : "border-(--line) bg-(--panel) text-(--ink)"
              } ${you ? "ring-2 ring-(--accent-2)" : ""}`}
            >
              <span
                className={`w-4 text-center font-mono text-[11px] font-bold ${
                  leader ? "" : "text-(--ink)/60"
                }`}
              >
                {i + 1}
              </span>
              {player && (
                <Avatar player={player} color={playerColorFor(colorIndex)} size={30} />
              )}
              <span className="min-w-0 flex-1 truncate text-[13px] font-bold">
                {player?.name ?? "?"}
              </span>
              <span className="font-mono text-[11px] font-bold">{standing.score}</span>
            </div>
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
