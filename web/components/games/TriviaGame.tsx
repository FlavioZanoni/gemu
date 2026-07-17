"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { TimerBadge, ScoreStrip, Banner, HowToPlayModal } from "../ui";
import { hueFor } from "../ui/gameHues";
import { playSfx } from "@/lib/sfx";
import type { GameProps } from "./types";

type TriviaPublic = {
  phase: "question" | "reveal";
  round: number;
  totalRounds: number;
  question: string;
  options: string[];
  scores: Record<string, number>;
  answered: string[];
  deadline?: number;
  correct?: number;
  choices?: Record<string, number>;
};

const optionColors = ["#ff4f6f", "#4f9dff", "#ffd23f", "#35d4b9"];

export function TriviaGame(props: GameProps) {
  const { t } = useI18n();
  const pub = props.publicState as TriviaPublic | null;
  const priv = props.privateState as { choice?: number } | null;
  const hue = hueFor("trivia");
  const [showHow, setShowHow] = useState(false);

  // publicState is briefly {} between status:playing and the first game.state,
  // so guard the round payload, not just null.
  if (!pub || !pub.options) return null;
  const standings = Object.entries(pub.scores ?? {})
    .map(([playerId, score]) => ({ playerId, score }))
    .sort((a, b) => b.score - a.score);
  const myChoice = priv?.choice;
  const answered = myChoice !== undefined;

  return (
    <div className="flex flex-col gap-4">
      <HowToPlayModal
        open={showHow}
        gameType="trivia"
        gameName="Trivia"
        stepCount={3}
        onClose={() => setShowHow(false)}
      />
      <div className="flex items-center justify-between">
        <span className="mono-caption" style={{ color: hue.base }}>
          {t("common.round", { n: pub.round, total: pub.totalRounds })}
        </span>
        {pub.deadline ? <TimerBadge deadline={pub.deadline} /> : null}
      </div>

      <div
        className="rounded-2xl p-6 text-center"
        style={{ background: `linear-gradient(180deg,${hue.gradFrom},${hue.gradTo})`, color: hue.ink }}
      >
        <div className="slab text-xl leading-snug">{pub.question}</div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {pub.options.map((opt, i) => {
          const isCorrect = pub.phase === "reveal" && pub.correct === i;
          const isMine = myChoice === i;
          const wrongMine = pub.phase === "reveal" && isMine && !isCorrect;
          return (
            <button
              key={i}
              disabled={answered || pub.phase === "reveal"}
              onClick={() => {
                playSfx("click");
                props.sendAction({ action: "answer", choice: i });
              }}
              className="flex items-center gap-3 rounded-2xl border-2 px-4 py-4 text-left font-bold transition disabled:cursor-default"
              style={{
                borderColor: isCorrect
                  ? "#35d4b9"
                  : wrongMine
                    ? "#ff4f6f"
                    : isMine
                      ? hue.base
                      : "var(--line)",
                background: isCorrect
                  ? "rgba(53,212,185,.15)"
                  : isMine
                    ? `${hue.base}22`
                    : "var(--panel)",
                opacity: answered && !isMine && pub.phase === "question" ? 0.6 : 1,
              }}
              data-testid={`trivia-option-${i}`}
            >
              <span
                className="flex h-8 w-8 flex-none items-center justify-center rounded-lg font-display text-sm text-white"
                style={{ background: optionColors[i % 4] }}
              >
                {String.fromCharCode(65 + i)}
              </span>
              <span className="text-(--ink)">{opt}</span>
              {isCorrect ? <span className="ml-auto">✓</span> : null}
            </button>
          );
        })}
      </div>

      {pub.phase === "question" && answered ? (
        <Banner variant="waiting">{t("trivia.locked")}</Banner>
      ) : null}
      {pub.phase === "reveal" ? (
        <div className="text-center font-mono text-xs text-(--ink)/60">
          {t("trivia.answeredCount", { n: pub.answered?.length ?? 0 })}
        </div>
      ) : null}

      <div className="mt-2 flex items-center justify-between">
        <button
          onClick={() => setShowHow(true)}
          className="rounded-full border-2 border-(--accent-2) px-3 py-1.5 text-xs font-semibold text-(--accent-2)"
        >
          {t("common.howToPlay")}
        </button>
      </div>
      <ScoreStrip standings={standings} players={props.players} playerId={props.playerId} />
    </div>
  );
}
