import { test as guarded } from "./fixtures";
import { test, expect, type Page } from "@playwright/test";
import { openRoom, startGame, type Room } from "./helpers";

// Gartic (draw & guess), 2 players, played to the session results screen.
// Guards the audit regressions:
//  - live strokes reach the guesser BEFORE the drawer lifts the pointer,
//  - drawer undo leaves the guesser's canvas identical (no drift),
//  - a near-miss guess is never shown verbatim to anyone else,
//  - punctuation / case / plural variants of the word are accepted,
//  - every turn reveals the word and the game finishes into results.

const SHOTS = process.env.GARTIC_SHOTS_DIR;

async function roles(room: Room): Promise<{ drawer: Page; guesser: Page; word: string }> {
  let drawer: Page | undefined;
  let guesser: Page | undefined;
  // Wait until one page shows the secret word (a new turn may still be loading).
  await expect
    .poll(async () => {
      for (const page of room.pages) {
        if (await page.getByTestId("gartic-secret-word").isVisible().catch(() => false)) return true;
      }
      return false;
    }, { timeout: 20_000 })
    .toBe(true);
  for (const page of room.pages) {
    if (await page.getByTestId("gartic-secret-word").isVisible().catch(() => false)) drawer = page;
    else guesser = page;
  }
  expect(drawer, "one page must be the drawer").toBeTruthy();
  expect(guesser, "one page must be the guesser").toBeTruthy();
  const word = (await drawer!.getByTestId("gartic-secret-word").textContent())!.trim();
  expect(word.length).toBeGreaterThan(0);
  return { drawer: drawer!, guesser: guesser! , word };
}

/** Count clearly non-paper pixels on a page's game canvas. */
async function inkedPixels(page: Page): Promise<number> {
  return page.getByTestId("drawing-canvas").evaluate((el) => {
    const canvas = el as HTMLCanvasElement;
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      // Paper is #fff8e7; ink defaults to #131320.
      if (data[i] < 128 && data[i + 1] < 128 && data[i + 2] < 128) n++;
    }
    return n;
  });
}

async function guess(page: Page, text: string) {
  await page.getByTestId("gartic-guess-input").fill(text);
  await page.getByTestId("gartic-guess-submit").click();
}

/** A one-letter typo of the word (never a valid plural/singular of it). */
function nearMiss(word: string): string {
  const i = Math.floor(word.length / 2);
  const swap = word[i].toLowerCase() === "x" ? "q" : "x";
  return word.slice(0, i) + swap + word.slice(i + 1);
}

guarded("gartic: live strokes, private near misses, plural answers, plays to results", async ({ browser }) => {
  test.setTimeout(240_000);
  const room = await openRoom(browser, 2);
  try {
    await startGame(room, "gartic");
    const { drawer, guesser, word } = await roles(room);

    // Guessers get a letter mask, never the word.
    const mask = (await guesser.getByTestId("gartic-mask").textContent()) ?? "";
    expect(mask).not.toContain(word);
    expect(mask.replace(/\s/g, "")).toMatch(/^[_\p{L}-]+$/u);

    // ---- live strokes: visible on the guesser before pointer-up ----
    const canvas = drawer.getByTestId("drawing-canvas");
    await canvas.scrollIntoViewIfNeeded();
    const box = (await canvas.boundingBox())!;
    expect(await inkedPixels(guesser)).toBe(0);
    await drawer.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
    await drawer.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await drawer.mouse.move(box.x + box.width * (0.2 + i * 0.04), box.y + box.height * (0.3 + i * 0.02));
    }
    await expect.poll(() => inkedPixels(guesser), { timeout: 5_000 }).toBeGreaterThan(200);
    await drawer.mouse.up();
    // After the stroke completes both canvases match closely.
    const drawerInk = await inkedPixels(drawer);
    await expect.poll(() => inkedPixels(guesser)).toBeGreaterThan(drawerInk * 0.9);

    // ---- undo stays in sync: the guesser's canvas goes back to blank ----
    await drawer.getByTestId("canvas-undo").click();
    await expect.poll(() => inkedPixels(drawer)).toBe(0);
    await expect.poll(() => inkedPixels(guesser)).toBe(0);
    // A bucket fill reaches the guesser too (fast scanline fill).
    await drawer.getByTestId("canvas-tool-fill").click();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
    await expect.poll(() => inkedPixels(guesser)).toBeGreaterThan(100_000);
    await drawer.getByTestId("canvas-undo").click();
    await expect.poll(() => inkedPixels(guesser)).toBe(0);

    if (SHOTS) {
      await drawer.getByTestId("canvas-tool-brush").click();
      await drawer.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.6);
      await drawer.mouse.down();
      for (let i = 1; i <= 10; i++) await drawer.mouse.move(box.x + box.width * (0.3 + i * 0.04), box.y + box.height * 0.6);
      await drawer.mouse.up();
    }

    // ---- wrong guess is public, near miss is private ----
    await guess(guesser, "definitely wrong");
    await expect(drawer.getByTestId("gartic-chat")).toContainText("definitely wrong");
    const miss = nearMiss(word);
    await guess(guesser, miss);
    await expect(guesser.getByTestId("gartic-chat")).toContainText(miss);
    await expect(guesser.getByTestId("gartic-close-hint")).toBeVisible();
    await expect(drawer.getByTestId("gartic-chat")).toContainText(/is close!/i);
    await expect(drawer.getByTestId("gartic-chat")).not.toContainText(miss);
    await expect(drawer.locator("body")).not.toContainText(miss);
    if (SHOTS) {
      await guesser.screenshot({ path: `${SHOTS}/guesser-close.png` });
      await drawer.screenshot({ path: `${SHOTS}/drawer-chat.png` });
    }

    // ---- punctuation + case + plural variant is accepted ----
    await guess(guesser, `  ${word.toUpperCase()}S!! `);
    for (const page of room.pages) {
      await expect(page.getByTestId("gartic-reveal")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId("gartic-revealed-word")).toHaveText(word);
    }
    await expect(drawer.getByTestId("gartic-chat")).toContainText(/guessed it! \(\+100\)/);
    if (SHOTS) await guesser.screenshot({ path: `${SHOTS}/turn-results.png` });

    // ---- play the remaining turns out to the session results ----
    const voteNext = room.host.getByTestId("results-vote-next");
    for (let turn = 0; turn < 6; turn++) {
      let next: "results" | "turn" | null = null;
      await expect
        .poll(async () => {
          if (await voteNext.isVisible().catch(() => false)) next = "results";
          else {
            for (const page of room.pages) {
              if (await page.getByTestId("gartic-secret-word").isVisible().catch(() => false)) next = "turn";
            }
          }
          return next;
        }, { timeout: 30_000 })
        .not.toBeNull();
      if (next === "results") break;
      const r = await roles(room);
      await guess(r.guesser, r.word);
      await expect(r.guesser.getByTestId("gartic-reveal")).toBeVisible({ timeout: 10_000 });
    }
    await expect(voteNext).toBeVisible({ timeout: 30_000 });
  } finally {
    await room.cleanup();
  }
});

async function drawLine(page: Page, yFrac: number) {
  const canvas = page.getByTestId("drawing-canvas");
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * yFrac);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(box.x + box.width * (0.2 + i * 0.05), box.y + box.height * yFrac);
  }
  await page.mouse.up();
}

async function dismissHowTo(page: Page) {
  const gotit = page.getByTestId("howto-gotit");
  if (await gotit.isVisible().catch(() => false)) await gotit.click();
}

// Refreshes mid-turn: a guesser who reloads gets the drawing back (drawer
// snapshot), and a drawer who reloads keeps the turn (server grace) and
// everyone's canvas is resynced to the drawer's blank one.
guarded("gartic: refresh mid-turn keeps the turn and resyncs canvases", async ({ browser }) => {
  test.setTimeout(120_000);
  const room = await openRoom(browser, 2);
  try {
    await startGame(room, "gartic");
    const { drawer, guesser, word } = await roles(room);

    await drawLine(drawer, 0.4);
    await expect.poll(() => inkedPixels(guesser)).toBeGreaterThan(200);

    await guesser.reload();
    await expect(guesser.getByTestId("game-surface")).toBeVisible();
    await dismissHowTo(guesser);
    await expect.poll(() => inkedPixels(guesser), { timeout: 10_000 }).toBeGreaterThan(200);

    await drawer.reload();
    await expect(drawer.getByTestId("game-surface")).toBeVisible();
    await dismissHowTo(drawer);
    // Same turn, same drawer, same word.
    await expect(drawer.getByTestId("gartic-secret-word")).toHaveText(word, { timeout: 10_000 });
    await expect(guesser.getByTestId("gartic-mask")).toBeVisible();
    await expect.poll(() => inkedPixels(guesser), { timeout: 10_000 }).toBe(0);
    await drawLine(drawer, 0.6);
    await expect.poll(() => inkedPixels(guesser)).toBeGreaterThan(200);
  } finally {
    await room.cleanup();
  }
});

// Layout fit: phone, small tile and desktop. Nothing overflows sideways, the
// guess input and the drawer's toolbar are reachable on every size.
guarded("gartic: fits phone, small tile and desktop", async ({ browser }) => {
  test.setTimeout(120_000);
  const room = await openRoom(browser, 2);
  try {
    await startGame(room, "gartic");
    const { drawer, guesser } = await roles(room);
    const sizes = [
      { name: "desktop", width: 1440, height: 900 },
      { name: "phone", width: 390, height: 844 },
      { name: "tile", width: 640, height: 400 },
    ];
    for (const size of sizes) {
      for (const page of [drawer, guesser]) {
        await page.setViewportSize({ width: size.width, height: size.height });
      }
      for (const page of [drawer, guesser]) {
        await page.waitForTimeout(250);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `${size.name}: no sideways scroll`).toBeLessThanOrEqual(1);
      }
      // Guess input: fully inside the viewport horizontally, reachable vertically.
      const input = guesser.getByTestId("gartic-guess-input");
      await input.scrollIntoViewIfNeeded();
      const inputBox = (await input.boundingBox())!;
      const submitBox = (await guesser.getByTestId("gartic-guess-submit").boundingBox())!;
      expect(inputBox.x).toBeGreaterThanOrEqual(0);
      expect(submitBox.x + submitBox.width).toBeLessThanOrEqual(size.width);
      const clear = drawer.getByTestId("canvas-clear");
      await clear.scrollIntoViewIfNeeded();
      const clearBox = (await clear.boundingBox())!;
      expect(clearBox.x + clearBox.width).toBeLessThanOrEqual(size.width);
      if (size.name !== "tile") {
        // Phone + desktop: the drawer's whole toolbox fits without scrolling.
        await drawer.evaluate(() => window.scrollTo(0, 0));
        const toolbar = (await drawer.getByTestId("drawing-toolbar").boundingBox())!;
        expect(toolbar.y + toolbar.height, `${size.name}: toolbar above the fold`).toBeLessThanOrEqual(size.height + 2);
      }
      if (SHOTS) {
        for (const [role, page] of [["drawer", drawer], ["guesser", guesser]] as const) {
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({ path: `${SHOTS}/${size.name}-${role}.png` });
        }
      }
    }
  } finally {
    await room.cleanup();
  }
});

// The drawer's layout flips wide → mid → narrow → wide (crossing the 960 and
// 520 container breakpoints) while drawing: the canvas must keep its pixels
// and its undo history (no remount), and the guesser must keep matching.
guarded("gartic: crossing layout breakpoints never wipes the drawer's canvas", async ({ browser }) => {
  test.setTimeout(120_000);
  const room = await openRoom(browser, 2);
  try {
    await startGame(room, "gartic");
    const { drawer, guesser } = await roles(room);
    const root = drawer.getByTestId("gartic-root");
    await drawer.setViewportSize({ width: 1440, height: 900 });
    await expect(root).toHaveAttribute("data-layout", "wide");

    await drawLine(drawer, 0.3);
    const first = await inkedPixels(drawer);
    expect(first).toBeGreaterThan(200);
    await expect.poll(() => inkedPixels(guesser)).toBeGreaterThan(first * 0.9);

    const sizes = [
      { width: 800, height: 900, layout: "mid" },
      { width: 420, height: 844, layout: "narrow" },
      { width: 1440, height: 900, layout: "wide" },
    ];
    let expected = first;
    for (const [step, size] of sizes.entries()) {
      // Flip the layout in the middle of a stroke: pointer down, move,
      // resize, keep moving, release.
      const canvas = drawer.getByTestId("drawing-canvas");
      await canvas.scrollIntoViewIfNeeded();
      const box = (await canvas.boundingBox())!;
      const y = 0.45 + step * 0.15;
      await drawer.mouse.move(box.x + box.width * 0.2, box.y + box.height * y);
      await drawer.mouse.down();
      for (let i = 1; i <= 5; i++) await drawer.mouse.move(box.x + box.width * (0.2 + i * 0.05), box.y + box.height * y);
      await drawer.setViewportSize({ width: size.width, height: size.height });
      await expect(root).toHaveAttribute("data-layout", size.layout);
      for (let i = 6; i <= 8; i++) await drawer.mouse.move(box.x + box.width * (0.2 + i * 0.05), box.y + box.height * y);
      await drawer.mouse.up();
      await drawer.waitForTimeout(300);

      const drawerInk = await inkedPixels(drawer);
      expect(drawerInk, `${size.layout}: drawer canvas kept its drawing`).toBeGreaterThan(expected);
      expected = drawerInk;
      await expect
        .poll(() => inkedPixels(guesser), { message: `${size.layout}: guesser matches the drawer` })
        .toBeGreaterThan(drawerInk * 0.9);
      expect(await inkedPixels(guesser)).toBeLessThan(drawerInk * 1.1 + 50);
    }

    // The undo history survived every flip: one undo removes only the last
    // stroke on both ends.
    await drawer.getByTestId("canvas-undo").click();
    await expect.poll(() => inkedPixels(drawer)).toBeLessThan(expected);
    const afterUndo = await inkedPixels(drawer);
    expect(afterUndo).toBeGreaterThan(first * 0.9);
    await expect.poll(async () => Math.abs((await inkedPixels(guesser)) - afterUndo)).toBeLessThan(afterUndo * 0.1 + 50);
  } finally {
    await room.cleanup();
  }
});
