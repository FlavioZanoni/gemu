import { test as guarded } from "./fixtures";
import { test, expect, type Page } from "@playwright/test";
import { openRoom, startGame } from "./helpers";

// Full Gartic logic loop with 2 players: the drawer sees the secret word, the
// guesser submits it, the turn ends early (all guessers got it) and the
// turn-results reveal appears with the word and updated scores.

guarded("gartic: correct guess scores and ends the turn early", async ({ browser }) => {
  test.slow();
  const room = await openRoom(browser, 2);
  try {
    await startGame(room, "gartic");

    // Whoever shows the secret word is the drawer.
    let drawer: Page | undefined;
    let guesser: Page | undefined;
    for (const page of room.pages) {
      if (await page.getByTestId("gartic-secret-word").isVisible().catch(() => false)) {
        drawer = page;
      } else {
        guesser = page;
      }
    }
    expect(drawer, "one page must be the drawer").toBeTruthy();
    expect(guesser, "one page must be the guesser").toBeTruthy();

    const word = (await drawer!.getByTestId("gartic-secret-word").textContent())!.trim();
    expect(word.length).toBeGreaterThan(0);

    // A wrong guess first: shows up in the guess chat, turn keeps going.
    await guesser!.getByTestId("gartic-guess-input").fill("definitely wrong");
    await guesser!.getByTestId("gartic-guess-submit").click();
    await expect(drawer!.getByText("definitely wrong")).toBeVisible();

    // The right guess: sole guesser got it, so the turn ends early into the
    // reveal ("THE WORD WAS") on every page.
    await guesser!.getByTestId("gartic-guess-input").fill(word);
    await guesser!.getByTestId("gartic-guess-submit").click();
    for (const page of room.pages) {
      await expect(page.getByText("THE WORD WAS")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(word, { exact: false }).first()).toBeVisible();
    }
  } finally {
    await room.cleanup();
  }
});
