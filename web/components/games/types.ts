import type { Player } from "@/lib/protocol";

/** Props every game screen receives from GameSurface. */
export type GameProps = {
  roomId: string;
  playerId: string;
  players: Player[];
  publicState: Record<string, unknown> | null;
  privateState: Record<string, unknown> | null;
  sendAction: (payload: Record<string, unknown>) => void;
  /** game.stream relay for canvas strokes — no state broadcast, no replies. */
  sendStream: (payload: Record<string, unknown>) => void;
  isAdmin: boolean;
};
