import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

// Phone-viewport smoke: the layouts must fit a 390px screen with no sideways
// scroll. scrollWidth counts clipped overflow too, so this catches oversized
// elements even though html/body clip them.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

async function expectNoHorizontalOverflow(page: Page, label: string) {
  const { scrollW, innerW } = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
  }));
  expect(scrollW, `${label}: content wider than viewport (${scrollW} > ${innerW})`).toBeLessThanOrEqual(innerW + 1);
}

test("phone: home and green room fit the screen", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("create-room")).toBeVisible();
  await expectNoHorizontalOverflow(page, "home");

  await page.getByTestId("nick-input").fill("Phone");
  await page.getByTestId("create-room").click();
  await page.waitForURL(/\/room\/.+/);

  await expect(page.getByTestId("room-code")).toBeVisible();
  // Playlist cards render 2-up on phones; all 7 present and tappable.
  await expect(page.getByTestId("game-card-stop")).toBeVisible();
  await expect(page.getByTestId("game-card-garticphone")).toBeVisible();
  await expect(page.getByTestId("ready-up")).toBeVisible();
  await expectNoHorizontalOverflow(page, "green room");
});
