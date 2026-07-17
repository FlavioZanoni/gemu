"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** Room-code pill with tap-to-copy. */
export function CodePill({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      data-testid="room-code"
      data-code={code}
      className="inline-flex w-fit items-center gap-2 rounded-full bg-(--ink) px-4 py-1.5 font-mono text-xs font-bold text-(--bg)"
      onClick={() => {
        void navigator.clipboard?.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      {label ? <span>{label} ·</span> : null}
      <b className="tracking-[0.2em]">{code}</b>
      <span aria-hidden className="flex items-center">
        {copied ? <Check size={14} strokeWidth={2.5} /> : <Copy size={14} strokeWidth={2.5} />}
      </span>
    </button>
  );
}
