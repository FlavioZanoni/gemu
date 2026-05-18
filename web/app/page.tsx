"use client";

import { Suspense, useMemo, useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLobbyStore } from "../lib/lobbyStore";
import { useRoomStore } from "../lib/roomStore";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <HomeContent />
    </Suspense>
  );
}

function HomeContent() {
  const lobby = useLobbyStore();
  const room = useRoomStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const modalRef = useRef<HTMLDivElement>(null);

  const [modalOpen, setModalOpen] = useState<"create" | "join" | null>(null);
  const [roomName, setRoomName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [maxPlayers, setMaxPlayers] = useState("8");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [selectedGame, setSelectedGame] = useState("invention");
  const [joinRoomId, setJoinRoomId] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [hasRedirected, setHasRedirected] = useState(false);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        modalRef.current &&
        !modalRef.current.contains(event.target as Node)
      ) {
        setModalOpen(null);
      }
    };

    if (modalOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [modalOpen]);

  useEffect(() => {
    if (searchParams) {
      const inviteRoom = searchParams.get("room");
      const inviteCode = searchParams.get("code");
      if (inviteRoom && !room.pendingJoin && !room.snapshot && !hasRedirected) {
        setJoinRoomId(inviteRoom);
        if (inviteCode) setJoinCode(inviteCode);
        setModalOpen("join");
        setHasRedirected(true);
      }
    }
  }, [
    searchParams,
    room.pendingJoin,
    room.snapshot,
    hasRedirected,
    setJoinCode,
    setModalOpen,
    setJoinRoomId,
    setHasRedirected,
  ]);

  useEffect(() => {
    if (room.snapshot && room.snapshot.id && !hasRedirected) {
      setHasRedirected(true);
      router.replace(`/room/${room.snapshot.id}`);
    }
  }, [
    room.snapshot,
    room.snapshot?.id,
    hasRedirected,
    router,
    setHasRedirected,
  ]);

  const games = useMemo(() => {
    if (lobby.games.length === 0) return [];
    return lobby.games.map((game) => ({
      ...game,
      tag: "Adapter ready",
      players: "2-12",
      description: "Hosted on the Gemu room shell.",
    }));
  }, [lobby.games]);

  const curatedGames = useMemo(
    () =>
      games.map((game, index) => ({
        ...game,
        palette: index % 3,
      })),
    [games],
  );

  const createDisabled =
    !roomName.trim() ||
    !displayName.trim() ||
    !selectedGame.trim() ||
    Number.isNaN(Number(maxPlayers)) ||
    Number(maxPlayers) < 2 ||
    room.pendingJoin;

  const joinDisabled =
    !joinRoomId.trim() || !displayName.trim() || room.pendingJoin;

  if (hasRedirected) {
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="radial-glow min-h-screen">
        <div className="grid-texture min-h-screen">
          <main className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-6 pb-16 pt-12">
            <header className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
              <div className="flex flex-col gap-4">
                <div className="inline-flex w-fit items-center gap-3 rounded-full border-2 border-(--retro-cream) bg-white/10 px-4 py-2 text-xs uppercase tracking-[0.3em] text-(--retro-cream) shadow-[3px_3px_0_rgba(0,0,0,0.3)]">
                  <span className="h-2 w-2 rounded-full bg-(--accent)" />
                  Gemu Multiplayer Hub
                </div>
                <h1 className="font-display text-4xl leading-tight text-(--retro-cream) md:text-6xl">
                  Party games, zero setup.
                </h1>
                <p className="max-w-2xl text-lg text-(--retro-cream)/80">
                  Pick a game, join a room, play.
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <button
                  className="retro-btn bg-(--accent) px-6 py-3 text-sm font-semibold text-(--retro-ink)"
                  onClick={() => setModalOpen("create")}
                >
                  Create room
                </button>
                <button
                  className="retro-btn border-2 border-(--retro-cream) bg-(--surface) px-6 py-3 text-sm font-semibold text-(--retro-cream)"
                  onClick={() => setModalOpen("join")}
                >
                  Join by code
                </button>
              </div>
            </header>

            <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
              <div className="glass-panel retro-card p-8">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-2xl text-(--retro-cream)">
                    Games
                  </h2>
                  <div className="text-xs uppercase tracking-[0.2em] text-(--retro-cream)/70">
                    {lobby.connected ? "Live" : "Offline"}
                  </div>
                </div>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  {curatedGames.map((game) => (
                    <article
                      key={game.type}
                      className={`retro-card border-2 p-5 transition hover:-translate-y-1 ${
                        game.palette === 0
                          ? "border-(--accent)"
                          : game.palette === 1
                            ? "border-(--accent-2)"
                            : "border-(--accent-3)"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold text-(--retro-cream)">
                          {game.name}
                        </h3>
                        <span className="retro-pill bg-(--surface) px-3 py-1 text-xs text-(--retro-cream)">
                          {game.players} players
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-(--retro-cream)/75">
                        {game.description}
                      </p>
                      <div className="mt-4 flex items-center justify-between">
                        <span className="text-xs uppercase tracking-[0.2em] text-(--accent-2)">
                          {game.tag}
                        </span>
                        <button
                          className="retro-btn border-2 border-(--retro-cream) bg-(--surface) px-4 py-2 text-xs font-semibold text-(--retro-cream)"
                          onClick={() => {
                            setSelectedGame(game.type);
                            setModalOpen("create");
                          }}
                        >
                          Host room
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </div>

              <aside className="glass-panel retro-card p-6">
                <div>
                  <h2 className="font-display text-xl text-(--retro-cream)">
                    Rooms
                  </h2>
                  <p className="mt-2 text-sm text-(--retro-cream)/75">
                    Public rooms you can join right now.
                  </p>
                </div>
                <div className="mt-4 space-y-3">
                  {lobby.rooms.length === 0 ? (
                    <div className="retro-card border-2 border-(--accent-2) p-4 text-sm text-(--retro-cream)/75">
                      No public rooms yet. Be the first!
                    </div>
                  ) : (
                lobby.rooms.map((roomItem) => (
                  <div
                    key={roomItem.id}
                    className="retro-card flex items-center justify-between border-2 border-(--accent-3) p-4"
                  >
                    <div>
                      <p className="text-sm font-semibold text-(--retro-cream)">
                        {roomItem.name}
                      </p>
                        <p className="text-xs text-(--retro-cream)/65">
                          {roomItem.gameName || roomItem.gameType}
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="retro-pill bg-(--surface) px-3 py-1 text-xs text-(--retro-cream)">
                        {roomItem.playerCount}/{roomItem.maxPlayers || "∞"}
                      </span>
                      <button
                        className="retro-btn bg-(--accent) px-4 py-1.5 text-xs font-semibold text-(--retro-ink) disabled:opacity-50"
                        disabled={roomItem.playerCount >= roomItem.maxPlayers || room.pendingJoin}
                        onClick={() => {
                          setJoinRoomId(roomItem.id);
                          setModalOpen("join");
                        }}
                      >
                        Join
                      </button>
                    </div>
                  </div>
                ))
                  )}
                </div>
              </aside>
            </section>

            {(modalOpen === "create" || modalOpen === "join") && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-(--retro-ink)/80 p-6">
                <div
                  ref={modalRef}
                  className="glass-panel retro-card w-full max-w-2xl p-8"
                >
                  {modalOpen === "create" ? (
                    <>
                      <h2 className="font-display text-2xl text-(--retro-cream)">
                        Create room
                      </h2>
                      <p className="mt-2 text-sm text-(--retro-cream)/75">
                        Pick a game type and room settings. You will join
                        immediately.
                      </p>
                      <div className="mt-6 grid gap-4">
                        <div className="flex items-center gap-4">
                          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border-2 border-(--retro-cream) bg-(--surface)">
                            {avatarUrl.trim() ? (
                              // eslint-disable-next-line @next/next/no-img-element
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
                        <input
                          className="retro-card border-2 border-(--retro-cream) bg-(--surface) px-4 py-3 text-sm text-(--retro-cream)"
                          placeholder="Room name"
                          value={roomName}
                          onChange={(event) => {
                            setRoomName(event.target.value);
                            setLocalError(null);
                          }}
                        />
                        <div className="grid gap-3 sm:grid-cols-2">
                          <input
                            className="retro-card border-2 border-(--retro-cream) bg-(--surface) px-4 py-3 text-sm text-(--retro-cream)"
                            placeholder="Display name"
                            value={displayName}
                            onChange={(event) => {
                              setDisplayName(event.target.value);
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
                        </div>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <select
                            className="retro-card border-2 border-(--retro-cream) bg-(--surface) px-4 py-3 text-sm text-(--retro-cream)"
                            value={selectedGame}
                            onChange={(event) => {
                              setSelectedGame(event.target.value);
                              setLocalError(null);
                            }}
                          >
                            {curatedGames.map((game) => (
                              <option key={game.type} value={game.type}>
                                {game.name}
                              </option>
                            ))}
                          </select>
                          <select
                            className="retro-card border-2 border-(--retro-cream) bg-(--surface) px-4 py-3 text-sm text-(--retro-cream)"
                            value={visibility}
                            onChange={(event) => {
                              setVisibility(
                                event.target.value as "public" | "private",
                              );
                              setLocalError(null);
                            }}
                          >
                            <option value="public">Public</option>
                            <option value="private">Private</option>
                          </select>
                          <input
                            className="retro-card border-2 border-(--retro-cream) bg-(--surface) px-4 py-3 text-sm text-(--retro-cream)"
                            placeholder="Max players"
                            type="number"
                            min={2}
                            value={maxPlayers}
                            onChange={(event) => {
                              setMaxPlayers(event.target.value);
                              setLocalError(null);
                            }}
                          />
                        </div>
                        {localError ? (
                          <p className="text-sm text-red-300">{localError}</p>
                        ) : null}
                        {room.joinError ? (
                          <p className="text-sm text-red-300">
                            {room.joinError}
                          </p>
                        ) : null}
                        <div className="mt-4 flex gap-3">
                          <button
                            className="retro-btn flex-1 bg-(--accent) px-5 py-3 text-sm font-semibold text-(--retro-ink) disabled:opacity-50"
                            onClick={() => {
                              if (Number(maxPlayers) < 2) {
                                setLocalError(
                                  "Max players must be at least 2.",
                                );
                                return;
                              }
                              setLocalError(null);
                              room.createRoom({
                                name: roomName.trim(),
                                gameType: selectedGame,
                                visibility,
                                maxPlayers: Number(maxPlayers),
                                displayName: displayName.trim(),
                                avatarUrl: avatarUrl.trim(),
                              });
                            }}
                            disabled={createDisabled}
                          >
                            {room.pendingJoin ? "Starting..." : "Start room"}
                          </button>
                          <button
                            className="retro-btn border-2 border-(--retro-cream) bg-(--surface) px-5 py-3 text-sm font-semibold text-(--retro-cream)"
                            onClick={() => setModalOpen(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <h2 className="font-display text-2xl text-(--retro-cream)">
                        Join room
                      </h2>
                      <p className="mt-2 text-sm text-(--retro-cream)/75">
                        Enter the room ID and join code if required.
                      </p>
                      <div className="mt-6 grid gap-4">
                        <div className="flex items-center gap-4">
                          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border-2 border-(--retro-cream) bg-(--surface)">
                            {avatarUrl.trim() ? (
                              // eslint-disable-next-line @next/next/no-img-element
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
                        <input
                          className="retro-card border-2 border-(--retro-cream) bg-(--surface) px-4 py-3 text-sm text-(--retro-cream)"
                          placeholder="Room ID"
                          value={joinRoomId}
                          onChange={(event) => {
                            setJoinRoomId(event.target.value);
                            setLocalError(null);
                          }}
                        />
                        <div className="grid gap-3 sm:grid-cols-2">
                          <input
                            className="retro-card border-2 border-(--retro-cream) bg-(--surface) px-4 py-3 text-sm text-(--retro-cream)"
                            placeholder="Display name"
                            value={displayName}
                            onChange={(event) => {
                              setDisplayName(event.target.value);
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
                        </div>
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
                          <p className="text-sm text-red-300">
                            {room.joinError}
                          </p>
                        ) : null}
                        <div className="mt-4 flex gap-3">
                          <button
                            className="retro-btn flex-1 border-2 border-(--retro-cream) bg-(--surface) px-5 py-3 text-sm font-semibold text-(--retro-cream) disabled:opacity-50"
                            onClick={() => {
                              setLocalError(null);
                              room.joinRoom({
                                roomId: joinRoomId.trim(),
                                joinCode: joinCode.trim() || undefined,
                                displayName: displayName.trim(),
                                avatarUrl: avatarUrl.trim(),
                              });
                            }}
                            disabled={joinDisabled}
                          >
                            {room.pendingJoin ? "Joining..." : "Join room"}
                          </button>
                          <button
                            className="retro-btn border-2 border-(--retro-cream) bg-(--surface) px-5 py-3 text-sm font-semibold text-(--retro-cream)"
                            onClick={() => setModalOpen(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
