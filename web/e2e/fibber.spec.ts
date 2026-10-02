import { test as guarded } from "./fixtures";
import { test, expect, type Page } from "@playwright/test";
import { dropNextGameAction, openRoom, startGame, type Room } from "./helpers";

// Fibber with 3 players: lies in (a duplicate lie is bounced back to its
// author with an error), everyone picks an option they're allowed to (own lie
// disabled — only once the player's private state for this phase arrived),
// the reveal shows the truth plus every lie, and the game plays through to
// the session results screen.

const SHOTS = process.env.FIBBER_SHOTS_DIR;
const SHOT_SIZES = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
  { name: "tile", width: 640, height: 400 },
];

/** Opt-in (env FIBBER_SHOTS_DIR): this page at desktop, phone and small-tile sizes. */
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

async function dismissHowTo(page: Page) {
  const gotit = page.getByTestId("howto-gotit");
  if (await gotit.isVisible().catch(() => false)) await gotit.click();
}

async function writeLie(page: Page, text: string) {
  await dismissHowTo(page);
  await page.getByTestId("fibber-lie-input").fill(text);
  await page.getByTestId("fibber-lie-submit").click();
  await expect(page.getByTestId("fibber-lie-input")).toBeHidden();
}

async function pickAllowed(page: Page) {
  // All choices stay disabled until this player's private state (own lie)
  // matches the choosing phase, so the first enabled one is always legal.
  const choice = page.locator('[data-testid^="fibber-choice-"]:not([disabled])').first();
  await choice.click({ timeout: 15_000 });
}

async function playRound(room: Room, round: number) {
  for (let i = 0; i < room.pages.length; i++) {
    await writeLie(room.pages[i], `round ${round} fib by player ${i + 1}`);
  }
  for (const page of room.pages) await pickAllowed(page);
  for (const page of room.pages) {
    await expect(page.getByTestId("fibber-answer")).toBeVisible({ timeout: 15_000 });
  }
}

guarded("fibber: duplicate lie bounced, choices made, truth revealed, game finishes", async ({ browser }) => {
  test.slow();
  test.setTimeout(240_000);
  const room = await openRoom(browser, 3);
  try {
    await startGame(room, "fibber");
    const [host, g1, g2] = room.pages;
    for (const page of room.pages) {
      await expect(page.getByTestId("fibber-lie-input")).toBeVisible({ timeout: 15_000 });
      await dismissHowTo(page);
    }

    // Round 1: host writes a lie; guest 1 tries the same lie with different
    // case/spacing/punctuation and is told someone already wrote it.
    await writeLie(host, "Purple Banana");
    await g1.getByTestId("fibber-lie-input").fill("  purple   BANANA! ");
    await g1.getByTestId("fibber-lie-submit").click();
    const err = g1.getByTestId("fibber-lie-error");
    await expect(err).toBeVisible();
    await expect(err).toHaveAttribute("data-reason", "duplicate");
    await expect(err).toContainText("Someone already wrote that");
    await expect(g1.getByTestId("fibber-lie-submit")).toBeDisabled();
    // Still writing: the bounced lie did not count as submitted.
    await expect(host.getByTestId("fibber-progress")).toContainText("1/3");
    // Editing clears the error; a fresh lie goes through.
    await writeLie(g1, "green kiwi");
    await expect(g1.getByTestId("fibber-lie-error")).toHaveCount(0);
    // Punctuation / emoji only: the client refuses it up front with a hint.
    await g2.getByTestId("fibber-lie-input").fill("!!! 🤥 ?");
    await expect(g2.getByTestId("fibber-lie-submit")).toBeDisabled();
    await expect(g2.getByTestId("fibber-lie-error")).toHaveAttribute("data-reason", "empty");
    await shoot(g2, "writing-empty-hint");
    // A lost lie: Submit locks while it's in flight, then unlocks once the
    // server's private state shows it never arrived.
    await dropNextGameAction(g2, "lie");
    await g2.getByTestId("fibber-lie-input").fill("red mango");
    await g2.getByTestId("fibber-lie-submit").click();
    await expect(g2.getByTestId("fibber-lie-submit")).toBeDisabled();
    await expect(g2.getByTestId("fibber-lie-submit")).toBeEnabled({ timeout: 10_000 });
    await expect(host.getByTestId("fibber-progress")).toContainText("2/3");
    await g2.getByTestId("fibber-lie-submit").click();
    await expect(g2.getByTestId("fibber-lie-input")).toBeHidden();

    // Choosing: own lie is disabled and tagged; everyone else is pickable.
    for (const page of room.pages) {
      await expect(page.locator('[data-testid^="fibber-choice-"]')).toHaveCount(4);
      await expect(page.locator('[data-own="true"]')).toHaveCount(1);
      await expect(page.locator('[data-own="true"]')).toBeDisabled();
    }
    await shoot(host, "choosing");
    // A lost pick: the choice locks optimistically, then unlocks again.
    await dropNextGameAction(host, "choose");
    await pickAllowed(host);
    await expect(host.locator('[data-testid^="fibber-choice-"]:not([disabled])')).toHaveCount(0);
    await expect(host.locator('[data-testid^="fibber-choice-"]:not([disabled])').first()).toBeVisible({ timeout: 10_000 });
    for (const page of room.pages) await pickAllowed(page);

    // Reveal: truth + all three lies (no lie silently dropped).
    for (const page of room.pages) {
      await expect(page.getByText("The real answer was")).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('[data-testid^="fibber-reveal-"]')).toHaveCount(4);
    }
    await shoot(host, "reveal");

    // Remaining rounds, then the session results screen.
    const voteNext = host.getByTestId("results-vote-next");
    for (let round = 2; round <= 12; round++) {
      await Promise.race([
        host.getByTestId("fibber-lie-input").waitFor({ state: "visible", timeout: 25_000 }),
        voteNext.waitFor({ state: "visible", timeout: 25_000 }),
      ]);
      if (await voteNext.isVisible().catch(() => false)) break;
      await playRound(room, round);
    }
    await expect(voteNext).toBeVisible({ timeout: 25_000 });
  } finally {
    await room.cleanup();
  }
});
