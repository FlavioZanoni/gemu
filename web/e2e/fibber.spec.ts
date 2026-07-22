import { test as guarded } from "./fixtures";
import { test, expect } from "@playwright/test";
import { openRoom, startGame } from "./helpers";

// One full Fibber round with 3 players: everyone writes a lie, everyone picks
// an option (own lie is disabled), and the reveal shows the real answer.

guarded("fibber: lies in, choices made, truth revealed", async ({ browser }) => {
  test.slow();
  const room = await openRoom(browser, 3);
  try {
    await startGame(room, "fibber");

    for (let i = 0; i < room.pages.length; i++) {
      const page = room.pages[i];
      await page.getByTestId("fibber-lie-input").fill(`obvious fib ${i + 1}`);
      await page.getByTestId("fibber-lie-submit").click();
    }

    // Choosing phase: each player picks the first option not disabled for them.
    for (const page of room.pages) {
      const choice = page.locator('[data-testid^="fibber-choice-"]:not([disabled])').first();
      await choice.click({ timeout: 15_000 });
    }

    // Reveal: the truth banner appears for everyone.
    for (const page of room.pages) {
      await expect(page.getByText("The real answer was")).toBeVisible({ timeout: 15_000 });
    }
  } finally {
    await room.cleanup();
  }
});
