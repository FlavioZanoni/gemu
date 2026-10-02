"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { useRoomStore } from "@/lib/roomStore";
import { gamesCatalog } from "@/lib/games";
import { joinErrorText } from "@/lib/joinErrors";
import {
  awfulLocale,
  closeAwfulApp,
  parseAwfulArgs,
  setAwfulActivity,
  startAwfulBridge,
  useAwful,
  type AwfulHello,
} from "@/lib/awful";

const randomId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `sess-${Date.now()}-${Math.random().toString(16).slice(2)}`;

// The awful session id is a bearer value for the room: keep only a digest of
// it in storage, never the id itself.
const digest = async (text: string) => {
  try {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    // No SubtleCrypto (insecure context): a cheap non-reversible-enough hash
    // is fine for a local storage key.
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return `djb-${(h >>> 0).toString(16)}`;
  }
};

// One Gemu session id per (awful app session, awful player): stable across
// reloads of the tile so a refresh is a rejoin, not a new seat.
const awfulSessionId = async (hello: AwfulHello) => {
  const key = `gemu:awful:${await digest(hello.session.id)}:${hello.self.id}`;
  try {
    const saved = window.localStorage.getItem(key);
    if (saved) return saved;
    const fresh = randomId();
    window.localStorage.setItem(key, fresh);
    return fresh;
  } catch {
    return randomId();
  }
};

/**
 * Runs the awful.chat handshake on every page and, once the host says hello,
 * joins the room bound to that app session and routes into it.
 */
export function AwfulBridge() {
  const awful = useAwful();
  const room = useRoomStore();
  const { setLocale } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const joinedFor = useRef<string | null>(null);

  useEffect(() => {
    startAwfulBridge();
  }, []);

  const hello = awful.status === "active" ? awful.hello : null;

  useEffect(() => {
    if (!hello || joinedFor.current === hello.session.id) return;
    joinedFor.current = hello.session.id;
    const locale = awfulLocale(hello.locale);
    if (locale) setLocale(locale);
    const args = parseAwfulArgs(
      hello.session.args,
      gamesCatalog.map((g) => g.type),
    );
    void awfulSessionId(hello).then((sessionId) => {
      room.joinAwful({
        awfulSession: hello.session.id,
        sessionId,
        displayName: hello.self.name.trim().slice(0, 40) || "Player",
        locale: locale ?? "en",
        playlist: args.playlist.length > 0 ? args.playlist : undefined,
        roomName: hello.self.name ? `${hello.self.name.trim().slice(0, 40)} · Gemu` : undefined,
        joinCode: args.joinCode,
        password: args.password,
      });
    });
  }, [hello, room, setLocale]);

  // Advertise the game in the call's user list ("Playing Gartic"): the
  // running game's name while playing, "Gemu" in between, nothing once out.
  const inRoom = Boolean(room.snapshot) && !room.left && !room.kicked;
  const status = room.snapshot?.status;
  const gameType = room.snapshot?.gameType;
  useEffect(() => {
    if (!hello) return;
    if (!inRoom) {
      setAwfulActivity(null);
      return;
    }
    const game =
      status === "playing" && gameType ? gamesCatalog.find((g) => g.type === gameType) : undefined;
    setAwfulActivity(game ? game.name : "Gemu");
  }, [hello, inRoom, status, gameType]);

  // Land in the room page whatever URL the tile was opened on.
  const roomId = room.snapshot?.id;
  useEffect(() => {
    if (!hello || !roomId) return;
    const target = `/room/${roomId}`;
    if (pathname !== target) router.replace(target);
  }, [hello, roomId, pathname, router]);

  return null;
}

/** Full-screen state shown instead of Gemu's own entry screens while embedded. */
export function AwfulGate() {
  const awful = useAwful();
  const room = useRoomStore();
  const { t } = useI18n();

  const error = room.joinError ? joinErrorText(room.joinError, t) : null;
  const left = room.left || room.kicked;

  return (
    <div className="min-h-dvh bg-(--bg-deep) flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-[22px] border-[3px] border-(--accent) bg-(--panel) p-6 text-center shadow-[0_6px_0_var(--drop)]">
        <div className="slab-xl text-4xl leading-none">GEMU</div>
        {left ? (
          <>
            <p className="mt-4 text-sm font-semibold text-(--ink)/80">
              {room.kicked ? t("edge.kickedDesc") : t("awful.left")}
            </p>
            <button
              className="buzzer mt-5 w-full rounded-2xl px-5 py-3 text-sm"
              style={{ background: "linear-gradient(180deg,#ffd23f,#f5b32a)", color: "var(--dark-ink)" }}
              onClick={() => closeAwfulApp()}
            >
              {t("awful.close")}
            </button>
          </>
        ) : error ? (
          <>
            <p role="alert" className="mt-4 text-sm font-semibold text-[#ffb3c1]">
              {error}
            </p>
            <button
              className="buzzer mt-5 w-full rounded-2xl px-5 py-3 text-sm"
              style={{ background: "linear-gradient(180deg,#ffd23f,#f5b32a)", color: "var(--dark-ink)" }}
              onClick={() => window.location.reload()}
            >
              {t("awful.retry")}
            </button>
          </>
        ) : (
          <p className="mt-4 font-mono text-xs uppercase tracking-[0.2em] text-(--ink)/70" aria-live="polite">
            {awful.status === "waiting" ? t("awful.connecting") : t("edge.joining")}
          </p>
        )}
      </div>
    </div>
  );
}
