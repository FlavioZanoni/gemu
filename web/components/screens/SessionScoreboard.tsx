"use client";

import { useId, type ReactNode } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { Player, PlayedGame } from "@/lib/protocol";
import { hueFor, playerColorFor } from "@/components/ui/gameHues";
import { Avatar } from "@/components/ui/PlayerChip";
import { Modal } from "@/components/ui/Modal";

type BoardProps = {
  sessionScores: Record<string, number>;
  players: Player[];
  playedGames: PlayedGame[];
  playerId?: string | null;
};

// Placement → square opacity: the color says which game, the strength says
// how well you did in it.
const placeOpacity = (place: number) =>
  place === 0 ? 0.15 : place === 1 ? 1 : place === 2 ? 0.7 : place === 3 ? 0.45 : 0.3;

/** "Tonight's board": session points so far + per-game placement squares
 *  (Gemu Screens · 7). Pure content; wrap it in a screen or the modal. */
export function BoardView({
  sessionScores,
  players,
  playedGames,
  playerId,
  titleId,
}: BoardProps & { titleId?: string }) {
  const { t } = useI18n();
  const sortedPlayers = [...players].sort(
    (a, b) => (sessionScores[b.id] ?? 0) - (sessionScores[a.id] ?? 0),
  );

  return (
    <div className="flex w-full flex-col items-center" data-testid="session-board">
      <div className="mb-5 text-center">
        <div className="font-mono text-xs font-bold uppercase tracking-[0.4em] text-(--accent-2)">
          {t("board.after", { n: playedGames.length })}
        </div>
        <h2
          id={titleId}
          className="slab text-[clamp(28px,7vw,40px)] uppercase leading-tight"
          style={{ textShadow: "0 5px 0 var(--drop)" }}
        >
          {t("board.title")}
        </h2>
      </div>
      <ol className="flex w-full flex-col gap-2.5">
        {sortedPlayers.map((player, idx) => {
          const leader = idx === 0 && (sessionScores[player.id] ?? 0) > 0;
          const you = player.id === playerId;
          const ink = leader ? "var(--dark-ink)" : "var(--ink)";
          return (
            <li
              key={player.id}
              className="animate-rise flex min-w-0 items-center gap-3 rounded-2xl px-3 py-2.5 sm:gap-3.5 sm:px-4"
              style={{
                animationDelay: `${idx * 0.08}s`,
                background: leader ? "linear-gradient(180deg,#ffd23f,#f5b32a)" : "var(--panel)",
                border: leader ? "none" : "2px solid var(--line)",
                boxShadow: leader ? "0 5px 0 var(--drop)" : undefined,
              }}
            >
              <span
                className="w-6 flex-none text-center font-display text-lg"
                style={{ color: leader ? "var(--dark-ink)" : "rgba(255,233,168,.6)" }}
              >
                {idx + 1}
              </span>
              <Avatar
                player={player}
                color={playerColorFor(players.findIndex((p) => p.id === player.id))}
                size={42}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-bold" style={{ color: ink }}>
                  {player.name}
                  {you ? ` ${t("shell.youSuffix")}` : ""}
                </div>
                <div className="mt-1 flex flex-wrap gap-1" aria-hidden>
                  {playedGames.map((game, gi) => {
                    const place = game.standings.find((s) => s.playerId === player.id)?.place ?? 0;
                    return (
                      <span
                        key={gi}
                        className="h-3 w-3 rounded-[4px]"
                        style={{ background: hueFor(game.gameType).base, opacity: placeOpacity(place) }}
                        title={`${game.gameName} · ${place || "–"}`}
                      />
                    );
                  })}
                </div>
              </div>
              <span className="flex-none font-display text-[23px]" style={{ color: ink }}>
                {sessionScores[player.id] ?? 0}
              </span>
            </li>
          );
        })}
      </ol>
      {playedGames.length > 0 ? (
        <p className="mt-3 text-center font-mono text-[9px] uppercase tracking-[0.12em] text-(--ink)/35">
          {t("board.squaresNote")}
        </p>
      ) : null}
    </div>
  );
}

/** Tonight's board as an overlay (score peek / score strip tap). */
export function SessionScoreboard({
  open,
  onClose,
  footer,
  ...board
}: BoardProps & { open: boolean; onClose: () => void; footer?: ReactNode }) {
  const { t } = useI18n();
  const titleId = useId();
  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId} className="max-w-xl">
      <div className="relative rounded-3xl border-2 border-(--line) bg-(--bg) px-4 pb-5 pt-6 sm:px-7">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded-full p-2 text-(--ink)/60 transition hover:text-(--ink)"
          aria-label={t("common.close")}
        >
          <X size={22} strokeWidth={2.5} />
        </button>
        <BoardView {...board} titleId={titleId} />
        {footer ? <div className="mt-5">{footer}</div> : null}
      </div>
    </Modal>
  );
}

/** Between games: the board as a full screen with keep playing / end the
 *  night (host only; ending goes to the final podium). */
export function BoardScreen({
  isAdmin,
  onKeepPlaying,
  onEndNight,
  ...board
}: BoardProps & { isAdmin: boolean; onKeepPlaying: () => void; onEndNight: () => void }) {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col items-center py-8">
      <BoardView {...board} />
      <div className="mt-6 flex flex-wrap justify-center gap-3.5">
        <button
          type="button"
          onClick={onKeepPlaying}
          data-testid="board-keep-playing"
          className="buzzer rounded-[14px] border-2 border-(--ink) bg-(--panel) px-7 py-3.5 text-[15px] uppercase text-(--ink)"
          style={{ ["--buzzer-drop" as string]: "rgba(0,0,0,.4)" }}
        >
          {t("board.keepPlaying")}
        </button>
        {isAdmin ? (
          <button
            type="button"
            onClick={onEndNight}
            data-testid="results-end-night"
            className="buzzer rounded-[14px] px-7 py-3.5 text-[15px] uppercase text-white"
            style={{
              background: "linear-gradient(180deg,#ff6b85,#e84863)",
              ["--buzzer-drop" as string]: "#8f1f33",
            }}
          >
            {t("results.endTheNight")}
          </button>
        ) : null}
      </div>
      {isAdmin ? (
        <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-[0.12em] text-(--ink)/40">
          {t("board.hostOnlyNote")}
        </p>
      ) : null}
    </div>
  );
}
