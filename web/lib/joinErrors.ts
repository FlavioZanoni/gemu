// Maps a server join/create error code to a localized message. Shared by the
// home page, the in-room join gate and the awful.chat gate.
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
    rate_limited: "err.rateLimited",
    server_full: "edge.errorServerFull",
    timeout: "edge.errorTimeout",
    connection_lost: "edge.errorConnectionLost",
    invalid_payload: "err.generic",
  };
  return map[code] ? t(map[code]) : t("err.generic");
}

// Friendly text for server error codes surfaced as toasts; unknown codes fall
// back to a generic message rather than showing a raw key.
export function actionErrorText(code: string, t: (k: string) => string): string {
  const map: Record<string, string> = {
    not_admin: "err.notAdmin",
    not_enough_players: "err.notEnoughPlayers",
    empty_playlist: "err.emptyPlaylist",
    wrong_status: "err.wrongStatus",
    game_in_progress: "err.gameInProgress",
    paused: "err.paused",
    invalid_game: "err.invalidGame",
    not_ready: "err.notReady",
    rate_limited: "err.rateLimited",
    no_vote_active: "err.voteClosed",
    nothing_played: "err.wrongStatus",
    too_many_decks: "err.tooManyDecks",
    invalid_deck: "decks.rejected",
    invalid_target: "err.invalidTarget",
    no_eligible_game: "err.noEligibleGame",
    not_connected: "err.reconnecting",
  };
  return map[code] ? t(map[code]) : t("err.generic");
}
