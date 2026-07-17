"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import type { VoteState, VoteResult } from "@/lib/protocol";
import { gamesCatalog } from "@/lib/games";
import { Card, Marquee, TimerBadge } from "@/components/ui";
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
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-6 text-center px-6">
        <div>
          <h1 className="slab text-4xl">{t("voting.upComingNext")}</h1>
          <p className="text-(--ink)/70 text-sm mt-2">
            Voted by everyone!
          </p>
        </div>

        <Marquee caption={t("common.upNext")} className="pop-in">
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
    <div className="flex flex-col gap-6 min-h-screen">
      <div className="text-center px-6">
        <h1 className="slab text-3xl">{t("voting.title")}</h1>
        <p className="text-(--ink)/70 text-sm mt-2">
          {t("voting.selectGame")}
        </p>
        <div className="mt-4 flex justify-center">
          <TimerBadge deadline={vote.deadline} />
        </div>
      </div>

      <div className="px-6 flex-1">
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
          {vote.options.map((option) => {
            const game = gamesCatalog.find((g) => g.type === option.type);
            const hue = hueFor(option.type);
            const isSelected = selectedGameType === option.type;
            const voteCount = votes[option.type] || 0;

            return (
              <Card
                key={option.type}
                variant={isSelected ? "selected" : "panel"}
                gameType={option.type}
                className="cursor-pointer transition active:scale-95"
                onClick={() => {
                  setSelectedGameType(option.type);
                  onCastVote(option.type);
                }}
              >
                <div className="text-sm font-bold text-(--ink) mb-1">
                  {game?.name || option.name}
                </div>
                <div
                  className="text-xs font-mono px-2 py-1 rounded inline-block mt-2"
                  style={{
                    background: `${hue.base}20`,
                    color: hue.base,
                  }}
                >
                  {voteCount} {voteCount === 1 ? t("voting.voteCount", { count: 1 }) : t("voting.voteCounts", { count: voteCount })}
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
