import { test as guarded } from "./fixtures";
import { test, expect, type Page } from "@playwright/test";
import { openRoom, startGame } from "./helpers";

// One full CAH round with 3 players: non-judges select enough white cards for
// the black card's pick count and submit, the judge picks a winner, and the
// winner card is revealed.

async function submitCards(page: Page) {
  // The hand is a fan of overlapping absolutely-positioned cards that also
  // overlap the submit button, so coordinate-based clicks hit whichever card
  // is on top. Use programmatic element clicks — they dispatch the click on
  // the exact element regardless of stacking.
  const submit = page.getByTestId("cah-submit");
  for (let i = 0; i < 5; i++) {
    if (await submit.isEnabled().catch(() => false)) break;
    await page.getByTestId(`cah-card-${i}`).evaluate((el) => (el as HTMLElement).click());
  }
  await expect(submit).toBeEnabled();
  await submit.evaluate((el) => (el as HTMLElement).click());
}

guarded("cah: pick, submit, judge, winner revealed", async ({ browser }) => {
  test.slow();
  const room = await openRoom(browser, 3);
  try {
    await startGame(room, "cah");

    // Non-judges see a hand; the judge waits.
    const pickers: Page[] = [];
    let judge: Page | undefined;
    for (const page of room.pages) {
      if (await page.getByTestId("cah-card-0").isVisible().catch(() => false)) {
        pickers.push(page);
      } else {
        judge = page;
      }
    }
    expect(pickers.length).toBe(2);
    expect(judge, "one page must be the judge").toBeTruthy();

    for (const picker of pickers) await submitCards(picker);

    // All submitted -> judging: judge picks the first submission.
    await judge!.getByTestId("cah-pick-0").click({ timeout: 15_000 });

    // Winner card revealed to everyone (results shows for ~8s — check all
    // pages in parallel so the window doesn't close mid-assert).
    await Promise.all(
      room.pages.map((page) =>
        expect(page.getByTestId("cah-winner")).toBeVisible({ timeout: 10_000 }),
      ),
    );
  } finally {
    await room.cleanup();
  }
});
