// Awful.chat app contract v1 (see awful.chat docs/awful-contract.md): Gemu can
// run as an app tile inside an awful.chat call. The host loads us in a
// sandboxed iframe; we say `ready`, it answers `hello` with a session id (our
// room), the player's name and locale. Everything here is postMessage only.
import { useSyncExternalStore } from "react";

export type AwfulPlayer = { id: string; name: string; color: string | null };

export type AwfulHello = {
  session: { id: string; startedAt: number; args: string };
  self: AwfulPlayer;
  players: AwfulPlayer[];
  theme: "dark" | "light";
  locale: string;
};

type AwfulState = {
  // idle: not started; waiting: framed, `ready` sent, no `hello` yet;
  // active: running inside awful.chat; none: top-level page or a host that
  // isn't awful (no hello within the grace period).
  status: "idle" | "waiting" | "active" | "none";
  hello: AwfulHello | null;
  players: AwfulPlayer[];
  theme: "dark" | "light";
};

const VERSION = 1;
// A host answers `ready` right away; past this we're framed by something else.
const HELLO_GRACE_MS = 4000;

let state: AwfulState = { status: "idle", hello: null, players: [], theme: "dark" };
const subscribers = new Set<() => void>();
const setState = (patch: Partial<AwfulState>) => {
  state = { ...state, ...patch };
  subscribers.forEach((fn) => fn());
};

export const inFrame = () => typeof window !== "undefined" && isFramed();

function isFramed() {
  try {
    return window.parent !== window;
  } catch {
    return true;
  }
}

const post = (message: Record<string, unknown>) => {
  try {
    // "*": we can't know which instance embeds us and nothing we send is secret.
    window.parent.postMessage({ awful: VERSION, ...message }, "*");
  } catch {
    // Parent gone (tile closed mid-send): nothing to do.
  }
};

const isPlayer = (value: unknown): value is AwfulPlayer =>
  !!value &&
  typeof (value as AwfulPlayer).id === "string" &&
  typeof (value as AwfulPlayer).name === "string";

const readPlayers = (value: unknown): AwfulPlayer[] =>
  Array.isArray(value) ? value.filter(isPlayer) : [];

const readTheme = (value: unknown): "dark" | "light" =>
  value === "light" ? "light" : "dark";

const onMessage = (event: MessageEvent) => {
  // Accept only our direct parent speaking v1; never trust a fixed origin list,
  // every awful.chat instance has its own.
  if (event.source !== window.parent) return;
  const data = event.data as Record<string, unknown> | null;
  if (!data || typeof data !== "object" || data.awful !== VERSION) return;

  switch (data.type) {
    case "hello": {
      const session = data.session as AwfulHello["session"] | undefined;
      if (!session || typeof session.id !== "string" || !session.id || !isPlayer(data.self)) return;
      const hello: AwfulHello = {
        session: {
          id: session.id,
          startedAt: typeof session.startedAt === "number" ? session.startedAt : 0,
          args: typeof session.args === "string" ? session.args : "",
        },
        self: data.self,
        players: readPlayers(data.players),
        theme: readTheme(data.theme),
        locale: typeof data.locale === "string" ? data.locale : "",
      };
      if (helloTimer) clearTimeout(helloTimer);
      helloTimer = null;
      // Every `ready` starts the host with no activity: say it again.
      lastActivity = undefined;
      setState({ status: "active", hello, players: hello.players, theme: hello.theme });
      break;
    }
    case "players":
      if (state.status === "active") setState({ players: readPlayers(data.players) });
      break;
    case "theme":
      if (state.status === "active") setState({ theme: readTheme(data.theme) });
      break;
    // Unknown types are ignored so a newer host can add messages freely.
  }
};

let helloTimer: ReturnType<typeof setTimeout> | null = null;

/** Starts the handshake once per page load. Safe to call repeatedly. */
export const startAwfulBridge = () => {
  if (typeof window === "undefined" || state.status !== "idle") return;
  if (!isFramed()) {
    setState({ status: "none" });
    return;
  }
  window.addEventListener("message", onMessage);
  setState({ status: "waiting" });
  helloTimer = setTimeout(() => {
    helloTimer = null;
    if (state.status === "waiting") setState({ status: "none" });
  }, HELLO_GRACE_MS);
  post({ type: "ready" });
};

// What we last advertised (undefined = nothing sent since the last hello).
let lastActivity: string | null | undefined;

/**
 * Advertises what this player is doing ("Playing <name>" under their name in
 * the call's user list); null clears it. Everyone in the room sees it, so it
 * must only ever be a game's name — never a score, hand or answer.
 */
export const setAwfulActivity = (name: string | null) => {
  if (state.status !== "active") return;
  const clean = name === null ? null : name.replace(/[\s\p{C}]+/gu, " ").trim().slice(0, 32) || null;
  if (clean === lastActivity) return;
  lastActivity = clean;
  post({ type: "activity", name: clean });
};

/** Asks the host to close the app tile for this person. */
export const closeAwfulApp = () => {
  setAwfulActivity(null);
  if (state.status === "active") post({ type: "close" });
};

export const getAwfulState = () => state;

const subscribe = (fn: () => void) => {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
};

const serverState: AwfulState = { status: "idle", hello: null, players: [], theme: "dark" };

export const useAwful = () => useSyncExternalStore(subscribe, getAwfulState, () => serverState);

/** True while we're (possibly) framed by awful.chat and shouldn't show Gemu's own entry UI. */
export const awfulPending = (s: AwfulState) => s.status === "waiting" || s.status === "active";

// ---- session.args ----
// `/app <gemu-url> [args]`: a 6-char Gemu room code (optionally followed by
// that room's password) joins an existing room; game names narrow the
// playlist for a new room. Anything else is ignored.
export const parseAwfulArgs = (args: string, knownGames: string[]) => {
  const tokens = args.trim().split(/\s+/).filter(Boolean).slice(0, 16);
  let joinCode: string | undefined;
  let password: string | undefined;
  const playlist: string[] = [];
  const known = new Map(knownGames.map((g) => [g.toLowerCase(), g]));
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const game = known.get(token.toLowerCase());
    if (game) {
      if (!playlist.includes(game)) playlist.push(game);
      continue;
    }
    if (!joinCode && /^[a-z0-9]{6}$/i.test(token)) {
      joinCode = token.toUpperCase();
      const next = tokens[i + 1];
      if (next && !known.has(next.toLowerCase())) {
        password = next;
        i++;
      }
    }
  }
  return { joinCode, password, playlist };
};

export const awfulLocale = (locale: string): "en" | "pt-BR" | null => {
  const lower = locale.toLowerCase();
  if (lower.startsWith("pt")) return "pt-BR";
  if (lower.startsWith("en")) return "en";
  return null;
};
