"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, Tv, Pencil } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useLobbyStore } from "@/lib/lobbyStore";
import { gamesCatalog } from "@/lib/games";
import { useRoomStore } from "@/lib/roomStore";
import { LangToggle, Bulbs, SfxToggle } from "@/components/ui";
import { hueFor } from "@/components/ui/gameHues";
import { AvatarDrawModal } from "@/components/screens/AvatarDrawModal";
import { joinErrorText } from "@/lib/joinErrors";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <HomeContent />
    </Suspense>
  );
}

function HomeContent() {
  const { t } = useI18n();
  const lobby = useLobbyStore();
  const room = useRoomStore();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [nick, setNick] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [code, setCode] = useState("");
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [hasRedirected, setHasRedirected] = useState(false);

  // Prefill nickname/avatar once, and an invite code from the URL.
  const loadedRef = useRef(false);
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    const last = room.loadLastRoom();
    if (last) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNick(last.displayName || "");
      setAvatarUrl(last.avatarUrl || "");
    }
    const invite = searchParams.get("code");
    if (invite) setCode(invite.toUpperCase());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redirect into the room once we're in one.
  useEffect(() => {
    if (room.snapshot?.id && !hasRedirected) {
      setHasRedirected(true);
      router.replace(`/room/${room.snapshot.id}`);
    }
  }, [room.snapshot?.id, hasRedirected, router]);

  const nickReady = nick.trim().length > 0 && !room.pendingJoin;

  const handleCreate = () => {
    if (!nickReady) return;
    room.createRoom({
      name: t("home.autoRoomName", { name: nick.trim() }),
      playlist: gamesCatalog.map((g) => g.type),
      visibility: "public",
      maxPlayers: 10,
      displayName: nick.trim(),
      avatarUrl,
    });
  };

  const handleJoin = () => {
    if (!nickReady || !code.trim()) return;
    room.joinRoom({
      joinCode: code.trim().toUpperCase(),
      displayName: nick.trim(),
      avatarUrl,
    });
  };

  if (hasRedirected) return null;

  const errorText = room.joinError ? joinErrorText(room.joinError, t) : null;

  return (
    <div className="min-h-screen bg-(--bg-deep)">
      <div className="radial-glow min-h-screen flex flex-col">
        <div className="flex justify-end gap-2 px-6 pt-5">
          <SfxToggle />
          <LangToggle />
        </div>

        <main className="flex-1 flex flex-col justify-center gap-12 px-6 pb-12">
          {/* Hero: marquee + ticket card */}
          <div className="flex flex-col items-center justify-center gap-12 lg:flex-row lg:items-center lg:gap-16">
            {/* GEMU marquee + tagline + pills */}
            <div>
              <div
                className="relative inline-block rounded-[26px] border-4 border-(--accent) bg-(--panel) px-12 pb-8 pt-7"
                style={{ transform: "rotate(-1.5deg)" }}
              >
                <Bulbs count={4} size={12} className="absolute -top-2 left-6 right-6" />
                <Bulbs count={4} size={12} className="absolute -bottom-2 left-6 right-6" />
                <div className="slab text-7xl leading-none sm:text-8xl">GEMU</div>
              </div>
              <p className="mt-5 max-w-md text-lg font-semibold leading-relaxed text-(--ink)/85">
                {t("home.tagline1")}
                <br />
                {t("home.tagline2")}
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {gamesCatalog.map((game, i) => {
                  const hue = hueFor(game.type);
                  const tilt = [-2, 1.5, -1, 2, -1.5][i % 5];
                  return (
                    <span
                      key={game.type}
                      className="font-display text-xs"
                      style={{
                        color: hue.ink,
                        background: `linear-gradient(180deg,${hue.gradFrom},${hue.gradTo})`,
                        borderRadius: 10,
                        padding: "7px 14px",
                        boxShadow: `0 3px 0 ${hue.drop}`,
                        transform: `rotate(${tilt}deg)`,
                      }}
                    >
                      {game.name.toUpperCase()}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* STEP RIGHT UP ticket card */}
            <div className="w-full max-w-sm rounded-3xl border-2 border-(--line) bg-(--panel) p-7 shadow-[0_20px_60px_rgba(0,0,0,.4)]">
              <div className="mono-caption mb-4">{t("home.stepRightUp")}</div>

              <div className="mb-5 flex items-center gap-4">
                <div className="flex flex-col items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setAvatarModalOpen(true)}
                    className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-[20px] border-2 border-(--accent) bg-[#fff8e7] transition hover:brightness-95"
                    aria-label={t("home.drawFace")}
                  >
                    {avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-center font-mono text-[9px] leading-tight text-[#8a7f60] flex flex-col items-center">
                        {t("home.drawFace")}
                        <br />
                        <Pencil size={16} strokeWidth={2.5} style={{ color: "#8a7f60" }} />
                      </span>
                    )}
                  </button>
                </div>
                <div className="flex-1">
                  <div className="mb-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-(--ink)/50">
                    {t("home.yourNickname")}
                  </div>
                  <input
                    value={nick}
                    onChange={(e) => setNick(e.target.value)}
                    placeholder={t("home.typeIt")}
                    data-testid="nick-input"
                    maxLength={40}
                    className="w-full rounded-xl border-2 border-(--line) bg-(--bg-deep) px-3.5 py-3 text-base font-semibold text-(--ink) placeholder:text-(--ink)/40 focus:border-(--accent-2) focus:outline-none"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={handleCreate}
                disabled={!nickReady}
                data-testid="create-room"
                className="buzzer w-full rounded-2xl py-4 font-display text-xl"
                style={{
                  background: "linear-gradient(180deg,#ffd23f,#f5b32a)",
                  color: "var(--dark-ink)",
                }}
              >
                {room.pendingJoin ? t("home.starting") : t("home.createRoom")}
              </button>

              <div className="my-3.5 flex items-center gap-3">
                <div className="h-px flex-1 bg-(--line)" />
                <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-(--ink)/40">
                  {t("home.orJoin")}
                </span>
                <div className="h-px flex-1 bg-(--line)" />
              </div>

              <div className="flex gap-2.5">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                  placeholder={t("home.codePlaceholder")}
                  data-testid="join-code-input"
                  maxLength={6}
                  className="flex-1 rounded-xl border-2 border-(--line) bg-(--bg-deep) px-3 py-3 text-center font-mono text-[15px] font-bold uppercase tracking-[0.25em] text-(--ink) placeholder:text-(--ink)/30 focus:border-(--accent-2) focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleJoin}
                  disabled={!nickReady || !code.trim()}
                  data-testid="join-room-btn"
                  className="rounded-xl border-2 border-(--ink) bg-(--panel) px-6 font-display text-[15px] text-(--ink) shadow-[0_4px_0_rgba(0,0,0,.4)] disabled:opacity-40"
                >
                  {t("home.join")}
                </button>
              </div>

              {errorText && (
                <p className="mt-3 rounded-lg bg-(--danger)/10 px-3 py-2 text-center text-xs font-semibold text-[#ffb3c1]" data-testid="home-join-error">
                  {errorText}
                </p>
              )}
              {!nick.trim() && (
                <p className="mt-3 text-center font-mono text-[9px] text-(--ink)/35">
                  {t("home.nickFirst")}
                </p>
              )}
            </div>
          </div>

          {/* On air now — public rooms */}
          <div className="mx-auto w-full max-w-4xl">
            <div className="mb-2.5 flex items-baseline justify-between">
              <span className="font-mono text-[11px] font-bold uppercase tracking-[0.3em] text-(--ink)/45 flex items-center gap-2">
                <Tv size={14} strokeWidth={2.5} /> {t("home.onAir")}
              </span>
              <span className="font-mono text-[10px] text-(--ink)/30">
                {lobby.connected ? t("home.live") : t("home.offline")}
              </span>
            </div>
            {lobby.rooms.length === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-(--line) bg-(--panel)/50 px-4 py-6 text-center text-sm text-(--ink)/50">
                {t("home.noRooms")}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {lobby.rooms.map((r) => {
                  const full = r.maxPlayers > 0 && r.playerCount >= r.maxPlayers;
                  return (
                    <div
                      key={r.id}
                      className="flex items-center gap-3 rounded-2xl border-2 border-(--line) bg-(--panel) px-4 py-3"
                      style={full ? { opacity: 0.6 } : undefined}
                    >
                      <span
                        className="h-2.5 w-2.5 flex-none rounded-full"
                        style={{
                          background: r.hasPassword ? "var(--warn)" : "var(--accent-2)",
                          animation: full ? "none" : "bulb 1.4s infinite",
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px] font-bold text-(--ink) flex items-center gap-2">
                          {r.name} {r.hasPassword ? <Lock size={16} strokeWidth={2.5} /> : ""}
                        </div>
                        <div className="font-mono text-[10px] text-(--ink)/45">
                          {t("home.playlistCount", { n: r.playlist?.length ?? 1 })}
                        </div>
                      </div>
                      <span className="font-mono text-xs font-bold text-(--accent-2)">
                        {r.playerCount}
                        {r.maxPlayers > 0 ? `/${r.maxPlayers}` : ""}
                      </span>
                      {full ? (
                        <span className="rounded-[10px] border-2 border-(--line) px-3 py-1.5 font-mono text-[11px] font-bold text-(--ink)/35">
                          {t("home.full")}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            if (!nickReady) return;
                            room.joinRoom({
                              roomId: r.id,
                              displayName: nick.trim(),
                              avatarUrl,
                            });
                          }}
                          disabled={!nickReady}
                          className="rounded-[10px] bg-(--accent) px-4 py-1.5 font-display text-xs text-(--dark-ink) shadow-[0_3px_0_var(--drop)] disabled:opacity-40"
                        >
                          {t("home.join")}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </main>
      </div>

      <AvatarDrawModal
        open={avatarModalOpen}
        initial={avatarUrl}
        onClose={() => setAvatarModalOpen(false)}
        onSave={setAvatarUrl}
      />
    </div>
  );
}

