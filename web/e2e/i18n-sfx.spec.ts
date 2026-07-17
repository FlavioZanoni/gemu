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
