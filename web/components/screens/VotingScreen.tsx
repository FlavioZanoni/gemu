"use client";

import { useEffect, useState } from "react";
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
    <div className="flex flex-col items-center justify-center min-h-screen gap-6 px-6 py-12">
      {/* Header */}
      <div className="text-center mb-4">
        <div className="relative inline-block bg-(--panel) border-4 border-(--accent) rounded-2xl px-8 py-4 mb-6">
          <Bulbs
            count={3}
            size={9}
            className="absolute -top-4 left-0 right-0 px-8"
            style={{ justifyContent: "space-between" }}
          />
          <h1 className="slab text-4xl">{t("voting.title")}</h1>
          <div className="mono-caption mt-1">{t("voting.selectGame")}</div>
        </div>
      </div>

      {/* Timer */}
      <div className="mb-6">
        <TimerBadge deadline={vote.deadline} />
      </div>

      {/* Vote cards */}
      <div className="flex gap-5 flex-wrap justify-center max-w-4xl">
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
                isSelected ? "scale-105" : "hover:-translate-y-1"
              }`}
              style={{
                background: `linear-gradient(180deg, ${hue.gradFrom}, ${hue.gradTo})`,
                border: `2px solid ${isSelected ? "#fff" : hue.drop}`,
                boxShadow: `0 5px 0 ${hue.drop}`,
                color: hue.ink,
              }}
            >
              <div className="text-sm font-bold opacity-75 mb-2">
                {option.type.toUpperCase()}
              </div>
              <h3 className="slab text-2xl mb-1">{game?.name || option.name}</h3>
              <div className="text-xs mb-2 opacity-75">{game?.players}</div>
              <div className="text-xs font-bold mb-3 opacity-60">
                {game?.minPlayers}–{Math.max(game?.minPlayers ?? 2, 10)}
              </div>
              <div className="slab text-5xl">{voteCount}</div>
              <div className="text-xs font-bold mt-2">
                {voteCount === 1 ? "vote" : "votes"}
              </div>
              {isSelected && (
                <div className="text-sm font-bold mt-3">✓ Your vote</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
