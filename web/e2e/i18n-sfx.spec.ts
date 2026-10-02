import { test, expect } from "./fixtures";

// Language toggle swaps the copy; the SFX mute toggle persists across reloads.

test("switching to PT-BR translates the home copy", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("One room. A playlist of games.")).toBeVisible();

  await page.getByRole("button", { name: "PT-BR" }).click();
  await expect(page.getByText("Uma sala. Uma playlist de jogos.")).toBeVisible();
});

test("muting sound persists across a reload", async ({ page }) => {
  await page.goto("/");
  const toggle = page.getByTestId("sfx-toggle");

  // Starts unmuted.
  await expect(toggle).toHaveAttribute("aria-label", /^Mute/);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-label", /^Unmute/);

  await page.reload();
  await expect(page.getByTestId("sfx-toggle")).toHaveAttribute("aria-label", /^Unmute/);
});

test("a room created in PT-BR is a pt-BR room (game content language)", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "PT-BR" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  await page.getByTestId("nick-input").fill("Ana");
  await page.getByTestId("create-room").click();
  await page.getByTestId("create-room-confirm").click();
  await page.waitForURL(/\/room\/.+/);
  await expect(page.getByTestId("lobby")).toHaveAttribute("data-room-locale", "pt-BR");
  await expect(page.getByText("Playlist da noite")).toBeVisible();
});
