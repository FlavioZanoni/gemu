export type Envelope = {
  type: string;
  requestId?: string;
  roomId?: string;
  payload?: Record<string, unknown>;
};

export type GameSummary = {
  type: string;
  name: string;
};

export type PublicRoom = {
  id: string;
  name: string;
  gameType: string;
  gameName: string;
  visibility: "public" | "private";
  maxPlayers: number;
  playerCount: number;
};

export type Player = {
  id: string;
  name: string;
  avatarUrl: string;
  connected: boolean;
  ready: boolean;
  lastSeen: string;
};

export type RoomSnapshot = {
  id: string;
  name: string;
  gameType: string;
  gameName: string;
  visibility: "public" | "private";
  maxPlayers: number;
  joinCode: string;
  adminId: string;
  players: Player[];
};
