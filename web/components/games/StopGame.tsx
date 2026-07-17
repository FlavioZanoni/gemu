"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { Check, X, Hand } from "lucide-react";
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
  const sendActionRef = useRef(props.sendAction);
  useEffect(() => {
    sendActionRef.current = props.sendAction;
  }, [props.sendAction]);

  useEffect(() => {
    if (phase !== "answering") return;
    const timer = setTimeout(() => {
      if (Object.keys(answers).length > 0) {
        sendActionRef.current({ action: "set_answers", answers });
      }
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, phase]);

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
          <div
            className="fixed inset-0 flex items-center justify-center z-50"
            style={{
              background: "radial-gradient(circle at 50% 40%, rgba(232,72,99,.35), transparent 70%)",
            }}
          >
            <div className="flex flex-col items-center justify-center gap-4 text-center">
              <div
                className="rounded-full bg-[#fff8e7] flex items-center justify-center"
                style={{ width: "52px", height: "52px", border: "3px solid #ff4f6f" }}
              >
                <span style={{ fontSize: "8px", fontFamily: "'Space Mono', monospace", color: "#8a7f60" }}>doodle</span>
              </div>
              <div style={{ fontSize: "12px", fontFamily: "'Space Mono', monospace", fontWeight: "700", color: "#ff8a9b", letterSpacing: ".25em", textTransform: "uppercase" }}>
                {playerNames.get(stoppedBy)} SLAMMED
              </div>
              <div
                className="font-display text-7xl text-white"
                style={{ textShadow: "0 6px 0 #8f1f33", animation: "slam .5s ease-out", transform: "rotate(-2deg)", fontFamily: "'Alfa Slab One', sans-serif" }}
              >
                STOP!
              </div>
              <div style={{ fontSize: "13px", fontFamily: "'Space Grotesk', sans-serif", fontWeight: "600", color: "rgba(255,233,168,.7)" }}>
                finish what you can…
              </div>
              <div
                style={{
                  fontFamily: "'Alfa Slab One', sans-serif",
                  fontSize: "44px",
                  color: "#fff",
                  background: "linear-gradient(180deg,#ff6b85,#e84863)",
                  borderRadius: "16px",
                  padding: "2px 24px",
                  boxShadow: "0 5px 0 #8f1f33",
                  animation: "tick 1s infinite",
                }}
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
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {categories.map((category, idx) => {
              const hasAnswer = answers[category]?.trim() ?? false;
              const isActive = idx === 0 && !hasAnswer;
              return (
                <div
                  key={category}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    background: isActive ? "#1c1230" : "#2b1a3d",
                    border: `2px solid ${isActive ? "#ffd23f" : hasAnswer ? "#35d4b9" : "#5a3f7a"}`,
                    borderRadius: "12px",
                    padding: "9px 12px",
                    boxShadow: isActive ? "0 0 0 4px rgba(255,210,63,.12)" : "none",
                    opacity: !hasAnswer && !isActive ? 0.75 : 1,
                  }}
                >
                  <label style={{ width: "86px", fontSize: "10px", fontFamily: "'Space Mono', monospace", fontWeight: "700", color: isActive ? "#ffd23f" : "rgba(255,233,168,.5)", textTransform: "uppercase", flexShrink: 0 }}>
                    {category}
                  </label>
                  <input
                    type="text"
                    value={answers[category] ?? ""}
                    onChange={(e) => handleAnswerChange(category, e.target.value)}
                    disabled={stopped}
                    placeholder={letter + "..."}
                    style={{
                      flex: 1,
                      background: "transparent",
                      border: "none",
                      color: "#ffe9a8",
                      fontSize: "14px",
                      fontFamily: "'Space Grotesk', sans-serif",
                      fontWeight: "600",
                      outline: "none",
                      opacity: stopped ? 0.5 : 1,
                    }}
                  />
                  {hasAnswer && (
                    <Check size={16} strokeWidth={2.5} style={{ color: "#35d4b9", flexShrink: 0 }} />
                  )}
                </div>
              );
            })}
          </div>

          {/* STOP button */}
          <button
            onClick={handleStop}
            disabled={!allAnswered || stopped}
            style={{
              width: "100%",
              fontFamily: "'Alfa Slab One', sans-serif",
              fontSize: "22px",
              color: "#fff",
              background: "linear-gradient(180deg,#ff6b85,#e84863)",
              borderRadius: "16px",
              padding: "16px",
              border: "none",
              boxShadow: !allAnswered || stopped ? "none" : "0 6px 0 #8f1f33",
              textAlign: "center",
              letterSpacing: ".05em",
              cursor: !allAnswered || stopped ? "not-allowed" : "pointer",
              opacity: !allAnswered || stopped ? 0.5 : 1,
              transition: "all 0.2s ease",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
            }}
            data-testid="stop-button"
          >
            <Hand size={24} strokeWidth={2.5} />
            STOP!
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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", textAlign: "center" }}>
          <div style={{ fontSize: "10px", fontFamily: "'Space Mono', monospace", fontWeight: "600", color: "rgba(255,233,168,.5)", letterSpacing: ".25em", textTransform: "uppercase" }}>
            JUDGING · {judgedCount + 1}/{totalToJudge}
          </div>
          <TimerBadge deadline={deadline} />
        </div>

        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "10px", fontFamily: "'Space Mono', monospace", fontWeight: "700", color: "rgba(255,233,168,.5)", letterSpacing: ".25em", textTransform: "uppercase", marginBottom: "14px" }}>
            CATEGORY · {category} · LETTER {letter}
          </div>

          {/* Cream card with answer */}
          <div style={{ background: "#fff8e7", borderRadius: "18px", padding: "22px 18px", boxShadow: "0 6px 0 rgba(0,0,0,.35)", marginBottom: "6px" }}>
            <div style={{ fontSize: "10px", fontFamily: "'Space Mono', monospace", fontWeight: "700", color: "#8a7f60", letterSpacing: ".2em", marginBottom: "6px", textTransform: "uppercase" }}>
              {playerNames.get(item.playerId)} WROTE
            </div>
            <div style={{ fontFamily: "'Alfa Slab One', sans-serif", fontSize: "30px", color: "#1c1230" }}>
              &ldquo;{item.answer}&rdquo;
            </div>
          </div>

          <div style={{ fontSize: "10px", fontFamily: "'Space Mono', monospace", color: "rgba(255,233,168,.4)", marginBottom: "14px", textTransform: "uppercase" }}>
            IS THIS A REAL CITY?!
          </div>

          {/* VALID and NONSENSE buttons */}
          <div style={{ display: "flex", gap: "10px", marginBottom: "14px" }}>
            <button
              onClick={() => {
                // Mark as VALID - add to judged
                setJudged((prev) => {
                  const next = new Set(prev);
                  next.add(`${category}|${item.playerId}`);
                  return next;
                });
              }}
              style={{
                flex: 1,
                fontFamily: "'Alfa Slab One', sans-serif",
                fontSize: "15px",
                color: "#0c3d33",
                background: "linear-gradient(180deg,#41e0c4,#28b89e)",
                borderRadius: "14px",
                padding: "14px",
                border: "none",
                boxShadow: "0 5px 0 #0f6e5c",
                cursor: "pointer",
                transition: "all 0.2s ease",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
              }}
            >
              <Check size={18} strokeWidth={2.5} />
              VALID
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
              style={{
                flex: 1,
                fontFamily: "'Alfa Slab One', sans-serif",
                fontSize: "15px",
                color: "#fff",
                background: "linear-gradient(180deg,#ff6b85,#e84863)",
                borderRadius: "14px",
                padding: "14px",
                border: "none",
                boxShadow: "0 5px 0 #8f1f33",
                cursor: "pointer",
                transition: "all 0.2s ease",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
              }}
            >
              <X size={18} strokeWidth={2.5} />
              NONSENSE
            </button>
          </div>

          {/* Tally bar */}
          <div style={{ display: "flex", justifyContent: "center", gap: "14px", marginBottom: "12px", alignItems: "center" }}>
            <span style={{ fontSize: "12px", fontFamily: "'Space Mono', monospace", fontWeight: "700", color: "#35d4b9" }}>VALID {tallyValid}</span>
            <div style={{ width: "140px", height: "10px", borderRadius: "99px", background: "#2b1a3d", border: "1px solid #5a3f7a", overflow: "hidden", display: "flex" }}>
              <div style={{ width: tallyPct + "%", height: "100%", background: "#35d4b9" }}></div>
              <div style={{ flex: 1, height: "100%", background: "#e84863" }}></div>
            </div>
            <span style={{ fontSize: "12px", fontFamily: "'Space Mono', monospace", fontWeight: "700", color: "#ff8a9b" }}>{tallyNope} NOPE</span>
          </div>

          <div style={{ fontSize: "9px", fontFamily: "'Space Mono', monospace", color: "rgba(255,233,168,.35)", marginTop: "10px" }}>
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
