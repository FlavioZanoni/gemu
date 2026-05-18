"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useRoomStore } from "../../../lib/roomStore";
import { RoomHeader } from "../../../components/RoomHeader";
import { PlayerList } from "../../../components/PlayerList";
import { GameSurface } from "../../../components/GameSurface";

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = Array.isArray(params.roomId)
    ? params.roomId[0]
    : params.roomId;
  const room = useRoomStore();
  const [joinCode, setJoinCode] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [name, setName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [attemptedAutoJoin, setAttemptedAutoJoin] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const countdownStartedRef = useRef(false);
  const startGameRef = useRef(room.startGame);

  useEffect(() => {
    startGameRef.current = room.startGame;
  }, [room.startGame]);

  useEffect(() => {
    if (room.left) {
      router.push("/");
    }
  }, [room.left, router]);

  useEffect(() => {
    setMounted(true);
    const lastRoom = room.loadLastRoom();
    if (lastRoom) {
      setName(lastRoom.displayName || "");
      setAvatarUrl(lastRoom.avatarUrl || "");
      if (lastRoom.roomId === roomId && !room.snapshot) {
        room.joinRoom({
          roomId: lastRoom.roomId,
          joinCode: lastRoom.joinCode,
          displayName: lastRoom.displayName,
          avatarUrl: lastRoom.avatarUrl,
        });
        setAttemptedAutoJoin(true);
      }
    }
  }, [roomId, room, setMounted, setName, setAvatarUrl, setAttemptedAutoJoin]);

  const players = useMemo(() => room.snapshot?.players ?? [], [room.snapshot]);
  const currentPlayer = useMemo(
    () => players.find((player) => player.id === room.playerId),
    [players, room.playerId],
  );
  const allConnectedReady = useMemo(() => {
    const connectedPlayers = players.filter((player) => player.connected);
    if (connectedPlayers.length < 2) return false;
    return connectedPlayers.every((player) => player.ready);
  }, [players]);
  const connectedCount = useMemo(
    () => players.filter((player) => player.connected).length,
    [players],
  );
  const readyCount = useMemo(
    () => players.filter((player) => player.connected && player.ready).length,
    [players],
  );

  const gameStarted = useMemo(() => {
    const publicState = room.gamePublicState ?? {};
    if (publicState.started === true) return true;
    if (typeof publicState.phase === "string") {
      return publicState.phase !== "collecting";
    }
    return false;
  }, [room.gamePublicState]);

  useEffect(() => {
    if (!allConnectedReady || gameStarted) {
      countdownStartedRef.current = false;
      setCountdown(null);
      return;
    }

    if (countdownStartedRef.current) return;
    countdownStartedRef.current = true;
    setCountdown(3);

    const interval = window.setInterval(() => {
      setCountdown((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          window.clearInterval(interval);
          if (room.isAdmin && connectedCount >= 2) {
            startGameRef.current(false);
          }
          return null;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [allConnectedReady, gameStarted, connectedCount, room.isAdmin]);

  useEffect(() => {
    if (!gameStarted) {
      setFullscreen(false);
    }
  }, [gameStarted, setFullscreen]);

  if (room.kicked) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-16">
          <div className="glass-panel retro-card p-8 text-center">
            <h1 className="font-display text-3xl text-(--retro-cream)">
              You were kicked
            </h1>
            <p className="mt-3 text-sm text-(--retro-cream)/75">
              The host removed you from this room. You can head back to the
              lobby to join a different game.
            </p>
            <button
              className="retro-btn mt-6 border-2 border-(--retro-cream) bg-(--surface) px-5 py-2 text-sm font-semibold text-(--retro-cream)"
              onClick={() => router.push("/")}
            >
              Return to lobby
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (room.leaving) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <div className="text-center">
          <div className="text-2xl font-semibold text-(--retro-cream)">
            Leaving room...
          </div>
          <p className="mt-2 text-sm text-(--retro-cream)/70">
            Returning to lobby
          </p>
        </div>
      </div>
    );
  }

  if (!room.snapshot && !attemptedAutoJoin) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-16">
          <div className="glass-panel retro-card p-8">
            <h1 className="font-display text-2xl text-(--retro-cream)">
              Join room
            </h1>
            <p className="mt-2 text-sm text-(--retro-cream)/75">
              Enter your details to join room {roomId}.
            </p>
            <div className="mt-6 grid gap-4">
              {mounted && (
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border-2 border-(--retro-cream) bg-(--surface)">
                    {avatarUrl.trim() ? (
                      <img
                        src={avatarUrl.trim()}
                        alt="Avatar preview"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-2xl text-(--retro-cream)/50">
                        ?
                      </span>
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-(--retro-cream)">
                      Avatar Preview
                    </p>
                    <p className="text-xs text-(--retro-cream)/65">
                      Supports images and GIFs
                    </p>
                  </div>
                </div>
              )}
              <input
                className="retro-card border-2 border-(--retro-cream) bg-(--surface) px-4 py-3 text-sm text-(--retro-cream)"
                placeholder="Display name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setLocalError(null);
                }}
              />
              <input
                className="retro-card border-2 border-(--retro-cream) bg-(--surface) px-4 py-3 text-sm text-(--retro-cream)"
                placeholder="Avatar URL (supports GIFs)"
                value={avatarUrl}
                onChange={(event) => {
                  setAvatarUrl(event.target.value);
                  setLocalError(null);
                }}
              />
              <input
                className="retro-card border-2 border-(--retro-cream) bg-(--surface) px-4 py-3 text-sm text-(--retro-cream)"
                placeholder="Join code (if private)"
                value={joinCode}
                onChange={(event) => {
                  setJoinCode(event.target.value);
                  setLocalError(null);
                }}
              />
              {localError ? (
                <p className="text-sm text-red-300">{localError}</p>
              ) : null}
              {room.joinError ? (
                <p className="text-sm text-red-300">{room.joinError}</p>
              ) : null}
              <button
                className="retro-btn bg-(--accent) px-5 py-2 text-sm font-semibold text-(--retro-ink) disabled:opacity-50"
                onClick={() =>
                  name.trim()
                    ? room.joinRoom({
                        roomId: roomId ?? "",
                        joinCode: joinCode.trim() || undefined,
                        displayName: name.trim(),
                        avatarUrl: avatarUrl.trim(),
                      })
                    : setLocalError("Display name is required.")
                }
                disabled={room.pendingJoin || !name.trim()}
              >
                {room.pendingJoin ? "Joining..." : "Join room"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!room.snapshot && attemptedAutoJoin && room.joinError) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-16">
          <div className="glass-panel retro-card p-8">
            <h1 className="font-display text-2xl text-(--retro-cream)">
              Rejoin failed
            </h1>
            <p className="mt-2 text-sm text-(--retro-cream)/75">
              Could not rejoin the room automatically. Please enter your details
              again.
            </p>
            <div className="mt-6 grid gap-4">
              <input
                className="retro-card border-2 border-(--retro-cream) bg-(--surface) px-4 py-3 text-sm text-(--retro-cream)"
                placeholder="Display name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setLocalError(null);
                }}
              />
              <input
                className="retro-card border-2 border-(--retro-cream) bg-(--surface) px-4 py-3 text-sm text-(--retro-cream)"
                placeholder="Avatar URL (supports GIFs)"
                value={avatarUrl}
                onChange={(event) => {
                  setAvatarUrl(event.target.value);
                  setLocalError(null);
                }}
              />
              <input
                className="retro-card border-2 border-(--retro-cream) bg-(--surface) px-4 py-3 text-sm text-(--retro-cream)"
                placeholder="Join code (if private)"
                value={joinCode}
                onChange={(event) => {
                  setJoinCode(event.target.value);
                  setLocalError(null);
                }}
              />
              {localError ? (
                <p className="text-sm text-red-300">{localError}</p>
              ) : null}
              <button
                className="retro-btn bg-(--accent) px-5 py-2 text-sm font-semibold text-(--retro-ink) disabled:opacity-50"
                onClick={() =>
                  name.trim()
                    ? room.joinRoom({
                        roomId: roomId ?? "",
                        joinCode: joinCode.trim() || undefined,
                        displayName: name.trim(),
                        avatarUrl: avatarUrl.trim(),
                      })
                    : setLocalError("Display name is required.")
                }
                disabled={room.pendingJoin || !name.trim()}
              >
                {room.pendingJoin ? "Joining..." : "Join room"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!room.snapshot) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <div className="text-center">
          <div className="text-2xl font-semibold text-(--retro-cream)">
            Joining room...
          </div>
          <p className="mt-2 text-sm text-(--retro-cream)/70">Please wait</p>
        </div>
      </div>
    );
  }

const gameSurface = (
  <GameSurface
    gameType={room.snapshot.gameType}
    roomId={room.snapshot.id}
    playerId={room.playerId ?? ""}
    players={players.map((player) => ({
      id: player.id,
      name: player.name,
    }))}
    publicState={room.gamePublicState}
    privateState={room.gamePrivateState}
    sendAction={room.sendGameAction}
    onFullscreenToggle={() => setFullscreen(!fullscreen)}
    isAdmin={room.isAdmin}
    onLeave={() => room.leaveRoom()}
  />
);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="radial-glow min-h-screen">
        <div className="grid-texture min-h-screen">
          {countdown !== null ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-(--retro-ink)/80">
              <div className="text-center">
                <div className="font-display text-6xl text-(--retro-cream)">
                  {countdown}
                </div>
                <p className="mt-3 text-sm text-(--retro-cream)/70">
                  Game starts now
                </p>
              </div>
            </div>
          ) : null}
          <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-12">
            {!fullscreen && (
          <RoomHeader
            roomName={room.snapshot.name}
            gameType={room.snapshot.gameType}
            gameName={room.snapshot.gameName ?? ""}
            playerCount={players.length}
            maxPlayers={room.snapshot.maxPlayers}
            roomId={room.snapshot.id}
            joinCode={room.snapshot.joinCode}
            onLeave={() => room.leaveRoom()}
          />
            )}

            {fullscreen && gameStarted ? (
              <div className="glass-panel retro-card min-h-screen p-4">
                {gameSurface}
              </div>
            ) : gameStarted ? (
              <section className="grid gap-6 lg:grid-cols-[1fr_3fr]">
                <PlayerList
                  players={players}
                  adminId={room.snapshot.adminId}
                  isAdmin={room.isAdmin}
                  onKick={(playerId) => room.kickPlayer(playerId)}
                  readyCount={readyCount}
                  connectedCount={connectedCount}
                  showReady={false}
                />
                <div className="min-h-[80vh]">
                  {gameSurface}
                </div>
              </section>
            ) : (
              <section className="grid gap-6 lg:grid-cols-[1fr_3fr]">
                <PlayerList
                  players={players}
                  adminId={room.snapshot.adminId}
                  isAdmin={room.isAdmin}
                  onKick={(playerId) => room.kickPlayer(playerId)}
                  readyCount={readyCount}
                  connectedCount={connectedCount}
                  showReady={true}
                />
                <section className="glass-panel retro-card min-h-[80vh] p-6">
                  <div className="flex min-h-[70vh] flex-col items-center justify-center text-center">
                    <h2 className="font-display text-lg text-(--retro-cream)">
                      Waiting room
                    </h2>
                    <p className="mt-2 text-sm text-(--retro-cream)/75">
                      {allConnectedReady
                        ? "Everyone is ready. Starting..."
                        : "Get everyone ready before the game starts."}
                    </p>
                    <div className="mt-6 flex flex-wrap justify-center gap-3">
                      <button
                        className={`retro-btn px-5 py-2 text-sm font-semibold ${
                          currentPlayer?.ready
                            ? "bg-(--accent-2) text-(--retro-ink)"
                            : "bg-(--accent) text-(--retro-ink)"
                        }`}
                        onClick={() => room.setReady(!currentPlayer?.ready)}
                      >
                        {currentPlayer?.ready ? "Unready" : "Ready up"}
                      </button>
                      {room.isAdmin && !allConnectedReady ? (
                        <button
                          className="retro-btn border-2 border-(--retro-cream) bg-(--surface) px-5 py-2 text-sm font-semibold text-(--retro-cream) disabled:opacity-50"
                          onClick={() => room.startGame(true)}
                          disabled={connectedCount < 2}
                        >
                          Force start
                        </button>
                      ) : null}
                    </div>
                  </div>
                </section>
              </section>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
