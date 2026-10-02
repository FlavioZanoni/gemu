"use client";

import { useId, useState } from "react";
import { Check, Layers, LogOut, Menu, Trophy, Users, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { CustomDeck, DeckMeta, Player, RoomSnapshot } from "@/lib/protocol";
import { gamesCatalog, gameLabel } from "@/lib/games";
import { hueFor } from "@/components/ui/gameHues";
import { PlayerChip } from "@/components/ui/PlayerChip";
import { Modal } from "@/components/ui/Modal";
import { LangToggle } from "@/components/ui/LangToggle";
import { SfxToggle } from "@/components/ui/SfxToggle";
import { SessionScoreboard } from "./SessionScoreboard";
import { DeckPicker } from "./DeckPicker";

/** Tonight's playlist as toggle cards. Everyone sees it; only the host can
 *  edit (never removing the last game). Games that need more players than
 *  are connected say so. */
export function PlaylistGrid({
  snapshot,
  isAdmin,
  connectedCount,
  onSetPlaylist,
  onOpenDecks,
}: {
  snapshot: RoomSnapshot;
  isAdmin: boolean;
  connectedCount: number;
  onSetPlaylist: (playlist: string[]) => void;
  onOpenDecks?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {gamesCatalog.map((game) => {
        const selected = snapshot.playlist.includes(game.type);
        const isLast = selected && snapshot.playlist.length <= 1;
        const hue = hueFor(game.type);
        const short = connectedCount < game.minPlayers;
        const editable = isAdmin && !isLast;
        return (
          <div key={game.type} className="relative min-w-0">
            <button
              type="button"
              data-testid={`game-card-${game.type}`}
              data-selected={selected}
              aria-pressed={selected}
              aria-disabled={!editable}
              disabled={!isAdmin}
              onClick={() => {
                if (!editable) return;
                onSetPlaylist(
                  selected
                    ? snapshot.playlist.filter((type) => type !== game.type)
                    : [...snapshot.playlist, game.type],
                );
              }}
              className={`flex h-full w-full min-w-0 flex-col items-start rounded-2xl p-3 text-left transition sm:p-4 ${
                editable ? "cursor-pointer" : "cursor-default"
              } ${selected ? "" : "border-2 border-(--line) opacity-60"} disabled:opacity-100`}
              style={{
                background: selected ? `linear-gradient(180deg, ${hue.gradFrom}, ${hue.gradTo})` : "transparent",
                boxShadow: selected ? `0 5px 0 ${hue.drop}` : undefined,
                color: selected ? hue.ink : "var(--ink)",
                opacity: !selected ? 0.6 : 1,
              }}
            >
              <span className="block max-w-full truncate font-display text-base uppercase sm:text-lg">
                {gameLabel(game.type, t, game.name)}
              </span>
              <span className="mt-0.5 font-mono text-[10px] font-semibold uppercase" style={{ opacity: 0.7 }}>
                {game.players} · {t(`gameTag.${game.type}`)}
              </span>
              {selected ? (
                <span className="mt-1.5 flex items-center gap-1 text-xs font-bold">
                  <Check size={13} strokeWidth={2.5} aria-hidden /> {t("lobby.inPlaylist")}
                </span>
              ) : null}
              {short ? (
                <span
                  className="mt-1 rounded-full px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase"
                  style={{
                    background: selected ? "rgba(0,0,0,.18)" : "transparent",
                    color: selected ? hue.ink : "var(--danger)",
                  }}
                  data-testid={`needs-players-${game.type}`}
                >
                  {t("lobby.needsPlayers", { n: game.minPlayers })}
                </span>
              ) : null}
            </button>
            {/* CAH: the host tunes the deck set. */}
            {game.type === "cah" && selected && isAdmin && onOpenDecks ? (
              <button
                type="button"
                onClick={onOpenDecks}
                className="absolute right-2 top-2 flex items-center gap-1 rounded-full border-2 px-2 py-0.5 font-mono text-[10px] font-bold"
                style={{ borderColor: hue.ink, color: hue.ink }}
                data-testid="open-decks"
              >
                <Layers size={12} strokeWidth={2.5} aria-hidden /> {t("decks.button")}
                {snapshot.cahDeckIds.length > 0 ? ` · ${snapshot.cahDeckIds.length}` : ""}
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** Contestant chips; the host gets a coral ✕ to kick anyone else. */
export function ContestantList({
  snapshot,
  players,
  isAdmin,
  onKick,
  showSpots = false,
}: {
  snapshot: RoomSnapshot;
  players: Player[];
  isAdmin: boolean;
  onKick?: (playerId: string) => void;
  showSpots?: boolean;
}) {
  const { t } = useI18n();
  const spots = snapshot.maxPlayers > 0 ? Math.max(0, snapshot.maxPlayers - players.length) : 0;
  return (
    <div className="flex flex-col gap-2">
      {players.map((player, idx) => (
        <PlayerChip
          key={player.id}
          player={player}
          colorIndex={idx}
          isHost={player.id === snapshot.adminId}
          trailing={
            isAdmin && player.id !== snapshot.adminId && onKick ? (
              <button
                type="button"
                onClick={() => onKick(player.id)}
                aria-label={t("lobby.kickName", { name: player.name })}
                data-testid={`kick-${player.name}`}
                className="ml-1 flex h-7 w-7 flex-none items-center justify-center rounded-full text-(--danger) hover:bg-(--danger)/15"
              >
                <X size={16} strokeWidth={3} aria-hidden />
              </button>
            ) : null
          }
        />
      ))}
      {showSpots && spots > 0 ? (
        <div className="rounded-full border-2 border-dashed border-(--line) px-4 py-2.5 text-center font-mono text-[11px] text-(--ink)/45">
          {t("lobby.moreSpots", { n: spots })}
        </div>
      ) : null}
    </div>
  );
}

/** Host sheet for the playlist, CAH decks and contestants — reachable on the
 *  intro and results screens too (the server accepts playlist edits in the
 *  lobby and on results). */
export function ManageSheet({
  open,
  onClose,
  snapshot,
  players,
  isAdmin,
  decks,
  deckAdd,
  onSetPlaylist,
  onKick,
  onSetCahDecks,
  onAddCustomDeck,
}: {
  open: boolean;
  onClose: () => void;
  snapshot: RoomSnapshot;
  players: Player[];
  isAdmin: boolean;
  decks: DeckMeta[];
  deckAdd: { seq: number; status: "pending" | "ok" | "error"; message?: string } | null;
  onSetPlaylist: (playlist: string[]) => void;
  onKick: (playerId: string) => void;
  onSetCahDecks: (ids: string[]) => void;
  onAddCustomDeck: (deck: CustomDeck) => number;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const [decksOpen, setDecksOpen] = useState(false);
  const connectedCount = players.filter((p) => p.connected).length;
  const playlistEditable = snapshot.status === "lobby" || snapshot.status === "results";

  return (
    <>
      <Modal open={open && !decksOpen} onClose={onClose} labelledBy={titleId} className="max-w-xl">
        <div className="rounded-3xl border-2 border-(--line) bg-(--bg) p-4 sm:p-6" data-testid="manage-sheet">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 id={titleId} className="slab text-2xl">
              {t("manage.title")}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("common.close")}
              className="rounded-full p-2 text-(--ink)/60 hover:text-(--ink)"
            >
              <X size={22} strokeWidth={2.5} />
            </button>
          </div>
          {playlistEditable ? (
            <>
              <div className="mono-caption mb-2.5" style={{ color: "rgba(255,233,168,.5)" }}>
                {t("lobby.playlist")}
              </div>
              <PlaylistGrid
                snapshot={snapshot}
                isAdmin={isAdmin}
                connectedCount={connectedCount}
                onSetPlaylist={onSetPlaylist}
                onOpenDecks={() => setDecksOpen(true)}
              />
            </>
          ) : null}
          <div className="mono-caption mb-2.5 mt-5" style={{ color: "rgba(255,233,168,.5)" }}>
            {t("lobby.contestants")}
          </div>
          <ContestantList snapshot={snapshot} players={players} isAdmin={isAdmin} onKick={onKick} />
        </div>
      </Modal>
      <DeckPicker
        open={open && decksOpen}
        onClose={() => setDecksOpen(false)}
        decks={decks}
        selected={snapshot.cahDeckIds}
        deckAdd={deckAdd}
        onToggle={(id) => {
          const base = decks.filter((d) => d.id.startsWith("base_")).map((d) => d.id);
          const current = snapshot.cahDeckIds.length > 0 ? snapshot.cahDeckIds : base;
          onSetCahDecks(current.includes(id) ? current.filter((d) => d !== id) : [...current, id]);
        }}
        onAddCustom={onAddCustomDeck}
      />
    </>
  );
}

/** "#2 · 175" — my session rank and points; taps open tonight's board. */
export function ScorePeek({
  snapshot,
  players,
  playerId,
  footer,
}: {
  snapshot: RoomSnapshot;
  players: Player[];
  playerId: string | null;
  footer?: React.ReactNode;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const scores = snapshot.sessionScores ?? {};
  const mine = playerId ? (scores[playerId] ?? 0) : 0;
  // Competition rank: ties share a place.
  const rank = 1 + players.filter((p) => (scores[p.id] ?? 0) > mine).length;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="score-peek"
        aria-label={t("shell.scorePeekLabel", { rank, points: mine })}
        className="flex-none whitespace-nowrap rounded-full border-2 border-(--line) bg-(--bg) px-2.5 py-1.5 font-mono text-[11px] font-bold text-(--ink) sm:px-3"
      >
        #{rank} · {mine}
      </button>
      <SessionScoreboard
        open={open}
        onClose={() => setOpen(false)}
        sessionScores={scores}
        players={players}
        playedGames={snapshot.playedGames ?? []}
        playerId={playerId}
        footer={footer}
      />
    </>
  );
}

/** The room menu (⋮): sound, language, tonight's board, the host's
 *  playlist & players sheet, and Leave — reachable on every screen. */
export function RoomMenu({
  snapshot,
  players,
  playerId,
  isAdmin,
  onLeave,
  onManage,
}: {
  snapshot: RoomSnapshot;
  players: Player[];
  playerId: string | null;
  isAdmin: boolean;
  onLeave: () => void;
  onManage?: () => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const item =
    "flex w-full items-center gap-3 rounded-2xl border-2 border-(--line) bg-(--panel) px-4 py-3 text-left text-sm font-bold text-(--ink) hover:border-(--accent-2)";
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("shell.menu")}
        aria-haspopup="dialog"
        data-testid="room-menu"
        className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-full border-2 border-(--line) bg-(--panel) text-(--ink)"
      >
        <Menu size={18} strokeWidth={2.5} aria-hidden />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} labelledBy={titleId}>
        <div className="rounded-3xl border-2 border-(--line) bg-(--bg) p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 id={titleId} className="min-w-0 truncate font-display text-lg text-(--ink)">
              {snapshot.name}
            </h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t("common.close")}
              className="rounded-full p-1.5 text-(--ink)/60 hover:text-(--ink)"
            >
              <X size={20} strokeWidth={2.5} />
            </button>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SfxToggle />
            <LangToggle />
            {snapshot.joinCode ? (
              <span className="ml-auto font-mono text-xs font-bold tracking-[0.25em] text-(--ink)/70">
                {snapshot.joinCode}
              </span>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              className={item}
              onClick={() => {
                setOpen(false);
                setBoardOpen(true);
              }}
              data-testid="menu-board"
            >
              <Trophy size={18} strokeWidth={2.5} aria-hidden className="text-(--accent)" />
              {t("board.title")}
            </button>
            {isAdmin && onManage ? (
              <button
                type="button"
                className={item}
                onClick={() => {
                  setOpen(false);
                  onManage();
                }}
                data-testid="menu-manage"
              >
                <Users size={18} strokeWidth={2.5} aria-hidden className="text-(--accent-2)" />
                {t("manage.title")}
              </button>
            ) : null}
            <button
              type="button"
              className={`${item} border-(--danger)/60 text-[#ffb3c1] hover:border-(--danger)`}
              onClick={() => {
                setOpen(false);
                onLeave();
              }}
              data-testid="leave-room"
            >
              <LogOut size={18} strokeWidth={2.5} aria-hidden />
              {t("shell.leaveRoom")}
            </button>
          </div>
        </div>
      </Modal>
      <SessionScoreboard
        open={boardOpen}
        onClose={() => setBoardOpen(false)}
        sessionScores={snapshot.sessionScores ?? {}}
        players={players}
        playedGames={snapshot.playedGames ?? []}
        playerId={playerId}
      />
    </>
  );
}
