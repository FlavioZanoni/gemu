import { test as guarded } from "./fixtures";
import { test, expect, type Page } from "@playwright/test";
import { dropNextGameAction, openRoom, startGame, type Room } from "./helpers";

// Cartas with 3 players, played to the end with REAL clicks (no programmatic
// el.click()): the hand fan must not swallow taps. The first two rounds also
// check the judge-only label, that the round's winner is announced to
// everyone (and is never the judge), and that the judge rotates.

const NAMES = ["HOST", "GUEST1", "GUEST2"];

const SHOTS = process.env.CAH_SHOTS_DIR;
const SHOT_SIZES = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
  { name: "tile", width: 640, height: 400 },
];

/** Opt-in (env CAH_SHOTS_DIR): this page at desktop, phone and small-tile sizes. */
async function shoot(page: Page, name: string) {
  if (!SHOTS) return;
  const original = page.viewportSize();
  for (const size of SHOT_SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/${name}-${size.name}.png` });
  }
  if (original) await page.setViewportSize(original);
}

/** Tap as many hand cards as the black card asks for (tap plays). */
async function playHand(page: Page) {
  const hand = page.getByTestId("cah-hand");
  const pick = Number(await hand.getAttribute("data-pick"));
  for (let i = 0; i < pick; i++) {
    await page.getByTestId(`cah-card-${i}`).click();
  }
  await expect(hand).toBeHidden();
}

/** Wait until this round's roles are dealt: the judge sees the judge-only
 *  label, everyone else a hand. */
async function roles(room: Room) {
  await expect
    .poll(async () => {
      let judges = 0;
      let hands = 0;
      for (const page of room.pages) {
        if (await page.getByTestId("cah-you-judge").isVisible().catch(() => false)) judges++;
        if (await page.getByTestId("cah-hand").isVisible().catch(() => false)) hands++;
      }
      return `${judges}/${hands}`;
    }, { timeout: 20_000 })
    .toBe("1/2");
  let judgeIdx = -1;
  for (let i = 0; i < room.pages.length; i++) {
    if (await room.pages[i].getByTestId("cah-you-judge").isVisible()) judgeIdx = i;
  }
  return judgeIdx;
}

guarded("cah: two judged rounds, judge-only label, winner, game reaches results", async ({ browser }) => {
  test.setTimeout(240_000);
  const room = await openRoom(browser, 3);
  try {
    await startGame(room, "cah");

    const judges: number[] = [];
    for (let r = 0; r < 2; r++) {
      const j = await roles(room);
      judges.push(j);
      const judge = room.pages[j];
      const pickers = room.pages.filter((_, i) => i !== j);

      if (r === 0) {
        await shoot(pickers[0], "answering");
        await shoot(judge, "judge-waiting");
        // A lost submit: the hand hides optimistically, then comes back once
        // the server's private state says nothing was played (no stuck round).
        const lost = pickers[0];
        await dropNextGameAction(lost, "submit");
        await playHand(lost);
        await playHand(pickers[1]);
        await expect(lost.getByTestId("cah-hand")).toBeVisible({ timeout: 10_000 });
        await expect(judge.getByTestId("cah-pick-0")).toHaveCount(0);
        await playHand(lost);
      } else {
        for (const p of pickers) await playHand(p);
      }

      // Judging: only the judge is told they're judging; the others see who is.
      await expect(judge.getByTestId("cah-pick-0")).toBeVisible({ timeout: 15_000 });
      for (const p of pickers) {
        await expect(p.getByTestId("cah-judging-label")).toContainText(NAMES[j]);
        await expect(p.getByTestId("cah-you-judge")).toHaveCount(0);
        await expect(p.getByTestId("cah-table-0")).toBeVisible();
      }
      if (r === 0) {
        await shoot(judge, "judging");
        await shoot(pickers[0], "judging-picker");
      }
      await judge.getByTestId("cah-pick-0").click();

      // Verdict: everyone sees the winning card and who played it.
      await Promise.all(room.pages.map((p) => expect(p.getByTestId("cah-winner")).toBeVisible({ timeout: 10_000 })));
      const judgeToast = (await judge.getByTestId("cah-winner-toast").innerText()).toUpperCase();
      const winnerIdx = NAMES.findIndex((n, i) => i !== j && judgeToast.includes(n));
      expect(winnerIdx, `winner named in "${judgeToast}"`).toBeGreaterThanOrEqual(0);
      await expect(room.pages[winnerIdx].getByTestId("cah-winner-toast")).toContainText("YOUR CARD");
      if (r === 0) await shoot(room.pages[winnerIdx], "verdict");
    }
    expect(judges[1], "the judge rotates between rounds").not.toBe(judges[0]);

    // Play the remaining rounds out to the session results.
    const voteNext = room.host.getByTestId("results-vote-next");
    await expect
      .poll(
        async () => {
          if (await voteNext.isVisible().catch(() => false)) return true;
          for (const page of room.pages) {
            if (await page.getByTestId("cah-hand").isVisible().catch(() => false)) {
              await playHand(page).catch(() => {});
            }
            const pick0 = page.getByTestId("cah-pick-0");
            if (await pick0.isVisible().catch(() => false)) await pick0.click().catch(() => {});
          }
          return false;
        },
        { timeout: 180_000, intervals: [500] },
      )
      .toBe(true);
  } finally {
    await room.cleanup();
  }
});
