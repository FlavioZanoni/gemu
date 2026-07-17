import { test, expect } from "./fixtures";
import { openRoom, startGame } from "./helpers";

// A page reload drops the WebSocket. The store must transparently rejoin using
// the persisted session, so the player stays in the room instead of getting
// bounced back to the join gate — a regression we've paid for before.

test("reloading in the green room keeps you in the room", async ({ browser }) => {
  const room = await openRoom(browser, 2);
  try {
    await expect(room.host.getByTestId("room-code")).toBeVisible();
    await room.host.reload();
    // Back in the lobby, not the join gate.
    await expect(room.host.getByTestId("room-code")).toBeVisible();
    await expect(room.host.getByTestId("start-game")).toBeVisible();
  } finally {
    await room.cleanup();
  }
});

test("reloading mid-game returns to the game surface", async ({ browser }) => {
  const room = await openRoom(browser, 2);
  try {
    await startGame(room, "stop");
    const guest = room.guests[0];
    await guest.reload();
    await expect(guest.getByTestId("game-surface")).toBeVisible();
  } finally {
    await room.cleanup();
  }
});
