import { InventionGame } from "./games/InventionGame";

type GameSurfaceProps = {
  gameType: string;
  roomId: string;
  playerId: string;
  players: { id: string; name: string }[];
  publicState: Record<string, unknown> | null;
  privateState: Record<string, unknown> | null;
  sendAction: (payload: Record<string, unknown>) => void;
  onFullscreenToggle?: () => void;
  isAdmin?: boolean;
  onLeave?: () => void;
};

export function GameSurface({
  gameType,
  roomId,
  playerId,
  players,
  publicState,
  privateState,
  sendAction,
  onFullscreenToggle,
  isAdmin,
  onLeave,
}: GameSurfaceProps) {
  if (gameType === "invention") {
    return (
      <InventionGame
        roomId={roomId}
        playerId={playerId}
        players={players}
        publicState={publicState}
        privateState={privateState}
        sendAction={sendAction}
        onFullscreenToggle={onFullscreenToggle}
        isAdmin={isAdmin}
        onLeave={onLeave}
      />
    );
  }

  return (
    <section className="glass-panel retro-card min-h-[80vh] p-6">
      <h2 className="font-display text-lg text-(--retro-cream)">
        Game surface
      </h2>
      <p className="mt-2 text-sm text-(--retro-cream)/75">
        The shared room shell is ready. Drop the {gameType} UI here.
      </p>
      <div className="mt-6 rounded-2xl border-2 border-dashed border-(--retro-cream) bg-(--surface) p-8 text-center text-sm text-(--retro-cream)/70">
        Waiting for game adapter UI…
      </div>
    </section>
  );
}
