import { test as guarded } from "./fixtures";
import { test, expect, type Page } from "@playwright/test";
import { openRoom, startGame, type Room } from "./helpers";

// One full Stop! round with 2 players: fill every category, slam STOP, ride
// the 5s grace, vote everything VALID in the judging phase, land on round
// results, and advance to round 2.

async function fillAllAnswers(page: Page, letter: string) {
  const inputs = page.locator('[data-testid^="stop-answer-"]');
  const count = await inputs.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    await inputs.nth(i).fill(`${letter}${"aa"}${i}`);
  }
}

async function voteValidUntilResults(room: Room) {
  const nextRound = room.host.getByTestId("stop-next-round");
  for (let i = 0; i < 60; i++) {
    if (await nextRound.isVisible().catch(() => false)) return;
    for (const page of room.pages) {
      // Judge answers one at a time, then send the whole verdict with the
      // final "Validate" submit once every pair is judged.
      const valid = page.getByTestId("stop-valid");
      if (await valid.isVisible().catch(() => false)) {
        await valid.click().catch(() => {});
        continue;
      }
      const submit = page.getByTestId("stop-validate-submit");
      if (await submit.isVisible().catch(() => false)) {
        await submit.click().catch(() => {});
      }
    }
    await room.host.waitForTimeout(300);
  }
  await expect(nextRound).toBeVisible();
}

guarded("stop: fill, slam, validate, results, next round", async ({ browser }) => {
  test.slow();
  const room = await openRoom(browser, 2);
  try {
    await startGame(room, "stop");

    const letter = (await room.host.getByTestId("stop-letter").textContent())!.trim();
    expect(letter).toHaveLength(1);

    for (const page of room.pages) await fillAllAnswers(page, letter);
    // set_answers is debounced — let it flush before slamming.
    await room.host.waitForTimeout(800);
    await room.host.getByTestId("stop-button").click();

    // Judging phase: everyone votes VALID until results.
    await voteValidUntilResults(room);

    // Round results reached; host advances and round 2's fill phase appears.
    await room.host.getByTestId("stop-next-round").click();
    await expect(room.host.getByTestId("stop-answer-0")).toBeVisible({ timeout: 15_000 });
    // Fresh letter tile visible for round 2 on every page.
    for (const page of room.pages) {
      await expect(page.getByTestId("stop-letter")).toBeVisible();
    }
  } finally {
    await room.cleanup();
  }
});
