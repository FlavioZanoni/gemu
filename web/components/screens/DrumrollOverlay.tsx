"use client";

import { useMemo } from "react";
import { gamesCatalog } from "@/lib/games";
import { Bulbs } from "@/components/ui";
import { hueFor } from "@/components/ui/gameHues";

export function DrumrollOverlay({ gameType }: { gameType: string }) {
  const game = gamesCatalog.find((g) => g.type === gameType);
  const hue = hueFor(gameType);

  // Generate confetti
  const confetti = useMemo(() => {
    const colors = ["#ffd23f", "#ff8a9b", "#8ceedd", "#35d4b9", "#ff9d3f"];
    return Array.from({ length: 20 }, (_, i) => ({
      id: i,
      left: `${Math.random() * 100}%`,
      color: colors[i % colors.length],
      duration: 3 + Math.random() * 2,
      delay: Math.random() * 0.3,
    }));
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center overflow-hidden">
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

      {/* Center content */}
      <div className="text-center relative z-10 animate-slam">
        <div className="relative inline-block mb-8">
          <div
            className="relative border-4 rounded-2xl px-8 py-4"
            style={{
              borderColor: hue.base,
              background: "#2b1a3d",
            }}
          >
            <Bulbs
              count={3}
              size={10}
              className="absolute -top-5 left-0 right-0 px-8"
              style={{ justifyContent: "space-between" }}
            />
            <div className="slab text-5xl" style={{ color: hue.ink }}>
              {game?.name.toUpperCase() || gameType}
            </div>
            <div className="mono-caption mt-2">Next game</div>
          </div>
        </div>

        <p className="text-lg text-(--ink)/60 mt-8">
          Get ready…
        </p>
      </div>
    </div>
  );
}
