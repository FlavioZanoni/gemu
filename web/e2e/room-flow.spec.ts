import { test, expect } from "./fixtures";
import { openRoom, startGame } from "./helpers";

// Multi-player flow: a host creates a room, a second player joins by code, both
// see each other in the green room, and the host starts a game so both land on
// the game surface. Two isolated contexts stand in for two real players.

test("two players meet in the green room and start a game", async ({ browser }) => {
  const room = await openRoom(browser, 2);
  const [host, guest] = room.pages;
  try {
    // Both players see both contestants.
    for (const page of [host, guest]) {
      await expect(page.getByText("Host", { exact: false }).first()).toBeVisible();
      await expect(page.getByText("Guest1", { exact: false }).first()).toBeVisible();
    }

    // Ready both, force Stop, and confirm both land on the surface.
    await startGame(room, "stop");
    await expect(host.getByTestId("game-surface")).toBeVisible();
    await expect(guest.getByTestId("game-surface")).toBeVisible();
  } finally {
    await room.cleanup();
  }
});
