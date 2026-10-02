"use client";

import { useEffect, useRef, type ReactNode } from "react";

// Open modals, oldest first. Only the topmost one answers Escape and traps
// Tab, so closing a nested dialog leaves the one under it open.
const modalStack: symbol[] = [];

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Dark-stage overlay + centered panel. Children provide the panel content.
 * Escape and a backdrop tap close it; focus moves inside on open, stays
 * trapped while open, and returns to the opener on close.
 */
export function Modal({
  open,
  onClose,
  children,
  labelledBy,
  label,
  className = "max-w-sm",
}: {
  open: boolean;
  onClose?: () => void;
  children: ReactNode;
  /** id of the element that titles the dialog. */
  labelledBy?: string;
  /** Accessible name when there's no visible title element. */
  label?: string;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const token = Symbol("modal");
    modalStack.push(token);
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== token) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const head = items[0];
      const tail = items[items.length - 1];
      if (e.shiftKey && document.activeElement === head) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && document.activeElement === tail) {
        e.preventDefault();
        head.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const at = modalStack.indexOf(token);
      if (at !== -1) modalStack.splice(at, 1);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(18,9,24,.8)" }}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : label}
        tabIndex={-1}
        className={`pop-in max-h-[90dvh] w-full overflow-y-auto outline-none ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
