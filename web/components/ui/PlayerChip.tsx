"use client";

import { useI18n } from "@/lib/i18n";
import type { Player } from "@/lib/protocol";
import { playerColorFor } from "./gameHues";

function Avatar({
  player,
  color,
  size = 38,
}: {
  player: Player;
  color: string;
  size?: number;
}) {
  return (
    <div
      className="flex flex-none items-center justify-center overflow-hidden rounded-full bg-(--panel-raised)"
      style={{ width: size, height: size, border: `2px solid ${color}` }}
    >
      {player.avatarUrl ? (
        // Doodle avatars are data-URL PNGs drawn at join.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={player.avatarUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="font-display text-sm" style={{ color }}>
          {player.name.slice(0, 1).toUpperCase()}
        </span>
      )}
    </div>
  );
}

/** Player chip (Gemu System · 06): doodle avatar in the player-color ring,
 *  name (star = host), status caption. Dims when disconnected. */
export function PlayerChip({
  player,
  colorIndex,
  isHost,
  statusOverride,
  trailing,
}: {
  player: Player;
  colorIndex: number;
  isHost?: boolean;
  /** Custom caption (e.g. "DRAWING…"); defaults to ready/connection state. */
  statusOverride?: { text: string; tone: "teal" | "dim" | "coral" };
  trailing?: React.ReactNode;
}) {
  const { t } = useI18n();
  const color = playerColorFor(colorIndex);

  const status = statusOverride
    ? statusOverride
    : !player.connected
      ? { text: t("common.reconnecting").split(" — ")[0].toUpperCase(), tone: "coral" as const }
      : player.ready
        ? { text: t("common.ready").toUpperCase(), tone: "teal" as const }
        : { text: t("common.waiting").toUpperCase(), tone: "dim" as const };

  const toneColor =
    status.tone === "teal"
      ? "var(--accent-2)"
      : status.tone === "coral"
        ? "var(--danger)"
        : "var(--ink-faint)";

  return (
    <div
      className={`flex items-center gap-2.5 rounded-full border-2 border-(--line) bg-(--panel) py-1.5 pl-1.5 pr-4 ${
        player.connected ? "" : "opacity-45"
      }`}
    >
      <Avatar player={player} color={color} />
      <div className="min-w-0">
        <div className="truncate text-[13px] font-bold text-(--ink)">
          {player.name} {isHost ? <span className="text-(--accent)">★</span> : null}
        </div>
        <div className="font-mono text-[10px]" style={{ color: toneColor }}>
          {status.text}
        </div>
      </div>
      {trailing}
    </div>
  );
}

/** Leaderboard chip: rank medallion + name + points on a hue fill. */
export function ScoreChip({
  rank,
  name,
  points,
  highlight,
}: {
  rank: number;
  name: string;
  points: number;
  highlight?: boolean;
}) {
  const { t } = useI18n();
  if (!highlight) {
    return (
      <div className="flex items-center gap-2 rounded-full border-2 border-(--line) bg-(--panel) py-1.5 pl-1.5 pr-3.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-(--panel-raised) font-display text-[13px] text-(--ink)/70">
          {rank}
        </div>
        <div className="text-[13px] font-bold text-(--ink)">
          {name} · {points} {t("common.points")}
        </div>
      </div>
    );
  }
  return (
    <div
      className="flex items-center gap-2 rounded-full bg-(--accent) py-1.5 pl-1.5 pr-3.5"
      style={{ boxShadow: "0 4px 0 var(--drop)" }}
    >
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-(--dark-ink) font-display text-[13px] text-(--accent)">
        {rank}
      </div>
      <div className="text-[13px] font-bold text-(--dark-ink)">
        {name} · {points} {t("common.points")}
      </div>
    </div>
  );
}
