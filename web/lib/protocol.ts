export type Envelope = {
  type: string;
  requestId?: string;
  roomId?: string;
  payload?: Record<string, unknown>;
};

export type GameSummary = {
  type: string;
  name: string;
  minPlayers: number;
};

export type RoomStatus = "lobby" | "playing" | "results" | "voting";

export type PublicRoom = {
  id: string;
  name: string;
  gameType: string;
  gameName: string;
  visibility: "public" | "private";
  maxPlayers: number;
  playerCount: number;
  hasPassword: boolean;
  status: RoomStatus;
  playlist: string[];
};

export type Player = {
  id: string;
  name: string;
  avatarUrl: string;
  connected: boolean;
  ready: boolean;
  lastSeen: string;
};

export type PlacementRow = {
  playerId: string;
  name: string;
  place: number;
  score: number;
  points: number;
};

export type PlayedGame = {
  gameType: string;
  gameName: string;
  standings: PlacementRow[];
};

export type Standing = {
  playerId: string;
  score: number;
};

export type RoomSnapshot = {
  id: string;
  name: string;
  gameType: string;
  gameName: string;
  visibility: "public" | "private";
  maxPlayers: number;
  joinCode: string;
  hasPassword: boolean;
  locale: string;
  adminId: string;
  players: Player[];
  status: RoomStatus;
  paused: boolean;
  cahDeckIds: string[];
  playlist: string[];
  nextGameType: string;
  nextGameName: string;
  sessionScores: Record<string, number>;
  playedGames: PlayedGame[];
};

export type VoteOption = {
  type: string;
  name: string;
};

export type VoteState = {
  options: VoteOption[];
  deadline: number; // epoch millis
  counts: Record<string, number>;
};

export type VoteResult = {
  gameType: string;
  gameName: string;
  counts: Record<string, number>;
};

export type GameResult = {
  gameType: string;
  gameName: string;
  standings: PlacementRow[];
};

export type SessionFinal = {
  standings: PlacementRow[];
  playedGames: PlayedGame[];
};

// Host-configurable knobs per game (docs/session-protocol.md).
export type GameSettings = Record<string, number>;

export type DeckMeta = {
  id: string;
  name: string;
  locale: string;
  nsfw: boolean;
  black: number;
  white: number;
};

// A custom deck the host uploads (Gemu deck JSON format).
export type CustomDeck = {
  name: string;
  locale?: string;
  nsfw?: boolean;
  black: { text: string; pick: number }[];
  white: string[];
};
