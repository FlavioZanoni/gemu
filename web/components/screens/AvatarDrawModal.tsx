"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Modal, Button } from "@/components/ui";
import { DrawingCanvas } from "@/components/DrawingCanvas";

// Full drawing surface (colors, shapes, brush sizes, undo/clear) for drawing
// your avatar. Saves the canvas as a PNG data URL.
export function AvatarDrawModal({
  open,
  initial,
  onClose,
  onSave,
}: {
  open: boolean;
  initial?: string;
  onClose: () => void;
  onSave: (dataUrl: string) => void;
}) {
  const { t } = useI18n();
  const canvasRef = useRef<{
    applyRemoteStroke: (action: unknown) => void;
    toDataURL: (type?: string, quality?: number) => string;
    clear: () => void;
    undo: () => void;
  } | null>(null);
  const [latest, setLatest] = useState<string>(initial ?? "");

  return (
    <Modal open={open} onClose={onClose}>
      <div className="overflow-hidden rounded-[20px] border-[3px] border-(--accent) bg-(--panel)">
        <div className="flex items-center justify-between bg-[linear-gradient(180deg,#ffd23f,#f5b32a)] px-5 py-3">
          <div className="font-display text-lg text-(--dark-ink)">
            {t("avatar.title")}
          </div>
          <button onClick={onClose} className="font-display text-(--dark-ink) flex items-center">
            <X size={20} strokeWidth={2.5} />
          </button>
        </div>

        <div className="px-5 py-4">
          {/* Constrain the tall (720×880) canvas so the toolbar + surface fit. */}
          <div className="mx-auto w-full max-w-[280px]">
            <DrawingCanvas
              ref={canvasRef}
              value={initial}
              onChange={setLatest}
              brushScale={5}
            />
          </div>
          <p className="mt-3 text-center font-mono text-[10px] text-(--ink)/45">
            {t("avatar.hint")}
          </p>
        </div>

        <div className="flex gap-2 border-t border-(--line) px-5 py-3">
          <Button variant="ghost" size="md" className="flex-1" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            size="md"
            className="flex-1"
            onClick={() => {
              const url = canvasRef.current?.toDataURL("image/png") ?? latest;
              if (url) onSave(url);
              onClose();
            }}
          >
            {t("avatar.save")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
