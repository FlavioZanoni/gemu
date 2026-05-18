type RoomHeaderProps = {
  roomName: string;
  gameType: string;
  playerCount: number;
  maxPlayers: number;
  onLeave: () => void;
};

export function RoomHeader({
  roomName,
  gameType,
  playerCount,
  maxPlayers,
  onLeave,
}: RoomHeaderProps) {
  return (
    <header className="glass-panel retro-card flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
      <div>
        <h1 className="font-display text-2xl text-(--retro-cream)">
          {roomName}
        </h1>
        <p className="text-sm text-(--retro-cream)/75">
          Game: {gameType} · Players {playerCount}/{maxPlayers || "∞"}
        </p>
      </div>
      <div className="flex gap-3">
        <button
          className="retro-btn border-2 border-(--retro-cream) bg-(--surface) px-4 py-2 text-sm font-semibold text-(--retro-cream)"
          onClick={onLeave}
        >
          Leave room
        </button>
      </div>
    </header>
  );
}
