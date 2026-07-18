"use client";

import { useEffect, useState } from "react";
import { gamesCatalog } from "@/lib/games";
import { Bulbs } from "@/components/ui";
import { hueFor } from "@/components/ui/gameHues";
import { playSfx } from "@/lib/sfx";

export function DrumrollOverlay({ gameType }: { gameType: string }) {
  const game = gamesCatalog.find((g) => g.type === gameType);
  const hue = hueFor(gameType);
  const [displayedName, setDisplayedName] = useState<string>(
    game?.name.toUpperCase() || gameType.toUpperCase()
  );

  // Slot machine name-cycling effect for ~1.5s, then settle on winner
  useEffect(() => {
    playSfx("drumroll");

    const cyclingDuration = 1500; // 1.5 seconds of cycling
    const cyclePeriod = 80; // cycle every ~80ms
    let currentCycle = 0;

    const cycleTimer = setInterval(() => {
      const randomGame =
        gamesCatalog[Math.floor(Math.random() * gamesCatalog.length)];
      setDisplayedName(randomGame?.name.toUpperCase() || gameType.toUpperCase());
      currentCycle++;

      // After cycling duration expires, show the actual winner
      if (currentCycle * cyclePeriod >= cyclingDuration) {
        clearInterval(cycleTimer);
        setDisplayedName(game?.name.toUpperCase() || gameType.toUpperCase());
        // Winner fanfare after settling
        setTimeout(() => playSfx("winner"), 100);
      }
    }, cyclePeriod);

    return () => clearInterval(cycleTimer);
  }, [gameType, game?.name]);

  return (
    <div className="flex flex-col items-center justify-center gap-8">
      <div className="mono-caption">🔊 Next game reveal</div>

      <div className="relative inline-block">
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
            speed={0.35}
            className="absolute -top-5 left-0 right-0 px-8"
            style={{ justifyContent: "space-between" }}
          />
          <div className="slab text-5xl" style={{ color: hue.ink }}>
            {displayedName}
          </div>
          <div className="mono-caption mt-2">Up next</div>
        </div>
      </div>
    </div>
  );
}
