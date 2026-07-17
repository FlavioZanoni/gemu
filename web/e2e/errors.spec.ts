import { test, expect } from "./fixtures";
import { createRoom } from "./helpers";

// Join-side error handling: the server returns codes; these prove the user
// actually sees a message and stays put instead of navigating into a room.

test("joining with a bogus code shows an error and stays home", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nick-input").fill("Nobody");
  await page.getByTestId("join-code-input").fill("ZZZZZZ");
  await page.getByTestId("join-room-btn").click();

  await expect(page.getByTestId("home-join-error")).toBeVisible();
  await expect(page).toHaveURL(/\/$|\/\?/); // still on home, not /room/...
});

test("a duplicate nickname is rejected when joining", async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const dupeCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const dupe = await dupeCtx.newPage();
  try {
    const code = await createRoom(host, "Twin");

    await dupe.goto("/");
    await dupe.getByTestId("nick-input").fill("Twin"); // same name as host
    await dupe.getByTestId("join-code-input").fill(code);
    await dupe.getByTestId("join-room-btn").click();

    await expect(dupe.getByTestId("home-join-error")).toBeVisible();
    await expect(dupe).not.toHaveURL(/\/room\//);
  } finally {
    await hostCtx.close();
    await dupeCtx.close();
  }
});
