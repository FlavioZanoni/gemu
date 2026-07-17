"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { VoteState, VoteResult } from "@/lib/protocol";
import { gamesCatalog } from "@/lib/games";
import { Marquee, TimerBadge, Bulbs } from "@/components/ui";
import { hueFor } from "@/components/ui/gameHues";

export function VotingScreen({
  vote,
  voteResult,
  onCastVote,
}: {
  vote: VoteState | null;
  voteResult: VoteResult | null;
  onCastVote: (gameType: string) => void;
}) {
  const { t } = useI18n();
  const [selectedGameType, setSelectedGameType] = useState<string | null>(null);

  // Auto-select vote after brief delay to show result
  useEffect(() => {
    if (voteResult && !selectedGameType) {
      const timer = setTimeout(() => {
        setSelectedGameType(voteResult.gameType);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [voteResult, selectedGameType]);

  if (voteResult) {
    const winnerGame = gamesCatalog.find((g) => g.type === voteResult.gameType);
    const hue = hueFor(voteResult.gameType);
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-6 text-center px-6 py-12">
        <div>
          <h1 className="slab text-4xl">{t("voting.upComingNext")}</h1>
          <p className="text-(--ink)/70 text-sm mt-2">
            Voted by everyone!
          </p>
        </div>

        <Marquee caption={t("common.upNext")} className="animate-winPop">
          {winnerGame?.name.toUpperCase() || voteResult.gameName}
        </Marquee>

        <div className="text-sm text-(--ink)/60 mt-6">
          Ready for the next round...
        </div>
      </div>
    );
  }

  if (!vote) return null;

  const votes = vote.counts || {};

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-8 px-6 py-12">
      {/* Header */}
      <div className="text-center">
        <div className="relative inline-block bg-(--panel) border-4 border-(--accent) rounded-2xl px-10 py-5 mb-8">
          <Bulbs
            count={3}
            size={9}
            className="absolute -top-4 left-0 right-0"
            style={{ justifyContent: "space-between", padding: "0 2rem" }}
          />
          <h1 className="slab text-4xl mb-1">{t("voting.title")}</h1>
          <div className="mono-caption">{t("voting.selectGame")}</div>
        </div>
      </div>

      {/* Timer */}
      <div>
        <TimerBadge deadline={vote.deadline} />
      </div>

      {/* Vote cards */}
      <div className="flex gap-6 flex-wrap justify-center max-w-5xl">
        {vote.options.map((option) => {
          const game = gamesCatalog.find((g) => g.type === option.type);
          const hue = hueFor(option.type);
          const isSelected = selectedGameType === option.type;
          const voteCount = votes[option.type] || 0;

          return (
            <div
              key={option.type}
              onClick={() => {
                setSelectedGameType(option.type);
                onCastVote(option.type);
              }}
              className={`w-56 rounded-2xl p-6 text-center cursor-pointer transition ${
                isSelected ? "scale-105 shadow-xl" : "hover:-translate-y-1"
              }`}
              style={{
                background: `linear-gradient(180deg, ${hue.gradFrom}, ${hue.gradTo})`,
                border: `2px solid ${isSelected ? "rgba(255,255,255,0.4)" : "transparent"}`,
                boxShadow: `0 5px 0 ${hue.drop}`,
                color: hue.ink,
              }}
              data-testid={`vote-option-${option.type}`}
            >
              <div className="text-xs font-bold opacity-75 mb-2 uppercase tracking-widest">
                {option.type}
              </div>
              <h3 className="slab text-2xl mb-2">{game?.name || option.name}</h3>
              <div className="text-xs mb-1 opacity-80 font-semibold">{game?.players}</div>
              <div className="text-xs font-bold mb-4 opacity-60">
                {game?.minPlayers}–{Math.max(game?.minPlayers ?? 2, 10)}
              </div>
              <div className="slab text-5xl mb-1">{voteCount}</div>
              <div className="text-xs font-bold mb-3">
                {voteCount === 1 ? "vote" : "votes"}
              </div>
              {isSelected && (
                <div className="text-xs font-bold flex items-center justify-center gap-1">
                  <Check size={14} strokeWidth={2.5} /> Your vote
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Progress */}
      <div className="mt-4 text-xs font-semibold text-(--ink)/70 uppercase tracking-widest">
        {Object.values(votes).reduce((a, b) => a + b, 0)} of {vote.options.length} contestants voted
      </div>
    </div>
  );
}
