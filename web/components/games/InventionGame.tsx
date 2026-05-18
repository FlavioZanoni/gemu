"use client";

import { useMemo, useState, useEffect } from "react";
import { DrawingCanvas } from "../DrawingCanvas";

type InventionGameProps = {
  roomId: string;
  playerId: string;
  players: { id: string; name: string }[];
  publicState: Record<string, unknown> | null;
  privateState: Record<string, unknown> | null;
  sendAction: (payload: Record<string, unknown>) => void;
  onFullscreenToggle?: () => void;
  isAdmin?: boolean;
};

type InventionDrawing = {
  problem: string;
  title: string;
  tagline: string;
  dataURL: string;
};

const FUNDING_BUDGET = 1000;

export function InventionGame({
  playerId,
  players,
  publicState,
  privateState,
  sendAction,
  onFullscreenToggle,
  isAdmin,
}: InventionGameProps) {
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
  const [fundAllocations, setFundAllocations] = useState<
    Record<string, number>
  >({});

  const presenterId = presenters[presentIndex];
  const isPresenter = presenterId === playerId;
  const submissions =
    (publicState?.submissions as
      | Record<string, InventionDrawing>
      | undefined) ?? {};
  const currentSubmission = presenterId
    ? submissions[presenterId]
    : undefined;
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

  const totalAllocated = useMemo(
    () =>
      Object.values(fundAllocations).reduce((sum, v) => sum + v, 0),
    [fundAllocations],
  );
  const remainingBudget = FUNDING_BUDGET - totalAllocated;

  useEffect(() => {
    if (phase === "voting") {
      const initial: Record<string, number> = {};
      voteOptions.forEach((id) => {
        initial[id] = fundAllocations[id] ?? 0;
      });
      setFundAllocations(initial);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    if (phase === "collecting") {
      setMyProblemsSubmitted(false);
      setTitle("");
      setTagline("");
      setCanvasData("");
      setDrawStep("idea");
    }
  }, [phase]);

  useEffect(() => {
    if (assigned && drawStep === "idea" && !drawing) {
      setDrawStep("idea");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assigned]);

  return (
    <section className="glass-panel retro-card min-h-[80vh] p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg text-(--retro-cream)">
            Patently Silly
          </h2>
          <p className="text-xs text-(--retro-cream)/60">
            Round {round}/{totalRounds} &middot;{" "}
            {phase === "collecting"
              ? "Write silly problems"
              : phase === "drawing"
                ? "Invent something ridiculous"
                : phase === "presenting"
                  ? "Behold these inventions"
                  : phase === "voting"
                    ? "Fund your favorites"
                    : phase === "results"
                      ? "Round results"
                      : "Final results"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full border-2 border-(--retro-cream) bg-(--surface) px-3 py-1 text-xs text-(--retro-cream)">
            {phase === "collecting"
              ? `${problemsSubmitted}/${connectedCount * 2} problems`
              : phase === "drawing"
                ? `${(publicState?.drawingsSubmitted as number | undefined) ?? 0}/${connectedCount} done`
                : phase === "voting"
                  ? `${voteCount}/${connectedCount} voted`
                  : null}
          </span>
          {onFullscreenToggle ? (
            <button
              className="retro-btn border-2 border-(--retro-cream) bg-(--surface) px-3 py-1 text-xs font-semibold text-(--retro-cream)"
              onClick={onFullscreenToggle}
            >
              Fullscreen
            </button>
          ) : null}
        </div>
      </div>

      {phase === "collecting" ? (
        <div className="mt-6 grid gap-4">
          <p className="text-sm text-(--retro-cream)/75">
            Write two ridiculous problems for others to solve.
          </p>
          {myProblemsSubmitted ? (
            <div className="retro-card border-2 border-(--accent-2) p-4 text-center text-sm text-(--accent-2)">
              Problems submitted! Waiting for others...
            </div>
          ) : (
            <>
              <input
                className="retro-card border-2 border-(--retro-cream) bg-(--surface) px-4 py-3 text-sm text-(--retro-cream)"
                placeholder="Problem #1 (e.g. How to stop your shoes from screaming)"
                value={problemOne}
                onChange={(event) => setProblemOne(event.target.value)}
              />
              <input
                className="retro-card border-2 border-(--retro-cream) bg-(--surface) px-4 py-3 text-sm text-(--retro-cream)"
                placeholder="Problem #2"
                value={problemTwo}
                onChange={(event) => setProblemTwo(event.target.value)}
              />
              <button
                className="retro-btn bg-(--accent) px-5 py-2 text-sm font-semibold text-(--retro-ink) disabled:opacity-50"
                disabled={!problemOne.trim() || !problemTwo.trim()}
                onClick={() => {
                  sendAction({ problems: [problemOne.trim(), problemTwo.trim()] });
                  setMyProblemsSubmitted(true);
                }}
              >
                Submit problems
              </button>
            </>
          )}
        </div>
      ) : null}

      {phase === "drawing" ? (
        <div className="mt-6">
          {drawStep === "idea" ? (
            <div className="grid gap-4">
              {assigned ? (
                <div className="retro-card border-2 border-(--accent-2) p-4 text-sm text-(--accent-2)">
                  Your problem: <span className="font-semibold">{assigned}</span>
                </div>
              ) : (
                <div className="retro-card border-2 border-(--accent-3) p-4 text-sm text-(--retro-cream)/70">
                  Waiting for assignment...
                </div>
              )}
              <div className="grid gap-4">
                <input
                  className="retro-card border-2 border-(--retro-cream) bg-(--surface) px-4 py-3 text-sm text-(--retro-cream)"
                  placeholder="Invention title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
                <input
                  className="retro-card border-2 border-(--retro-cream) bg-(--surface) px-4 py-3 text-sm text-(--retro-cream)"
                  placeholder="Tagline"
                  value={tagline}
                  onChange={(event) => setTagline(event.target.value)}
                />
                <button
                  className="retro-btn bg-(--accent) px-5 py-2 text-sm font-semibold text-(--retro-ink) disabled:opacity-50"
                  disabled={!assigned || !title.trim()}
                  onClick={() => setDrawStep("draw")}
                >
                  Next: Draw your invention
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4" style={{ minHeight: 400 }}>
              <p className="text-sm text-(--retro-cream)/75">
                Draw your invention for:{" "}
                <span className="font-semibold text-(--accent-2)">
                  {assigned}
                </span>
              </p>
              <div className="flex-1 min-h-0">
                <DrawingCanvas value={canvasData} onChange={setCanvasData} />
              </div>
              <div className="flex gap-3">
                <button
                  className="retro-btn border-2 border-(--retro-cream) bg-(--surface) px-5 py-2 text-sm font-semibold text-(--retro-cream)"
                  onClick={() => setDrawStep("idea")}
                >
                  Back
                </button>
                <button
                  className="retro-btn flex-1 bg-(--accent) px-5 py-2 text-sm font-semibold text-(--retro-ink) disabled:opacity-50"
                  disabled={!canvasData}
                  onClick={() =>
                    sendAction({
                      action: "submit_drawing",
                      title: title.trim(),
                      tagline: tagline.trim(),
                      draw: canvasData,
                    })
                  }
                >
                  Submit invention
                </button>
              </div>
              {drawing ? (
                <p className="text-xs text-(--accent-2)">
                  Invention submitted! Waiting for others...
                </p>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      {phase === "presenting" ? (
        <div className="mt-6 grid gap-6">
          <div className="retro-card border-2 border-(--accent-2) p-6 text-center">
            <p className="text-xs uppercase tracking-[0.3em] text-(--accent-2)">
              Presenting
            </p>
            <p className="mt-2 text-sm text-(--retro-cream)/70">
              {presenterId === playerId
                ? "You are presenting"
                : `Watch ${playerNames.get(presenterId) ?? "the"} invention`}
            </p>
          </div>
          {currentSubmission ? (
            <div className="retro-card border-2 border-(--retro-cream) p-6">
              <p className="text-xs text-(--retro-cream)/60">
                Problem: {currentSubmission.problem}
              </p>
              <h3 className="mt-2 text-lg font-semibold text-(--retro-cream)">
                {currentSubmission.title}
              </h3>
              {currentSubmission.tagline ? (
                <p className="mt-1 text-sm italic text-(--retro-cream)/70">
                  &ldquo;{currentSubmission.tagline}&rdquo;
                </p>
              ) : null}
              <div className="mt-4 overflow-hidden rounded-2xl border-2 border-(--retro-cream) bg-(--surface)">
                {currentSubmission.dataURL ? (
                  <img
                    src={currentSubmission.dataURL}
                    alt={currentSubmission.title}
                    className="w-full"
                  />
                ) : null}
              </div>
            </div>
          ) : null}
          {isPresenter ? (
            <button
              className="retro-btn bg-(--accent) px-5 py-2 text-sm font-semibold text-(--retro-ink)"
              onClick={() => sendAction({ action: "next" })}
            >
              Next invention
            </button>
          ) : null}
        </div>
      ) : null}

      {canVote ? (
        <div className="mt-6 grid gap-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-(--retro-cream)/75">
              Allocate your <span className="font-semibold text-(--accent-2)">${FUNDING_BUDGET}</span> across these inventions
            </p>
            <span
              className={`font-display text-lg ${remainingBudget < 0 ? "text-red-400" : "text-(--accent-2)"}`}
            >
              ${remainingBudget} left
            </span>
          </div>
          <div className="grid gap-4">
            {voteOptions
              .filter((id) => Boolean(submissions[id]))
              .map((id) => {
                const sub = submissions[id];
                const currentAmount = fundAllocations[id] ?? 0;
                return (
                  <div
                    key={id}
                    className="retro-card border-2 border-(--retro-cream) p-4"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-sm font-semibold text-(--retro-cream)">
                          {playerNames.get(id) ?? id}
                        </span>
                        {sub ? (
                          <span className="ml-2 text-xs text-(--retro-cream)/60">
                            {sub.title}
                          </span>
                        ) : null}
                      </div>
                      <span className="font-display text-lg text-(--accent-2)">
                        ${currentAmount}
                      </span>
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
                const clamped = Math.min(val, FUNDING_BUDGET - otherTotal);
                setFundAllocations((prev) => ({
                  ...prev,
                  [id]: clamped,
                }));
              }}
                      className="mt-2 w-full accent-[var(--accent-2)]"
                    />
                  </div>
                );
              })}
          </div>
          <button
            className="retro-btn bg-(--accent) px-5 py-2 text-sm font-semibold text-(--retro-ink) disabled:opacity-50"
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
          >
            Submit funding
          </button>
          <p className="text-xs text-(--retro-cream)/60">
            {voteCount}/{connectedCount} voted
          </p>
        </div>
      ) : null}

      {phase === "results" || phase === "finalResults" ? (
        <div className="mt-6 grid gap-6">
          {phase === "finalResults" ? (
            <h3 className="font-display text-2xl text-(--accent-2)">
              Final Results
            </h3>
          ) : (
            <h3 className="font-display text-xl text-(--accent-2)">
              Round {round} Results
            </h3>
          )}
          <div className="grid gap-3">
            {Object.entries(funding)
              .sort(([, a], [, b]) => b - a)
              .map(([id, amount], index) => (
                <div
                  key={id}
                  className={`retro-card border-2 p-4 text-sm ${
                    index === 0
                      ? "border-(--accent-2) bg-(--accent-2)/10"
                      : "border-(--accent-3)"
                  } text-(--retro-cream)`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold">
                        {playerNames.get(id) ?? id}
                      </span>
                      {submissions[id] ? (
                        <span className="ml-2 text-xs text-(--retro-cream)/60">
                          {submissions[id].title}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-right">
                      <span
                        className={`font-display text-lg ${index === 0 ? "text-(--accent-2)" : "text-(--retro-cream)"}`}
                      >
                        ${amount}
                      </span>
                      <span className="ml-2 text-xs text-(--retro-cream)/50">
                        (total: ${totalFunding[id] ?? 0})
                      </span>
                    </div>
                  </div>
                </div>
              ))}
          </div>
          {phase === "finalResults" ? (
            <div className="retro-card border-2 border-(--accent-2) p-6 text-center">
              <h3 className="font-display text-xl text-(--accent-2)">
                {(() => {
                  const sorted = Object.entries(totalFunding).sort(
                    ([, a], [, b]) => b - a,
                  );
                  const winnerId = sorted[0]?.[0];
                  return winnerId
                    ? `${playerNames.get(winnerId) ?? "Unknown"} wins with $${sorted[0][1]}!`
                    : "No winner";
                })()}
              </h3>
            </div>
          ) : null}
          {phase === "results" && isAdmin ? (
            <button
              className="retro-btn bg-(--accent) px-5 py-2 text-sm font-semibold text-(--retro-ink)"
              onClick={() => sendAction({ action: "next_round" })}
            >
              Next round
            </button>
          ) : null}
          {phase === "results" && !isAdmin ? (
            <p className="text-center text-xs text-(--retro-cream)/60">
              Waiting for host to start next round...
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
