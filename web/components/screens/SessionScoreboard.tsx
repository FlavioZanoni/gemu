"use client";

import { X } from "lucide-react";
import type { Player, PlayedGame } from "@/lib/protocol";
import { hueFor } from "@/components/ui/gameHues";

export function SessionScoreboard({
  open,
  onClose,
  sessionScores,
  players,
  playedGames,
}: {
  open: boolean;
  onClose: () => void;
  sessionScores: Record<string, number>;
  players: Player[];
  playedGames: PlayedGame[];
}) {
  if (!open) return null;

  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? "?";

  // Sort players by session score (descending)
  const sortedPlayers = [...players].sort(
    (a, b) => (sessionScores[b.id] ?? 0) - (sessionScores[a.id] ?? 0)
  );

  // Build placement history for each player
  const getPlacementHistory = (playerId: string) => {
    return playedGames.map((game) => {
      const placement = game.standings.find((s) => s.playerId === playerId);
      return {
        gameType: game.gameType,
        place: placement?.place ?? 0,
      };
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(18, 9, 24, 0.92)" }}
      onClick={onClose}
      role="dialog"
      aria-modal
    >
      <div
        className="bg-(--panel) border-2 border-(--line) rounded-3xl p-8 w-full max-w-2xl max-h-[90vh] overflow-y-auto pop-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex-1">
            <div className="mono-caption mb-2 text-(--ink)/60">
              AFTER {playedGames.length} GAME{playedGames.length !== 1 ? "S" : ""}
            </div>
            <h2 className="slab text-4xl text-(--ink)">TONIGHT'S BOARD</h2>
          </div>
          <button
            onClick={onClose}
            className="text-(--ink)/60 hover:text-(--ink) transition p-2"
            aria-label="Close"
          >
            <X size={24} strokeWidth={2.5} />
          </button>
        </div>

        {/* Standings rows */}
        <div className="flex flex-col gap-3">
          {sortedPlayers.map((player, idx) => {
            const placement = getPlacementHistory(player.id);
            const sessionScore = sessionScores[player.id] ?? 0;

            return (
              <div
                key={player.id}
                className="animate-rise rounded-2xl border-2 border-(--line) bg-(--panel) p-4 flex items-center justify-between gap-4"
                style={{ animationDelay: `${idx * 0.1}s` }}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="slab text-2xl w-8 text-center text-(--accent)">
                    {idx + 1}
                  </div>
                  <div className="flex-1 w-12 h-12 rounded-full bg-(--panel-raised) border-2 border-(--line) flex items-center justify-center text-xs text-(--ink)/60 flex-shrink-0">
                    doodle
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-(--ink) truncate">
                      {player.name}
                    </div>
                  </div>
                </div>

                {/* Placement history squares */}
                <div className="flex gap-1 flex-shrink-0">
                  {placement.map((p, gameIdx) => {
                    const hue = hueFor(p.gameType);
                    const opacity = p.place === 0 ? 0.3 : 1;
                    return (
                      <div
                        key={gameIdx}
                        className="w-3 h-3 rounded-sm"
                        style={{
                          backgroundColor: hue.base,
                          opacity,
                        }}
                        title={p.place === 0 ? "Did not place" : `Place: ${p.place}`}
                      />
                    );
                  })}
                </div>

                {/* Total score */}
                <div className="slab text-2xl text-(--accent-2) flex-shrink-0">
                  {sessionScore}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
