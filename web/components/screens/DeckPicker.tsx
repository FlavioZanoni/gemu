"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import type { CustomDeck, DeckMeta } from "@/lib/protocol";
import { Modal, Button } from "@/components/ui";

// Host-facing CAH deck selector: tick built-in/custom decks (merged when
// playing) and paste a custom deck in Gemu's JSON format.
export function DeckPicker({
  open,
  onClose,
  decks,
  selected,
  onToggle,
  onAddCustom,
}: {
  open: boolean;
  onClose: () => void;
  decks: DeckMeta[];
  selected: string[];
  onToggle: (id: string) => void;
  onAddCustom: (deck: CustomDeck) => void;
}) {
  const { t } = useI18n();
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);

  const effectiveSelected =
    selected.length > 0
      ? selected
      : decks.filter((d) => d.id.startsWith("base_")).map((d) => d.id);

  const submitPaste = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(pasteText);
    } catch {
      setPasteError(t("decks.badJson"));
      return;
    }
    const deck = parsed as Partial<CustomDeck>;
    if (
      !deck ||
      typeof deck.name !== "string" ||
      !Array.isArray(deck.black) ||
      !Array.isArray(deck.white)
    ) {
      setPasteError(t("decks.badShape"));
      return;
    }
    onAddCustom(deck as CustomDeck);
    setPasteText("");
    setPasteError(null);
    setShowPaste(false);
  };

  return (
    <Modal open={open} onClose={onClose}>
      <div className="overflow-hidden rounded-[20px] border-[3px] border-(--hue-cah) bg-(--panel)">
        <div className="flex items-center justify-between bg-[linear-gradient(180deg,#ff6b85,#e84863)] px-5 py-4">
          <div className="font-display text-lg text-white">{t("decks.title")}</div>
          <button onClick={onClose} className="font-display text-white/90">
            ✕
          </button>
        </div>

        <div className="max-h-[55vh] overflow-y-auto px-5 py-4">
          <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-(--ink)/50">
            {t("decks.pickHint")}
          </div>
          <div className="flex flex-col gap-2">
            {decks.map((deck) => {
              const on = effectiveSelected.includes(deck.id);
              return (
                <button
                  key={deck.id}
                  type="button"
                  onClick={() => onToggle(deck.id)}
                  className={`flex items-center gap-3 rounded-xl border-2 px-3 py-2.5 text-left transition ${
                    on
                      ? "border-(--hue-cah) bg-(--hue-cah)/10"
                      : "border-(--line) opacity-70"
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 flex-none items-center justify-center rounded-md border-2 ${
                      on ? "border-(--hue-cah) bg-(--hue-cah)" : "border-(--line)"
                    }`}
                  >
                    {on ? <span className="text-[11px] text-(--bg)">✓</span> : null}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-bold text-(--ink)">
                        {deck.name}
                      </span>
                      {deck.nsfw ? (
                        <span className="flex-none rounded-full bg-(--hue-cah) px-1.5 py-0.5 font-mono text-[9px] font-bold text-white">
                          18+
                        </span>
                      ) : null}
                      {deck.id.startsWith("custom:") ? (
                        <span className="flex-none rounded-full border border-(--accent-2) px-1.5 py-0.5 font-mono text-[9px] text-(--accent-2)">
                          {t("decks.custom")}
                        </span>
                      ) : null}
                    </div>
                    <div className="font-mono text-[10px] text-(--ink)/45">
                      {deck.locale} · {deck.black} + {deck.white} {t("decks.cards")}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {showPaste ? (
            <div className="mt-4 rounded-xl border-2 border-(--line) bg-(--bg-deep) p-3">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-(--ink)/50">
                {t("decks.pasteLabel")}
              </div>
              <textarea
                value={pasteText}
                onChange={(e) => {
                  setPasteText(e.target.value);
                  setPasteError(null);
                }}
                rows={6}
                placeholder={t("decks.pastePlaceholder")}
                className="w-full rounded-lg border-2 border-(--line) bg-(--panel) p-2 font-mono text-xs text-(--ink) focus:border-(--accent-2) focus:outline-none"
              />
              {pasteError ? (
                <p className="mt-1 text-xs text-[#ffb3c1]">{pasteError}</p>
              ) : null}
              <div className="mt-2 flex gap-2">
                <Button variant="hue" gameType="cah" size="sm" onClick={submitPaste}>
                  {t("decks.addDeck")}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowPaste(false)}>
                  {t("common.cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowPaste(true)}
              className="mt-4 w-full rounded-xl border-2 border-dashed border-(--line) px-3 py-2.5 font-mono text-[11px] font-bold uppercase tracking-wider text-(--ink)/60 hover:border-(--accent-2) hover:text-(--accent-2)"
            >
              + {t("decks.importCustom")}
            </button>
          )}
        </div>

        <div className="border-t border-(--line) px-5 py-3">
          <Button variant="hue" gameType="cah" className="w-full" onClick={onClose}>
            {t("decks.done")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
