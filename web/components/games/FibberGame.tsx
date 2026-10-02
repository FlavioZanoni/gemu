"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { Player } from "@/lib/protocol";
import { Banner, Button, HowToPlayModal } from "../ui";
import { Avatar } from "../ui/PlayerChip";
import { hueFor, playerColorFor } from "../ui/gameHues";
import { playSfx } from "@/lib/sfx";
import type { GameProps } from "./types";
import { usePendingAction } from "./usePendingAction";

type FibOption = { text: string; author: string; truth: boolean };
type FibberPublic = {
  phase: "writing" | "choosing" | "reveal";
  round: number;
  totalRounds: number;
  prompt: string;
  scores: Record<string, number>;
  written?: string[];
  picked?: string[];
  options?: string[] | FibOption[];
  picks?: Record<string, number>;
  answer?: string;
  gained?: Record<string, number>;
  deadline?: number;
};

// Private state is stamped with round + phase: public and private payloads
// arrive as separate messages, so until they match the client must not trust
// e.g. which option is this player's own lie.
type FibberPrivate = {
  round?: number;
  phase?: string;
  lie?: string;
  choice?: number;
  ownOption?: number;
  rejected?: { text: string; reason: "duplicate" | "truth" | "empty" };
};

const TRUTH = "#35d4b9";
const MAX_LIE = 80;

// Mirrors the server's whitespace collapse so a bounced lie is recognized.
const squash = (s: string) => s.trim().split(/\s+/).filter(Boolean).join(" ");
// The server compares lies by their letters and digits only, so one made of
// punctuation / emoji alone would be empty there.
const hasWord = (s: string) => /[\p{L}\p{N}]/u.test(s);

export function FibberGame(props: GameProps) {
  const { t } = useI18n();
  const pub = props.publicState as Partial<FibberPublic> | null;
  const rawPriv = props.privateState as FibberPrivate | null;
  const hue = hueFor("fibber");
  const [howDismissed, setHowDismissed] = useState(false);
  // "Sent" bridges the gap until the server's private state answers; a lost
  // lie/pick can't lock the form (see usePendingAction).
  const sent = usePendingAction<number | string>(props.privateState);

  if (!pub || !pub.round || !pub.phase) return null;

  const fresh = rawPriv?.round === pub.round && rawPriv?.phase === pub.phase;
  const priv: FibberPrivate = fresh && rawPriv ? rawPriv : {};
  const phase = pub.phase;
  const connected = props.players.filter((p) => p.connected).length;
  const playerIndex = (id: string) => props.players.findIndex((p) => p.id === id);
  const playerById = (id: string) => props.players.find((p) => p.id === id);
  const nameOf = (id: string) =>
    id === props.playerId ? t("trivia.you") : (playerById(id)?.name ?? "?");
  const showHow = !howDismissed && pub.round === 1 && phase === "writing";
  const lieKey = `lie-${pub.round}`;
  const choiceKey = `choice-${pub.round}`;
  // A bounce of the very lie we sent answers it right away.
  const sentLie = sent.pending(lieKey);
  const liePending = phase === "writing" && !priv.lie && sentLie !== undefined && priv.rejected?.text !== sentLie;
  const pendingChoice = phase === "choosing" && fresh ? sent.pending(choiceKey) : undefined;
  const choice = priv.choice ?? (typeof pendingChoice === "number" ? pendingChoice : undefined);

  return (
    <div className="@container flex w-full min-w-0 flex-col gap-3" data-testid="fibber-game" data-phase={phase} data-round={pub.round}>
      <HowToPlayModal
        open={showHow}
        gameType="fibber"
        gameName="Fibber"
        stepCount={3}
        onClose={() => setHowDismissed(true)}
      />

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="mono-caption" style={{ color: hue.base }}>
          {t("common.round", { n: pub.round, total: pub.totalRounds ?? pub.round })}
        </span>
        <span className="font-mono text-[11px] font-bold text-(--ink)/60" data-testid="fibber-progress">
          {phase === "writing"
            ? t("fibber.writtenCount", { n: pub.written?.length ?? 0, total: Math.max(connected, pub.written?.length ?? 0) })
            : phase === "choosing"
              ? t("fibber.pickedCount", { n: pub.picked?.length ?? 0, total: Math.max(connected, pub.picked?.length ?? 0) })
              : null}
        </span>
      </div>

      {/* Prompt card: the game's hue, ink text (never the cream .slab). */}
      <div
        className="rounded-[18px] px-4 py-4 text-center @md:px-6 @md:py-5"
        style={{
          background: `linear-gradient(180deg,${hue.gradFrom},${hue.gradTo})`,
          boxShadow: `0 5px 0 ${hue.drop}`,
        }}
      >
        <div
          className="mb-1 font-mono text-[10px] font-bold uppercase tracking-[0.25em]"
          style={{ color: `${hue.ink}b3` }}
        >
          {t("fibber.prompt")}
        </div>
        <div
          className={`font-display leading-snug ${
            phase === "reveal" ? "text-[16px] @md:text-[19px]" : "text-[18px] @md:text-[22px] @3xl:text-[26px]"
          }`}
          style={{ color: hue.ink }}
          data-testid="fibber-prompt"
        >
          <PromptText
            text={pub.prompt ?? ""}
            ink={hue.ink}
            fill={phase === "reveal" ? pub.answer : undefined}
          />
        </div>
      </div>

      {phase === "writing" &&
        (priv.lie ? (
          <Banner variant="waiting">{t("fibber.lieIn")}</Banner>
        ) : (
          <LieForm
            key={pub.round}
            rejected={priv.rejected}
            pending={liePending}
            onSubmit={(lie) => sent.mark(lieKey, lie, props.sendAction({ action: "lie", lie }) as unknown)}
          />
        ))}

      {phase === "choosing" && (
        <div className="flex flex-col gap-2">
          <div className="mono-caption">{t("fibber.findTruth")}</div>
          <div className="grid grid-cols-1 gap-2 @xl:grid-cols-2">
            {(pub.options as string[] | undefined)?.map((text, i) => {
              const own = priv.ownOption === i;
              const picked = choice === i;
              const lockedOut = !fresh || own || choice !== undefined;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={lockedOut}
                  onClick={() => {
                    playSfx("click");
                    sent.mark(choiceKey, i, props.sendAction({ action: "choose", choice: i }) as unknown);
                  }}
                  className="flex min-h-[48px] min-w-0 items-center gap-2 rounded-2xl border-2 px-4 py-2.5 text-left transition-transform enabled:hover:-translate-y-px disabled:cursor-default"
                  style={{
                    borderColor: picked ? hue.base : "var(--line)",
                    background: picked ? `${hue.base}26` : "var(--panel)",
                    opacity: own || (choice !== undefined && !picked) ? 0.45 : 1,
                    boxShadow: "0 4px 0 rgba(0,0,0,.35)",
                  }}
                  data-testid={`fibber-choice-${i}`}
                  data-own={own ? "true" : undefined}
                >
                  <span className="min-w-0 flex-1 break-words text-[15px] font-semibold leading-tight text-(--ink)">
                    {text}
                  </span>
                  {own ? (
                    <span className="flex-none font-mono text-[10px] uppercase tracking-[0.15em] text-(--ink)/60">
                      {t("fibber.yourLie")}
                    </span>
                  ) : null}
                  {picked ? <Check size={18} strokeWidth={3} color={hue.base} className="flex-none" /> : null}
                </button>
              );
            })}
          </div>
          {choice !== undefined ? <Banner variant="waiting">{t("fibber.pickLocked")}</Banner> : null}
        </div>
      )}

      {phase === "reveal" && (
        <Reveal
          pub={pub}
          nameOf={nameOf}
          playerById={playerById}
          playerIndex={playerIndex}
        />
      )}
    </div>
  );
}

/** Renders the prompt with its "____" as a drawn blank line — filled with
 *  the real answer once it's revealed. */
function PromptText({ text, ink, fill }: { text: string; ink: string; fill?: string }) {
  const parts = text.split("____");
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 && fill ? (
            <span className="mx-1 rounded-md bg-[#fff6dc] px-1.5 text-[#0f6e5c]">{fill}</span>
          ) : i < parts.length - 1 ? (
            <span
              aria-label="blank"
              className="mx-1 inline-block w-[3.5em] translate-y-[-0.15em] align-baseline"
              style={{ borderBottom: `3px solid ${ink}` }}
            >
              &nbsp;
            </span>
          ) : null}
        </span>
      ))}
    </>
  );
}

function LieForm({
  rejected,
  pending,
  onSubmit,
}: {
  rejected?: FibberPrivate["rejected"];
  pending: boolean;
  onSubmit: (lie: string) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const lie = squash(draft);
  // The server bounced this exact text back: show why until it's edited.
  // A lie with no letter or digit would bounce as "empty": say so up front.
  const error = rejected && rejected.text === lie ? rejected.reason : lie && !hasWord(lie) ? "empty" : null;
  const canSubmit = Boolean(lie) && !error && !pending;

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSubmit(lie);
      }}
    >
      <label className="mono-caption" htmlFor="fibber-lie">
        {t("fibber.writeLie")}
      </label>
      <div className="flex flex-col gap-2 @md:flex-row">
        <input
          id="fibber-lie"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={MAX_LIE}
          autoComplete="off"
          placeholder={t("fibber.liePlaceholder")}
          aria-invalid={error ? true : undefined}
          className="min-w-0 flex-1 rounded-xl border-2 bg-(--panel) px-4 py-3 text-[15px] text-(--ink) placeholder:text-(--ink)/35 focus:outline-none"
          style={{ borderColor: error ? "#ff4f6f" : "var(--line)" }}
          data-testid="fibber-lie-input"
        />
        <Button
          type="submit"
          variant="hue"
          gameType="fibber"
          disabled={!canSubmit}
          data-testid="fibber-lie-submit"
        >
          {t("fibber.submitLie")}
        </Button>
      </div>
      {error ? (
        <div
          role="alert"
          className="pop-in rounded-xl border-2 border-(--danger) bg-[rgba(255,79,111,.12)] px-3.5 py-2 text-[13px] font-semibold text-[#ffb3c0]"
          data-testid="fibber-lie-error"
          data-reason={error}
        >
          {t(error === "duplicate" ? "fibber.err.duplicate" : error === "empty" ? "fibber.err.empty" : "fibber.err.truth")}
        </div>
      ) : null}
    </form>
  );
}

function Reveal({
  pub,
  nameOf,
  playerById,
  playerIndex,
}: {
  pub: Partial<FibberPublic>;
  nameOf: (id: string) => string;
  playerById: (id: string) => Player | undefined;
  playerIndex: (id: string) => number;
}) {
  const { t } = useI18n();
  const options = (pub.options as FibOption[] | undefined) ?? [];
  const picks = pub.picks ?? {};
  const pickersOf = (i: number) =>
    Object.entries(picks)
      .filter(([, idx]) => idx === i)
      .map(([pid]) => pid);
  // Truth first, then lies by how many they fooled.
  const order = options
    .map((o, i) => ({ o, i, pickers: pickersOf(i) }))
    .sort((a, b) => Number(b.o.truth) - Number(a.o.truth) || b.pickers.length - a.pickers.length);
  const gained = Object.entries(pub.gained ?? {})
    .filter(([, pts]) => pts > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex flex-col gap-2" data-testid="fibber-reveal">
      <div
        className="pop-in rounded-2xl px-4 py-3 text-center"
        style={{ background: "#fff6dc", boxShadow: "0 5px 0 #0f6e5c", border: `3px solid ${TRUTH}` }}
      >
        <div className="font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-[#0f6e5c]">
          {t("fibber.theTruth")}
        </div>
        <div className="break-words font-display text-[22px] leading-tight text-[#1c1230]" data-testid="fibber-answer">
          {pub.answer}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 @xl:grid-cols-2">
        {order.map(({ o, i, pickers }) => (
          <div
            key={i}
            className="min-w-0 rounded-2xl border-2 px-3.5 py-2.5"
            style={{
              borderColor: o.truth ? TRUTH : pickers.length > 0 ? "#ff6fd8" : "var(--line)",
              background: o.truth ? "rgba(53,212,185,.12)" : "var(--panel)",
            }}
            data-testid={`fibber-reveal-${i}`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 break-words text-[15px] font-semibold leading-tight text-(--ink)">
                {o.text}
              </span>
              <span
                className="flex-none font-mono text-[10px] font-bold uppercase tracking-[0.12em]"
                style={{ color: o.truth ? TRUTH : "rgba(255,233,168,.6)" }}
              >
                {o.truth ? t("fibber.truthTag") : `${t("fibber.by")} ${nameOf(o.author)}`}
              </span>
            </div>
            {pickers.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-(--ink)/55">
                  {o.truth ? t("fibber.foundBy") : t("fibber.pickedBy")}
                </span>
                {pickers.map((pid) => {
                  const p = playerById(pid);
                  return (
                    <span key={pid} className="flex items-center gap-1 text-[12px] font-bold text-(--ink)">
                      {p ? <Avatar player={p} color={playerColorFor(playerIndex(pid))} size={18} /> : null}
                      <span className="max-w-[8rem] truncate">{nameOf(pid)}</span>
                    </span>
                  );
                })}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {gained.length > 0 ? (
        <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
          <span className="mono-caption mr-1">{t("fibber.roundPoints")}</span>
          {gained.map(([id, pts]) => {
            const p = playerById(id);
            return (
              <span
                key={id}
                className="flex items-center gap-1.5 rounded-full border-2 border-(--line) bg-(--panel) py-0.5 pl-0.5 pr-2.5 text-[12px] font-bold"
                data-testid="fibber-gained"
              >
                {p ? <Avatar player={p} color={playerColorFor(playerIndex(id))} size={20} /> : null}
                <span className="max-w-[9rem] truncate">{nameOf(id)}</span>
                <span className="font-mono" style={{ color: TRUTH }}>
                  +{pts}
                </span>
              </span>
            );
          })}
        </div>
      ) : null}
      {(pub.round ?? 0) < (pub.totalRounds ?? 0) ? (
        <div className="text-center font-mono text-[10px] uppercase tracking-[0.2em] text-(--ink)/45">
          {t("fibber.nextSoon")}
        </div>
      ) : null}
    </div>
  );
}
