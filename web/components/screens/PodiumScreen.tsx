"use client";

import { useI18n } from "@/lib/i18n";
import type { SessionFinal, PlayedGame } from "@/lib/protocol";
import { Button, ScoreChip } from "@/components/ui";
import { gamesCatalog } from "@/lib/games";

export function PodiumScreen({
  sessionFinal,
  onBackToLobby,
}: {
  sessionFinal: SessionFinal;
  onBackToLobby: () => void;
}) {
  const { t } = useI18n();

  // Get top 3
  const top3 = sessionFinal.standings.slice(0, 3);
  const others = sessionFinal.standings.slice(3);

  const medals = [
    { emoji: "🥇", text: t("podium.place1") },
    { emoji: "🥈", text: t("podium.place2") },
    { emoji: "🥉", text: t("podium.place3") },
  ];

  const getGameName = (gameType: string) => {
    const game = gamesCatalog.find((g) => g.type === gameType);
    return game?.name || gameType;
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-8 px-6 py-12">
      {/* Header */}
      <div className="text-center">
        <h1 className="slab text-5xl mb-2">{t("podium.title")}</h1>
        <p className="text-(--ink)/70 text-lg">{t("podium.sessionOver")}</p>
      </div>

      {/* Top 3 Podium */}
      <div className="w-full max-w-2xl">
        <div className="grid grid-cols-3 gap-4 mb-8">
          {top3.map((standing, idx) => (
            <div
              key={standing.playerId}
              className="pop-in flex flex-col items-center text-center"
              style={{ animationDelay: `${idx * 0.15}s` }}
            >
              <div className="text-5xl mb-2">{medals[idx]?.emoji}</div>
              <div className="rounded-xl border-2 border-(--line) bg-(--panel-raised) p-4 w-full">
                <div className="font-bold text-(--ink) mb-1 break-words">
                  {standing.name}
                </div>
                <div className="text-2xl font-display text-(--accent)">
                  {standing.score}
                </div>
                <div className="text-xs text-(--ink)/60 mt-1">
                  {standing.place === 1 ? "Winner!" : ""}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Everyone else */}
        {others.length > 0 && (
          <div className="mb-8 border-t border-(--line) pt-6">
            <h3 className="slab text-lg mb-4 text-center">
              {t("podium.celebration")}
            </h3>
            <div className="space-y-2">
              {others.map((standing) => (
                <ScoreChip
                  key={standing.playerId}
                  rank={standing.place}
                  name={standing.name}
                  points={standing.score}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Games played history */}
      {sessionFinal.playedGames.length > 0 && (
        <div className="w-full max-w-2xl border-t border-(--line) pt-6">
          <h3 className="slab text-lg mb-4">{t("podium.playedGames")}</h3>
          <div className="space-y-3">
            {sessionFinal.playedGames.map((game: PlayedGame) => (
              <div
                key={game.gameType}
                className="rounded-xl border-2 border-(--line) bg-(--panel-raised) p-4"
              >
                <div className="font-bold text-(--ink) mb-2">
                  {getGameName(game.gameType)}
                </div>
                <div className="text-xs space-y-1">
                  {game.standings.slice(0, 3).map((standing) => (
                    <div key={standing.playerId} className="flex justify-between text-(--ink)/70">
                      <span>#{standing.place} {standing.name}</span>
                      <span>{standing.score}pts</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Back button */}
      <Button variant="primary" size="lg" onClick={onBackToLobby}>
        {t("podium.backToLobby")}
      </Button>
    </div>
  );
}
