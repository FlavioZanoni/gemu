"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { playSfx } from "@/lib/sfx";
import type { Player } from "@/lib/protocol";
import { HowToPlayModal } from "../ui";
import { Avatar } from "../ui/PlayerChip";
import { playerColorFor } from "../ui/gameHues";
import type { GameProps } from "./types";

type Verdict = "unique" | "duplicate" | "invalid";

type StopPublicState = {
  phase?: "answering" | "validating" | "roundResults";
  round?: number;
  totalRounds?: number;
  letter?: string;
  categories?: string[];
  totalScores?: Record<string, number>;
  deadline?: number;
  /** deadline - server now, at broadcast time (skew-free; answering only). */
  remainingMs?: number;
  stopped?: boolean;
  stoppedBy?: string;
  answersFilled?: Record<string, number>;
  answers?: Record<string, Array<{ playerId: string; answer: string; autoInvalid?: boolean }>>;
  tally?: Record<string, { valid: number; nope: number }>;
  validatedCount?: number;
  requiredCount?: number;
  results?: Record<string, Array<{ playerId: string; answer: string; verdict: Verdict; points: number }>>;
  roundScores?: Record<string, number>;
  final?: boolean;
};

type StopPrivateState = {
  round?: number;
  answers?: Record<string, string>;
  validated?: boolean;
  votes?: Record<string, "valid" | "nonsense">;
  judge?: boolean;
};

type T = (key: string, params?: Record<string, string | number>) => string;

const MONO = "'Space Mono', monospace";
const SLAB = "'Alfa Slab One', serif";
const CORAL_GRAD = "linear-gradient(180deg,#ff6b85,#e84863)";
const YELLOW_GRAD = "linear-gradient(180deg,#ffd23f,#f5b32a)";

/** Whole seconds until `deadline`, re-rendering 4x a second. */
function useSecondsLeft(deadline: number | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    const tick = () => setNow(Date.now());
    // Refresh right away: `now` may be stale from mount time.
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 250);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [deadline]);
  if (!deadline) return null;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

type Roster = {
  byId: Map<string, { player: Player; color: string }>;
  name: (id: string) => string;
};

export function StopGame(props: GameProps) {
  const pub = (props.publicState ?? {}) as StopPublicState;
  const priv = (props.privateState ?? {}) as StopPrivateState;
  const phase = pub.phase ?? "answering";
  const round = pub.round ?? 1;
  const [showHowTo, setShowHowTo] = useState(round === 1 && phase === "answering");

  const roster = useMemo<Roster>(() => {
    const byId = new Map<string, { player: Player; color: string }>();
    props.players.forEach((player, idx) => byId.set(player.id, { player, color: playerColorFor(idx) }));
    return { byId, name: (id: string) => byId.get(id)?.player.name ?? "?" };
  }, [props.players]);

  return (
    <div className="@container w-full min-w-0" data-testid="stop-game" data-phase={phase} data-round={round}>
      <HowToPlayModal
        open={showHowTo}
        gameType="stop"
        gameName="STOP!"
        stepCount={4}
        onClose={() => setShowHowTo(false)}
      />
      {phase === "answering" && <StopFill key={round} {...props} pub={pub} priv={priv} roster={roster} />}
      {phase === "validating" && <StopJudge key={round} {...props} pub={pub} priv={priv} roster={roster} />}
      {phase === "roundResults" && <StopResults key={round} {...props} pub={pub} roster={roster} />}
    </div>
  );
}

const DEBOUNCE_MS = 400;
const GRACE_DEBOUNCE_MS = 100;
const MAX_WAIT_MS = 1500;
const SYNC_RETRY_MS = 2000;
const GRACE_SYNC_RETRY_MS = 1000;
const FLUSH_BEFORE_DEADLINE_MS = 800;
const MAX_ANSWER_RUNES = 60;

/** The server keeps at most 60 runes per answer. */
const clip = (value: string) => Array.from(value).slice(0, MAX_ANSWER_RUNES).join("");

function unsyncedAnswers(
  answers: Record<string, string>,
  server: Record<string, string> | null,
  edited: Set<string>,
) {
  for (const cat of edited) {
    if (clip(answers[cat] ?? "") !== (server?.[cat] ?? "")) return true;
  }
  return false;
}

/** Sends this round's local answers if any edited one isn't echoed yet. */
function flushAnswers(
  live: {
    answers: Record<string, string>;
    serverAnswers: Record<string, string> | null;
    sendAction: GameProps["sendAction"];
  },
  edited: Set<string>,
  lastSentAt: { current: number },
  firstUnsentEditAt: { current: number | null },
) {
  if (!unsyncedAnswers(live.answers, live.serverAnswers, edited)) return;
  // Dropped or not (offline), this counts as an attempt: the echo check
  // re-sends after SYNC_RETRY_MS until the server has the answers.
  live.sendAction({ action: "set_answers", answers: live.answers });
  lastSentAt.current = Date.now();
  firstUnsentEditAt.current = null;
}

type PhaseProps = GameProps & { pub: StopPublicState; priv: StopPrivateState; roster: Roster };

// ───────────────────────── FILL ─────────────────────────

function StopFill({ pub, priv, roster, playerId, players, sendAction }: PhaseProps) {
  const { t } = useI18n();
  const round = pub.round ?? 1;
  const totalRounds = pub.totalRounds ?? 3;
  const letter = pub.letter ?? "?";
  const categories = pub.categories ?? [];
  const stopped = pub.stopped ?? false;
  const stoppedBy = pub.stoppedBy ?? "";
  const totalScores = pub.totalScores ?? {};
  const answersFilled = pub.answersFilled ?? {};
  const secondsLeft = useSecondsLeft(stopped ? pub.deadline : null);

  // This component is keyed by round, so local answers start empty each round.
  // Private state can lag the public one (a new round's public state arrives
  // first), so only hydrate from it once it is for THIS round — e.g. a refresh
  // mid-round brings back what the server already has.
  const privForRound = priv.round === round;
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    privForRound ? { ...(priv.answers ?? {}) } : {},
  );
  const [hydrated, setHydrated] = useState(privForRound);
  if (!hydrated && privForRound) {
    setHydrated(true);
    setAnswers((prev) => ({ ...(priv.answers ?? {}), ...prev }));
  }

  const [hint, setHint] = useState(false);

  // ── Answer sync ──
  // A category stays "unsynced" until the server's private answers echo the
  // local text back — a set_answers can be dropped (offline, reconnecting),
  // so a send alone never marks it clean. Only categories edited here are
  // compared, so an unhydrated field is never overwritten.
  const serverAnswers = privForRound ? (priv.answers ?? {}) : null;
  const edited = useRef<Set<string>>(new Set());
  const lastEditAt = useRef(0);
  const firstUnsentEditAt = useRef<number | null>(null);
  const lastSentAt = useRef(0);
  const deadlineAt = useRef<number | null>(null);
  const live = useRef({ answers, serverAnswers, sendAction });
  useEffect(() => {
    live.current = { answers, serverAnswers, sendAction };
  });
  const [, setSyncTick] = useState(0);

  // Anchor the round deadline to this device's clock when each state lands.
  const remainingMs = pub.remainingMs;
  const deadline = pub.deadline;
  useEffect(() => {
    if (typeof remainingMs === "number") deadlineAt.current = Date.now() + remainingMs;
    else deadlineAt.current = deadline ?? null;
  }, [remainingMs, deadline]);

  // Sync policy, re-evaluated every render: debounce typing (400ms, 100ms in
  // the STOP grace), but send at least every 1.5s while typing, flush right
  // before the deadline, and re-send if no echo arrived within 2s.
  useEffect(() => {
    if (!unsyncedAnswers(live.current.answers, live.current.serverAnswers, edited.current)) return;
    const now = Date.now();
    const sentSinceEdit = lastSentAt.current >= lastEditAt.current;
    let due: number;
    if (sentSinceEdit) {
      due = lastSentAt.current + (stopped ? GRACE_SYNC_RETRY_MS : SYNC_RETRY_MS);
    } else {
      due = lastEditAt.current + (stopped ? GRACE_DEBOUNCE_MS : DEBOUNCE_MS);
      if (firstUnsentEditAt.current !== null) due = Math.min(due, firstUnsentEditAt.current + MAX_WAIT_MS);
      if (deadlineAt.current !== null) due = Math.min(due, deadlineAt.current - FLUSH_BEFORE_DEADLINE_MS);
    }
    const id = setTimeout(() => {
      flushAnswers(live.current, edited.current, lastSentAt, firstUnsentEditAt);
      setSyncTick((n) => n + 1);
    }, Math.max(0, due - now));
    return () => clearTimeout(id);
  });

  // STOP was called: the round closes in seconds — flush now. Unmount (phase
  // flip, leaving) flushes too; the server ignores it once answering is over.
  useEffect(() => {
    if (stopped) flushAnswers(live.current, edited.current, lastSentAt, firstUnsentEditAt);
  }, [stopped]);
  useEffect(() => {
    const editedNow = edited.current;
    return () => flushAnswers(live.current, editedNow, lastSentAt, firstUnsentEditAt);
  }, []);

  // Slam sting once per round when someone calls STOP.
  useEffect(() => {
    if (stopped) playSfx("buzzer");
  }, [stopped]);

  const filledCount = categories.filter((cat) => answers[cat]?.trim()).length;
  const allAnswered = categories.length > 0 && filledCount === categories.length;

  const handleChange = (category: string, value: string) => {
    edited.current.add(category);
    const now = Date.now();
    lastEditAt.current = now;
    if (firstUnsentEditAt.current === null) firstUnsentEditAt.current = now;
    setHint(false);
    setAnswers((prev) => ({ ...prev, [category]: value }));
  };

  const handleStop = () => {
    if (stopped) return;
    if (!allAnswered) {
      setHint(true);
      return;
    }
    // Flush pending keystrokes first so the server sees a complete form.
    lastSentAt.current = Date.now();
    firstUnsentEditAt.current = null;
    sendAction({ action: "set_answers", answers });
    sendAction({ action: "stop" });
  };

  const board = players.map((player) => {
    const color = roster.byId.get(player.id)?.color ?? playerColorFor(0);
    const me = player.id === playerId;
    const filled = me ? filledCount : (answersFilled[player.id] ?? 0);
    const total = categories.length;
    let state = t("stop.state.thinking");
    let stateColor = "rgba(255,233,168,.4)";
    if (stopped && stoppedBy === player.id) {
      state = t("stop.state.slammed");
      stateColor = "#ff8a9b";
    } else if (me) {
      state = `${filled}/${total}`;
      stateColor = "#35d4b9";
    } else if (total > 0 && filled >= total) {
      state = t("stop.state.done");
      stateColor = "#35d4b9";
    } else if (total > 0 && filled >= total - 2) {
      state = t("stop.state.almost");
      stateColor = "#ffd23f";
    } else if (filled > 0) {
      state = t("stop.state.filling");
    }
    return { player, color, me, state, stateColor, pts: totalScores[player.id] ?? 0 };
  });

  const slammer = roster.byId.get(stoppedBy);
  const slammerName = stoppedBy === playerId ? t("stop.you") : roster.name(stoppedBy);

  return (
    <>
      {stopped && (
        <SlamFlash
          name={slammerName}
          slammer={slammer}
          seconds={secondsLeft}
          t={t}
        />
      )}
      <div className="flex flex-col gap-5 py-3 [@media(max-height:560px)]:py-1 @3xl:flex-row @3xl:gap-[34px] @3xl:pt-[30px] @3xl:pb-10">
        <div className="min-w-0 @3xl:flex-[1.5]">
          {/* Letter tile + progress */}
          <div className="mb-4 flex items-center gap-3 @md:gap-4 @3xl:mb-5 [@media(max-height:560px)]:mb-2">
            <div
              data-testid="stop-letter"
              className="flex h-14 w-14 flex-none items-center justify-center rounded-2xl text-[34px] @md:h-[78px] @md:w-[78px] @md:rounded-[20px] @md:text-[46px] [@media(max-height:560px)]:h-11 [@media(max-height:560px)]:w-11 [@media(max-height:560px)]:rounded-xl [@media(max-height:560px)]:text-[28px]"
              style={{ background: YELLOW_GRAD, boxShadow: "0 6px 0 #c2452d", fontFamily: SLAB, color: "#3d1f0e" }}
            >
              {letter}
            </div>
            <div className="min-w-0">
              <div
                className="text-[10px] font-bold uppercase @md:text-[11px]"
                style={{ fontFamily: MONO, letterSpacing: ".3em", color: "rgba(255,233,168,.5)" }}
              >
                {t("stop.startsWith")}
              </div>
              <div className="text-[15px] font-semibold text-(--ink) @md:text-base" data-testid="stop-filled">
                {t(allAnswered ? "stop.filledReady" : "stop.filledKeepGoing", {
                  n: filledCount,
                  total: categories.length,
                })}
              </div>
            </div>
          </div>

          {/* Category rows */}
          <div className="grid grid-cols-1 gap-2 @xl:grid-cols-2 @xl:gap-[11px] @3xl:grid-cols-1 [@media(max-height:560px)]:gap-1.5">
            {categories.map((category, idx) => {
              const hasAnswer = !!answers[category]?.trim();
              return (
                <label
                  key={category}
                  className={`flex min-w-0 items-center gap-3 rounded-[14px] border-2 bg-(--panel) px-3 py-0.5 @md:gap-3.5 @md:px-[18px] @md:py-1.5 [@media(max-height:560px)]:py-0 ${
                    hasAnswer ? "border-[#35d4b9]" : "border-(--line) focus-within:border-(--hue-stop)"
                  }`}
                >
                  <span
                    className="w-[78px] flex-none text-[10px] font-bold uppercase leading-tight @md:w-[110px] @md:text-[11px]"
                    style={{ fontFamily: MONO, color: "rgba(255,233,168,.5)" }}
                  >
                    {category}
                  </span>
                  <input
                    type="text"
                    value={answers[category] ?? ""}
                    onChange={(e) => handleChange(category, e.target.value)}
                    placeholder={`${letter}…`}
                    maxLength={60}
                    autoComplete="off"
                    autoCapitalize="words"
                    enterKeyHint="next"
                    data-testid={`stop-answer-${idx}`}
                    className="min-w-0 flex-1 bg-transparent py-2.5 text-base font-semibold text-(--ink) outline-none placeholder:text-(--ink)/30 @md:py-[13px] @md:text-[17px] [@media(max-height:560px)]:py-1.5"
                  />
                  <span className="w-4 flex-none text-[15px] text-[#35d4b9]">{hasAnswer ? "✓" : ""}</span>
                </label>
              );
            })}
          </div>

          {/* STOP — sticks to the bottom of small viewports so it's always reachable */}
          <div
            className="sticky bottom-0 z-10 -mx-1 mt-3 px-1 pt-2 pb-2 @3xl:mt-5"
            style={{ background: "linear-gradient(180deg, rgba(28,18,48,0), #1c1230 30%)" }}
          >
            {stopped ? (
              <div
                data-testid="stop-grace"
                className="flex items-center justify-center gap-3 rounded-[20px] px-4 py-3 text-white @md:py-4"
                style={{ background: CORAL_GRAD, boxShadow: "0 7px 0 #8f1f33" }}
              >
                <span className="min-w-0 text-center">
                  <span className="block text-[11px] font-bold uppercase" style={{ fontFamily: MONO, letterSpacing: ".2em" }}>
                    🛑 {t("stop.slammed", { name: slammerName })}
                  </span>
                  <span className="block text-sm font-semibold text-white/85">{t("stop.finishWhatYouCan")}</span>
                </span>
                {secondsLeft !== null && (
                  <span
                    className="flex-none rounded-xl px-3 text-[28px] leading-tight text-(--bg)"
                    style={{ fontFamily: SLAB, background: "#ffe9a8", animation: "tick 1s infinite" }}
                  >
                    {secondsLeft}
                  </span>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={handleStop}
                aria-disabled={!allAnswered}
                data-testid="stop-button"
                className="w-full cursor-pointer rounded-[20px] border-none py-3.5 text-[22px] text-white transition-transform active:translate-y-[5px] @md:py-5 @md:text-[26px] [@media(max-height:560px)]:py-2 [@media(max-height:560px)]:text-xl"
                style={{
                  fontFamily: SLAB,
                  background: CORAL_GRAD,
                  boxShadow: "0 7px 0 #8f1f33",
                  letterSpacing: ".05em",
                  opacity: allAnswered ? 1 : 0.85,
                }}
              >
                🛑 {t("stop.slamButton")}
              </button>
            )}
            <div
              className="mt-2 text-center text-[10px] uppercase"
              data-testid="stop-hint"
              style={{ fontFamily: MONO, color: hint ? "#ff8a9b" : "rgba(255,233,168,.35)" }}
            >
              {hint ? t("stop.fillFirst") : `${t("stop.slamHint")} 🔊`}
            </div>
          </div>
        </div>

        {/* Live scoreboard */}
        <aside className="min-w-0 @3xl:max-w-[320px] @3xl:flex-1">
          <div className="mb-2.5 flex items-baseline justify-between gap-2">
            <span
              className="text-[11px] font-bold uppercase"
              style={{ fontFamily: MONO, letterSpacing: ".25em", color: "rgba(255,233,168,.45)" }}
            >
              {t("stop.scoreboard")}
            </span>
            <span className="text-[10px] font-bold uppercase" style={{ fontFamily: MONO, color: "#ffd23f" }}>
              {t("stop.roundShort", { n: round, total: totalRounds })}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-[9px] @xl:grid-cols-2 @3xl:grid-cols-1" data-testid="stop-scoreboard">
            {board.map((row) => (
              <div
                key={row.player.id}
                className="flex min-w-0 items-center gap-3 rounded-full border-2 bg-(--panel) py-[7px] pr-4 pl-[7px]"
                style={{ borderColor: row.me ? "#35d4b9" : "#5a3f7a" }}
              >
                <Avatar player={row.player} color={row.color} size={36} />
                <div className="min-w-0 flex-1 truncate text-sm font-bold text-(--ink)">
                  {row.me ? `${t("stop.you")} ★` : row.player.name}
                </div>
                <span
                  className="flex-none text-[10px] font-bold uppercase"
                  style={{ fontFamily: MONO, color: row.stateColor }}
                  data-testid={`stop-board-state-${row.player.id}`}
                >
                  {row.state}
                </span>
                <span className="min-w-[30px] flex-none text-right text-base text-(--ink)" style={{ fontFamily: SLAB }}>
                  {row.pts}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2.5 text-center text-[9px] uppercase" style={{ fontFamily: MONO, color: "rgba(255,233,168,.3)" }}>
            {t("stop.scoreboardNote")}
          </div>
        </aside>
      </div>
    </>
  );
}

/** The design's full-screen STOP slam, played as a short flash that never
 *  takes input: pointer-events are off and it fades out on its own, leaving
 *  the compact grace banner in place of the STOP button. */
function SlamFlash({
  name,
  slammer,
  seconds,
  t,
}: {
  name: string;
  slammer: { player: Player; color: string } | undefined;
  seconds: number | null;
  t: T;
}) {
  return (
    <div
      aria-hidden
      data-testid="stop-slam"
      className="pointer-events-none fixed inset-0 z-30 flex flex-col items-center justify-center gap-4 px-4 text-center"
      style={{ background: "rgba(18,9,24,.9)", animation: "stopSlamFlash 1.8s ease-out forwards" }}
    >
      <style>{`@keyframes stopSlamFlash{0%{opacity:0}8%{opacity:1}70%{opacity:1}100%{opacity:0;visibility:hidden}}`}</style>
      {slammer && <Avatar player={slammer.player} color="#ff4f6f" size={64} />}
      <div className="text-sm font-bold uppercase" style={{ fontFamily: MONO, letterSpacing: ".3em", color: "#ff8a9b" }}>
        {t("stop.slammed", { name })}
      </div>
      <div
        className="leading-none text-white"
        style={{
          fontFamily: SLAB,
          fontSize: "clamp(56px, 16vw, 100px)",
          textShadow: "0 8px 0 #8f1f33",
          animation: "slam .5s ease-out",
          transform: "rotate(-2deg)",
        }}
      >
        {t("stop.slamButton")}
      </div>
      <div className="text-base font-semibold" style={{ color: "rgba(255,233,168,.7)" }}>
        {t("stop.finishWhatYouCan")}
      </div>
      {seconds !== null && (
        <div
          className="rounded-[20px] px-[30px] py-0.5 text-[44px] text-white @md:text-[56px]"
          style={{ fontFamily: SLAB, background: CORAL_GRAD, boxShadow: "0 6px 0 #8f1f33", animation: "tick 1s infinite" }}
        >
          {seconds}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── JUDGE ─────────────────────────

const REVEAL_MS = 1400;
const VALIDATE_RETRY_MS = 2500;
/** Effect-only clock read (kept out of line for the React compiler lint). */
const wallClock = () => Date.now();

function StopJudge({ pub, priv, roster, playerId, sendAction }: PhaseProps) {
  const { t } = useI18n();
  const letter = pub.letter ?? "?";
  const categories = pub.categories ?? [];
  const tally = pub.tally ?? {};
  const serverVotes = priv.round === pub.round ? (priv.votes ?? {}) : {};
  const validated = priv.round === pub.round && !!priv.validated;
  const canJudge = priv.judge !== false;

  // Keyed by round: local votes never leak into the next round.
  const [localVotes, setLocalVotes] = useState<Record<string, "valid" | "nonsense">>({});
  const [reveal, setReveal] = useState<string | null>(null);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (revealTimer.current) clearTimeout(revealTimer.current);
  }, []);

  // Everything by someone else that isn't auto-invalid, in category order.
  const items = (() => {
    const out: Array<{ key: string; category: string; playerId: string; answer: string }> = [];
    for (const category of categories) {
      for (const item of pub.answers?.[category] ?? []) {
        if (item.autoInvalid || item.playerId === playerId) continue;
        out.push({ key: `${category}|${item.playerId}`, category, playerId: item.playerId, answer: item.answer });
      }
    }
    return out;
  })();

  const voteOf = (key: string) => localVotes[key] ?? serverVotes[key];
  const pending = items.filter((it) => !voteOf(it.key));
  const current = reveal ? items.find((it) => it.key === reveal) ?? null : (pending[0] ?? null);
  const position = current ? items.indexOf(current) + 1 : items.length;

  // Every verdict cast → lock them in. The server's private `validated` is
  // the only proof it arrived: until it says so, re-send every
  // VALIDATE_RETRY_MS (a dropped send — offline, reconnecting — would
  // otherwise hold the whole room until the 60s timer). Repeats are no-ops
  // server-side, and the bulk `rejected` list carries every local verdict.
  const lastValidateAt = useRef(0);
  const [, setValidateTick] = useState(0);
  useEffect(() => {
    if (!canJudge || validated || reveal || items.length === 0 || pending.length > 0) return;
    const since = wallClock() - lastValidateAt.current;
    if (since >= VALIDATE_RETRY_MS) {
      const rejected = items.filter((it) => voteOf(it.key) === "nonsense").map((it) => it.key);
      sendAction({ action: "validate", rejected });
      lastValidateAt.current = wallClock();
    }
    const wait = since >= VALIDATE_RETRY_MS ? VALIDATE_RETRY_MS : VALIDATE_RETRY_MS - since;
    const id = setTimeout(() => setValidateTick((n) => n + 1), wait);
    return () => clearTimeout(id);
  });

  const vote = (key: string, valid: boolean) => {
    if (reveal) return;
    playSfx("click");
    setLocalVotes((prev) => ({ ...prev, [key]: valid ? "valid" : "nonsense" }));
    sendAction({ action: "vote", key, valid });
    setReveal(key);
    if (revealTimer.current) clearTimeout(revealTimer.current);
    revealTimer.current = setTimeout(() => setReveal(null), REVEAL_MS);
  };

  if (!canJudge || items.length === 0 || !current) {
    const remaining = Math.max(0, (pub.requiredCount ?? 0) - (pub.validatedCount ?? 0));
    const title = !canJudge
      ? t("stop.spectating")
      : items.length === 0
        ? t("stop.nothingToJudge")
        : remaining > 0
          ? remaining === 1
            ? t("stop.waitingJudgesOne")
            : t("stop.waitingJudges", { n: remaining })
          : t("stop.tallying");
    return (
      <div className="flex flex-col items-center justify-center px-1 py-8 text-center @3xl:py-16" data-testid="stop-judge-waiting">
        {canJudge && items.length > 0 && (
          <div className="mb-2 text-xs font-bold uppercase" style={{ fontFamily: MONO, letterSpacing: ".4em", color: "#35d4b9" }}>
            {t("stop.judgeDone")}
          </div>
        )}
        <div className="max-w-[520px] text-xl text-(--ink) @md:text-2xl" style={{ fontFamily: SLAB, textShadow: "0 4px 0 #c2452d" }}>
          {title}
        </div>
        <div className="mt-5 text-[10px] uppercase" style={{ fontFamily: MONO, color: "rgba(255,233,168,.3)" }}>
          {t("stop.scoringRule")}
        </div>
      </div>
    );
  }

  const shown = current;
  const myVote = voteOf(shown.key);
  const counts = tally[shown.key] ?? { valid: 0, nope: 0 };
  // If the server echo hasn't caught up with my vote yet, count it locally.
  const echoed = !!serverVotes[shown.key];
  const tValid = counts.valid + (!echoed && myVote === "valid" ? 1 : 0);
  const tNope = counts.nope + (!echoed && myVote === "nonsense" ? 1 : 0);
  const tTotal = tValid + tNope;
  const pct = tTotal > 0 ? Math.round((100 * tValid) / tTotal) : 50;

  return (
    <div className="flex flex-col items-center justify-center px-1 py-5 @3xl:pt-[30px] @3xl:pb-[50px] [@media(max-height:560px)]:py-1" data-testid="stop-judge">
      <div
        className="mb-3 text-center text-[10px] font-bold uppercase @md:mb-[18px] @md:text-[11px] [@media(max-height:560px)]:mb-1.5"
        style={{ fontFamily: MONO, letterSpacing: ".3em", color: "rgba(255,233,168,.5)" }}
        data-testid="stop-judge-header"
      >
        {t("stop.judgeHeader", { cat: shown.category, letter, n: position, total: items.length })}
      </div>
      <div
        key={shown.key}
        className="mb-3 w-full max-w-[512px] rounded-[22px] px-4 py-5 text-center @md:px-[26px] @md:py-[34px] [@media(max-height:560px)]:py-2.5 [@media(max-height:560px)]:mb-1.5"
        style={{ background: "#fff8e7", boxShadow: "0 8px 0 rgba(0,0,0,.35)", animation: "slam .4s ease-out" }}
      >
        <div className="mb-2 text-[11px] font-bold uppercase" style={{ fontFamily: MONO, letterSpacing: ".2em", color: "#8a7f60" }}>
          {t("stop.wrote", { name: roster.name(shown.playerId) })}
        </div>
        <div
          className="break-words text-[28px] leading-tight @md:text-[40px] [@media(max-height:560px)]:text-[26px]"
          style={{ fontFamily: SLAB, color: "#1c1230" }}
          data-testid="stop-judge-word"
        >
          &ldquo;{shown.answer}&rdquo;
        </div>
      </div>
      <div className="mb-4 text-[11px] uppercase @md:mb-5 [@media(max-height:560px)]:mb-2" style={{ fontFamily: MONO, color: "rgba(255,233,168,.4)" }}>
        {t("stop.isThisReal")}
      </div>
      <div className="flex w-full max-w-[460px] gap-3 @md:gap-3.5">
        <button
          type="button"
          onClick={() => vote(shown.key, true)}
          disabled={!!reveal}
          data-testid="stop-valid"
          className="flex-1 cursor-pointer rounded-2xl border-none p-3.5 text-[17px] uppercase transition-transform active:translate-y-1 disabled:cursor-default @md:p-[18px] [@media(max-height:560px)]:p-2.5"
          style={{
            fontFamily: SLAB,
            color: "#0c3d33",
            background: "linear-gradient(180deg,#41e0c4,#28b89e)",
            boxShadow: "0 6px 0 #0f6e5c",
            opacity: reveal && myVote !== "valid" ? 0.45 : 1,
          }}
        >
          ✓ {t("stop.valid")}
        </button>
        <button
          type="button"
          onClick={() => vote(shown.key, false)}
          disabled={!!reveal}
          data-testid="stop-nonsense"
          className="flex-1 cursor-pointer rounded-2xl border-none p-3.5 text-[17px] uppercase text-white transition-transform active:translate-y-1 disabled:cursor-default @md:p-[18px] [@media(max-height:560px)]:p-2.5"
          style={{
            fontFamily: SLAB,
            background: CORAL_GRAD,
            boxShadow: "0 6px 0 #8f1f33",
            opacity: reveal && myVote !== "nonsense" ? 0.45 : 1,
          }}
        >
          ✗ {t("stop.nonsense")}
        </button>
      </div>
      {myVote && (
        <div className="mt-5 flex items-center gap-3 @md:gap-4 [@media(max-height:560px)]:mt-3" style={{ animation: "rise .3s ease-out" }} data-testid="stop-tally">
          <span className="text-[13px] font-bold uppercase" style={{ fontFamily: MONO, color: "#35d4b9" }}>
            {t("stop.tallyValid", { n: tValid })}
          </span>
          <div className="flex h-3 w-[120px] overflow-hidden rounded-full border border-(--line) bg-(--panel) @md:w-[180px]">
            <div style={{ width: `${pct}%`, background: "#35d4b9" }} />
            <div className="flex-1" style={{ background: "#e84863" }} />
          </div>
          <span className="text-[13px] font-bold uppercase" style={{ fontFamily: MONO, color: "#ff8a9b" }}>
            {t("stop.tallyNope", { n: tNope })}
          </span>
        </div>
      )}
      <div className="mt-5 text-center text-[10px] uppercase @md:mt-[22px]" style={{ fontFamily: MONO, color: "rgba(255,233,168,.3)" }}>
        {t("stop.scoringRule")}
      </div>
    </div>
  );
}

// ───────────────────────── RESULTS ─────────────────────────

function StopResults({ pub, roster, players, playerId, isAdmin, sendAction }: Omit<PhaseProps, "priv">) {
  const { t } = useI18n();
  const round = pub.round ?? 1;
  const totalRounds = pub.totalRounds ?? 3;
  const final = pub.final ?? round >= totalRounds;
  const totalScores = pub.totalScores ?? {};
  const roundScores = pub.roundScores ?? {};
  const results = pub.results ?? {};
  const categories = pub.categories ?? [];
  const secondsLeft = useSecondsLeft(final ? pub.deadline : null);

  const rows = players
    .filter((p) => p.id in totalScores || p.id in roundScores)
    .map((p) => ({ player: p, raw: totalScores[p.id] ?? 0, gain: roundScores[p.id] ?? 0 }))
    .sort((a, b) => b.raw - a.raw);

  const verdictStyle: Record<Verdict, { bg: string; fg: string }> = {
    unique: { bg: "#35d4b9", fg: "#0c3d33" },
    duplicate: { bg: "#ffd23f", fg: "#3d1f0e" },
    invalid: { bg: "#e84863", fg: "#fff" },
  };

  return (
    <div className="flex flex-col items-center px-1 py-5 @3xl:pt-[30px] @3xl:pb-10 [@media(max-height:560px)]:py-1" data-testid="stop-results">
      <div className="mb-4 text-center @md:mb-[22px] [@media(max-height:560px)]:mb-2">
        <div className="text-xs font-bold uppercase" style={{ fontFamily: MONO, letterSpacing: ".4em", color: "#35d4b9" }}>
          {final ? t("stop.gameOver") : t("stop.roundResultsKicker")} 🔊
        </div>
        <div
          className="text-[28px] uppercase leading-tight text-(--ink) @md:text-[42px] [@media(max-height:560px)]:text-[24px]"
          style={{ fontFamily: SLAB, textShadow: "0 5px 0 #c2452d" }}
          data-testid="stop-results-title"
        >
          {final ? t("stop.finalStandings") : t("stop.roundTitle", { n: round, total: totalRounds })}
        </div>
      </div>

      <div className="mb-5 flex w-full max-w-[560px] flex-col gap-2.5 @md:mb-[26px] @md:gap-[11px] [@media(max-height:560px)]:mb-3 [@media(max-height:560px)]:gap-1.5">
        {rows.map((row, i) => {
          const top = i === 0;
          const color = roster.byId.get(row.player.id)?.color ?? playerColorFor(i);
          return (
            <div
              key={row.player.id}
              data-testid={`stop-standing-${row.player.id}`}
              className="flex min-w-0 items-center gap-3 rounded-2xl px-3 py-2.5 @md:gap-3.5 @md:px-[18px] @md:py-3 [@media(max-height:560px)]:py-1"
              style={{
                background: top ? YELLOW_GRAD : "#2b1a3d",
                border: top ? "none" : "2px solid #5a3f7a",
                boxShadow: top ? "0 5px 0 #c2452d" : "none",
                animation: "rise .5s ease-out both",
                animationDelay: `${0.15 * Math.max(0, rows.length - 1 - i)}s`,
              }}
            >
              <div
                className="w-6 flex-none text-center text-[19px] @md:w-[30px]"
                style={{ fontFamily: SLAB, color: top ? "#3d1f0e" : "rgba(255,233,168,.6)" }}
              >
                {i + 1}
              </div>
              <Avatar player={row.player} color={color} size={42} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-base font-bold" style={{ color: top ? "#3d1f0e" : "#ffe9a8" }}>
                  {row.player.name}
                  {row.player.id === playerId ? " ★" : ""}
                </div>
                <div
                  className="text-[11px] font-semibold uppercase"
                  style={{ fontFamily: MONO, color: top ? "rgba(61,31,14,.6)" : "rgba(255,233,168,.45)" }}
                >
                  {t("stop.ptsInGame", { n: row.raw })}
                </div>
              </div>
              <div className="flex-none text-[21px]" style={{ fontFamily: SLAB, color: top ? "#3d1f0e" : "#35d4b9" }}>
                +{row.gain}
              </div>
            </div>
          );
        })}
      </div>

      {final ? (
        <div className="flex flex-col items-center gap-2">
          {isAdmin && (
            <button
              type="button"
              onClick={() => sendAction({ action: "next_round" })}
              data-testid="stop-finish"
              className="cursor-pointer rounded-[14px] border-none px-7 py-3.5 text-[15px] uppercase transition-transform active:translate-y-1"
              style={{ fontFamily: SLAB, color: "#3d1f0e", background: YELLOW_GRAD, boxShadow: "0 5px 0 #c2452d" }}
            >
              {t("stop.toSession")} →
            </button>
          )}
          {secondsLeft !== null && (
            <div className="text-[10px] uppercase" style={{ fontFamily: MONO, color: "rgba(255,233,168,.45)" }}>
              {t("stop.finalIn", { n: secondsLeft })}
            </div>
          )}
        </div>
      ) : isAdmin ? (
        <button
          type="button"
          onClick={() => sendAction({ action: "next_round" })}
          data-testid="stop-next-round"
          className="cursor-pointer rounded-[14px] border-none px-10 py-[15px] text-base uppercase transition-transform active:translate-y-1"
          style={{ fontFamily: SLAB, color: "#3d1f0e", background: YELLOW_GRAD, boxShadow: "0 5px 0 #c2452d" }}
        >
          {t("stop.nextRound")} ▶
        </button>
      ) : (
        <div className="text-[11px] uppercase" style={{ fontFamily: MONO, color: "rgba(255,233,168,.5)" }} data-testid="stop-waiting-host">
          {t("stop.waitingHost")}
        </div>
      )}

      {/* Per-category breakdown, tucked away so the standings stay the hero */}
      <details className="mt-6 w-full max-w-[560px]" data-testid="stop-breakdown">
        <summary
          className="cursor-pointer text-center text-[11px] font-bold uppercase"
          style={{ fontFamily: MONO, letterSpacing: ".2em", color: "rgba(255,233,168,.5)" }}
        >
          {t("stop.allAnswers")}
        </summary>
        <div className="mt-3 flex flex-col gap-2">
          {categories.map((category) => {
            const list = results[category] ?? [];
            return (
              <div key={category} className="rounded-[14px] border-2 border-(--line) bg-(--panel) px-3 py-2">
                <div className="mb-1.5 text-[10px] font-bold uppercase" style={{ fontFamily: MONO, color: "rgba(255,233,168,.5)" }}>
                  {category}
                </div>
                {list.length === 0 ? (
                  <div className="text-xs text-(--ink)/40">{t("stop.noAnswers")}</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {list.map((r) => (
                      <span
                        key={r.playerId}
                        data-testid={`stop-result-${r.verdict}`}
                        className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
                        style={{ background: verdictStyle[r.verdict].bg, color: verdictStyle[r.verdict].fg }}
                        title={t(`stop.${r.verdict}`)}
                      >
                        <span className="truncate">{r.answer}</span>
                        <span className="opacity-70">· {roster.name(r.playerId)}</span>
                        <span style={{ fontFamily: SLAB }}>+{r.points}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
}
