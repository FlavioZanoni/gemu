"use client";

import { Suspense, useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { useLobbyStore } from "@/lib/lobbyStore";
import { gamesCatalog } from "@/lib/games";
import { useRoomStore } from "@/lib/roomStore";
import {
  Button,
  Card,
  Marquee,
  DoodlePad,
  LangToggle,
  Pill,
} from "@/components/ui";
import { playerColors } from "@/components/ui/gameHues";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <HomeContent />
    </Suspense>
  );
}

function HomeContent() {
  const { t, locale } = useI18n();
  const lobby = useLobbyStore();
  const room = useRoomStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const modalRef = useRef<HTMLDivElement>(null);

  const [modalOpen, setModalOpen] = useState<"create" | "join" | null>(null);
  const [roomName, setRoomName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [useDoodle, setUseDoodle] = useState(false);
  const [maxPlayers, setMaxPlayers] = useState("8");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [password, setPassword] = useState("");
  const [selectedGame, setSelectedGame] = useState("invention");
  const [joinRoomId, setJoinRoomId] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [hasRedirected, setHasRedirected] = useState(false);

  // Load last user from localStorage — once; re-running would clobber typing.
  const profileLoaded = useRef(false);
  useEffect(() => {
    if (profileLoaded.current) return;
    profileLoaded.current = true;
    const last = room.loadLastRoom();
    if (last) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDisplayName(last.displayName || "");
      setAvatarUrl(last.avatarUrl || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  }, [searchParams, room.pendingJoin, room.snapshot, hasRedirected]);

  useEffect(() => {
    if (room.snapshot && room.snapshot.id && !hasRedirected) {
      setHasRedirected(true);
      router.replace(`/room/${room.snapshot.id}`);
    }
  }, [room.snapshot, room.snapshot?.id, hasRedirected, router]);

  useEffect(() => {
    if (room.left && lobby.refresh) {
      lobby.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.left]);

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
    <div className="min-h-screen bg-(--bg)">
      <div className="radial-glow min-h-screen">
        <div className="grid-texture min-h-screen">
          <main className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-6 pb-16 pt-12">
            {/* Header */}
            <header className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
              <div className="flex flex-col gap-4">
                <Marquee caption="Gemu">
                  {t("home.brand")}
                </Marquee>
                <h1 className="slab text-4xl leading-tight md:text-6xl">
                  {t("home.tagline")}
                </h1>
                <p className="max-w-2xl text-lg text-(--ink)/80">
                  {t("home.subtitle")}
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => setModalOpen("create")}
                >
                  {t("home.createRoom")}
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => setModalOpen("join")}
                >
                  {t("home.joinByCode")}
                </Button>
                <LangToggle />
              </div>
            </header>

            {/* Games and Rooms */}
            <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
              {/* Games section */}
              <div className="rounded-2xl border-2 border-(--line) bg-(--panel) p-8">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="slab text-2xl">{t("home.gamesSection")}</h2>
                  <Pill variant="neutral" className="text-[11px]">
                    {lobby.connected ? t("home.live") : t("home.offline")}
                  </Pill>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {gamesCatalog.map((game) => (
                    <Card
                      key={game.type}
                      variant="panel"
                      gameType={game.type}
                      className="flex flex-col gap-3 cursor-pointer transition hover:-translate-y-1"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-bold text-(--ink)">
                          {game.name}
                        </h3>
                        <Pill variant="neutral" className="text-[11px]">
                          {game.players}
                        </Pill>
                      </div>
                      <p className="text-xs text-(--ink)/75 flex-1">
                        {game.description[locale as keyof typeof game.description] || ""}
                      </p>
                      <div className="flex items-center justify-between pt-2 border-t border-(--line)">
                        <span className="mono-caption">{game.tag}</span>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setSelectedGame(game.type);
                            setModalOpen("create");
                          }}
                        >
                          {t("home.gameHost")}
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>

              {/* Rooms section */}
              <aside className="rounded-2xl border-2 border-(--line) bg-(--panel) p-6">
                <h2 className="slab text-xl mb-2">{t("home.roomsSection")}</h2>
                <p className="text-xs text-(--ink)/75 mb-4">
                  {t("home.roomsDesc")}
                </p>
                <div className="space-y-3">
                  {lobby.rooms.length === 0 ? (
                    <Card variant="panel" className="text-center py-6">
                      <p className="text-xs text-(--ink)/75">
                        {t("home.noRooms")}
                      </p>
                    </Card>
                  ) : (
                    lobby.rooms.map((roomItem) => (
                      <Card
                        key={roomItem.id}
                        variant="panel"
                        className="flex items-center justify-between cursor-pointer transition hover:bg-(--panel-raised)"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-(--ink)">
                            {roomItem.name}
                          </p>
                          <p className="text-xs text-(--ink)/60">
                            {roomItem.gameName || roomItem.gameType}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 ml-2 flex-none">
                          <Pill variant="neutral" className="text-[11px]">
                            {roomItem.playerCount}/{roomItem.maxPlayers}
                          </Pill>
                          <Button
                            variant="primary"
                            size="sm"
                            disabled={
                              roomItem.playerCount >= roomItem.maxPlayers ||
                              room.pendingJoin
                            }
                            onClick={() => {
                              setJoinRoomId(roomItem.id);
                              setModalOpen("join");
                            }}
                          >
                            Join
                          </Button>
                        </div>
                      </Card>
                    ))
                  )}
                </div>
              </aside>
            </section>

            {/* Modals */}
            {(modalOpen === "create" || modalOpen === "join") && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6">
                <div
                  ref={modalRef}
                  className="rounded-2xl border-2 border-(--line) bg-(--panel) w-full max-w-2xl p-8 max-h-[90vh] overflow-y-auto"
                >
                  {modalOpen === "create" ? (
                    <>
                      <h2 className="slab text-2xl mb-1">
                        {t("home.createRoomTitle")}
                      </h2>
                      <p className="text-sm text-(--ink)/75 mb-6">
                        {t("home.createRoomDesc")}
                      </p>

                      <div className="space-y-4">
                        {/* Avatar section */}
                        <div className="flex gap-4 items-start">
                          {useDoodle ? (
                            <div className="flex-1">
                              <label className="mono-caption mb-2 block">
                                {t("home.drawYourAvatar")}
                              </label>
                              <DoodlePad
                                strokeColor={playerColors[0]}
                                onChange={setAvatarUrl}
                              />
                              <button
                                onClick={() => setUseDoodle(false)}
                                className="text-xs text-(--accent-2) mt-2 underline hover:opacity-75"
                              >
                                {t("home.cancel")}
                              </button>
                            </div>
                          ) : (
                            <div className="flex-1">
                              <label className="mono-caption mb-2 block">
                                {t("home.avatarPreview")}
                              </label>
                              <div className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-(--line) bg-(--panel-raised) mb-2">
                                {avatarUrl.trim() ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={avatarUrl.trim()}
                                    alt="Avatar preview"
                                    className="h-full w-full object-cover rounded-full"
                                  />
                                ) : (
                                  <span className="text-2xl text-(--ink)/50">
                                    ?
                                  </span>
                                )}
                              </div>
                              <button
                                onClick={() => setUseDoodle(true)}
                                className="text-xs text-(--accent-2) underline hover:opacity-75"
                              >
                                {t("home.drawYourAvatar")}
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Room name */}
                        <input
                          type="text"
                          placeholder={t("home.roomName")}
                          value={roomName}
                          onChange={(e) => {
                            setRoomName(e.target.value);
                            setLocalError(null);
                          }}
                          className="w-full px-4 py-3 rounded-xl border-2 border-(--line) bg-(--panel-raised) text-(--ink) placeholder:text-(--ink)/50 focus:outline-none focus:border-(--accent-2)"
                        />

                        {/* Display name and avatar URL */}
                        <div className="grid gap-3 sm:grid-cols-2">
                          <input
                            type="text"
                            placeholder={t("home.displayName")}
                            value={displayName}
                            onChange={(e) => {
                              setDisplayName(e.target.value);
                              setLocalError(null);
                            }}
                            className="w-full px-4 py-3 rounded-xl border-2 border-(--line) bg-(--panel-raised) text-(--ink) placeholder:text-(--ink)/50 focus:outline-none focus:border-(--accent-2)"
                          />
                          <input
                            type="text"
                            placeholder={t("home.avatarUrl")}
                            value={avatarUrl}
                            onChange={(e) => {
                              setAvatarUrl(e.target.value);
                              setLocalError(null);
                            }}
                            className="w-full px-4 py-3 rounded-xl border-2 border-(--line) bg-(--panel-raised) text-(--ink) placeholder:text-(--ink)/50 focus:outline-none focus:border-(--accent-2)"
                          />
                        </div>

                        {/* Game type, visibility, password */}
                        <div className="grid gap-3 sm:grid-cols-3">
                          <select
                            value={selectedGame}
                            onChange={(e) => {
                              setSelectedGame(e.target.value);
                              setLocalError(null);
                            }}
                            className="w-full px-4 py-3 rounded-xl border-2 border-(--line) bg-(--panel-raised) text-(--ink) focus:outline-none focus:border-(--accent-2)"
                          >
                            {gamesCatalog.map((game) => (
                              <option key={game.type} value={game.type}>
                                {game.name}
                              </option>
                            ))}
                          </select>
                          <select
                            value={visibility}
                            onChange={(e) => {
                              setVisibility(
                                e.target.value as "public" | "private"
                              );
                              setLocalError(null);
                            }}
                            className="w-full px-4 py-3 rounded-xl border-2 border-(--line) bg-(--panel-raised) text-(--ink) focus:outline-none focus:border-(--accent-2)"
                          >
                            <option value="public">{t("home.public")}</option>
                            <option value="private">{t("home.private")}</option>
                          </select>
                          <input
                            type="number"
                            min="2"
                            placeholder={t("home.maxPlayers")}
                            value={maxPlayers}
                            onChange={(e) => {
                              setMaxPlayers(e.target.value);
                              setLocalError(null);
                            }}
                            className="w-full px-4 py-3 rounded-xl border-2 border-(--line) bg-(--panel-raised) text-(--ink) placeholder:text-(--ink)/50 focus:outline-none focus:border-(--accent-2)"
                          />
                        </div>

                        {visibility === "private" && (
                          <input
                            type="password"
                            placeholder={t("home.password")}
                            value={password}
                            onChange={(e) => {
                              setPassword(e.target.value);
                              setLocalError(null);
                            }}
                            className="w-full px-4 py-3 rounded-xl border-2 border-(--line) bg-(--panel-raised) text-(--ink) placeholder:text-(--ink)/50 focus:outline-none focus:border-(--accent-2)"
                          />
                        )}

                        {/* Errors */}
                        {localError && (
                          <p className="text-sm text-red-400 bg-red-400/10 px-3 py-2 rounded">
                            {localError}
                          </p>
                        )}
                        {room.joinError && (
                          <p className="text-sm text-red-400 bg-red-400/10 px-3 py-2 rounded">
                            {room.joinError}
                          </p>
                        )}

                        {/* Buttons */}
                        <div className="flex gap-3 pt-4">
                          <Button
                            variant="primary"
                            size="md"
                            disabled={createDisabled}
                            onClick={() => {
                              if (Number(maxPlayers) < 2) {
                                setLocalError(t("home.maxPlayers") + " must be at least 2.");
                                return;
                              }
                              setLocalError(null);
                              room.createRoom({
                                name: roomName.trim(),
                                playlist: [selectedGame],
                                visibility,
                                maxPlayers: Number(maxPlayers),
                                displayName: displayName.trim(),
                                avatarUrl: avatarUrl.trim(),
                                password:
                                  password.trim() || undefined,
                              });
                            }}
                          >
                            {room.pendingJoin ? t("home.starting") : t("home.startRoom")}
                          </Button>
                          <Button
                            variant="secondary"
                            size="md"
                            onClick={() => setModalOpen(null)}
                          >
                            {t("home.cancel")}
                          </Button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <h2 className="slab text-2xl mb-1">
                        {t("home.joinRoomTitle")}
                      </h2>
                      <p className="text-sm text-(--ink)/75 mb-6">
                        {t("home.joinRoomDesc")}
                      </p>

                      <div className="space-y-4">
                        {/* Avatar section */}
                        <div className="flex gap-4 items-start">
                          {useDoodle ? (
                            <div className="flex-1">
                              <label className="mono-caption mb-2 block">
                                {t("home.drawYourAvatar")}
                              </label>
                              <DoodlePad
                                strokeColor={playerColors[0]}
                                onChange={setAvatarUrl}
                              />
                              <button
                                onClick={() => setUseDoodle(false)}
                                className="text-xs text-(--accent-2) mt-2 underline hover:opacity-75"
                              >
                                {t("home.cancel")}
                              </button>
                            </div>
                          ) : (
                            <div className="flex-1">
                              <label className="mono-caption mb-2 block">
                                {t("home.avatarPreview")}
                              </label>
                              <div className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-(--line) bg-(--panel-raised) mb-2">
                                {avatarUrl.trim() ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={avatarUrl.trim()}
                                    alt="Avatar preview"
                                    className="h-full w-full object-cover rounded-full"
                                  />
                                ) : (
                                  <span className="text-2xl text-(--ink)/50">
                                    ?
                                  </span>
                                )}
                              </div>
                              <button
                                onClick={() => setUseDoodle(true)}
                                className="text-xs text-(--accent-2) underline hover:opacity-75"
                              >
                                {t("home.drawYourAvatar")}
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Room ID */}
                        <input
                          type="text"
                          placeholder={t("home.roomId")}
                          value={joinRoomId}
                          onChange={(e) => {
                            setJoinRoomId(e.target.value);
                            setLocalError(null);
                          }}
                          className="w-full px-4 py-3 rounded-xl border-2 border-(--line) bg-(--panel-raised) text-(--ink) placeholder:text-(--ink)/50 focus:outline-none focus:border-(--accent-2)"
                        />

                        {/* Display name and avatar URL */}
                        <div className="grid gap-3 sm:grid-cols-2">
                          <input
                            type="text"
                            placeholder={t("home.displayName")}
                            value={displayName}
                            onChange={(e) => {
                              setDisplayName(e.target.value);
                              setLocalError(null);
                            }}
                            className="w-full px-4 py-3 rounded-xl border-2 border-(--line) bg-(--panel-raised) text-(--ink) placeholder:text-(--ink)/50 focus:outline-none focus:border-(--accent-2)"
                          />
                          <input
                            type="text"
                            placeholder={t("home.avatarUrl")}
                            value={avatarUrl}
                            onChange={(e) => {
                              setAvatarUrl(e.target.value);
                              setLocalError(null);
                            }}
                            className="w-full px-4 py-3 rounded-xl border-2 border-(--line) bg-(--panel-raised) text-(--ink) placeholder:text-(--ink)/50 focus:outline-none focus:border-(--accent-2)"
                          />
                        </div>

                        {/* Join code and password */}
                        <div className="grid gap-3 sm:grid-cols-2">
                          <input
                            type="text"
                            placeholder={t("home.joinCode")}
                            value={joinCode}
                            onChange={(e) => {
                              setJoinCode(e.target.value);
                              setLocalError(null);
                            }}
                            className="w-full px-4 py-3 rounded-xl border-2 border-(--line) bg-(--panel-raised) text-(--ink) placeholder:text-(--ink)/50 focus:outline-none focus:border-(--accent-2)"
                          />
                          <input
                            type="password"
                            placeholder={t("home.password")}
                            value={password}
                            onChange={(e) => {
                              setPassword(e.target.value);
                              setLocalError(null);
                            }}
                            className="w-full px-4 py-3 rounded-xl border-2 border-(--line) bg-(--panel-raised) text-(--ink) placeholder:text-(--ink)/50 focus:outline-none focus:border-(--accent-2)"
                          />
                        </div>

                        {/* Errors */}
                        {localError && (
                          <p className="text-sm text-red-400 bg-red-400/10 px-3 py-2 rounded">
                            {localError}
                          </p>
                        )}
                        {room.joinError && (
                          <p className="text-sm text-red-400 bg-red-400/10 px-3 py-2 rounded">
                            {room.joinError}
                          </p>
                        )}

                        {/* Buttons */}
                        <div className="flex gap-3 pt-4">
                          <Button
                            variant="primary"
                            size="md"
                            disabled={joinDisabled}
                            onClick={() => {
                              setLocalError(null);
                              room.joinRoom({
                                roomId: joinRoomId.trim(),
                                joinCode: joinCode.trim() || undefined,
                                password: password.trim() || undefined,
                                displayName: displayName.trim(),
                                avatarUrl: avatarUrl.trim(),
                              });
                            }}
                          >
                            {room.pendingJoin
                              ? t("home.joining")
                              : t("home.joinRoom")}
                          </Button>
                          <Button
                            variant="secondary"
                            size="md"
                            onClick={() => setModalOpen(null)}
                          >
                            {t("home.cancel")}
                          </Button>
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
