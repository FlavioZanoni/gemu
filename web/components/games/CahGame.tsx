"use client";

import { useEffect, useState, useMemo } from "react";
import { useI18n } from "@/lib/i18n";
import { Button, TimerBadge, Banner, HowToPlayModal } from "../ui";
import type { GameProps } from "./types";

type CahPublicState = {
  phase: "answering" | "judging" | "roundResults";
  round: number;
  totalRounds: number;
  judge: string;
  blackCard: { text: string; pick: number };
  wins: Record<string, number>;
  deadline: number;
  submittedCount?: number;
  submitted?: string[];
  submissions?: string[][];
  reveal?: Array<{ playerId: string; cards: string[]; winner: boolean }>;
  winner?: string;
};

type CahPrivateState = {
  hand?: string[];
  submitted?: boolean;
  isJudge?: boolean;
};

export function CahGame(props: GameProps) {
  const { t } = useI18n();
  const publicState = props.publicState as CahPublicState | null;
  const privateState = props.privateState as CahPrivateState | null;

  const phase = publicState?.phase ?? "answering";
  const round = publicState?.round ?? 1;
  const totalRounds = publicState?.totalRounds ?? 8;
  const judge = publicState?.judge ?? "";
  const blackCard = publicState?.blackCard ?? { text: "", pick: 1 };
  const wins = publicState?.wins ?? {};
  const deadline = publicState?.deadline ?? null;
  const isJudge = privateState?.isJudge ?? false;
  const hasSubmitted = privateState?.submitted ?? false;
  const hand = privateState?.hand ?? [];
  const submittedCount = publicState?.submittedCount ?? 0;
  const submitted = publicState?.submitted ?? [];
  const submissions = publicState?.submissions ?? [];
  const reveal = publicState?.reveal ?? [];
  const winner = publicState?.winner ?? "";

  const [selectedCards, setSelectedCards] = useState<number[]>([]);
  const [showHowTo, setShowHowTo] = useState(round === 1 && phase === "answering");

  const standings = useMemo(
    () =>
      Object.entries(wins)
        .map(([playerId, score]) => ({ playerId, score }))
        .sort((a, b) => b.score - a.score),
    [wins]
  );

  const playerNames = useMemo(() => {
    const map = new Map<string, string>();
    props.players.forEach((player) => {
      map.set(player.id, player.name);
    });
    return map;
  }, [props.players]);

  const judgeeName = useMemo(() => playerNames.get(judge), [judge, playerNames]);

  const toggleCard = (index: number) => {
    if (hasSubmitted) return;
    setSelectedCards((prev) => {
      if (prev.includes(index)) {
        return prev.filter((i) => i !== index);
      }
      if (prev.length < blackCard.pick) {
        return [...prev, index];
      }
      return prev;
    });
  };

  const handleSubmit = () => {
    if (selectedCards.length === blackCard.pick && !hasSubmitted) {
      props.sendAction({ action: "submit", cards: selectedCards });
      setSelectedCards([]);
    }
  };

  const handlePickWinner = (index: number) => {
    if (isJudge) {
      props.sendAction({ action: "pick_winner", index });
    }
  };

  // Answering phase: play a card
  if (phase === "answering" && !isJudge) {
    return (
      <>
        <HowToPlayModal
          open={showHowTo}
          gameType="cah"
          gameName="CARTAS"
          stepCount={3}
          onClose={() => setShowHowTo(false)}
        />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "16px 0 0", overflow: "hidden", position: "relative" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div style={{ width: "34px", height: "34px", borderRadius: "99px", background: "#fff8e7", border: "2px solid var(--hue-cah)", display: "flex", alignItems: "center", justifyContent: "center", font: "400 6px 'Space Mono',monospace", color: "#8a7f60" }}>
                {judgeeName?.slice(0, 2).toUpperCase() || "?"}
              </div>
              <span style={{ font: "700 12px 'Space Mono',monospace", color: "var(--hue-cah)" }}>
                {judgeeName?.toUpperCase()} JUDGES THIS ROUND 👑
              </span>
            </div>
            <TimerBadge deadline={deadline} />
          </div>

          {/* The Table: scoreboard + black card + play zone + hand */}
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "36px", background: "radial-gradient(ellipse at 50% 60%,rgba(255,79,111,.09),transparent 65%)", borderRadius: "24px", position: "relative", minHeight: "320px", padding: "0 20px" }}>
            {/* Left: Scoreboard */}
            <div style={{ width: "210px", flex: "none", background: "rgba(43,26,61,.75)", border: "2px solid #5a3f7a", borderRadius: "16px", padding: "14px", backdropFilter: "blur(4px)" }}>
              <div style={{ font: "700 9px 'Space Mono',monospace", letterSpacing: ".25em", color: "rgba(255,233,168,.5)", marginBottom: "10px" }}>
                ROUND WINS
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                {standings.map((s) => (
                  <div key={s.playerId} style={{ display: "flex", alignItems: "center", gap: "9px", background: "#2b1a3d", border: "2px solid " + (s.playerId === props.playerId ? "var(--hue-cah)" : "#5a3f7a"), borderRadius: "99px", padding: "4px 12px 4px 4px" }}>
                    <div style={{ width: "28px", height: "28px", borderRadius: "99px", background: "#fff8e7", border: "2px solid " + (s.playerId === props.playerId ? "var(--hue-cah)" : "#5a3f7a"), display: "flex", alignItems: "center", justifyContent: "center", font: "400 6px 'Space Mono',monospace", color: "#8a7f60" }}>
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
              <div style={{ font: "400 8px 'Space Mono',monospace", color: "rgba(255,233,168,.3)", marginTop: "9px", textAlign: "center" }}>
                MOST WINS TAKES THE GAME
              </div>
            </div>

            {/* Center: Black card + play zone + hand area */}
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "40px" }}>
              {/* Black card */}
              <div style={{ width: "200px", height: "225px", flex: "none", background: "linear-gradient(165deg,#1a1a28,#0e0e18)", border: "2px solid var(--hue-cah)", borderRadius: "18px", padding: "18px", boxSizing: "border-box", transform: "rotate(-3deg)", boxShadow: "0 18px 40px rgba(0,0,0,.55),0 0 30px rgba(255,79,111,.15)", display: "flex", flexDirection: "column" }}>
                <div style={{ font: "700 9px 'Space Mono',monospace", letterSpacing: ".25em", color: "var(--hue-cah)", marginBottom: "10px" }}>
                  THE BLACK CARD
                </div>
                <div style={{ font: "700 19px/1.35 'Space Grotesk'", color: "#fff", flex: 1 }}>
                  {blackCard.text.split(/_{2,}/).map((part, i) => (
                    <span key={i}>
                      {part}
                      {i < blackCard.text.split(/_{2,}/).length - 1 && <span style={{ color: "var(--hue-cah)" }}>______</span>}
                    </span>
                  ))}
                </div>
                <div style={{ fontFamily: "'Alfa Slab One'", fontSize: "10px", color: "rgba(255,138,155,.5)" }}>
                  GEMU · CARTAS
                </div>
              </div>

              {/* Play zone or submitted pile */}
              {!hasSubmitted && (
                <div style={{ width: "200px", height: "230px", border: "3px dashed rgba(255,233,168,.25)", borderRadius: "18px", display: "flex", alignItems: "center", justifyContent: "center", font: "600 11px 'Space Mono',monospace", color: "rgba(255,233,168,.35)", textAlign: "center", lineHeight: "1.6" }}>
                  YOUR CARD<br />LANDS HERE<br />▼ pick from your hand
                </div>
              )}
              {hasSubmitted && (
                <div style={{ position: "relative", width: "220px", height: "250px" }}>
                  {/* Animated pile of submitted cards */}
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      style={{
                        position: "absolute",
                        left: "20px",
                        top: `${i * 8}px`,
                        width: "180px",
                        height: "220px",
                        background: "linear-gradient(160deg,#221530,#131320)",
                        border: "2px solid #3a2751",
                        borderRadius: "16px",
                        transform: `rotate(${-4 + i * 2}deg)`,
                        boxShadow: "0 10px 24px rgba(0,0,0,.5)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        animation: `throwIn 0.5s cubic-bezier(.2,.8,.3,1.1) ${i * 0.1}s both`,
                      }}
                    >
                      <div style={{ fontFamily: "'Alfa Slab One'", fontSize: "16px", color: "var(--hue-cah)", transform: "rotate(-8deg)", opacity: 0.8 }}>
                        GEMU
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* The Hand: fanned cards at bottom */}
          <div style={{ position: "relative", height: hand.length > 0 ? "260px" : "0px", marginTop: "6px", transition: "height 0.4s ease" }}>
            {hand.map((card, idx) => {
              const totalCards = hand.length;
              const angleSpread = 30;
              const startAngle = -(angleSpread / 2);
              const angle = startAngle + (idx / (totalCards - 1)) * angleSpread;
              const xOffset = Math.sin((angle * Math.PI) / 180) * 60;
              const yOffset = (1 - Math.cos((angle * Math.PI) / 180)) * 30;
              const isSelected = selectedCards.includes(idx);

              return (
                <button
                  key={idx}
                  onClick={() => toggleCard(idx)}
                  disabled={hasSubmitted}
                  style={{
                    position: "absolute",
                    left: "50%",
                    bottom: "-36px",
                    width: "185px",
                    height: "235px",
                    marginLeft: "-92px",
                    transform: `translate(${xOffset}px, ${isSelected ? yOffset - 40 : yOffset}px) rotate(${angle}deg)`,
                    transformOrigin: "50% 130%",
                    background: isSelected ? "linear-gradient(165deg,#ffe9a8,#ffd23f)" : "linear-gradient(160deg,#fff8e7,#f2e6c4)",
                    borderRadius: "16px",
                    padding: "18px",
                    boxSizing: "border-box",
                    cursor: hasSubmitted ? "default" : "pointer",
                    boxShadow: isSelected ? "0 26px 50px rgba(0,0,0,.6)" : "-6px 8px 22px rgba(0,0,0,.45)",
                    transition: "transform 0.18s ease, box-shadow 0.18s ease, background 0.18s ease",
                    display: "flex",
                    flexDirection: "column",
                    border: "none",
                    opacity: hasSubmitted ? 0.5 : 1,
                    zIndex: isSelected ? 10 : idx,
                  }}
                >
                  <div style={{ font: "700 16px/1.4 'Space Grotesk'", color: "#1c1230", flex: 1 }}>
                    {card}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontFamily: "'Alfa Slab One'", fontSize: "10px", color: "#c8b890" }}>
                      GEMU · CARTAS
                    </span>
                    <span style={{ font: "700 10px 'Space Mono',monospace", color: "#e84863" }}>
                      TAP TO PLAY ▲
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Submit button */}
          {!hasSubmitted && hand.length > 0 && (
            <div style={{ marginTop: "8px", display: "flex", justifyContent: "center" }}>
              <Button
                variant="hue"
                gameType="cah"
                onClick={handleSubmit}
                disabled={selectedCards.length !== blackCard.pick}
              >
                {selectedCards.length === blackCard.pick
                  ? "PLAY YOUR CARDS"
                  : `SELECT ${blackCard.pick} CARD${blackCard.pick > 1 ? "S" : ""}`}
              </Button>
            </div>
          )}

          {hasSubmitted && submittedCount !== undefined && (
            <div style={{ marginTop: "8px", textAlign: "center" }}>
              <Banner variant="waiting">
                {submittedCount} of {props.players.length - 1} players submitted
              </Banner>
            </div>
          )}
        </div>
      </>
    );
  }

  // Waiting for judge (when you're the judge during answering)
  if (phase === "answering" && isJudge) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "26px 0 40px" }}>
        <HowToPlayModal
          open={showHowTo}
          gameType="cah"
          gameName="CARTAS"
          stepCount={3}
          onClose={() => setShowHowTo(false)}
        />
        <div style={{ font: "700 12px 'Space Mono',monospace", letterSpacing: ".3em", color: "var(--hue-cah)", marginBottom: "16px" }}>
          ROUND {round} · YOU&apos;RE THE JUDGE 👑 · WAITING…
        </div>
        <Banner variant="waiting">
          Waiting for players to submit their cards…
        </Banner>
      </div>
    );
  }

  // Judging phase
  if (phase === "judging") {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "26px 0 40px" }}>
        <div style={{ font: "700 12px 'Space Mono',monospace", letterSpacing: ".3em", color: "var(--hue-cah)", marginBottom: "16px" }}>
          ROUND {round} · YOU&apos;RE THE JUDGE 👑 · READ THEM OUT LOUD
        </div>
        <div style={{ width: "560px", background: "#131320", border: "2px solid var(--hue-cah)", borderRadius: "16px", padding: "18px 22px", marginBottom: "18px" }}>
          <div style={{ font: "700 20px/1.35 'Space Grotesk'", color: "#fff" }}>
            {blackCard.text.split(/_{2,}/).map((part, i) => (
              <span key={i}>
                {part}
                {i < blackCard.text.split(/_{2,}/).length - 1 && <span style={{ color: "var(--hue-cah)" }}>______</span>}
              </span>
            ))}
          </div>
        </div>

        {/* Judge cards: displayed horizontally */}
        {isJudge && submissions.length > 0 && (
          <div style={{ display: "flex", gap: "20px", marginBottom: "22px", perspective: "900px", flexWrap: "wrap", justifyContent: "center" }}>
            {submissions.map((sub, idx) => (
              <button
                key={idx}
                onClick={() => handlePickWinner(idx)}
                style={{
                  width: "190px",
                  height: "240px",
                  background: "linear-gradient(160deg,#fff8e7,#f2e6c4)",
                  border: "2px solid #3a2751",
                  borderRadius: "16px",
                  padding: "18px",
                  boxSizing: "border-box",
                  cursor: "pointer",
                  boxShadow: "-6px 8px 22px rgba(0,0,0,.45)",
                  opacity: 1,
                  transform: "rotate(0deg)",
                  transition: "transform 0.18s ease, box-shadow 0.18s ease",
                  display: "flex",
                  flexDirection: "column",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-14px) scale(1.04)";
                  e.currentTarget.style.boxShadow = "0 26px 50px rgba(0,0,0,.6)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "rotate(0deg)";
                  e.currentTarget.style.boxShadow = "-6px 8px 22px rgba(0,0,0,.45)";
                }}
              >
                <div style={{ font: "700 17px/1.4 'Space Grotesk'", color: "#1c1230", flex: 1 }}>
                  {sub.join(" • ")}
                </div>
                <span style={{ fontFamily: "'Alfa Slab One'", fontSize: "11px", color: "#fff", background: "var(--hue-cah)", borderRadius: "99px", padding: "5px 12px", textAlign: "center" }}>
                  TAP TO PICK
                </span>
              </button>
            ))}
          </div>
        )}

        {!isJudge && (
          <Banner variant="waiting">
            Waiting for {judgeeName} to judge…
          </Banner>
        )}
      </div>
    );
  }

  // Round results phase
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "20px 0" }}>
      <div style={{ font: "700 28px 'Space Grotesk'", color: "#fff", textAlign: "center", marginBottom: "24px" }}>
        ROUND {round} RESULTS
      </div>

      {/* Black card */}
      <div style={{ width: "100%", maxWidth: "500px", margin: "0 auto 24px", background: "linear-gradient(165deg,#1a1a28,#0e0e18)", border: "2px solid var(--hue-cah)", borderRadius: "18px", padding: "18px", boxSizing: "border-box", textAlign: "center" }}>
        <div style={{ font: "700 9px 'Space Mono',monospace", letterSpacing: ".25em", color: "var(--hue-cah)", marginBottom: "10px" }}>
          THE BLACK CARD
        </div>
        <div style={{ font: "700 19px/1.35 'Space Grotesk'", color: "#fff" }}>
          {blackCard.text.split(/_{2,}/).map((part, i) => (
            <span key={i}>
              {part}
              {i < blackCard.text.split(/_{2,}/).length - 1 && <span style={{ color: "var(--hue-cah)" }}>______</span>}
            </span>
          ))}
        </div>
      </div>

      {/* Reveal submissions with animations */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "12px", alignItems: "center", marginBottom: "24px" }}>
        {reveal.map((item, idx) => (
          <div
            key={idx}
            style={{
              width: "100%",
              maxWidth: "480px",
              background: item.winner ? "linear-gradient(160deg,#fff8e7,#f2e6c4)" : "linear-gradient(160deg,#221530,#131320)",
              border: item.winner ? "2px solid #ffd23f" : "2px solid #3a2751",
              borderRadius: "14px",
              padding: "14px",
              boxSizing: "border-box",
              transform: item.winner ? "rotate(-1deg)" : "rotate(0deg)",
              boxShadow: item.winner ? "0 8px 30px rgba(255,210,63,.2)" : "0 6px 16px rgba(0,0,0,.3)",
              animation: item.winner ? "slam 0.45s ease-out" : "none",
            }}
          >
            <div style={{ font: "700 16px/1.4 'Space Grotesk'", color: item.winner ? "#1c1230" : "#fff", marginBottom: "8px" }}>
              {item.cards.join(" • ")}
            </div>
            {item.winner && (
              <div style={{ font: "700 13px 'Space Mono',monospace", color: "#ffd23f", textAlign: "center" }}>
                ✨ {playerNames.get(item.playerId)} PICKED THIS · +1 AWESOME POINT 🔊
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Scoreboard at bottom */}
      <div style={{ background: "rgba(43,26,61,.75)", border: "2px solid #5a3f7a", borderRadius: "16px", padding: "14px", backdropFilter: "blur(4px)", maxWidth: "300px", margin: "0 auto", width: "100%" }}>
        <div style={{ font: "700 9px 'Space Mono',monospace", letterSpacing: ".25em", color: "rgba(255,233,168,.5)", marginBottom: "10px" }}>
          ROUND WINS
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
          {standings.map((s) => (
            <div key={s.playerId} style={{ display: "flex", alignItems: "center", gap: "9px", background: "#2b1a3d", border: "2px solid " + (s.playerId === props.playerId ? "var(--hue-cah)" : "#5a3f7a"), borderRadius: "99px", padding: "4px 12px 4px 4px" }}>
              <div style={{ width: "28px", height: "28px", borderRadius: "99px", background: "#fff8e7", border: "2px solid " + (s.playerId === props.playerId ? "var(--hue-cah)" : "#5a3f7a"), display: "flex", alignItems: "center", justifyContent: "center", font: "400 6px 'Space Mono',monospace", color: "#8a7f60" }}>
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
        @keyframes throwIn {
          0% { transform: translate(-100px, -150px) rotate(-45deg); opacity: 0; }
          100% { transform: translate(0, 0) rotate(var(--rot-angle)); opacity: 1; }
        }
        @keyframes slam {
          0% { transform: scale(0) rotate(0deg); opacity: 0; }
          50% { transform: scale(1.15) rotate(-2deg); }
          100% { transform: scale(1) rotate(-1deg); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
