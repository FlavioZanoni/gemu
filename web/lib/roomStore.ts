import { useEffect, useMemo, useRef, useState } from "react";
import type { Envelope, RoomSnapshot } from "./protocol";
import { getWSClient } from "./ws";

type RoomState = {
  snapshot: RoomSnapshot | null;
  connected: boolean;
  playerId: string | null;
  joinError: string | null;
  kicked: boolean;
  pendingJoin: boolean;
  leaving: boolean;
  left: boolean;
  gamePublicState: Record<string, unknown> | null;
  gamePrivateState: Record<string, unknown> | null;
  pendingProfile: { name: string; avatarUrl: string; joinCode?: string } | null;
};

const initialState: RoomState = {
  snapshot: null,
  connected: false,
  playerId: null,
  joinError: null,
  kicked: false,
  pendingJoin: false,
  leaving: false,
  left: false,
  gamePublicState: null,
  gamePrivateState: null,
  pendingProfile: null,
};

const storageKey = "gemu:last-room";
const sessionCookie = "gemu_session";

const loadLastRoom = () => {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as {
      roomId: string;
      displayName: string;
      avatarUrl: string;
      joinCode?: string;
    };
  } catch {
    return null;
  }
};

const saveLastRoom = (data: {
  roomId: string;
  displayName: string;
  avatarUrl: string;
  joinCode?: string;
}) => {
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

export const useRoomStore = () => {
  const [state, setState] = useState(initialState);
  const pendingProfileRef = useRef<RoomState["pendingProfile"]>(null);

  useEffect(() => {
    const client = getWSClient();
    client.connect();

    const offOpen = client.onOpen(() => {
      setState((prev) => ({ ...prev, connected: true }));
    });

    const offClose = client.onClose(() => {
      setState((prev) => ({ ...prev, connected: false }));
    });

    const offMessage = client.onMessage((message: Envelope) => {
      if (
        message.type === "room.create.ok" ||
        message.type === "room.join.ok"
      ) {
        const snapshot = message.payload as RoomSnapshot;
        setState((prev) => {
          const matchedPlayerId = prev.pendingProfile
            ? snapshot.players.find(
                (player) =>
                  player.name === prev.pendingProfile?.name &&
                  player.avatarUrl === prev.pendingProfile?.avatarUrl,
              )?.id
            : undefined;
          if (message.type === "room.create.ok") {
            return {
              ...prev,
              snapshot,
              playerId:
                matchedPlayerId ??
                snapshot.players[snapshot.players.length - 1]?.id ??
                prev.playerId,
              joinError: null,
              pendingJoin: false,
              leaving: false,
              left: false,
              pendingProfile: null,
            };
          }
          return {
            ...prev,
            snapshot,
            joinError: null,
            playerId: matchedPlayerId ?? prev.playerId,
            pendingJoin: false,
            leaving: false,
            left: false,
            pendingProfile: null,
          };
        });
        saveLastRoomIfPresent(snapshot, pendingProfileRef.current);
        pendingProfileRef.current = null;
      }
      if (message.type === "room.updated") {
        const snapshot = message.payload as RoomSnapshot;
        setState((prev) => ({ ...prev, snapshot }));
      }
      if (message.type === "game.state") {
        const publicState = message.payload?.public as
          | Record<string, unknown>
          | undefined;
        const privateState = message.payload?.private as
          | Record<string, unknown>
          | undefined;
        if (publicState || privateState) {
          setState((prev) => ({
            ...prev,
            gamePublicState: publicState ?? prev.gamePublicState,
            gamePrivateState: privateState ?? prev.gamePrivateState,
          }));
        }
      }
      if (
        message.type === "room.join.error" ||
        message.type === "room.create.error"
      ) {
        setState((prev) => ({
          ...prev,
          joinError: (message.payload?.message as string) ?? "Failed to join",
          pendingJoin: false,
          leaving: false,
          left: false,
          pendingProfile: null,
        }));
        pendingProfileRef.current = null;
      }
      if (message.type === "room.kicked") {
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
        pendingProfileRef.current = null;
      }
      if (message.type === "room.leave.ok") {
        setState((prev) => ({
          ...prev,
          snapshot: null,
          pendingJoin: false,
          leaving: false,
          left: true,
          pendingProfile: null,
        }));
        clearLastRoom();
        clearCookie(sessionCookie);
        pendingProfileRef.current = null;
      }
    });

    return () => {
      offOpen();
      offClose();
      offMessage();
    };
  }, []);

  const createRoom = (payload: {
    name: string;
    gameType: string;
    visibility: "public" | "private";
    maxPlayers: number;
    displayName: string;
    avatarUrl: string;
  }) => {
    const client = getWSClient();
    const sessionId = getSessionId();
    setState((prev) => ({
      ...prev,
      pendingJoin: true,
      leaving: false,
      left: false,
      pendingProfile: {
        name: payload.displayName,
        avatarUrl: payload.avatarUrl,
      },
    }));
    pendingProfileRef.current = {
      name: payload.displayName,
      avatarUrl: payload.avatarUrl,
    };
    client.send({
      type: "room.create",
      requestId: createRequestId(),
      payload: { ...payload, sessionId },
    });
  };

  const joinRoom = (payload: {
    roomId: string;
    joinCode?: string;
    displayName: string;
    avatarUrl: string;
  }) => {
    const client = getWSClient();
    const sessionId = getSessionId();
    setState((prev) => ({
      ...prev,
      pendingJoin: true,
      leaving: false,
      left: false,
      pendingProfile: {
        name: payload.displayName,
        avatarUrl: payload.avatarUrl,
        joinCode: payload.joinCode,
      },
    }));
    pendingProfileRef.current = {
      name: payload.displayName,
      avatarUrl: payload.avatarUrl,
      joinCode: payload.joinCode,
    };
    client.send({
      type: "room.join",
      requestId: createRequestId(),
      payload: { ...payload, sessionId },
    });
  };

  const leaveRoom = () => {
    const client = getWSClient();
    setState((prev) => ({ ...prev, leaving: true }));
    client.send({ type: "room.leave", requestId: createRequestId() });
    clearCookie(sessionCookie);
  };

  const setReady = (ready: boolean) => {
    const client = getWSClient();
    client.send({
      type: "room.ready.set",
      requestId: createRequestId(),
      payload: { ready },
    });
  };

  const startGame = (force?: boolean) => {
    const client = getWSClient();
    client.send({
      type: "game.start",
      requestId: createRequestId(),
      payload: force ? { force: true } : undefined,
    });
  };

  const sendGameAction = (payload: Record<string, unknown>) => {
    const client = getWSClient();
    client.send({
      type: "game.action",
      requestId: createRequestId(),
      payload,
    });
  };

  const kickPlayer = (playerId: string) => {
    const client = getWSClient();
    client.send({
      type: "room.kick",
      requestId: createRequestId(),
      payload: { playerId },
    });
  };

  const isAdmin = useMemo(() => {
    if (!state.snapshot || !state.playerId) return false;
    return state.snapshot.adminId === state.playerId;
  }, [state.snapshot, state.playerId]);

  return {
    ...state,
    isAdmin,
    createRoom,
    joinRoom,
    leaveRoom,
    setReady,
    startGame,
    sendGameAction,
    kickPlayer,
    loadLastRoom,
  };
};
