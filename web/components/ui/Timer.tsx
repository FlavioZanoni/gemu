"use client";

import { useEffect, useRef, useState } from "react";
import { playSfx } from "@/lib/sfx";
import { useRoomPaused } from "@/lib/roomStore";

type Clock = {
  now: number;
  /** The deadline this reading belongs to. */
  forDeadline: number | null;
  /** How long that phase was when we first saw it (ms). */
  span: number;
};

// Counts down to `deadline`, freezing while the host has the show paused
// (the server shifts every deadline forward on resume).
const useClock = (deadline: number | null | undefined, paused: boolean) => {
  const [clock, setClock] = useState<Clock>(() => ({ now: Date.now(), forDeadline: null, span: 0 }));
  const spans = useRef(new Map<number, number>());
  useEffect(() => {
    if (!deadline || paused) return;
    let span = spans.current.get(deadline);
    if (span === undefined) {
      span = deadline - Date.now();
      spans.current.clear();
      spans.current.set(deadline, span);
    }
    const phaseSpan = span;
    const tick = () => setClock({ now: Date.now(), forDeadline: deadline, span: phaseSpan });
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 250);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [deadline, paused]);
  if (!deadline) return { seconds: null, span: 0, known: false };
  const known = clock.forDeadline === deadline;
  return {
    seconds: Math.max(0, Math.ceil((deadline - clock.now) / 1000)),
    span: known ? clock.span : 0,
    known,
  };
};

/** Whole seconds left until `deadline` (null without one), ticking 4×/s and
 *  frozen while the show is paused. For games that render their own clock. */
export const useCountdown = (deadline: number | null | undefined): number | null => {
  const paused = useRoomPaused();
  return useClock(deadline, paused).seconds;
};

const format = (seconds: number, pad = false) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${pad ? String(m).padStart(2, "0") : m}:${String(s).padStart(2, "0")}`;
};

// Short reveal/results phases (a few seconds) shouldn't flash the alarm.
const LONG_PHASE_MS = 15_000;

/**
 * The shell's countdown badge (Gemu Prototype shell header): Space Mono on
 * cream with the warm-red drop; flips coral + `tick` pulse in the last 10s of
 * a real phase. `variant="vote"` is the big yellow vote clock.
 */
export function TimerBadge({
  deadline,
  className = "",
  variant = "header",
  urgentBelow,
}: {
  deadline: number | null | undefined;
  className?: string;
  variant?: "header" | "vote";
  /** Seconds left at which the badge turns urgent (default 10, vote 5). */
  urgentBelow?: number;
}) {
  const paused = useRoomPaused();
  const { seconds, span, known } = useClock(deadline, paused);
  const threshold = urgentBelow ?? (variant === "vote" ? 6 : 10);
  const urgent =
    seconds !== null && seconds < threshold && known && span >= LONG_PHASE_MS && !paused;
  // Tick once per second in the final 5s. Hooks must run every render — never
  // after the early return below — or the null→number deadline flip changes
  // the hook count and React throws.
  const lastTick = useRef<number>(-1);
  useEffect(() => {
    if (seconds === null || !urgent) return;
    if (seconds > 0 && seconds <= 5 && seconds !== lastTick.current) {
      lastTick.current = seconds;
      playSfx("tick");
    }
    if (seconds > 5) lastTick.current = -1;
  }, [seconds, urgent]);
  if (seconds === null) return null;

  if (variant === "vote") {
    return (
      <span
        role="timer"
        data-testid="timer-badge"
        className={`inline-block rounded-[12px] px-4 py-0.5 font-display text-[34px] leading-tight ${className}`}
        style={
          urgent
            ? {
                color: "#fff",
                background: "linear-gradient(180deg,#ff6b85,#e84863)",
                boxShadow: "0 4px 0 #8f1f33",
                animation: "tick 1s infinite",
              }
            : { color: "var(--bg)", background: "var(--accent)", boxShadow: "0 4px 0 var(--drop)" }
        }
      >
        {format(seconds, true)}
      </span>
    );
  }

  return (
    <span
      role="timer"
      data-testid="timer-badge"
      data-paused={paused || undefined}
      className={`inline-block flex-none rounded-[9px] px-2.5 py-[3px] font-mono text-base font-bold leading-tight tabular-nums sm:px-3.5 sm:text-lg ${className}`}
      style={
        urgent
          ? {
              color: "#fff",
              background: "linear-gradient(180deg,#ff6b85,#e84863)",
              boxShadow: "0 3px 0 #8f1f33",
              animation: "tick 1s infinite",
            }
          : {
              color: "var(--bg)",
              background: "var(--ink)",
              boxShadow: "0 3px 0 var(--drop)",
              opacity: paused ? 0.6 : 1,
            }
      }
    >
      {format(seconds)}
    </span>
  );
}
