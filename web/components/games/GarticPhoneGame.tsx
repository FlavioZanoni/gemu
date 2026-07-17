"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { useI18n } from "@/lib/i18n";
import { Card, Button, TimerBadge, Banner, HowToPlayModal } from "../ui";
import { DrawingCanvas } from "../DrawingCanvas";
import type { GameProps } from "./types";

type GarticPhoneEntry = {
  author: string;
  kind: "text" | "drawing";
  text?: string;
  dataUrl?: string;
};

type GarticPhoneChain = {
  starter: string;
  length: number;
  entries: GarticPhoneEntry[];
};

type GarticPhonePublicState = {
  phase: "prompt" | "drawing" | "writing" | "reveal";
  step: number;
  totalSteps: number;
  turnOrder: string[];
  scores: Record<string, number>;
  deadline: number;
  submitted?: string[];
  revealChain?: number;
  revealPos?: number;
  likes?: Record<string, number>;
  reactions?: Record<string, Record<string, number>>;
  chains?: GarticPhoneChain[];
};

type GarticPhonePrivateState = {
  submitted?: boolean;
  chain?: number;
  prevEntry?: GarticPhoneEntry;
};

export function GarticPhoneGame(props: GameProps) {
  const { t } = useI18n();
  const publicState = props.publicState as GarticPhonePublicState | null;
  const privateState = props.privateState as GarticPhonePrivateState | null;
  const canvasRef = useRef(null);

  const phase = publicState?.phase ?? "prompt";
  const step = publicState?.step ?? 0;
  const totalSteps = publicState?.totalSteps ?? 1;
  const scores = publicState?.scores ?? {};
  const deadline = publicState?.deadline ?? null;
  const submitted = publicState?.submitted ?? [];
  const chains = publicState?.chains ?? [];
  const revealChain = publicState?.revealChain ?? 0;
  const revealPos = publicState?.revealPos ?? 0;
  const reactions = publicState?.reactions ?? {};

  const [promptText, setPromptText] = useState("");
  const [descriptionText, setDescriptionText] = useState("");
  const [drawingData, setDrawingData] = useState("");
  const [showHowTo, setShowHowTo] = useState(step === 0 && phase === "prompt");
  const [localReacted, setLocalReacted] = useState<Set<string>>(new Set());

  const isSubmitted = privateState?.submitted ?? false;
  const myChain = privateState?.chain ?? -1;
  const prevEntry = privateState?.prevEntry;

  const playerNames = useMemo(() => {
    const map = new Map<string, string>();
    props.players.forEach((player) => {
      map.set(player.id, player.name);
    });
    return map;
  }, [props.players]);

  const handleSubmitPrompt = () => {
    if (promptText.trim()) {
      props.sendAction({ action: "submit_prompt", text: promptText });
      setPromptText("");
    }
  };

  const handleCanvasDrawing = (dataUrl: string) => {
    setDrawingData(dataUrl);
  };

  const handleSubmitDrawing = () => {
    if (drawingData) {
      props.sendAction({ action: "submit_drawing", draw: drawingData });
      setDrawingData("");
    }
  };

  const handleSubmitDescription = () => {
    if (descriptionText.trim()) {
      props.sendAction({ action: "submit_description", text: descriptionText });
      setDescriptionText("");
    }
  };

  const handleRevealNext = () => {
    if (props.isAdmin) {
      props.sendAction({ action: "reveal_next" });
    }
  };

  const handleReact = (chainIdx: number, entryIdx: number, emoji: "😂" | "💀" | "⭐") => {
    const key = `${chainIdx}|${entryIdx}`;
    if (!localReacted.has(key)) {
      setLocalReacted((prev) => new Set([...prev, key]));
      props.sendAction({ action: "react", chain: chainIdx, entry: entryIdx, emoji });
    }
  };

  const getPhaseTitle = () => {
    if (phase === "prompt") return "WRITE YOUR PROMPT";
    if (phase === "drawing") return "DRAW THE TEXT";
    if (phase === "writing") return "DESCRIBE THE DRAWING";
    return "REVEAL";
  };

  const submittedCount = submitted.length;
  const totalPlayers = props.players.length;
  const submissionProgress = `${submittedCount} of ${totalPlayers} submitted`;

  // Prompt phase
  if (phase === "prompt") {
    return (
      <>
        <HowToPlayModal
          open={showHowTo}
          gameType="garticphone"
          gameName="GARTIC PHONE"
          stepCount={4}
          onClose={() => setShowHowTo(false)}
        />
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-mono text-(--ink)/60">STEP 1 OF {totalSteps}</div>
              <div className="slab mt-1 text-2xl" style={{ color: "var(--hue-garticphone)" }}>
                WRITE PROMPT
              </div>
            </div>
            <TimerBadge deadline={deadline} />
          </div>

          {isSubmitted && (
            <Banner variant="waiting">{submissionProgress}</Banner>
          )}

          {!isSubmitted && (
            <div className="space-y-2">
              <textarea
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                placeholder="Write a silly prompt…"
                className="w-full rounded-lg border-2 border-(--line) bg-(--panel) px-3 py-2 text-(--ink) placeholder-text-(--ink)/40 font-sans min-h-24"
              />
              <Button
                variant="hue"
                gameType="garticphone"
                onClick={handleSubmitPrompt}
                disabled={!promptText.trim()}
                className="w-full"
              >
                SUBMIT
              </Button>
            </div>
          )}
        </div>
      </>
    );
  }

  // Drawing phase
  if (phase === "drawing") {
    return (
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-mono text-(--ink)/60">STEP {step} OF {totalSteps}</div>
            <div className="slab mt-1 text-2xl" style={{ color: "var(--hue-garticphone)" }}>
              DRAW
            </div>
          </div>
          <TimerBadge deadline={deadline} />
        </div>

        {isSubmitted && (
          <Banner variant="waiting">{submissionProgress}</Banner>
        )}

        {!isSubmitted && (
          <div className="space-y-3">
            {prevEntry && (
              <Card variant="panel" className="bg-(--panel-raised)">
                <div className="text-xs font-semibold text-(--ink)/70 mb-2">
                  PREVIOUS ENTRY
                </div>
                {prevEntry.kind === "text" ? (
                  <div className="font-sans">{prevEntry.text}</div>
                ) : (
                  <img src={prevEntry.dataUrl} alt="Previous drawing" className="w-full rounded" />
                )}
              </Card>
            )}

            <div className="rounded-xl border-2 overflow-hidden" style={{ borderColor: "var(--hue-garticphone)", height: "300px" }}>
              <DrawingCanvas
                ref={canvasRef}
                onChange={handleCanvasDrawing}
                value={drawingData}
              />
            </div>

            <Button
              variant="hue"
              gameType="garticphone"
              onClick={handleSubmitDrawing}
              disabled={!drawingData}
              className="w-full"
            >
              SUBMIT DRAWING
            </Button>
          </div>
        )}
      </div>
    );
  }

  // Writing phase
  if (phase === "writing") {
    return (
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-mono text-(--ink)/60">STEP {step} OF {totalSteps}</div>
            <div className="slab mt-1 text-2xl" style={{ color: "var(--hue-garticphone)" }}>
              DESCRIBE
            </div>
          </div>
          <TimerBadge deadline={deadline} />
        </div>

        {isSubmitted && (
          <Banner variant="waiting">{submissionProgress}</Banner>
        )}

        {!isSubmitted && (
          <div className="space-y-4">
            {prevEntry && (
              <>
                <div style={{ textAlign: "center", fontSize: "10px", fontWeight: 700, letterSpacing: "0.25em", color: "#b78bff", marginBottom: "12px", textTransform: "uppercase" }}>
                  RAFA DREW THIS… WHAT IS IT?!
                </div>
                <div style={{ height: "290px", backgroundColor: "#fff8e7", borderRadius: "16px", border: "3px solid #b78bff", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                  {prevEntry.kind === "text" ? (
                    <div style={{ padding: "16px", textAlign: "center", color: "#1c1230" }}>{prevEntry.text}</div>
                  ) : (
                    <img src={prevEntry.dataUrl} alt="Drawing to describe" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                  )}
                </div>
              </>
            )}

            <div style={{ marginTop: "14px" }}>
              <div style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.2em", color: "rgba(255,233,168,.5)", marginBottom: "5px", textTransform: "uppercase" }}>
                YOUR DESCRIPTION
              </div>
              <textarea
                value={descriptionText}
                onChange={(e) => setDescriptionText(e.target.value)}
                placeholder="a capybara driving a bus…"
                style={{ width: "100%", backgroundColor: "#1c1230", border: "2px solid #b78bff", borderRadius: "12px", padding: "12px", fontFamily: "'Space Grotesk', sans-serif", fontSize: "14px", fontWeight: 600, color: "#ffe9a8", boxShadow: "0 0 0 4px rgba(183,139,255,.12)", minHeight: "80px", boxSizing: "border-box" }}
              />
            </div>

            <Button
              variant="hue"
              gameType="garticphone"
              onClick={handleSubmitDescription}
              disabled={!descriptionText.trim()}
              className="w-full"
              style={{ background: "linear-gradient(180deg, #c9a4ff, #a678f2)", boxShadow: "0 4px 0 #5f3d99" }}
            >
              LOCK IT IN
            </Button>
          </div>
        )}
      </div>
    );
  }

  // Reveal phase
  return (
    <div className="space-y-4">
      {chains.length > 0 && revealChain < chains.length && (
        <>
          <div style={{ padding: "16px", background: "radial-gradient(ellipse at 50% -10%, rgba(183,139,255,.25), transparent 55%)", borderRadius: "16px", marginBottom: "12px" }}>
            {/* Chain header */}
            <div style={{ marginBottom: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                <div>
                  <div style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.3em", color: "#b78bff", marginBottom: "4px", textTransform: "uppercase" }}>
                    THE REVEAL · CHAIN {revealChain + 1} OF {chains.length}
                  </div>
                  <div style={{ fontFamily: "'Alfa Slab One'", fontSize: "17px", color: "#ffe9a8" }}>
                    {playerNames.get(chains[revealChain]?.starter) ?? "CHAIN"}'S CHAIN
                  </div>
                </div>
                {/* Progress dots */}
                <div style={{ display: "flex", gap: "4px" }}>
                  {chains[revealChain]?.entries.map((_, dotIdx) => (
                    <span
                      key={dotIdx}
                      style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "99px",
                        background: dotIdx <= revealPos ? "#b78bff" : "#5a3f7a",
                        boxShadow: dotIdx === revealPos ? "0 0 8px #b78bff" : "none"
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Chain entries */}
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "14px" }}>
              {chains[revealChain]?.entries.slice(0, revealPos + 1).map((entry, idx) => {
                const key = `${revealChain}|${idx}`;
                const entryReactions = reactions[key] ?? {};
                const isLatest = idx === revealPos;
                const authorName = playerNames.get(entry.author) ?? "Someone";

                if (entry.kind === "text") {
                  return (
                    <div key={idx} style={{ display: "flex", gap: "10px", alignItems: "flex-start", opacity: isLatest ? 1 : 0.75 }}>
                      <div style={{ flex: "none", width: "30px", height: "30px", borderRadius: "99px", backgroundColor: "#fff8e7", border: "2px solid #ff4f6f" }} />
                      <div style={{ flex: 1, background: isLatest ? "linear-gradient(180deg, #c9a4ff, #a678f2)" : "#2b1a3d", border: `2px solid ${isLatest ? "transparent" : "#5a3f7a"}`, borderRadius: "4px 14px 14px 14px", padding: "9px 12px", boxShadow: isLatest ? "0 5px 0 #5f3d99" : "none", animation: isLatest ? "slam .45s ease-out" : "none" }}>
                        <div style={{ fontSize: "8px", fontWeight: 700, letterSpacing: "0.2em", color: isLatest ? "rgba(45,22,80,.6)" : "rgba(255,233,168,.4)", marginBottom: "4px", textTransform: "uppercase" }}>
                          {authorName} WROTE
                        </div>
                        <div style={{ fontSize: "13px", fontWeight: 600, color: isLatest ? "#2d1650" : "#ffe9a8" }}>
                          "{entry.text}"
                        </div>
                      </div>
                    </div>
                  );
                } else {
                  return (
                    <div key={idx} style={{ display: "flex", gap: "10px", alignItems: "flex-start", opacity: isLatest ? 1 : 0.75 }}>
                      <div style={{ flex: "none", width: "30px", height: "30px", borderRadius: "99px", backgroundColor: "#fff8e7", border: "2px solid #b78bff" }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: "8px", fontWeight: 700, letterSpacing: "0.2em", color: "rgba(255,233,168,.4)", marginBottom: "4px", textTransform: "uppercase" }}>
                          {authorName} DREW IT
                        </div>
                        <div style={{ height: "120px", backgroundColor: "#fff8e7", border: "2px solid #5a3f7a", borderRadius: "4px 14px 14px 14px", overflow: "hidden" }}>
                          <img src={entry.dataUrl} alt="Drawing" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                        </div>
                      </div>
                    </div>
                  );
                }
              })}
            </div>

            {/* Emoji reaction pills */}
            <div style={{ display: "flex", justifyContent: "center", gap: "8px", marginBottom: "14px" }}>
              {chains[revealChain] && revealPos >= 0 && (
                <>
                  {(["😂", "💀", "⭐"] as const).map((emoji) => {
                    const key = `${revealChain}|${revealPos}`;
                    const emojiCount = reactions[key]?.[emoji] ?? 0;
                    const hasReacted = localReacted.has(key);

                    return (
                      <button
                        key={emoji}
                        onClick={() => handleReact(revealChain, revealPos, emoji)}
                        disabled={hasReacted}
                        style={{
                          fontSize: "16px",
                          background: emoji === "⭐" ? "#2b1a3d" : "#2b1a3d",
                          border: emoji === "⭐" ? "2px solid #ffd23f" : "2px solid #5a3f7a",
                          borderRadius: "99px",
                          padding: "5px 12px",
                          boxShadow: emoji === "⭐" ? "0 0 12px rgba(255,210,63,.3)" : "none",
                          cursor: hasReacted ? "not-allowed" : "pointer",
                          opacity: hasReacted ? 0.5 : 1,
                          display: "flex",
                          alignItems: "center",
                          gap: "4px"
                        }}
                      >
                        {emoji}
                        <span style={{ fontFamily: "'Space Mono'", fontSize: "11px", fontWeight: 700, color: emoji === "⭐" ? "#ffd23f" : "#ffe9a8" }}>
                          {emojiCount}
                        </span>
                      </button>
                    );
                  })}
                </>
              )}
            </div>

            <div style={{ display: "flex", gap: "8px", marginBottom: "6px" }}>
              <div style={{ flex: 1, textAlign: "center", fontSize: "9px", color: "rgba(255,233,168,.4)", padding: "10px 0" }}>
                REACTIONS = POINTS<br />FOR THE AUTHOR
              </div>
              {props.isAdmin && (
                <Button
                  variant="hue"
                  gameType="garticphone"
                  onClick={handleRevealNext}
                  style={{ background: "linear-gradient(180deg, #c9a4ff, #a678f2)", boxShadow: "0 4px 0 #5f3d99" }}
                >
                  {revealChain >= chains.length ? "FINISH ✓" : "NEXT ▶"}
                </Button>
              )}
            </div>
            <div style={{ textAlign: "center", fontSize: "8px", color: "rgba(255,233,168,.3)", marginTop: "6px" }}>
              HOST PACES THE REVEAL · EVERYONE REACTS LIVE
            </div>
          </div>
        </>
      )}

      {revealChain >= chains.length && (
        <Banner variant="waiting">
          {t("garticphone.gameOver")}
        </Banner>
      )}
    </div>
  );
}
