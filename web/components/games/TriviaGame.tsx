"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { Player } from "@/lib/protocol";
import { Banner, HowToPlayModal } from "../ui";
import { Avatar } from "../ui/PlayerChip";
import { hueFor, playerColorFor } from "../ui/gameHues";
import { playSfx } from "@/lib/sfx";
import type { GameProps } from "./types";

type TriviaPublic = {
  phase: "question" | "reveal";
  round: number;
  totalRounds: number;
  question: string;
  options: string[];
  scores: Record<string, number>;
  answered: string[];
  deadline?: number;
  correct?: number;
  choices?: Record<string, number>;
  gained?: Record<string, number>;
};

// Private state is stamped with the round it belongs to: public and private
// payloads arrive as separate messages, so a choice from the previous
// question must never lock the next one.
type TriviaPrivate = { round?: number; choice?: number };

// A/B/C/D answer tiles — the classic quiz-show four colors.
const tiles = [
  { bg: "#ff4f6f", ink: "#ffffff" },
  { bg: "#4f9dff", ink: "#0a2547" },
  { bg: "#ffd23f", ink: "#3d1f0e" },
  { bg: "#35d4b9", ink: "#0c3d33" },
];

const CORRECT = "#35d4b9";
const WRONG = "#ff4f6f";

export function TriviaGame(props: GameProps) {
  const { t } = useI18n();
  const pub = props.publicState as Partial<TriviaPublic> | null;
  const priv = props.privateState as TriviaPrivate | null;
  const hue = hueFor("trivia");
  // The how-to auto-opens on the first question until dismissed (derived —
  // no effect needed; the shell header reopens it any time).
  const [howDismissed, setHowDismissed] = useState(false);

  // publicState is briefly {} between status:playing and the first game.state,
  // so guard the round payload, not just null.
  if (!pub || !pub.options || !pub.round) return null;

  const phase = pub.phase ?? "question";
  const reveal = phase === "reveal";
  const myChoice = priv?.round === pub.round ? priv.choice : undefined;
  const locked = myChoice !== undefined;
  const connected = props.players.filter((p) => p.connected).length;
  const answeredCount = pub.answered?.length ?? 0;
  const choices = pub.choices ?? {};
  const gained = pub.gained ?? {};
  const playerIndex = (id: string) => props.players.findIndex((p) => p.id === id);
  const playerById = (id: string) => props.players.find((p) => p.id === id);
  const showHow = !howDismissed && pub.round === 1 && phase === "question";

  const myGain = gained[props.playerId] ?? 0;
  const roundWinners = Object.entries(gained)
    .filter(([, pts]) => pts > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="@container flex w-full min-w-0 flex-col gap-3" data-testid="trivia-game" data-phase={phase} data-round={pub.round}>
      <HowToPlayModal
        open={showHow}
        gameType="trivia"
        gameName="Trivia"
        stepCount={3}
        onClose={() => setHowDismissed(true)}
      />

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="mono-caption" style={{ color: hue.base }}>
          {t("trivia.question", { n: pub.round, total: pub.totalRounds ?? pub.round })}
        </span>
        <span className="font-mono text-[11px] font-bold text-(--ink)/60" data-testid="trivia-locked-count">
          {t("trivia.lockedCount", { n: answeredCount, total: Math.max(connected, answeredCount) })}
        </span>
      </div>

      {/* Question card: the game's hue, ink text (never the cream .slab). */}
      <div
        className="rounded-[18px] px-4 py-4 text-center @md:px-6 @md:py-5"
        style={{
          background: `linear-gradient(180deg,${hue.gradFrom},${hue.gradTo})`,
          boxShadow: `0 5px 0 ${hue.drop}`,
        }}
      >
        <div
          className="font-display text-[18px] leading-snug @md:text-[22px] @3xl:text-[26px]"
          style={{ color: hue.ink }}
          data-testid="trivia-question"
        >
          {pub.question}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2.5 @md:grid-cols-2 @md:gap-3">
        {pub.options.map((opt, i) => {
          const isCorrect = reveal && pub.correct === i;
          const isMine = myChoice === i;
          const wrongMine = reveal && isMine && !isCorrect;
          const pickers = reveal
            ? Object.entries(choices)
                .filter(([, c]) => c === i)
                .map(([id]) => id)
            : [];
          const dim = (reveal && !isCorrect && !isMine) || (!reveal && locked && !isMine);
          const border = isCorrect ? CORRECT : wrongMine ? WRONG : isMine ? hue.base : "var(--line)";
          const background = isCorrect
            ? "rgba(53,212,185,.16)"
            : wrongMine
              ? "rgba(255,79,111,.14)"
              : isMine
                ? `${hue.base}26`
                : "var(--panel)";
          return (
            <button
              key={i}
              type="button"
              disabled={locked || reveal}
              onClick={() => {
                playSfx("click");
                props.sendAction({ action: "answer", choice: i });
              }}
              className="flex min-h-[52px] min-w-0 items-center gap-3 rounded-2xl border-2 px-3 py-2.5 text-left transition-[transform,opacity] enabled:hover:-translate-y-px disabled:cursor-default"
              style={{
                borderColor: border,
                background,
                opacity: dim ? 0.55 : 1,
                boxShadow: "0 4px 0 rgba(0,0,0,.35)",
              }}
              data-testid={`trivia-option-${i}`}
              data-correct={isCorrect ? "true" : undefined}
              data-mine={isMine ? "true" : undefined}
            >
              <span
                className="flex h-8 w-8 flex-none items-center justify-center rounded-lg font-display text-sm"
                style={{ background: tiles[i % 4].bg, color: tiles[i % 4].ink }}
              >
                {String.fromCharCode(65 + i)}
              </span>
              <span className="min-w-0 flex-1 break-words text-[15px] font-semibold leading-tight text-(--ink)">
                {opt}
              </span>
              {reveal ? (
                <span className="flex flex-none items-center gap-1.5">
                  {pickers.length > 0 ? (
                    <PickerStack ids={pickers} playerById={playerById} playerIndex={playerIndex} />
                  ) : null}
                  <span
                    className="font-mono text-[11px] font-bold text-(--ink)/70"
                    data-testid={`trivia-pick-count-${i}`}
                  >
                    ×{pickers.length}
                  </span>
                  {isCorrect ? <Check size={18} strokeWidth={3} color={CORRECT} /> : null}
                  {wrongMine ? <X size={18} strokeWidth={3} color={WRONG} /> : null}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {!reveal && locked ? <Banner variant="waiting">{t("trivia.locked")}</Banner> : null}

      {reveal ? (
        <div className="flex flex-col gap-2.5" data-testid="trivia-reveal">
          <div
            className="pop-in self-center rounded-full px-4 py-1.5 font-display text-[15px]"
            style={
              myGain > 0
                ? { background: CORRECT, color: "#0c3d33", boxShadow: "0 4px 0 #0f6e5c" }
                : { background: "var(--panel-raised)", color: "var(--ink)", boxShadow: "0 4px 0 rgba(0,0,0,.35)" }
            }
            data-testid="trivia-result"
          >
            {myGain > 0
              ? t("trivia.correct", { points: myGain })
              : myChoice === undefined
                ? t("trivia.noAnswer")
                : t("trivia.wrong")}
          </div>
          {roundWinners.length > 0 ? (
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              <span className="mono-caption mr-1">{t("trivia.roundPoints")}</span>
              {roundWinners.map(([id, pts]) => {
                const p = playerById(id);
                return (
                  <span
                    key={id}
                    className="flex items-center gap-1.5 rounded-full border-2 border-(--line) bg-(--panel) py-0.5 pl-0.5 pr-2.5 text-[12px] font-bold"
                    data-testid="trivia-gained"
                  >
                    {p ? <Avatar player={p} color={playerColorFor(playerIndex(id))} size={20} /> : null}
                    <span className="max-w-[9rem] truncate">
                      {id === props.playerId ? t("trivia.you") : (p?.name ?? "?")}
                    </span>
                    <span className="font-mono" style={{ color: CORRECT }}>
                      +{pts}
                    </span>
                  </span>
                );
              })}
            </div>
          ) : null}
          <div className="text-center font-mono text-[10px] uppercase tracking-[0.2em] text-(--ink)/45">
            {pub.round < (pub.totalRounds ?? 0) ? t("trivia.nextSoon") : ""}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PickerStack({
  ids,
  playerById,
  playerIndex,
}: {
  ids: string[];
  playerById: (id: string) => Player | undefined;
  playerIndex: (id: string) => number;
}) {
  const shown = ids.slice(0, 3);
  return (
    <span className="flex -space-x-1.5">
      {shown.map((id) => {
        const p = playerById(id);
        return p ? (
          <span key={id} title={p.name}>
            <Avatar player={p} color={playerColorFor(playerIndex(id))} size={20} />
          </span>
        ) : null;
      })}
    </span>
  );
}
