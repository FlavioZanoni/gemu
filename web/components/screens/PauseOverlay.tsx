"use client";

import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui";

/** Full-stage pause overlay ("PAUSE OVERLAY" in Gemu Prototype): the host
 *  froze the clock; timers freeze for everyone. Resume is host-only. */
export function PauseOverlay({
  isAdmin,
  onResume,
}: {
  isAdmin: boolean;
  onResume: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="pop-in w-full max-w-sm rounded-[20px] border-[3px] border-(--accent) bg-(--panel) p-8 text-center shadow-[0_12px_0_rgba(0,0,0,.35)]">
        <div className="text-5xl" aria-hidden>
          🍕
        </div>
        <div className="slab mt-3 text-3xl">{t("pause.title")}</div>
        <p className="mt-3 text-sm leading-relaxed text-(--ink)/70">
          {t("pause.body")}
        </p>
        {isAdmin ? (
          <Button variant="primary" size="lg" className="mt-6 w-full" onClick={onResume}>
            ▶ {t("pause.resume").toUpperCase()}
          </Button>
        ) : null}
        <div className="mt-4 font-mono text-[10px] uppercase tracking-[0.25em] text-(--ink)/40">
          {t("pause.caption")}
        </div>
      </div>
    </div>
  );
}
