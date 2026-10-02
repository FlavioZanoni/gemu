"use client";

import { useEffect, useState } from "react";
import { Volume2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { gamesCatalog, gameLabel } from "@/lib/games";
import { Bulbs } from "@/components/ui/Bulbs";
import { hueFor } from "@/components/ui/gameHues";
import { playSfx } from "@/lib/sfx";

/** The next-game reveal (Gemu Prototype · DRUMROLL): names spin through the
 *  playlist in their own hues, then land on the winner. Full-stage overlay so
 *  it shows over whatever screen the room has already moved to. */
export function DrumrollOverlay({ gameType }: { gameType: string }) {
  const { t } = useI18n();
  const [shown, setShown] = useState<{ type: string; settled: boolean }>({ type: gameType, settled: false });

  useEffect(() => {
    playSfx("drumroll");
    const cyclePeriod = 90;
    const cycles = Math.round(1500 / cyclePeriod);
    let n = 0;
    let fanfare: ReturnType<typeof setTimeout> | null = null;
    const timer = setInterval(() => {
      n += 1;
      if (n >= cycles) {
        clearInterval(timer);
        setShown({ type: gameType, settled: true });
        fanfare = setTimeout(() => playSfx("winner"), 100);
        return;
      }
      setShown({ type: gamesCatalog[n % gamesCatalog.length]?.type ?? gameType, settled: false });
    }, cyclePeriod);
    return () => {
      clearInterval(timer);
      if (fanfare) clearTimeout(fanfare);
    };
  }, [gameType]);

  const game = gamesCatalog.find((g) => g.type === shown.type);
  const label = (game ? gameLabel(game.type, t, game.name) : shown.type).toUpperCase();
  const hue = hueFor(shown.type);

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-6 p-4"
      style={{
        background:
          "radial-gradient(ellipse at 50% -20%, rgba(255,120,90,.14), transparent 55%), rgba(28,18,48,.97)",
      }}
      role="status"
      aria-live="polite"
      data-testid="drumroll"
      data-game={gameType}
    >
      <div className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-[0.4em] text-(--accent-2)">
        <Volume2 size={14} strokeWidth={2.5} aria-hidden />
        {shown.settled ? t("drumroll.spoken") : t("drumroll.caption")}
      </div>
      <div
        className="relative rounded-[24px] border-4 border-(--accent) bg-(--panel) text-center"
        style={{ padding: "28px clamp(20px, 6vw, 70px) 30px", minWidth: "min(340px, 90vw)", maxWidth: "94vw" }}
      >
        <Bulbs count={3} size={11} speed={0.35} className="absolute -top-2 left-6 right-6" />
        <div className="font-mono text-xs font-bold uppercase tracking-[0.4em] text-(--accent-2)">{t("common.upNext")}</div>
        <div
          className={`break-words font-display text-[clamp(36px,11vw,64px)] leading-tight ${shown.settled ? "animate-winPop" : ""}`}
          style={{ color: hue.base, textShadow: "0 6px 0 var(--drop)" }}
        >
          {label}
        </div>
      </div>
    </div>
  );
}
