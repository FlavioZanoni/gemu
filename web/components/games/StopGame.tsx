"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { useI18n } from "@/lib/i18n";
import { Card, Button, TimerBadge, TimerBar, Banner, ScoreStrip, PlayerChip, HowToPlayModal } from "../ui";
import type { GameProps } from "./types";

type StopPublicState = {
  phase: "answering" | "validating" | "roundResults";
  round: number;
  totalRounds: number;
  letter: string;
  categories: string[];
  totalScores: Record<string, number>;
  deadline: number;
  stopped: boolean;
  stoppedBy: string;
  answersFilled?: Record<string, number>;
  answers?: Record<string, Array<{ playerId: string; answer: string; autoInvalid?: boolean }>>;
  validatedCount?: number;
  results?: Record<string, Array<{ playerId: string; answer: string; verdict: "unique" | "duplicate" | "invalid"; points: number }>>;
  roundScores?: Record<string, number>;
};

type StopPrivateState = {
  answers?: Record<string, string>;
  validated?: boolean;
  rejected?: string[];
};

export function StopGame(props: GameProps) {
  const { t } = useI18n();
  const publicState = props.publicState as StopPublicState | null;
  const privateState = props.privateState as StopPrivateState | null;

  const phase = publicState?.phase ?? "answering";
  const round = publicState?.round ?? 1;
  const totalRounds = publicState?.totalRounds ?? 3;
  const letter = publicState?.letter ?? "?";
  const categories = publicState?.categories ?? [];
  const deadline = publicState?.deadline ?? null;
  const stopped = publicState?.stopped ?? false;
  const stoppedBy = publicState?.stoppedBy ?? "";
  const totalScores = publicState?.totalScores ?? {};
  const standings = useMemo(
    () =>
      Object.entries(totalScores)
        .map(([playerId, score]) => ({ playerId, score }))
        .sort((a, b) => b.score - a.score),
    [totalScores]
  );

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const [showHowTo, setShowHowTo] = useState(round === 1 && phase === "answering");

  // Hydrate answers from the server ONCE per round (rejoin/refresh case).
  // Private state re-broadcasts on every action; syncing each time would
  // clobber in-progress typing with the server echo.
  const hydratedRound = useRef<number | null>(null);
  useEffect(() => {
    if (hydratedRound.current === round) return;
    if (privateState?.answers) {
      hydratedRound.current = round;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAnswers(privateState.answers);
    }
  }, [round, privateState?.answers]);

  // Debounce set_answers
  useEffect(() => {
    const timer = setTimeout(() => {
      if (Object.keys(answers).length > 0) {
        props.sendAction({ action: "set_answers", answers });
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [answers, props]);

  const handleAnswerChange = (category: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [category]: value }));
  };

  const handleStop = () => {
    if (!stopped) {
      props.sendAction({ action: "stop" });
    }
  };

  const handleValidate = () => {
    const rejectedList = Array.from(rejected);
    props.sendAction({ action: "validate", rejected: rejectedList });
  };

  const handleNextRound = () => {
    if (props.isAdmin) {
      props.sendAction({ action: "next_round" });
    }
  };

  const playerNames = useMemo(() => {
    const map = new Map<string, string>();
    props.players.forEach((player, idx) => {
      map.set(player.id, player.name);
    });
    return map;
  }, [props.players]);

  // Answering phase
  if (phase === "answering") {
    const allAnswered = categories.every((cat) => answers[cat]?.trim());
    return (
      <>
        <HowToPlayModal
          open={showHowTo}
          gameType="stop"
          gameName="STOP!"
          stepCount={4}
          onClose={() => setShowHowTo(false)}
        />
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-mono text-(--ink)/60">ROUND {round} OF {totalRounds}</div>
              <div className="slab mt-1 text-4xl" style={{ color: "var(--hue-stop)" }}>
                {letter}
              </div>
            </div>
            <TimerBadge deadline={deadline} />
          </div>

          {stopped && stoppedBy && (
            <Banner variant="waiting">
              {playerNames.get(stoppedBy)} called STOP! • {t("game.waiting")}
            </Banner>
          )}

          <div className="space-y-2">
            {categories.map((category) => (
              <div key={category}>
                <label className="block text-xs font-semibold text-(--ink)/70 mb-1">
                  {category}
                </label>
                <input
                  type="text"
                  value={answers[category] ?? ""}
                  onChange={(e) => handleAnswerChange(category, e.target.value)}
                  disabled={stopped}
                  placeholder={t("stop.answerFor", { category })}
                  className="w-full rounded-lg border-2 border-(--line) bg-(--panel) px-3 py-2 text-(--ink) placeholder-text-(--ink)/40 font-sans disabled:opacity-50"
                />
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <Button
              variant="hue"
              gameType="stop"
              onClick={handleStop}
              disabled={!allAnswered || stopped}
              className="flex-1"
            >
              {t("stop.stopButton")}
            </Button>
          </div>

          <ScoreStrip standings={standings} players={props.players} playerId={props.playerId} className="mt-4" />
        </div>
      </>
    );
  }

  // Validating phase
  if (phase === "validating") {
    const answers_data = publicState?.answers ?? {};
    const isValidated = privateState?.validated ?? false;

    return (
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-mono text-(--ink)/60">VALIDATION</div>
            <div className="slab mt-1 text-2xl">Round {round}</div>
          </div>
          <TimerBadge deadline={deadline} />
        </div>

        {isValidated && (
          <Banner variant="waiting">{t("stop.validated")}</Banner>
        )}

        <div className="space-y-3">
          {categories.map((category) => (
            <div key={category} className="space-y-2">
              <div className="text-sm font-semibold text-(--ink)">{category}</div>
              <div className="space-y-1">
                {(answers_data[category] ?? []).map((item: any, idx: number) => {
                  const key = `${category}|${item.playerId}`;
                  const isRejected = rejected.has(key);
                  const isAutoInvalid = item.autoInvalid;

                  return (
                    <button
                      key={idx}
                      onClick={() => {
                        if (isAutoInvalid) return;
                        setRejected((prev) => {
                          const next = new Set(prev);
                          if (next.has(key)) {
                            next.delete(key);
                          } else {
                            next.add(key);
                          }
                          return next;
                        });
                      }}
                      disabled={isValidated || isAutoInvalid}
                      className={`w-full rounded-lg border-2 px-3 py-2 text-left text-sm font-sans transition ${
                        isAutoInvalid
                          ? "border-dashed border-(--danger) bg-(--panel) text-(--danger) opacity-50"
                          : isRejected
                            ? "border-(--danger) bg-[#3d1420] text-(--ink)"
                            : "border-(--line) bg-(--panel) text-(--ink)"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span>{item.answer}</span>
                        <span className="text-xs text-(--ink)/50">
                          {playerNames.get(item.playerId)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {!isValidated && (
          <Button
            variant="hue"
            gameType="stop"
            onClick={handleValidate}
            className="w-full"
          >
            {t("stop.validate")}
          </Button>
        )}

        <ScoreStrip standings={standings} players={props.players} playerId={props.playerId} className="mt-4" />
      </div>
    );
  }

  // Round results phase
  if (phase === "roundResults") {
    const results = publicState?.results ?? {};
    const roundScores = publicState?.roundScores ?? {};

    return (
      <div className="space-y-4">
        <div className="slab text-center text-3xl mb-4">
          Round {round} Results
        </div>

        <div className="space-y-4">
          {categories.map((category) => (
            <Card key={category} variant="panel">
              <div className="mb-2 font-semibold text-(--ink)">
                {category}
              </div>
              <div className="space-y-1">
                {(results[category] ?? []).map((result: any, idx: number) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-lg bg-(--panel-raised) px-2.5 py-1.5 text-sm"
                  >
                    <div className="flex-1">
                      <span className="font-medium">{result.answer}</span>
                      <span className="ml-2 text-xs text-(--ink)/60">
                        {playerNames.get(result.playerId)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs font-semibold rounded px-2 py-1 ${
                          result.verdict === "unique"
                            ? "bg-(--accent) text-(--dark-ink)"
                            : result.verdict === "duplicate"
                              ? "bg-(--warn) text-(--dark-ink)"
                              : "bg-(--danger) text-white"
                        }`}
                      >
                        {result.verdict === "unique"
                          ? t("stop.unique")
                          : result.verdict === "duplicate"
                            ? t("stop.duplicate")
                            : t("stop.invalid")}
                      </span>
                      <span className="font-bold">{result.points}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>

        <div className="rounded-xl border-2 border-(--line) bg-(--panel) p-3 space-y-1">
          {Object.entries(roundScores)
            .sort(([, a], [, b]) => b - a)
            .map(([playerId, points]) => (
              <div key={playerId} className="flex justify-between text-sm">
                <span>{playerNames.get(playerId)}</span>
                <span className="font-bold">{points} pts</span>
              </div>
            ))}
        </div>

        {props.isAdmin && round < totalRounds && (
          <Button
            variant="hue"
            gameType="stop"
            onClick={handleNextRound}
            className="w-full"
          >
            {t("stop.nextRound")}
          </Button>
        )}

        <ScoreStrip standings={standings} players={props.players} playerId={props.playerId} className="mt-4" />
      </div>
    );
  }

  return null;
}
