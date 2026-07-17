import { test, expect } from "@playwright/test";

// Smoke tests for the ticket-booth home screen and the single-player
// create-room path. These run against the real Go server + Next app booted
// by playwright.config.ts.

test("home screen renders the booth", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("GEMU", { exact: true })).toBeVisible();
  await expect(page.getByTestId("nick-input")).toBeVisible();
  await expect(page.getByTestId("create-room")).toBeVisible();
  await expect(page.getByTestId("join-code-input")).toBeVisible();
});

test("create a room lands in the green room with a join code", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nick-input").fill("Host");
  await page.getByTestId("create-room").click();

  // Redirects to /room/<id> once the server confirms the room.
  await page.waitForURL(/\/room\/.+/);

  // Green room shows the shareable code and the host's start button.
  const codePill = page.getByTestId("room-code");
  await expect(codePill).toBeVisible();
  await expect(page.getByTestId("start-game")).toBeVisible();

  const code = await codePill.getAttribute("data-code");
  expect(code).toBeTruthy();
  expect(code!.length).toBeGreaterThanOrEqual(4);
});
