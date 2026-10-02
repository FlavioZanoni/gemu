"use client";

import { useEffect } from "react";
import { useI18n } from "@/lib/i18n";

/** Last-resort boundary: a render crash anywhere in a page shows this instead
 *  of a blank screen, with a way to try again or go home. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    console.warn("Gemu page crashed", error);
  }, [error]);
  return (
    <div className="radial-glow flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-[22px] border-2 border-(--line) bg-(--panel) p-6 text-center" role="alert">
        <h1 className="slab text-2xl">{t("shell.crashTitle")}</h1>
        <p className="mt-2 text-sm text-(--ink)/65">{t("shell.crashBody")}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="buzzer rounded-[14px] px-5 py-3 text-sm uppercase"
            style={{ background: "linear-gradient(180deg,#ffd23f,#f5b32a)", color: "var(--dark-ink)" }}
          >
            {t("common.retry")}
          </button>
          <button
            type="button"
            onClick={() => window.location.assign("/")}
            className="rounded-[14px] border-2 border-(--ink) px-5 py-3 font-display text-sm uppercase text-(--ink)"
          >
            {t("edge.backHome")}
          </button>
        </div>
      </div>
    </div>
  );
}
