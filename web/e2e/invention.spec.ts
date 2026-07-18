import { test, expect, type Page } from "@playwright/test";
import { test as guarded } from "./fixtures";
import { openRoom, startGame } from "./helpers";

// Plays Patently Silly through its first two phases with REAL canvas drawing:
// submit problems -> get assigned someone else's -> draw -> submit invention ->
// presentation starts. This is the flow that silently broke when a full-canvas
// PNG blew past the WS read limit, so the drawing here is a genuine stroke.

async function drawStroke(page: Page) {
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  // A squiggle across the canvas produces a real (non-trivial) PNG.
  // Use drag which reliably triggers pointer events in the canvas element.
  const startX = box.x + box.width * 0.2;
  const startY = box.y + box.height * 0.3;
  const endX = box.x + box.width * 0.8;
  const endY = box.y + box.height * 0.4;
  await canvas.dragTo(canvas, {
    sourcePosition: { x: box.width * 0.2, y: box.height * 0.3 },
    targetPosition: { x: box.width * 0.8, y: box.height * 0.4 },
    steps: 10,
  });
}

guarded("invention: problems, drawing, and submit reach the presentation", async ({ browser }) => {
  test.slow();
  const room = await openRoom(browser, 2);
  try {
    await startGame(room, "invention");

    // Phase 1: everyone writes two problems.
    for (const [i, page] of room.pages.entries()) {
      await page.getByPlaceholder(/Problem #1/).fill(`How to nap at work (${i})`);
      await page.getByPlaceholder("Problem #2").fill(`Where do lost socks go (${i})`);
      await page.getByRole("button", { name: "SUBMIT PROBLEMS" }).click();
    }

    // Phase 2: each player is assigned a problem NOT their own, titles it,
    // draws a real stroke, and submits.
    for (const [i, page] of room.pages.entries()) {
      await expect(page.getByPlaceholder("Invention title")).toBeVisible();
      // The assigned problem must be someone else's (index differs).
      await expect(page.getByText(`(${i})`)).toHaveCount(0);
      await page.getByPlaceholder("Invention title").fill(`The Fixotron ${i}`);
      await page.getByRole("button", { name: "Next: Draw your invention" }).click();
      await drawStroke(page);
      // Wait for the canvas data to be set (submit button becomes enabled)
      await expect(page.getByRole("button", { name: "Submit invention" })).toBeEnabled({ timeout: 5_000 });
      await page.getByRole("button", { name: "Submit invention" }).click();
    }

    // Both submitted -> presentation begins for everyone.
    for (const page of room.pages) {
      await expect(page.getByText("Presentation").first()).toBeVisible({ timeout: 15_000 });
    }
  } finally {
    await room.cleanup();
  }
});
