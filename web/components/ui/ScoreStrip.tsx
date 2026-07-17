"use client";

import type { Player, Standing } from "@/lib/protocol";

/** Live "who's winning" strip for the in-game shell — renders the uniform
 *  `standings` field every game.state carries, so it works for every game. */
export function ScoreStrip({
  standings,
  players,
  playerId,
  className = "",
}: {
  standings: Standing[];
  players: Player[];
  playerId: string | null;
  className?: string;
}) {
  if (standings.length === 0) return null;
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? "?";
  return (
    <div className={`flex items-center gap-2 overflow-x-auto ${className}`} data-testid="score-strip">
      {standings.map((standing, i) => {
        const leader = i === 0 && standing.score > 0;
        const you = standing.playerId === playerId;
        return (
          <span
            key={standing.playerId}
            className={`flex flex-none items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] font-bold ${
              leader
                ? "bg-(--accent) text-(--dark-ink)"
                : "border border-(--line) bg-(--panel) text-(--ink)/80"
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
  );
}
