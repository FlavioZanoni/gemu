"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { CustomDeck, DeckMeta, Player, RoomSnapshot } from "@/lib/protocol";
import { CodePill, PasswordPill } from "@/components/ui";
import { DeckPicker } from "./DeckPicker";
import { ContestantList, PlaylistGrid } from "./RoomControls";

/** The green room (Gemu Screens · 2): tonight's playlist, contestants,
 *  ready up, and the host's START THE SHOW (a random eligible first game,
 *  revealed by the drumroll and the intro). */
export function LobbyScreen({
  snapshot,
  players,
  isAdmin,
  currentPlayer,
  chrome,
  onSetReady,
  onStartShow,
  onSetPlaylist,
  onKick,
  decks,
  deckAdd,
  onSetCahDecks,
  onAddCustomDeck,
}: {
  snapshot: RoomSnapshot;
  players: Player[];
  isAdmin: boolean;
  currentPlayer: Player | undefined;
  /** Room chrome (sound, language, menu) for the header's right side. */
  chrome?: ReactNode;
  onSetReady: (ready: boolean) => void;
  onStartShow: () => void;
  onSetPlaylist: (playlist: string[]) => void;
  onKick?: (playerId: string) => void;
  decks: DeckMeta[];
  deckAdd: { seq: number; status: "pending" | "ok" | "error"; message?: string } | null;
  onSetCahDecks: (ids: string[]) => void;
  onAddCustomDeck: (deck: CustomDeck) => number;
}) {
  const { t } = useI18n();
  const [deckPickerOpen, setDeckPickerOpen] = useState(false);

  const toggleDeck = (id: string) => {
    const base = decks.filter((d) => d.id.startsWith("base_")).map((d) => d.id);
    const current = snapshot.cahDeckIds.length > 0 ? snapshot.cahDeckIds : base;
    const next = current.includes(id) ? current.filter((d) => d !== id) : [...current, id];
    onSetCahDecks(next);
  };

  const connectedPlayers = useMemo(() => players.filter((p) => p.connected), [players]);
  const readyCount = connectedPlayers.filter((p) => p.ready).length;
  const canStart = connectedPlayers.length >= 2;
  const ready = Boolean(currentPlayer?.ready);

  return (
    <div className="flex flex-col gap-6 py-6 sm:py-8" data-testid="lobby" data-room-locale={snapshot.locale}>
      {/* Header: room name + code pill + chrome. Wraps on phones. */}
      <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-3">
        <div className="min-w-0">
          <h1 className="slab break-words text-[clamp(24px,6vw,30px)] leading-tight" style={{ textShadow: "0 3px 0 var(--drop)" }}>
            {snapshot.name}
          </h1>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.1em] text-(--ink)/50">
            {t("lobby.greenRoom")}
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          {snapshot.joinCode ? <CodePill code={snapshot.joinCode} label={t("lobby.code")} /> : null}
          {snapshot.hasPassword ? <PasswordPill /> : null}
          {chrome}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.45fr_1fr] lg:gap-8">
        {/* Left: playlist and the big buttons */}
        <div className="min-w-0">
          <div className="mb-3 flex items-baseline gap-2">
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.3em] text-(--ink)/50">
              {t("lobby.playlist")}
            </span>
            {isAdmin ? (
              <span className="font-mono text-[11px] font-bold text-(--accent-2)">· {t("lobby.tapToEdit")}</span>
            ) : null}
          </div>
          <PlaylistGrid
            snapshot={snapshot}
            isAdmin={isAdmin}
            connectedCount={connectedPlayers.length}
            onSetPlaylist={onSetPlaylist}
            onOpenDecks={() => setDeckPickerOpen(true)}
          />

          <DeckPicker
            open={deckPickerOpen}
            onClose={() => setDeckPickerOpen(false)}
            decks={decks}
            selected={snapshot.cahDeckIds}
            deckAdd={deckAdd}
            onToggle={toggleDeck}
            onAddCustom={onAddCustomDeck}
          />

        </div>

        {/* Right: contestants */}
        <aside className="min-w-0 lg:row-span-2">
          <div className="mb-3 flex items-baseline justify-between">
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.3em] text-(--ink)/50">
              {t("lobby.contestants")}
            </span>
            <span
              className="font-mono text-xs font-bold text-(--accent-2)"
              data-testid="ready-count"
              data-ready={readyCount}
              data-total={connectedPlayers.length}
            >
              {t("lobby.readyCount", { ready: readyCount, total: connectedPlayers.length })}
            </span>
          </div>
          <div className="lg:max-h-[65vh] lg:overflow-y-auto">
            <ContestantList snapshot={snapshot} players={players} isAdmin={isAdmin} onKick={onKick} showSpots />
          </div>
        </aside>

        {/* Ready / start: after the contestants on phones, pinned to the
            bottom edge so they're always reachable in a short tile. */}
        <div className="sticky bottom-0 z-10 -mx-4 bg-[linear-gradient(180deg,transparent,var(--bg)_28%)] px-4 pb-3 pt-5 sm:-mx-8 sm:px-8 lg:static lg:mx-0 lg:bg-none lg:p-0 [@media(max-height:520px)]:pb-2 [@media(max-height:520px)]:pt-3">
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => onSetReady(!ready)}
              data-testid="ready-up"
              aria-pressed={ready}
              className="buzzer flex min-w-[120px] flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-2xl px-4 py-4 text-[clamp(15px,3.6vw,19px)] uppercase [@media(max-height:520px)]:py-2.5"
              style={
                ready
                  ? {
                      background: "linear-gradient(180deg,#41e0c4,#28b89e)",
                      color: "#0c3d33",
                      ["--buzzer-drop" as string]: "#0f6e5c",
                    }
                  : {
                      background: "var(--panel)",
                      color: "var(--accent-2)",
                      border: "2px solid var(--accent-2)",
                      ["--buzzer-drop" as string]: "rgba(0,0,0,.4)",
                    }
              }
            >
              {ready ? (
                <>
                  <Check size={18} strokeWidth={3} aria-hidden /> {t("common.ready")}
                </>
              ) : (
                t("lobby.readyUp")
              )}
            </button>

            {isAdmin ? (
              <button
                type="button"
                disabled={!canStart}
                onClick={onStartShow}
                data-testid="start-game"
                className="buzzer flex min-w-[170px] items-center justify-center whitespace-nowrap rounded-2xl px-4 py-4 text-[clamp(15px,3.6vw,19px)] uppercase [@media(max-height:520px)]:py-2.5"
                style={{
                  flex: 1.4,
                  background: "linear-gradient(180deg,#ffd23f,#f5b32a)",
                  color: "var(--dark-ink)",
                  boxShadow: "0 7px 0 var(--drop)",
                }}
              >
                {t("lobby.startGame")} ▶
              </button>
            ) : null}
          </div>

          <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-[0.1em] text-(--ink)/40 [@media(max-height:520px)]:mt-1.5">
            {isAdmin && !canStart ? t("lobby.needTwo") : isAdmin ? t("lobby.firstGameRandom") : t("lobby.waitingForHost")}
          </p>
        </div>
      </div>
    </div>
  );
}
