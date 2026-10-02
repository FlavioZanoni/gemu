"use client";

import { Suspense, useEffect, useId, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, Tv, Pencil, Minus, Plus } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useLobbyStore } from "@/lib/lobbyStore";
import { gamesCatalog, gameLabel } from "@/lib/games";
import { useRoomStore } from "@/lib/roomStore";
import { LangToggle, Bulbs, SfxToggle, Modal } from "@/components/ui";
import { hueFor } from "@/components/ui/gameHues";
import { AvatarDrawModal } from "@/components/screens/AvatarDrawModal";
import { joinErrorText } from "@/lib/joinErrors";
import { awfulPending, useAwful } from "@/lib/awful";
import { AwfulGate } from "@/components/AwfulBridge";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <HomeContent />
    </Suspense>
  );
}

const inputClass =
  "w-full rounded-xl border-2 border-(--line) bg-(--bg) px-3.5 py-3 text-base font-semibold text-(--ink) placeholder:text-(--ink)/40 focus:border-(--accent-2) focus:outline-none";

function HomeContent() {
  const { t, locale } = useI18n();
  const lobby = useLobbyStore();
  const room = useRoomStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const awful = useAwful();

  const [nick, setNick] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [code, setCode] = useState("");
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  // The room the last home join aimed at. A locked one asks for its password
  // (tapping a 🔒 public room, or the server answering invalid_password) and
  // the retry goes to the same room with it.
  const [joinTarget, setJoinTarget] = useState<{ joinCode?: string; roomId?: string; name?: string } | null>(null);
  const [passwordAsked, setPasswordAsked] = useState(false);

  // Once, after hydration: prefill nickname/avatar from the last seat and an
  // invite code from the URL, and forget kick / takeover / leave flags.
  const loadedRef = useRef(false);
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    room.resetRoomFlags();
    const last = room.loadLastRoom();
    if (last) {
      // Deliberately post-hydration: storage isn't readable on the server.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNick(last.displayName || "");
      setAvatarUrl(last.avatarUrl || "");
    }
    const invite = searchParams.get("code");
    if (invite) setCode(invite.toUpperCase());
  }, [room, searchParams]);

  // Redirect into the room once we're in one.
  const roomIdNow = room.snapshot?.id;
  useEffect(() => {
    if (roomIdNow) router.replace(`/room/${roomIdNow}`);
  }, [roomIdNow, router]);

  const nickReady = nick.trim().length > 0 && !room.pendingJoin;

  const joinTo = (target: { joinCode?: string; roomId?: string; name?: string }, password?: string) => {
    setJoinTarget(target);
    room.joinRoom({
      ...(target.roomId ? { roomId: target.roomId } : {}),
      ...(target.joinCode ? { joinCode: target.joinCode } : {}),
      ...(password ? { password } : {}),
      displayName: nick.trim(),
      avatarUrl,
    });
  };

  const handleJoin = () => {
    if (!nickReady || !code.trim()) return;
    setPasswordAsked(false);
    joinTo({ joinCode: code.trim().toUpperCase() });
  };

  const passwordRejected = room.joinError === "invalid_password" || room.joinError === "password_wrong";
  const passwordOpen = !!joinTarget && (passwordAsked || passwordRejected);
  const closePassword = () => {
    setPasswordAsked(false);
    setJoinTarget(null);
  };

  if (roomIdNow) return null;
  // Inside an awful.chat call the host decides the room: no entry form.
  if (awfulPending(awful)) return <AwfulGate />;

  const errorText = room.joinError ? joinErrorText(room.joinError, t) : null;

  return (
    <div className="radial-glow flex min-h-dvh flex-col">
      <div className="flex justify-end gap-2 px-4 pt-4 sm:px-6 sm:pt-5">
        <SfxToggle />
        <LangToggle />
      </div>

      <main className="flex flex-1 flex-col justify-center gap-8 px-4 pb-10 pt-3 sm:gap-12 sm:px-6 sm:pt-0">
        <div className="flex flex-col items-center justify-center gap-6 sm:gap-12 lg:flex-row lg:items-center lg:gap-16">
          {/* GEMU marquee + tagline + pills */}
          <div className="flex flex-col items-center lg:items-start">
            <div
              className="relative inline-block rounded-[22px] border-[3px] border-(--accent) bg-(--panel) px-8 pb-3 pt-3 text-center sm:rounded-[26px] sm:border-4 sm:px-12 sm:pb-8 sm:pt-7"
              style={{ transform: "rotate(-1.5deg)" }}
            >
              <Bulbs count={4} size={10} className="absolute -top-[6px] left-6 right-6" />
              <Bulbs count={4} size={10} className="absolute -bottom-[6px] left-6 right-6 hidden sm:flex" />
              <h1 className="slab-xl text-5xl leading-none sm:text-8xl">GEMU</h1>
              <div className="mt-1 font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-(--accent-2) sm:hidden">
                {t("home.bigShow")}
              </div>
            </div>
            <p className="mt-5 hidden max-w-md text-lg font-semibold leading-relaxed text-(--ink)/85 sm:block">
              {t("home.tagline1")}
              <br />
              {t("home.tagline2")}
            </p>
            <div className="mt-5 hidden flex-wrap gap-2 sm:flex">
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
                    {gameLabel(game.type, t, game.name).toUpperCase()}
                  </span>
                );
              })}
            </div>
          </div>

          {/* STEP RIGHT UP ticket card */}
          <div className="w-full max-w-sm rounded-3xl border-2 border-(--line) bg-(--panel) p-5 shadow-[0_20px_60px_rgba(0,0,0,.4)] sm:p-7">
            <div className="mono-caption mb-4">{t("home.stepRightUp")}</div>

            <div className="mb-5 flex items-center gap-4">
              <button
                type="button"
                onClick={() => setAvatarModalOpen(true)}
                className="flex h-20 w-20 flex-none items-center justify-center overflow-hidden rounded-[20px] border-2 border-(--accent) bg-[#fff8e7] transition hover:brightness-95"
                aria-label={t("home.drawFace")}
              >
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex flex-col items-center text-center font-mono text-[9px] leading-tight text-[#8a7f60]">
                    {t("home.drawFace")}
                    <Pencil size={16} strokeWidth={2.5} aria-hidden style={{ color: "#8a7f60" }} />
                  </span>
                )}
              </button>
              <label className="min-w-0 flex-1">
                <span className="mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-(--ink)/50">
                  {t("home.yourNickname")}
                </span>
                <input
                  value={nick}
                  onChange={(e) => setNick(e.target.value)}
                  placeholder={t("home.typeIt")}
                  data-testid="nick-input"
                  maxLength={40}
                  className={inputClass}
                />
              </label>
            </div>

            <button
              type="button"
              onClick={() => nickReady && setCreateOpen(true)}
              disabled={!nickReady}
              data-testid="create-room"
              className="buzzer w-full rounded-2xl py-4 font-display text-xl uppercase"
              style={{ background: "linear-gradient(180deg,#ffd23f,#f5b32a)", color: "var(--dark-ink)" }}
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
                aria-label={t("home.joinCode")}
                data-testid="join-code-input"
                maxLength={6}
                className="min-w-0 flex-1 rounded-xl border-2 border-(--line) bg-(--bg) px-3 py-3 text-center font-mono text-base font-bold uppercase tracking-[0.25em] text-(--ink) placeholder:text-(--ink)/30 focus:border-(--accent-2) focus:outline-none"
              />
              <button
                type="button"
                onClick={handleJoin}
                disabled={!nickReady || !code.trim()}
                data-testid="join-room-btn"
                className="rounded-xl border-2 border-(--ink) bg-(--panel) px-5 font-display text-[15px] uppercase text-(--ink) shadow-[0_4px_0_rgba(0,0,0,.4)] disabled:opacity-40"
              >
                {t("home.join")}
              </button>
            </div>

            {errorText && !passwordOpen && (
              <p
                className="mt-3 rounded-lg bg-(--danger)/10 px-3 py-2 text-center text-xs font-semibold text-[#ffb3c1]"
                data-testid="home-join-error"
                role="alert"
              >
                {errorText}
              </p>
            )}
            {!nick.trim() && (
              <p className="mt-3 text-center font-mono text-[9px] text-(--ink)/35">{t("home.nickFirst")}</p>
            )}
          </div>
        </div>

        {/* On air now — public rooms */}
        <section className="mx-auto w-full max-w-4xl" aria-labelledby="on-air">
          <div className="mb-2.5 flex items-baseline justify-between">
            <h2
              id="on-air"
              className="flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.3em] text-(--ink)/45"
            >
              <Tv size={14} strokeWidth={2.5} aria-hidden /> {t("home.onAir")}
            </h2>
            <span className="font-mono text-[10px] text-(--ink)/30" data-testid="lobby-status">
              {lobby.connected ? t("home.live") : t("home.offline")}
            </span>
          </div>
          {lobby.rooms.length === 0 ? (
            <div
              className="rounded-2xl border-2 border-dashed border-(--line) bg-(--panel)/50 px-4 py-6 text-center text-sm text-(--ink)/50"
              data-testid="no-rooms"
            >
              {t("home.noRooms")}
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2" data-testid="room-list">
              {lobby.rooms.map((r) => {
                const full = r.maxPlayers > 0 && r.playerCount >= r.maxPlayers;
                return (
                  <li
                    key={r.id}
                    className="flex min-w-0 items-center gap-3 rounded-2xl border-2 border-(--line) bg-(--panel) px-4 py-3"
                    style={full ? { opacity: 0.6 } : undefined}
                    data-testid={`public-room-${r.id}`}
                  >
                    <span
                      className="h-2.5 w-2.5 flex-none rounded-full"
                      style={{
                        background: r.hasPassword ? "var(--warn)" : "var(--accent-2)",
                        animation: full ? "none" : "bulb 1.4s infinite",
                      }}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 truncate text-[15px] font-bold text-(--ink)">
                        <span className="truncate">{r.name}</span>
                        {r.hasPassword ? <Lock size={14} strokeWidth={2.5} aria-label={t("shell.passwordProtected")} /> : null}
                      </div>
                      <div className="font-mono text-[10px] uppercase text-(--ink)/45">
                        {t("home.playlistCount", { n: r.playlist?.length ?? 1 })}
                      </div>
                    </div>
                    <span className="font-mono text-xs font-bold text-(--accent-2)">
                      {r.playerCount}
                      {r.maxPlayers > 0 ? `/${r.maxPlayers}` : ""}
                    </span>
                    {full ? (
                      <span className="rounded-[10px] border-2 border-(--line) px-3 py-1.5 font-mono text-[11px] font-bold uppercase text-(--ink)/35">
                        {t("home.full")}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          if (!nickReady) return;
                          if (r.hasPassword) {
                            // Locked: ask first instead of a join that can only fail.
                            setJoinTarget({ roomId: r.id, name: r.name });
                            setPasswordAsked(true);
                            return;
                          }
                          setPasswordAsked(false);
                          joinTo({ roomId: r.id, name: r.name });
                        }}
                        disabled={!nickReady}
                        data-testid={`public-join-${r.id}`}
                        className="rounded-[10px] bg-(--accent) px-4 py-1.5 font-display text-xs uppercase text-(--dark-ink) shadow-[0_3px_0_var(--drop)] disabled:opacity-40"
                      >
                        {t("home.join")}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>

      <AvatarDrawModal
        open={avatarModalOpen}
        initial={avatarUrl}
        onClose={() => setAvatarModalOpen(false)}
        onSave={setAvatarUrl}
      />
      <PasswordSheet
        key={joinTarget?.roomId ?? joinTarget?.joinCode ?? "none"}
        open={passwordOpen}
        roomName={joinTarget?.name ?? joinTarget?.joinCode ?? ""}
        error={passwordRejected ? errorText : null}
        pending={room.pendingJoin}
        onClose={closePassword}
        onSubmit={(password) => {
          if (!joinTarget || !nickReady) return;
          setPasswordAsked(true);
          joinTo(joinTarget, password);
        }}
      />
      <CreateRoomSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        defaultName={t("home.autoRoomName", { name: nick.trim() })}
        pending={room.pendingJoin}
        onCreate={(opts) =>
          room.createRoom({
            ...opts,
            playlist: gamesCatalog.map((g) => g.type),
            displayName: nick.trim(),
            avatarUrl,
            // The server picks prompts/words/decks in the room's language.
            locale,
          })
        }
      />
    </div>
  );
}

/** Asks for a locked room's password, then retries the join with it. */
function PasswordSheet({
  open,
  roomName,
  error,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  roomName: string;
  error: string | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (password: string) => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const [password, setPassword] = useState("");
  const label = "mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-(--ink)/50";
  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId}>
      <form
        className="rounded-3xl border-2 border-(--line) bg-(--panel) p-5"
        data-testid="password-sheet"
        onSubmit={(e) => {
          e.preventDefault();
          if (pending || !password) return;
          onSubmit(password);
        }}
      >
        <div className="mb-1 flex items-center gap-2 text-(--warn)">
          <Lock size={16} strokeWidth={2.5} aria-hidden />
          <h2 id={titleId} className="font-display text-lg uppercase text-(--ink)">
            {t("home.lockedTitle")}
          </h2>
        </div>
        {roomName ? (
          <div className="mb-1 truncate font-mono text-xs font-bold uppercase tracking-[0.15em] text-(--accent-2)">{roomName}</div>
        ) : null}
        <p className="mb-4 text-sm text-(--ink)/70">{t("home.lockedHint")}</p>
        <label className="mb-4 block">
          <span className={label}>{t("home.passwordLabel")}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            maxLength={100}
            autoComplete="off"
            className={inputClass}
            data-testid="join-password-input"
          />
        </label>
        {error ? (
          <p
            className="mb-4 rounded-lg bg-(--danger)/10 px-3 py-2 text-center text-xs font-semibold text-[#ffb3c1]"
            data-testid="join-password-error"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border-2 border-(--line) px-4 py-3 font-mono text-xs font-bold uppercase text-(--ink)/70"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={pending || !password}
            data-testid="join-password-submit"
            className="buzzer flex-1 rounded-2xl py-3 text-base uppercase disabled:opacity-50"
            style={{ background: "linear-gradient(180deg,#ffd23f,#f5b32a)", color: "var(--dark-ink)" }}
          >
            {pending ? t("edge.joining") : `${t("home.join")} →`}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Gemu Screens · 1b: name the room, public/private, size, optional password. */
function CreateRoomSheet({
  open,
  onClose,
  defaultName,
  pending,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  defaultName: string;
  pending: boolean;
  onCreate: (opts: {
    name: string;
    visibility: "public" | "private";
    maxPlayers: number;
    password?: string;
  }) => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const [name, setName] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [maxPlayers, setMaxPlayers] = useState(10);
  const [password, setPassword] = useState("");
  const label = "mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-(--ink)/50";
  const roomName = (name ?? defaultName).trim() || defaultName;

  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId}>
      <form
        className="rounded-3xl border-2 border-(--line) bg-(--panel) p-5"
        data-testid="create-sheet"
        onSubmit={(e) => {
          e.preventDefault();
          if (pending) return;
          onCreate({
            name: roomName.slice(0, 60),
            visibility,
            maxPlayers,
            password: password.trim() || undefined,
          });
        }}
      >
        <h2 id={titleId} className="sr-only">
          {t("home.createRoom")}
        </h2>
        <label className="mb-4 block">
          <span className={label}>{t("create.roomName")}</span>
          <input
            value={name ?? defaultName}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            className={inputClass}
            data-testid="create-name"
          />
        </label>
        <div className="mb-4 flex flex-wrap gap-3">
          <div className="min-w-0 flex-1">
            <span className={label}>{t("create.visibility")}</span>
            <div className="flex rounded-xl border-2 border-(--line) bg-(--bg) p-1" role="radiogroup" aria-label={t("create.visibility")}>
              {(["public", "private"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={visibility === v}
                  onClick={() => setVisibility(v)}
                  className="flex-1 rounded-lg px-2 py-2 font-mono text-[11px] font-bold uppercase"
                  style={visibility === v ? { background: "var(--ink)", color: "var(--bg)" } : { color: "rgba(255,233,168,.6)" }}
                  data-testid={`create-${v}`}
                >
                  {t(`create.${v}`)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className={label}>{t("create.maxPlayers")}</span>
            <div className="flex items-center rounded-xl border-2 border-(--line) bg-(--bg)">
              <button
                type="button"
                onClick={() => setMaxPlayers((n) => Math.max(2, n - 1))}
                aria-label={t("create.fewer")}
                className="px-3 py-2.5 text-(--ink)/70"
              >
                <Minus size={14} strokeWidth={3} aria-hidden />
              </button>
              <span className="w-8 text-center font-mono text-sm font-bold text-(--ink)" aria-live="polite">
                {maxPlayers}
              </span>
              <button
                type="button"
                onClick={() => setMaxPlayers((n) => Math.min(16, n + 1))}
                aria-label={t("create.more")}
                className="px-3 py-2.5 text-(--accent-2)"
              >
                <Plus size={14} strokeWidth={3} aria-hidden />
              </button>
            </div>
          </div>
        </div>
        <label className="mb-5 block">
          <span className={label}>
            {t("create.password")} <span className="text-(--ink)/30">· {t("create.optional")}</span>
          </span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            maxLength={100}
            placeholder={t("create.passwordHint")}
            className={`${inputClass} border-dashed font-normal`}
            data-testid="create-password"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          data-testid="create-room-confirm"
          className="buzzer w-full rounded-2xl py-3.5 text-base uppercase"
          style={{ background: "linear-gradient(180deg,#ffd23f,#f5b32a)", color: "var(--dark-ink)" }}
        >
          {pending ? t("home.starting") : `${t("create.go")} →`}
        </button>
      </form>
    </Modal>
  );
}
