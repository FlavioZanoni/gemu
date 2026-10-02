import { test as guarded } from "./fixtures";
import { test, expect, type Page } from "@playwright/test";
import { openRoom, startGame, type Room } from "./helpers";

// Full Gartic Phone night with 3 players: everyone writes a prompt, draws the
// prompt they receive, describes the drawing they receive, then the host paces
// the reveal. Guards the reveal regressions: every chain's LAST entry (the
// punchline) is shown, reactions on the newest entry score for its author, and
// the host's FINISH press ends the game into the session results screen.

// Real mouse strokes — synthetic PointerEvents don't draw on DrawingCanvas.
async function drawStroke(page: Page) {
  const canvas = page.locator("canvas").first();
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas has no box");
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(
      box.x + box.width * (0.2 + i * 0.05),
      box.y + box.height * (0.2 + i * 0.04),
    );
  }
  await page.mouse.up();
}

async function everyoneSubmits(
  room: Room,
  action: (page: Page, i: number) => Promise<void>,
) {
  for (let i = 0; i < room.pages.length; i++) {
    await action(room.pages[i], i);
  }
}

guarded(
  "garticphone: prompt, draw, describe, react, reveal every punchline, finish to results",
  async ({ browser }) => {
    test.slow();
    const room = await openRoom(browser, 3);
    try {
      await startGame(room, "garticphone");

      // Step 1/3: prompts. Whitespace-only can't be locked in.
      await expect(room.host.getByTestId("garticphone-step")).toContainText(
        "1/3",
      );
      await room.host.getByTestId("garticphone-prompt-input").fill("   ");
      await expect(
        room.host.getByTestId("garticphone-prompt-submit"),
      ).toBeDisabled();
      await everyoneSubmits(room, async (page, i) => {
        await page
          .getByTestId("garticphone-prompt-input")
          .fill(`a capybara doing thing ${i + 1}`);
        await page.getByTestId("garticphone-prompt-submit").click();
      });

      // Step 2/3: drawing the received prompt (numbered after the prompt step).
      await everyoneSubmits(room, async (page, i) => {
        await page
          .getByTestId("garticphone-submit-drawing")
          .waitFor({ timeout: 15_000 });
        await expect(page.getByTestId("garticphone-step")).toContainText("2/3");
        await expect(page.getByTestId("garticphone-draw-prompt")).toContainText(
          "a capybara doing thing",
        );
        await drawStroke(page);
        await page.getByTestId("garticphone-submit-drawing").click();
        // The last submitter advances the step instead of waiting.
        if (i < room.pages.length - 1)
          await expect(page.getByTestId("garticphone-waiting")).toBeVisible();
      });

      // Step 3/3: describing the received drawing — it must arrive as a real
      // (compressed) image, not be dropped.
      await everyoneSubmits(room, async (page, i) => {
        await page
          .getByTestId("garticphone-description-input")
          .waitFor({ timeout: 15_000 });
        await expect(page.getByTestId("garticphone-step")).toContainText("3/3");
        const img = page
          .getByTestId("garticphone-describe-drawing")
          .locator("img");
        await expect(img).toHaveAttribute(
          "src",
          /^data:image\/(webp|jpeg);base64,/,
        );
        await page
          .getByTestId("garticphone-description-input")
          .fill(`something odd ${i + 1}`);
        await page.getByTestId("garticphone-description-submit").click();
      });

      // Reveal: opens on chain 1 with its prompt already showing.
      const reveal = room.host.getByTestId("garticphone-reveal");
      await expect(reveal).toBeVisible({ timeout: 15_000 });
      await expect(reveal).toHaveAttribute("data-chain", "0");
      await expect(reveal).toHaveAttribute("data-revealed", "1");

      const next = room.host.getByTestId("garticphone-reveal-next");
      const maxRevealed = new Map<string, number>();
      let reactions = 0;
      for (let press = 0; press < 20; press++) {
        const chain = (await reveal.getAttribute("data-chain"))!;
        const revealed = Number(await reveal.getAttribute("data-revealed"));
        maxRevealed.set(chain, Math.max(maxRevealed.get(chain) ?? 0, revealed));

        // Every guest reacts to the newest entry unless it's their own.
        for (const guest of room.guests) {
          await expect(guest.getByTestId("garticphone-reveal")).toHaveAttribute(
            "data-revealed",
            String(revealed),
          );
          const laugh = guest.getByTestId("garticphone-react-laugh");
          if (await laugh.isEnabled()) {
            await laugh.click();
            await expect(laugh).toHaveAttribute("data-chosen", "true");
            reactions++;
          }
        }

        if ((await next.getAttribute("data-finish")) === "true") break;
        if (press === 0) {
          // A double tap (two clicks in one task, so no state can land in
          // between) advances the reveal exactly once.
          await next.evaluate((el: HTMLElement) => {
            el.click();
            el.click();
          });
          await expect(reveal).toHaveAttribute("data-revealed", "2");
          await room.host.waitForTimeout(800);
          await expect(reveal).toHaveAttribute("data-chain", "0");
          await expect(reveal).toHaveAttribute("data-revealed", "2");
          continue;
        }
        await next.click();
        // Wait for the press to land (chain or revealed count changes).
        await expect
          .poll(
            async () =>
              `${await reveal.getAttribute("data-chain")}|${await reveal.getAttribute("data-revealed")}`,
          )
          .not.toBe(`${chain}|${revealed}`);
      }
      expect(reactions).toBeGreaterThan(0);

      // Every chain was shown down to its punchline (3 entries each) and the
      // host's control is still there for the final press.
      expect([...maxRevealed.keys()].sort()).toEqual(["0", "1", "2"]);
      for (const [chain, n] of maxRevealed)
        expect(n, `chain ${chain} punchline`).toBe(3);
      await expect(next).toHaveAttribute("data-finish", "true");
      await expect(next).toContainText("FINISH");
      await next.click();

      // The room reaches the session results with likes scored for someone.
      await expect(room.host.getByTestId("results-vote-next")).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        room.host.getByText(/\b[1-9]\d* (pts|pontos)/i).first(),
      ).toBeVisible();
    } finally {
      await room.cleanup();
    }
  },
);
