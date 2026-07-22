"use client";

import { Volume2, Repeat, ArrowRight } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { GameResult, Player } from "@/lib/protocol";
import { Button } from "@/components/ui";
import { Avatar } from "@/components/ui/PlayerChip";
import { playerColorFor } from "@/components/ui/gameHues";

export function ResultsScreen({
  gameResult,
  players,
  isAdmin,
  onPlayAgain,
  onVoteNext,
  onEndSession,
}: {
  gameResult: GameResult;
  players: Player[];
  isAdmin: boolean;
  onPlayAgain: () => void;
  onVoteNext: () => void;
  onEndSession: () => void;
}) {
  const { t } = useI18n();

  const getPlayerName = (id: string) =>
    players.find((p) => p.id === id)?.name ?? "Unknown";

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-6 px-6 py-12">
      {/* Header */}
      <div className="text-center mb-6">
        <div className="mono-caption mb-2 flex items-center justify-center gap-2">
          <Volume2 size={14} strokeWidth={2.5} /> Game Over
        </div>
        <h1 className="slab text-5xl">{t("results.title")}</h1>
      </div>

      {/* Standings */}
      <div className="flex flex-col gap-3 w-full max-w-2xl mb-8">
        {gameResult.standings.map((standing, idx) => {
          const isWinner = idx === 0;
          const playerIdx = players.findIndex((p) => p.id === standing.playerId);
          const player = players[playerIdx];
          return (
            <div
              key={standing.playerId}
              className={`animate-rise rounded-2xl p-3 flex items-center justify-between flex-wrap gap-3 ${
                isWinner
                  ? "border-2 border-[#ffd23f]"
                  : "border-2 border-(--line) bg-(--panel)"
              }`}
              style={{
                animationDelay: `${idx * 0.1}s`,
                ...(isWinner
                  ? {
                      background: "linear-gradient(180deg,#ffd23f,#f5b32a)",
                      boxShadow: "0 5px 0 #c2452d",
                      color: "#3d1f0e",
                    }
                  : {}),
              }}
            >
              <div className="flex items-center gap-4">
                <div
                  className="slab text-2xl w-8 text-center"
                  style={{ color: isWinner ? "#3d1f0e" : "var(--accent)" }}
                >
                  {standing.place}
                </div>
                {player ? (
                  <Avatar player={player} color={playerColorFor(playerIdx)} size={48} />
                ) : (
                  <div className="flex-1 w-12 h-12 rounded-full bg-(--panel-raised) border-2 border-(--line) flex items-center justify-center text-xs text-(--ink)/60">
                    ?
                  </div>
                )}
                <div>
                  <div
                    className="font-bold"
                    style={{ color: isWinner ? "#3d1f0e" : "var(--ink)" }}
                  >
                    {standing.name}
                  </div>
                  <div
                    className="text-xs"
                    style={
                      isWinner
                        ? { color: "rgba(61, 31, 14, 0.7)" }
                        : { color: "var(--ink-60)" }
                    }
                  >
                    {standing.score} pts in game
                  </div>
                </div>
              </div>
              <div
                className="slab text-2xl"
                style={
                  isWinner
                    ? { color: "#3d1f0e" }
                    : { color: "var(--accent-2)" }
                }
              >
                +{standing.points}
              </div>
            </div>
          );
        })}
      </div>

      {/* Admin actions */}
      {isAdmin ? (
        <div className="flex gap-3 flex-wrap justify-center">
          <Button variant="secondary" onClick={onPlayAgain} data-testid="results-play-again" className="flex items-center gap-2">
            <Repeat size={16} strokeWidth={2.5} /> Play again
          </Button>
          <Button variant="primary" onClick={onVoteNext} data-testid="results-vote-next" className="flex items-center gap-2">
            Vote on the next game <ArrowRight size={16} strokeWidth={2.5} />
          </Button>
          <Button variant="danger" onClick={onEndSession} data-testid="results-end-night">
            {t("results.endTheNight")}
          </Button>
        </div>
      ) : (
        <div className="text-center py-8 text-(--ink)/60">
          {t("results.waiting")}
        </div>
      )}
    </div>
  );
}
