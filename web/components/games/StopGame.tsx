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
  const [judged, setJudged] = useState<Set<string>>(new Set());
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
    const filledCount = categories.filter((cat) => answers[cat]?.trim()).length;
    const timeRemaining = deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : 0;
    const showStopMoment = stopped && stoppedBy && deadline;

    return (
      <>
        {showStopMoment && (
          <div className="fixed inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_50%_40%,rgba(232,72,99,.35),transparent_70%)] bg-(--bg) z-50">
            <div className="flex flex-col items-center justify-center gap-4 text-center">
              <div className="w-14 h-14 rounded-full bg-[#fff8e7] border-4 border-[#ff4f6f] flex items-center justify-center">
                <span className="text-xs font-mono text-(--dark-ink)">doodle</span>
              </div>
              <div className="text-lg font-mono text-(--danger) uppercase tracking-wider">
                {playerNames.get(stoppedBy)} SLAMMED
              </div>
              <div className="font-display text-7xl text-white" style={{ textShadow: "0 6px 0 #8f1f33" }}>
                STOP!
              </div>
              <div className="text-base font-sans text-(--ink)/70">
                finish what you can…
              </div>
              <div
                className="font-display text-5xl text-white bg-[linear-gradient(180deg,#ff6b85,#e84863)] rounded-2xl px-8 py-2 shadow-md"
                style={{ animation: "tick 1s infinite" }}
              >
                {timeRemaining}
              </div>
            </div>
          </div>
        )}
        <HowToPlayModal
          open={showHowTo}
          gameType="stop"
          gameName="STOP!"
          stepCount={4}
          onClose={() => setShowHowTo(false)}
        />
        <div className="space-y-4">
          {/* Header with big letter tile and progress */}
          <div className="flex items-start gap-4">
            {/* Big letter tile */}
            <div className="w-16 h-16 rounded-2xl bg-[linear-gradient(180deg,#ffd23f,#f5b32a)] shadow-lg flex items-center justify-center flex-shrink-0">
              <div className="font-display text-4xl text-(--dark-ink)">
                {letter}
              </div>
            </div>

            <div className="flex-1">
              <div className="text-xs font-mono text-(--ink)/50 uppercase tracking-wider mb-1">
                EVERYTHING STARTS WITH
              </div>
              <div className="text-lg font-sans font-(--ink) font-semibold">
                {filledCount} of {categories.length} filled — {allAnswered ? "ready!" : "keep going!"}
              </div>
            </div>

            <TimerBadge deadline={deadline} />
          </div>

          {stopped && stoppedBy && (
            <Banner variant="waiting">
              {playerNames.get(stoppedBy)} called STOP! • {t("game.waiting")}
            </Banner>
          )}

          {/* Category rows */}
          <div className="space-y-2">
            {categories.map((category, idx) => {
              const hasAnswer = answers[category]?.trim() ?? false;
              const isActive = idx === 0; // Highlight first empty or typing
              return (
                <div
                  key={category}
                  className={`flex items-center gap-3 px-3 py-2 rounded-2xl border-2 transition ${
                    isActive && !hasAnswer
                      ? "border-[#ffd23f] bg-[rgba(255,210,63,.12)] shadow-sm"
                      : hasAnswer
                        ? "border-[#5a3f7a] bg-(--panel)"
                        : "border-[#5a3f7a] bg-(--panel) opacity-75"
                  }`}
                >
                  <label className="w-28 text-xs font-mono text-(--ink)/60 uppercase tracking-wider flex-shrink-0">
                    {category}
                  </label>
                  <input
                    type="text"
                    value={answers[category] ?? ""}
                    onChange={(e) => handleAnswerChange(category, e.target.value)}
                    disabled={stopped}
                    placeholder={letter + "..."}
                    className="flex-1 bg-transparent border-none text-(--ink) placeholder-text-(--ink)/40 font-sans text-base disabled:opacity-50 outline-none"
                  />
                  {hasAnswer && (
                    <span className="text-(--accent-2) text-lg flex-shrink-0">✓</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* STOP button */}
          <button
            onClick={handleStop}
            disabled={!allAnswered || stopped}
            className="w-full font-display text-2xl text-white bg-[linear-gradient(180deg,#ff6b85,#e84863)] rounded-2xl py-4 shadow-md disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-lg transition"
            style={!allAnswered || stopped ? {} : { boxShadow: "0 7px 0 #8f1f33" }}
          >
            🛑 STOP!
          </button>
          <div className="text-center text-xs font-mono text-(--ink)/35">
            SLAMMING STOP GIVES EVERYONE ELSE 5 SECONDS
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
    const validatedCount = publicState?.validatedCount ?? 0;

    // Get all category-playerId pairs to validate
    const allAnswerPairs: Array<{ category: string; playerId: string; item: any; index: number }> = [];
    Object.entries(answers_data).forEach(([category, items]: [string, any]) => {
      (items ?? []).forEach((item: any, index: number) => {
        if (!item.autoInvalid) {
          allAnswerPairs.push({ category, playerId: item.playerId, item, index });
        }
      });
    });

    // Find current answer to judge (first not yet judged)
    const currentPairIndex = allAnswerPairs.findIndex(
      (pair) => !judged.has(`${pair.category}|${pair.playerId}`)
    );
    const currentPair = currentPairIndex >= 0 ? allAnswerPairs[currentPairIndex] : null;

    if (!currentPair) {
      // All answers judged, show submit button
      return (
        <div className="space-y-4">
          <Banner variant="waiting">{t("stop.validated")}</Banner>
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

    // One-at-a-time validation
    const { category, item } = currentPair;
    const judgedCount = judged.size;
    const totalToJudge = allAnswerPairs.length;
    const tallyValid = totalToJudge - rejected.size;
    const tallyNope = rejected.size;
    const tallyPct = totalToJudge > 0 ? ((tallyValid / totalToJudge) * 100).toFixed(0) : "0";

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4 text-center">
          <div className="text-xs font-mono text-(--ink)/60 uppercase tracking-wider">
            JUDGING · {judgedCount + 1}/{totalToJudge}
          </div>
          <TimerBadge deadline={deadline} />
        </div>

        <div className="text-center">
          <div className="text-xs font-mono text-(--ink)/50 uppercase mb-3">
            CATEGORY · {category} · LETTER {letter}
          </div>

          {/* Cream card with answer */}
          <div className="bg-[#fff8e7] rounded-3xl p-6 shadow-lg mb-4">
            <div className="text-sm font-mono text-(--dark-ink)/70 mb-2 uppercase tracking-wider">
              {playerNames.get(item.playerId)} WROTE
            </div>
            <div className="font-display text-4xl text-(--bg) mb-2">
              &ldquo;{item.answer}&rdquo;
            </div>
          </div>

          <div className="text-xs font-mono text-(--ink)/40 mb-4 uppercase">
            IS THIS REAL?!
          </div>

          {/* VALID and NONSENSE buttons */}
          <div className="flex gap-3 mb-4">
            <button
              onClick={() => {
                // Mark as VALID - add to judged
                setJudged((prev) => {
                  const next = new Set(prev);
                  next.add(`${category}|${item.playerId}`);
                  return next;
                });
              }}
              className="flex-1 font-display text-lg text-(--dark-ink) bg-[linear-gradient(180deg,#41e0c4,#28b89e)] rounded-2xl py-4 shadow-md hover:shadow-lg transition"
              style={{ boxShadow: "0 5px 0 #0f6e5c" }}
            >
              ✓ VALID
            </button>
            <button
              onClick={() => {
                // Mark as NONSENSE - add to both judged and rejected
                setJudged((prev) => {
                  const next = new Set(prev);
                  next.add(`${category}|${item.playerId}`);
                  return next;
                });
                setRejected((prev) => {
                  const next = new Set(prev);
                  next.add(`${category}|${item.playerId}`);
                  return next;
                });
              }}
              className="flex-1 font-display text-lg text-white bg-[linear-gradient(180deg,#ff6b85,#e84863)] rounded-2xl py-4 shadow-md hover:shadow-lg transition"
              style={{ boxShadow: "0 5px 0 #8f1f33" }}
            >
              ✗ NONSENSE
            </button>
          </div>

          {/* Tally bar */}
          <div className="flex items-center justify-center gap-3 mb-4">
            <span className="text-sm font-mono text-(--accent-2) font-bold">VALID {tallyValid}</span>
            <div className="w-40 h-3 rounded-full bg-(--panel) border border-(--line) overflow-hidden flex">
              <div className="bg-(--accent-2)" style={{ width: tallyPct + "%" }}></div>
              <div className="flex-1 bg-(--danger)"></div>
            </div>
            <span className="text-sm font-mono text-(--danger) font-bold">{tallyNope} NOPE</span>
          </div>

          <div className="text-xs font-mono text-(--ink)/30">
            UNIQUE VALID = 10 · DUPLICATE = 5 · NONSENSE = 0
          </div>
        </div>

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
