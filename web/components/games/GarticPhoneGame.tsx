"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useI18n } from "@/lib/i18n";
import { HowToPlayModal } from "../ui";
import { Avatar } from "../ui/PlayerChip";
import { DrawingCanvas, type DrawingCanvasHandle } from "../DrawingCanvas";
import { playerColorFor } from "../ui/gameHues";
import { playSfx } from "@/lib/sfx";
import type { Player } from "@/lib/protocol";
import type { GameProps } from "./types";

// ---------------------------------------------------------------------------
// Wire types (server: internal/games/garticphone.go)
// ---------------------------------------------------------------------------

type GarticPhoneEntry = {
  author: string;
  kind: "text" | "drawing";
  text?: string;
  /** Empty for a drawing step the author never submitted (auto-filled blank). */
  dataUrl?: string;
};

type GarticPhoneChain = {
  starter: string;
  /** Full chain length — entries only holds the revealed prefix. */
  length: number;
  entries: GarticPhoneEntry[];
};

type GarticPhonePublicState = {
  phase: "prompt" | "drawing" | "writing" | "reveal";
  step: number;
  totalSteps: number;
  turnOrder: string[];
  scores: Record<string, number>;
  deadline?: number;
  /** deadline - server now, at broadcast time: skew-free countdown anchor. */
  remainingMs?: number;
  submitted?: string[];
  /** Chain on screen during the reveal. */
  revealChain?: number;
  /** COUNT of revealChain's entries revealed (newest = revealPos - 1). */
  revealPos?: number;
  /** Last chain fully shown: the host's next press is FINISH. */
  revealDone?: boolean;
  likes?: Record<string, number>;
  reactions?: Record<string, Record<string, number>>;
  chains?: GarticPhoneChain[];
};

type GarticPhonePrivateState = {
  submitted?: boolean;
  chain?: number;
  prevEntry?: GarticPhoneEntry;
  /** Joined after the chains were dealt: watches, reacts in the reveal. */
  spectator?: boolean;
  /** "chain|entry" -> emoji this player reacted with. */
  myReactions?: Record<string, string>;
};

const EMOJIS = ["😂", "💀", "⭐"] as const;
type Emoji = (typeof EMOJIS)[number];

const MAX_CHARS = 200;
/** Submit unsent work this long before the server deadline commits the step. */
const AUTO_SUBMIT_LEAD_MS = 2000;
/** Lead used instead when drafting starts inside the normal lead window. */
const LATE_LEAD_MS = 500;

// Design tokens (Gemu System · G. PHONE hue).
const HUE = "var(--hue-garticphone)";
const HUE_HEX = "#b78bff";
const HUE_GRAD = "linear-gradient(180deg,#c9a4ff,#a678f2)";
const HUE_INK = "#2d1650";
const HUE_DROP = "#5f3d99";
const CREAM = "#fff8e7";

type StepClock = { deadline?: number; remainingMs?: number };

/** Fires `fire` AUTO_SUBMIT_LEAD_MS before the step deadline, while enabled.
 *  The deadline is anchored to THIS device's clock from the server's
 *  remainingMs when each state arrives (server/client clock skew can't make
 *  it fire early); the epoch `deadline` is only a fallback. Drafting that
 *  starts inside the lead window waits until LATE_LEAD_MS before the
 *  deadline instead of submitting the first keystroke/stroke right away. */
function useAutoSubmit(clock: StepClock, enabled: boolean, fire: () => void) {
  const { deadline, remainingMs } = clock;
  const fireRef = useRef(fire);
  useEffect(() => {
    fireRef.current = fire;
  });
  const deadlineAt = useRef<number | null>(null);
  useEffect(() => {
    if (typeof remainingMs === "number") deadlineAt.current = Date.now() + remainingMs;
    else deadlineAt.current = deadline ?? null;
  }, [deadline, remainingMs]);
  useEffect(() => {
    const at = deadlineAt.current;
    if (!enabled || at === null) return;
    const remaining = at - Date.now();
    const lead = remaining > AUTO_SUBMIT_LEAD_MS + LATE_LEAD_MS ? AUTO_SUBMIT_LEAD_MS : LATE_LEAD_MS;
    const id = setTimeout(() => fireRef.current(), Math.max(0, remaining - lead));
    return () => clearTimeout(id);
  }, [deadline, remainingMs, enabled]);
}

// ---------------------------------------------------------------------------
// Small presentational pieces
// ---------------------------------------------------------------------------

const eyebrow: CSSProperties = {
  font: "700 11px var(--font-mono), monospace",
  letterSpacing: ".22em",
  textTransform: "uppercase",
  color: HUE,
};

const label: CSSProperties = {
  font: "700 10px var(--font-mono), monospace",
  letterSpacing: ".2em",
  textTransform: "uppercase",
  color: "var(--ink-dim)",
};

function LockButton({
  children,
  disabled,
  onClick,
  testId,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      className="buzzer w-full"
      disabled={disabled}
      onClick={() => {
        playSfx("buzzer");
        onClick();
      }}
      style={{
        fontSize: 15,
        color: HUE_INK,
        background: HUE_GRAD,
        padding: "13px 16px",
        ["--buzzer-drop" as string]: HUE_DROP,
      }}
    >
      {children}
    </button>
  );
}

function TextDraft({
  value,
  onChange,
  onSubmit,
  placeholder,
  testId,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  testId: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="relative">
      <textarea
        data-testid={testId}
        value={value}
        maxLength={MAX_CHARS}
        autoFocus={autoFocus}
        rows={2}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSubmit();
          }
        }}
        placeholder={placeholder}
        className="block w-full resize-none rounded-xl px-3 py-3 outline-none placeholder:text-(--ink-faint)"
        style={{
          background: "var(--bg)",
          border: `2px solid ${HUE}`,
          boxShadow: "0 0 0 4px rgba(183,139,255,.12)",
          font: "600 15px var(--font-sans), sans-serif",
          color: "var(--ink)",
          minHeight: 64,
        }}
      />
      <span
        className="pointer-events-none absolute right-3 bottom-2"
        style={{
          font: "400 10px var(--font-mono), monospace",
          color: "var(--ink-faint)",
        }}
      >
        {value.length}/{MAX_CHARS}
      </span>
    </div>
  );
}

/** A drawing on cream paper, or a placeholder when the step was auto-filled blank. */
function DrawingFrame({
  dataUrl,
  alt,
  blankLabel,
  style,
  border = `3px solid ${HUE}`,
  testId,
}: {
  dataUrl?: string;
  alt: string;
  blankLabel: string;
  style?: CSSProperties;
  border?: string;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex items-center justify-center overflow-hidden"
      style={{ background: CREAM, border, borderRadius: 16, ...style }}
    >
      {dataUrl ? (
        // Player drawings are data: URLs — next/image adds nothing here.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={dataUrl} alt={alt} className="h-full w-full object-contain" />
      ) : (
        <span
          className="px-4 text-center"
          style={{
            font: "700 11px var(--font-mono), monospace",
            letterSpacing: ".15em",
            color: "#8a7f60",
          }}
        >
          {blankLabel}
        </span>
      )}
    </div>
  );
}

function PlayerDot({
  player,
  index,
  size = 30,
}: {
  player?: Player;
  index: number;
  size?: number;
}) {
  const color = playerColorFor(index >= 0 ? index : 0);
  if (player) return <Avatar player={player} color={color} size={size} />;
  return (
    <div
      className="flex-none rounded-full"
      style={{
        width: size,
        height: size,
        background: CREAM,
        border: `2px solid ${color}`,
      }}
    />
  );
}

/** turnOrder of the game whose auto how-to was already dismissed. */
let howToSeenFor = "";

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export function GarticPhoneGame(props: GameProps) {
  const { t } = useI18n();
  const pub = (props.publicState ?? {}) as Partial<GarticPhonePublicState>;
  const priv = (props.privateState ?? {}) as GarticPhonePrivateState;

  const phase = pub.phase ?? "prompt";
  const step = pub.step ?? 0;
  // Auto-open the how-to once per game: a remount (layout change, reconnect)
  // must not pop it again over a half-typed prompt.
  const gameKey = (pub.turnOrder ?? []).join(",");
  const [showHowTo, setShowHowTo] = useState(
    step === 0 && phase === "prompt" && howToSeenFor !== gameKey,
  );
  const closeHowTo = () => {
    howToSeenFor = gameKey;
    setShowHowTo(false);
  };

  const nameOf = useCallback(
    (id: string | undefined) =>
      props.players.find((p) => p.id === id)?.name ?? t("garticphone.someone"),
    [props.players, t],
  );

  let body: ReactNode;
  if (phase === "reveal") {
    body = <RevealPhase {...props} pub={pub} priv={priv} nameOf={nameOf} />;
  } else if (priv.spectator) {
    body = <SpectatorPanel />;
  } else if (priv.submitted) {
    body = <WaitingPanel pub={pub} players={props.players} />;
  } else if (phase === "prompt") {
    body = (
      <PromptPhase
        key="prompt"
        sendAction={props.sendAction}
        clock={{ deadline: pub.deadline, remainingMs: pub.remainingMs }}
      />
    );
  } else if (phase === "drawing") {
    // Keyed by step: with ≥5 players there are several drawing steps and the
    // canvas/draft must start fresh each time.
    body = (
      <DrawPhase
        key={`draw-${step}`}
        sendAction={props.sendAction}
        clock={{ deadline: pub.deadline, remainingMs: pub.remainingMs }}
        prev={priv.prevEntry}
        nameOf={nameOf}
      />
    );
  } else {
    body = (
      <WritePhase
        key={`write-${step}`}
        sendAction={props.sendAction}
        clock={{ deadline: pub.deadline, remainingMs: pub.remainingMs }}
        prev={priv.prevEntry}
        nameOf={nameOf}
      />
    );
  }

  return (
    <div
      data-testid="garticphone-root"
      data-phase={phase}
      className="mx-auto w-full min-w-0"
      style={{ maxWidth: phase === "reveal" ? 760 : 560 }}
    >
      <HowToPlayModal
        open={showHowTo}
        gameType="garticphone"
        gameName="GARTIC PHONE"
        stepCount={4}
        onClose={closeHowTo}
      />
      {phase !== "reveal" && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <span
            data-testid="garticphone-step"
            style={{
              font: "700 11px var(--font-mono), monospace",
              letterSpacing: ".15em",
              color: HUE_INK,
              background: HUE,
              borderRadius: 8,
              padding: "3px 9px",
            }}
          >
            {t("garticphone.step", { n: step + 1, total: pub.totalSteps ?? 1 })}
          </span>
          <StepDots step={step} total={pub.totalSteps ?? 1} />
        </div>
      )}
      {body}
    </div>
  );
}

function StepDots({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex flex-wrap justify-end gap-1" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          style={{
            width: 8,
            height: 8,
            borderRadius: 99,
            background: i <= step ? HUE : "var(--line)",
            boxShadow: i === step ? `0 0 8px ${HUE}` : "none",
          }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Write / draw / describe phases
// ---------------------------------------------------------------------------

type SendAction = GameProps["sendAction"];

function PromptPhase({
  sendAction,
  clock,
}: {
  sendAction: SendAction;
  clock: StepClock;
}) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const submit = () => {
    const trimmed = text.trim();
    if (trimmed) sendAction({ action: "submit_prompt", text: trimmed });
  };
  useAutoSubmit(clock, text.trim() !== "", submit);

  return (
    <div className="flex flex-col gap-3">
      <div className="text-center" style={eyebrow}>
        {t("garticphone.promptEyebrow")}
      </div>
      <div className="slab text-center text-[clamp(20px,5vw,28px)] leading-tight [@media(max-height:520px)]:hidden">
        {t("garticphone.promptTitle")}
      </div>
      <div>
        <div style={{ ...label, marginBottom: 5 }}>
          {t("garticphone.promptLabel")}
        </div>
        <TextDraft
          testId="garticphone-prompt-input"
          value={text}
          onChange={setText}
          onSubmit={submit}
          placeholder={t("garticphone.promptPlaceholder")}
          autoFocus
        />
      </div>
      <LockButton
        testId="garticphone-prompt-submit"
        disabled={!text.trim()}
        onClick={submit}
      >
        {t("garticphone.lockIn")}
      </LockButton>
      <AutoHint />
    </div>
  );
}

function AutoHint() {
  const { t } = useI18n();
  return (
    <div
      className="text-center [@media(max-height:520px)]:hidden"
      style={{
        font: "400 10px var(--font-mono), monospace",
        color: "var(--ink-faint)",
      }}
    >
      {t("garticphone.autoSubmitHint")}
    </div>
  );
}

function DrawPhase({
  sendAction,
  clock,
  prev,
  nameOf,
}: {
  sendAction: SendAction;
  clock: StepClock;
  prev?: GarticPhoneEntry;
  nameOf: (id?: string) => string;
}) {
  const { t } = useI18n();
  const canvasRef = useRef<DrawingCanvasHandle | null>(null);
  const [hasDrawn, setHasDrawn] = useState(false);

  const onChange = useCallback(() => setHasDrawn(true), []);

  const submit = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn) return;
    // ≤640px long side, webp (jpeg fallback), ≤~150KB — server cap is 200KB.
    const draw =
      canvas.exportCompressed?.() ?? canvas.toDataURL("image/jpeg", 0.8);
    sendAction({ action: "submit_drawing", draw });
  };
  useAutoSubmit(clock, hasDrawn, submit);

  const prompt = prev?.kind === "text" ? prev.text : undefined;

  return (
    <div className="flex flex-col gap-3">
      <div
        className="text-center [@media(max-height:520px)]:hidden"
        style={eyebrow}
      >
        {t("garticphone.drawEyebrow", { name: nameOf(prev?.author) })}
      </div>
      <div
        data-testid="garticphone-draw-prompt"
        className="mx-auto max-w-full text-center"
        style={{
          background: HUE_GRAD,
          color: HUE_INK,
          borderRadius: 14,
          padding: "10px 16px",
          boxShadow: `0 5px 0 ${HUE_DROP}`,
          font: "700 clamp(15px,3.6vw,19px) var(--font-sans), sans-serif",
          overflowWrap: "anywhere",
        }}
      >
        “{prompt ?? "…"}”
      </div>
      <DrawingCanvas
        ref={canvasRef}
        onChange={onChange}
        aspect="landscape"
        hue={HUE_HEX}
        fitHeight
        reserveBelow={84}
      />
      <LockButton
        testId="garticphone-submit-drawing"
        disabled={!hasDrawn}
        onClick={submit}
      >
        {t("garticphone.lockIn")}
      </LockButton>
      <AutoHint />
    </div>
  );
}

function WritePhase({
  sendAction,
  clock,
  prev,
  nameOf,
}: {
  sendAction: SendAction;
  clock: StepClock;
  prev?: GarticPhoneEntry;
  nameOf: (id?: string) => string;
}) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const submit = () => {
    const trimmed = text.trim();
    if (trimmed) sendAction({ action: "submit_description", text: trimmed });
  };
  useAutoSubmit(clock, text.trim() !== "", submit);

  const blank = !prev?.dataUrl;
  return (
    <div className="flex flex-col gap-3">
      <div className="text-center" style={eyebrow}>
        {t("garticphone.describeEyebrow", { name: nameOf(prev?.author) })}
      </div>
      <DrawingFrame
        testId="garticphone-describe-drawing"
        dataUrl={prev?.dataUrl}
        alt={t("garticphone.drawingAlt", { name: nameOf(prev?.author) })}
        blankLabel={t("garticphone.blankDrawingHint")}
        style={{
          height: "clamp(150px, calc(100dvh - 380px), 290px)",
          boxShadow: "0 5px 0 rgba(0,0,0,.35)",
        }}
      />
      <div>
        <div style={{ ...label, marginBottom: 5 }}>
          {t("garticphone.descriptionLabel")}
        </div>
        <TextDraft
          testId="garticphone-description-input"
          value={text}
          onChange={setText}
          onSubmit={submit}
          placeholder={
            blank
              ? t("garticphone.blankDescribePlaceholder")
              : t("garticphone.descriptionPlaceholder")
          }
        />
      </div>
      <LockButton
        testId="garticphone-description-submit"
        disabled={!text.trim()}
        onClick={submit}
      >
        {t("garticphone.lockIn")}
      </LockButton>
      <AutoHint />
    </div>
  );
}

function WaitingPanel({
  pub,
  players,
}: {
  pub: Partial<GarticPhonePublicState>;
  players: Player[];
}) {
  const { t } = useI18n();
  const roster = pub.turnOrder ?? [];
  const done = new Set(pub.submitted ?? []);
  const doneCount = roster.filter((id) => done.has(id)).length;
  return (
    <div
      data-testid="garticphone-waiting"
      className="flex flex-col items-center gap-4 rounded-2xl px-4 py-6 text-center"
      style={{ background: "var(--panel)", border: "2px solid var(--line)" }}
    >
      <div
        className="slab animate-slam text-[clamp(22px,6vw,32px)]"
        style={{ color: HUE }}
      >
        {t("garticphone.lockedIn")}
      </div>
      <div style={label}>
        {t("garticphone.waitingCount", {
          done: doneCount,
          total: roster.length,
        })}
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        {roster.map((id) => {
          const idx = players.findIndex((p) => p.id === id);
          const player = players[idx];
          const ok = done.has(id);
          return (
            <div
              key={id}
              className="flex flex-col items-center gap-1"
              style={{ opacity: ok ? 1 : 0.45 }}
            >
              <div className="relative">
                <PlayerDot player={player} index={idx} size={40} />
                {ok && (
                  <span
                    className="absolute -right-1 -bottom-1 flex items-center justify-center rounded-full"
                    style={{
                      width: 18,
                      height: 18,
                      background: HUE,
                      color: HUE_INK,
                      font: "700 11px var(--font-sans)",
                    }}
                  >
                    ✓
                  </span>
                )}
              </div>
              <span
                className="max-w-16 truncate"
                style={{
                  font: "600 11px var(--font-sans)",
                  color: "var(--ink-dim)",
                }}
              >
                {player?.name ?? "?"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SpectatorPanel() {
  const { t } = useI18n();
  return (
    <div
      data-testid="garticphone-spectator"
      className="flex flex-col items-center gap-2 rounded-2xl px-4 py-8 text-center"
      style={{ background: "var(--panel)", border: `2px dashed ${HUE}` }}
    >
      <div className="slab text-[clamp(20px,5vw,28px)]" style={{ color: HUE }}>
        {t("garticphone.spectatorTitle")}
      </div>
      <div
        className="max-w-sm"
        style={{ font: "500 14px var(--font-sans)", color: "var(--ink-dim)" }}
      >
        {t("garticphone.spectatorBody")}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The reveal — the money screen
// ---------------------------------------------------------------------------

function RevealPhase({
  pub,
  priv,
  players,
  playerId,
  isAdmin,
  sendAction,
  nameOf,
}: GameProps & {
  pub: Partial<GarticPhonePublicState>;
  priv: GarticPhonePrivateState;
  nameOf: (id?: string) => string;
}) {
  const { t } = useI18n();
  const chains = pub.chains ?? [];
  const chainIdx = Math.min(
    pub.revealChain ?? 0,
    Math.max(0, chains.length - 1),
  );
  const chain = chains[chainIdx];
  const entries = chain?.entries ?? [];
  const newest = entries.length - 1;
  const newestKey = `${chainIdx}|${newest}`;
  const reactions = pub.reactions ?? {};
  const revealDone =
    pub.revealDone ??
    (chainIdx >= chains.length - 1 &&
      !!chain &&
      entries.length >= chain.length);
  const chainDone = !!chain && entries.length >= chain.length;

  // Optimistic local picks so the pill lights up before the state round-trip.
  const [localPicks, setLocalPicks] = useState<Record<string, string>>({});
  const picks = { ...localPicks, ...(priv.myReactions ?? {}) };
  const myPick = picks[newestKey];
  const newestEntry = entries[newest];
  const ownEntry = newestEntry?.author === playerId;

  const react = (emoji: Emoji) => {
    if (newest < 0 || myPick || ownEntry) return;
    setLocalPicks((prev) => ({ ...prev, [newestKey]: emoji }));
    playSfx("click");
    sendAction({ action: "react", chain: chainIdx, entry: newest, emoji });
  };

  // Keep the newest card and the reaction/host controls in view as the
  // chain grows (small iframe tiles, phones). Controls win when both don't fit.
  const newestRef = useRef<HTMLDivElement | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    newestRef.current?.scrollIntoView({ block: "nearest" });
    controlsRef.current?.scrollIntoView({ block: "nearest" });
  }, [newestKey]);

  let nextLabel = t("garticphone.next");
  if (revealDone) nextLabel = t("garticphone.finish");
  else if (chainDone) nextLabel = t("garticphone.nextChain");

  return (
    <div
      data-testid="garticphone-reveal"
      data-chain={chainIdx}
      data-revealed={entries.length}
      className="rounded-3xl px-3 pt-4 pb-4 sm:px-5"
      style={{
        background:
          "radial-gradient(ellipse at 50% -10%, rgba(183,139,255,.25), transparent 55%)",
      }}
    >
      {/* Chain header */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0" key={chainIdx}>
          <div style={{ ...eyebrow, fontSize: 10, letterSpacing: ".3em" }}>
            {t("garticphone.revealEyebrow", {
              n: chainIdx + 1,
              total: chains.length,
            })}
          </div>
          <div
            className="animate-rise truncate"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "clamp(18px,4.5vw,24px)",
              color: "var(--ink)",
              textTransform: "uppercase",
            }}
          >
            {t("garticphone.chainOf", { name: nameOf(chain?.starter) })}
          </div>
        </div>
        <div className="flex gap-1" data-testid="garticphone-reveal-dots">
          {Array.from({ length: chain?.length ?? 0 }, (_, i) => (
            <span
              key={i}
              style={{
                width: 9,
                height: 9,
                borderRadius: 99,
                background: i <= newest ? HUE : "var(--line)",
                boxShadow: i === newest ? `0 0 8px ${HUE}` : "none",
              }}
            />
          ))}
        </div>
      </div>

      {/* Entries */}
      <div className="mb-4 flex flex-col gap-3">
        {entries.map((entry, idx) => {
          const isLatest = idx === newest;
          const authorIdx = players.findIndex((p) => p.id === entry.author);
          const name = nameOf(entry.author);
          const opacity = isLatest ? 1 : idx === newest - 1 ? 0.8 : 0.6;
          const key = `${chainIdx}|${idx}`;
          const counts = reactions[key] ?? {};
          const total = Object.values(counts).reduce((a, b) => a + b, 0);
          let caption: string;
          if (entry.kind === "drawing")
            caption = t("garticphone.drewIt", { name });
          else if (idx === 0) caption = t("garticphone.wrote", { name });
          else caption = t("garticphone.sawAndWrote", { name });

          return (
            <div
              key={key}
              ref={isLatest ? newestRef : undefined}
              data-testid={isLatest ? "garticphone-reveal-newest" : undefined}
              className="flex items-start gap-2.5"
              style={{ opacity, transition: "opacity .3s" }}
            >
              <PlayerDot
                player={players[authorIdx]}
                index={authorIdx}
                size={32}
              />
              <div className="min-w-0 flex-1">
                {entry.kind === "text" ? (
                  <div
                    style={{
                      background: isLatest ? HUE_GRAD : "var(--panel)",
                      border: `2px solid ${isLatest ? "transparent" : "var(--line)"}`,
                      borderRadius: "4px 14px 14px 14px",
                      padding: isLatest ? "10px 13px" : "8px 12px",
                      boxShadow: isLatest ? `0 5px 0 ${HUE_DROP}` : "none",
                      animation: isLatest ? "rise .45s ease-out both" : "none",
                    }}
                  >
                    <div
                      style={{
                        ...label,
                        fontSize: 10,
                        color: isLatest
                          ? "rgba(45,22,80,.65)"
                          : "var(--ink-faint)",
                      }}
                    >
                      {caption}
                    </div>
                    <div
                      style={{
                        font: `${isLatest ? 700 : 600} ${isLatest ? "clamp(16px,3.8vw,20px)" : "14px"} var(--font-sans), sans-serif`,
                        color: isLatest ? HUE_INK : "var(--ink)",
                        overflowWrap: "anywhere",
                      }}
                    >
                      “{entry.text}”
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      animation: isLatest ? "rise .45s ease-out both" : "none",
                    }}
                  >
                    <div
                      style={{
                        ...label,
                        fontSize: 10,
                        color: isLatest ? HUE : "var(--ink-faint)",
                        marginBottom: 4,
                      }}
                    >
                      {caption}
                    </div>
                    <DrawingFrame
                      dataUrl={entry.dataUrl}
                      alt={t("garticphone.drawingAlt", { name })}
                      blankLabel={t("garticphone.blankDrawing")}
                      border={`${isLatest ? 3 : 2}px solid ${isLatest ? HUE : "var(--line)"}`}
                      style={{
                        borderRadius: "4px 14px 14px 14px",
                        height: isLatest
                          ? "clamp(170px, calc(100dvh - 330px), 440px)"
                          : "clamp(90px, 18dvh, 150px)",
                        maxWidth: isLatest
                          ? "calc((100dvh - 330px) * 1.1 + 200px)"
                          : 220,
                        boxShadow: isLatest
                          ? `0 5px 0 ${HUE_DROP}, 0 0 24px rgba(183,139,255,.25)`
                          : "none",
                      }}
                    />
                  </div>
                )}
                {!isLatest && total > 0 && (
                  <div
                    className="mt-1 flex gap-2"
                    style={{
                      font: "700 11px var(--font-mono), monospace",
                      color: "var(--ink-dim)",
                    }}
                  >
                    {EMOJIS.filter((e) => counts[e]).map((e) => (
                      <span key={e}>
                        {e} {counts[e]}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Controls stay pinned to the bottom edge while a long chain scrolls
          (small iframe tiles, phones). */}
      <div
        ref={controlsRef}
        className="sticky bottom-0 z-10 -mx-3 px-3 pt-2 pb-1 sm:-mx-5 sm:px-5"
        style={{
          background:
            "linear-gradient(180deg, rgba(28,18,48,0), var(--bg) 22%)",
        }}
      >
        {/* Reactions on the newest entry */}
        {newest >= 0 && (
          <div className="mb-3 flex flex-wrap justify-center gap-2">
            {EMOJIS.map((emoji) => {
              const count = reactions[newestKey]?.[emoji] ?? 0;
              const chosen = myPick === emoji;
              const disabled = !!myPick || ownEntry;
              return (
                <button
                  key={emoji}
                  type="button"
                  data-testid={`garticphone-react-${emoji === "😂" ? "laugh" : emoji === "💀" ? "skull" : "star"}`}
                  data-chosen={chosen}
                  aria-label={t("garticphone.react", { emoji })}
                  aria-pressed={chosen}
                  onClick={() => react(emoji)}
                  disabled={disabled}
                  className="flex items-center gap-1.5 transition-transform enabled:hover:-translate-y-0.5 enabled:active:translate-y-0.5"
                  style={{
                    fontSize: 20,
                    background: chosen
                      ? "rgba(255,210,63,.12)"
                      : "var(--panel)",
                    border: `2px solid ${chosen ? "var(--accent)" : "var(--line)"}`,
                    borderRadius: 99,
                    padding: "6px 14px",
                    boxShadow: chosen
                      ? "0 0 14px rgba(255,210,63,.35)"
                      : "none",
                    cursor: disabled ? "default" : "pointer",
                    opacity: disabled && !chosen ? 0.55 : 1,
                  }}
                >
                  {emoji}
                  <b
                    style={{
                      font: "700 13px var(--font-mono), monospace",
                      color: chosen ? "var(--accent)" : "var(--ink)",
                    }}
                  >
                    {count}
                  </b>
                </button>
              );
            })}
          </div>
        )}

        {/* Footer: hint + host control */}
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="min-w-[140px] flex-1 text-center"
            style={{
              font: "400 11px/1.5 var(--font-mono), monospace",
              color: "var(--ink-faint)",
              padding: "6px 0",
            }}
          >
            {ownEntry ? t("garticphone.yourEntry") : t("garticphone.reactHint")}
          </div>
          {isAdmin ? (
            <button
              type="button"
              data-testid="garticphone-reveal-next"
              data-finish={revealDone}
              className="buzzer flex-none"
              onClick={() => {
                playSfx("buzzer");
                // Names the cursor it advances, so a double tap is ignored
                // instead of skipping the next entry.
                sendAction({
                  action: "reveal_next",
                  chain: pub.revealChain ?? chainIdx,
                  pos: pub.revealPos ?? entries.length,
                });
              }}
              style={{
                fontSize: 15,
                color: HUE_INK,
                background: HUE_GRAD,
                padding: "12px 20px",
                ["--buzzer-drop" as string]: HUE_DROP,
              }}
            >
              {nextLabel}
            </button>
          ) : (
            <div
              className="flex-none"
              style={{ ...label, color: HUE, padding: "6px 0" }}
            >
              {t("garticphone.waitingHost")}
            </div>
          )}
        </div>
        <div
          className="mt-2 text-center [@media(max-height:520px)]:hidden"
          style={{
            font: "400 10px var(--font-mono), monospace",
            color: "rgba(255,233,168,.3)",
          }}
        >
          {t("garticphone.hostPaces")}
        </div>
      </div>
    </div>
  );
}
