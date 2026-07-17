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
  // Tick once per second in the final 5s. Hooks must run every render — never
  // after the early return below — or the null→number deadline flip changes
  // the hook count and React throws.
  const lastTick = useRef<number>(-1);
  useEffect(() => {
    if (seconds === null) return;
    if (seconds > 0 && seconds <= 5 && seconds !== lastTick.current) {
      lastTick.current = seconds;
      playSfx("tick");
    }
    if (seconds > 5) lastTick.current = -1;
  }, [seconds]);
  if (seconds === null) return null;
  const urgent = seconds < 10;
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
