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
import { getWSClient, createRequestId } from "./ws";

type RoomState = {
  snapshot: RoomSnapshot | null;
  connected: boolean;
  reconnecting: boolean;
  playerId: string | null;
  joinError: string | null;
  kicked: boolean;
  /** Another tab/window took this seat over (room.sessionReplaced). */
  replaced: boolean;
  pendingJoin: boolean;
  leaving: boolean;
  left: boolean;
  gamePublicState: Record<string, unknown> | null;
  gamePrivateState: Record<string, unknown> | null;
  standings: Standing[];
  gameResult: GameResult | null;
  vote: VoteState | null;
  voteResult: VoteResult | null;
  /** Set for ~3.5s when the next game is revealed (vote or random pick). */
  drumroll: { gameType: string; key: number } | null;
  sessionFinal: SessionFinal | null;
  pendingProfile: {
    name: string;
    avatarUrl: string;
    joinCode?: string;
    password?: string;
    awfulSession?: string;
  } | null;
  actionError: { code: string; message: string } | null;
  actionErrorTimeout: NodeJS.Timeout | null;
  decks: DeckMeta[];
  /** Outcome of the last custom-deck upload, matched by seq. */
  deckAdd: { seq: number; status: "pending" | "ok" | "error"; message?: string } | null;
};

const initialState: RoomState = {
  snapshot: null,
  connected: false,
  reconnecting: false,
  playerId: null,
  joinError: null,
  kicked: false,
  replaced: false,
  pendingJoin: false,
  leaving: false,
  left: false,
  gamePublicState: null,
  gamePrivateState: null,
  standings: [],
  gameResult: null,
  vote: null,
  voteResult: null,
  drumroll: null,
  sessionFinal: null,
  pendingProfile: null,
  actionError: null,
  actionErrorTimeout: null,
  decks: [],
  deckAdd: null,
};

const storageKey = "gemu:last-room";
const sessionCookie = "gemu_session";

type LastRoom = {
  roomId: string;
  displayName: string;
  avatarUrl: string;
  joinCode?: string;
  password?: string;
  // Set when joined from inside awful.chat: reconnects resend it. A bearer
  // value for the room, so it lives only in memoryLastRoom, never in storage
  // (a full reload inside awful re-joins from the host's hello anyway).
  awfulSession?: string;
};

// Storage can throw (blocked site data, sandboxed frames): every access goes
// through these and degrades to "nothing saved".
const storageGet = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const storageSet = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
};
const storageRemove = (key: string) => {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
};

// In-memory copy of the last room: where storage is blocked (sandboxed
// frames) a reconnect must still know which room to rejoin.
let memoryLastRoom: LastRoom | null = null;

const loadLastRoom = (): LastRoom | null => {
  if (typeof window === "undefined") return null;
  if (memoryLastRoom) return memoryLastRoom;
  const raw = storageGet(storageKey);
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as LastRoom;
    if (saved.awfulSession) {
      // Written by an older build: scrub the bearer id from storage.
      delete saved.awfulSession;
      storageSet(storageKey, JSON.stringify(saved));
    }
    return saved;
  } catch {
    return null;
  }
};

const saveLastRoom = (data: LastRoom) => {
  if (typeof window === "undefined") return;
  memoryLastRoom = data;
  const { awfulSession: _memoryOnly, ...persisted } = data;
  void _memoryOnly;
  storageSet(storageKey, JSON.stringify(persisted));
};

const saveLastRoomIfPresent = (
  snapshot: RoomSnapshot,
  profile: RoomState["pendingProfile"],
  playerId: string | null,
) => {
  if (!profile) return;
  // The server may have adjusted the name (awful joins suffix duplicates);
  // remember the one we actually hold so reconnects don't try to rename.
  const seat = playerId ? snapshot.players.find((p) => p.id === playerId) : undefined;
  saveLastRoom({
    roomId: snapshot.id,
    displayName: seat?.name ?? profile.name,
    avatarUrl: profile.avatarUrl,
    joinCode: profile.joinCode ?? snapshot.joinCode,
    password: profile.password,
    awfulSession: profile.awfulSession,
  });
};

const clearLastRoom = () => {
  if (typeof window === "undefined") return;
  memoryLastRoom = null;
  storageRemove(storageKey);
};

const getCookie = (name: string) => {
  if (typeof document === "undefined") return null;
  try {
    const match = document.cookie
      .split(";")
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith(`${name}=`));
    if (!match) return null;
    return decodeURIComponent(match.slice(name.length + 1));
  } catch {
    return null;
  }
};

const setCookie = (name: string, value: string, days = 30) => {
  if (typeof document === "undefined") return;
  const maxAge = days * 24 * 60 * 60;
  try {
    document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
  } catch {
    // Sandboxed frames can throw on cookie access.
  }
};

const clearCookie = (name: string) => {
  if (typeof document === "undefined") return;
  try {
    document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
  } catch {
    // ignore
  }
};

const sessionStorageKey = "gemu:session";
// In-memory copy: inside a cross-site iframe the cookie (and sometimes
// storage) is blocked, and a session id that changes on every call would turn
// each reconnect into a brand-new player.
let memorySessionId: string | null = null;
// Embedded in awful.chat, the session id is per (app session, awful player)
// so two awful people sharing one browser profile never collide.
let sessionOverride: string | null = null;

const newSessionId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `sess-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const getSessionId = () => {
  if (sessionOverride) return sessionOverride;
  const existing = memorySessionId ?? getCookie(sessionCookie) ?? storageGet(sessionStorageKey);
  const sessionId = existing ?? newSessionId();
  memorySessionId = sessionId;
  setCookie(sessionCookie, sessionId);
  storageSet(sessionStorageKey, sessionId);
  return sessionId;
};

const forgetSessionId = () => {
  memorySessionId = null;
  clearCookie(sessionCookie);
  storageRemove(sessionStorageKey);
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

// The join/create request awaiting a reply: resent (join) or failed (create)
// when the socket drops before the answer arrives.
let pendingRequest: Envelope | null = null;
// Whether pendingRequest actually left on an open socket. One that never went
// out (asked for while offline) is simply sent on the next open; only one
// that was sent and then lost with its socket can have had an effect.
let pendingSent = false;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
const JOIN_TIMEOUT_MS = 15_000;

// Automatic rejoin after a reconnect. The server may still hold our old
// socket for a moment (session_in_room): retry a few times with backoff.
let rejoinInFlight = false;
let rejoinAttempts = 0;
let rejoinTimer: ReturnType<typeof setTimeout> | null = null;
const MAX_REJOIN_ATTEMPTS = 5;

let drumrollTimer: ReturnType<typeof setTimeout> | null = null;
let leaveTimer: ReturnType<typeof setTimeout> | null = null;
let deckSeq = 0;
let pendingDeckSeq = 0;
// requestId of a session.next.random awaiting its answer (older servers
// don't know it: fall back to a plain forced game.start).
let nextRandomRequestId: string | null = null;

const notify = () => subscribers.forEach((fn) => fn());
const setState = (updater: (prev: RoomState) => RoomState) => {
  state = updater(state);
  notify();
};

const send = (type: string, payload?: Record<string, unknown>) => {
  const requestId = createRequestId();
  const sent = getWSClient().send({ type, requestId, payload });
  return { requestId, sent };
};

const clearPendingTimer = () => {
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = null;
};

// Send a join/create and arm the "no answer" timeout.
const sendPending = (type: "room.join" | "room.create", payload: Record<string, unknown>) => {
  const envelope: Envelope = { type, requestId: createRequestId(), payload };
  pendingRequest = envelope;
  clearPendingTimer();
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    if (!state.pendingJoin) return;
    // Given up: nothing re-sends it on a later open.
    pendingRequest = null;
    pendingSent = false;
    pendingProfile = null;
    setState((prev) => ({ ...prev, pendingJoin: false, pendingProfile: null, joinError: "timeout" }));
  }, JOIN_TIMEOUT_MS);
  // Offline, the WS client drops it; the open listener sends it instead.
  pendingSent = getWSClient().send(envelope);
};

// Everything tied to one game run; cleared when the room moves to another
// game so a component never sees another game's state shape.
const clearedGameState = {
  gamePublicState: null,
  gamePrivateState: null,
  standings: [] as Standing[],
};

const showToast = (code: string, message: string) => {
  setState((prev) => {
    if (prev.actionErrorTimeout) clearTimeout(prev.actionErrorTimeout);
    const timeout = setTimeout(() => {
      setState((s) => ({ ...s, actionError: null, actionErrorTimeout: null }));
    }, 4000);
    return { ...prev, actionError: { code, message }, actionErrorTimeout: timeout };
  });
};

const rejoinPayload = (last: LastRoom) => ({
  roomId: last.roomId,
  joinCode: last.joinCode,
  password: last.password,
  displayName: last.displayName,
  avatarUrl: last.avatarUrl,
  sessionId: getSessionId(),
  ...(last.awfulSession ? { awfulSession: last.awfulSession } : {}),
});

const sendRejoin = () => {
  const last = loadLastRoom();
  if (!last) {
    // Nothing to rejoin with: drop the stale room instead of freezing on it.
    inRoom = false;
    setState((prev) => ({
      ...prev,
      ...clearedGameState,
      snapshot: null,
      reconnecting: false,
    }));
    return;
  }
  rejoinInFlight = true;
  getWSClient().send({ type: "room.join", requestId: createRequestId(), payload: rejoinPayload(last) });
};

const handleJoinError = (code: string) => {
  if (rejoinInFlight) {
    rejoinInFlight = false;
    // Our previous socket may not be gone yet: the server either takes it
    // over or frees it shortly, so retry before giving up.
    const retryable = code === "session_in_room" || code === "rate_limited";
    if (retryable && rejoinAttempts < MAX_REJOIN_ATTEMPTS) {
      const delay = 500 * 2 ** rejoinAttempts;
      rejoinAttempts += 1;
      if (rejoinTimer) clearTimeout(rejoinTimer);
      rejoinTimer = setTimeout(() => {
        rejoinTimer = null;
        if (inRoom && getWSClient().isOpen()) sendRejoin();
      }, delay);
      return;
    }
    // The room is gone (or won't take us back): leave the frozen snapshot and
    // show the join gate with the reason.
    inRoom = false;
    rejoinAttempts = 0;
    if (code === "not_found" || code === "invalid_room") clearLastRoom();
    setState((prev) => ({
      ...prev,
      ...clearedGameState,
      snapshot: null,
      reconnecting: false,
      gameResult: null,
      vote: null,
      voteResult: null,
      joinError: code,
      pendingJoin: false,
      pendingProfile: null,
    }));
    return;
  }
  clearPendingTimer();
  pendingRequest = null;
  pendingSent = false;
  setState((prev) => ({
    ...prev,
    joinError: code,
    pendingJoin: false,
    leaving: false,
    left: false,
    pendingProfile: null,
  }));
  pendingProfile = null;
};

const finishLeave = () => {
  if (leaveTimer) clearTimeout(leaveTimer);
  leaveTimer = null;
  inRoom = false;
  setState((prev) => ({ ...initialState, connected: prev.connected, decks: prev.decks, left: true }));
  clearLastRoom();
  forgetSessionId();
  pendingProfile = null;
};

// The next-game reveal. Fired by session.vote.result, and also when the room
// moves from results/vote to a queued game without one (play again, or a
// one-game playlist) — the design drumrolls every reveal.
const startDrumroll = (gameType: string) => {
  if (drumrollTimer) clearTimeout(drumrollTimer);
  drumrollTimer = setTimeout(() => {
    drumrollTimer = null;
    setState((prev) => ({ ...prev, drumroll: null }));
  }, 3600);
  setState((prev) => ({ ...prev, drumroll: { gameType, key: Date.now() } }));
};

const handleMessage = (message: Envelope) => {
  if (message.type === "room.create.ok" || message.type === "room.join.ok") {
    const { playerId: ownId, ...rest } = message.payload as unknown as RoomSnapshot & {
      playerId?: string;
    };
    const snapshot = rest as RoomSnapshot;
    inRoom = true;
    rejoinInFlight = false;
    rejoinAttempts = 0;
    pendingRequest = null;
    pendingSent = false;
    clearPendingTimer();
    setState((prev) => {
      const matchedPlayerId =
        ownId ??
        (pendingProfile
          ? snapshot.players.find((p) => p.name === pendingProfile?.name)?.id
          : undefined);
      // A (re)join replays game.state / votes right after this; anything we
      // still hold from a different room, game or phase is stale.
      const prevSnap = prev.snapshot;
      const sameRoom = prevSnap?.id === snapshot.id;
      const sameGame =
        sameRoom && prevSnap?.gameType === snapshot.gameType && prevSnap?.status === snapshot.status;
      return {
        ...prev,
        ...(sameGame ? {} : clearedGameState),
        gameResult: sameGame ? prev.gameResult : null,
        vote: snapshot.status === "voting" && sameGame ? prev.vote : null,
        voteResult: sameGame ? prev.voteResult : null,
        sessionFinal: sameRoom ? prev.sessionFinal : null,
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
        replaced: false,
        reconnecting: false,
        pendingProfile: null,
      };
    });
    saveLastRoomIfPresent(snapshot, pendingProfile, state.playerId);
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
    setState((prev) => ({ ...prev, deckAdd: { seq: pendingDeckSeq, status: "ok" } }));
    send("lobby.decks.list");
  }
  if (message.type === "session.deck.add.error") {
    setState((prev) => ({
      ...prev,
      deckAdd: {
        seq: pendingDeckSeq,
        status: "error",
        message:
          (message.payload?.message as string | undefined) ??
          (message.payload?.code as string | undefined),
      },
    }));
    return;
  }
  if (message.type === "room.updated") {
    if (!inRoom) return;
    const snapshot = message.payload as unknown as RoomSnapshot;
    if (state.snapshot && snapshot.id && snapshot.id !== state.snapshot.id) return;
    const prevStatus = state.snapshot?.status;
    const revealed =
      snapshot.status === "lobby" &&
      !!snapshot.nextGameType &&
      (prevStatus === "results" || prevStatus === "voting") &&
      !state.drumroll;
    setState((prev) => {
      const next: RoomState = { ...prev, snapshot };
      const enteringPlay = snapshot.status === "playing" && prev.snapshot?.status !== "playing";
      const gameChanged = prev.snapshot?.gameType !== snapshot.gameType;
      if (enteringPlay) {
        next.gameResult = null;
        next.vote = null;
        next.voteResult = null;
        next.sessionFinal = null;
      }
      if (enteringPlay || gameChanged) Object.assign(next, clearedGameState);
      if (snapshot.status !== "voting") next.vote = null;
      return next;
    });
    if (revealed) startDrumroll(snapshot.nextGameType);
  }
  if (message.type === "game.state") {
    if (!inRoom) return;
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
    const result = message.payload as unknown as VoteResult;
    nextRandomRequestId = null;
    setState((prev) => ({ ...prev, vote: null, voteResult: result }));
    if (result?.gameType) startDrumroll(result.gameType);
  }
  if (message.type === "session.final") {
    setState((prev) => ({
      ...prev,
      sessionFinal: message.payload as unknown as SessionFinal,
    }));
  }
  if (message.type === "room.join.error" || message.type === "room.create.error") {
    handleJoinError((message.payload?.code as string) ?? "unknown");
  }
  if (message.type === "room.kicked") {
    inRoom = false;
    setState((prev) => ({
      ...prev,
      ...clearedGameState,
      kicked: true,
      snapshot: null,
      pendingJoin: false,
      leaving: false,
      left: false,
      reconnecting: false,
      pendingProfile: null,
    }));
    clearLastRoom();
    forgetSessionId();
    pendingProfile = null;
  }
  if (message.type === "room.sessionReplaced") {
    // This seat moved to another tab/window. Stop treating this tab as in
    // the room (no auto-rejoin on reconnect) until the user takes it back.
    inRoom = false;
    rejoinInFlight = false;
    setState((prev) => ({
      ...prev,
      ...clearedGameState,
      replaced: true,
      snapshot: null,
      reconnecting: false,
      pendingJoin: false,
    }));
  }
  if (message.type === "room.leave.ok") {
    finishLeave();
  }
  // An older server doesn't know session.next.random: start the first game
  // directly instead (no drumroll, but the night still starts). Only for
  // that answer — any other system.error (rate_limited…) is just a toast.
  if (
    message.type === "system.error" &&
    nextRandomRequestId &&
    message.requestId === nextRandomRequestId
  ) {
    nextRandomRequestId = null;
    if (message.payload?.code === "unknown_type") {
      send("game.start", { force: true });
      return;
    }
  }
  // Any *.error surfaces as a transient toast (except the join/create ones
  // above, which drive the join gate). Auto-clears after 4s.
  if (
    message.type.endsWith(".error") &&
    message.type !== "room.join.error" &&
    message.type !== "room.create.error"
  ) {
    let code = (message.payload?.code as string) ?? "unknown";
    // No game in the playlist fits the players present.
    if (message.type === "session.next.random.error" && code === "empty_playlist") code = "no_eligible_game";
    const text = (message.payload?.message as string) ?? code;
    showToast(code, text);
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
      setState((prev) => ({ ...prev, reconnecting: true }));
      sendRejoin();
      return;
    }
    // A join/create is waiting. One asked for while offline never went
    // out: send it now. One that went out on the dropped socket lost its
    // answer: a join is safe to repeat (same session id); a create is not —
    // it may have made a room — so that one fails visibly instead.
    if (state.pendingJoin && pendingRequest) {
      if (pendingRequest.type === "room.join" || !pendingSent) {
        pendingRequest = { ...pendingRequest, requestId: createRequestId() };
        pendingSent = client.send(pendingRequest);
      } else {
        clearPendingTimer();
        pendingRequest = null;
        pendingSent = false;
        pendingProfile = null;
        setState((prev) => ({ ...prev, pendingJoin: false, pendingProfile: null, joinError: "connection_lost" }));
      }
    }
  });
  client.onClose(() => {
    rejoinInFlight = false;
    setState((prev) => ({ ...prev, connected: false, reconnecting: inRoom }));
    // Leaving with no connection: nothing will answer, finish locally.
    if (state.leaving) finishLeave();
  });
  client.onMessage(handleMessage);
  if (client.isOpen()) setState((prev) => ({ ...prev, connected: true }));
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
    replaced: false,
    joinError: null,
    pendingProfile,
  }));
  sendPending("room.create", { ...payload, sessionId });
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
    replaced: false,
    joinError: null,
    pendingProfile,
  }));
  sendPending("room.join", { ...payload, sessionId });
};

// Join (or create) the room bound to an awful.chat app session. The server
// keeps one room per session id; the first person to open the tile hosts it.
const joinAwful = (payload: {
  awfulSession: string;
  sessionId: string;
  displayName: string;
  locale?: string;
  playlist?: string[];
  roomName?: string;
  joinCode?: string;
  password?: string;
}) => {
  sessionOverride = payload.sessionId;
  pendingProfile = {
    name: payload.displayName,
    avatarUrl: "",
    joinCode: payload.joinCode,
    password: payload.password,
    awfulSession: payload.awfulSession,
  };
  setState((prev) => ({
    ...prev,
    pendingJoin: true,
    leaving: false,
    left: false,
    kicked: false,
    replaced: false,
    joinError: null,
    pendingProfile,
  }));
  const { sessionId, ...rest } = payload;
  sendPending("room.join", { ...rest, avatarUrl: "", sessionId });
};

// Take the seat back after another tab took it over (room.sessionReplaced).
const reclaimRoom = () => {
  const last = loadLastRoom();
  if (!last) {
    setState((prev) => ({ ...prev, replaced: false }));
    return;
  }
  pendingProfile = {
    name: last.displayName,
    avatarUrl: last.avatarUrl,
    joinCode: last.joinCode,
    password: last.password,
    awfulSession: last.awfulSession,
  };
  setState((prev) => ({ ...prev, pendingJoin: true, joinError: null, pendingProfile }));
  sendPending("room.join", rejoinPayload(last));
};

const leaveRoom = () => {
  setState((prev) => ({ ...prev, leaving: true }));
  if (!getWSClient().isOpen()) {
    finishLeave();
    return;
  }
  send("room.leave");
  // Never strand the user on "Leaving…" if the answer gets lost.
  if (leaveTimer) clearTimeout(leaveTimer);
  leaveTimer = setTimeout(() => {
    leaveTimer = null;
    if (state.leaving) finishLeave();
  }, 4000);
};

// Back on the home page after a kick / takeover: forget that state.
const resetRoomFlags = () => {
  if (!state.kicked && !state.replaced && !state.left) return;
  setState((prev) => ({ ...prev, kicked: false, replaced: false, left: false }));
};

const setReady = (ready: boolean) => send("room.ready.set", { ready });
const startGame = (opts?: { force?: boolean; settings?: GameSettings }) =>
  send("game.start", {
    ...(opts?.force ? { force: true } : {}),
    ...(opts?.settings ? { settings: opts.settings } : {}),
  });
// "Start the show": the server picks the first game (eligible for the
// players present) and reveals it with the drumroll + intro.
const startShow = () => {
  nextRandomRequestId = send("session.next.random").requestId;
};
// Game actions aren't queued while the socket is down (a stale move replayed
// later does harm). Say so instead of losing the tap silently; the return
// value lets a caller undo an optimistic "sent" state.
const sendGameAction = (payload: Record<string, unknown>) => {
  const { sent } = send("game.action", payload);
  if (!sent) showToast("not_connected", "reconnecting");
  return sent;
};
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
const addCustomDeck = (deck: CustomDeck) => {
  deckSeq += 1;
  pendingDeckSeq = deckSeq;
  setState((prev) => ({ ...prev, deckAdd: { seq: deckSeq, status: "pending" } }));
  send("session.deck.add", { deck });
  return deckSeq;
};

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

// Lightweight selector for widgets (timers) that only need "is the show
// paused?" — no WS wiring side effects.
const subscribeQuiet = (fn: () => void) => {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
};
const getPaused = () => Boolean(state.snapshot?.paused && state.snapshot.status === "playing");
export const useRoomPaused = () => useSyncExternalStore(subscribeQuiet, getPaused, () => false);

export const useRoomStore = () => {
  const snap = useSyncExternalStore(subscribe, getSnapshot, () => initialState);
  const isAdmin =
    !!snap.snapshot && !!snap.playerId && snap.snapshot.adminId === snap.playerId;
  return {
    ...snap,
    isAdmin,
    createRoom,
    joinRoom,
    joinAwful,
    reclaimRoom,
    leaveRoom,
    resetRoomFlags,
    setReady,
    startGame,
    startShow,
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
    loadLastRoom,
    clearActionError,
  };
};
