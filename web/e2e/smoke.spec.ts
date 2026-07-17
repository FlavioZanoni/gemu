import { test, expect } from "./fixtures";
import { ALL_GAMES, openRoom, startGame } from "./helpers";

// Every game's surface is a fresh tree of components that could hide a render
// crash (this is the class of bug that TimerBadge's conditional hook was).
// Start each game with 3 players (enough for the 3-player games too) and assert
// the surface mounts for everyone with zero console errors — the per-page
// console guard runs in cleanup().
for (const game of ALL_GAMES) {
  test(`game surface mounts cleanly: ${game}`, async ({ browser }) => {
    const room = await openRoom(browser, 3);
    try {
      await startGame(room, game);
      for (const page of room.pages) {
        await expect(page.getByTestId("game-surface")).toBeVisible();
      }
    } finally {
      await room.cleanup();
    }
  });
}
