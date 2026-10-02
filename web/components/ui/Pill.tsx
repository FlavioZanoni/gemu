"use client";

import { useState } from "react";
import { Check, Copy, Lock } from "lucide-react";
import { useI18n } from "@/lib/i18n";

/** Room-code pill with tap-to-copy (Gemu Screens · lobby). */
export function CodePill({
  code,
  label,
  size = "lg",
}: {
  code: string;
  label?: string;
  size?: "lg" | "sm";
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const big = size === "lg";
  return (
    <button
      type="button"
      data-testid="room-code"
      data-code={code}
      aria-label={t("shell.copyCode", { code })}
      className="inline-flex max-w-full min-w-0 items-center justify-center gap-2 rounded-[14px] font-mono font-bold"
      style={{
        background: "var(--ink)",
        boxShadow: "0 4px 0 var(--drop)",
        color: "var(--bg)",
        fontSize: big ? "clamp(18px, 5vw, 26px)" : "15px",
        padding: big ? "10px clamp(12px, 3vw, 22px)" : "6px 12px",
      }}
      onClick={() => {
        void navigator.clipboard?.writeText(code).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      {label ? (
        <span className="text-[11px] tracking-[0.1em]" style={{ opacity: 0.55 }}>
          {label}
        </span>
      ) : null}
      <b className="tracking-[0.3em]">{code}</b>
      <span aria-hidden className="flex items-center">
        {copied ? <Check size={big ? 18 : 14} strokeWidth={2.5} /> : <Copy size={big ? 18 : 14} strokeWidth={2.5} />}
      </span>
    </button>
  );
}

/** "🔒 ••••" — the room has a password (never shown). */
export function PasswordPill() {
  const { t } = useI18n();
  return (
    <span
      className="inline-flex flex-none items-center gap-1.5 rounded-[14px] border-2 border-(--line) bg-(--panel) px-3.5 py-2.5 font-mono text-sm font-bold text-(--ink)/70"
      title={t("shell.passwordProtected")}
      aria-label={t("shell.passwordProtected")}
    >
      <Lock size={14} strokeWidth={2.5} aria-hidden /> ••••
    </span>
  );
}
