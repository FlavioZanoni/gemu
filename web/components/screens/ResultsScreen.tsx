"use client";

import { Volume2, Repeat, ArrowRight, Trophy, Users } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { GameResult, Player } from "@/lib/protocol";
import { gamesCatalog, gameLabel } from "@/lib/games";
import { Avatar } from "@/components/ui/PlayerChip";
import { playerColorFor } from "@/components/ui/gameHues";

/** Game results (Gemu Screens · 5): this game's standings with the session
 *  points each place earned; the host picks what's next. */
export function ResultsScreen({
  gameResult,
  players,
  playerId,
  isAdmin,
  onPlayAgain,
  onVoteNext,
  onOpenBoard,
  onManage,
}: {
  gameResult: GameResult;
  players: Player[];
  playerId: string | null;
  isAdmin: boolean;
  onPlayAgain: () => void;
  onVoteNext: () => void;
  onOpenBoard: () => void;
  onManage?: () => void;
}) {
  const { t } = useI18n();
  const game = gamesCatalog.find((g) => g.type === gameResult.gameType);
  const name = (game ? gameLabel(game.type, t, game.name) : gameResult.gameName).toUpperCase();
  const rows = gameResult.standings;

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-1 flex-col items-center justify-center gap-5 py-8" data-testid="results-screen">
      <div className="text-center">
        <div className="mb-1 flex items-center justify-center gap-2 font-mono text-xs font-bold uppercase tracking-[0.4em] text-(--accent-2)">
          {t("results.gameOver")} <Volume2 size={14} strokeWidth={2.5} aria-hidden />
        </div>
        <h1 className="slab text-[clamp(28px,7vw,40px)] uppercase leading-tight" style={{ textShadow: "0 5px 0 var(--drop)" }}>
          {t("results.standingsTitle", { game: name })}
        </h1>
      </div>

      <ol className="flex w-full flex-col gap-2.5">
        {rows.map((standing, idx) => {
          const isWinner = idx === 0;
          const playerIdx = players.findIndex((p) => p.id === standing.playerId);
          const player = players[playerIdx];
          const you = standing.playerId === playerId;
          const ink = isWinner ? "var(--dark-ink)" : "var(--ink)";
          return (
            <li
              key={standing.playerId}
              className="animate-rise flex min-w-0 items-center gap-3 rounded-2xl px-3 py-2.5 sm:px-4"
              style={{
                // Rows land bottom-up: last place first, the winner last.
                animationDelay: `${0.15 * (rows.length - 1 - idx)}s`,
                background: isWinner ? "linear-gradient(180deg,#ffd23f,#f5b32a)" : "var(--panel)",
                border: isWinner ? "none" : "2px solid var(--line)",
                boxShadow: isWinner ? "0 5px 0 var(--drop)" : undefined,
              }}
            >
              <span
                className="w-6 flex-none text-center font-display text-[19px]"
                style={{ color: isWinner ? "var(--dark-ink)" : "rgba(255,233,168,.6)" }}
              >
                {standing.place}
              </span>
              {player ? (
                <Avatar player={player} color={playerColorFor(playerIdx)} size={42} />
              ) : (
                <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-full border-2 border-(--line) bg-[#fff8e7] font-display text-sm text-(--dark-ink)">
                  {standing.name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-bold" style={{ color: ink }}>
                  {standing.name}
                  {you ? ` ${t("shell.youSuffix")}` : ""}
                </div>
                <div
                  className="font-mono text-[11px] font-semibold uppercase"
                  style={{ color: isWinner ? "rgba(61,31,14,.7)" : "var(--ink-dim)" }}
                >
                  {t("results.ptsInGame", { n: standing.score })}
                </div>
              </div>
              <span
                className="flex-none font-display text-2xl"
                style={{ color: isWinner ? "var(--dark-ink)" : "var(--accent-2)" }}
              >
                +{standing.points}
              </span>
            </li>
          );
        })}
      </ol>

      {isAdmin ? (
        <div className="flex w-full flex-col items-center gap-2">
          <div className="flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={onPlayAgain}
              data-testid="results-play-again"
              className="buzzer flex items-center gap-2 rounded-[14px] border-2 border-(--ink) bg-(--panel) px-5 py-3.5 text-sm uppercase text-(--ink)"
              style={{ ["--buzzer-drop" as string]: "rgba(0,0,0,.4)" }}
            >
              <Repeat size={16} strokeWidth={2.5} aria-hidden /> {t("results.playAgain", { game: name })}
            </button>
            <button
              type="button"
              onClick={onVoteNext}
              data-testid="results-vote-next"
              className="buzzer flex items-center gap-2 rounded-[14px] px-5 py-3.5 text-sm uppercase"
              style={{ background: "linear-gradient(180deg,#ffd23f,#f5b32a)", color: "var(--dark-ink)" }}
            >
              {t("results.voteNext")} <ArrowRight size={16} strokeWidth={2.5} aria-hidden />
            </button>
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-(--ink)/40">{t("results.repeatsAllowed")}</p>
        </div>
      ) : (
        <p className="py-2 text-center font-mono text-xs uppercase tracking-[0.15em] text-(--ink)/60">
          {t("results.waiting")}
        </p>
      )}

      <div className="flex flex-wrap justify-center gap-2.5">
        <button
          type="button"
          onClick={onOpenBoard}
          data-testid="results-board"
          className="flex items-center gap-1.5 rounded-full border-2 border-(--accent) px-4 py-2 font-sans text-[13px] font-bold text-(--accent) hover:bg-(--accent)/10"
        >
          <Trophy size={14} strokeWidth={2.5} aria-hidden /> {isAdmin ? t("results.boardAndEnd") : t("board.title")}
        </button>
        {isAdmin && onManage ? (
          <button
            type="button"
            data-testid="manage-room"
            onClick={onManage}
            className="flex items-center gap-1.5 rounded-full border-2 border-(--accent-2) px-4 py-2 font-sans text-[13px] font-bold text-(--accent-2) hover:bg-(--accent-2)/10"
          >
            <Users size={14} strokeWidth={2.5} aria-hidden /> {t("manage.title")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
