"use client";

import { useEffect, useState } from "react";
import { Pause } from "lucide-react";
import { playSfx } from "@/lib/sfx";
import { useI18n } from "@/lib/i18n";
import type { Player, RoomSnapshot, Standing } from "@/lib/protocol";
import { GameSurface } from "@/components/GameSurface";
import { ScoreStrip } from "@/components/ui/ScoreStrip";
import { TimerBadge } from "@/components/ui/Timer";
import { HowToPlayModal } from "@/components/ui/HowToPlayModal";
import { gamesCatalog, gameLabel } from "@/lib/games";
import { hueFor } from "@/components/ui/gameHues";
import { LangToggle } from "@/components/ui/LangToggle";
import { SfxToggle } from "@/components/ui/SfxToggle";
import { RoomMenu, ScorePeek } from "./RoomControls";

// Games that draw their own in-card scoreboard (design/games): the shell
// doesn't add a second one next to them.
const OWN_SCOREBOARD = ["gartic", "stop", "cah"];

/** Design label for the current phase ("FILL FAST", "YOU DRAW", …); null
 *  when there's nothing useful to say. */
function phaseLabel(
  gameType: string,
  pub: Record<string, unknown> | null,
  playerId: string | null,
  players: Player[],
  t: (k: string, p?: Record<string, string | number>) => string,
): string | null {
  const phase = typeof pub?.phase === "string" ? pub.phase : "";
  if (!phase) return null;
  const nameOf = (id: unknown) => players.find((p) => p.id === id)?.name ?? "?";
  if (gameType === "gartic" && phase === "drawing") {
    return pub?.drawer === playerId
      ? t("phase.gartic.youDraw")
      : t("phase.gartic.guess");
  }
  if (gameType === "cah" && (phase === "answering" || phase === "judging")) {
    return pub?.judge === playerId
      ? t("phase.cah.youJudge")
      : t("phase.cah.judges", { name: nameOf(pub?.judge).toUpperCase() });
  }
  const key = `phase.${gameType}.${phase}`;
  const text = t(key);
  return text === key ? null : text;
}

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
  onPause,
}: {
  snapshot: RoomSnapshot;
  players: Player[];
  playerId: string | null;
  standings: Standing[];
  gamePublicState: Record<string, unknown> | null;
  gamePrivateState: Record<string, unknown> | null;
  isAdmin: boolean;
  /** False when the action could not go out (socket down: a toast says so). */
  onSendAction: (payload: Record<string, unknown>) => boolean;
  onSendStream: (payload: Record<string, unknown>) => void;
  onLeave: () => void;
  onPause?: () => void;
}) {
  const { t } = useI18n();
  const [howToOpen, setHowToOpen] = useState(false);

  // Fanfare when a game begins.
  useEffect(() => {
    playSfx("start");
  }, []);

  const game = gamesCatalog.find((g) => g.type === snapshot.gameType);
  const deadline = (gamePublicState?.deadline as number | undefined) || null;

  const num = (v: unknown) => (typeof v === "number" && v > 0 ? v : null);
  const round = num(gamePublicState?.round) ?? num(gamePublicState?.step);
  const totalRounds =
    num(gamePublicState?.totalRounds) ?? num(gamePublicState?.totalSteps);
  const roundLabel =
    round !== null && totalRounds !== null
      ? t("shell.round", {
          n: Math.min(round, totalRounds),
          total: totalRounds,
        })
      : null;
  const phase = phaseLabel(
    snapshot.gameType,
    gamePublicState,
    playerId,
    players,
    t,
  );

  const hue = hueFor(snapshot.gameType);
  const chip = (
    game ? gameLabel(game.type, t, game.name) : snapshot.gameName
  ).toUpperCase();
  const showStrip =
    !OWN_SCOREBOARD.includes(snapshot.gameType) && standings.length > 0;

  return (
    <div className="flex flex-1 flex-col">
      {/* Shell header (Gemu Prototype · SHELL HEADER): edge to edge. */}
      <header
        className="flex flex-wrap items-center gap-x-1.5 gap-y-2 border-b-2 border-(--line) bg-(--panel) px-3 py-2.5 sm:gap-x-3 sm:px-7 sm:py-3"
        data-testid="shell-header"
      >
        <span
          className="flex-none rounded-[9px] px-2.5 py-1 font-display text-xs sm:px-3.5 sm:text-sm"
          style={{ color: hue.ink, background: hue.base }}
          data-testid="shell-game-chip"
        >
          {chip}
        </span>
        {roundLabel || phase ? (
          <span
            className="min-w-0 flex-1 basis-0 truncate font-mono text-[11px] font-semibold uppercase text-(--ink)/50"
            data-testid="shell-sublabel"
          >
            {roundLabel}
            {roundLabel && phase ? (
              <span className="hidden sm:inline"> · </span>
            ) : null}
            {phase ? (
              <span className={roundLabel ? "hidden sm:inline" : ""}>
                {phase}
              </span>
            ) : null}
          </span>
        ) : null}
        <div className="ml-auto flex flex-none items-center gap-1.5 sm:gap-3">
          {deadline ? <TimerBadge deadline={deadline} /> : null}
          {isAdmin && onPause ? (
            <button
              type="button"
              onClick={onPause}
              title={t("pause.pause")}
              aria-label={t("pause.pause")}
              data-testid="pause-button"
              className="flex h-9 w-9 flex-none items-center justify-center rounded-full border-2 border-(--accent) text-(--accent) hover:bg-(--accent)/10 sm:w-11"
            >
              <Pause size={16} strokeWidth={3} aria-hidden />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setHowToOpen(true)}
            aria-label={t("common.howToPlay").replace("? ", "")}
            data-testid="shell-howto"
            className="flex h-9 min-w-9 flex-none items-center justify-center rounded-full border-2 border-(--accent-2) px-0 font-sans text-[13px] font-bold text-(--accent-2) hover:bg-(--accent-2)/10 sm:px-4"
          >
            <span className="sm:hidden" aria-hidden>
              ?
            </span>
            <span className="hidden sm:inline">{t("common.howToPlay")}</span>
          </button>
          {/* Phones: the score peek's sheet doubles as the menu (sound,
              language, leave); wider screens also get the ⋮ menu. */}
          <ScorePeek
            snapshot={snapshot}
            players={players}
            playerId={playerId}
            footer={
              <div className="flex flex-wrap items-center gap-2">
                <SfxToggle />
                <LangToggle />
                <button
                  type="button"
                  onClick={onLeave}
                  data-testid="peek-leave"
                  className="ml-auto rounded-full border-2 border-(--danger)/60 px-4 py-1.5 font-sans text-xs font-bold text-[#ffb3c1] hover:border-(--danger)"
                >
                  {t("shell.leaveRoom")}
                </button>
              </div>
            }
          />
          <span className="hidden sm:inline-flex">
            <RoomMenu
              snapshot={snapshot}
              players={players}
              playerId={playerId}
              isAdmin={isAdmin}
              onLeave={onLeave}
            />
          </span>
        </div>
      </header>

      {/* The game sits straight on the stage (no card); the live scoreboard
          joins it on wide screens only — phones use the score peek. */}
      <div
        data-testid="game-surface"
        className="mx-auto flex w-full max-w-[1240px] flex-1 flex-col gap-6 px-3 py-4 sm:px-8 sm:py-6 lg:flex-row lg:items-start"
      >
        <div className="min-w-0 flex-1">
          <GameSurface
            gameType={snapshot.gameType}
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
        {showStrip ? (
          <aside className="hidden w-[300px] flex-none lg:block">
            <ScoreStrip
              standings={standings}
              players={players}
              playerId={playerId}
              sessionScores={snapshot.sessionScores}
              playedGames={snapshot.playedGames}
              roundLabel={roundLabel}
            />
          </aside>
        ) : null}
      </div>

      {game ? (
        <HowToPlayModal
          open={howToOpen}
          gameType={game.type}
          gameName={game.name}
          stepCount={game.howToSteps}
          onClose={() => setHowToOpen(false)}
        />
      ) : null}
    </div>
  );
}
