"use client";

import type { ReactNode } from "react";
import { Footprints, HelpCircle, MonitorSmartphone } from "lucide-react";
import { useI18n } from "@/lib/i18n";

/** Centered edge-state card (Gemu Screens · 10). */
function EdgeCard({
  icon,
  title,
  titleColor = "var(--ink)",
  children,
  testId,
}: {
  icon: ReactNode;
  title: string;
  titleColor?: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <div
        className="w-full max-w-[320px] rounded-[22px] border-2 border-(--line) bg-(--bg) px-6 py-7 text-center shadow-[0_20px_60px_rgba(0,0,0,.4)]"
        data-testid={testId}
        role="alert"
      >
        <div className="mb-2 flex justify-center" aria-hidden>
          {icon}
        </div>
        <h1 className="font-display text-[22px] uppercase leading-tight" style={{ color: titleColor }}>
          {title}
        </h1>
        {children}
      </div>
    </div>
  );
}

const outline =
  "buzzer mt-5 w-full rounded-[14px] border-2 border-(--ink) bg-(--panel) px-4 py-3 text-sm uppercase text-(--ink)";
const yellow = "buzzer mt-5 w-full rounded-[14px] px-4 py-3 text-sm uppercase";

export function KickedScreen({ onHome }: { onHome: () => void }) {
  const { t } = useI18n();
  return (
    <EdgeCard
      icon={<Footprints size={30} strokeWidth={2.5} style={{ color: "var(--danger)" }} />}
      title={t("edge.kicked")}
      titleColor="var(--danger)"
      testId="kicked-screen"
    >
      <p className="mt-2 text-[13px] text-(--ink)/65">{t("edge.kickedDesc")}</p>
      <button
        type="button"
        className={outline}
        style={{ ["--buzzer-drop" as string]: "rgba(0,0,0,.4)" }}
        onClick={onHome}
        data-testid="kicked-home"
      >
        {t("edge.backHome")}
      </button>
    </EdgeCard>
  );
}

/** This seat moved to another tab/window (room.sessionReplaced). */
export function ReplacedScreen({
  onReclaim,
  pending,
  onHome,
}: {
  onReclaim: () => void;
  pending: boolean;
  onHome?: () => void;
}) {
  const { t } = useI18n();
  return (
    <EdgeCard
      icon={<MonitorSmartphone size={30} strokeWidth={2.5} style={{ color: "var(--accent-2)" }} />}
      title={t("edge.replacedTitle")}
      testId="replaced-screen"
    >
      <p className="mt-2 text-[13px] text-(--ink)/65">{t("edge.replacedDesc")}</p>
      <button
        type="button"
        className={yellow}
        style={{ background: "linear-gradient(180deg,#ffd23f,#f5b32a)", color: "var(--dark-ink)" }}
        onClick={onReclaim}
        disabled={pending}
        data-testid="reclaim-room"
      >
        {pending ? t("edge.joining") : t("edge.replacedUseHere")}
      </button>
      {onHome ? (
        <button
          type="button"
          onClick={onHome}
          className="mt-3 font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-(--ink)/50 hover:text-(--ink)"
        >
          {t("edge.backHome")}
        </button>
      ) : null}
    </EdgeCard>
  );
}

/** The room doesn't exist (anymore). */
export function OffAirScreen({ code, onHome }: { code?: string; onHome: () => void }) {
  const { t } = useI18n();
  return (
    <EdgeCard
      icon={<HelpCircle size={34} strokeWidth={2.5} style={{ color: "var(--line)" }} />}
      title={t("edge.offAir")}
      testId="offair-screen"
    >
      <p className="mt-2 text-[13px] text-(--ink)/65">
        {code ? (
          <>
            {t("edge.offAirRoom")} <b className="font-mono text-(--accent)">{code}</b> {t("edge.offAirTail")}
          </>
        ) : (
          t("edge.offAirDesc")
        )}
      </p>
      <button
        type="button"
        className={yellow}
        style={{ background: "linear-gradient(180deg,#ffd23f,#f5b32a)", color: "var(--dark-ink)" }}
        onClick={onHome}
        data-testid="offair-home"
      >
        {t("edge.tryAnother")}
      </button>
    </EdgeCard>
  );
}

export function StatusScreen({ title, caption }: { title: string; caption?: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <div className="text-center" role="status" aria-live="polite">
        <div className="slab text-3xl uppercase">{title}</div>
        {caption ? (
          <p className="mt-2 font-mono text-xs uppercase tracking-[0.2em] text-(--ink)/60">{caption}</p>
        ) : null}
      </div>
    </div>
  );
}
