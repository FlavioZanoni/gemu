"use client";

import { useId } from "react";
import { Pizza } from "lucide-react";
import { useI18n } from "@/lib/i18n";

/** Full-stage pause overlay (Gemu Prototype · PAUSE OVERLAY): the host froze
 *  the clock; timers freeze for everyone. Resume is host-only; anyone can
 *  still leave. */
export function PauseOverlay({
  isAdmin,
  onResume,
  onLeave,
}: {
  isAdmin: boolean;
  onResume: () => void;
  onLeave?: () => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-y-auto p-6 text-center"
      style={{ background: "rgba(18,9,24,.92)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="pause-overlay"
    >
      <Pizza size={52} strokeWidth={2.2} aria-hidden className="text-(--accent)" />
      <h2
        id={titleId}
        className="mt-3 font-display text-[clamp(34px,9vw,52px)] uppercase leading-tight text-(--ink)"
        style={{ textShadow: "0 6px 0 var(--drop)" }}
      >
        {t("pause.title")}
      </h2>
      <p className="mt-3 max-w-md text-[15px] leading-relaxed text-(--ink)/60">{t("pause.body")}</p>
      {isAdmin ? (
        <button
          type="button"
          className="buzzer mt-6 rounded-2xl px-[42px] py-4 text-[17px] uppercase"
          style={{ background: "linear-gradient(180deg,#ffd23f,#f5b32a)", color: "var(--dark-ink)" }}
          onClick={onResume}
          data-testid="pause-resume"
        >
          ▶ {t("pause.resume")}
        </button>
      ) : null}
      <div className="mt-4 font-mono text-[10px] uppercase tracking-[0.15em] text-(--ink)/40">{t("pause.caption")}</div>
      {onLeave ? (
        <button
          type="button"
          onClick={onLeave}
          className="mt-8 rounded-full border-2 border-(--line) px-4 py-1.5 font-sans text-xs font-bold text-(--ink)/60 hover:text-(--ink)"
          data-testid="pause-leave"
        >
          {t("shell.leaveRoom")}
        </button>
      ) : null}
    </div>
  );
}
