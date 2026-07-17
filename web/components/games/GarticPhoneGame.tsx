"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { useI18n } from "@/lib/i18n";
import { Card, Button, TimerBadge, Banner, ScoreStrip, HowToPlayModal } from "../ui";
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
  const turnOrder = publicState?.turnOrder ?? [];
  const scores = publicState?.scores ?? {};
  const deadline = publicState?.deadline ?? null;
  const submitted = publicState?.submitted ?? [];
  const chains = publicState?.chains ?? [];
  const revealChain = publicState?.revealChain ?? 0;
  const revealPos = publicState?.revealPos ?? 0;
  const likes = publicState?.likes ?? {};

  const [promptText, setPromptText] = useState("");
  const [descriptionText, setDescriptionText] = useState("");
  const [drawingData, setDrawingData] = useState("");
  const [showHowTo, setShowHowTo] = useState(step === 0 && phase === "prompt");

  const isSubmitted = privateState?.submitted ?? false;
  const myChain = privateState?.chain ?? -1;
  const prevEntry = privateState?.prevEntry;

  const standings = useMemo(
    () =>
      Object.entries(scores)
        .map(([playerId, score]) => ({ playerId, score }))
        .sort((a, b) => b.score - a.score),
    [scores]
  );

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

  const handleReact = (chainIdx: number, entryIdx: number) => {
    props.sendAction({ action: "react", chain: chainIdx, entry: entryIdx });
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

          <ScoreStrip standings={standings} players={props.players} playerId={props.playerId} />
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
                gameType="garticphone"
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

        <ScoreStrip standings={standings} players={props.players} playerId={props.playerId} />
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

            <textarea
              value={descriptionText}
              onChange={(e) => setDescriptionText(e.target.value)}
              placeholder="Describe what you see…"
              className="w-full rounded-lg border-2 border-(--line) bg-(--panel) px-3 py-2 text-(--ink) placeholder-text-(--ink)/40 font-sans min-h-24"
            />
            <Button
              variant="hue"
              gameType="garticphone"
              onClick={handleSubmitDescription}
              disabled={!descriptionText.trim()}
              className="w-full"
            >
              SUBMIT
            </Button>
          </div>
        )}

        <ScoreStrip standings={standings} players={props.players} playerId={props.playerId} />
      </div>
    );
  }

  // Reveal phase
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-mono text-(--ink)/60">REVEAL</div>
          <div className="slab mt-1 text-2xl" style={{ color: "var(--hue-garticphone)" }}>
            Chain {revealChain + 1}
          </div>
        </div>
      </div>

      {chains.length > 0 && revealChain < chains.length && (
        <div className="space-y-3">
          {chains[revealChain]?.entries.slice(0, revealPos + 1).map((entry, idx) => {
            const key = `${revealChain}|${idx}`;
            const likeCount = likes[key] ?? 0;
            const canLike = entry.author !== props.playerId && likeCount < 1;

            return (
              <Card
                key={idx}
                variant="selected"
                gameType="garticphone"
                className="pop-in"
              >
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-(--ink)/70">
                    {entry.kind === "text" ? "TEXT" : "DRAWING"} · by {playerNames.get(entry.author)}
                  </div>
                  {entry.kind === "text" ? (
                    <div className="font-sans">{entry.text}</div>
                  ) : (
                    <img src={entry.dataUrl} alt="Entry" className="w-full rounded" />
                  )}
                  <div className="flex gap-2 pt-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleReact(revealChain, idx)}
                      disabled={!canLike}
                      className="flex-1"
                    >
                      ❤️ {likeCount > 0 ? likeCount : "Like"}
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {props.isAdmin && revealChain < chains.length && (
        <Button
          variant="hue"
          gameType="garticphone"
          onClick={handleRevealNext}
          className="w-full"
        >
          {revealPos < (chains[revealChain]?.entries.length ?? 0) - 1 ? "NEXT ENTRY" : "NEXT CHAIN"}
        </Button>
      )}

      {revealChain >= chains.length && (
        <Banner variant="waiting">
          {t("garticphone.gameOver")}
        </Banner>
      )}

      <ScoreStrip standings={standings} players={props.players} playerId={props.playerId} />
    </div>
  );
}
