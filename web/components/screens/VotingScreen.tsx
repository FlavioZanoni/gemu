"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { Player, VoteState } from "@/lib/protocol";
import { gamesCatalog, gameLabel } from "@/lib/games";
import { TimerBadge } from "@/components/ui/Timer";
import { Bulbs } from "@/components/ui/Bulbs";
import { hueFor } from "@/components/ui/gameHues";

/** Next-game audience vote (Gemu Screens · 6, direction 2a): dark cards in
 *  each game's hue until one is your vote. Closes early once everyone voted. */
export function VotingScreen({
  vote,
  players,
  onCastVote,
}: {
  vote: VoteState | null;
  players: Player[];
  onCastVote: (gameType: string) => void;
}) {
  const { t } = useI18n();
  const [myVote, setMyVote] = useState<string | null>(null);

  if (!vote) {
    return (
      <div className="flex flex-1 items-center justify-center py-12 font-mono text-xs uppercase tracking-[0.2em] text-(--ink)/50">
        {t("voting.opening")}
      </div>
    );
  }

  const votes = vote.counts || {};
  const connected = players.filter((p) => p.connected).length;
  const totalVotes = Object.values(votes).reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 py-8">
      <div className="relative rounded-[18px] border-[3px] border-(--accent) bg-(--panel) px-[34px] pb-4 pt-3.5 text-center">
        <Bulbs count={3} size={9} className="absolute -top-[7px] left-5 right-5" />
        <h1 className="slab text-[30px] uppercase leading-tight" style={{ textShadow: "0 4px 0 var(--drop)" }}>
          {t("voting.title")}
        </h1>
        <div className="font-mono text-[11px] font-bold uppercase tracking-[0.3em] text-(--accent-2)">
          {t("voting.selectGame")}
        </div>
      </div>

      <TimerBadge deadline={vote.deadline} variant="vote" />

      <div className="flex w-full max-w-5xl flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-5" role="group" aria-label={t("voting.title")}>
        {vote.options.map((option, optIdx) => {
          const game = gamesCatalog.find((g) => g.type === option.type);
          const hue = hueFor(option.type);
          const mine = myVote === option.type;
          const count = votes[option.type] || 0;
          const letter = String.fromCharCode(65 + optIdx);
          const min = game?.minPlayers ?? 2;
          const enough = connected >= min;
          const name = (game ? gameLabel(game.type, t, game.name) : option.name).toUpperCase();
          return (
            <button
              key={option.type}
              type="button"
              aria-pressed={mine}
              onClick={() => {
                setMyVote(option.type);
                onCastVote(option.type);
              }}
              data-testid={`vote-option-${option.type}`}
              className="flex min-w-0 items-center gap-3 rounded-2xl px-4 py-3 text-left transition sm:w-56 sm:flex-col sm:gap-0 sm:px-5 sm:py-6 sm:text-center"
              style={
                mine
                  ? {
                      background: `linear-gradient(180deg, ${hue.gradFrom}, ${hue.gradTo})`,
                      border: `2px solid ${hue.base}`,
                      boxShadow: `0 6px 0 ${hue.drop}`,
                      color: hue.ink,
                    }
                  : { background: "var(--panel)", border: `2px solid ${hue.base}`, color: "var(--ink)" }
              }
            >
              <span className="w-5 flex-none font-display text-base sm:mb-1 sm:w-auto" style={{ color: mine ? hue.ink : hue.base }}>
                {letter}
              </span>
              <span className="flex min-w-0 flex-1 flex-col sm:items-center">
                <span className="truncate font-display text-xl sm:text-2xl">{name}</span>
                <span className="font-mono text-[10px] font-semibold uppercase" style={{ opacity: 0.7 }}>
                  {t(`gameTag.${option.type}`)}
                  <span className="sm:hidden"> · {game?.players}</span>
                  {mine ? <span className="sm:hidden"> · {t("voting.yourVote")} ✓</span> : null}
                </span>
                <span
                  className="mt-1 hidden font-mono text-[10px] font-bold uppercase sm:block"
                  style={{ color: enough ? (mine ? hue.ink : "var(--accent-2)") : "var(--danger)" }}
                >
                  {enough
                    ? t("voting.minPlayersOk", { min, n: connected })
                    : t("voting.needsPlayers", { min, n: connected })}
                </span>
              </span>
              {/* Phone: tally pips; wider: the big number. */}
              <span className="flex flex-none gap-1 sm:hidden" aria-hidden>
                {Array.from({ length: Math.min(count, 8) }, (_, i) => (
                  <span key={i} className="h-5 w-2.5 rounded-[3px]" style={{ background: mine ? hue.ink : hue.base }} />
                ))}
              </span>
              <span className="sr-only">{t("voting.votesCount", { n: count })}</span>
              <span className="mt-3 hidden font-display text-5xl sm:block" style={{ color: mine ? hue.ink : "rgba(255,233,168,.7)" }} aria-hidden>
                {count}
              </span>
              {mine ? (
                <span className="mt-2 hidden items-center justify-center gap-1 font-mono text-[10px] font-bold uppercase sm:flex">
                  {t("voting.yourVote")} <Check size={12} strokeWidth={3} aria-hidden />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-(--ink)/50" data-testid="vote-progress">
        {t("voting.progress", { n: totalVotes, total: connected })}
      </div>
    </div>
  );
}
