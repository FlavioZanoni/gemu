// Maps a server join/create error code to a localized message. Shared by the
// home page and the in-room join gate (previously duplicated in both).
export function joinErrorText(code: string, t: (k: string) => string): string {
  const map: Record<string, string> = {
    not_found: "edge.errorNotFound",
    invalid_room: "edge.errorNotFound",
    invalid_code: "edge.errorInvalidCode",
    invalid_password: "edge.errorInvalidPassword",
    password_wrong: "edge.errorInvalidPassword",
    name_taken: "edge.errorNameTaken",
    room_full: "edge.errorRoomFull",
    session_in_room: "edge.errorSessionInRoom",
    already_in_room: "edge.errorSessionInRoom",
    not_enough_players: "edge.errorNotEnoughPlayers",
  };
  return map[code] ? t(map[code]) : code;
}
