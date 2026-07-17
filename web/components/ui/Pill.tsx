"use client";

import { useState, type HTMLAttributes } from "react";

type PillProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: "code" | "ready" | "host" | "waiting" | "neutral";
};

export function Pill({ variant = "neutral", className = "", children, ...rest }: PillProps) {
  const base = "inline-flex w-fit items-center gap-2 rounded-full px-3 py-1";
  const variants: Record<string, string> = {
    code: "bg-(--ink) font-mono text-xs font-bold text-(--bg)",
    ready:
      "border-2 border-(--accent-2) font-sans text-[11px] font-semibold text-(--accent-2)",
    host: "bg-(--accent) font-sans text-[11px] font-semibold text-(--bg)",
    waiting:
      "border-2 border-dashed border-(--line) font-sans text-[11px] font-semibold text-(--ink)/50",
    neutral:
      "border-2 border-(--line) font-sans text-[11px] font-semibold text-(--ink)/70",
  };
  return (
    <span className={`${base} ${variants[variant]} ${className}`} {...rest}>
      {children}
    </span>
  );
}

/** Room-code pill with tap-to-copy. */
export function CodePill({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex w-fit items-center gap-2 rounded-full bg-(--ink) px-4 py-1.5 font-mono text-xs font-bold text-(--bg)"
      onClick={() => {
        void navigator.clipboard?.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      {label ? <span>{label} ·</span> : null}
      <b className="tracking-[0.2em]">{code}</b>
      <span aria-hidden>{copied ? "✓" : "⧉"}</span>
    </button>
  );
}
