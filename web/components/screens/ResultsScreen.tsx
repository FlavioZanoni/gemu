"use client";

import { useI18n } from "@/lib/i18n";
import type { GameResult, Player } from "@/lib/protocol";
import { Button, ScoreChip } from "@/components/ui";

export function ResultsScreen({
  gameResult,
  sessionScores,
  players,
  isAdmin,
  onPlayAgain,
  onVoteNext,
  onEndSession,
}: {
  gameResult: GameResult;
  sessionScores: Record<string, number>;
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
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[1fr_3fr]">
      {/* Session scores sidebar */}
      <aside className="rounded-2xl border-2 border-(--line) bg-(--panel) p-6">
        <h3 className="slab text-lg mb-4">{t("results.sessionScore")}</h3>
        <div className="space-y-2 max-h-[65vh] overflow-y-auto">
          {Object.entries(sessionScores)
            .sort(([, a], [, b]) => b - a)
            .map(([playerId, score], idx) => (
              <ScoreChip
                key={playerId}
                rank={idx + 1}
                name={getPlayerName(playerId)}
                points={score}
                highlight={idx === 0}
              />
            ))}
        </div>
      </aside>

      {/* Game results main */}
      <main className="rounded-2xl border-2 border-(--line) bg-(--panel) p-6">
        <div className="mb-6">
          <h2 className="slab text-3xl mb-2">{t("results.title")}</h2>
          <p className="text-(--ink)/70 text-sm">
            {gameResult.gameName || gameResult.gameType}
          </p>
        </div>

        {/* Standings with animation */}
        <div className="space-y-3 mb-8">
          {gameResult.standings.map((standing, idx) => (
            <div
              key={standing.playerId}
              className="pop-in rounded-xl border-2 border-(--line) bg-(--panel-raised) p-4 flex items-center justify-between"
              style={{ animationDelay: `${idx * 0.1}s` }}
            >
              <div className="flex items-center gap-4">
                <div className="text-2xl font-bold text-(--accent)">
                  #{standing.place}
                </div>
                <div>
                  <div className="font-bold text-(--ink)">
                    {standing.name}
                  </div>
                  <div className="text-xs text-(--ink)/60">
                    {standing.score} points
                  </div>
                </div>
              </div>
              {standing.points > 0 && (
                <div className="text-right">
                  <div className="font-bold text-(--accent-2)">
                    +{standing.points}
                  </div>
                  <div className="text-xs text-(--ink)/60">session</div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Admin actions */}
        {isAdmin ? (
          <div className="flex gap-3 flex-wrap">
            <Button variant="primary" onClick={onPlayAgain}>
              {t("results.playAgain")}
            </Button>
            <Button variant="secondary" onClick={onVoteNext}>
              {t("results.voteNext")}
            </Button>
            <Button variant="danger" onClick={onEndSession}>
              {t("results.endTheNight")}
            </Button>
          </div>
        ) : (
          <div className="text-center py-8 text-(--ink)/60">
            {t("results.waiting")}
          </div>
        )}
      </main>
    </div>
  );
}
