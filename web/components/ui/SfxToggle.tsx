"use client";

import { useEffect, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { isMuted, toggleMuted, onMuteChange } from "@/lib/sfx";

/** Small speaker button to mute/unmute the app's sound effects. */
export function SfxToggle({ className = "" }: { className?: string }) {
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    setMuted(isMuted());
    const off = onMuteChange(setMuted);
    return () => {
      off();
    };
  }, []);
  return (
    <button
      type="button"
      onClick={toggleMuted}
      aria-label={muted ? "Unmute sound" : "Mute sound"}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full border-2 border-(--line) bg-(--panel) text-(--ink) ${className}`}
      data-testid="sfx-toggle"
    >
      {muted ? <VolumeX size={18} strokeWidth={2.5} /> : <Volume2 size={18} strokeWidth={2.5} />}
    </button>
  );
}
