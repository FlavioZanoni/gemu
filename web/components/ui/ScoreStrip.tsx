"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import type { Player, Standing, PlayedGame } from "@/lib/protocol";
import { SessionScoreboard } from "@/components/screens/SessionScoreboard";
import { Avatar } from "./PlayerChip";
import { playerColorFor } from "./gameHues";

/** Live "who's winning" panel for the in-game shell (Gemu Prototype · GAME
 *  SCOREBOARD) — renders the uniform `standings` every game.state carries,
 *  so it works for every game. Tapping it opens tonight's session board. */
export function ScoreStrip({
  standings,
  players,
  playerId,
  className = "",
  sessionScores,
  playedGames,
  roundLabel,
}: {
  standings: Standing[];
  players: Player[];
  playerId: string | null;
  className?: string;
  sessionScores?: Record<string, number>;
  playedGames?: PlayedGame[];
  /** e.g. "RD 1/3", shown top-right in the hue yellow. */
  roundLabel?: string | null;
}) {
  const { t } = useI18n();
  const [boardOpen, setBoardOpen] = useState(false);

  if (standings.length === 0) return null;

  const canOpenBoard = Boolean(sessionScores && playedGames);

  const rows = (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-(--ink)/50">
          {t("shell.gameScoreboard")}
        </span>
        {roundLabel ? (
          <span className="font-mono text-[10px] font-bold text-(--accent)">{roundLabel}</span>
        ) : null}
      </div>
      {standings.map((standing, i) => {
        const player = players.find((p) => p.id === standing.playerId);
        const leader = i === 0 && standing.score > 0;
        const you = standing.playerId === playerId;
        const colorIndex = players.findIndex((p) => p.id === standing.playerId);
        return (
          <div
            key={standing.playerId}
            className="flex items-center gap-2.5 rounded-full border-2 bg-(--panel) py-1.5 pl-1.5 pr-3.5 text-(--ink)"
            style={{ borderColor: leader ? "var(--accent)" : "var(--line)" }}
          >
            {player && <Avatar player={player} color={playerColorFor(colorIndex)} size={30} />}
            <span className="min-w-0 flex-1 truncate text-[13px] font-bold">
              {player?.name ?? "?"}
              {you ? ` ${t("shell.youSuffix")}` : ""}
            </span>
            <span className="font-display text-base" style={{ color: leader ? "var(--accent)" : "var(--ink)" }}>
              {standing.score}
            </span>
          </div>
        );
      })}
      <p className="text-center font-mono text-[9px] uppercase tracking-[0.12em] text-(--ink)/35">
        {t("shell.gamePointsNote")}
      </p>
    </>
  );

  return (
    <>
      {canOpenBoard ? (
        <button
          type="button"
          className={`flex w-full flex-col gap-2 text-left ${className}`}
          data-testid="score-strip"
          onClick={() => setBoardOpen(true)}
          aria-label={t("shell.openBoard")}
        >
          {rows}
        </button>
      ) : (
        <div className={`flex flex-col gap-2 ${className}`} data-testid="score-strip">
          {rows}
        </div>
      )}

      {canOpenBoard && (
        <SessionScoreboard
          open={boardOpen}
          onClose={() => setBoardOpen(false)}
          sessionScores={sessionScores!}
          players={players}
          playedGames={playedGames!}
          playerId={playerId}
        />
      )}
    </>
  );
}
