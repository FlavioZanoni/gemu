"use client";

import { useEffect, useRef, useState } from "react";
import { playSfx } from "@/lib/sfx";

const useCountdown = (deadline: number | null | undefined) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [deadline]);
  if (!deadline) return null;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
};

const format = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `0:${String(s).padStart(2, "0")}`;
};

/** Slab countdown badge. Flips to coral + pulses under 10s. */
export function TimerBadge({
  deadline,
  className = "",
}: {
  deadline: number | null | undefined;
  className?: string;
}) {
  const seconds = useCountdown(deadline);
  if (seconds === null) return null;
  const urgent = seconds < 10;
  // Tick once per second in the final 5s.
  const lastTick = useRef<number>(-1);
  useEffect(() => {
    if (seconds > 0 && seconds <= 5 && seconds !== lastTick.current) {
      lastTick.current = seconds;
      playSfx("tick");
    }
    if (seconds > 5) lastTick.current = -1;
  }, [seconds]);
  return (
    <span
      className={`inline-block rounded-[10px] px-4 py-0.5 font-display text-3xl ${className}`}
      style={
        urgent
          ? {
              color: "#fff",
              background: "linear-gradient(180deg,#ff6b85,#e84863)",
              boxShadow: "0 4px 0 #8f1f33",
              animation: "tick 1s infinite",
            }
          : {
              color: "var(--bg)",
              background: "var(--ink)",
              boxShadow: "0 4px 0 var(--drop)",
            }
      }
    >
      {format(seconds)}
    </span>
  );
}

/** Labeled progress bar counting down from `totalSeconds` to `deadline`. */
export function TimerBar({
  deadline,
  totalSeconds,
  label,
  className = "",
}: {
  deadline: number | null | undefined;
  totalSeconds: number;
  label?: string;
  className?: string;
}) {
  const seconds = useCountdown(deadline);
  if (seconds === null) return null;
  const pct = Math.max(0, Math.min(100, (seconds / totalSeconds) * 100));
  return (
    <div className={className}>
      <div className="mb-1 flex justify-between font-mono text-[10px] text-(--ink)/50">
        <span>{label}</span>
        <span>{format(seconds)}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full border border-(--line) bg-(--panel)">
        <div
          className="h-full rounded-full transition-[width] duration-200"
          style={{
            width: `${pct}%`,
            background: "linear-gradient(90deg,#35d4b9,#ffd23f)",
          }}
        />
      </div>
    </div>
  );
}
