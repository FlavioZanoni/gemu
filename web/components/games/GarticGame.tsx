"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { useI18n } from "@/lib/i18n";
import { Button, TimerBadge, Banner, HowToPlayModal } from "../ui";
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
  const closeGuess = privateState?.closeGuess ?? "";
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
        <div style={{ flex: 1, display: "flex", gap: "24px", padding: "22px 0 30px" }}>
          {/* Left: Scoreboard */}
          <div style={{ width: "230px", flex: "none" }}>
            <div style={{ font: "700 11px 'Space Mono',monospace", letterSpacing: ".25em", color: "rgba(255,233,168,.45)", marginBottom: "10px" }}>
              SCOREBOARD · RD {round}/{totalRounds}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {standings.map((s) => (
                <div key={s.playerId} style={{ display: "flex", alignItems: "center", gap: "9px", background: "#2b1a3d", border: "2px solid " + (s.playerId === props.playerId ? "var(--hue-gartic)" : "#5a3f7a"), borderRadius: "99px", padding: "5px 12px 5px 5px" }}>
                  <div style={{ width: "28px", height: "28px", borderRadius: "99px", background: "#fff8e7", border: "2px solid " + (s.playerId === props.playerId ? "var(--hue-gartic)" : "#5a3f7a"), display: "flex", alignItems: "center", justifyContent: "center", font: "400 6px 'Space Mono',monospace", color: "#8a7f60" }}>
                    {playerNames.get(s.playerId)?.slice(0, 2).toUpperCase() || "?"}
                  </div>
                  <div style={{ flex: 1, font: "700 12px 'Space Grotesk'", color: "#ffe9a8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {playerNames.get(s.playerId)}
                  </div>
                  <span style={{ font: "600 8px 'Space Mono',monospace", color: s.playerId === props.playerId ? "var(--hue-gartic)" : "rgba(255,233,168,.5)" }}>
                    {s.playerId === drawer ? "DRAW" : "GUESS"}
                  </span>
                  <span style={{ fontFamily: "'Alfa Slab One'", fontSize: "14px", color: "#ffe9a8" }}>
                    {s.score}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ font: "400 8px 'Space Mono',monospace", color: "rgba(255,233,168,.3)", marginTop: "9px", textAlign: "center" }}>
              GAME POINTS · SESSION AT END
            </div>
          </div>

          {/* Center: Canvas and controls */}
          <div style={{ flex: "1.6", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
              <div>
                <div style={{ font: "700 10px 'Space Mono',monospace", letterSpacing: ".35em", color: "var(--hue-gartic)" }}>
                  {isDrawer ? "YOUR SECRET WORD" : `${drawerName.toUpperCase()} IS DRAWING`}
                </div>
                {isDrawer && (
                  <div style={{ fontFamily: "'Alfa Slab One'", fontSize: "26px", color: "#ffe9a8", textShadow: "0 3px 0 #c2452d" }}>
                    {word || "?"}
                  </div>
                )}
              </div>
              <div style={{ font: "600 11px 'Space Mono',monospace", color: "rgba(255,233,168,.45)", textAlign: "right" }}>
                <TimerBadge deadline={deadline} />
              </div>
            </div>

            {/* Canvas */}
            <div style={{ borderRadius: "18px", border: "3px solid var(--hue-gartic)", boxShadow: "0 6px 0 rgba(0,0,0,.35)", marginBottom: "12px" }}>
              <DrawingCanvas
                ref={canvasRef}
                gameType="gartic"
                onStrokeBatch={isDrawer ? handleCanvasSendStroke : undefined}
                readOnly={!isDrawer}
              />
            </div>

            {/* Drawing toolbar */}
            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              <div style={{ display: "flex", gap: "5px" }}>
                {["#000000", "#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF", "#00FFFF", "#FFFFFF"].map((color) => (
                  <button
                    key={color}
                    onClick={() => {}}
                    style={{
                      width: "30px",
                      height: "30px",
                      borderRadius: "99px",
                      background: color,
                      border: "1px solid rgba(0,0,0,.2)",
                      cursor: "pointer",
                      padding: 0,
                    }}
                  />
                ))}
              </div>
              <span style={{ flex: 1 }}></span>
              <button style={{ height: "38px", padding: "0 14px", borderRadius: "11px", border: "2px solid #5a3f7a", background: "#2b1a3d", color: "#ffe9a8", font: "700 12px 'Space Grotesk'", cursor: "pointer" }}>
                ◻ Eraser
              </button>
              <button style={{ height: "38px", padding: "0 14px", borderRadius: "11px", border: "2px solid #5a3f7a", background: "#2b1a3d", color: "#ffe9a8", font: "700 12px 'Space Grotesk'", cursor: "pointer", boxShadow: "0 3px 0 rgba(0,0,0,.35)" }}>
                ↩ Undo
              </button>
              <button style={{ height: "38px", padding: "0 14px", borderRadius: "11px", border: "none", background: "linear-gradient(180deg,#ff6b85,#e84863)", color: "#fff", font: "700 12px 'Space Grotesk'", cursor: "pointer", boxShadow: "0 3px 0 #8f1f33" }}>
                Clear
              </button>
            </div>
          </div>

          {/* Right: Guess chat (only if not drawer) */}
          {!isDrawer && (
            <div style={{ flex: 1, maxWidth: "340px", display: "flex", flexDirection: "column" }}>
              <div style={{ font: "700 11px 'Space Mono',monospace", letterSpacing: ".25em", color: "rgba(255,233,168,.45)", marginBottom: "10px" }}>
                GUESS CHAT
              </div>
              <div style={{ flex: 1, background: "#2b1a3d", border: "2px solid #5a3f7a", borderRadius: "16px", padding: "14px", display: "flex", flexDirection: "column", gap: "8px", overflow: "hidden", justifyContent: "flex-end", marginBottom: "10px" }}>
                {guesses.length === 0 && (
                  <div style={{ font: "400 11px 'Space Mono',monospace", color: "rgba(255,233,168,.35)", textAlign: "center" }}>
                    no guesses yet
                  </div>
                )}
                {guesses.map((g, idx) => (
                  <div
                    key={idx}
                    style={{
                      font: "600 13px 'Space Grotesk'",
                      color: g.correct ? "var(--hue-gartic)" : "#ffe9a8",
                      animation: "rise 0.3s ease-out",
                    }}
                  >
                    {g.correct ? `✓ ${playerNames.get(g.playerId)} guessed!` : g.text}
                  </div>
                ))}
                {closeGuess && (
                  <div
                    style={{
                      font: "600 13px 'Space Grotesk'",
                      color: "var(--hue-gartic)",
                      animation: "rise 0.3s ease-out",
                      borderLeft: "3px solid var(--hue-gartic)",
                      paddingLeft: "8px",
                      opacity: 0.7,
                    }}
                  >
                    💭 {closeGuess}
                  </div>
                )}
                <div ref={guessesEndRef} />
              </div>

              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  type="text"
                  value={guess}
                  onChange={(e) => setGuess(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleGuess()}
                  disabled={hasGuessed}
                  placeholder="Guess the word…"
                  style={{
                    flex: 1,
                    borderRadius: "8px",
                    border: "2px solid #5a3f7a",
                    background: "#2b1a3d",
                    padding: "8px 12px",
                    color: "#ffe9a8",
                    font: "400 12px 'Space Grotesk'",
                    opacity: hasGuessed ? 0.5 : 1,
                  }}
                />
                <Button
                  variant="hue"
                  gameType="gartic"
                  onClick={handleGuess}
                  disabled={hasGuessed || !guess.trim()}
                >
                  Send
                </Button>
              </div>

              {guessed.length > 0 && (
                <div style={{ marginTop: "10px", borderRadius: "8px", border: "1px solid #5a3f7a", background: "#2b1a3d", padding: "8px", fontSize: "11px" }}>
                  <div style={{ font: "700 9px 'Space Mono',monospace", color: "rgba(255,233,168,.5)", marginBottom: "6px" }}>
                    GUESSED CORRECTLY
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                    {guessed.map((playerId) => (
                      <span
                        key={playerId}
                        style={{
                          display: "inline-block",
                          borderRadius: "4px",
                          background: "var(--hue-gartic)",
                          color: "#1c1230",
                          padding: "2px 8px",
                          fontSize: "10px",
                          fontWeight: "bold",
                        }}
                      >
                        {playerNames.get(playerId)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Right: Info message if drawer */}
          {isDrawer && (
            <div style={{ flex: 1, maxWidth: "340px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
              <div style={{ font: "400 13px 'Space Mono',monospace", color: "rgba(255,233,168,.5)" }}>
                Players are guessing your drawing…
              </div>
            </div>
          )}
        </div>
      </>
    );
  }

  // Turn results phase
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "20px 0" }}>
      <div style={{ font: "700 28px 'Space Grotesk'", color: "#fff", textAlign: "center", marginBottom: "24px" }}>
        ROUND {round} RESULTS
      </div>

      <div style={{ width: "100%", maxWidth: "500px", margin: "0 auto 24px", background: "linear-gradient(165deg,#1a1a28,#0e0e18)", border: "2px solid var(--hue-gartic)", borderRadius: "18px", padding: "18px", boxSizing: "border-box", textAlign: "center" }}>
        <div style={{ font: "700 9px 'Space Mono',monospace", letterSpacing: ".25em", color: "var(--hue-gartic)", marginBottom: "10px" }}>
          THE WORD WAS
        </div>
        <div style={{ fontFamily: "'Alfa Slab One'", fontSize: "28px", color: "#ffe9a8", letterSpacing: ".15em" }}>
          {word}
        </div>
      </div>

      {guesses.length > 0 && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "8px", alignItems: "center", marginBottom: "24px" }}>
          {guesses.map((g, idx) => (
            <div
              key={idx}
              style={{
                width: "100%",
                maxWidth: "480px",
                borderRadius: "8px",
                padding: "12px 14px",
                fontSize: "13px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: g.correct ? "var(--hue-gartic)" : "#2b1a3d",
                color: g.correct ? "#1c1230" : "#ffe9a8",
                border: g.correct ? "none" : "1px solid #5a3f7a",
              }}
            >
              <span>{g.correct ? "✓ Guessed!" : g.text}</span>
              <span style={{ fontSize: "11px", opacity: 0.7 }}>{playerNames.get(g.playerId)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Scoreboard */}
      <div style={{ background: "rgba(43,26,61,.75)", border: "2px solid #5a3f7a", borderRadius: "16px", padding: "14px", backdropFilter: "blur(4px)", maxWidth: "300px", margin: "0 auto", width: "100%" }}>
        <div style={{ font: "700 9px 'Space Mono',monospace", letterSpacing: ".25em", color: "rgba(255,233,168,.5)", marginBottom: "10px" }}>
          SCORES
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
          {standings.map((s) => (
            <div key={s.playerId} style={{ display: "flex", alignItems: "center", gap: "9px", background: "#2b1a3d", border: "2px solid " + (s.playerId === props.playerId ? "var(--hue-gartic)" : "#5a3f7a"), borderRadius: "99px", padding: "4px 12px 4px 4px" }}>
              <div style={{ width: "28px", height: "28px", borderRadius: "99px", background: "#fff8e7", border: "2px solid " + (s.playerId === props.playerId ? "var(--hue-gartic)" : "#5a3f7a"), display: "flex", alignItems: "center", justifyContent: "center", font: "400 6px 'Space Mono',monospace", color: "#8a7f60" }}>
                {playerNames.get(s.playerId)?.slice(0, 2).toUpperCase() || "?"}
              </div>
              <div style={{ flex: 1, font: "700 12px 'Space Grotesk'", color: "#ffe9a8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {playerNames.get(s.playerId)}
              </div>
              <span style={{ fontFamily: "'Alfa Slab One'", fontSize: "14px", color: "#ffe9a8" }}>
                {s.score}
              </span>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes rise {
          0% { transform: translateY(20px); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
