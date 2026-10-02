import { useCallback, useEffect, useState } from "react";
import type { Envelope, PublicRoom } from "./protocol";
import { getWSClient, createRequestId } from "./ws";

type LobbyState = {
  rooms: PublicRoom[];
  connected: boolean;
};

const initialState: LobbyState = {
  rooms: [],
  connected: false,
};

// The public room list doesn't push every change (rooms opening elsewhere,
// counts on rooms we're not in): poll while the home page is up.
const REFRESH_MS = 15_000;

const requestRooms = () => {
  const client = getWSClient();
  client.connect();
  // Not open yet: the open listener asks (a queued copy would ask twice).
  if (!client.isOpen()) return;
  client.send({ type: "lobby.rooms.list", requestId: createRequestId() });
};

export const useLobbyStore = () => {
  const [state, setState] = useState(initialState);
  const refresh = useCallback(() => requestRooms(), []);

  useEffect(() => {
    const client = getWSClient();
    client.connect();

    const offOpen = client.onOpen(() => {
      setState((prev) => ({ ...prev, connected: true }));
      requestRooms();
    });

    const offClose = client.onClose(() => {
      setState((prev) => ({ ...prev, connected: false }));
    });

    const offMessage = client.onMessage((message: Envelope) => {
      if (message.type === "lobby.rooms.list.ok") {
        const rooms = (message.payload?.rooms ?? []) as PublicRoom[];
        // Any answer proves the socket is up (covers a socket that opened
        // before this hook subscribed).
        setState((prev) => ({ ...prev, rooms, connected: true }));
      }
      if (message.type === "room.updated") {
        const snapshot = message.payload as {
          id: string;
          name: string;
          gameType: string;
          gameName: string;
          visibility: "public" | "private";
          maxPlayers: number;
          players?: { id: string }[];
          hasPassword?: boolean;
          status?: PublicRoom["status"];
          playlist?: string[];
        };
        if (!snapshot || snapshot.visibility !== "public") {
          setState((prev) => ({
            ...prev,
            rooms: prev.rooms.filter((room) => room.id !== snapshot?.id),
          }));
          return;
        }
        const playerCount = snapshot.players?.length ?? 0;
        if (playerCount === 0) {
          setState((prev) => ({
            ...prev,
            rooms: prev.rooms.filter((room) => room.id !== snapshot.id),
          }));
          return;
        }
        setState((prev) => {
          const nextRooms = prev.rooms.filter((r) => r.id !== snapshot.id);
          nextRooms.push({
            id: snapshot.id,
            name: snapshot.name,
            gameType: snapshot.gameType,
            gameName: snapshot.gameName ?? "",
            visibility: snapshot.visibility,
            maxPlayers: snapshot.maxPlayers,
            playerCount,
            hasPassword: snapshot.hasPassword ?? false,
            status: snapshot.status ?? "lobby",
            playlist: snapshot.playlist ?? [],
          });
          return { ...prev, rooms: nextRooms };
        });
      }
    });

    // The socket may already be open (we came back from a room, or a room
    // link opened it first): its `open` event won't fire again for us.
    if (client.isOpen()) requestRooms();

    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && client.isOpen()) requestRooms();
    }, REFRESH_MS);
    const onFocus = () => {
      if (client.isOpen()) requestRooms();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      offOpen();
      offClose();
      offMessage();
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  return { ...state, refresh };
};
