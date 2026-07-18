"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { TimerBadge, Banner, Button, HowToPlayModal } from "../ui";
import { hueFor } from "../ui/gameHues";
import type { GameProps } from "./types";

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
  deadline?: number;
};

export function FibberGame(props: GameProps) {
  const { t } = useI18n();
  const pub = props.publicState as FibberPublic | null;
  const priv = props.privateState as
    | { lie?: string; choice?: number; ownOption?: number }
    | null;
  const hue = hueFor("fibber");
  const [lie, setLie] = useState("");
  const [showHow, setShowHow] = useState(false);

  // Reset the local lie draft each new round.
  useEffect(() => {
    setLie("");
  }, [pub?.round]);

  if (!pub) return null;
  const nameOf = (id: string) =>
    props.players.find((p) => p.id === id)?.name ?? "?";

  return (
    <div className="flex flex-col gap-4">
      <HowToPlayModal
        open={showHow}
        gameType="fibber"
        gameName="Fibber"
        stepCount={3}
        onClose={() => setShowHow(false)}
      />
      <div className="flex items-center justify-between">
        <span className="mono-caption" style={{ color: hue.base }}>
          {t("common.round", { n: pub.round, total: pub.totalRounds })}
        </span>
        {pub.deadline && pub.phase !== "reveal" ? (
          <TimerBadge deadline={pub.deadline} />
        ) : null}
      </div>

      <div
        className="rounded-2xl p-5 text-center"
        style={{ background: `linear-gradient(180deg,${hue.gradFrom},${hue.gradTo})`, color: hue.ink, boxShadow: `0 5px 0 ${hue.drop}` }}
      >
        <div className="mono-caption mb-1" style={{ color: hue.ink }}>
          {t("fibber.prompt")}
        </div>
        <div className="slab text-lg leading-snug">{pub.prompt}</div>
      </div>

      {/* WRITING */}
      {pub.phase === "writing" &&
        (priv?.lie ? (
          <Banner variant="waiting">{t("fibber.lieIn")}</Banner>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="mono-caption">{t("fibber.writeLie")}</div>
            <input
              value={lie}
              onChange={(e) => setLie(e.target.value)}
              maxLength={80}
              placeholder={t("fibber.liePlaceholder")}
              className="w-full rounded-xl border-2 border-(--line) bg-(--panel) px-4 py-3 text-(--ink) focus:border-(--accent-2) focus:outline-none"
            />
            <Button
              variant="hue"
              gameType="fibber"
              disabled={!lie.trim()}
              onClick={() => props.sendAction({ action: "lie", lie: lie.trim() })}
            >
              {t("fibber.submitLie")}
            </Button>
          </div>
        ))}

      {/* CHOOSING */}
      {pub.phase === "choosing" && (
        <div className="flex flex-col gap-2">
          <div className="mono-caption">{t("fibber.findTruth")}</div>
          {(pub.options as string[]).map((text, i) => {
            const own = priv?.ownOption === i;
            const picked = priv?.choice === i;
            return (
              <button
                key={i}
                disabled={own || priv?.choice !== undefined}
                onClick={() => props.sendAction({ action: "choose", choice: i })}
                className="rounded-xl border-2 px-4 py-3 text-left font-semibold transition disabled:cursor-default"
                style={{
                  borderColor: picked ? hue.base : "var(--line)",
                  background: picked ? `${hue.base}22` : "var(--panel)",
                  opacity: own ? 0.4 : 1,
                }}
              >
                {text}
                {own ? (
                  <span className="ml-2 font-mono text-[10px] text-(--ink)/50">
                    {t("fibber.yourLie")}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      {/* REVEAL */}
      {pub.phase === "reveal" && (
        <div className="flex flex-col gap-2">
          <div className="rounded-xl border-2 border-(--accent-2) bg-(--accent-2)/10 px-4 py-3 text-center">
            <span className="mono-caption">{t("fibber.theTruth")}</span>
            <div className="slab text-lg text-(--ink)">{pub.answer}</div>
          </div>
          {(pub.options as FibOption[]).map((o, i) => {
            const pickers = Object.entries(pub.picks ?? {})
              .filter(([, idx]) => idx === i)
              .map(([pid]) => nameOf(pid));
            return (
              <div
                key={i}
                className="rounded-xl border-2 px-4 py-2.5"
                style={{
                  borderColor: o.truth ? "#35d4b9" : "var(--line)",
                  background: o.truth ? "rgba(53,212,185,.12)" : "var(--panel)",
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-(--ink)">{o.text}</span>
                  <span className="font-mono text-[10px] text-(--ink)/50">
                    {o.truth ? t("fibber.truthTag") : `${t("fibber.by")} ${nameOf(o.author)}`}
                  </span>
                </div>
                {pickers.length > 0 ? (
                  <div className="mt-1 font-mono text-[10px] text-(--ink)/45">
                    {t("fibber.pickedBy")}: {pickers.join(", ")}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-1">
        <Button variant="ghost" onClick={() => setShowHow(true)}>
          {t("common.howToPlay")}
        </Button>
      </div>
    </div>
  );
}
