import { test as guarded } from "./fixtures";
import { test, expect, type Page } from "@playwright/test";
import { openRoom, startGame, playTriviaToResults } from "./helpers";

// Trivia with 2 players: both answer (different options), the reveal marks
// the right answer, shows how many picked each option and the points gained,
// the live scoreboard picks up the score, the next question is answerable
// again (a stale private choice must not lock it), and the game plays out to
// the session results screen.

async function dismissHowTo(page: Page) {
  const gotit = page.getByTestId("howto-gotit");
  if (await gotit.isVisible().catch(() => false)) await gotit.click();
}

guarded("trivia: answer, reveal with picks + points, next question, results", async ({ browser }) => {
  test.slow();
  test.setTimeout(240_000);
  const room = await openRoom(browser, 2);
  try {
    await startGame(room, "trivia");
    const [host, guest] = room.pages;
    for (const page of room.pages) {
      await expect(page.getByTestId("trivia-option-0")).toBeEnabled({ timeout: 15_000 });
      await dismissHowTo(page);
    }
    const game = host.getByTestId("trivia-game");
    await expect(game).toHaveAttribute("data-round", "1");
    await expect(host.getByTestId("trivia-question")).not.toBeEmpty();

    // Host locks option A; the guest still sees everything open.
    await host.getByTestId("trivia-option-0").click();
    await expect(host.getByTestId("trivia-option-0")).toHaveAttribute("data-mine", "true");
    await expect(host.getByTestId("trivia-option-1")).toBeDisabled();
    await expect(host.getByText("Answer locked")).toBeVisible();
    await expect(guest.getByTestId("trivia-locked-count")).toContainText("1/2");
    await expect(guest.getByTestId("trivia-option-1")).toBeEnabled();

    // Guest picks B → everyone answered → immediate reveal.
    await guest.getByTestId("trivia-option-1").click();
    for (const page of room.pages) {
      await expect(page.getByTestId("trivia-reveal")).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('[data-correct="true"]')).toHaveCount(1);
      await expect(page.getByTestId("trivia-pick-count-0")).toHaveText("×1");
      await expect(page.getByTestId("trivia-pick-count-1")).toHaveText("×1");
    }
    const correctId = await host.locator('[data-correct="true"]').getAttribute("data-testid");
    const correct = Number(correctId!.replace("trivia-option-", ""));
    const hostResult = host.getByTestId("trivia-result");
    const guestResult = guest.getByTestId("trivia-result");
    if (correct === 0) {
      // First (and only) correct answer: 100 + 50 speed bonus.
      await expect(hostResult).toHaveText("Correct! +150");
      await expect(guestResult).toHaveText("Not this time");
      await expect(host.getByTestId("trivia-gained")).toHaveCount(1);
    } else if (correct === 1) {
      await expect(guestResult).toHaveText("Correct! +150");
      await expect(hostResult).toHaveText("Not this time");
      await expect(host.getByTestId("trivia-gained")).toHaveCount(1);
    } else {
      await expect(hostResult).toHaveText("Not this time");
      await expect(guestResult).toHaveText("Not this time");
      await expect(host.getByTestId("trivia-gained")).toHaveCount(0);
    }
    // The shell scoreboard reflects the points.
    if (correct <= 1) {
      await expect(host.getByTestId("score-strip").first()).toContainText("150");
    }

    // Question 2 opens unlocked for both players (no stale choice).
    await expect(game).toHaveAttribute("data-round", "2", { timeout: 15_000 });
    for (const page of room.pages) {
      await expect(page.getByTestId("trivia-option-0")).toBeEnabled();
      await expect(page.getByTestId("trivia-option-1")).toBeEnabled();
    }

    await playTriviaToResults(room);
    await expect(host.getByTestId("results-vote-next")).toBeVisible();
  } finally {
    await room.cleanup();
  }
});
