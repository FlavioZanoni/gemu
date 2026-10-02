"use client";

import { useSyncExternalStore } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { isMuted, toggleMuted, onMuteChange } from "@/lib/sfx";

const subscribe = (fn: () => void) => onMuteChange(() => fn());

/** Small speaker button to mute/unmute the app's sound effects. */
export function SfxToggle({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  const muted = useSyncExternalStore(subscribe, isMuted, () => false);
  return (
    <button
      type="button"
      onClick={toggleMuted}
      aria-label={muted ? t("sfx.unmute") : t("sfx.mute")}
      aria-pressed={muted}
      className={`inline-flex h-9 w-9 flex-none items-center justify-center rounded-full border-2 border-(--line) bg-(--panel) text-(--ink) ${className}`}
      data-testid="sfx-toggle"
    >
      {muted ? <VolumeX size={18} strokeWidth={2.5} /> : <Volume2 size={18} strokeWidth={2.5} />}
    </button>
  );
}
