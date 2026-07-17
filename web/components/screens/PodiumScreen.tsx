"use client";

import { useEffect, useMemo } from "react";
import { Volume2, Trophy, Medal } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { SessionFinal, PlayedGame } from "@/lib/protocol";
import { Button } from "@/components/ui";
import { gamesCatalog } from "@/lib/games";
import { playSfx } from "@/lib/sfx";

export function PodiumScreen({
  sessionFinal,
  onBackToLobby,
}: {
  sessionFinal: SessionFinal;
  onBackToLobby: () => void;
}) {
  const { t } = useI18n();

  // Champion fanfare on the podium reveal.
  useEffect(() => {
    playSfx("winner");
  }, []);

  // Get top 3
  const top3 = sessionFinal.standings.slice(0, 3);
  const others = sessionFinal.standings.slice(3);

  // Generate confetti pieces
  const confetti = useMemo(() => {
    const colors = ["#ffd23f", "#ff8a9b", "#8ceedd", "#35d4b9", "#ff9d3f"];
    return Array.from({ length: 15 }, (_, i) => ({
      id: i,
      left: `${Math.random() * 100}%`,
      color: colors[i % colors.length],
      duration: 3 + Math.random() * 2,
      delay: Math.random() * 0.5,
    }));
  }, []);


  const getGameName = (gameType: string) => {
    const game = gamesCatalog.find((g) => g.type === gameType);
    return game?.name || gameType;
  };

  return (
    <div className="relative flex flex-col items-center justify-center min-h-screen gap-8 px-6 py-12 overflow-hidden">
      {/* Confetti */}
      {confetti.map((piece) => (
        <div
          key={piece.id}
          className="absolute pointer-events-none animate-fall"
          style={{
            left: piece.left,
            top: "-30px",
            width: "10px",
            height: "15px",
            background: piece.color,
            borderRadius: "2px",
            animationDuration: `${piece.duration}s`,
            animationDelay: `${piece.delay}s`,
          }}
        />
      ))}

      {/* Header */}
      <div className="text-center relative z-10">
        <div className="mono-caption mb-3 flex items-center justify-center gap-2">
          <Volume2 size={14} strokeWidth={2.5} /> That&apos;s a wrap
        </div>
        <h1 className="slab text-6xl">{t("podium.title")}</h1>
      </div>

      {/* Top 3 Podium */}
      <div className="w-full max-w-4xl relative z-10">
        <div className="flex items-flex-end justify-center gap-4 h-80 mb-8">
          {top3.map((standing, idx) => {
            const positions = [
              { flex: 0.8, h: "h-56", rank: 2 },
              { flex: 1, h: "h-64", rank: 1 },
              { flex: 0.8, h: "h-40", rank: 3 },
            ];
            const pos = positions[idx] || positions[0];
            return (
              <div
                key={standing.playerId}
                className="animate-rise flex flex-col items-center justify-end gap-2"
                style={{
                  flex: pos.flex,
                  animationDelay: `${idx * 0.15}s`,
                }}
              >
                <div className="text-4xl flex justify-center">
                  {idx === 0 && <Trophy size={40} strokeWidth={2.5} style={{ color: "#ffd23f" }} />}
                  {idx === 1 && <Medal size={40} strokeWidth={2.5} style={{ color: "#c7cdd6" }} />}
                  {idx === 2 && <Medal size={40} strokeWidth={2.5} style={{ color: "#cd7f32" }} />}
                </div>
                <div className="w-14 h-14 rounded-full bg-(--panel-raised) border-3 border-(--line) flex items-center justify-center text-xs text-(--ink)/60">
                  doodle
                </div>
                <div className="text-center text-sm">
                  <div className="font-bold text-(--ink) break-words">
                    {standing.name}
                  </div>
                  <div className="text-sm slab text-(--accent)">
                    {standing.score}
                  </div>
                </div>
                <div
                  className={`w-full ${pos.h} rounded-t-2xl flex items-center justify-center border-t-2 border-x-2 border-(--line) text-4xl slab`}
                  style={{
                    background:
                      idx === 0
                        ? "linear-gradient(180deg, #ffd23f, #f5b32a)"
                        : idx === 1
                          ? "linear-gradient(180deg, #8ceedd, #35d4b9)"
                          : "linear-gradient(180deg, #ffb56b, #f28e35)",
                    color: idx === 0 ? "#3d1f0e" : idx === 1 ? "#0c3d33" : "#3d1f0e",
                  }}
                  data-testid={idx === 0 ? "podium-winner" : undefined}
                >
                  {idx + 1}
                </div>
              </div>
            );
          })}
        </div>

        {/* Everyone else */}
        {others.length > 0 && (
          <div className="mb-8 space-y-2">
            {others.map((standing) => (
              <div
                key={standing.playerId}
                className="animate-rise rounded-full bg-(--panel) border-2 border-(--line) px-6 py-2 flex items-center justify-between gap-3"
              >
                <span className="font-bold text-(--ink)/60 text-xs">
                  {standing.place}
                </span>
                <span className="flex-1 font-bold text-(--ink)">
                  {standing.name}
                </span>
                <span className="font-bold text-(--ink)/60 text-xs">
                  {standing.score}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Button */}
      <Button variant="primary" size="lg" onClick={onBackToLobby} data-testid="podium-continue">
        Same time next week? · New room
      </Button>
    </div>
  );
}
