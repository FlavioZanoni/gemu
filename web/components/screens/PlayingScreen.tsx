"use client";

import { useEffect, useState } from "react";
import { Pause } from "lucide-react";
import { playSfx } from "@/lib/sfx";
import { useI18n } from "@/lib/i18n";
import type { Player, RoomSnapshot, Standing } from "@/lib/protocol";
import { GameSurface } from "@/components/GameSurface";
import { Button, ScoreStrip, TimerBadge, HowToPlayModal } from "@/components/ui";
import { gamesCatalog } from "@/lib/games";
import { hueFor } from "@/components/ui/gameHues";

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
  onSendAction: (payload: Record<string, unknown>) => void;
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
  const deadline =
    (gamePublicState?.deadline as number | undefined) || null;

  // Extract round/phase info from gamePublicState for sublabel
  const round = (gamePublicState?.round as number | undefined) || null;
  const totalRounds = (gamePublicState?.totalRounds as number | undefined) || null;
  const phase = (gamePublicState?.phase as string | undefined) || null;

  // Build sublabel: "RD x/y · <phase>" with graceful fallback
  const sublabel = (() => {
    if (round !== null && totalRounds !== null) {
      const phaseStr = phase ? ` · ${phase}` : "";
      return `RD ${round}/${totalRounds}${phaseStr}`;
    }
    if (phase) {
      return phase;
    }
    return null;
  })();

  const hue = hueFor(snapshot.gameType);

  return (
    <div className="flex flex-col">
      {/* Flat edge-to-edge header bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          padding: "12px 28px",
          background: "#2b1a3d",
          borderBottom: "2px solid #5a3f7a",
        }}
      >
        {/* Game pill */}
        <span
          style={{
            fontFamily: "'Alfa Slab One', serif",
            fontSize: "14px",
            color: hue.ink,
            background: hue.base,
            borderRadius: "9px",
            padding: "5px 14px",
          }}
        >
          {game?.name || snapshot.gameName}
        </span>

        {/* Sublabel */}
        {sublabel && (
          <span
            style={{
              font: "600 11px 'Space Mono', monospace",
              color: "rgba(255,233,168,.5)",
            }}
          >
            {sublabel}
          </span>
        )}

        {/* Flex spacer */}
        <span style={{ flex: 1 }} />

        {/* Timer badge */}
        {deadline && <TimerBadge deadline={deadline} />}

        {/* Pause button (admin only) */}
        {isAdmin && onPause && (
          <button
            onClick={onPause}
            title={t("pause.caption")}
            style={{
              font: "700 13px 'Space Grotesk', system-ui, sans-serif",
              color: "#ffd23f",
              border: "2px solid #ffd23f",
              background: "transparent",
              borderRadius: "99px",
              padding: "6px 14px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255,210,63,.12)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <Pause size={18} strokeWidth={2.5} />
          </button>
        )}

        {/* How to play button */}
        <Button variant="ghost" onClick={() => setHowToOpen(true)}>
          {t("playing.howToPlay")}
        </Button>

        {/* Leave button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onLeave}
        >
          {t("common.leave")}
        </Button>
      </div>

      {/* Score strip */}
      {standings.length > 0 && (
        <div data-testid="score-strip" className="mt-4">
          <ScoreStrip
            standings={standings}
            players={players}
            playerId={playerId}
            sessionScores={snapshot.sessionScores}
            playedGames={snapshot.playedGames}
          />
        </div>
      )}

      {/* Game surface */}
      <div data-testid="game-surface" className="rounded-2xl border-2 border-(--line) bg-(--panel) p-4 mt-4">
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
