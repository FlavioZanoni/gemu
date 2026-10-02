"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** How long a fresh private state is ignored after a send: one that was
 *  already on the wire (another player's update) can't reflect our action. */
const GRACE_MS = 1200;
/** After this, the server's private state wins no matter what. */
const TIMEOUT_MS = 5000;

type Pending<T> = {
  id: number;
  key: string;
  value: T;
  /** The private state object current when the action was sent. */
  priv: unknown;
  graceOver: boolean;
  expired: boolean;
};

/**
 * Optimistic "I already sent that" state that can't get stuck. An action
 * can be lost (socket dropped, send refused while reconnecting), so the
 * optimistic value only bridges the gap until the server answers: it ends
 * when a private state newer than the send arrives (after a short grace for
 * updates already in flight) or after a timeout — from then on the caller
 * trusts the server's private state again.
 *
 * `mark(key, value, sent)`: `sent === false` (sendAction reported the
 * message was not sent) records nothing; `undefined` (no report) counts as
 * sent. `pending(key)` returns the value while still pending, else undefined.
 */
export function usePendingAction<T>(privateState: unknown) {
  const [state, setState] = useState<Pending<T> | null>(null);
  const nextId = useRef(0);
  const timers = useRef<number[]>([]);

  useEffect(
    () => () => {
      timers.current.forEach((timer) => window.clearTimeout(timer));
    },
    [],
  );

  const mark = useCallback(
    (key: string, value: T, sent?: unknown) => {
      if (sent === false) return;
      const id = ++nextId.current;
      setState({ id, key, value, priv: privateState, graceOver: false, expired: false });
      const update = (patch: Partial<Pending<T>>) =>
        setState((prev) => (prev && prev.id === id ? { ...prev, ...patch } : prev));
      timers.current = [
        ...timers.current.slice(-8),
        window.setTimeout(() => update({ graceOver: true }), GRACE_MS),
        window.setTimeout(() => update({ expired: true }), TIMEOUT_MS),
      ];
    },
    [privateState],
  );

  const pending = (key: string): T | undefined => {
    if (!state || state.key !== key || state.expired) return undefined;
    if (state.graceOver && state.priv !== privateState) return undefined;
    return state.value;
  };

  return { pending, mark };
}
