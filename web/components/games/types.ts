import type { Player } from "@/lib/protocol";

/** Props every game screen receives from GameSurface. */
export type GameProps = {
  playerId: string;
  players: Player[];
  publicState: Record<string, unknown> | null;
  privateState: Record<string, unknown> | null;
  /**
   * Sends a game.action. Returns false when it couldn't go out (socket down:
   * the room shows a "reconnecting — try again" toast); undo any optimistic
   * "sent" state then.
   */
  sendAction: (payload: Record<string, unknown>) => boolean;
  /** game.stream relay for canvas strokes — no state broadcast, no replies. */
  sendStream: (payload: Record<string, unknown>) => void;
  isAdmin: boolean;
};
