import { useSyncExternalStore } from "react";
import type {
  CustomDeck,
  DeckMeta,
  Envelope,
  GameResult,
  GameSettings,
  RoomSnapshot,
  SessionFinal,
  Standing,
  VoteResult,
  VoteState,
} from "./protocol";
import { getWSClient } from "./ws";

type RoomState = {
  snapshot: RoomSnapshot | null;
  connected: boolean;
  reconnecting: boolean;
  playerId: string | null;
  joinError: string | null;
  kicked: boolean;
  pendingJoin: boolean;
  leaving: boolean;
  left: boolean;
  gamePublicState: Record<string, unknown> | null;
  gamePrivateState: Record<string, unknown> | null;
  standings: Standing[];
  gameResult: GameResult | null;
  vote: VoteState | null;
  voteResult: VoteResult | null;
  sessionFinal: SessionFinal | null;
  pendingProfile: {
    name: string;
    avatarUrl: string;
    joinCode?: string;
    password?: string;
  } | null;
  actionError: { code: string; message: string } | null;
  actionErrorTimeout: NodeJS.Timeout | null;
  decks: DeckMeta[];
};

const initialState: RoomState = {
  snapshot: null,
  connected: false,
  reconnecting: false,
  playerId: null,
  joinError: null,
  kicked: false,
  pendingJoin: false,
  leaving: false,
  left: false,
  gamePublicState: null,
  gamePrivateState: null,
  standings: [],
  gameResult: null,
  vote: null,
  voteResult: null,
  sessionFinal: null,
  pendingProfile: null,
  actionError: null,
  actionErrorTimeout: null,
  decks: [],
};

const storageKey = "gemu:last-room";
const sessionCookie = "gemu_session";

type LastRoom = {
  roomId: string;
  displayName: string;
  avatarUrl: string;
  joinCode?: string;
  password?: string;
};

const loadLastRoom = () => {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LastRoom;
  } catch {
    return null;
  }
};

const saveLastRoom = (data: LastRoom) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey, JSON.stringify(data));
};

const saveLastRoomIfPresent = (
  snapshot: RoomSnapshot,
  profile: RoomState["pendingProfile"],
) => {
  if (!profile) return;
  saveLastRoom({
    roomId: snapshot.id,
    displayName: profile.name,
    avatarUrl: profile.avatarUrl,
    joinCode: profile.joinCode,
    password: profile.password,
  });
};

const clearLastRoom = () => {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(storageKey);
};

const createRequestId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const getCookie = (name: string) => {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${name}=`));
  if (!match) return null;
  return decodeURIComponent(match.slice(name.length + 1));
};

const setCookie = (name: string, value: string, days = 30) => {
  if (typeof document === "undefined") return;
  const maxAge = days * 24 * 60 * 60;
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
};

const clearCookie = (name: string) => {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
};

const getSessionId = () => {
  const existing = getCookie(sessionCookie);
  if (existing) return existing;
  const sessionId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `sess-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  setCookie(sessionCookie, sessionId);
  return sessionId;
};


// ---- Module-level singleton store ----
// One WS connection feeds one shared state object, so navigating between
// routes (home → /room/[id]) keeps the room snapshot instead of each page
// starting empty and wrongly re-joining.
let state: RoomState = initialState;
const subscribers = new Set<() => void>();
let pendingProfile: RoomState["pendingProfile"] = null;
let inRoom = false;
let wired = false;

const notify = () => subscribers.forEach((fn) => fn());
const setState = (updater: (prev: RoomState) => RoomState) => {
  state = updater(state);
  notify();
};

const send = (type: string, payload?: Record<string, unknown>) => {
  getWSClient().send({ type, requestId: createRequestId(), payload });
};

const handleMessage = (message: Envelope) => {
  if (message.type === "room.create.ok" || message.type === "room.join.ok") {
    const snapshot = message.payload as unknown as RoomSnapshot;
    inRoom = true;
    setState((prev) => {
      const matchedPlayerId = pendingProfile
        ? snapshot.players.find((p) => p.name === pendingProfile?.name)?.id
        : undefined;
      return {
        ...prev,
        snapshot,
        playerId:
          matchedPlayerId ??
          (message.type === "room.create.ok"
            ? (snapshot.players[snapshot.players.length - 1]?.id ??
              prev.playerId)
            : prev.playerId),
        joinError: null,
        pendingJoin: false,
        leaving: false,
        left: false,
        kicked: false,
        pendingProfile: null,
      };
    });
    saveLastRoomIfPresent(snapshot, pendingProfile);
    pendingProfile = null;
    // Fetch the available CAH decks for this room.
    send("lobby.decks.list");
  }
  if (message.type === "lobby.decks.list.ok") {
    const decks = (message.payload?.decks as DeckMeta[]) ?? [];
    setState((prev) => ({ ...prev, decks }));
  }
  if (message.type === "session.deck.add.ok") {
    // A custom deck was accepted — refresh the list.
    send("lobby.decks.list");
  }
  if (message.type === "room.updated") {
    const snapshot = message.payload as unknown as RoomSnapshot;
    setState((prev) => {
      const next: RoomState = { ...prev, snapshot };
      if (snapshot.status === "playing" && prev.snapshot?.status !== "playing") {
        next.gameResult = null;
        next.vote = null;
        next.voteResult = null;
        next.sessionFinal = null;
        next.standings = [];
        next.gamePublicState = null;
        next.gamePrivateState = null;
      }
      if (snapshot.status !== "voting") next.vote = null;
      return next;
    });
  }
  if (message.type === "game.state") {
    const publicState = message.payload?.public as Record<string, unknown> | undefined;
    const privateState = message.payload?.private as Record<string, unknown> | undefined;
    const standings = message.payload?.standings as Standing[] | undefined;
    if (publicState || privateState || standings) {
      setState((prev) => ({
        ...prev,
        gamePublicState: publicState ?? prev.gamePublicState,
        gamePrivateState: privateState ?? prev.gamePrivateState,
        standings: standings ?? prev.standings,
      }));
    }
  }
  if (message.type === "session.gameResult") {
    setState((prev) => ({
      ...prev,
      gameResult: message.payload as unknown as GameResult,
      vote: null,
      voteResult: null,
    }));
  }
  if (message.type === "session.vote") {
    const payload = message.payload as unknown as {
      options: VoteState["options"];
      deadline: number;
    };
    setState((prev) => ({
      ...prev,
      vote: { options: payload.options, deadline: payload.deadline, counts: {} },
      voteResult: null,
    }));
  }
  if (message.type === "session.vote.update") {
    const counts = message.payload?.counts as Record<string, number>;
    setState((prev) => (prev.vote ? { ...prev, vote: { ...prev.vote, counts } } : prev));
  }
  if (message.type === "session.vote.result") {
    setState((prev) => ({
      ...prev,
      vote: null,
      voteResult: message.payload as unknown as VoteResult,
    }));
  }
  if (message.type === "session.final") {
    setState((prev) => ({
      ...prev,
      sessionFinal: message.payload as unknown as SessionFinal,
    }));
  }
  if (message.type === "room.join.error" || message.type === "room.create.error") {
    setState((prev) => ({
      ...prev,
      joinError: (message.payload?.code as string) ?? "unknown",
      pendingJoin: false,
      leaving: false,
      left: false,
      pendingProfile: null,
    }));
    pendingProfile = null;
  }
  if (message.type === "room.kicked") {
    inRoom = false;
    setState((prev) => ({
      ...prev,
      kicked: true,
      snapshot: null,
      pendingJoin: false,
      leaving: false,
      left: true,
      pendingProfile: null,
    }));
    clearLastRoom();
    clearCookie(sessionCookie);
    pendingProfile = null;
  }
  if (message.type === "room.leave.ok") {
    inRoom = false;
    setState((prev) => ({ ...initialState, connected: prev.connected, left: true }));
    clearLastRoom();
    clearCookie(sessionCookie);
    pendingProfile = null;
  }
  // Any *.error surfaces as a transient toast (except the join/create ones
  // above, which drive the join gate). Auto-clears after 4s.
  if (
    message.type.endsWith(".error") &&
    message.type !== "room.join.error" &&
    message.type !== "room.create.error"
  ) {
    const code = (message.payload?.code as string) ?? "unknown";
    const text = (message.payload?.message as string) ?? code;
    setState((prev) => {
      if (prev.actionErrorTimeout) clearTimeout(prev.actionErrorTimeout);
      const timeout = setTimeout(() => {
        setState((s) => ({ ...s, actionError: null, actionErrorTimeout: null }));
      }, 4000);
      return { ...prev, actionError: { code, message: text }, actionErrorTimeout: timeout };
    });
  }
};

const ensureWired = () => {
  if (wired) return;
  wired = true;
  const client = getWSClient();
  client.connect();
  client.onOpen(() => {
    setState((prev) => ({ ...prev, connected: true, reconnecting: false }));
    // Reconnected while in a room: rejoin transparently to replay state.
    if (inRoom) {
      const last = loadLastRoom();
      if (last) {
        client.send({
          type: "room.join",
          requestId: createRequestId(),
          payload: {
            roomId: last.roomId,
            joinCode: last.joinCode,
            password: last.password,
            displayName: last.displayName,
            avatarUrl: last.avatarUrl,
            sessionId: getSessionId(),
          },
        });
      }
    }
  });
  client.onClose(() => {
    setState((prev) => ({ ...prev, connected: false, reconnecting: inRoom }));
  });
  client.onMessage(handleMessage);
};

const createRoom = (payload: {
  name: string;
  playlist: string[];
  visibility: "public" | "private";
  maxPlayers: number;
  displayName: string;
  avatarUrl: string;
  password?: string;
  locale?: string;
}) => {
  const sessionId = getSessionId();
  pendingProfile = {
    name: payload.displayName,
    avatarUrl: payload.avatarUrl,
    password: payload.password,
  };
  setState((prev) => ({
    ...prev,
    pendingJoin: true,
    leaving: false,
    left: false,
    kicked: false,
    joinError: null,
    pendingProfile,
  }));
  send("room.create", { ...payload, sessionId });
};

const joinRoom = (payload: {
  roomId?: string;
  joinCode?: string;
  password?: string;
  displayName: string;
  avatarUrl: string;
}) => {
  const sessionId = getSessionId();
  pendingProfile = {
    name: payload.displayName,
    avatarUrl: payload.avatarUrl,
    joinCode: payload.joinCode,
    password: payload.password,
  };
  setState((prev) => ({
    ...prev,
    pendingJoin: true,
    leaving: false,
    left: false,
    kicked: false,
    joinError: null,
    pendingProfile,
  }));
  send("room.join", { ...payload, sessionId });
};

const leaveRoom = () => {
  setState((prev) => ({ ...prev, leaving: true }));
  send("room.leave");
  clearCookie(sessionCookie);
};

const setReady = (ready: boolean) => send("room.ready.set", { ready });
const startGame = (opts?: { force?: boolean; settings?: GameSettings }) =>
  send("game.start", {
    ...(opts?.force ? { force: true } : {}),
    ...(opts?.settings ? { settings: opts.settings } : {}),
  });
const sendGameAction = (payload: Record<string, unknown>) =>
  send("game.action", payload);
const sendGameStream = (payload: Record<string, unknown>) =>
  getWSClient().send({ type: "game.stream", payload });
const kickPlayer = (playerId: string) => send("room.kick", { playerId });
const setPlaylist = (playlist: string[]) =>
  send("session.playlist.set", { playlist });
const startVote = () => send("session.vote.start");
const castVote = (gameType: string) => send("session.vote.cast", { gameType });
const replayGame = () => send("session.replay");
const endSession = () => send("session.end");
const pauseSession = () => send("session.pause");
const resumeSession = () => send("session.resume");
const setCahDecks = (decks: string[]) =>
  send("session.cahdecks.set", { decks });
const addCustomDeck = (deck: CustomDeck) =>
  send("session.deck.add", { deck });
const refreshDecks = () => send("lobby.decks.list");

const clearActionError = () => {
  setState((prev) => {
    if (prev.actionErrorTimeout) clearTimeout(prev.actionErrorTimeout);
    return { ...prev, actionError: null, actionErrorTimeout: null };
  });
};

const subscribe = (fn: () => void) => {
  ensureWired();
  subscribers.add(fn);
  return () => subscribers.delete(fn);
};
const getSnapshot = () => state;

export const useRoomStore = () => {
  const snap = useSyncExternalStore(subscribe, getSnapshot, () => initialState);
  const isAdmin =
    !!snap.snapshot && !!snap.playerId && snap.snapshot.adminId === snap.playerId;
  return {
    ...snap,
    isAdmin,
    createRoom,
    joinRoom,
    leaveRoom,
    setReady,
    startGame,
    sendGameAction,
    sendGameStream,
    kickPlayer,
    setPlaylist,
    startVote,
    castVote,
    replayGame,
    endSession,
    pauseSession,
    resumeSession,
    setCahDecks,
    addCustomDeck,
    refreshDecks,
    loadLastRoom,
    clearActionError,
  };
};
