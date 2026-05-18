import type { Player } from "../lib/protocol";

type PlayerListProps = {
  players: Player[];
  adminId: string;
  isAdmin: boolean;
  onKick: (playerId: string) => void;
  readyCount: number;
  connectedCount: number;
  showReady: boolean;
};

export function PlayerList({
  players,
  adminId,
  isAdmin,
  onKick,
  readyCount,
  connectedCount,
  showReady,
}: PlayerListProps) {
  if (players.length === 0) {
    return (
      <aside className="glass-panel retro-card min-h-[80vh] p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg text-(--retro-cream)">Players</h2>
          {showReady ? (
            <div className="text-xs text-(--retro-cream)/70">
              Ready {readyCount}/{connectedCount}
            </div>
          ) : null}
        </div>
        <p className="mt-4 text-sm text-(--retro-cream)/70">No players yet</p>
      </aside>
    );
  }

  return (
    <aside className="glass-panel retro-card min-h-[80vh] p-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg text-(--retro-cream)">Players</h2>
        {showReady ? (
          <div className="text-xs text-(--retro-cream)/70">
            Ready {readyCount}/{connectedCount}
          </div>
        ) : null}
      </div>
      <div className="mt-4 max-h-[65vh] space-y-3 overflow-y-auto pr-1">
        {players.map((player) => (
          <div
            key={player.id}
            className={`flex items-center justify-between rounded-2xl border-2 border-(--retro-cream) bg-(--surface) px-4 py-3 ${
              player.connected ? "" : "opacity-50"
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 overflow-hidden rounded-full border-2 border-(--retro-cream) bg-(--surface-2)">
                {player.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={player.avatarUrl}
                    alt={player.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-(--retro-cream)/60">
                    ?
                  </div>
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-(--retro-cream)">
                    {player.name}
                  </p>
                  {adminId === player.id ? (
                    <span className="flex items-center gap-1 rounded-full border-2 border-(--retro-cream) bg-(--surface-2) px-2 py-0.5 text-[10px] text-(--retro-cream)">
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        className="h-3 w-3"
                        fill="currentColor"
                      >
                        <path d="M3 7l4.5 4.5L12 4l4.5 7.5L21 7l-2 11H5L3 7z" />
                      </svg>
                      Admin
                    </span>
                  ) : null}
                  {showReady && player.ready ? (
                    <span className="rounded-full border-2 border-(--accent-2) bg-(--surface-2) px-2 py-0.5 text-[10px] text-(--accent-2)">
                      Ready
                    </span>
                  ) : null}
                </div>
                {!player.connected ? (
                  <p className="text-xs text-(--accent-3)">Disconnected</p>
                ) : null}
              </div>
            </div>
            {isAdmin && player.id !== adminId ? (
              <button
                className="retro-btn border-2 border-(--retro-cream) bg-(--surface) px-3 py-1 text-xs text-(--retro-cream)"
                onClick={() => onKick(player.id)}
              >
                Kick
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </aside>
  );
}
