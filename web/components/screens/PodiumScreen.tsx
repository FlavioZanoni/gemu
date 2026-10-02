"use client";

import { useEffect } from "react";
import { Volume2, Crown } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { Player, SessionFinal } from "@/lib/protocol";
import { Avatar } from "@/components/ui/PlayerChip";
import { playerColorFor } from "@/components/ui/gameHues";
import { playSfx } from "@/lib/sfx";

// Confetti: fixed pseudo-random spread per index (render stays pure).
const CONFETTI_COLORS = ["#ffd23f", "#ff8a9b", "#8ceedd", "#35d4b9", "#ff9d3f", "#b78bff"];
const CONFETTI = Array.from({ length: 16 }, (_, i) => ({
  id: i,
  left: `${(i * 37 + 11) % 100}%`,
  color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  duration: 3 + ((i * 7) % 10) / 5,
  delay: ((i * 3) % 10) / 12,
}));

/** Final podium (Gemu Screens · 8): champion of the night. */
export function PodiumScreen({
  sessionFinal,
  players,
  onBackToLobby,
}: {
  sessionFinal: SessionFinal;
  // SessionFinal's standings carry only playerId/name/score; the room's
  // player list supplies doodle avatars (letter avatar if they left).
  players?: Player[];
  onBackToLobby: () => void;
}) {
  const { t } = useI18n();

  // Champion fanfare on the podium reveal.
  useEffect(() => {
    playSfx("winner");
  }, []);

  const top3 = sessionFinal.standings.slice(0, 3);
  const others = sessionFinal.standings.slice(3);

  const resolvePlayer = (standing: (typeof sessionFinal.standings)[number]) => {
    const idx = players?.findIndex((p) => p.id === standing.playerId) ?? -1;
    const player: Player =
      idx >= 0 && players
        ? players[idx]
        : {
            id: standing.playerId,
            name: standing.name,
            avatarUrl: "",
            connected: true,
            ready: true,
            lastSeen: "",
          };
    const colorIndex = idx >= 0 ? idx : standing.place - 1;
    return { player, color: playerColorFor(colorIndex) };
  };

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center gap-6 overflow-hidden py-8" data-testid="podium">
      {CONFETTI.map((piece) => (
        <div
          key={piece.id}
          aria-hidden
          className="animate-fall pointer-events-none absolute"
          style={{
            left: piece.left,
            top: "-30px",
            width: "10px",
            height: "15px",
            background: piece.color,
            borderRadius: "2px",
            animationDuration: `${piece.duration}s`,
            animationDelay: `${piece.delay}s`,
          }}
        />
      ))}

      <div className="relative z-10 text-center">
        <div className="mb-1 flex items-center justify-center gap-2 font-mono text-xs font-bold uppercase tracking-[0.4em] text-(--accent-2)">
          {t("podium.wrap")} <Volume2 size={14} strokeWidth={2.5} aria-hidden />
        </div>
        <h1 className="slab text-[clamp(28px,8vw,44px)] uppercase leading-tight" style={{ textShadow: "0 5px 0 var(--drop)" }}>
          {t("podium.title")}
        </h1>
      </div>

      {/* 2nd left, champion center, 3rd right; a 2-player night has no 3rd. */}
      <div className="relative z-10 flex w-full max-w-[620px] items-end justify-center gap-2.5 sm:gap-3.5">
        {[
          { standing: top3[1], flex: 1, h: 104, rank: 2, delay: 0.3, avatar: 54 },
          { standing: top3[0], flex: 1.15, h: 150, rank: 1, delay: 0.6, avatar: 64 },
          { standing: top3[2], flex: 1, h: 78, rank: 3, delay: 0, avatar: 54 },
        ]
          .filter((slot) => slot.standing)
          .map(({ standing, ...pos }) => {
            const isChampion = pos.rank === 1;
            const { player, color } = resolvePlayer(standing);
            return (
              <div
                key={standing.playerId}
                className="animate-rise flex min-w-0 flex-col items-center justify-end gap-1.5"
                style={{ flex: pos.flex, animationDelay: `${pos.delay}s` }}
              >
                {isChampion ? <Crown size={26} strokeWidth={2.5} style={{ color: "#ffd23f" }} aria-hidden /> : null}
                <Avatar player={player} color={color} size={pos.avatar} />
                <div
                  className="max-w-full truncate text-center text-sm font-bold"
                  style={{ color: isChampion ? "var(--accent)" : "var(--ink)" }}
                >
                  {standing.name} · {standing.score}
                </div>
                <div
                  className="flex w-full items-center justify-center rounded-t-2xl font-display text-4xl"
                  style={{
                    height: pos.h,
                    background: isChampion ? "linear-gradient(180deg, #ffd23f, #f5b32a)" : "var(--panel)",
                    border: isChampion ? "none" : "2px solid var(--line)",
                    color: isChampion ? "var(--dark-ink)" : "rgba(255,233,168,.7)",
                    boxShadow: isChampion ? "0 0 40px rgba(255,210,63,.35)" : "none",
                  }}
                  data-testid={isChampion ? "podium-winner" : undefined}
                >
                  {pos.rank}
                </div>
              </div>
            );
          })}
      </div>

      {others.length > 0 ? (
        <ol className="relative z-10 flex w-full max-w-[420px] flex-col gap-2">
          {others.map((standing) => (
            <li
              key={standing.playerId}
              className="animate-rise flex items-center gap-3 rounded-full border-2 border-(--line) bg-(--panel) px-5 py-2"
            >
              <span className="font-mono text-xs font-bold text-(--ink)/50">{standing.place}</span>
              <span className="min-w-0 flex-1 truncate font-bold text-(--ink)">{standing.name}</span>
              <span className="font-mono text-xs font-bold text-(--ink)/60">{standing.score}</span>
            </li>
          ))}
        </ol>
      ) : null}

      <button
        type="button"
        onClick={onBackToLobby}
        data-testid="podium-continue"
        className="buzzer relative z-10 rounded-2xl px-6 py-3.5 text-[15px] uppercase"
        style={{ background: "linear-gradient(180deg,#ffd23f,#f5b32a)", color: "var(--dark-ink)" }}
      >
        {t("podium.again")}
      </button>
    </div>
  );
}
