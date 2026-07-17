"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import type { Player, RoomSnapshot } from "@/lib/protocol";
import { gamesCatalog } from "@/lib/games";
import {
  Button,
  Card,
  Marquee,
  PlayerChip,
  HowToPlayModal,
} from "@/components/ui";

export function LobbyScreen({
  snapshot,
  players,
  isAdmin,
  currentPlayer,
  onSetReady,
  onStartGame,
  onSetPlaylist,
  onLeave,
}: {
  snapshot: RoomSnapshot;
  players: Player[];
  isAdmin: boolean;
  currentPlayer: Player | undefined;
  onSetReady: (ready: boolean) => void;
  onStartGame: (force: boolean) => void;
  onSetPlaylist: (playlist: string[]) => void;
  onLeave: () => void;
}) {
  const { t } = useI18n();
  const [howToOpen, setHowToOpen] = useState(false);

  const connectedPlayers = useMemo(
    () => players.filter((p) => p.connected),
    [players]
  );
  const readyPlayers = useMemo(
    () => connectedPlayers.filter((p) => p.ready),
    [connectedPlayers]
  );
  const allReadyAndConnected =
    connectedPlayers.length >= 2 &&
    readyPlayers.length === connectedPlayers.length;

  const nextGame = gamesCatalog.find((g) => g.type === snapshot.nextGameType);
  const canStart =
    connectedPlayers.length >= (nextGame?.minPlayers ?? 2) &&
    (allReadyAndConnected || isAdmin);

  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[1fr_3fr]">
      {/* Players sidebar */}
      <aside className="rounded-2xl border-2 border-(--line) bg-(--panel) p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="slab text-xl">Players</h2>
          <span className="mono-caption">
            {readyPlayers.length}/{connectedPlayers.length}
          </span>
        </div>
        <div className="space-y-3 max-h-[65vh] overflow-y-auto">
          {players.map((player, idx) => (
            <PlayerChip
              key={player.id}
              player={player}
              colorIndex={idx}
              isHost={player.id === snapshot.adminId}
              trailing={
                isAdmin && player.id !== snapshot.adminId ? (
                  <button
                    onClick={() => {}}
                    className="text-xs px-2 py-1 rounded border border-(--line) text-(--ink)/70 hover:text-(--ink)"
                  >
                    {t("common.kick")}
                  </button>
                ) : null
              }
            />
          ))}
        </div>
      </aside>

      {/* Main content */}
      <main className="rounded-2xl border-2 border-(--line) bg-(--panel) p-6 flex flex-col gap-6">
        {/* Playlist section (admin only) */}
        {isAdmin && (
          <section className="border-b border-(--line) pb-6">
            <h3 className="slab text-lg mb-3">{t("lobby.playlist")}</h3>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
              {gamesCatalog.map((game) => {
                const selected = snapshot.playlist.includes(game.type);
                const disabled =
                  connectedPlayers.length < game.minPlayers && !selected;
                return (
                  <Card
                    key={game.type}
                    variant={selected ? "selected" : "panel"}
                    gameType={game.type}
                    className={`cursor-pointer transition ${
                      disabled ? "opacity-50 cursor-not-allowed" : ""
                    }`}
                    onClick={() => {
                      if (disabled) return;
                      const newPlaylist = selected
                        ? snapshot.playlist.filter((t) => t !== game.type)
                        : [...snapshot.playlist, game.type];
                      onSetPlaylist(newPlaylist);
                    }}
                  >
                    <div className="text-sm font-bold text-(--ink)">
                      {game.name}
                    </div>
                    {disabled && (
                      <div className="text-xs text-(--ink)/60 mt-1">
                        {t("lobby.tooFewPlayers", {
                          min: game.minPlayers,
                        })}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          </section>
        )}

        {/* Waiting area */}
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-6 text-center">
          <div>
            <h2 className="slab text-3xl">{t("lobby.waitingRoom")}</h2>
            <p className="text-(--ink)/70 text-sm mt-2">
              {allReadyAndConnected
                ? t("lobby.allReady")
                : t("lobby.waitingDesc")}
            </p>
          </div>

          {/* Next game marquee */}
          {nextGame && (
            <Marquee caption={t("lobby.upNext")}>
              {nextGame.name.toUpperCase()}
            </Marquee>
          )}

          {/* Ready/Start buttons */}
          <div className="flex gap-3 flex-wrap justify-center">
            <Button
              variant={currentPlayer?.ready ? "primary" : "secondary"}
              onClick={() => onSetReady(!currentPlayer?.ready)}
            >
              {currentPlayer?.ready ? "✓ Ready" : t("lobby.readyUp")}
            </Button>

            {isAdmin && !allReadyAndConnected && (
              <Button
                variant="secondary"
                disabled={!canStart}
                onClick={() => onStartGame(true)}
              >
                {t("lobby.forceStart")}
              </Button>
            )}

            {isAdmin && (
              <Button
                variant="primary"
                disabled={!canStart}
                onClick={() => {
                  if (nextGame?.howToSteps) {
                    setHowToOpen(true);
                  } else {
                    onStartGame(false);
                  }
                }}
              >
                {t("lobby.startGame")}
              </Button>
            )}

            <Button variant="ghost" onClick={onLeave}>
              {t("common.leave")}
            </Button>
          </div>
        </div>
      </main>

      {/* Modals */}
      {nextGame && (
        <HowToPlayModal
          open={howToOpen}
          gameType={nextGame.type}
          gameName={nextGame.name}
          stepCount={nextGame.howToSteps}
          onClose={() => {
            setHowToOpen(false);
            onStartGame(false);
          }}
        />
      )}
    </div>
  );
}
