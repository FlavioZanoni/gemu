"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { useI18n } from "@/lib/i18n";
import { Card, Button, TimerBadge, Banner, ScoreStrip, HowToPlayModal } from "../ui";
import { DrawingCanvas } from "../DrawingCanvas";
import { getWSClient } from "@/lib/ws";
import type { GameProps } from "./types";

type GarticPublicState = {
  phase: "drawing" | "turnResults";
  round: number;
  totalRounds: number;
  drawer: string;
  deadline: number;
  scores: Record<string, number>;
  guessed: string[];
  guesses: Array<{ playerId: string; text: string; correct: boolean }>;
  turnOrder: string[];
  turnIndex: number;
  wordLength?: number;
  word?: string;
};

type GarticPrivateState = {
  word?: string;
  closeGuess?: string;
};

export function GarticGame(props: GameProps) {
  const { t } = useI18n();
  const publicState = props.publicState as GarticPublicState | null;
  const privateState = props.privateState as GarticPrivateState | null;
  const canvasRef = useRef(null);

  const phase = publicState?.phase ?? "drawing";
  const round = publicState?.round ?? 1;
  const totalRounds = publicState?.totalRounds ?? 2;
  const drawer = publicState?.drawer ?? "";
  const deadline = publicState?.deadline ?? null;
  const scores = publicState?.scores ?? {};
  const guessed = publicState?.guessed ?? [];
  const guesses = publicState?.guesses ?? [];
  const wordLength = publicState?.wordLength ?? 0;
  const word = publicState?.word ?? "";
  const isDrawer = drawer === props.playerId;

  const [guess, setGuess] = useState("");
  const [showHowTo, setShowHowTo] = useState(round === 1 && phase === "drawing");
  const guessesEndRef = useRef<HTMLDivElement>(null);

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

  // Subscribe to game.stream events for live canvas strokes
  useEffect(() => {
    const handler = (message: any): void => {
      if (message.type !== "game.stream") return;
      if (isDrawer || !canvasRef.current) return;
      const payload = message.payload as any;
      if (payload.playerId !== drawer) return;
      const canvas = canvasRef.current as any;
      canvas?.applyRemoteStroke?.(payload);
    };
    const unsubscribe = getWSClient().onMessage(handler);
    return (): void => {
      unsubscribe();
    };
  }, [drawer, isDrawer]);

  const handleGuess = () => {
    if (guess.trim() && !isDrawer && !guessed.includes(props.playerId)) {
      props.sendAction({ action: "guess", text: guess });
      setGuess("");
    }
  };

  const handleCanvasSendStroke = (stroke: any) => {
    props.sendStream({ action: stroke.action, ...stroke });
  };

  // Auto-scroll guesses
  useEffect(() => {
    guessesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [guesses]);

  // Drawing phase
  if (phase === "drawing") {
    const drawerName = playerNames.get(drawer) || "?";
    const hasGuessed = guessed.includes(props.playerId);

    return (
      <>
        <HowToPlayModal
          open={showHowTo}
          gameType="gartic"
          gameName="GARTIC"
          stepCount={3}
          onClose={() => setShowHowTo(false)}
        />
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-mono text-(--ink)/60">ROUND {round} OF {totalRounds}</div>
              <div className="slab mt-1 text-2xl" style={{ color: "var(--hue-gartic)" }}>
                {drawerName.toUpperCase()}
              </div>
            </div>
            <TimerBadge deadline={deadline} />
          </div>

          {isDrawer && (
            <Card variant="hero" gameType="gartic" className="text-center">
              <div className="text-sm font-mono opacity-75">YOUR WORD</div>
              <div className="font-display text-4xl tracking-widest">{word}</div>
            </Card>
          )}

          {!isDrawer && privateState?.closeGuess && (
            <Banner variant="waiting">
              {t("gartic.closeGuess", { word: privateState.closeGuess })}
            </Banner>
          )}

          {/* Canvas */}
          <div className="rounded-xl border-2 overflow-hidden" style={{ borderColor: "var(--hue-gartic)", height: "300px" }}>
            <DrawingCanvas
              ref={canvasRef}
              gameType="gartic"
              onStrokeBatch={isDrawer ? handleCanvasSendStroke : undefined}
              readOnly={!isDrawer}
            />
          </div>

          {/* Guesses list for guessers */}
          {!isDrawer && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-(--ink)/70">GUESSES</div>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-(--line) bg-(--panel-raised) p-2 space-y-1">
                {guesses.map((g, idx) => (
                  <div
                    key={idx}
                    className={`rounded px-2 py-1 text-sm flex items-center justify-between ${
                      g.correct
                        ? "bg-(--accent-2) text-(--bg)"
                        : "bg-(--panel) text-(--ink)"
                    }`}
                  >
                    <span>{g.correct ? t("gartic.guessedIt") : g.text}</span>
                    <span className="text-xs opacity-75">{playerNames.get(g.playerId)}</span>
                  </div>
                ))}
                <div ref={guessesEndRef} />
              </div>
            </div>
          )}

          {/* Guess input for guessers */}
          {!isDrawer && (
            <div className="flex gap-2">
              <input
                type="text"
                value={guess}
                onChange={(e) => setGuess(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleGuess()}
                disabled={hasGuessed}
                placeholder={t("gartic.guess")}
                className="flex-1 rounded-lg border-2 border-(--line) bg-(--panel) px-3 py-2 text-(--ink) placeholder-text-(--ink)/40 disabled:opacity-50"
              />
              <Button
                variant="hue"
                gameType="gartic"
                onClick={handleGuess}
                disabled={hasGuessed || !guess.trim()}
              >
                {t("common.cancel")}
              </Button>
            </div>
          )}

          {/* Guessed players */}
          {guessed.length > 0 && (
            <div className="rounded-lg border border-(--line) bg-(--panel) p-2">
              <div className="text-xs font-semibold text-(--ink)/70 mb-1">GUESSED CORRECTLY</div>
              <div className="flex flex-wrap gap-1">
                {guessed.map((playerId) => (
                  <span
                    key={playerId}
                    className="inline-block rounded-full bg-(--accent-2) text-(--bg) px-2 py-0.5 text-xs font-bold"
                  >
                    {playerNames.get(playerId)}
                  </span>
                ))}
              </div>
            </div>
          )}

          <ScoreStrip standings={standings} players={props.players} playerId={props.playerId} />
        </div>
      </>
    );
  }

  // Turn results phase
  return (
    <div className="space-y-4">
      <div className="slab text-center text-3xl mb-4">
        Round {round} Results
      </div>

      <Card variant="hero" gameType="gartic" className="text-center">
        <div className="text-sm font-mono opacity-75">THE WORD WAS</div>
        <div className="font-display text-4xl tracking-widest">{word}</div>
      </Card>

      {guesses.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-(--ink)/70">GUESSES</div>
          <div className="space-y-1">
            {guesses.map((g, idx) => (
              <div
                key={idx}
                className={`rounded-lg px-3 py-2 text-sm flex items-center justify-between ${
                  g.correct
                    ? "bg-(--accent-2) text-(--bg)"
                    : "bg-(--panel-raised) text-(--ink)"
                }`}
              >
                <span>{g.correct ? t("gartic.guessedIt") : g.text}</span>
                <span className="text-xs opacity-75">{playerNames.get(g.playerId)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <ScoreStrip standings={standings} players={props.players} playerId={props.playerId} />
    </div>
  );
}
