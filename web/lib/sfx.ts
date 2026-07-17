"use client";

// Fun sound effects, synthesized with the Web Audio API — no audio files to
// bundle or license. Each cue is a few oscillator/gain envelopes. Muteable and
// persisted; the AudioContext is created lazily on first (user-gesture) play so
// browsers don't block it.

type Cue =
  | "click"
  | "buzzer"
  | "ready"
  | "correct"
  | "wrong"
  | "tick"
  | "drumroll"
  | "winner"
  | "reveal"
  | "join"
  | "start";

let ctx: AudioContext | null = null;
let muted = false;
const listeners = new Set<(m: boolean) => void>();

const STORAGE_KEY = "gemu:muted";

if (typeof window !== "undefined") {
  muted = window.localStorage.getItem(STORAGE_KEY) === "1";
}

const getCtx = (): AudioContext | null => {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
};

// tone plays one oscillator with a short attack/decay envelope.
const tone = (
  ac: AudioContext,
  opts: {
    freq: number;
    dur: number;
    type?: OscillatorType;
    gain?: number;
    delay?: number;
    slideTo?: number;
  },
) => {
  const t0 = ac.currentTime + (opts.delay ?? 0);
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = opts.type ?? "square";
  osc.frequency.setValueAtTime(opts.freq, t0);
  if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + opts.dur);
  const peak = opts.gain ?? 0.12;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + opts.dur + 0.02);
};

const cues: Record<Cue, (ac: AudioContext) => void> = {
  click: (ac) => tone(ac, { freq: 420, dur: 0.05, type: "square", gain: 0.06 }),
  buzzer: (ac) => {
    tone(ac, { freq: 180, dur: 0.28, type: "sawtooth", gain: 0.14 });
    tone(ac, { freq: 120, dur: 0.28, type: "sawtooth", gain: 0.12, delay: 0.01 });
  },
  ready: (ac) => tone(ac, { freq: 660, dur: 0.09, type: "triangle", gain: 0.1, slideTo: 990 }),
  correct: (ac) => {
    tone(ac, { freq: 660, dur: 0.09, type: "square", gain: 0.11 });
    tone(ac, { freq: 880, dur: 0.12, type: "square", gain: 0.11, delay: 0.09 });
    tone(ac, { freq: 1320, dur: 0.14, type: "square", gain: 0.1, delay: 0.19 });
  },
  wrong: (ac) => tone(ac, { freq: 200, dur: 0.2, type: "sawtooth", gain: 0.12, slideTo: 120 }),
  tick: (ac) => tone(ac, { freq: 900, dur: 0.04, type: "square", gain: 0.05 }),
  drumroll: (ac) => {
    for (let i = 0; i < 8; i++) {
      tone(ac, { freq: 140 + i * 8, dur: 0.05, type: "triangle", gain: 0.08, delay: i * 0.06 });
    }
  },
  winner: (ac) => {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => tone(ac, { freq: f, dur: 0.16, type: "square", gain: 0.12, delay: i * 0.1 }));
  },
  reveal: (ac) => tone(ac, { freq: 300, dur: 0.18, type: "triangle", gain: 0.1, slideTo: 900 }),
  join: (ac) => tone(ac, { freq: 520, dur: 0.08, type: "triangle", gain: 0.09, slideTo: 700 }),
  start: (ac) => {
    tone(ac, { freq: 392, dur: 0.12, type: "square", gain: 0.12 });
    tone(ac, { freq: 523, dur: 0.16, type: "square", gain: 0.12, delay: 0.12 });
    tone(ac, { freq: 784, dur: 0.2, type: "square", gain: 0.12, delay: 0.28 });
  },
};

export const playSfx = (cue: Cue) => {
  if (muted) return;
  const ac = getCtx();
  if (!ac) return;
  try {
    cues[cue](ac);
  } catch {
    // Audio can fail on locked contexts; never let a sound break the UI.
  }
};

export const isMuted = () => muted;
export const toggleMuted = () => {
  muted = !muted;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, muted ? "1" : "0");
  }
  listeners.forEach((fn) => fn(muted));
  if (!muted) playSfx("click");
};
export const onMuteChange = (fn: (m: boolean) => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
