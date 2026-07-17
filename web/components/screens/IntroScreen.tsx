"use client";

import { Star } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { gamesCatalog } from "@/lib/games";
import { hueFor } from "@/components/ui/gameHues";
import { Button, Bulbs } from "@/components/ui";

export function IntroScreen({
  gameType,
  roundCount,
  roundTimer,
  isAdmin,
  onSetRounds,
  onSetTimer,
  onReady,
}: {
  gameType: string;
  roundCount: number;
  roundTimer: number;
  isAdmin: boolean;
  onSetRounds: (count: number) => void;
  onSetTimer: (seconds: number) => void;
  onReady: () => void;
}) {
  const { t } = useI18n();
  const game = gamesCatalog.find((g) => g.type === gameType);
  const hue = hueFor(gameType);
  const stepCount = game?.howToSteps ?? 0;

  // Round / timer choices per game (literal — no interpolation needed).
  const gameOptions: Record<string, { rounds: number[]; timer: number[] }> = {
    invention: { rounds: [1, 2, 3, 4, 5], timer: [] },
    stop: { rounds: [1, 3, 5, 7, 9], timer: [30, 165, 300] },
    gartic: { rounds: [1, 2, 3, 5, 7, 9], timer: [30, 105, 180] },
    garticphone: { rounds: [1, 3, 5, 7, 9], timer: [30, 165, 300] },
    cah: { rounds: [3, 7, 8, 11, 15, 19], timer: [] },
  };
  const { rounds: roundOptions, timer: timerOptions } =
    gameOptions[gameType] || gameOptions.stop;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-12 px-6 py-12">
      {/* Game intro on left */}
      <div className="text-center animate-slam">
        <div className="mono-caption mb-3">{t("common.upNext")}</div>
        <h1 className="slab text-9xl">{game?.name.toUpperCase() || gameType}</h1>
        <p className="text-sm text-(--ink)/60 mt-4">
          Everyone else is ready · Waiting on you
        </p>
      </div>

      {/* How to play on right */}
      {stepCount > 0 && (
        <div className="w-full max-w-sm">
          {/* How to play box */}
          <div
            className="rounded-2xl border-4 bg-(--panel) mb-5 overflow-hidden"
            style={{ borderColor: hue.base }}
          >
            <div
              className="px-5 py-3 text-xs font-bold uppercase tracking-widest"
              style={{
                background: `linear-gradient(180deg, ${hue.gradFrom}, ${hue.gradTo})`,
                color: hue.ink,
              }}
            >
              How to play
            </div>
            <div className="p-5 space-y-4">
              {Array.from({ length: stepCount }, (_, idx) => (
                <div key={idx} className="flex gap-3">
                  <div
                    className="flex-none w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                    style={{
                      background: hue.base,
                      color: hue.ink,
                    }}
                  >
                    {idx + 1}
                  </div>
                  <div className="flex-1 text-sm leading-relaxed text-(--ink)">
                    {t(`howto.${gameType}.${idx + 1}`)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Game options (admin only) */}
          {isAdmin && (
            <div className="rounded-2xl border-2 border-(--line) bg-(--panel) p-4 mb-5">
              <div className="flex justify-between items-baseline mb-3">
                <span className="mono-caption">Game Options</span>
                <span className="text-xs font-bold text-(--accent) flex items-center gap-1">
                  <Star size={14} strokeWidth={2.5} style={{ color: "#ffd23f" }} /> Host Only
                </span>
              </div>

              <div className="mb-4">
                <span className="text-xs font-bold text-(--ink)/60 uppercase tracking-widest">
                  Rounds
                </span>
                <div className="flex gap-2 mt-2">
                  {roundOptions.map((count) => (
                    <button
                      key={count}
                      onClick={() => onSetRounds(count)}
                      className={`min-w-11 py-2 rounded-lg border-2 font-bold text-sm transition ${
                        roundCount === count
                          ? "text-(--dark-ink)"
                          : "border-(--line) bg-transparent text-(--ink)"
                      }`}
                      style={
                        roundCount === count
                          ? {
                              borderColor: hue.base,
                              background: hue.base,
                              color: hue.ink,
                            }
                          : {}
                      }
                    >
                      {count}
                    </button>
                  ))}
                </div>
              </div>

              {timerOptions.length > 0 && (
                <div>
                  <span className="text-xs font-bold text-(--ink)/60 uppercase tracking-widest">
                    Round Timer
                  </span>
                  <div className="flex gap-2 mt-2">
                    {timerOptions.map((seconds) => (
                      <button
                        key={seconds}
                        onClick={() => onSetTimer(seconds)}
                        className={`min-w-14 py-2 rounded-lg border-2 font-bold text-sm transition`}
                        style={
                          roundTimer === seconds
                            ? {
                                borderColor: "#35d4b9",
                                background: "#35d4b9",
                                color: "#0c3d33",
                              }
                            : {
                                borderColor: "var(--line)",
                                background: "transparent",
                                color: "var(--ink)",
                              }
                        }
                      >
                        {seconds}s
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Ready button */}
          <Button
            className="w-full py-4 text-lg font-bold"
            onClick={onReady}
          >
            Got it — I&apos;m ready
          </Button>
        </div>
      )}
    </div>
  );
}
