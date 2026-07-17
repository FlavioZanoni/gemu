"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import type { Player, RoomSnapshot, Standing } from "@/lib/protocol";
import { GameSurface } from "@/components/GameSurface";
import { Button, ScoreStrip, TimerBadge, HowToPlayModal } from "@/components/ui";
import { gamesCatalog } from "@/lib/games";

export function PlayingScreen({
  snapshot,
  players,
  playerId,
  standings,
  gamePublicState,
  gamePrivateState,
  isAdmin,
  onSendAction,
  onSendStream,
  onLeave,
}: {
  snapshot: RoomSnapshot;
  players: Player[];
  playerId: string | null;
  standings: Standing[];
  gamePublicState: Record<string, unknown> | null;
  gamePrivateState: Record<string, unknown> | null;
  isAdmin: boolean;
  onSendAction: (payload: Record<string, unknown>) => void;
  onSendStream: (payload: Record<string, unknown>) => void;
  onLeave: () => void;
}) {
  const { t } = useI18n();
  const [howToOpen, setHowToOpen] = useState(false);

  const game = gamesCatalog.find((g) => g.type === snapshot.gameType);
  const deadline =
    (gamePublicState?.deadline as number | undefined) || null;

  return (
    <div className="flex flex-col gap-4">
      {/* Header bar */}
      <div className="rounded-2xl border-2 border-(--line) bg-(--panel) p-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <h1 className="slab text-2xl truncate">
            {game?.name || snapshot.gameName}
          </h1>
          <p className="text-xs text-(--ink)/60">
            {snapshot.name} · {players.length} players
          </p>
        </div>

        {/* Timer and actions */}
        <div className="flex items-center gap-3">
          {deadline && <TimerBadge deadline={deadline} />}
          <button
            onClick={() => setHowToOpen(true)}
            className="text-xs px-3 py-2 rounded border border-(--line) text-(--accent-2) hover:bg-(--panel-raised) transition"
          >
            {t("playing.howToPlay")}
          </button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onLeave}
          >
            {t("common.leave")}
          </Button>
        </div>
      </div>

      {/* Score strip */}
      {standings.length > 0 && (
        <ScoreStrip standings={standings} players={players} playerId={playerId} />
      )}

      {/* Game surface */}
      <div className="rounded-2xl border-2 border-(--line) bg-(--panel) p-4">
        <GameSurface
          gameType={snapshot.gameType}
          roomId={snapshot.id}
          playerId={playerId ?? ""}
          players={players}
          publicState={gamePublicState || {}}
          privateState={gamePrivateState || {}}
          sendAction={onSendAction}
          sendStream={onSendStream}
          isAdmin={isAdmin}
          onLeave={onLeave}
        />
      </div>

      {/* How to play modal */}
      {game && (
        <HowToPlayModal
          open={howToOpen}
          gameType={game.type}
          gameName={game.name}
          stepCount={game.howToSteps}
          onClose={() => setHowToOpen(false)}
        />
      )}
    </div>
  );
}
