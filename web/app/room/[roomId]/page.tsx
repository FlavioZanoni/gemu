"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { useRoomStore } from "@/lib/roomStore";
import { LobbyScreen } from "@/components/screens/LobbyScreen";
import { PlayingScreen } from "@/components/screens/PlayingScreen";
import { ResultsScreen } from "@/components/screens/ResultsScreen";
import { VotingScreen } from "@/components/screens/VotingScreen";
import { PodiumScreen } from "@/components/screens/PodiumScreen";
import { JoinGateScreen } from "@/components/screens/JoinGateScreen";
import { PauseOverlay } from "@/components/screens/PauseOverlay";
import { IntroScreen } from "@/components/screens/IntroScreen";
import { DrumrollOverlay } from "@/components/screens/DrumrollOverlay";
import { Banner, CodePill } from "@/components/ui";

export default function RoomPage() {
  const { t } = useI18n();
  const params = useParams();
  const router = useRouter();
  const roomId: string = Array.isArray(params.roomId)
    ? params.roomId[0]
    : (params.roomId ?? "");
  const room = useRoomStore();
  const [joinCode, setJoinCode] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [name, setName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [attemptedAutoJoin, setAttemptedAutoJoin] = useState(false);
  const [podiumDismissed, setPodiumDismissed] = useState(false);
  const autoJoinRan = useRef(false);

  useEffect(() => {
    if (room.left) {
      router.push("/");
    }
  }, [room.left, router]);

  // A fresh session.final means a fresh podium.
  useEffect(() => {
    if (room.sessionFinal) setPodiumDismissed(false);
  }, [room.sessionFinal]);

  // One-shot auto-rejoin from the saved profile (guarded by ref: the store
  // object is a new reference every render).
  useEffect(() => {
    if (autoJoinRan.current) return;
    autoJoinRan.current = true;
    setMounted(true);
    const lastRoom = room.loadLastRoom();
    const inviteCode =
      new URLSearchParams(window.location.search).get("code")?.trim() || "";
    if (inviteCode) {
      setJoinCode(inviteCode);
    }
    if (lastRoom) {
      setName(lastRoom.displayName || "");
      setAvatarUrl(lastRoom.avatarUrl || "");
      if (lastRoom.roomId === roomId && !room.snapshot) {
        room.joinRoom({
          roomId: lastRoom.roomId,
          joinCode: inviteCode || lastRoom.joinCode,
          password: lastRoom.password,
          displayName: lastRoom.displayName,
          avatarUrl: lastRoom.avatarUrl,
        });
        setAttemptedAutoJoin(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const players = useMemo(() => room.snapshot?.players ?? [], [room.snapshot]);
  const currentPlayer = useMemo(
    () => players.find((player) => player.id === room.playerId),
    [players, room.playerId],
  );

  const status = room.snapshot?.status || null;

  // A rejoiner who missed the session.gameResult push still gets a results
  // screen from the room's played-games history.
  const effectiveGameResult = useMemo(() => {
    if (room.gameResult) return room.gameResult;
    const played = room.snapshot?.playedGames;
    if (status === "results" && played && played.length > 0) {
      return played[played.length - 1];
    }
    return null;
  }, [room.gameResult, room.snapshot?.playedGames, status]);

  const showPodium = Boolean(room.sessionFinal) && !podiumDismissed;

  // Drumroll moment: flash the winner overlay when the next-game vote lands.
  const [drumrollFor, setDrumrollFor] = useState<string | null>(null);
  useEffect(() => {
    if (!room.voteResult) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrumrollFor(room.voteResult.gameType);
    const timer = setTimeout(() => setDrumrollFor(null), 3500);
    return () => clearTimeout(timer);
  }, [room.voteResult]);

  // Game settings chosen on the intro screen, sent with game.start.
  const [introSettings, setIntroSettings] = useState<{ rounds?: number; timer?: number }>({});

  if (room.kicked) {
    return (
      <div className="min-h-screen bg-(--bg) flex items-center justify-center px-6">
        <div className="w-full max-w-2xl rounded-2xl border-2 border-(--line) bg-(--panel) p-8 text-center">
          <h1 className="slab text-4xl mb-3">{t("edge.kicked")}</h1>
          <p className="text-(--ink)/70 text-sm mb-6">
            {t("edge.kickedDesc")}
          </p>
          <button
            onClick={() => router.push("/")}
            className="px-6 py-3 rounded-xl bg-(--accent) text-(--dark-ink) font-bold hover:opacity-90 transition"
          >
            {t("edge.returnToLobby")}
          </button>
        </div>
      </div>
    );
  }

  if (room.leaving) {
    return (
      <div className="min-h-screen bg-(--bg) flex items-center justify-center">
        <div className="text-center">
          <div className="slab text-3xl">{t("edge.leaving")}</div>
          <p className="mt-2 text-sm text-(--ink)/70">
            {t("edge.returnToLobby")}
          </p>
        </div>
      </div>
    );
  }

  // Join gate: show join screen if not in a room yet
  if (!room.snapshot) {
    if (!attemptedAutoJoin && mounted) {
      return (
        <JoinGateScreen
          joinError={room.joinError}
          pendingJoin={room.pendingJoin}
          defaultName={name}
          defaultAvatarUrl={avatarUrl}
          onJoin={(displayName, avatarUrl, joinCode, password) => {
            room.joinRoom({
              roomId: roomId,
              displayName,
              avatarUrl,
              joinCode,
              password,
            });
          }}
        />
      );
    }

    if (attemptedAutoJoin && room.joinError) {
      return (
        <JoinGateScreen
          joinError={room.joinError}
          pendingJoin={room.pendingJoin}
          defaultName={name}
          defaultAvatarUrl={avatarUrl}
          onJoin={(displayName, avatarUrl, joinCode, password) => {
            room.joinRoom({
              roomId: roomId,
              displayName,
              avatarUrl,
              joinCode,
              password,
            });
          }}
        />
      );
    }

    // Loading state
    return (
      <div className="min-h-screen bg-(--bg) flex items-center justify-center">
        <div className="text-center">
          <div className="slab text-3xl">{t("edge.joining")}</div>
          <p className="mt-2 text-sm text-(--ink)/70">
            Please wait
          </p>
        </div>
      </div>
    );
  }

  // Room ready - render by status
  return (
    <div className="min-h-screen bg-(--bg)">
      <div className="radial-glow min-h-screen">
        <div className="grid-texture min-h-screen">
          <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8">
            {/* Reconnecting banner */}
            {room.reconnecting && (
              <Banner variant="reconnecting">
                {t("edge.reconnecting")}
              </Banner>
            )}

            {/* Room header with code */}
            <div className="rounded-2xl border-2 border-(--line) bg-(--panel) p-6 flex items-center justify-between flex-wrap gap-4">
              <div>
                <h1 className="slab text-2xl">{room.snapshot.name}</h1>
                <p className="text-xs text-(--ink)/60">
                  {room.snapshot.gameName || room.snapshot.nextGameName || "—"}
                  {" · "}
                  {players.length}
                  {room.snapshot.maxPlayers > 0
                    ? `/${room.snapshot.maxPlayers}`
                    : ""}
                </p>
              </div>
              {room.snapshot.joinCode ? (
                <CodePill code={room.snapshot.joinCode} label={t("common.roomCode")} />
              ) : null}
            </div>

            {/* Main content by status */}
            {showPodium ? (
              <PodiumScreen
                sessionFinal={room.sessionFinal!}
                onBackToLobby={() => setPodiumDismissed(true)}
              />
            ) : (
              <>
            {status === "lobby" && !room.snapshot.nextGameType && (
              <LobbyScreen
                snapshot={room.snapshot}
                players={players}
                isAdmin={room.isAdmin}
                currentPlayer={currentPlayer}
                onSetReady={(ready) => room.setReady(ready)}
                onStartGame={(force) => room.startGame({ force })}
                onSetPlaylist={(playlist) => room.setPlaylist(playlist)}
                onLeave={() => room.leaveRoom()}
              />
            )}

            {/* Intro: a queued next game (vote winner / replay) gets the
                "up next" treatment with how-to steps and host options. */}
            {status === "lobby" && room.snapshot.nextGameType && (
              <>
                <IntroScreen
                  gameType={room.snapshot.nextGameType}
                  roundCount={introSettings.rounds ?? 3}
                  roundTimer={introSettings.timer ?? 90}
                  isAdmin={room.isAdmin}
                  onSetRounds={(rounds) =>
                    setIntroSettings((prev) => ({ ...prev, rounds }))
                  }
                  onSetTimer={(timer) =>
                    setIntroSettings((prev) => ({ ...prev, timer }))
                  }
                  onReady={() => room.setReady(true)}
                />
                {room.isAdmin && (
                  <div className="flex justify-center">
                    <button
                      className="buzzer rounded-2xl px-8 py-3.5 text-base"
                      style={{
                        background: "linear-gradient(180deg,#ffd23f,#f5b32a)",
                        color: "var(--dark-ink)",
                      }}
                      onClick={() => {
                        const timerKey: Record<string, string> = {
                          stop: "answerSeconds",
                          gartic: "turnSeconds",
                          garticphone: "drawSeconds",
                        };
                        const settings: Record<string, number> = {};
                        if (introSettings.rounds) settings.rounds = introSettings.rounds;
                        const key = timerKey[room.snapshot!.nextGameType];
                        if (introSettings.timer && key) settings[key] = introSettings.timer;
                        room.startGame({ force: true, settings });
                      }}
                    >
                      {t("lobby.startGame").toUpperCase()}
                    </button>
                  </div>
                )}
              </>
            )}

            {status === "playing" && (
              <PlayingScreen
                snapshot={room.snapshot}
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
            )}

            {room.snapshot.paused && (
              <PauseOverlay
                isAdmin={room.isAdmin}
                onResume={() => room.resumeSession()}
              />
            )}

            {drumrollFor && <DrumrollOverlay gameType={drumrollFor} />}

            {status === "results" && effectiveGameResult && (
              <ResultsScreen
                gameResult={effectiveGameResult}
                sessionScores={room.snapshot.sessionScores}
                players={players}
                isAdmin={room.isAdmin}
                onPlayAgain={() => room.replayGame()}
                onVoteNext={() => room.startVote()}
                onEndSession={() => room.endSession()}
              />
            )}

            {status === "voting" && (
              <VotingScreen
                vote={room.vote}
                voteResult={room.voteResult}
                onCastVote={(gameType) => room.castVote(gameType)}
              />
            )}
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
