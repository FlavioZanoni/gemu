"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useParams, useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { useRoomStore } from "@/lib/roomStore";
import type { SessionFinal } from "@/lib/protocol";
import { gameSettings, minPlayersFor } from "@/lib/games";
import { actionErrorText } from "@/lib/joinErrors";
import { LobbyScreen } from "@/components/screens/LobbyScreen";
import { PlayingScreen } from "@/components/screens/PlayingScreen";
import { ResultsScreen } from "@/components/screens/ResultsScreen";
import { VotingScreen } from "@/components/screens/VotingScreen";
import { PodiumScreen } from "@/components/screens/PodiumScreen";
import { JoinGateScreen } from "@/components/screens/JoinGateScreen";
import { PauseOverlay } from "@/components/screens/PauseOverlay";
import { IntroScreen } from "@/components/screens/IntroScreen";
import { DrumrollOverlay } from "@/components/screens/DrumrollOverlay";
import { BoardScreen } from "@/components/screens/SessionScoreboard";
import { ManageSheet, RoomMenu, ScorePeek } from "@/components/screens/RoomControls";
import { KickedScreen, OffAirScreen, ReplacedScreen, StatusScreen } from "@/components/screens/EdgeScreens";
import { Banner, LangToggle, SfxToggle } from "@/components/ui";
import { awfulPending, inFrame, useAwful } from "@/lib/awful";
import { AwfulGate } from "@/components/AwfulBridge";

const noopSubscribe = () => () => {};

export default function RoomPage() {
  const { t } = useI18n();
  const params = useParams();
  const router = useRouter();
  const roomId: string = Array.isArray(params.roomId)
    ? params.roomId[0]
    : (params.roomId ?? "");
  const room = useRoomStore();
  const awful = useAwful();
  const embedded = awfulPending(awful);
  // false on the server and during hydration, true afterwards.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);

  // Read once on the client: the saved seat and an invite code from the URL.
  const [lastRoom] = useState(() => (typeof window === "undefined" ? null : room.loadLastRoom()));
  const [inviteCode] = useState(() =>
    typeof window === "undefined"
      ? ""
      : new URLSearchParams(window.location.search).get("code")?.trim().toUpperCase() || "",
  );
  // Framed (awful.chat): the bridge owns joining with the host's session.
  const [willAutoJoin] = useState(
    () => typeof window !== "undefined" && !!lastRoom && lastRoom.roomId === roomId && !inFrame(),
  );

  const [dismissedFinal, setDismissedFinal] = useState<SessionFinal | null>(null);
  const [boardForGame, setBoardForGame] = useState<number | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  // Intro options, per queued game: a new game starts from its defaults.
  const [introSettings, setIntroSettings] = useState<{ game: string; values: Record<string, number> }>({
    game: "",
    values: {},
  });

  useEffect(() => {
    // Embedded in awful.chat there is no home page to go back to: the gate
    // offers to close the tile instead.
    if (room.left && !embedded) router.push("/");
  }, [room.left, embedded, router]);

  // One-shot auto-rejoin from the saved profile (guarded by ref: the store
  // object is a new reference every render).
  const autoJoinRan = useRef(false);
  useEffect(() => {
    if (autoJoinRan.current || !willAutoJoin || !lastRoom) return;
    autoJoinRan.current = true;
    if (room.snapshot) return;
    room.joinRoom({
      roomId: lastRoom.roomId,
      joinCode: inviteCode || lastRoom.joinCode,
      password: lastRoom.password,
      displayName: lastRoom.displayName,
      avatarUrl: lastRoom.avatarUrl,
    });
  }, [willAutoJoin, lastRoom, inviteCode, room]);

  const snapshot = room.snapshot;
  const players = useMemo(() => snapshot?.players ?? [], [snapshot]);
  const currentPlayer = players.find((player) => player.id === room.playerId);
  const status = snapshot?.status ?? null;
  const nextGameType = snapshot?.nextGameType || "";
  const playedCount = snapshot?.playedGames?.length ?? 0;

  // The room snapshot's history is authoritative for the results screen; the
  // pushed session.gameResult only fills in until the snapshot has it.
  const effectiveGameResult = useMemo(() => {
    const played = snapshot?.playedGames;
    if (status === "results" && played && played.length > 0) return played[played.length - 1];
    return status === "results" ? room.gameResult : null;
  }, [room.gameResult, snapshot?.playedGames, status]);

  const showPodium = Boolean(room.sessionFinal) && room.sessionFinal !== dismissedFinal;
  const introValues = introSettings.game === nextGameType ? introSettings.values : {};
  const settingsFor = (gameType: string) => {
    const values = introSettings.game === gameType ? introSettings.values : {};
    const out: Record<string, number> = {};
    for (const spec of gameSettings[gameType] ?? []) out[spec.key] = values[spec.key] ?? spec.def;
    return out;
  };

  // Intro: the game starts by itself once everyone connected is ready (the
  // host's client sends it, once per readiness state).
  const connected = players.filter((p) => p.connected);
  const allReady = connected.length > 0 && connected.every((p) => p.ready);
  const readySig = connected.map((p) => `${p.id}:${p.ready ? 1 : 0}`).join(",");
  const autoStartKey = useRef<string | null>(null);
  const canAutoStart =
    room.isAdmin &&
    status === "lobby" &&
    !!nextGameType &&
    !room.drumroll &&
    !snapshot?.paused &&
    allReady &&
    connected.length >= Math.max(2, minPlayersFor(nextGameType));
  useEffect(() => {
    if (!canAutoStart) return;
    const key = `${nextGameType}:${playedCount}:${readySig}`;
    if (autoStartKey.current === key) return;
    autoStartKey.current = key;
    room.startGame({ settings: settingsFor(nextGameType) });
    // settingsFor reads introSettings; the key guards against re-sending.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAutoStart, nextGameType, playedCount, readySig]);

  if (room.replaced) {
    return (
      <ReplacedScreen
        onReclaim={() => room.reclaimRoom()}
        pending={room.pendingJoin}
        onHome={
          embedded
            ? undefined
            : () => {
                room.resetRoomFlags();
                router.push("/");
              }
        }
      />
    );
  }

  if (embedded && (room.kicked || room.left || room.leaving || !snapshot)) {
    return <AwfulGate />;
  }

  if (room.kicked) {
    return (
      <KickedScreen
        onHome={() => {
          room.resetRoomFlags();
          router.push("/");
        }}
      />
    );
  }

  if (room.leaving || room.left) {
    return <StatusScreen title={t("edge.leaving")} caption={t("edge.returnToLobby")} />;
  }

  if (!snapshot) {
    if (mounted && (room.joinError === "not_found" || room.joinError === "invalid_room")) {
      return <OffAirScreen code={lastRoom?.roomId === roomId ? lastRoom?.joinCode : inviteCode || undefined} onHome={() => router.push("/")} />;
    }
    // Join gate: before any auto-join attempt, or after one failed.
    if (mounted && (!willAutoJoin || room.joinError) && !(willAutoJoin && room.pendingJoin)) {
      return (
        <JoinGateScreen
          joinError={room.joinError}
          pendingJoin={room.pendingJoin}
          defaultName={lastRoom?.displayName ?? ""}
          defaultAvatarUrl={lastRoom?.avatarUrl ?? ""}
          defaultCode={inviteCode}
          onHome={() => router.push("/")}
          onJoin={(displayName, avatarUrl, joinCode, password) => {
            room.joinRoom({ roomId, displayName, avatarUrl, joinCode, password });
          }}
        />
      );
    }
    return <StatusScreen title={t("edge.joining")} caption={t("edge.pleaseWait")} />;
  }

  const manage = room.isAdmin ? () => setManageOpen(true) : undefined;
  const chrome = (
    <div className="flex flex-none items-center gap-2">
      {playedCount > 0 ? <ScorePeek snapshot={snapshot} players={players} playerId={room.playerId} /> : null}
      <SfxToggle />
      <LangToggle />
      <RoomMenu
        snapshot={snapshot}
        players={players}
        playerId={room.playerId}
        isAdmin={room.isAdmin}
        onLeave={() => room.leaveRoom()}
        onManage={manage}
      />
    </div>
  );

  const inLobby = status === "lobby" && !nextGameType && !showPodium;
  const boardOpen = status === "results" && boardForGame === playedCount;

  let screen: React.ReactNode = null;
  if (showPodium) {
    screen = (
      <PodiumScreen
        sessionFinal={room.sessionFinal!}
        players={players}
        onBackToLobby={() => setDismissedFinal(room.sessionFinal)}
      />
    );
  } else if (inLobby) {
    screen = (
      <LobbyScreen
        snapshot={snapshot}
        players={players}
        isAdmin={room.isAdmin}
        currentPlayer={currentPlayer}
        chrome={chrome}
        onSetReady={(ready) => room.setReady(ready)}
        onStartShow={() => room.startShow()}
        onSetPlaylist={(playlist) => room.setPlaylist(playlist)}
        onKick={(id) => room.kickPlayer(id)}
        decks={room.decks}
        deckAdd={room.deckAdd}
        onSetCahDecks={(ids) => room.setCahDecks(ids)}
        onAddCustomDeck={(deck) => room.addCustomDeck(deck)}
      />
    );
  } else if (status === "lobby" && nextGameType) {
    screen = (
      <IntroScreen
        key={nextGameType}
        gameType={nextGameType}
        gameNumber={playedCount + 1}
        settings={introValues}
        isAdmin={room.isAdmin}
        players={players}
        playerId={room.playerId}
        onSetting={(key, value) =>
          setIntroSettings((prev) => ({
            game: nextGameType,
            values: { ...(prev.game === nextGameType ? prev.values : {}), [key]: value },
          }))
        }
        onReady={() => room.setReady(true)}
        onStartNow={() => room.startGame({ force: true, settings: settingsFor(nextGameType) })}
        onManage={manage}
      />
    );
  } else if (status === "results") {
    screen =
      boardOpen || !effectiveGameResult ? (
        <BoardScreen
          isAdmin={room.isAdmin}
          sessionScores={snapshot.sessionScores ?? {}}
          players={players}
          playedGames={snapshot.playedGames ?? []}
          playerId={room.playerId}
          onKeepPlaying={() => setBoardForGame(null)}
          onEndNight={() => room.endSession()}
        />
      ) : (
        <ResultsScreen
          gameResult={effectiveGameResult}
          players={players}
          playerId={room.playerId}
          isAdmin={room.isAdmin}
          onPlayAgain={() => room.replayGame()}
          onVoteNext={() => room.startVote()}
          onOpenBoard={() => setBoardForGame(playedCount)}
          onManage={manage}
        />
      );
  } else if (status === "voting") {
    screen = <VotingScreen key={room.vote?.deadline ?? 0} vote={room.vote} players={players} onCastVote={(type) => room.castVote(type)} />;
  }

  return (
    <div className="radial-glow flex min-h-dvh flex-col">
      {room.reconnecting ? (
        <div className="px-3 pt-3 sm:px-8">
          <Banner variant="reconnecting">{t("edge.reconnecting")}</Banner>
        </div>
      ) : null}

      {status === "playing" && !showPodium ? (
        <PlayingScreen
          snapshot={snapshot}
          players={players}
          playerId={room.playerId ?? ""}
          standings={room.standings}
          gamePublicState={room.gamePublicState}
          gamePrivateState={room.gamePrivateState}
          isAdmin={room.isAdmin}
          onSendAction={(payload) => room.sendGameAction(payload)}
          onSendStream={(payload) => room.sendGameStream(payload)}
          onLeave={() => room.leaveRoom()}
          onPause={() => room.pauseSession()}
        />
      ) : (
        <>
          {!inLobby ? (
            <div className="mx-auto flex w-full max-w-[1240px] justify-end px-4 pt-3 sm:px-8" data-testid="room-topbar">
              {chrome}
            </div>
          ) : null}
          <main className="mx-auto flex w-full max-w-[1240px] flex-1 flex-col px-4 sm:px-8">{screen}</main>
        </>
      )}

      {snapshot.paused && status === "playing" ? (
        <PauseOverlay isAdmin={room.isAdmin} onResume={() => room.resumeSession()} onLeave={() => room.leaveRoom()} />
      ) : null}

      {room.drumroll ? <DrumrollOverlay key={room.drumroll.key} gameType={room.drumroll.gameType} /> : null}

      {manage ? (
        <ManageSheet
          open={manageOpen}
          onClose={() => setManageOpen(false)}
          snapshot={snapshot}
          players={players}
          isAdmin={room.isAdmin}
          decks={room.decks}
          deckAdd={room.deckAdd}
          onSetPlaylist={(playlist) => room.setPlaylist(playlist)}
          onKick={(id) => room.kickPlayer(id)}
          onSetCahDecks={(ids) => room.setCahDecks(ids)}
          onAddCustomDeck={(deck) => room.addCustomDeck(deck)}
        />
      ) : null}

      {/* Transient error toast: fixed, so it never shifts the layout. */}
      {room.actionError ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4">
          <div
            role="alert"
            data-testid="action-error"
            data-code={room.actionError.code}
            className="pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl border-2 border-(--danger) bg-[#3d1420] px-4 py-3 shadow-[0_10px_30px_rgba(0,0,0,.5)]"
          >
            <p className="text-sm font-semibold text-[#ffb3c1]">{actionErrorText(room.actionError.code, t)}</p>
            <button
              type="button"
              onClick={() => room.clearActionError()}
              className="flex-none text-xs font-bold text-[#ffb3c1] hover:opacity-75"
            >
              {t("common.dismiss")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
