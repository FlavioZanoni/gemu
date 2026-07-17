"use client";

import { useI18n } from "@/lib/i18n";
import { hueFor } from "./gameHues";
import { Bulbs } from "./Bulbs";
import { Modal } from "./Modal";

/** Shared how-to-play pattern (Gemu System · 08): per-game hue header with
 *  white bulbs, numbered t() steps `howto.<gameType>.<n>`, got-it button.
 *  Auto-opens before round 1; always reachable from the game header. */
export function HowToPlayModal({
  open,
  gameType,
  gameName,
  stepCount,
  onClose,
  footer,
}: {
  open: boolean;
  gameType: string;
  gameName: string;
  stepCount: number;
  onClose: () => void;
  footer?: string;
}) {
  const { t } = useI18n();
  const hue = hueFor(gameType);

  return (
    <Modal open={open} onClose={onClose}>
      <div
        className="overflow-hidden rounded-[20px] bg-(--panel)"
        style={{ border: `3px solid ${hue.base}`, boxShadow: "0 12px 0 rgba(0,0,0,.35)" }}
      >
        <div
          className="relative px-5 py-4"
          style={{ background: `linear-gradient(180deg,${hue.gradFrom},${hue.gradTo})` }}
        >
          <Bulbs count={3} size={7} color="#fff" className="absolute -top-1 left-3.5 right-3.5" />
          <div
            className="font-mono text-[10px] font-bold tracking-[0.3em]"
            style={{ color: `${hue.ink}b3` }}
          >
            {t("common.howToPlay").replace("? ", "").toUpperCase()}
          </div>
          <div className="font-display text-[22px]" style={{ color: hue.ink }}>
            {gameName.toUpperCase()}
          </div>
        </div>
        <div className="flex flex-col gap-3 px-5 py-4">
          {Array.from({ length: stepCount }, (_, i) => (
            <div key={i} className="flex items-start gap-3">
              <div
                className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full font-display text-[13px]"
                style={{ background: hue.base, color: hue.ink }}
              >
                {i + 1}
              </div>
              <div className="text-[13px] font-medium leading-[1.45] text-(--ink)">
                {t(`howto.${gameType}.${i + 1}`)}
              </div>
            </div>
          ))}
          <button
            type="button"
            className="buzzer mt-1 rounded-xl px-4 py-3 text-sm"
            style={{
              background: `linear-gradient(180deg,${hue.gradFrom},${hue.gradTo})`,
              color: hue.ink,
              ["--buzzer-drop" as string]: hue.drop,
            }}
            onClick={onClose}
          >
            {t("common.gotIt").toUpperCase()}
          </button>
          {footer ? (
            <div className="text-center font-mono text-[10px] text-(--ink)/40">{footer}</div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
