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

export const useLobbyStore = () => {
  const [state, setState] = useState(initialState);
  const refresh = useCallback(() => {
    const client = getWSClient();
    client.connect();
    client.send({ type: "lobby.rooms.list", requestId: createRequestId() });
  }, []);

  useEffect(() => {
    const client = getWSClient();
    client.connect();

    const offOpen = client.onOpen(() => {
      setState((prev) => ({ ...prev, connected: true }));
      refresh();
    });

    const offClose = client.onClose(() => {
      setState((prev) => ({ ...prev, connected: false }));
    });

    const offMessage = client.onMessage((message: Envelope) => {
      if (message.type === "lobby.rooms.list.ok") {
        const rooms = (message.payload?.rooms ?? []) as PublicRoom[];
        setState((prev) => ({ ...prev, rooms }));
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

    return () => {
      offOpen();
      offClose();
      offMessage();
    };
  }, []);

  return { ...state, refresh };
};
