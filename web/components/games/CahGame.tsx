"use client";

import { useEffect, useState, useMemo } from "react";
import { useI18n } from "@/lib/i18n";
import { Card, Button, TimerBadge, Banner, ScoreStrip, HowToPlayModal } from "../ui";
import type { GameProps } from "./types";

type CahPublicState = {
  phase: "answering" | "judging" | "roundResults";
  round: number;
  totalRounds: number;
  judge: string;
  blackCard: { text: string; pick: number };
  wins: Record<string, number>;
  deadline: number;
  submittedCount?: number;
  submitted?: string[];
  submissions?: string[][];
  reveal?: Array<{ playerId: string; cards: string[]; winner: boolean }>;
  winner?: string;
};

type CahPrivateState = {
  hand?: string[];
  submitted?: boolean;
  isJudge?: boolean;
};

export function CahGame(props: GameProps) {
  const { t } = useI18n();
  const publicState = props.publicState as CahPublicState | null;
  const privateState = props.privateState as CahPrivateState | null;

  const phase = publicState?.phase ?? "answering";
  const round = publicState?.round ?? 1;
  const totalRounds = publicState?.totalRounds ?? 8;
  const judge = publicState?.judge ?? "";
  const blackCard = publicState?.blackCard ?? { text: "", pick: 1 };
  const wins = publicState?.wins ?? {};
  const deadline = publicState?.deadline ?? null;
  const isJudge = privateState?.isJudge ?? false;
  const hasSubmitted = privateState?.submitted ?? false;
  const hand = privateState?.hand ?? [];
  const submittedCount = publicState?.submittedCount ?? 0;
  const submitted = publicState?.submitted ?? [];
  const submissions = publicState?.submissions ?? [];
  const reveal = publicState?.reveal ?? [];
  const winner = publicState?.winner ?? "";

  const [selectedCards, setSelectedCards] = useState<number[]>([]);
  const [showHowTo, setShowHowTo] = useState(round === 1 && phase === "answering");

  const standings = useMemo(
    () =>
      Object.entries(wins)
        .map(([playerId, score]) => ({ playerId, score }))
        .sort((a, b) => b.score - a.score),
    [wins]
  );

  const playerNames = useMemo(() => {
    const map = new Map<string, string>();
    props.players.forEach((player) => {
      map.set(player.id, player.name);
    });
    return map;
  }, [props.players]);

  const judgeeName = useMemo(() => playerNames.get(judge), [judge, playerNames]);

  const toggleCard = (index: number) => {
    if (hasSubmitted) return;
    setSelectedCards((prev) => {
      if (prev.includes(index)) {
        return prev.filter((i) => i !== index);
      }
      if (prev.length < blackCard.pick) {
        return [...prev, index];
      }
      return prev;
    });
  };

  const handleSubmit = () => {
    if (selectedCards.length === blackCard.pick && !hasSubmitted) {
      props.sendAction({ action: "submit", cards: selectedCards });
      setSelectedCards([]);
    }
  };

  const handlePickWinner = (index: number) => {
    if (isJudge) {
      props.sendAction({ action: "pick_winner", index });
    }
  };

  // Answering phase
  if (phase === "answering") {
    return (
      <>
        <HowToPlayModal
          open={showHowTo}
          gameType="cah"
          gameName="CARTAS"
          stepCount={3}
          onClose={() => setShowHowTo(false)}
        />
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-mono text-(--ink)/60">ROUND {round} OF {totalRounds}</div>
              <div className="slab mt-1 text-2xl" style={{ color: "var(--hue-cah)" }}>
                JUDGE: {judgeeName}
              </div>
            </div>
            <TimerBadge deadline={deadline} />
          </div>

          {/* Black card */}
          <Card variant="hero" gameType="cah">
            <div className="text-center">
              <div className="text-sm opacity-75 mb-2">BLACK CARD</div>
              <div className="font-display text-xl leading-tight">
                {blackCard.text
                  .split("_")
                  .map((part, i) =>
                    i % 2 === 0 ? part : <span key={i} className="underline">__</span>
                  )}
              </div>
              <div className="text-xs mt-3 opacity-75">
                Select {blackCard.pick} card{blackCard.pick > 1 ? "s" : ""}
              </div>
            </div>
          </Card>

          {/* Submitted count */}
          {(submittedCount ?? 0) > 0 && (
            <Banner variant="waiting">
              {submittedCount} of {props.players.length - 1} players submitted
            </Banner>
          )}

          {/* Hand */}
          {!isJudge && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-(--ink)/70">YOUR HAND</div>
              <div className="grid grid-cols-2 gap-2">
                {hand.map((card, idx) => (
                  <button
                    key={idx}
                    onClick={() => toggleCard(idx)}
                    disabled={hasSubmitted}
                    className={`rounded-lg border-2 p-3 text-sm font-sans transition ${
                      selectedCards.includes(idx)
                        ? "border-[var(--hue-cah)] bg-(--panel-raised) ring-2 ring-[var(--hue-cah)]/50"
                        : "border-(--line) bg-(--panel) hover:border-[var(--hue-cah)]"
                    } ${hasSubmitted ? "opacity-50" : ""}`}
                  >
                    <span className="block leading-tight">{card}</span>
                  </button>
                ))}
              </div>

              <Button
                variant="hue"
                gameType="cah"
                onClick={handleSubmit}
                disabled={selectedCards.length !== blackCard.pick || hasSubmitted}
                className="w-full"
              >
                {hasSubmitted ? "SUBMITTED" : "SUBMIT"}
              </Button>
            </div>
          )}

          {isJudge && (
            <Banner variant="waiting">
              {t("cah.judging")} • Waiting for others to submit…
            </Banner>
          )}

          <ScoreStrip standings={standings} players={props.players} playerId={props.playerId} />
        </div>
      </>
    );
  }

  // Judging phase
  if (phase === "judging") {
    return (
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-mono text-(--ink)/60">JUDGING</div>
            <div className="slab mt-1 text-2xl" style={{ color: "var(--hue-cah)" }}>
              {judgeeName}
            </div>
          </div>
          <TimerBadge deadline={deadline} />
        </div>

        {/* Black card */}
        <Card variant="hero" gameType="cah">
          <div className="text-center">
            <div className="font-display text-xl leading-tight">
              {blackCard.text
                .split("_")
                .map((part, i) =>
                  i % 2 === 0 ? part : <span key={i} className="underline">__</span>
                )}
            </div>
          </div>
        </Card>

        {/* Submissions to judge */}
        {isJudge && (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-(--ink)/70">
              PICK THE FUNNIEST
            </div>
            <div className="grid grid-cols-1 gap-2">
              {submissions.map((sub, idx) => (
                <button
                  key={idx}
                  onClick={() => handlePickWinner(idx)}
                  className="rounded-lg border-2 border-(--line) bg-(--panel) p-4 text-left transition hover:border-[var(--hue-cah)] hover:bg-(--panel-raised)"
                >
                  {sub.map((card, cardIdx) => (
                    <div key={cardIdx} className="font-sans">
                      {card}
                    </div>
                  ))}
                </button>
              ))}
            </div>
          </div>
        )}

        {!isJudge && (
          <Banner variant="waiting">
            Waiting for {judgeeName} to judge…
          </Banner>
        )}

        <ScoreStrip standings={standings} players={props.players} playerId={props.playerId} />
      </div>
    );
  }

  // Round results phase
  return (
    <div className="space-y-4">
      <div className="slab text-center text-3xl mb-4">
        Round {round} Results
      </div>

      {/* Black card */}
      <Card variant="hero" gameType="cah">
        <div className="text-center">
          <div className="font-display text-xl leading-tight">
            {blackCard.text
              .split("_")
              .map((part, i) =>
                i % 2 === 0 ? part : <span key={i} className="underline">__</span>
              )}
          </div>
        </div>
      </Card>

      {/* Reveal submissions */}
      <div className="space-y-2">
        {reveal.map((item, idx) => (
          <Card
            key={idx}
            variant={item.winner ? "selected" : "panel"}
            gameType="cah"
            className={item.winner ? "ring-2" : ""}
          >
            <div className="space-y-1">
              {item.cards.map((card, cardIdx) => (
                <div key={cardIdx} className="font-sans text-sm">
                  {card}
                </div>
              ))}
            </div>
            {item.winner && (
              <div className="mt-2 text-xs font-semibold text-center">
                ★ {playerNames.get(item.playerId)} WINS!
              </div>
            )}
          </Card>
        ))}
      </div>

      <ScoreStrip standings={standings} players={props.players} playerId={props.playerId} />
    </div>
  );
}
