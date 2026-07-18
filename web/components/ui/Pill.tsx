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
      className="inline-flex w-fit items-center gap-2 rounded-[14px] px-[22px] py-3 font-mono font-bold"
      style={{
        background: "#ffe9a8",
        boxShadow: "0 4px 0 #c2452d",
        color: "#3d1f0e",
        fontSize: "26px"
      }}
      onClick={() => {
        void navigator.clipboard?.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      {label ? <span style={{ fontSize: "14px" }}>{label} ·</span> : null}
      <b className="tracking-[0.2em]">{code}</b>
      <span aria-hidden className="flex items-center">
        {copied ? <Check size={20} strokeWidth={2.5} /> : <Copy size={20} strokeWidth={2.5} />}
      </span>
    </button>
  );
}
