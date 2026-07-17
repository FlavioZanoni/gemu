"use client";

import { useMemo, useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import { DrawingCanvas } from "../DrawingCanvas";
import { Card, Button, Banner, HowToPlayModal, ScoreStrip } from "../ui";
import type { GameProps } from "./types";

type InventionDrawing = {
  problem: string;
  title: string;
  tagline: string;
  dataURL: string;
};

const FUNDING_BUDGET = 1000;

export function InventionGame(props: GameProps & { onFullscreenToggle?: () => void; onLeave?: () => void }) {
  const { t } = useI18n();
  const {
    playerId,
    players,
    publicState,
    privateState,
    sendAction,
    isAdmin,
    onLeave,
  } = props;
  const phase = (publicState?.phase as string | undefined) ?? "collecting";
  const round = (publicState?.round as number | undefined) ?? 1;
  const totalRounds = (publicState?.totalRounds as number | undefined) ?? 3;
  const assigned = (privateState?.assigned as string | undefined) ?? "";
  const drawing = privateState?.drawing as InventionDrawing | undefined;
  const presenters = (publicState?.presenters as string[] | undefined) ?? [];
  const presentIndex = (publicState?.presentIndex as number | undefined) ?? 0;
  const funding =
    (publicState?.funding as Record<string, number> | undefined) ?? {};
  const totalFunding =
    (publicState?.totalFunding as Record<string, number> | undefined) ?? {};
  const voteCount = (publicState?.voteCount as number | undefined) ?? 0;
  const problemsSubmitted =
    (publicState?.problemsSubmitted as number | undefined) ?? 0;

  const [problemOne, setProblemOne] = useState("");
  const [problemTwo, setProblemTwo] = useState("");
  const [title, setTitle] = useState("");
  const [tagline, setTagline] = useState("");
  const [canvasData, setCanvasData] = useState("");
  const [drawStep, setDrawStep] = useState<"idea" | "draw">("idea");
  const [myProblemsSubmitted, setMyProblemsSubmitted] = useState(false);
  const [fundAllocations, setFundAllocations] = useState<Record<string, number>>({});
  const [showHowTo, setShowHowTo] = useState(round === 1 && phase === "collecting");

  const presenterId = presenters[presentIndex];
  const isPresenter = presenterId === playerId;
  const submissions =
    (publicState?.submissions as
      | Record<string, InventionDrawing>
      | undefined) ?? {};
  const currentSubmission = presenterId ? submissions[presenterId] : undefined;
  const playerNames = useMemo(() => {
    const map = new Map<string, string>();
    players.forEach((player) => map.set(player.id, player.name));
    return map;
  }, [players]);

  const canVote = phase === "voting";
  const voteOptions = useMemo(
    () => presenters.filter((id) => id !== playerId),
    [presenters, playerId],
  );

  const connectedCount = players.length;
  const standings = useMemo(
    () =>
      Object.entries(totalFunding)
        .map(([playerId, score]) => ({ playerId, score }))
        .sort((a, b) => b.score - a.score),
    [totalFunding]
  );

  const totalAllocated = useMemo(
    () => Object.values(fundAllocations).reduce((sum, v) => sum + v, 0),
    [fundAllocations],
  );
  const remainingBudget = FUNDING_BUDGET - totalAllocated;

  useEffect(() => {
    if (phase === "voting") {
      const initial: Record<string, number> = {};
      voteOptions.forEach((id) => {
        initial[id] = fundAllocations[id] ?? 0;
      });
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFundAllocations(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    if (phase === "collecting") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMyProblemsSubmitted(false);
      setTitle("");
      setTagline("");
      setCanvasData("");
      setDrawStep("idea");
      setShowHowTo(round === 1);
    }
  }, [phase, round]);

  useEffect(() => {
    if (assigned && drawStep === "idea" && !drawing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDrawStep("idea");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assigned]);

  return (
    <>
      <HowToPlayModal
        open={showHowTo}
        gameType="invention"
        gameName="Patently Silly"
        stepCount={4}
        onClose={() => setShowHowTo(false)}
      />
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-mono text-(--ink)/60">ROUND {round} OF {totalRounds}</div>
            <div className="slab mt-1 text-2xl" style={{ color: "var(--hue-invention)" }}>
              {phase === "collecting"
                ? t("invention.collecting")
                : phase === "drawing"
                  ? t("invention.drawing")
                  : phase === "presenting"
                    ? t("invention.presenting")
                    : phase === "voting"
                      ? t("invention.voting")
                      : phase === "results"
                        ? t("invention.results")
                        : t("invention.finalResults")}
            </div>
            <div className="text-xs text-(--ink)/60 mt-1">
              {phase === "collecting"
                ? t("invention.collecting.desc")
                : phase === "drawing"
                  ? t("invention.drawing.desc")
                  : phase === "presenting"
                    ? t("invention.presenting.desc")
                    : phase === "voting"
                      ? t("invention.voting.desc")
                      : ""}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {phase === "collecting" && (
              <Banner variant="waiting" className="text-xs">
                {t("invention.problemsSubmitted", {
                  count: problemsSubmitted,
                  total: connectedCount * 2,
                })}
              </Banner>
            )}
            {phase === "drawing" && (
              <Banner variant="waiting" className="text-xs">
                {t("invention.drawingsSubmitted", {
                  count: (publicState?.drawingsSubmitted as number | undefined) ?? 0,
                  total: connectedCount,
                })}
              </Banner>
            )}
            {phase === "voting" && (
              <Banner variant="waiting" className="text-xs">
                {t("invention.votesSubmitted", {
                  count: voteCount,
                  total: connectedCount,
                })}
              </Banner>
            )}
          </div>
        </div>

      {phase === "collecting" ? (
        <div className="space-y-3">
          {myProblemsSubmitted ? (
            <Banner variant="waiting">
              {t("game.waiting")}
            </Banner>
          ) : (
            <>
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Problem #1 (e.g., How to stop your shoes from screaming)"
                  value={problemOne}
                  onChange={(event) => setProblemOne(event.target.value)}
                  className="w-full rounded-lg border-2 border-(--line) bg-(--panel) px-3 py-2 text-(--ink) placeholder-text-(--ink)/40 font-sans"
                />
                <input
                  type="text"
                  placeholder="Problem #2"
                  value={problemTwo}
                  onChange={(event) => setProblemTwo(event.target.value)}
                  className="w-full rounded-lg border-2 border-(--line) bg-(--panel) px-3 py-2 text-(--ink) placeholder-text-(--ink)/40 font-sans"
                />
              </div>
              <Button
                variant="hue"
                gameType="invention"
                onClick={() => {
                  sendAction({
                    problems: [problemOne.trim(), problemTwo.trim()],
                  });
                  setMyProblemsSubmitted(true);
                }}
                disabled={!problemOne.trim() || !problemTwo.trim()}
                className="w-full"
              >
                SUBMIT PROBLEMS
              </Button>
            </>
          )}
        </div>
      ) : null}

      {phase === "drawing" ? (
        <div className="space-y-3">
          {drawStep === "idea" ? (
            <>
              {assigned ? (
                <Card variant="selected" gameType="invention">
                  <div className="text-sm font-semibold text-(--ink)">
                    {t("invention.yourProblem")}
                  </div>
                  <div className="text-base font-bold text-(--ink) mt-2">
                    {assigned}
                  </div>
                </Card>
              ) : (
                <Banner variant="waiting">
                  {t("invention.waitingAssignment")}
                </Banner>
              )}
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder={t("invention.inventionTitle")}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="w-full rounded-lg border-2 border-(--line) bg-(--panel) px-3 py-2 text-(--ink) placeholder-text-(--ink)/40 font-sans"
                />
                <input
                  type="text"
                  placeholder={t("invention.tagline")}
                  value={tagline}
                  onChange={(event) => setTagline(event.target.value)}
                  className="w-full rounded-lg border-2 border-(--line) bg-(--panel) px-3 py-2 text-(--ink) placeholder-text-(--ink)/40 font-sans"
                />
              </div>
              <Button
                variant="hue"
                gameType="invention"
                onClick={() => setDrawStep("draw")}
                disabled={!assigned || !title.trim()}
                className="w-full"
              >
                {t("invention.nextDraw")}
              </Button>
            </>
          ) : (
            <div className="flex flex-col gap-3" style={{ minHeight: 400 }}>
              <div className="text-sm text-(--ink)/75">
                {t("invention.drawFor")}{" "}
                <span className="font-semibold text-(--ink)">{assigned}</span>
              </div>
              <div className="flex-1 min-h-0">
                <DrawingCanvas
                  gameType="invention"
                  value={canvasData}
                  onChange={setCanvasData}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setDrawStep("idea")}
                  className="flex-1"
                >
                  BACK
                </Button>
                <Button
                  variant="hue"
                  gameType="invention"
                  onClick={() =>
                    sendAction({
                      action: "submit_drawing",
                      title: title.trim(),
                      tagline: tagline.trim(),
                      draw: canvasData,
                    })
                  }
                  disabled={!canvasData}
                  className="flex-1"
                >
                  {t("invention.submitInvention")}
                </Button>
              </div>
              {drawing ? (
                <Banner variant="waiting">
                  {t("game.waiting")}
                </Banner>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      {phase === "presenting" ? (
        <div className="space-y-4">
          <div style={{ textAlign: "center", fontSize: "10px", fontWeight: 700, letterSpacing: "0.25em", color: "#ff9d3f", marginBottom: "12px", textTransform: "uppercase" }}>
            {presenterId === playerId
              ? "YOU'RE PITCHING…"
              : `${playerNames.get(presenterId) ?? "SOMEONE"} IS PITCHING…`}
          </div>
          {currentSubmission ? (
            <div style={{ background: "#fff8e7", borderRadius: "18px", padding: "20px 18px", boxShadow: "0 6px 0 rgba(0,0,0,.35)", position: "relative" }}>
              {/* PATENT PENDING sticker */}
              <div style={{ position: "absolute", top: "-10px", right: "14px", background: "#ff9d3f", color: "#3d1f0e", fontSize: "9px", fontWeight: 700, borderRadius: "99px", padding: "4px 10px", transform: "rotate(3deg)", textTransform: "uppercase" }}>
                PATENT PENDING
              </div>

              {/* Invention number */}
              <div style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.2em", color: "#8a7f60", marginBottom: "6px", textTransform: "uppercase" }}>
                INVENTION Nº 042
              </div>

              {/* Title */}
              <div style={{ fontFamily: "'Alfa Slab One'", fontSize: "22px", color: "#1c1230", marginBottom: "8px", fontWeight: "bold" }}>
                {currentSubmission.title}
              </div>

              {/* Tagline */}
              {currentSubmission.tagline ? (
                <div style={{ fontSize: "13px", lineHeight: "1.5", color: "#4a4232", marginBottom: "8px", fontStyle: "italic" }}>
                  {currentSubmission.tagline}
                </div>
              ) : null}

              {/* Drawing */}
              {currentSubmission.dataURL ? (
                <div style={{ marginTop: "12px", borderRadius: "8px", overflow: "hidden" }}>
                  <img
                    src={currentSubmission.dataURL}
                    alt={currentSubmission.title}
                    style={{ width: "100%", display: "block" }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Reaction pills (visual only - no backend functionality) */}
          {currentSubmission && (
            <div style={{ display: "flex", justifyContent: "center", gap: "8px", marginTop: "12px" }}>
              <span style={{ fontSize: "16px", background: "#2b1a3d", border: "2px solid #5a3f7a", borderRadius: "99px", padding: "6px 14px", display: "flex", alignItems: "center", gap: "4px" }}>
                💰 <b style={{ fontFamily: "'Space Mono'", fontSize: "11px", fontWeight: 700, color: "#ffe9a8" }}>3</b>
              </span>
              <span style={{ fontSize: "16px", background: "#2b1a3d", border: "2px solid #5a3f7a", borderRadius: "99px", padding: "6px 14px", display: "flex", alignItems: "center", gap: "4px" }}>
                🗑 <b style={{ fontFamily: "'Space Mono'", fontSize: "11px", fontWeight: 700, color: "#ffe9a8" }}>1</b>
              </span>
              <span style={{ fontSize: "16px", background: "#2b1a3d", border: "2px solid #ff9d3f", borderRadius: "99px", padding: "6px 14px", boxShadow: "0 0 12px rgba(255,157,63,.3)", display: "flex", alignItems: "center", gap: "4px" }}>
                🚀 <b style={{ fontFamily: "'Space Mono'", fontSize: "11px", fontWeight: 700, color: "#ff9d3f" }}>4</b>
              </span>
            </div>
          )}

          {isPresenter ? (
            <Button
              variant="hue"
              gameType="invention"
              onClick={() => sendAction({ action: "next" })}
              className="w-full"
            >
              {t("invention.nextInvention")}
            </Button>
          ) : isAdmin ? (
            <Button
              variant="secondary"
              onClick={() => sendAction({ action: "advance" })}
              className="w-full"
            >
              {t("invention.skipVoting")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {canVote ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm text-(--ink)/75">
              {t("invention.fundingBudget", { budget: FUNDING_BUDGET })}
            </div>
            <span
              className={`font-display text-lg ${
                remainingBudget < 0 ? "text-(--danger)" : "text-(--ink)"
              }`}
            >
              ${remainingBudget}
            </span>
          </div>
          <div className="space-y-2">
            {voteOptions
              .filter((id) => Boolean(submissions[id]))
              .map((id) => {
                const sub = submissions[id];
                const currentAmount = fundAllocations[id] ?? 0;
                return (
                  <Card key={id} variant="panel">
                    <div className="space-y-2">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="text-sm font-semibold text-(--ink)">
                            {playerNames.get(id) ?? id}
                          </div>
                          {sub ? (
                            <div className="text-xs text-(--ink)/60">
                              {sub.title}
                            </div>
                          ) : null}
                        </div>
                        <div className="text-lg font-bold text-(--ink)">
                          ${currentAmount}
                        </div>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={FUNDING_BUDGET}
                        step={50}
                        value={currentAmount}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          const otherTotal = Object.entries(fundAllocations)
                            .filter(([k]) => k !== id)
                            .reduce((sum, [, v]) => sum + v, 0);
                          const clamped = Math.min(
                            val,
                            FUNDING_BUDGET - otherTotal,
                          );
                          setFundAllocations((prev) => ({
                            ...prev,
                            [id]: clamped,
                          }));
                        }}
                        className="w-full"
                        style={{ accentColor: "var(--hue-invention)" }}
                      />
                    </div>
                  </Card>
                );
              })}
          </div>
          <Button
            variant="hue"
            gameType="invention"
            disabled={remainingBudget < 0 || totalAllocated === 0}
            onClick={() => {
              const finalAllocations: Record<string, number> = {};
              for (const [id, amount] of Object.entries(fundAllocations)) {
                if (amount > 0) {
                  finalAllocations[id] = amount;
                }
              }
              sendAction({ funding: finalAllocations });
            }}
            className="w-full"
          >
            {t("invention.submitFunding")}
          </Button>
        </div>
      ) : null}

      {phase === "results" || phase === "finalResults" ? (
        <div className="space-y-4">
          <div className="space-y-3">
            {Object.entries(funding)
              .sort(([, a], [, b]) => b - a)
              .map(([id, amount], index) => (
                <Card
                  key={id}
                  variant={index === 0 ? "hero" : "panel"}
                  gameType={index === 0 ? "invention" : undefined}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="font-semibold text-(--ink)">
                        {playerNames.get(id) ?? id}
                      </div>
                      {submissions[id] ? (
                        <div className="text-xs text-(--ink)/60 mt-0.5">
                          {submissions[id].title}
                        </div>
                      ) : null}
                    </div>
                    <div className="text-right">
                      <div className="font-display text-lg font-bold text-(--ink)">
                        ${amount}
                      </div>
                      <div className="text-xs text-(--ink)/50 mt-0.5">
                        total: ${totalFunding[id] ?? 0}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
          </div>
          {phase === "finalResults" ? (
            <>
              <Card variant="hero" gameType="invention">
                <div className="text-center">
                  <div className="font-display text-2xl text-(--ink) font-bold">
                    {(() => {
                      const sorted = Object.entries(totalFunding).sort(
                        ([, a], [, b]) => b - a,
                      );
                      const winnerId = sorted[0]?.[0];
                      return winnerId
                        ? t("invention.finalWinner", {
                            name: playerNames.get(winnerId) ?? "Unknown",
                            amount: sorted[0][1],
                          })
                        : t("invention.noWinner");
                    })()}
                  </div>
                </div>
              </Card>
              {onLeave ? (
                <Button
                  variant="hue"
                  gameType="invention"
                  onClick={onLeave}
                  className="w-full"
                >
                  {t("invention.backToLobby")}
                </Button>
              ) : null}
            </>
          ) : null}
          {phase === "results" && isAdmin ? (
            <Button
              variant="hue"
              gameType="invention"
              onClick={() => sendAction({ action: "next_round" })}
              className="w-full"
            >
              {t("invention.nextRound")}
            </Button>
          ) : null}
          {phase === "results" && !isAdmin ? (
            <Banner variant="waiting">
              {t("invention.waitingRound")}
            </Banner>
          ) : null}
        </div>
      ) : null}
      <ScoreStrip standings={standings} players={players} playerId={playerId} className="mt-6" />
    </div>
    </>
  );
}
