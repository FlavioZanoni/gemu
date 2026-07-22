import { test as guarded } from "./fixtures";
import { test, expect, type Page } from "@playwright/test";
import { openRoom, startGame, type Room } from "./helpers";

// Full Gartic Phone chain with 3 players: everyone writes a prompt, draws the
// prompt they receive, describes the drawing they receive, then the host paces
// the reveal to the end of the game.

async function drawStroke(page: Page) {
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();
  await canvas.dragTo(canvas, {
    sourcePosition: { x: 60, y: 60 },
    targetPosition: { x: 220, y: 140 },
    steps: 10,
  });
}

async function everyoneSubmits(room: Room, action: (page: Page, i: number) => Promise<void>) {
  for (let i = 0; i < room.pages.length; i++) {
    await action(room.pages[i], i);
  }
}

guarded("garticphone: prompt, draw, describe, reveal to game over", async ({ browser }) => {
  test.slow();
  const room = await openRoom(browser, 3);
  try {
    await startGame(room, "garticphone");

    // Step 1: prompts.
    await everyoneSubmits(room, async (page, i) => {
      await page.getByTestId("garticphone-prompt-input").fill(`a capybara doing thing ${i + 1}`);
      await page.getByTestId("garticphone-prompt-submit").click();
    });

    // Step 2: drawing the received prompt.
    await everyoneSubmits(room, async (page) => {
      await page.getByTestId("garticphone-submit-drawing").waitFor({ timeout: 15_000 });
      await drawStroke(page);
      await page.getByTestId("garticphone-submit-drawing").click();
    });

    // Step 3: describing the received drawing.
    await everyoneSubmits(room, async (page, i) => {
      await page.getByTestId("garticphone-description-input").waitFor({ timeout: 15_000 });
      await page.getByTestId("garticphone-description-input").fill(`something odd ${i + 1}`);
      await page.getByTestId("garticphone-description-submit").click();
    });

    // Reveal: host paces through every chain entry until game over.
    const next = room.host.getByTestId("garticphone-reveal-next");
    for (let i = 0; i < 30; i++) {
      if (await room.host.getByText("Game over!").isVisible().catch(() => false)) break;
      if (await next.isVisible().catch(() => false)) {
        await next.click().catch(() => {});
      }
      await room.host.waitForTimeout(500);
    }
    await expect(room.host.getByText("Game over!")).toBeVisible();
  } finally {
    await room.cleanup();
  }
});
