"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import { HowToPlayModal } from "../ui";
import { Avatar } from "../ui/PlayerChip";
import { playerColorFor } from "../ui/gameHues";
import type { Player } from "@/lib/protocol";
import type { GameProps } from "./types";
import { usePendingAction } from "./usePendingAction";

// Cartas (CAH) — the card table from design/games/CAH.dc.html: ROUND WINS
// panel left of the table, the black card + a landing slot / face-down pile /
// face-up reveal in the middle, and the hand fanned along the bottom (hover
// lifts, tap plays). The judge gets the centered "read them out loud" view.
// Everything sizes off the component's own width so it fits a phone or a
// small call tile: the fan becomes a card grid, the panel a chip strip.

type CahPublicState = {
  phase: "answering" | "judging" | "roundResults";
  round: number;
  totalRounds: number;
  judge: string;
  blackCard: { text: string; pick: number };
  wins: Record<string, number>;
  deadline: number;
  submittedCount?: number;
  expectedCount?: number;
  submitted?: string[];
  submissions?: string[][];
  reveal?: Array<{ playerId: string; cards: string[]; winner: boolean }>;
  winner?: string;
};

type CahPrivateState = {
  hand?: string[] | null;
  submitted?: boolean;
  isJudge?: boolean;
  played?: string[];
};

const HUE = "#ff4f6f";
const HUE_SOFT = "#ff8a9b";
const GOLD = "#ffd23f";
const CREAM = "#ffe9a8";
const LINE = "#5a3f7a";
const PANEL = "#2b1a3d";
const INK = "#1c1230";
const CARD_BG = "linear-gradient(160deg,#fff8e7,#f2e6c4)";
const WIN_SHADOW = "0 20px 50px rgba(232,72,99,.45),0 0 0 6px rgba(255,79,111,.15)";
const CARD_SHADOW = "0 10px 26px rgba(0,0,0,.5)";
const mono = (weight: number, size: number): CSSProperties => ({ font: `${weight} ${size}px 'Space Mono',monospace` });

/** Width of the game's own box (not the window) plus the viewport height:
 *  the app also runs as a small iframe tile inside a call. */
function useBox() {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(900);
  const [height, setHeight] = useState(900);
  useEffect(() => {
    if (!el) return;
    // Fires once on observe, then on every resize.
    const ro = new ResizeObserver(([entry]) => {
      setWidth(Math.round(entry.contentRect.width));
      setHeight(window.innerHeight);
    });
    ro.observe(el);
    const onResize = () => setHeight(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [el]);
  return [setEl, width, height] as const;
}

const clamp2: CSSProperties = { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" };

function BlackText({ text, blank = HUE_SOFT }: { text: string; blank?: string }) {
  const parts = text.split(/_{2,}/);
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 && <span style={{ color: blank }}>______</span>}
        </span>
      ))}
    </>
  );
}

/** A played answer: one card text, or both for a pick-2 prompt. */
function AnswerText({ cards }: { cards: string[] }) {
  return (
    <>
      {cards.map((c, i) => (
        <div key={i} style={i > 0 ? { borderTop: "2px dashed rgba(28,18,48,.18)", marginTop: 6, paddingTop: 6 } : undefined}>
          {c}
        </div>
      ))}
    </>
  );
}

type BoardRow = {
  player: Player;
  colorIndex: number;
  score: number;
  state: string;
  stateColor: string;
  isMe: boolean;
};

function RoundWins({ rows, compact, t }: { rows: BoardRow[]; compact: boolean; t: (k: string) => string }) {
  const leader = rows[0] && rows[0].score > 0 ? rows[0].player.id : "";
  if (compact) {
    return (
      <div data-testid="cah-round-wins" style={{ width: "100%" }}>
        <div style={{ ...mono(700, 9), letterSpacing: ".25em", color: "rgba(255,233,168,.5)", marginBottom: 6 }}>{t("cah.roundWins")}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {rows.map((r) => (
            <div
              key={r.player.id}
              data-testid={`cah-score-${r.player.id}`}
              style={{ display: "flex", alignItems: "center", gap: 6, background: PANEL, border: `2px solid ${r.player.id === leader ? GOLD : LINE}`, borderRadius: 99, padding: "2px 9px 2px 2px", opacity: r.player.connected ? 1 : 0.5, maxWidth: "100%" }}
            >
              <Avatar player={r.player} color={playerColorFor(r.colorIndex)} size={22} />
              <span style={{ font: "700 11px 'Space Grotesk'", color: CREAM, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 96 }}>
                {r.isMe ? t("cah.you") : r.player.name}
              </span>
              {r.state && <span style={{ ...mono(600, 8), color: r.stateColor }}>{r.state}</span>}
              <span style={{ fontFamily: "'Alfa Slab One'", fontSize: 12, color: CREAM }}>{r.score}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div data-testid="cah-round-wins" style={{ width: 210, flex: "none", background: "rgba(43,26,61,.75)", border: `2px solid ${LINE}`, borderRadius: 16, padding: 14, backdropFilter: "blur(4px)", boxSizing: "border-box", alignSelf: "center" }}>
      <div style={{ ...mono(700, 9), letterSpacing: ".25em", color: "rgba(255,233,168,.5)", marginBottom: 10 }}>{t("cah.roundWins")}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7, maxHeight: 420, overflowY: "auto" }}>
        {rows.map((r) => (
          <div
            key={r.player.id}
            data-testid={`cah-score-${r.player.id}`}
            style={{ display: "flex", alignItems: "center", gap: 9, background: PANEL, border: `2px solid ${r.player.id === leader ? GOLD : LINE}`, borderRadius: 99, padding: "4px 12px 4px 4px", opacity: r.player.connected ? 1 : 0.5 }}
          >
            <Avatar player={r.player} color={playerColorFor(r.colorIndex)} size={28} />
            <div style={{ flex: 1, minWidth: 0, font: "700 12px 'Space Grotesk'", color: CREAM, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {r.isMe ? t("cah.you") : r.player.name}
            </div>
            {r.state && <span style={{ ...mono(600, 8), color: r.stateColor, whiteSpace: "nowrap" }}>{r.state}</span>}
            <span style={{ fontFamily: "'Alfa Slab One'", fontSize: 14, color: CREAM }}>{r.score}</span>
          </div>
        ))}
      </div>
      <div style={{ ...mono(400, 8), color: "rgba(255,233,168,.3)", marginTop: 9, textAlign: "center" }}>{t("cah.mostWins")}</div>
    </div>
  );
}

export function CahGame(props: GameProps) {
  const { t } = useI18n();
  const [rootRef, width, viewH] = useBox();
  const pub = props.publicState as CahPublicState | null;
  const priv = props.privateState as CahPrivateState | null;

  const phase = pub?.phase ?? "answering";
  const round = pub?.round ?? 1;
  const judge = pub?.judge ?? "";
  const blackCard = pub?.blackCard ?? { text: "", pick: 1 };
  const pick = Math.max(1, blackCard.pick);
  const isJudge = priv?.isJudge ?? false;
  const hasSubmitted = priv?.submitted ?? false;
  const hand = useMemo(() => priv?.hand ?? [], [priv?.hand]);
  const submitted = useMemo(() => pub?.submitted ?? [], [pub?.submitted]);
  const submissions = pub?.submissions ?? [];
  const reveal = pub?.reveal ?? [];
  const winner = pub?.winner ?? "";

  // Selection, "sent" and hover are tied to the round they were made in, so
  // nothing leaks into the next prompt (a half-made pick-2 used to block
  // submitting; a stale hover lifted a card in the next hand).
  const [selection, setSelection] = useState<{ round: number; cards: number[] }>({ round: 0, cards: [] });
  const sent = usePendingAction<true>(props.privateState);
  const [hover, setHover] = useState<{ round: number; card: number | null; pick: number | null }>({ round: 0, card: null, pick: null });
  const hovered = hover.round === round ? hover.card : null;
  const hoveredPick = hover.round === round ? hover.pick : null;
  const setHovered = (next: number | null | ((prev: number | null) => number | null)) =>
    setHover((prev) => {
      const cur = prev.round === round ? prev.card : null;
      return { round, card: typeof next === "function" ? next(cur) : next, pick: prev.round === round ? prev.pick : null };
    });
  const setHoveredPick = (next: number | null) =>
    setHover((prev) => ({ round, card: prev.round === round ? prev.card : null, pick: next }));
  // Auto-open the how-to only from real state (round 1, still picking): a
  // remount after a reload mid-game must not pop it over the table.
  const [howToDismissed, setHowToDismissed] = useState(false);
  const showHowTo = !howToDismissed && pub?.round === 1 && pub?.phase === "answering" && !hasSubmitted;
  const selected = selection.round === round && phase === "answering" ? selection.cards : [];
  // Optimistic only until the server answers: a lost submit must not hide
  // the hand for the rest of the round — the next private state wins.
  const pending = phase === "answering" && !hasSubmitted && sent.pending(`submit-${round}`) === true;
  const played = hasSubmitted || pending;

  const brand = t("cah.brand");
  const nameOf = (id: string) => props.players.find((p) => p.id === id)?.name ?? "";
  const judgeIdx = props.players.findIndex((p) => p.id === judge);
  const judgePlayer = judgeIdx >= 0 ? props.players[judgeIdx] : null;
  const judgeName = (judgePlayer?.name ?? t("cah.theJudge")).toUpperCase();

  const connectedOthers = props.players.filter((p) => p.connected && p.id !== judge).length;
  const expected = pub?.expectedCount ?? connectedOthers;
  const submittedCount = pub?.submittedCount ?? submitted.length;

  const rows: BoardRow[] = useMemo(() => {
    const wins = pub?.wins ?? {};
    return props.players
      .map((player, colorIndex) => {
        const isJudgeRow = player.id === judge;
        const picking = phase === "answering" && !isJudgeRow && player.connected && !submitted.includes(player.id);
        return {
          player,
          colorIndex,
          score: wins[player.id] ?? 0,
          isMe: player.id === props.playerId,
          state: isJudgeRow ? `${t("cah.stateJudge")} 👑` : picking ? t("cah.statePicking") : "",
          stateColor: isJudgeRow ? HUE_SOFT : "rgba(255,233,168,.4)",
        };
      })
      .sort((a, b) => b.score - a.score);
  }, [pub?.wins, props.players, props.playerId, judge, phase, submitted, t]);

  // Nothing to show until the first game.state: until then PlayingScreen
  // hands us {}, which would read as "out of cards" / "THE JUDGE" / 0/N.
  if (!pub?.phase) {
    return <div ref={rootRef} data-testid="cah-loading" aria-busy="true" style={{ flex: 1, minWidth: 0, minHeight: 160 }} />;
  }

  // --- layout from the component's own width ---------------------------
  const narrow = width < 560; // panel as a chip strip, cards stack
  const short = viewH < 600; // a small call tile: compact cards, no slot
  const gridHand = narrow || short; // hand as a grid instead of the fan
  const sidePanel = width >= 760;
  const s = width >= 760 && !short ? 1 : 0.82; // card scale for the fan/table

  const play = (cards: number[]) => {
    const ok: unknown = props.sendAction({ action: "submit", cards });
    sent.mark(`submit-${round}`, true, ok);
    setSelection({ round, cards: [] });
    setHovered(null);
  };

  // Tap plays (design). A pick-2 prompt takes two taps, in order; tapping a
  // chosen card again takes it back.
  const tapCard = (idx: number) => {
    if (played || isJudge || phase !== "answering") return;
    if (selected.includes(idx)) {
      setSelection({ round, cards: selected.filter((i) => i !== idx) });
      return;
    }
    const next = [...selected, idx];
    if (next.length >= pick) play(next.slice(0, pick));
    else setSelection({ round, cards: next });
  };

  const howTo = (
    <HowToPlayModal open={showHowTo} gameType="cah" gameName={brand} stepCount={3} onClose={() => setHowToDismissed(true)} />
  );

  // ===================== JUDGE VIEW (judging / verdict) ==================
  if (isJudge && (phase === "judging" || phase === "roundResults")) {
    const judged = phase === "roundResults";
    const cards = judged ? reveal.map((r) => r.cards) : submissions;
    const cardW = narrow ? Math.floor((width - 12) / 2) : short ? 160 : 190;
    const cardH = short ? 130 : narrow ? Math.round(cardW * 1.2) : 240;
    const cols = narrow ? 2 : Math.min(cards.length, Math.max(1, Math.floor((width + 20) / (cardW + 20))));
    const winnerRow = reveal.find((r) => r.winner);
    return (
      <div ref={rootRef} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: narrow || short ? "12px 0 24px" : "26px 0 40px", boxSizing: "border-box" }}>
        {howTo}
        <div data-testid="cah-you-judge" style={{ ...mono(700, narrow ? 10 : 12), letterSpacing: narrow ? ".18em" : ".3em", color: HUE_SOFT, marginBottom: short ? 10 : 16, textAlign: "center" }}>
          {t("cah.roundN", { n: round })} · {t("cah.youJudge")} 👑 · {t("cah.readOutLoud")}
        </div>
        <div style={{ width: "100%", maxWidth: 560, boxSizing: "border-box", background: "#131320", border: `2px solid ${HUE}`, borderRadius: 16, padding: narrow || short ? "12px 16px" : "18px 22px", marginBottom: short ? 12 : 18 }}>
          <div style={{ font: `700 ${narrow || short ? 17 : 20}px/1.35 'Space Grotesk'`, color: "#fff" }}>
            <BlackText text={blackCard.text} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, ${cardW}px)`, gap: narrow ? 12 : 20, marginBottom: 22, perspective: 900, justifyContent: "center", maxWidth: "100%" }}>
          {cards.map((sub, i) => {
            const r = judged ? reveal[i] : undefined;
            const picked = !!r?.winner;
            const rot = picked ? 0 : i * 4 - 4;
            const lift = !judged && hoveredPick === i;
            return (
              <button
                key={`${round}-${i}`}
                data-testid={judged ? (picked ? "cah-winner" : `cah-reveal-${i}`) : `cah-pick-${i}`}
                disabled={judged}
                onClick={() => !judged && props.sendAction({ action: "pick_winner", index: i })}
                onPointerEnter={(e) => e.pointerType === "mouse" && setHoveredPick(i)}
                onPointerLeave={() => setHoveredPick(null)}
                style={{
                  width: cardW,
                  height: cardH,
                  background: CARD_BG,
                  border: picked ? `3px solid ${HUE}` : "2px solid transparent",
                  borderRadius: 16,
                  padding: narrow || short ? 12 : 18,
                  boxSizing: "border-box",
                  cursor: judged ? "default" : "pointer",
                  boxShadow: picked || lift ? (picked ? WIN_SHADOW : "0 26px 50px rgba(0,0,0,.6)") : CARD_SHADOW,
                  opacity: judged && !picked ? 0.45 : 1,
                  transform: lift ? "translateY(-14px) rotate(0deg) scale(1.04)" : `rotate(${rot}deg)`,
                  transition: "transform .18s ease, box-shadow .18s ease",
                  animation: picked ? "winPop .5s ease-out both" : judged ? "none" : `dealUp .5s cubic-bezier(.2,.8,.3,1.15) ${i * 0.1}s backwards`,
                  display: "flex",
                  flexDirection: "column",
                  textAlign: "left",
                }}
              >
                <div style={{ font: `700 ${narrow || short ? 14 : 17}px/1.4 'Space Grotesk'`, color: INK, flex: 1, minHeight: 0, overflow: "hidden", width: "100%" }}>
                  <AnswerText cards={sub} />
                </div>
                <span style={{ fontFamily: "'Alfa Slab One'", fontSize: narrow ? 10 : 11, lineHeight: 1.25, color: "#fff", background: HUE, borderRadius: 14, padding: "5px 10px", opacity: judged ? 1 : 0, textAlign: "center", alignSelf: "stretch", overflowWrap: "anywhere" }}>
                  {r ? (picked ? `${t("cah.winner")} 👑 ${nameOf(r.playerId).toUpperCase()}` : nameOf(r.playerId).toUpperCase()) : "·"}
                </span>
              </button>
            );
          })}
        </div>
        {judged ? (
          <div data-testid="cah-winner-toast" style={{ ...mono(700, 12), color: GOLD, textAlign: "center", animation: "rise .4s ease-out" }}>
            {winnerRow ? t("cah.thatWas", { name: nameOf(winnerRow.playerId).toUpperCase() }) : t("cah.noWinner")}
          </div>
        ) : (
          <div style={{ ...mono(400, 10), color: "rgba(255,233,168,.35)", textAlign: "center" }}>{t("cah.tapFunniest")}</div>
        )}
      </div>
    );
  }

  // ===================== TABLE VIEW =====================================
  const canPlay = phase === "answering" && !isJudge && !played && hand.length >= pick;
  const showHand = canPlay;
  const outOfCards = phase === "answering" && !isJudge && !played && hand.length < pick;

  let caption: string;
  if (phase === "answering") {
    if (isJudge) caption = t("cah.captionJudgeWait", { n: submittedCount, total: expected });
    else if (canPlay) caption = pick > 1 ? t("cah.captionPick2") : t("cah.captionPick");
    else if (expected > 0 && submittedCount >= expected) caption = t("cah.captionAllIn", { name: judgeName });
    else caption = t("cah.captionWaiting", { n: submittedCount, total: expected });
  } else if (phase === "judging") caption = t("cah.captionReading", { name: judgeName });
  else caption = t("cah.captionVerdict");

  // Header: who judges. "YOU'RE THE JUDGE" is the judge's alone.
  const headerLabel = isJudge ? (
    <span data-testid="cah-you-judge">{t("cah.youJudge")} 👑</span>
  ) : phase === "judging" ? (
    <span data-testid="cah-judging-label">{t("cah.isJudging", { name: judgeName })} 👑</span>
  ) : (
    <span>{t("cah.judgesThisRound", { name: judgeName })} 👑</span>
  );

  // Black card
  const compactBlack = narrow || short;
  const bcW = narrow ? undefined : short ? 220 : Math.round(200 * s);
  const bcH = compactBlack ? undefined : Math.round(225 * s);
  const blackCardEl = (
    <div
      data-testid="cah-black-card"
      style={{
        width: narrow ? "100%" : bcW,
        maxWidth: narrow ? 420 : undefined,
        height: bcH,
        minHeight: compactBlack ? 96 : undefined,
        flex: "none",
        background: "linear-gradient(165deg,#1a1a28,#0e0e18)",
        border: `2px solid ${HUE}`,
        borderRadius: 18,
        padding: compactBlack ? 14 : 18 * s,
        boxSizing: "border-box",
        transform: compactBlack ? "rotate(-1.5deg)" : "rotate(-3deg)",
        boxShadow: "0 18px 40px rgba(0,0,0,.55),0 0 30px rgba(255,79,111,.15)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ ...mono(700, 9), letterSpacing: ".25em", color: HUE_SOFT, marginBottom: compactBlack ? 6 : 10 }}>{t("cah.blackCard")}</div>
      <div style={{ font: `700 ${compactBlack ? 16 : Math.round(19 * s)}px/1.35 'Space Grotesk'`, color: "#fff", flex: 1, overflowWrap: "anywhere" }}>
        <BlackText text={blackCard.text} />
      </div>
      <div style={{ fontFamily: "'Alfa Slab One'", fontSize: 10, color: "rgba(255,138,155,.5)", marginTop: 6 }}>GEMU · {brand}</div>
    </div>
  );

  // Middle of the table: landing slot → face-down pile → face-up reveal.
  let middle: ReactNode = null;
  if (phase === "answering") {
    if (canPlay && !gridHand) {
      middle = (
        <div style={{ width: Math.round(200 * s), height: Math.round(230 * s), flex: "none", border: "3px dashed rgba(255,233,168,.25)", borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center", ...mono(600, 11), color: "rgba(255,233,168,.35)", textAlign: "center", lineHeight: 1.6, boxSizing: "border-box", padding: 8 }}>
          <div>
            {pick > 1 ? t("cah.slotCards", { n: pick }) : t("cah.slotCard")}
            <br />
            {t("cah.slotLands")}
            <br />
            {selected.length > 0 ? t("cah.slotOneMore") : t("cah.slotPick")}
          </div>
        </div>
      );
    } else if (!canPlay) {
      const n = Math.min(8, Math.max(submittedCount, played ? 1 : 0));
      const pw = compactBlack ? 96 : Math.round(180 * s);
      const ph = compactBlack ? 118 : Math.round(220 * s);
      middle = (
        <div data-testid="cah-pile" data-count={submittedCount} style={{ position: "relative", width: pw + 40, height: ph + 44, flex: "none" }}>
          {n === 0 && (
            <div style={{ position: "absolute", inset: "8px 10px", border: "3px dashed rgba(255,233,168,.2)", borderRadius: 16 }} />
          )}
          {Array.from({ length: n }, (_, i) => (
            <div
              key={i}
              style={{ position: "absolute", left: 10 + (i % 2) * 14, top: 8 + i * 5, width: pw, height: ph, background: "linear-gradient(160deg,#221530,#131320)", border: "2px solid #3a2751", borderRadius: 16, transform: `rotate(${i * 7 - 10}deg)`, boxShadow: "0 10px 24px rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", animation: "throwIn .5s cubic-bezier(.2,.8,.3,1.1) backwards" }}
            >
              <div style={{ fontFamily: "'Alfa Slab One'", fontSize: 16, color: HUE, transform: "rotate(-8deg)", opacity: 0.8 }}>GEMU</div>
            </div>
          ))}
        </div>
      );
    }
  } else {
    const won = phase === "roundResults";
    const items = won ? reveal.map((r) => ({ cards: r.cards, who: r.playerId, winner: r.winner })) : submissions.map((cards) => ({ cards, who: "", winner: false }));
    const many = items.length > 4;
    const cw = narrow ? Math.floor((width - 16) / 3) : short ? 136 : Math.round((many ? 124 : 150) * s);
    const ch = Math.round(cw * (short ? 0.9 : 1.3));
    const cols = narrow ? 3 : short ? Math.max(2, Math.min(4, Math.floor((width - 260) / (cw + 12)))) : many ? 3 : 2;
    middle = (
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(cols, Math.max(1, items.length))}, ${cw}px)`, gap: narrow ? 8 : 12, perspective: 900, justifyContent: "center", maxWidth: "100%" }}>
        {items.map((it, i) => {
          const mine = it.who === props.playerId;
          const tag = won
            ? it.winner
              ? `👑 ${t("cah.winner")} — ${mine ? t("cah.yours") : nameOf(it.who).toUpperCase()}`
              : mine
                ? t("cah.yours")
                : nameOf(it.who).toUpperCase()
            : t("cah.isReading", { name: judgeName });
          return (
            <div
              key={`${round}-${i}`}
              data-testid={it.winner ? "cah-winner" : `cah-table-${i}`}
              style={{
                width: cw,
                height: ch,
                background: CARD_BG,
                border: it.winner ? `3px solid ${HUE}` : "2px solid transparent",
                borderRadius: 14,
                padding: narrow ? 9 : 14,
                boxSizing: "border-box",
                transform: `rotate(${it.winner ? 0 : i * 3 - 4}deg)`,
                boxShadow: it.winner ? WIN_SHADOW : CARD_SHADOW,
                opacity: won && !it.winner ? 0.45 : 1,
                animation: it.winner ? "winPop .5s ease-out both" : won ? "none" : `flipIn .45s ease-out ${i * 0.35}s backwards`,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div style={{ font: `700 ${narrow || short ? 12 : 13.5}px/1.35 'Space Grotesk'`, color: INK, flex: 1, minHeight: 0, overflow: "hidden" }}>
                <AnswerText cards={it.cards} />
              </div>
              <div style={{ fontFamily: "'Alfa Slab One'", fontSize: narrow ? 8 : 10, lineHeight: 1.3, color: it.winner ? "#e84863" : "#a8987a", overflowWrap: "anywhere", ...clamp2 }}>{tag}</div>
            </div>
          );
        })}
      </div>
    );
  }

  // Toast once the verdict is in.
  let toast: ReactNode = null;
  if (phase === "roundResults") {
    const text = !winner
      ? t("cah.noWinner")
      : winner === props.playerId
        ? t("cah.pickedYours", { judge: judgeName })
        : t("cah.pickedOther", { judge: judgeName, name: nameOf(winner).toUpperCase() });
    toast = (
      <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
        <div data-testid="cah-winner-toast" style={{ background: PANEL, border: `2px solid ${GOLD}`, borderRadius: 14, padding: narrow ? "10px 14px" : "12px 26px", animation: "slam .45s ease-out", boxShadow: "0 8px 30px rgba(0,0,0,.5)", transform: "rotate(-1deg)", maxWidth: "100%", boxSizing: "border-box" }}>
          <span style={{ ...mono(700, narrow ? 11 : 13), color: GOLD, whiteSpace: narrow ? "normal" : "nowrap", display: "block", textAlign: "center" }}>{text}</span>
        </div>
      </div>
    );
  }

  // --- the hand ----------------------------------------------------------
  let handEl: ReactNode = null;
  // On a short tile (wide enough) the hand sits on the table beside the
  // black card instead of below it, so everything fits without scrolling.
  const handOnTable = short && !narrow;
  const handWidth = handOnTable ? width - (sidePanel ? 246 : 0) - 220 - 40 : width;
  if (showHand) {
    const n = hand.length;
    if (gridHand) {
      // Phones get 3 roomy columns; a short tile lays the hand out in one
      // row of small cards so the whole table fits without scrolling.
      const cols = short ? Math.max(Math.min(3, n), Math.min(n, Math.floor((handWidth + 8) / 96))) : 3;
      const cw = Math.min(short ? 150 : 200, Math.floor((handWidth - 8 * (cols - 1)) / cols));
      const chh = short ? Math.max(96, Math.round(cw * 0.8)) : Math.round(cw * 1.22);
      handEl = (
        <div data-testid="cah-hand" data-pick={pick} style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, ${cw}px)`, gap: 8, justifyContent: "center", marginTop: handOnTable ? 0 : short ? 8 : 14, paddingTop: 12 }}>
          {hand.map((card, idx) => {
            const sel = selected.indexOf(idx);
            return (
              <button
                key={card}
                data-testid={`cah-card-${idx}`}
                onClick={() => tapCard(idx)}
                style={{ position: "relative", width: cw, height: chh, background: sel >= 0 ? "linear-gradient(165deg,#ffe9a8,#ffd23f)" : CARD_BG, border: sel >= 0 ? `3px solid ${HUE}` : "none", borderRadius: 12, padding: 9, boxSizing: "border-box", boxShadow: "-4px 6px 16px rgba(0,0,0,.45)", transform: sel >= 0 ? "translateY(-10px)" : `rotate(${(idx % 3) - 1}deg)`, transition: "transform .18s ease", animation: `dealUp .55s cubic-bezier(.2,.8,.3,1.15) ${idx * 0.09}s backwards`, display: "flex", flexDirection: "column", textAlign: "left", cursor: "pointer" }}
              >
                <div style={{ font: `700 ${cw < 110 ? 11.5 : 12.5}px/1.3 'Space Grotesk'`, color: INK, flex: 1, minHeight: 0, overflow: "hidden", width: "100%" }}>{card}</div>
                <div style={{ ...mono(700, 8), color: "#e84863", alignSelf: "flex-end" }}>{sel >= 0 ? `${sel + 1}/${pick}` : "▲"}</div>
              </button>
            );
          })}
        </div>
      );
    } else {
      const cw = Math.round(185 * s);
      const ch = Math.round(235 * s);
      const half = (n - 1) / 2;
      // Spread like the design (off×135), squeezed to the box but never so
      // tight that a card's center is hidden under its neighbour.
      const spread = half > 0 ? Math.max(cw * 0.55, Math.min(135 * s, (width / 2 - cw / 2 - 40 * s) / half)) : 0;
      handEl = (
        <div data-testid="cah-hand" data-pick={pick} style={{ position: "relative", height: Math.round(250 * s), marginTop: 6, clipPath: "inset(-400px 0 0 0)" }}>
          {hand.map((card, idx) => {
            const off = idx - half;
            const x = Math.round(off * spread);
            const y = Math.round(off * off * 14 * s);
            const sel = selected.indexOf(idx);
            const up = hovered === idx || sel >= 0;
            return (
              <button
                key={card}
                data-testid={`cah-card-${idx}`}
                onClick={() => tapCard(idx)}
                onPointerEnter={(e) => e.pointerType === "mouse" && setHovered(idx)}
                onPointerLeave={() => setHovered((h) => (h === idx ? null : h))}
                style={{
                  position: "absolute",
                  left: "50%",
                  bottom: Math.round(-36 * s),
                  width: cw,
                  height: ch,
                  marginLeft: -cw / 2,
                  transform: up ? `translate(${x}px,${y - Math.round(58 * s)}px) rotate(0deg) scale(1.06)` : `translate(${x}px,${y}px) rotate(${(off * 8).toFixed(1)}deg)`,
                  transformOrigin: "50% 130%",
                  background: sel >= 0 ? "linear-gradient(165deg,#ffe9a8,#ffd23f)" : CARD_BG,
                  border: sel >= 0 ? `3px solid ${HUE}` : "none",
                  borderRadius: 16,
                  padding: 18 * s,
                  boxSizing: "border-box",
                  cursor: "pointer",
                  boxShadow: up ? "0 26px 50px rgba(0,0,0,.6)" : "-6px 8px 22px rgba(0,0,0,.45)",
                  transition: "transform .18s ease, box-shadow .18s ease",
                  animation: `dealUp .55s cubic-bezier(.2,.8,.3,1.15) ${idx * 0.09}s backwards`,
                  display: "flex",
                  flexDirection: "column",
                  textAlign: "left",
                  zIndex: up ? 10 : idx,
                }}
              >
                <div style={{ font: `700 ${Math.round(16 * s)}px/1.4 'Space Grotesk'`, color: INK, flex: 1, minHeight: 0, width: "100%", overflow: "hidden" }}>{card}</div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", gap: 6 }}>
                  <span style={{ fontFamily: "'Alfa Slab One'", fontSize: 10, color: "#c8b890", whiteSpace: "nowrap" }}>GEMU · {brand}</span>
                  <span style={{ ...mono(700, 10), color: "#e84863", whiteSpace: "nowrap" }}>{sel >= 0 ? `${sel + 1}/${pick}` : t("cah.tapToPlay")}</span>
                </div>
              </button>
            );
          })}
        </div>
      );
    }
  }

  return (
    <div ref={rootRef} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", paddingTop: narrow || short ? 8 : 16, paddingBottom: showHand && !gridHand ? 0 : 20, position: "relative", boxSizing: "border-box" }}>
      {howTo}
      {/* Who judges · what's happening */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          {judgePlayer && <Avatar player={judgePlayer} color={HUE} size={narrow ? 28 : 34} />}
          <span style={{ ...mono(700, narrow ? 11 : 12), color: HUE_SOFT }}>{headerLabel}</span>
        </div>
        <span data-testid="cah-caption" style={{ ...mono(700, narrow ? 9 : 11), letterSpacing: ".2em", color: "rgba(255,233,168,.5)" }}>{caption}</span>
      </div>

      {!sidePanel && (
        <div style={{ margin: "6px 0 10px" }}>
          <RoundWins rows={rows} compact t={t} />
        </div>
      )}

      {/* THE TABLE */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          gap: 36,
          background: "radial-gradient(ellipse at 50% 60%,rgba(255,79,111,.09),transparent 65%)",
          borderRadius: 24,
          position: "relative",
          minHeight: compactBlack ? 0 : Math.round(320 * s),
          padding: narrow ? "4px 0" : short ? "4px 8px" : "12px 20px",
        }}
      >
        {sidePanel && <RoundWins rows={rows} compact={false} t={t} />}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: narrow ? "column" : "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: compactBlack ? 14 : Math.round(40 * s) }}>
          {blackCardEl}
          {handOnTable && handEl ? handEl : middle}
        </div>
      </div>

      {toast}

      {outOfCards && (
        <div style={{ ...mono(700, 11), color: "rgba(255,233,168,.6)", textAlign: "center", marginTop: 12 }}>{t("cah.outOfCards")}</div>
      )}

      {!handOnTable && handEl}
    </div>
  );
}
