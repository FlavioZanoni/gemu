import { test, expect, type Page } from "@playwright/test";
import { test as guarded } from "./fixtures";
import { openRoom, startGame, type Room } from "./helpers";

// Plays Patently Silly end to end with REAL canvas drawing: problems ->
// assigned someone else's -> draw + title -> pitches (drawing + title must
// render, reactions count) -> funding -> round results. The remaining rounds
// are forced through with the host's advance button (exercising the
// zero-drawing skip and the no-carry-over of inputs) until the platform's
// session results screen appears.

// Optional design-fidelity screenshots: INVENTION_SHOTS=<dir>.
const SHOTS = process.env.INVENTION_SHOTS;
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
  { name: "tile", width: 640, height: 400 },
];

async function shoot(page: Page, label: string) {
  if (!SHOTS) return;
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/inv-${label}-${vp.name}.png`, fullPage: true });
    // Nothing may overflow horizontally at any size.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${label} @ ${vp.name} horizontal overflow`).toBeLessThanOrEqual(1);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

// Real mouse strokes — synthetic PointerEvents don't draw on DrawingCanvas.
async function drawStroke(page: Page) {
  const canvas = page.getByTestId("invention-canvas").locator("canvas");
  await canvas.scrollIntoViewIfNeeded();
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(
      box.x + box.width * (0.2 + i * 0.05),
      box.y + box.height * (0.2 + i * 0.04),
    );
  }
  await page.mouse.up();
}

async function phaseOf(page: Page) {
  return page.getByTestId("invention-game").getAttribute("data-phase");
}

async function expectPhase(room: Room, phase: string) {
  for (const page of room.pages) {
    await expect(page.getByTestId("invention-game")).toHaveAttribute("data-phase", phase, {
      timeout: 15_000,
    });
  }
}

guarded("invention: full game — problems, drawing, pitch, funding, results, session end", async ({ browser }) => {
  test.setTimeout(180_000);
  const room = await openRoom(browser, 2);
  const [host, guest] = room.pages;
  try {
    await startGame(room, "invention");
    await expectPhase(room, "collecting");
    await shoot(host, "collecting");

    // Phase 1: everyone writes two problems (whitespace-only can't submit).
    for (const [i, page] of room.pages.entries()) {
      await page.getByTestId("invention-problem-1").fill("   ");
      await page.getByTestId("invention-problem-2").fill(`Where do lost socks go (${i})`);
      await expect(page.getByTestId("invention-submit-problems")).toBeDisabled();
      await page.getByTestId("invention-problem-1").fill(`How to nap at work (${i})`);
      await page.getByTestId("invention-submit-problems").click();
    }

    // Phase 2: each player is dealt a problem NOT their own, titles it, draws
    // a real stroke, and submits. Nobody sees "waiting" before submitting.
    await expectPhase(room, "drawing");
    await shoot(host, "drawing");
    for (const [i, page] of room.pages.entries()) {
      const assigned = page.getByTestId("invention-assigned");
      await expect(assigned).toContainText(/\(\d\)/);
      await expect(assigned).not.toContainText(`(${i})`);
      await expect(page.getByTestId("invention-title-input")).toBeVisible();
      await page.getByTestId("invention-title-input").fill(`The Fixotron ${i}`);
      await page.getByTestId("invention-tagline-input").fill(`Fixes everything ${i}`);
      await drawStroke(page);
      const submit = page.getByTestId("invention-submit-invention");
      await expect(submit).toBeEnabled({ timeout: 5_000 });
      await submit.click();
    }

    // Phase 3: pitches. Each pitch card shows the title and the drawing as a
    // compressed data: image. The presenter (or host) moves on.
    await expectPhase(room, "presenting");
    await shoot(host, "presenting");
    const seen = new Set<string>();
    for (let pitch = 0; pitch < 2; pitch++) {
      for (const page of room.pages) {
        await expect(page.getByTestId("invention-pitch-title")).toHaveText(/The Fixotron \d/);
        const img = page.getByTestId("invention-pitch-img");
        await expect(img).toBeVisible();
        const src = (await img.getAttribute("src"))!;
        expect(src).toMatch(/^data:image\/(webp|jpeg);base64,/);
        expect(src.length).toBeLessThan(200_000);
        expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
      }
      const title = (await host.getByTestId("invention-pitch-title").textContent())!;
      seen.add(title);
      // The non-presenter reacts; the count reaches everyone.
      const pitcherText = (await host.getByTestId("invention-pitcher").textContent()) ?? "";
      const reactor = /you|você/i.test(pitcherText) ? guest : host;
      await reactor.getByTestId("invention-react-rocket").click();
      for (const page of room.pages) {
        await expect(page.getByTestId("invention-react-rocket")).toContainText("1");
      }
      // Host always has a next button (own pitch or host override).
      if (pitch === 0) {
        // A double tap (both clicks in one task) ends only THIS pitch.
        await host.getByTestId("invention-next-pitch").evaluate((el: HTMLElement) => {
          el.click();
          el.click();
        });
        await expect(host.getByTestId("invention-pitch-title")).not.toHaveText(title);
        await host.waitForTimeout(800);
        await expectPhase(room, "presenting");
      } else {
        await host.getByTestId("invention-next-pitch").click();
      }
    }
    expect(seen.size).toBe(2);

    // Phase 4: funding. Host gives the guest 600 (budget left updates); the
    // guest submits an allocation too.
    await expectPhase(room, "voting");
    await shoot(host, "voting");
    await host.getByTestId("invention-vote-0").fill("600");
    await expect(host.getByTestId("invention-remaining")).toContainText("$400");
    await host.getByTestId("invention-vote-submit").click();
    await guest.getByTestId("invention-vote-0").fill("250");
    await guest.getByTestId("invention-vote-submit").click();

    // Round results: per-inventor funding with drawings, guest leads.
    await expectPhase(room, "results");
    await shoot(host, "results");
    const top = host.getByTestId("invention-result-0");
    await expect(top).toContainText("Fixotron 1");
    await expect(top).toContainText("$600");
    await expect(host.getByTestId("invention-result-1")).toContainText("$250");
    await expect(top.locator("img")).toHaveAttribute("src", /^data:image\//);

    // Round 2: inputs must start empty (no carry-over), then the host forces
    // the phases (collecting -> drawing -> zero drawings skip -> results).
    await host.getByTestId("invention-next-round").click();
    await expectPhase(room, "collecting");
    for (const page of room.pages) {
      await expect(page.getByTestId("invention-problem-1")).toHaveValue("");
      await expect(page.getByTestId("invention-problem-2")).toHaveValue("");
    }
    // A double tap on the host's advance moves exactly one phase.
    await host.getByTestId("invention-host-advance").evaluate((el: HTMLElement) => {
      el.click();
      el.click();
    });
    await expectPhase(room, "drawing");
    await host.waitForTimeout(800);
    await expectPhase(room, "drawing");
    for (let i = 0; i < 12; i++) {
      if (await host.getByTestId("results-vote-next").isVisible().catch(() => false)) break;
      const phase = await phaseOf(host).catch(() => null);
      if (phase === "results") {
        await host.getByTestId("invention-next-round").click().catch(() => {});
      } else if (phase === "collecting" || phase === "drawing" || phase === "voting") {
        if (phase === "drawing") {
          // Fresh round: the title field is empty and nothing reads "filed".
          await expect(host.getByTestId("invention-title-input")).toHaveValue("");
        }
        await host.getByTestId("invention-host-advance").click().catch(() => {});
      }
      await host.waitForTimeout(400);
    }

    // The platform takes over with the session results screen.
    await expect(host.getByTestId("results-vote-next")).toBeVisible({ timeout: 15_000 });
    await shoot(host, "session-results");
  } finally {
    await room.cleanup();
  }
});
