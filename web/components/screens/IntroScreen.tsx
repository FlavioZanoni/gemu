"use client";

import { Check, Star, Users } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { gamesCatalog, gameSettings, minPlayersFor, gameLabel } from "@/lib/games";
import type { Player } from "@/lib/protocol";
import { hueFor } from "@/components/ui/gameHues";
import { Bulbs } from "@/components/ui/Bulbs";

/**
 * Pre-game intro (Gemu Prototype · INTRO, Screens · 3): the queued game's
 * name, how to play, the host's options, and GOT IT — I'M READY. The game
 * starts by itself once everyone connected is ready; the host can also
 * start now.
 */
export function IntroScreen({
  gameType,
  gameNumber,
  settings,
  isAdmin,
  players,
  playerId,
  onSetting,
  onReady,
  onStartNow,
  onManage,
}: {
  gameType: string;
  /** 1-based game number of the night. */
  gameNumber: number;
  /** Host's chosen values by settings key (missing = server default). */
  settings: Record<string, number>;
  isAdmin: boolean;
  players: Player[];
  playerId: string | null;
  onSetting: (key: string, value: number) => void;
  onReady: () => void;
  onStartNow: () => void;
  onManage?: () => void;
}) {
  const { t } = useI18n();
  const game = gamesCatalog.find((g) => g.type === gameType);
  const name = (game ? gameLabel(game.type, t, game.name) : gameType).toUpperCase();
  const hue = hueFor(gameType);
  const stepCount = game?.howToSteps ?? 0;
  const connected = players.filter((p) => p.connected);
  const readyCount = connected.filter((p) => p.ready).length;
  const meReady = Boolean(players.find((p) => p.id === playerId)?.ready);
  const specs = gameSettings[gameType] ?? [];
  const tooFew = connected.length < minPlayersFor(gameType);

  const status =
    readyCount === connected.length - (meReady ? 0 : 1) && !meReady && connected.length > 1
      ? t("intro.waitingOnYou")
      : t("intro.readyStatus", { ready: readyCount, total: connected.length });

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 py-8 lg:flex-row lg:gap-[60px]">
      {/* Title: plain on desktop, a bulb marquee on phones. */}
      <div className="animate-slam text-center">
        <div className="relative inline-block rounded-[22px] border-[3px] border-(--accent) bg-(--panel) px-8 pb-4 pt-4 lg:border-0 lg:bg-transparent lg:p-0">
          <Bulbs count={3} size={9} className="absolute -top-[6px] left-5 right-5 lg:hidden" />
          <div className="font-mono text-xs font-bold uppercase tracking-[0.4em] text-(--accent-2)">
            <span className="lg:hidden">{t("common.upNext")}</span>
            <span className="hidden lg:inline">{t("intro.gameUpNext", { n: gameNumber })}</span>
          </div>
          <h1
            className="break-words font-display text-[clamp(40px,12vw,80px)] leading-[1.05] text-(--ink)"
            style={{ textShadow: "0 7px 0 var(--drop)" }}
            data-testid="intro-title"
          >
            {name}
          </h1>
          <div className="mt-1 font-mono text-[11px] font-semibold uppercase text-(--ink)/45 lg:hidden">
            {t("intro.gameOfNight", { n: gameNumber })}
          </div>
        </div>
        <p className="mt-3 hidden font-mono text-[13px] font-semibold uppercase text-(--ink)/45 lg:block">{status}</p>
      </div>

      <div className="w-full max-w-[440px]">
        {stepCount > 0 ? (
          <div className="mb-4 overflow-hidden rounded-[20px] border-[3px] bg-(--panel)" style={{ borderColor: hue.base }}>
            <div
              className="px-5 py-3.5 font-mono text-[10px] font-bold uppercase tracking-[0.3em]"
              style={{ background: `linear-gradient(180deg, ${hue.gradFrom}, ${hue.gradTo})`, color: `${hue.ink}b3` }}
            >
              {t("intro.howToPlay")}
            </div>
            <ol className="flex flex-col gap-3.5 p-5">
              {Array.from({ length: stepCount }, (_, idx) => (
                <li key={idx} className="flex gap-3">
                  <span
                    className="flex h-[27px] w-[27px] flex-none items-center justify-center rounded-full font-display text-[13px]"
                    style={{ background: hue.base, color: hue.ink }}
                  >
                    {idx + 1}
                  </span>
                  <span className="flex-1 text-[15px] font-medium leading-[1.45] text-(--ink)">
                    {t(`howto.${gameType}.${idx + 1}`)}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        {isAdmin && specs.length > 0 ? (
          <div className="mb-4 rounded-2xl border-2 border-(--line) bg-(--panel) px-4 py-4" data-testid="intro-options">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-(--ink)/50">
                {t("intro.gameOptions")}
              </span>
              <span className="flex items-center gap-1 font-mono text-[9px] font-bold uppercase text-(--accent)">
                <Star size={11} strokeWidth={2.5} aria-hidden /> {t("intro.hostOnly")}
              </span>
            </div>
            {specs.map((spec) => {
              const current = settings[spec.key] ?? spec.def;
              const label = spec.kind === "rounds" ? t("intro.rounds") : t("intro.roundTimer");
              return (
                <div key={spec.key} className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 last:mb-0" role="group" aria-label={label}>
                  <span className="w-[100px] font-mono text-[10px] font-bold uppercase text-(--ink)/50">{label}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {spec.options.map((value) => {
                      const on = current === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={on}
                          data-testid={`intro-opt-${spec.key}-${value}`}
                          onClick={() => onSetting(spec.key, value)}
                          className="min-w-[42px] rounded-[10px] border-2 px-2 py-2 font-display text-[13px]"
                          style={
                            on
                              ? {
                                  background: "linear-gradient(180deg,#ffd23f,#f5b32a)",
                                  borderColor: "#ffd23f",
                                  color: "var(--dark-ink)",
                                }
                              : { background: "var(--bg)", borderColor: "var(--line)", color: "rgba(255,233,168,.6)" }
                          }
                        >
                          {spec.kind === "timer" ? `${value}s` : value}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        {meReady ? (
          <div
            className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-(--accent-2) bg-(--panel) py-4 font-display text-lg uppercase text-(--accent-2)"
            role="status"
            data-testid="intro-ready-done"
          >
            <Check size={18} strokeWidth={3} aria-hidden /> {t("common.ready")}
          </div>
        ) : (
          <button
            type="button"
            className="buzzer w-full rounded-2xl py-[18px] text-lg uppercase"
            style={{ background: "linear-gradient(180deg,#ffd23f,#f5b32a)", color: "var(--dark-ink)", boxShadow: "0 6px 0 var(--drop)" }}
            onClick={onReady}
            data-testid="intro-ready"
          >
            {t("common.gotIt")}
          </button>
        )}
        <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-[0.1em] text-(--ink)/45" aria-live="polite">
          {tooFew ? t("intro.tooFew", { n: minPlayersFor(gameType) }) : t("intro.startsWhenAll", { ready: readyCount, total: connected.length })}
        </p>

        {isAdmin ? (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
            <button
              type="button"
              data-testid="intro-start"
              onClick={onStartNow}
              className="rounded-full border-2 border-(--accent) px-4 py-2 font-sans text-[13px] font-bold text-(--accent) hover:bg-(--accent)/10"
            >
              {readyCount === connected.length ? t("intro.startNow") : t("intro.startAnyway")} ▶
            </button>
            {onManage ? (
              <button
                type="button"
                data-testid="manage-room"
                onClick={onManage}
                className="flex items-center gap-1.5 rounded-full border-2 border-(--accent-2) px-4 py-2 font-sans text-[13px] font-bold text-(--accent-2) hover:bg-(--accent-2)/10"
              >
                <Users size={14} strokeWidth={2.5} aria-hidden /> {t("manage.title")}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
