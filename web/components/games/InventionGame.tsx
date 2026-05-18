"use client";

import { useMemo, useState } from "react";
import { DrawingCanvas } from "../DrawingCanvas";

type InventionGameProps = {
  roomId: string;
  playerId: string;
  players: { id: string; name: string }[];
  publicState: Record<string, unknown> | null;
  privateState: Record<string, unknown> | null;
  sendAction: (payload: Record<string, unknown>) => void;
};

type InventionDrawing = {
  problem: string;
  title: string;
  tagline: string;
  dataURL: string;
};

export function InventionGame({
  roomId,
  playerId,
  players,
  publicState,
  privateState,
  sendAction,
}: InventionGameProps) {
  const phase = (publicState?.phase as string | undefined) ?? "collecting";
  const assigned = (privateState?.assigned as string[] | undefined) ?? [];
  const chosen = (privateState?.chosen as string | undefined) ?? "";
  const drawing = privateState?.drawing as InventionDrawing | undefined;
  const presenters = (publicState?.presenters as string[] | undefined) ?? [];
  const presentIndex = (publicState?.presentIndex as number | undefined) ?? 0;
  const funding = (publicState?.funding as Record<string, number> | undefined) ?? {};
  const voteCount = (publicState?.voteCount as number | undefined) ?? 0;

  const [problemOne, setProblemOne] = useState("");
  const [problemTwo, setProblemTwo] = useState("");
  const [title, setTitle] = useState("");
  const [tagline, setTagline] = useState("");
  const [canvasData, setCanvasData] = useState("");
  const [drawTab, setDrawTab] = useState<"idea" | "draw">("idea");

  const presenterId = presenters[presentIndex];
  const isPresenter = presenterId === playerId;
  const submissions = (publicState?.submissions as Record<string, InventionDrawing> | undefined) ?? {};
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

  return (
    <section className="glass-panel retro-card min-h-[80vh] p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg text-[color:var(--retro-cream)]">
            Patently Silly
          </h2>
          <p className="text-xs text-[color:var(--retro-cream)]/60">
            Room {roomId}
          </p>
        </div>
        <span className="rounded-full border-2 border-[color:var(--retro-cream)] bg-[color:var(--surface)] px-3 py-1 text-xs text-[color:var(--retro-cream)]">
          Phase: {phase}
        </span>
      </div>

      {phase === "collecting" ? (
        <div className="mt-6 grid gap-4">
          <p className="text-sm text-[color:var(--retro-cream)]/75">
            Write two ridiculous problems for others to solve.
          </p>
          <input
            className="retro-card border-2 border-[color:var(--retro-cream)] bg-[color:var(--surface)] px-4 py-3 text-sm text-[color:var(--retro-cream)]"
            placeholder="Problem #1 (fill in the blank)"
            value={problemOne}
            onChange={(event) => setProblemOne(event.target.value)}
          />
          <input
            className="retro-card border-2 border-[color:var(--retro-cream)] bg-[color:var(--surface)] px-4 py-3 text-sm text-[color:var(--retro-cream)]"
            placeholder="Problem #2 (fill in the blank)"
            value={problemTwo}
            onChange={(event) => setProblemTwo(event.target.value)}
          />
          <div className="flex flex-wrap gap-3">
            <button
              className="retro-btn bg-[color:var(--accent)] px-5 py-2 text-sm font-semibold text-[color:var(--retro-ink)]"
              onClick={() => {
                if (problemOne.trim()) {
                  sendAction({ problem: problemOne.trim() });
                }
                if (problemTwo.trim()) {
                  sendAction({ problem: problemTwo.trim() });
                }
                setProblemOne("");
                setProblemTwo("");
              }}
            >
              Submit problems
            </button>
            <button
              className="retro-btn border-2 border-[color:var(--retro-cream)] bg-[color:var(--surface)] px-5 py-2 text-sm font-semibold text-[color:var(--retro-cream)]"
              onClick={() => sendAction({ action: "advance" })}
            >
              Done (start round)
            </button>
          </div>
        </div>
      ) : null}

      {phase === "drawing" ? (
        <div className="mt-6 grid gap-6">
          <div className="flex gap-3">
            <button
              className={`retro-btn px-4 py-2 text-xs font-semibold ${
                drawTab === "idea"
                  ? "bg-[color:var(--accent)] text-[color:var(--retro-ink)]"
                  : "bg-[color:var(--surface)] text-[color:var(--retro-cream)]"
              }`}
              onClick={() => setDrawTab("idea")}
            >
              Idea
            </button>
            <button
              className={`retro-btn px-4 py-2 text-xs font-semibold ${
                drawTab === "draw"
                  ? "bg-[color:var(--accent)] text-[color:var(--retro-ink)]"
                  : "bg-[color:var(--surface)] text-[color:var(--retro-cream)]"
              }`}
              onClick={() => setDrawTab("draw")}
            >
              Draw
            </button>
          </div>

          {drawTab === "idea" ? (
            <div>
              <p className="text-sm text-[color:var(--retro-cream)]/75">
                Pick a problem and write your title + tagline.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {assigned.length === 0 ? (
                  <div className="retro-card border-2 border-[color:var(--accent-3)] p-4 text-sm text-[color:var(--retro-cream)]/70">
                    Waiting for assignments.
                  </div>
                ) : (
                  assigned.map((problem, index) => (
                    <button
                      key={`${problem}-${index}`}
                      className={`retro-btn w-full px-4 py-3 text-left text-sm ${
                        chosen === problem
                          ? "bg-[color:var(--accent-2)] text-[color:var(--retro-ink)]"
                          : "bg-[color:var(--surface)] text-[color:var(--retro-cream)]"
                      }`}
                      onClick={() => sendAction({ action: "choose_problem", problem })}
                    >
                      {problem}
                    </button>
                  ))
                )}
              </div>
              <div className="mt-4 grid gap-4">
                <input
                  className="retro-card border-2 border-[color:var(--retro-cream)] bg-[color:var(--surface)] px-4 py-3 text-sm text-[color:var(--retro-cream)]"
                  placeholder="Invention title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
                <input
                  className="retro-card border-2 border-[color:var(--retro-cream)] bg-[color:var(--surface)] px-4 py-3 text-sm text-[color:var(--retro-cream)]"
                  placeholder="Tagline"
                  value={tagline}
                  onChange={(event) => setTagline(event.target.value)}
                />
              </div>
            </div>
          ) : (
            <div className="grid gap-4">
              <p className="text-sm text-[color:var(--retro-cream)]/75">
                Draw your invention.
              </p>
              <DrawingCanvas value={canvasData} onChange={setCanvasData} />
              <button
                className="retro-btn bg-[color:var(--accent)] px-5 py-2 text-sm font-semibold text-[color:var(--retro-ink)]"
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
              {drawing ? (
                <p className="text-xs text-[color:var(--retro-cream)]/60">
                  Drawing submitted.
                </p>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      {phase === "presenting" ? (
        <div className="mt-6 grid gap-6">
          <div className="retro-card border-2 border-[color:var(--accent-2)] p-6 text-center">
            <p className="text-xs uppercase tracking-[0.3em] text-[color:var(--accent-2)]">
              Presenting
            </p>
            <p className="mt-2 text-sm text-[color:var(--retro-cream)]/70">
              {presenterId === playerId
                ? "You are presenting"
                : "Watch the invention"}
            </p>
          </div>
          {currentSubmission ? (
            <div className="retro-card border-2 border-[color:var(--retro-cream)] p-6">
              <p className="text-xs text-[color:var(--retro-cream)]/60">
                {currentSubmission.problem}
              </p>
              <h3 className="mt-2 text-lg text-[color:var(--retro-cream)]">
                {currentSubmission.title}
              </h3>
              {currentSubmission.tagline ? (
                <p className="text-sm text-[color:var(--retro-cream)]/70">
                  {currentSubmission.tagline}
                </p>
              ) : null}
              <div className="mt-4 overflow-hidden rounded-2xl border-2 border-[color:var(--retro-cream)] bg-[color:var(--surface)]">
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
              className="retro-btn bg-[color:var(--accent)] px-5 py-2 text-sm font-semibold text-[color:var(--retro-ink)]"
              onClick={() => sendAction({ action: "next" })}
            >
              Next invention
            </button>
          ) : null}
        </div>
      ) : null}

      {canVote ? (
        <div className="mt-6 grid gap-4">
          <p className="text-sm text-[color:var(--retro-cream)]/75">
            Vote to fund your favorite invention.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {voteOptions
              .filter((id) => Boolean(submissions[id]))
              .map((id) => (
              <button
                key={id}
                className="retro-btn bg-[color:var(--surface)] px-4 py-3 text-sm text-[color:var(--retro-cream)]"
                onClick={() => sendAction({ vote: id })}
              >
                Vote for {playerNames.get(id) ?? id}
              </button>
              ))}
          </div>
          <p className="text-xs text-[color:var(--retro-cream)]/60">
            Votes received: {voteCount}
          </p>
        </div>
      ) : null}

      {phase === "results" ? (
        <div className="mt-6 grid gap-4">
          <p className="text-sm text-[color:var(--retro-cream)]/75">
            Funding results
          </p>
          <div className="grid gap-3">
            {Object.entries(funding).map(([id, amount]) => (
              <div
                key={id}
                className="retro-card border-2 border-[color:var(--accent-3)] p-3 text-sm text-[color:var(--retro-cream)]"
              >
                {playerNames.get(id) ?? id}: {amount} votes
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
