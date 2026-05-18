import { useEffect, useState } from "react";
import type { Envelope, GameSummary, PublicRoom } from "./protocol";
import { getWSClient } from "./ws";

type LobbyState = {
  games: GameSummary[];
  rooms: PublicRoom[];
  connected: boolean;
};

const initialState: LobbyState = {
  games: [],
  rooms: [],
  connected: false,
};

const createRequestId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const useLobbyStore = () => {
  const [state, setState] = useState(initialState);

  useEffect(() => {
    const client = getWSClient();
    client.connect();

    const offOpen = client.onOpen(() => {
      setState((prev) => ({ ...prev, connected: true }));
      client.send({ type: "lobby.games.list", requestId: createRequestId() });
      client.send({ type: "lobby.rooms.list", requestId: createRequestId() });
    });

    const offClose = client.onClose(() => {
      setState((prev) => ({ ...prev, connected: false }));
    });

    const offMessage = client.onMessage((message: Envelope) => {
      if (message.type === "lobby.games.list.ok") {
        const games = (message.payload?.games ?? []) as GameSummary[];
        setState((prev) => ({ ...prev, games }));
      }
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

  return state;
};
