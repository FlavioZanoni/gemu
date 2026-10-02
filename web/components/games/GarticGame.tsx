"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Check, Flame, Pencil } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { HowToPlayModal, playerColorFor } from "../ui";
import { Avatar } from "../ui/PlayerChip";
import { DrawingCanvas, type CanvasAction, type DrawingCanvasHandle } from "../DrawingCanvas";
import { getWSClient } from "@/lib/ws";
import type { Envelope, Player } from "@/lib/protocol";
import type { GameProps } from "./types";

type GarticGuess = {
  seq: number;
  playerId: string;
  /** Empty for correct guesses and near misses (the server never sends those). */
  text: string;
  correct: boolean;
  close?: boolean;
  points?: number;
};

type GarticPublicState = {
  phase: "drawing" | "turnResults";
  round: number;
  totalRounds: number;
  drawer: string;
  deadline?: number;
  turnSeconds?: number;
  turnStartedAt?: number;
  scores: Record<string, number>;
  guessed: string[] | null;
  guesses: GarticGuess[] | null;
  turnOrder: string[] | null;
  turnIndex: number;
  /** Guesser view of the word: "_" per hidden letter, spaces/hyphens kept. */
  mask?: string;
  letters?: number;
  nextHintAt?: number;
  /** Set while the turn waits for a reconnecting drawer / for a guesser. */
  graceEnd?: number;
  word?: string;
};

type GarticPrivateState = {
  word?: string;
  closeGuess?: string;
  /** This player's own near misses by guess seq (hidden from everyone else). */
  ownClose?: Record<string, string>;
};

const HUE = "#35d4b9";
const CAPTION = "rgba(255,233,168,.45)";
const MONO = "'Space Mono', monospace";

type Layout = "wide" | "mid" | "narrow";

/** Container-width layout: three columns like the design, two on tablets /
 *  landscape tiles, one stacked column (canvas first) on phones. */
function useLayout(): [React.RefObject<HTMLDivElement | null>, Layout] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<Layout>("wide");
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const next: Layout = w >= 960 ? "wide" : w >= 520 ? "mid" : "narrow";
      setLayout((prev) => (prev === next ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, layout];
}

const clock = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        font: `700 11px ${MONO}`,
        letterSpacing: ".25em",
        color: CAPTION,
        marginBottom: 10,
      }}
    >
      {children}
    </div>
  );
}

export function GarticGame(props: GameProps) {
  const { t } = useI18n();
  const publicState = props.publicState as GarticPublicState | null;
  const privateState = props.privateState as GarticPrivateState | null;
  const canvasRef = useRef<DrawingCanvasHandle | null>(null);
  const chatRef = useRef<HTMLDivElement | null>(null);
  const [rootRef, layout] = useLayout();

  const phase = publicState?.phase ?? "drawing";
  const round = publicState?.round ?? 1;
  const totalRounds = publicState?.totalRounds ?? 2;
  const drawer = publicState?.drawer ?? "";
  const turnIndex = publicState?.turnIndex ?? 0;
  const turnKey = `${round}-${turnIndex}-${drawer}`;
  const scores = useMemo(() => publicState?.scores ?? {}, [publicState?.scores]);
  const guessed = useMemo(() => publicState?.guessed ?? [], [publicState?.guessed]);
  const guesses = useMemo(() => publicState?.guesses ?? [], [publicState?.guesses]);
  const ownClose = privateState?.ownClose ?? {};
  const word = privateState?.word ?? publicState?.word ?? "";
  const isDrawer = drawer === props.playerId;
  const drawing = phase === "drawing";
  const hasGuessed = guessed.includes(props.playerId);

  // The draft guess belongs to one turn: a half-typed guess (or one that
  // never got sent) must not carry over into the next drawer's turn.
  const [guessDraft, setGuessDraft] = useState({ turn: turnKey, text: "" });
  const guess = guessDraft.turn === turnKey ? guessDraft.text : "";
  const setGuess = (text: string) => setGuessDraft({ turn: turnKey, text });
  // Round 1 opens the how-to — but not for someone rejoining mid-turn.
  const [showHowTo, setShowHowTo] = useState(
    () =>
      round === 1 &&
      phase === "drawing" &&
      !(publicState?.turnStartedAt && Date.now() - publicState.turnStartedAt > 5000),
  );

  const playerById = useMemo(
    () => new Map(props.players.map((player) => [player.id, player])),
    [props.players],
  );
  const colorById = useMemo(
    () => new Map(props.players.map((player, index) => [player.id, playerColorFor(index)])),
    [props.players],
  );
  const nameOf = (id: string) => playerById.get(id)?.name ?? "?";

  // Every room member gets a row even before anyone scores.
  const standings = useMemo(() => {
    const ids = new Set<string>([...props.players.map((p) => p.id), ...Object.keys(scores)]);
    return [...ids]
      .filter((id) => playerById.has(id))
      .map((id) => ({ playerId: id, score: scores[id] ?? 0 }))
      .sort((a, b) => b.score - a.score);
  }, [props.players, scores, playerById]);

  const connectedGuessers = props.players.filter((p) => p.connected && p.id !== drawer).length;

  // ---- live canvas relay ----

  // Guessers paint the drawer's stream. A ref keeps the subscription stable
  // across renders so no stroke segment is dropped mid-resubscribe.
  const relayRef = useRef({ drawer, isDrawer });
  useEffect(() => {
    relayRef.current = { drawer, isDrawer };
  }, [drawer, isDrawer]);
  useEffect(() => {
    const unsubscribe = getWSClient().onMessage((message: Envelope) => {
      if (message.type !== "game.stream" || !message.payload) return;
      const { drawer: currentDrawer, isDrawer: amDrawer } = relayRef.current;
      if (amDrawer || message.payload.playerId !== currentDrawer) return;
      canvasRef.current?.applyRemoteStroke(message.payload as unknown as CanvasAction);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const sendStream = props.sendStream;
  const handleStroke = (action: CanvasAction) => {
    sendStream({ ...action });
  };

  // Drawer resync. Someone (re)joining mid-turn has a blank canvas, so the
  // drawer pushes a snapshot whenever a player comes (back) online; and a
  // drawer who refreshed mid-turn starts blank, so it snapshots that blank
  // canvas to everyone. Both sides drop undo history on a snapshot, keeping
  // canvas_undo consistent.
  // Returns false when it has to wait: never mid-gesture, or the receivers'
  // undo stacks would not line up with the drawer's (and a shape preview
  // is not part of the drawing yet).
  const sendSnapshot = (): boolean => {
    const canvas = canvasRef.current;
    if (canvas?.isGestureActive?.()) return false;
    const snap = canvas?.snapshot?.();
    if (!canvas || !snap || !snap.data) return true;
    canvas.resetHistory?.();
    sendStream({ ...snap });
    return true;
  };
  const sendSnapshotRef = useRef(sendSnapshot);
  useEffect(() => {
    sendSnapshotRef.current = sendSnapshot;
  });

  const onlineKey = props.players
    .filter((p) => p.connected)
    .map((p) => p.id)
    .sort()
    .join(",");
  // One pending snapshot at a time, cleared only on unmount — re-renders
  // (e.g. a burst of room.updated) must not cancel it.
  const snapshotTimerRef = useRef<number | null>(null);
  const scheduleSnapshot = (delay: number) => {
    if (snapshotTimerRef.current !== null) window.clearTimeout(snapshotTimerRef.current);
    snapshotTimerRef.current = window.setTimeout(() => {
      snapshotTimerRef.current = null;
      if (!sendSnapshotRef.current()) scheduleSnapshot(250);
    }, delay);
  };
  const scheduleSnapshotRef = useRef(scheduleSnapshot);
  useEffect(() => {
    scheduleSnapshotRef.current = scheduleSnapshot;
  });
  useEffect(
    () => () => {
      if (snapshotTimerRef.current !== null) window.clearTimeout(snapshotTimerRef.current);
    },
    [],
  );

  const prevOnlineRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevOnlineRef.current;
    prevOnlineRef.current = onlineKey;
    if (prev === null || !isDrawer || !drawing) return;
    const before = new Set(prev.split(","));
    const arrived = onlineKey.split(",").some((id) => id && !before.has(id));
    // Give the rejoiner's page a moment to mount its canvas and subscribe.
    if (arrived) scheduleSnapshotRef.current(800);
  }, [onlineKey, isDrawer, drawing]);

  // Every mount of the canvas counts, not just this component's: if the
  // drawer's canvas ever (re)mounts mid-turn it starts blank (no history), so
  // it pushes that state to everyone instead of silently diverging.
  const turnStartedAt = publicState?.turnStartedAt ?? 0;
  const [canvasMounts, setCanvasMounts] = useState(0);
  const onCanvasMount = useCallback(() => setCanvasMounts((n) => n + 1), []);
  const resyncedMountRef = useRef(0);
  useEffect(() => {
    if (canvasMounts === 0 || resyncedMountRef.current === canvasMounts || !turnStartedAt) return;
    resyncedMountRef.current = canvasMounts;
    if (isDrawer && drawing && Date.now() - turnStartedAt > 1500) scheduleSnapshotRef.current(300);
  }, [canvasMounts, drawing, isDrawer, turnStartedAt]);

  // ---- guessing ----

  const handleGuess = () => {
    if (!guess.trim() || isDrawer || hasGuessed || !drawing) return;
    props.sendAction({ action: "guess", text: guess.trim() });
    setGuess("");
  };

  // Keep the newest chat line in view by scrolling the chat box itself —
  // scrollIntoView would drag the whole page on phones.
  useEffect(() => {
    const box = chatRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [guesses, privateState?.closeGuess]);

  // ---- pieces ----

  const scoreboard = (
    <div data-testid="gartic-scoreboard">
      <SectionLabel>{t("gartic.scoreboard", { round, total: totalRounds })}</SectionLabel>
      <div className={layout === "narrow" ? "grid grid-cols-1 gap-1.5 min-[420px]:grid-cols-2" : "flex flex-col gap-1.5"}>
        {standings.map((s, index) => {
          const player = playerById.get(s.playerId) as Player;
          const isMe = s.playerId === props.playerId;
          const isPlayerDrawing = s.playerId === drawer && drawing;
          const playerGuessed = guessed.includes(s.playerId);
          const away = !player.connected;
          const stateText = away
            ? t("gartic.state.away")
            : isPlayerDrawing
              ? t("gartic.state.drawing")
              : playerGuessed
                ? t("gartic.state.gotIt")
                : drawing
                  ? t("gartic.state.guessing")
                  : "";
          const stateColor = away
            ? "#ff4f6f"
            : isPlayerDrawing || playerGuessed
              ? HUE
              : "rgba(255,233,168,.4)";
          const leader = index === 0 && s.score > 0;
          const ring = colorById.get(s.playerId) ?? "#5a3f7a";
          return (
            <div
              key={s.playerId}
              data-testid="gartic-score-row"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                minWidth: 0,
                background: "#2b1a3d",
                border: `2px solid ${leader ? "#ffd23f" : "#5a3f7a"}`,
                borderRadius: 99,
                padding: "5px 12px 5px 5px",
                opacity: away ? 0.5 : 1,
              }}
            >
              <Avatar player={player} color={ring} size={28} />
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  font: "700 12px 'Space Grotesk'",
                  color: "#ffe9a8",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                  {isMe ? t("gartic.you") : player.name}
                </span>
                {isPlayerDrawing && <Pencil size={12} strokeWidth={2.5} style={{ flexShrink: 0, color: HUE }} />}
              </div>
              {stateText && (
                <span style={{ font: `600 8px ${MONO}`, color: stateColor, whiteSpace: "nowrap" }}>
                  {stateText}
                </span>
              )}
              <span style={{ fontFamily: "'Alfa Slab One'", fontSize: 14, color: "#ffe9a8" }}>{s.score}</span>
            </div>
          );
        })}
      </div>
      <div style={{ font: `400 8px ${MONO}`, color: "rgba(255,233,168,.3)", marginTop: 9, textAlign: "center" }}>
        {t("gartic.pointsNote")}
      </div>
    </div>
  );

  const chatLine = (g: GarticGuess) => {
    if (g.correct) {
      return {
        color: HUE,
        text: t("gartic.chat.correct", {
          name: g.playerId === props.playerId ? t("gartic.you") : nameOf(g.playerId),
          pts: g.points ?? 0,
        }),
        icon: <Check size={14} strokeWidth={3} style={{ flexShrink: 0 }} />,
      };
    }
    if (g.close) {
      const mine = ownClose[String(g.seq)];
      if (g.playerId === props.playerId && mine) {
        return {
          color: "#ff9d3f",
          text: t("gartic.chat.ownClose", { text: mine }),
          icon: <Flame size={14} strokeWidth={2.5} style={{ flexShrink: 0 }} />,
        };
      }
      return {
        color: "#ff9d3f",
        text: t("gartic.chat.close", { name: nameOf(g.playerId) }),
        icon: <Flame size={14} strokeWidth={2.5} style={{ flexShrink: 0 }} />,
      };
    }
    return {
      color: "rgba(255,233,168,.75)",
      text: `${g.playerId === props.playerId ? t("gartic.you") : nameOf(g.playerId)}: ${g.text}`,
      icon: null,
    };
  };

  const closeNow =
    drawing && !hasGuessed && !!privateState?.closeGuess &&
    guesses.length > 0 && guesses[guesses.length - 1].playerId === props.playerId &&
    guesses[guesses.length - 1].close;

  const chatBox = (
    <div
      ref={chatRef}
      data-testid="gartic-chat"
      style={{
        flex: layout === "wide" ? 1 : "none",
        height: layout === "narrow" ? 150 : layout === "mid" ? "clamp(110px, calc(100dvh - 330px), 300px)" : undefined,
        minHeight: 0,
        background: "#2b1a3d",
        border: "2px solid #5a3f7a",
        borderRadius: 16,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        overflowY: "auto",
        overscrollBehavior: "contain",
      }}
    >
      {/* Spacer pins lines to the bottom while the box isn't full yet. */}
      <div style={{ flex: 1 }} />
      {guesses.length === 0 && (
        <div style={{ font: `400 11px ${MONO}`, color: "rgba(255,233,168,.35)", textAlign: "center" }}>
          {t("gartic.chat.empty")}
        </div>
      )}
      {guesses.map((g) => {
        const line = chatLine(g);
        return (
          <div
            key={g.seq}
            data-testid="gartic-chat-line"
            style={{
              font: "600 13px 'Space Grotesk'",
              color: line.color,
              animation: "rise .3s ease-out",
              display: "flex",
              alignItems: "flex-start",
              gap: 6,
              overflowWrap: "anywhere",
            }}
          >
            {line.icon}
            <span>{line.text}</span>
          </div>
        );
      })}
    </div>
  );

  const guessForm = !isDrawer && drawing && (
    <div>
      {closeNow && (
        <div
          data-testid="gartic-close-hint"
          style={{ display: "flex", alignItems: "center", gap: 6, font: `700 11px ${MONO}`, color: "#ff9d3f", marginBottom: 6 }}
        >
          <Flame size={14} strokeWidth={2.5} /> {t("gartic.closeBanner")}
        </div>
      )}
      {hasGuessed ? (
        <div
          data-testid="gartic-got-it"
          style={{ background: "rgba(53,212,185,.12)", border: `2px solid ${HUE}`, borderRadius: 12, padding: "11px 14px", font: `700 11px ${MONO}`, color: HUE, textAlign: "center" }}
        >
          {t("gartic.youGotIt")}
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleGuess();
          }}
          style={{ display: "flex", gap: 8, minWidth: 0 }}
        >
          <input
            data-testid="gartic-guess-input"
            type="text"
            value={guess}
            maxLength={80}
            autoComplete="off"
            enterKeyHint="send"
            onChange={(e) => setGuess(e.target.value)}
            placeholder={t("gartic.placeholder")}
            aria-label={t("gartic.placeholder")}
            style={{
              flex: 1,
              minWidth: 0,
              height: 44,
              borderRadius: 12,
              border: `2px solid ${HUE}`,
              background: "#1c1230",
              padding: "0 14px",
              color: "#ffe9a8",
              font: "600 14px 'Space Grotesk'",
              outline: "none",
            }}
          />
          <button
            data-testid="gartic-guess-submit"
            type="submit"
            disabled={!guess.trim()}
            className="active:translate-y-0.5"
            style={{
              flex: "none",
              height: 44,
              padding: "0 18px",
              borderRadius: 12,
              border: "none",
              background: "linear-gradient(180deg,#41e0c4,#28b89e)",
              color: "#0c3d33",
              font: "400 16px 'Alfa Slab One'",
              boxShadow: "0 3px 0 #0f6e5c",
              cursor: guess.trim() ? "pointer" : "default",
              opacity: guess.trim() ? 1 : 0.6,
            }}
          >
            {t("gartic.go")}
          </button>
        </form>
      )}
    </div>
  );

  const drawerNote = isDrawer && drawing && (
    <div
      style={{
        background: "#1c1230",
        border: "2px dashed #5a3f7a",
        borderRadius: 12,
        padding: "11px 14px",
        font: `400 11px ${MONO}`,
        color: "rgba(255,233,168,.35)",
        textAlign: "center",
      }}
    >
      {t("gartic.drawerNote")}
    </div>
  );

  // Word row: secret word (drawer) / letter mask with hints (guessers) on the
  // left, "N OF M GUESSED ✓" on the right. The countdown lives in the shell.
  const mask = publicState?.mask ?? "";
  const deadline = publicState?.deadline;
  const nextHint =
    drawing && publicState?.nextHintAt && deadline ? clock(deadline - publicState.nextHintAt) : null;
  const guessedLabel = t("gartic.guessedCount", { n: guessed.length, m: Math.max(connectedGuessers, guessed.length) });

  const wordRow = drawing ? (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
      {isDrawer ? (
        <div style={{ minWidth: 0 }}>
          <div style={{ font: `700 10px ${MONO}`, letterSpacing: ".35em", color: HUE }}>{t("gartic.secretWord")}</div>
          <div
            data-testid="gartic-secret-word"
            style={{ fontFamily: "'Alfa Slab One'", fontSize: 26, lineHeight: 1.15, color: "#ffe9a8", textShadow: "0 3px 0 #c2452d", overflowWrap: "anywhere" }}
          >
            {word || "?"}
          </div>
        </div>
      ) : (
        <div style={{ minWidth: 0 }}>
          <div style={{ font: `700 10px ${MONO}`, letterSpacing: ".35em", color: HUE, textTransform: "uppercase" }}>
            {t("gartic.isDrawing", { name: nameOf(drawer) })}
          </div>
          <div
            data-testid="gartic-mask"
            aria-label={t("gartic.letters", { n: publicState?.letters ?? 0 })}
            style={{ display: "flex", flexWrap: "wrap", columnGap: 16, rowGap: 2, marginTop: 4 }}
          >
            {mask.split(" ").map((part, wi) => (
              <span key={wi} style={{ display: "flex", gap: 3 }}>
                {[...part].map((ch, ci) => (
                  <span
                    key={ci}
                    style={{
                      width: "0.95em",
                      textAlign: "center",
                      fontFamily: ch === "_" ? MONO : "'Alfa Slab One'",
                      fontWeight: 700,
                      fontSize: 20,
                      lineHeight: 1.2,
                      color: ch === "_" ? "rgba(255,233,168,.7)" : "#ffe9a8",
                      textShadow: ch === "_" ? undefined : "0 2px 0 #c2452d",
                    }}
                  >
                    {ch}
                  </span>
                ))}
              </span>
            ))}
          </div>
          <div style={{ font: `400 9px ${MONO}`, color: "rgba(255,233,168,.45)", marginTop: 3 }}>
            {t("gartic.letters", { n: publicState?.letters ?? 0 })}
            {nextHint && ` · ${t("gartic.nextHint", { time: nextHint })}`}
          </div>
        </div>
      )}
      <div data-testid="gartic-guessed-count" style={{ font: `600 11px ${MONO}`, color: CAPTION, textAlign: "right", whiteSpace: "nowrap" }}>
        {guessedLabel}
      </div>
    </div>
  ) : (
    <div data-testid="gartic-reveal" style={{ textAlign: "center", marginBottom: 14 }}>
      <div style={{ font: `700 10px ${MONO}`, letterSpacing: ".35em", color: HUE }}>{t("gartic.wordWas")}</div>
      <div
        data-testid="gartic-revealed-word"
        style={{ fontFamily: "'Alfa Slab One'", fontSize: "clamp(28px, 6vw, 44px)", lineHeight: 1.1, color: "#ffe9a8", textShadow: "0 4px 0 #c2452d", overflowWrap: "anywhere" }}
      >
        {word}
      </div>
      <div style={{ font: `600 11px ${MONO}`, color: CAPTION, marginTop: 6 }}>
        {guessed.length === 0
          ? t("gartic.nobodyGotIt", { name: nameOf(drawer) })
          : t("gartic.drewIt", { name: nameOf(drawer), n: guessed.length })}
      </div>
    </div>
  );

  const graceEnd = drawing ? publicState?.graceEnd : undefined;
  const drawerAway = drawing && !playerById.get(drawer)?.connected;
  const graceBanner = graceEnd ? (
    <div
      data-testid="gartic-grace"
      style={{ background: "rgba(255,157,63,.12)", border: "2px solid #ff9d3f", borderRadius: 12, padding: "8px 12px", font: `700 11px ${MONO}`, color: "#ff9d3f", marginBottom: 10, textAlign: "center" }}
    >
      {drawerAway ? t("gartic.drawerAway", { name: nameOf(drawer) }) : t("gartic.waitingGuessers")}
    </div>
  ) : null;

  // The canvas keeps its place in the tree across drawing -> turnResults so
  // the finished drawing stays up during the reveal; a new turn remounts it.
  const canvasReadOnly = !isDrawer || !drawing;
  const center = (
    <div data-testid="gartic-canvas" style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
      {wordRow}
      {graceBanner}
      <DrawingCanvas
        key={turnKey}
        ref={canvasRef}
        aspect="landscape"
        hue={isDrawer && drawing ? HUE : "#5a3f7a"}
        readOnly={canvasReadOnly}
        onStrokeBatch={canvasReadOnly ? undefined : handleStroke}
        onMount={onCanvasMount}
        fitHeight={drawing}
        reserveBelow={layout === "narrow" && !isDrawer ? 64 : 0}
      />
    </div>
  );

  const howTo = (
    <HowToPlayModal open={showHowTo} gameType="gartic" gameName="GARTIC" stepCount={3} onClose={() => setShowHowTo(false)} />
  );

  // ONE tree for every layout: the pieces keep their slots and only the
  // grid placement changes, so crossing a breakpoint (or a scrollbar
  // toggling near one) never remounts the canvas and wipes the drawing.
  const grid: Record<Layout, CSSProperties> = {
    narrow: {
      gridTemplateColumns: "minmax(0, 1fr)",
      gridTemplateAreas: '"center" "form" "chat" "board"',
      rowGap: 14,
      padding: "12px 0 20px",
      alignItems: "start",
    },
    mid: {
      gridTemplateColumns: "minmax(0, 1fr) clamp(220px, calc((100% - 18px) / 2.6), 320px)",
      gridTemplateRows: "auto auto auto 1fr",
      gridTemplateAreas: '"center chat" "center form" "center board" "center ."',
      columnGap: 18,
      rowGap: 10,
      padding: "16px 0 24px",
      alignItems: "start",
    },
    wide: {
      gridTemplateColumns: "230px minmax(0, 1fr) minmax(0, min(340px, calc((100% - 278px) / 2.6)))",
      gridTemplateRows: "minmax(0, 1fr) auto",
      gridTemplateAreas: '"board center chat" "board center form"',
      columnGap: 24,
      rowGap: 10,
      padding: "22px 0 30px",
      alignItems: "stretch",
    },
  };
  const wide = layout === "wide";

  return (
    <div ref={rootRef} data-testid="gartic-root" data-layout={layout} style={{ display: "grid", minWidth: 0, ...grid[layout] }}>
      {howTo}
      <div style={{ gridArea: "center", minWidth: 0 }}>{center}</div>
      <div style={{ gridArea: "form", minWidth: 0, display: guessForm || drawerNote ? undefined : "none" }}>
        {guessForm}
        {drawerNote}
      </div>
      {/* Wide: the chat cell is absolutely filled so a long chat never makes
          the row taller than the canvas column — it scrolls inside instead. */}
      <div style={{ gridArea: "chat", minWidth: 0, position: "relative", minHeight: wide ? 300 : undefined }}>
        <div style={wide ? { position: "absolute", inset: 0, display: "flex", flexDirection: "column" } : undefined}>
          <SectionLabel>{t("gartic.chat.title")}</SectionLabel>
          {chatBox}
        </div>
      </div>
      <div style={{ gridArea: "board", minWidth: 0, alignSelf: "start" }}>{scoreboard}</div>
    </div>
  );
}
