import { test as guarded } from "./fixtures";
import { test, expect, type Page } from "@playwright/test";
import { dropNextGameAction, openRoom, startGame, type Room } from "./helpers";

// A full Stop! game with 2 players:
//  round 1 — the guest keeps typing during the 5s STOP grace and that answer
//            counts even when its first set_answers is lost (re-sent until
//            the server echoes it); the guest's "validate" is lost too and
//            is re-sent, so the room doesn't sit out the 60s judge timer; the host calls one guest answer NONSENSE and, with only
//            two players, that single vote zeroes it (author can't vote);
//  round 2 — starts with every input empty (no stale round-1 answers);
//  rounds 2-3 — all answers off-letter, so judging is skipped;
//  final  — last round's standings show, then the session results screen.

const SHOTS = process.env.STOP_SHOTS; // optional screenshot dir
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
  { name: "tile", width: 640, height: 400 },
];

async function shoot(page: Page, label: string) {
  if (!SHOTS) return;
  const original = page.viewportSize();
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/${label}-${vp.name}.png` });
    // No horizontal page overflow at any size.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${label} overflows horizontally at ${vp.name}`).toBeLessThanOrEqual(0);
  }
  if (original) await page.setViewportSize(original);
}

async function fill(page: Page, value: (i: number) => string, skip: number[] = []) {
  const inputs = page.locator('[data-testid^="stop-answer-"]');
  await expect(inputs.first()).toBeVisible();
  const count = await inputs.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    if (skip.includes(i)) continue;
    await inputs.nth(i).fill(value(i));
  }
  return count;
}

// Judge every card on `page` (VALID unless `rejectFirst`), until this player
// has nothing left to judge or results are up.
async function judgeAll(page: Page, rejectFirst: boolean) {
  let first = true;
  for (let i = 0; i < 80; i++) {
    if (await page.getByTestId("stop-results").isVisible().catch(() => false)) return;
    if (await page.getByTestId("stop-judge-waiting").isVisible().catch(() => false)) return;
    const btn = page.getByTestId(first && rejectFirst ? "stop-nonsense" : "stop-valid");
    if (await btn.isVisible().catch(() => false)) {
      // Disabled for ~1.4s while the live tally shows; click waits for enabled.
      await btn.click({ timeout: 5_000 }).catch(() => {});
      if (first) {
        await expect(page.getByTestId("stop-tally")).toBeVisible();
      }
      first = false;
      continue;
    }
    await page.waitForTimeout(200);
  }
}

async function letterOf(page: Page) {
  const letter = (await page.getByTestId("stop-letter").textContent())!.trim();
  expect(letter).toHaveLength(1);
  return letter;
}

async function offLetterRound(room: Room) {
  // Digits never start with the letter → every answer auto-invalid → no
  // judging, straight to results after the grace.
  const { host, guest } = { host: room.host, guest: room.guests[0] };
  await fill(host, (i) => `${i}${i}`);
  await host.getByTestId("stop-button").click();
  await expect(guest.getByTestId("stop-grace")).toBeVisible();
  await expect(host.getByTestId("stop-results")).toBeVisible({ timeout: 20_000 });
}

guarded("stop: grace typing, 2-player rejection, clean round 2, finish", async ({ browser }) => {
  test.setTimeout(240_000);
  const room = await openRoom(browser, 2);
  const { host } = room;
  const guest = room.guests[0];
  try {
    await startGame(room, "stop");

    // ── Round 1 ──
    const letter = await letterOf(host);
    await shoot(host, "1-fill");
    const n = await fill(host, (i) => `${letter}ost${i}`);
    // Guest leaves the last category empty for now.
    await fill(guest, (i) => `${letter}uest${i}`, [n - 1]);

    // STOP right after typing (no wait for the debounce): the click flushes.
    await host.getByTestId("stop-button").click();
    await expect(guest.getByTestId("stop-grace")).toBeVisible();
    await expect(host.getByTestId("stop-slam")).toBeAttached();
    await shoot(guest, "2-slam");

    // Inputs stay live during the grace: the guest finishes the last one.
    const late = guest.getByTestId(`stop-answer-${n - 1}`);
    await expect(late).toBeEditable();
    // The first send of the late answer is lost: it must be re-sent.
    await dropNextGameAction(guest, "set_answers");
    await late.fill(`${letter}late`);
    await expect(late).toHaveValue(`${letter}late`);

    // Judging: host rejects the first guest answer, everything else valid.
    await expect(host.getByTestId("stop-judge")).toBeVisible({ timeout: 15_000 });
    await expect(host.getByTestId("stop-judge-header")).toContainText(`1`);
    await shoot(host, "3-judge");
    // The guest's lock-in is lost once; the client re-sends it because the
    // server's private state still says validated=false.
    await dropNextGameAction(guest, "validate");
    await Promise.all([judgeAll(host, true), judgeAll(guest, false)]);

    // Well inside the 60s validation timer.
    await expect(host.getByTestId("stop-results")).toBeVisible({ timeout: 12_000 });
    await expect(guest.getByTestId("stop-results")).toBeVisible();
    await expect(guest.getByTestId("stop-waiting-host")).toBeVisible();
    await shoot(host, "4-results");

    // Exactly one answer zeroed by the single NONSENSE vote; the late
    // grace-period answer counted.
    const breakdown = host.getByTestId("stop-breakdown");
    await expect(breakdown.getByTestId("stop-result-invalid")).toHaveCount(1);
    await expect(breakdown).toContainText(`${letter}late`);
    await expect(host.getByTestId("stop-results")).toContainText(`+${n * 10}`);
    await expect(host.getByTestId("stop-results")).toContainText(`+${(n - 1) * 10}`);

    // ── Round 2: fresh, empty form everywhere ──
    await host.getByTestId("stop-next-round").click();
    for (const page of room.pages) {
      await expect(page.getByTestId("stop-game")).toHaveAttribute("data-round", "2");
      await expect(page.getByTestId("stop-answer-0")).toBeVisible();
    }
    // Give any stale hydrate/debounce a chance to (wrongly) refill.
    await host.waitForTimeout(1_200);
    for (const page of room.pages) {
      const inputs = page.locator('[data-testid^="stop-answer-"]');
      const count = await inputs.count();
      for (let i = 0; i < count; i++) await expect(inputs.nth(i)).toHaveValue("");
    }
    await offLetterRound(room);

    // ── Round 3 (last) ──
    await host.getByTestId("stop-next-round").click();
    await expect(host.getByTestId("stop-game")).toHaveAttribute("data-round", "3");
    await offLetterRound(room);

    // Final round's standings are shown before the game ends…
    await expect(host.getByTestId("stop-results-title")).toBeVisible();
    await expect(host.getByTestId("stop-finish")).toBeVisible();
    await shoot(host, "5-final");
    // …then the session results screen takes over.
    await host.getByTestId("stop-finish").click();
    await expect(host.getByTestId("results-vote-next")).toBeVisible({ timeout: 20_000 });
  } finally {
    await room.cleanup();
  }
});
