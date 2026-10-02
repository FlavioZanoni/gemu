"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import type { Player } from "@/lib/protocol";
import { DrawingCanvas } from "../DrawingCanvas";
import { Button, Banner, HowToPlayModal, hueFor, playerColorFor } from "../ui";
import { Avatar } from "../ui/PlayerChip";
import type { GameProps } from "./types";

type InventionDrawing = {
  problem: string;
  title: string;
  tagline: string;
  dataURL: string;
};

type Reactions = Record<string, number>;

const FUNDING_BUDGET = 1000;
const FUNDING_STEP = 50;
const HUE = "var(--hue-invention)";
const REACTIONS = [
  { kind: "fund", emoji: "💰" },
  { kind: "trash", emoji: "🗑" },
  { kind: "rocket", emoji: "🚀" },
] as const;

// Patent-card palette (Gemu Game Screens · Patently Silly pitch card).
const PAPER = "#fff8e7";
const PAPER_INK = "#1c1230";
const PAPER_BODY = "#4a4232";
const PAPER_CAPTION = "#8a7f60";

const MAX_EXPORT_SIDE = 640;
const MAX_EXPORT_CHARS = 150_000;

/** Downscale a canvas PNG to ≤640px on the long side and re-encode as WebP
 *  (JPEG fallback), stepping quality down until it fits the upload budget —
 *  drawings are rebroadcast to every player in each game.state. */
async function compressDrawing(dataURL: string): Promise<string> {
  const image = new Image();
  image.src = dataURL;
  await image.decode();
  const scale = Math.min(1, MAX_EXPORT_SIDE / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataURL;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  let out = "";
  for (const quality of [0.8, 0.65, 0.5, 0.35]) {
    out = canvas.toDataURL("image/webp", quality);
    if (!out.startsWith("data:image/webp")) out = canvas.toDataURL("image/jpeg", quality);
    if (out.length <= MAX_EXPORT_CHARS) break;
  }
  return out;
}

/** sendAction may report a dropped send (false while disconnected). */
const wasSent = (result: unknown) => result !== false;

/** One-shot guard for host controls: after a press for `key` (phase/round/
 *  pitch), the control stays disabled until the key changes — the server
 *  also ignores stale presses — or LATCH_MS pass without a change. */
const LATCH_MS = 4000;
function useLatch(key: string) {
  const [latched, setLatched] = useState<string | null>(null);
  useEffect(() => {
    if (latched === null) return;
    const id = setTimeout(() => setLatched(null), LATCH_MS);
    return () => clearTimeout(id);
  }, [latched]);
  return { locked: latched === key, latch: () => setLatched(key) };
}

const pad3 = (n: number) => String(n).padStart(3, "0");
const money = (n: number) => `$${n}`;

export function InventionGame(props: GameProps & { onLeave?: () => void }) {
  const { t } = useI18n();
  const { playerId, players, publicState, privateState, sendAction, isAdmin } = props;

  const phase = (publicState?.phase as string | undefined) ?? "collecting";
  const round = (publicState?.round as number | undefined) ?? 1;
  const totalRounds = (publicState?.totalRounds as number | undefined) ?? 3;
  const doneCount = (publicState?.doneCount as number | undefined) ?? 0;
  const neededCount = (publicState?.neededCount as number | undefined) ?? 0;
  const presenters = (publicState?.presenters as string[] | undefined) ?? [];
  const presentIndex = (publicState?.presentIndex as number | undefined) ?? 0;
  const submissions =
    (publicState?.submissions as Record<string, InventionDrawing> | undefined) ?? {};

  const [showHowTo, setShowHowTo] = useState(round === 1 && phase === "collecting");
  // Host "advance" is bound to the phase it was pressed in: a double tap or
  // a tap racing an auto-advance must not skip the next phase too.
  const advanceLatch = useLatch(`${round}:${phase}`);
  const hostAdvance = () => {
    if (advanceLatch.locked) return;
    if (wasSent(sendAction({ action: "advance", phase, round }))) advanceLatch.latch();
  };

  const playerById = useMemo(() => {
    const map = new Map<string, { player: Player; color: string }>();
    players.forEach((player, i) => map.set(player.id, { player, color: playerColorFor(i) }));
    return map;
  }, [players]);
  const nameOf = (id: string) =>
    playerById.get(id)?.player.name ?? t("invention.someone");

  const phaseTitle: Record<string, string> = {
    collecting: t("invention.collecting"),
    drawing: t("invention.drawing"),
    presenting: t("invention.presenting"),
    voting: t("invention.voting"),
    results: t("invention.results"),
    finalResults: t("invention.finalResults"),
  };
  const phaseDesc: Record<string, string> = {
    collecting: t("invention.collecting.desc"),
    drawing: t("invention.drawing.desc"),
    presenting: t("invention.presenting.desc"),
    voting: t("invention.voting.desc"),
  };
  const gated = phase === "collecting" || phase === "drawing" || phase === "voting";

  return (
    <>
      <HowToPlayModal
        open={showHowTo}
        gameType="invention"
        gameName="Patently Silly"
        stepCount={4}
        onClose={() => setShowHowTo(false)}
      />
      <div className="flex min-w-0 flex-col gap-4" data-testid="invention-game" data-phase={phase}>
        <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <div className="mono-caption" style={{ color: "var(--ink-dim)" }}>
              {t("invention.roundOf", { round, total: totalRounds })}
            </div>
            <h2
              className="font-display text-2xl leading-tight sm:text-3xl"
              style={{ color: HUE, textShadow: "0 3px 0 rgba(0,0,0,.35)" }}
            >
              {phaseTitle[phase] ?? phase}
            </h2>
            {phaseDesc[phase] ? (
              <div className="mt-0.5 text-sm text-(--ink-dim)">{phaseDesc[phase]}</div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {gated && neededCount > 0 ? (
              <span
                className="rounded-full border-2 border-(--line) bg-(--panel) px-3 py-1 font-mono text-xs font-bold text-(--ink)"
                data-testid="invention-progress"
              >
                {t("invention.done", { count: doneCount, total: neededCount })}
              </span>
            ) : null}
            {isAdmin && gated ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={hostAdvance}
                disabled={advanceLatch.locked}
                data-testid="invention-host-advance"
              >
                {t("invention.hostAdvance")}
              </Button>
            ) : null}
          </div>
        </header>

        {phase === "collecting" ? (
          <CollectingView
            key={`collect-${round}`}
            done={Boolean(privateState?.problemsDone)}
            onSubmit={(problems) => sendAction({ action: "submit_problems", problems })}
            progress={`${doneCount}/${neededCount}`}
          />
        ) : null}

        {phase === "drawing" ? (
          <DrawingView
            key={`draw-${round}`}
            assigned={(privateState?.assigned as string | undefined) ?? ""}
            submitted={Boolean(privateState?.drawing)}
            progress={`${doneCount}/${neededCount}`}
            onSubmit={(payload) => sendAction({ action: "submit_drawing", ...payload })}
          />
        ) : null}

        {phase === "presenting" ? (
          <PresentingView
            presenterId={(publicState?.presenter as string | undefined) ?? presenters[presentIndex] ?? ""}
            presentIndex={presentIndex}
            isLast={presentIndex >= presenters.length - 1}
            submission={submissions[(publicState?.presenter as string | undefined) ?? presenters[presentIndex] ?? ""]}
            playerId={playerId}
            isAdmin={isAdmin}
            nameOf={nameOf}
            reactions={(publicState?.reactions as Reactions | undefined) ?? {}}
            myReactions={(privateState?.myReactions as string[] | undefined) ?? []}
            sendAction={sendAction}
            onSkipToVoting={hostAdvance}
            skipLocked={advanceLatch.locked}
            latchKey={`${round}:${presentIndex}`}
          />
        ) : null}

        {phase === "voting" ? (
          <VotingView
            key={`vote-${round}`}
            playerId={playerId}
            submissions={submissions}
            voted={Boolean(privateState?.voted)}
            progress={`${doneCount}/${neededCount}`}
            nameOf={nameOf}
            onSubmit={(funding) => sendAction({ action: "fund", funding })}
          />
        ) : null}

        {phase === "results" || phase === "finalResults" ? (
          <ResultsView
            final={phase === "finalResults"}
            submissions={submissions}
            funding={(publicState?.funding as Record<string, number> | undefined) ?? {}}
            totalFunding={(publicState?.totalFunding as Record<string, number> | undefined) ?? {}}
            playerId={playerId}
            playerById={playerById}
            nameOf={nameOf}
            isAdmin={isAdmin}
            onNextRound={() => sendAction({ action: "next_round" })}
          />
        ) : null}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 rounded-[14px] border-2 border-(--line) bg-(--panel) px-4 pb-1.5 pt-2 transition-colors focus-within:border-(--hue-invention)">
      <span className="font-mono text-[10px] font-bold uppercase tracking-[.2em] text-(--ink-faint)">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputClass =
  "w-full min-w-0 bg-transparent py-1.5 font-sans text-base font-semibold text-(--ink) outline-none placeholder:text-(--ink-faint) placeholder:font-normal";

function WaitingNote({ children, progress }: { children: ReactNode; progress?: string }) {
  return (
    <Banner variant="waiting" trailing={progress} className="justify-between">
      {children}
    </Banner>
  );
}

/* --------------------------- collecting --------------------------- */

function CollectingView({
  done,
  onSubmit,
  progress,
}: {
  done: boolean;
  onSubmit: (problems: string[]) => void;
  progress: string;
}) {
  const { t } = useI18n();
  const [one, setOne] = useState("");
  const [two, setTwo] = useState("");
  if (done) {
    return <WaitingNote progress={progress}>{t("invention.problemsSent")}</WaitingNote>;
  }
  const ready = one.trim() !== "" && two.trim() !== "";
  return (
    <form
      className="mx-auto flex w-full max-w-xl flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onSubmit([one.trim(), two.trim()]);
      }}
    >
      <Field label={t("invention.problem1")}>
        <input
          type="text"
          maxLength={140}
          placeholder={t("invention.problem1Placeholder")}
          value={one}
          onChange={(e) => setOne(e.target.value)}
          className={inputClass}
          data-testid="invention-problem-1"
        />
      </Field>
      <Field label={t("invention.problem2")}>
        <input
          type="text"
          maxLength={140}
          placeholder={t("invention.problem2Placeholder")}
          value={two}
          onChange={(e) => setTwo(e.target.value)}
          className={inputClass}
          data-testid="invention-problem-2"
        />
      </Field>
      <Button
        type="submit"
        variant="hue"
        gameType="invention"
        disabled={!ready}
        className="w-full"
        data-testid="invention-submit-problems"
      >
        {t("invention.submitProblems")}
      </Button>
    </form>
  );
}

/* ----------------------------- drawing ---------------------------- */

function DrawingView({
  assigned,
  submitted,
  progress,
  onSubmit,
}: {
  assigned: string;
  submitted: boolean;
  progress: string;
  onSubmit: (payload: { title: string; tagline: string; draw: string }) => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [tagline, setTagline] = useState("");
  // Canvas output only flows OUT of DrawingCanvas — never fed back as
  // `value`, which would redraw the canvas on every stroke.
  const [canvasData, setCanvasData] = useState("");
  const [sending, setSending] = useState(false);

  if (submitted) {
    return <WaitingNote progress={progress}>{t("invention.drawingSent")}</WaitingNote>;
  }

  const canSubmit = Boolean(assigned && title.trim() && canvasData) && !sending;
  const submit = async () => {
    if (!canSubmit) return;
    setSending(true);
    try {
      const draw = await compressDrawing(canvasData);
      onSubmit({ title: title.trim(), tagline: tagline.trim(), draw });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-wrap items-start justify-center gap-4">
      <div className="flex min-w-[min(100%,260px)] max-w-xl flex-[1_1_280px] flex-col gap-3">
        <div
          className="rounded-2xl p-4"
          style={{ background: PAPER, color: PAPER_INK, boxShadow: "0 5px 0 rgba(0,0,0,.35)" }}
          data-testid="invention-assigned"
        >
          <div
            className="font-mono text-[10px] font-bold uppercase tracking-[.2em]"
            style={{ color: PAPER_CAPTION }}
          >
            {t("invention.yourProblem")}
          </div>
          <div className="mt-1 text-lg font-bold leading-snug">
            {assigned || t("invention.waitingAssignment")}
          </div>
        </div>
        <Field label={t("invention.inventionTitle")}>
          <input
            type="text"
            maxLength={80}
            placeholder={t("invention.titlePlaceholder")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={inputClass}
            data-testid="invention-title-input"
          />
        </Field>
        <Field label={t("invention.tagline")}>
          <input
            type="text"
            maxLength={140}
            placeholder={t("invention.taglinePlaceholder")}
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            className={inputClass}
            data-testid="invention-tagline-input"
          />
        </Field>
        <Button
          variant="hue"
          gameType="invention"
          onClick={submit}
          disabled={!canSubmit}
          className="w-full"
          data-testid="invention-submit-invention"
        >
          {t("invention.submitInvention")}
        </Button>
      </div>
      {/* Width follows the viewport height so canvas + toolbar fit on
          short/wide screens; it stacks below the form on narrow ones. */}
      <div
        className="min-w-0"
        style={{
          flex: "0 1 auto",
          width: "min(100%, max(240px, calc((100dvh - 400px) * 0.818)))",
        }}
        data-testid="invention-canvas"
      >
        <DrawingCanvas onChange={setCanvasData} hue={HUE} />
      </div>
    </div>
  );
}

/* ---------------------------- presenting --------------------------- */

function PatentCard({
  submission,
  number,
  testId,
  compact = false,
}: {
  submission: InventionDrawing;
  number: number;
  testId?: string;
  compact?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div
      className="relative rounded-[18px]"
      style={{
        background: PAPER,
        padding: compact ? "14px 14px" : "20px 18px",
        boxShadow: "0 6px 0 rgba(0,0,0,.35)",
      }}
      data-testid={testId}
    >
      <span
        className="absolute right-3.5 -top-2.5 rounded-full px-2.5 py-1 font-mono text-[9px] font-bold uppercase"
        style={{ background: HUE, color: "var(--dark-ink)", transform: "rotate(3deg)" }}
      >
        {t("invention.patentPending")}
      </span>
      <div
        className="mb-1.5 font-mono text-[9px] font-bold uppercase tracking-[.2em]"
        style={{ color: PAPER_CAPTION }}
      >
        {t("invention.number", { n: pad3(number) })}
      </div>
      <div
        className="mb-2 break-words font-display uppercase leading-tight"
        style={{ fontSize: compact ? 18 : 22, color: PAPER_INK }}
        data-testid={testId ? `${testId}-title` : undefined}
      >
        {submission.title}
      </div>
      {submission.tagline ? (
        <div
          className="break-words text-[13px] font-medium leading-normal"
          style={{ color: PAPER_BODY }}
        >
          {submission.tagline}
        </div>
      ) : null}
      {submission.problem ? (
        <div className="mt-1.5 break-words text-xs leading-normal" style={{ color: PAPER_CAPTION }}>
          <b>{t("invention.solves")}</b> {submission.problem}
        </div>
      ) : null}
      {submission.dataURL ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={submission.dataURL}
          alt={t("invention.drawingAlt", { title: submission.title })}
          className="mx-auto mt-3 block w-auto max-w-full rounded-lg object-contain"
          style={{
            maxHeight: compact ? "min(30dvh, 220px)" : "min(48dvh, 440px)",
            border: "2px solid rgba(28,18,48,.12)",
          }}
          data-testid={testId ? `${testId}-img` : undefined}
        />
      ) : null}
    </div>
  );
}

function PresentingView({
  presenterId,
  presentIndex,
  isLast,
  submission,
  playerId,
  isAdmin,
  nameOf,
  reactions,
  myReactions,
  sendAction,
  onSkipToVoting,
  skipLocked,
  latchKey,
}: {
  presenterId: string;
  presentIndex: number;
  isLast: boolean;
  submission: InventionDrawing | undefined;
  playerId: string;
  isAdmin: boolean;
  nameOf: (id: string) => string;
  reactions: Reactions;
  myReactions: string[];
  sendAction: (payload: Record<string, unknown>) => unknown;
  onSkipToVoting: () => void;
  skipLocked: boolean;
  latchKey: string;
}) {
  const { t } = useI18n();
  const isPresenter = presenterId === playerId;
  // "next" names the pitch it ends, so a double tap or a tap racing the
  // pitch timer can't skip the following presenter.
  const nextLatch = useLatch(latchKey);
  const nextPitch = () => {
    if (nextLatch.locked) return;
    if (wasSent(sendAction({ action: "next", presentIndex, presenter: presenterId }))) nextLatch.latch();
  };
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-3.5">
      <div
        className="text-center font-mono text-[10px] font-bold uppercase tracking-[.25em]"
        style={{ color: HUE }}
        data-testid="invention-pitcher"
      >
        {isPresenter
          ? t("invention.youPitching")
          : t("invention.isPitching", { name: nameOf(presenterId) })}
      </div>
      {submission ? (
        <PatentCard submission={submission} number={presentIndex + 1} testId="invention-pitch" />
      ) : null}
      <div className="flex flex-wrap justify-center gap-2">
        {REACTIONS.map(({ kind, emoji }) => {
          const mine = myReactions.includes(kind);
          return (
            <button
              key={kind}
              type="button"
              disabled={isPresenter}
              aria-pressed={mine}
              title={t(`invention.react.${kind}`)}
              aria-label={t(`invention.react.${kind}`)}
              onClick={() => sendAction({ action: "react", kind })}
              className="flex items-center gap-1.5 rounded-full border-2 bg-(--panel) px-3.5 py-1.5 text-base transition-transform enabled:hover:-translate-y-0.5 disabled:cursor-default"
              style={{
                borderColor: mine ? HUE : "var(--line)",
                boxShadow: mine ? "0 0 12px rgba(255,157,63,.3)" : "none",
              }}
              data-testid={`invention-react-${kind}`}
            >
              <span aria-hidden>{emoji}</span>
              <b className="font-mono text-[11px]" style={{ color: mine ? HUE : "var(--ink)" }}>
                {reactions[kind] ?? 0}
              </b>
            </button>
          );
        })}
      </div>
      {isPresenter || isAdmin ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant={isPresenter ? "hue" : "secondary"}
            gameType="invention"
            onClick={nextPitch}
            disabled={nextLatch.locked}
            className="min-w-[min(100%,200px)] flex-1"
            data-testid="invention-next-pitch"
          >
            {isPresenter
              ? isLast
                ? t("invention.startVoting")
                : t("invention.nextInvention")
              : t("invention.hostNextPitch")}
          </Button>
          {isAdmin && !isLast ? (
            <Button
              variant="secondary"
              onClick={onSkipToVoting}
              disabled={skipLocked}
              className="min-w-[min(100%,200px)] flex-1"
              data-testid="invention-skip-voting"
            >
              {t("invention.skipVoting")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------ voting ----------------------------- */

function VotingView({
  playerId,
  submissions,
  voted,
  progress,
  nameOf,
  onSubmit,
}: {
  playerId: string;
  submissions: Record<string, InventionDrawing>;
  voted: boolean;
  progress: string;
  nameOf: (id: string) => string;
  onSubmit: (funding: Record<string, number>) => void;
}) {
  const { t } = useI18n();
  // Keyed per round by the parent, so last round's sliders never leak in.
  const [alloc, setAlloc] = useState<Record<string, number>>({});
  const options = Object.keys(submissions)
    .filter((id) => id !== playerId)
    .sort();
  const allocated = options.reduce((sum, id) => sum + (alloc[id] ?? 0), 0);
  const remaining = FUNDING_BUDGET - allocated;

  if (voted) {
    return <WaitingNote progress={progress}>{t("invention.fundingSent")}</WaitingNote>;
  }
  if (options.length === 0) {
    return <WaitingNote progress={progress}>{t("invention.nothingToFund")}</WaitingNote>;
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-(--ink-dim)">
          {t("invention.fundingBudget", { budget: money(FUNDING_BUDGET) })}
        </div>
        <span
          className="rounded-[10px] px-3 py-0.5 font-display text-xl"
          style={{ background: "var(--ink)", color: "var(--bg)", boxShadow: "0 3px 0 var(--drop)" }}
          data-testid="invention-remaining"
        >
          {t("invention.fundingLeft", { amount: money(remaining) })}
        </span>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 240px), 1fr))" }}>
        {options.map((id, idx) => {
          const sub = submissions[id];
          const amount = alloc[id] ?? 0;
          return (
            <div
              key={id}
              className="flex flex-col gap-2 rounded-2xl border-2 bg-(--panel) p-3"
              style={{ borderColor: amount > 0 ? HUE : "var(--line)" }}
              data-testid={`invention-fund-card-${idx}`}
            >
              <div className="flex items-center gap-3">
                {sub.dataURL ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={sub.dataURL}
                    alt={t("invention.drawingAlt", { title: sub.title })}
                    className="h-16 w-14 flex-none rounded-lg object-cover"
                    style={{ background: PAPER }}
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-display text-sm uppercase text-(--ink)">{sub.title}</div>
                  <div className="truncate text-xs text-(--ink-dim)">
                    {t("invention.by", { name: nameOf(id) })}
                  </div>
                </div>
                <div className="font-mono text-base font-bold" style={{ color: amount > 0 ? HUE : "var(--ink)" }}>
                  {money(amount)}
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={FUNDING_BUDGET}
                step={FUNDING_STEP}
                value={amount}
                onChange={(e) => {
                  const others = allocated - amount;
                  const next = Math.min(Number(e.target.value), FUNDING_BUDGET - others);
                  setAlloc((prev) => ({ ...prev, [id]: Math.max(0, next) }));
                }}
                className="w-full"
                style={{ accentColor: HUE }}
                aria-label={sub.title}
                data-testid={`invention-vote-${idx}`}
              />
            </div>
          );
        })}
      </div>
      <Button
        variant="hue"
        gameType="invention"
        disabled={remaining < 0}
        onClick={() => {
          const funding: Record<string, number> = {};
          for (const id of options) if ((alloc[id] ?? 0) > 0) funding[id] = alloc[id];
          onSubmit(funding);
        }}
        className="w-full"
        data-testid="invention-vote-submit"
      >
        {allocated === 0 ? t("invention.fundNobody") : t("invention.submitFunding")}
      </Button>
    </div>
  );
}

/* ----------------------------- results ----------------------------- */

function ResultsView({
  final,
  submissions,
  funding,
  totalFunding,
  playerId,
  playerById,
  nameOf,
  isAdmin,
  onNextRound,
}: {
  final: boolean;
  submissions: Record<string, InventionDrawing>;
  funding: Record<string, number>;
  totalFunding: Record<string, number>;
  playerId: string;
  playerById: Map<string, { player: Player; color: string }>;
  nameOf: (id: string) => string;
  isAdmin: boolean;
  onNextRound: () => void;
}) {
  const { t } = useI18n();
  const hue = hueFor("invention");
  const rows = Object.keys(submissions).sort(
    (a, b) => (funding[b] ?? 0) - (funding[a] ?? 0) || (totalFunding[b] ?? 0) - (totalFunding[a] ?? 0),
  );
  const leader = Object.entries(totalFunding).sort(([, a], [, b]) => b - a)[0];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3" data-testid="invention-results">
      {final ? (
        <div
          className="rounded-2xl p-4 text-center"
          style={{
            background: `linear-gradient(180deg,${hue.gradFrom},${hue.gradTo})`,
            color: hue.ink,
            boxShadow: `0 5px 0 ${hue.drop}`,
          }}
        >
          <div className="font-display text-xl sm:text-2xl">
            {leader && leader[1] > 0
              ? t("invention.finalWinner", { name: nameOf(leader[0]), amount: money(leader[1]) })
              : t("invention.noWinner")}
          </div>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <Banner variant="waiting">{t("invention.noInventions")}</Banner>
      ) : null}
      {rows.map((id, index) => {
        const sub = submissions[id];
        const top = index === 0 && (funding[id] ?? 0) > 0;
        const who = playerById.get(id);
        const style: CSSProperties = top
          ? {
              background: `linear-gradient(180deg,${hue.gradFrom},${hue.gradTo})`,
              color: hue.ink,
              boxShadow: `0 5px 0 ${hue.drop}`,
              borderColor: "transparent",
            }
          : {};
        return (
          <div
            key={id}
            className="flex items-center gap-3 rounded-2xl border-2 border-(--line) bg-(--panel) p-2.5 text-(--ink)"
            style={style}
            data-testid={`invention-result-${index}`}
          >
            <span className="w-5 flex-none text-center font-mono text-xs font-bold opacity-70">
              {index + 1}
            </span>
            {sub.dataURL ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={sub.dataURL}
                alt={t("invention.drawingAlt", { title: sub.title })}
                className="h-14 w-12 flex-none rounded-lg object-cover"
                style={{ background: PAPER }}
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="truncate font-display text-sm uppercase sm:text-base">{sub.title}</div>
              <div className="flex min-w-0 items-center gap-1.5 text-xs opacity-80">
                {who ? <Avatar player={who.player} color={who.color} size={18} /> : null}
                <span className="truncate">
                  {nameOf(id)}
                  {id === playerId ? ` (${t("invention.you")})` : ""}
                </span>
              </div>
            </div>
            <div className="flex-none text-right">
              <div className="font-display text-base sm:text-lg">
                {t("invention.thisRound", { amount: money(funding[id] ?? 0) })}
              </div>
              <div className="font-mono text-[11px] opacity-70">
                {t("invention.total", { amount: money(totalFunding[id] ?? 0) })}
              </div>
            </div>
          </div>
        );
      })}
      {!final ? (
        isAdmin ? (
          <Button
            variant="hue"
            gameType="invention"
            onClick={onNextRound}
            className="w-full"
            data-testid="invention-next-round"
          >
            {t("invention.nextRound")}
          </Button>
        ) : (
          <Banner variant="waiting">{t("invention.waitingRound")}</Banner>
        )
      ) : null}
    </div>
  );
}
