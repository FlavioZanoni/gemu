"use client";

import { useMemo, useState } from "react";
import { Check, Layers } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { CustomDeck, DeckMeta, Player, RoomSnapshot } from "@/lib/protocol";
import { gamesCatalog } from "@/lib/games";
import { DeckPicker } from "./DeckPicker";
import { hueFor } from "@/components/ui/gameHues";
import {
  Button,
  Card,
  PlayerChip,
  HowToPlayModal,
  CodePill,
  LangToggle,
  SfxToggle,
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
  onKick,
  decks,
  onSetCahDecks,
  onAddCustomDeck,
}: {
  snapshot: RoomSnapshot;
  players: Player[];
  isAdmin: boolean;
  currentPlayer: Player | undefined;
  onSetReady: (ready: boolean) => void;
  onStartGame: (force: boolean) => void;
  onSetPlaylist: (playlist: string[]) => void;
  onLeave: () => void;
  onKick?: (playerId: string) => void;
  decks: DeckMeta[];
  onSetCahDecks: (ids: string[]) => void;
  onAddCustomDeck: (deck: CustomDeck) => void;
}) {
  const { t } = useI18n();
  const [howToOpen, setHowToOpen] = useState(false);
  const [deckPickerOpen, setDeckPickerOpen] = useState(false);

  const toggleDeck = (id: string) => {
    const base = decks.filter((d) => d.id.startsWith("base_")).map((d) => d.id);
    const current = snapshot.cahDeckIds.length > 0 ? snapshot.cahDeckIds : base;
    const next = current.includes(id)
      ? current.filter((d) => d !== id)
      : [...current, id];
    onSetCahDecks(next);
  };

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
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-5 justify-between flex-wrap">
        <div>
          <h1 className="slab text-4xl">{snapshot.name}</h1>
          <p className="text-xs text-(--ink)/60 mt-2 uppercase tracking-widest font-mono">
            Green room · Waiting to start
          </p>
        </div>
        <div className="flex items-center gap-3">
          {snapshot.joinCode && (
            <CodePill code={snapshot.joinCode} label="CODE" />
          )}
          <SfxToggle />
          <LangToggle />
        </div>
      </div>

      {/* Main content grid */}
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        {/* Left: Playlist and controls */}
        <div>
          {/* Playlist section — everyone sees tonight's lineup; only the host
              can edit it. */}
          {(
            <div className="mb-6">
              <div className="flex items-baseline gap-2 mb-3">
                <span className="mono-caption">Tonight&apos;s playlist</span>
              </div>
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 mb-6">
                {gamesCatalog.map((game) => {
                  const selected = snapshot.playlist.includes(game.type);
                  // The night's playlist can hold any games — the per-game
                  // minimum is enforced at start / vote time, not here. The
                  // only guard: never let the last game be removed.
                  const isLast = selected && snapshot.playlist.length <= 1;
                  const hue = hueFor(game.type);
                  return (
                    <div
                      key={game.type}
                      data-testid={`game-card-${game.type}`}
                      data-selected={selected}
                      onClick={() => {
                        if (!isAdmin || isLast) return;
                        const newPlaylist = selected
                          ? snapshot.playlist.filter((t) => t !== game.type)
                          : [...snapshot.playlist, game.type];
                        onSetPlaylist(newPlaylist);
                      }}
                      className={`rounded-2xl p-4 transition ${
                        isAdmin && !isLast ? "cursor-pointer" : "cursor-default"
                      } ${
                        selected
                          ? "border-2 border-(--line) shadow-lg"
                          : "border-2 border-(--line) opacity-60"
                      }`}
                      style={{
                        background: selected
                          ? `linear-gradient(180deg, ${hue.gradFrom}, ${hue.gradTo})`
                          : "transparent",
                        boxShadow: selected
                          ? `0 5px 0 ${hue.drop}`
                          : undefined,
                      }}
                    >
                      <div
                        className="slab text-lg"
                        style={{
                          color: selected ? hue.ink : "inherit",
                        }}
                      >
                        {game.name}
                      </div>
                      <div
                        className="text-xs mt-1"
                        style={{
                          color: selected ? hue.ink + "a6" : "inherit",
                        }}
                      >
                        {game.players} · {game.tag}
                      </div>
                      {selected && (
                        <div
                          className="text-xs font-bold mt-2 flex items-center gap-1"
                          style={{ color: hue.ink }}
                        >
                          <Check size={14} strokeWidth={2.5} /> in playlist
                        </div>
                      )}
                      {/* CAH: a decks button (host tunes the deck set). */}
                      {game.type === "cah" && selected && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeckPickerOpen(true);
                          }}
                          className="mt-2 rounded-full border-2 px-2.5 py-1 font-mono text-[10px] font-bold flex items-center gap-1"
                          style={{ borderColor: hue.ink, color: hue.ink }}
                          data-testid="open-decks"
                        >
                          <Layers size={14} strokeWidth={2.5} /> {t("decks.button")}
                          {snapshot.cahDeckIds.length > 0
                            ? ` · ${snapshot.cahDeckIds.length}`
                            : ""}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <DeckPicker
            open={deckPickerOpen}
            onClose={() => setDeckPickerOpen(false)}
            decks={decks}
            selected={snapshot.cahDeckIds}
            onToggle={toggleDeck}
            onAddCustom={onAddCustomDeck}
          />

          {/* Ready/Start buttons */}
          <div className="flex gap-3 flex-wrap">
            <Button
              variant={currentPlayer?.ready ? "primary" : "secondary"}
              onClick={() => onSetReady(!currentPlayer?.ready)}
              className="text-lg py-5 flex items-center gap-2"
              data-testid="ready-up"
            >
              {currentPlayer?.ready ? <><Check size={18} strokeWidth={2.5} /> {t("common.ready")}</> : t("lobby.readyUp")}
            </Button>

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
                className="text-lg py-5 flex-1"
                data-testid="start-game"
              >
                {t("lobby.startGame")} ▶
              </Button>
            )}
          </div>

          <p className="text-center text-xs text-(--ink)/60 mt-3 uppercase tracking-widest font-mono">
            First game is drawn at random from the playlist
          </p>
        </div>

        {/* Right: Players list */}
        <aside>
          <div className="flex justify-between items-baseline mb-3">
            <span className="mono-caption">Contestants</span>
            <span className="text-xs font-bold text-(--accent-2)">
              {readyPlayers.length}/{connectedPlayers.length}
            </span>
          </div>
          <div className="space-y-2 max-h-[65vh] overflow-y-auto">
            {players.map((player, idx) => (
              <PlayerChip
                key={player.id}
                player={player}
                colorIndex={idx}
                isHost={player.id === snapshot.adminId}
                trailing={
                  isAdmin && player.id !== snapshot.adminId ? (
                    <button
                      onClick={() => onKick?.(player.id)}
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
      </div>

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
