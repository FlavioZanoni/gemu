import { test, expect } from "./fixtures";
import { createRoom } from "./helpers";
import type { Page } from "@playwright/test";

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

test("a saved room that no longer exists shows OFF AIR, not a frozen room", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() =>
    localStorage.setItem(
      "gemu:last-room",
      JSON.stringify({ roomId: "gone-room", displayName: "Ghost", avatarUrl: "", joinCode: "ABC234" }),
    ),
  );
  await page.goto("/room/gone-room");
  await expect(page.getByTestId("offair-screen")).toBeVisible();
  await expect(page.getByText("ABC234")).toBeVisible();
  await page.getByTestId("offair-home").click();
  await expect(page.getByTestId("create-room")).toBeVisible();
});

async function createLockedRoom(host: Page, password: string) {
  await host.goto("/");
  await host.getByTestId("nick-input").fill("Host");
  await host.getByTestId("create-room").click();
  await host.getByTestId("create-password").fill(password);
  await host.getByTestId("create-room-confirm").click();
  await host.waitForURL(/\/room\/.+/);
  const code = await host.getByTestId("room-code").getAttribute("data-code");
  return { code: code!, roomId: host.url().split("/room/")[1].split("?")[0] };
}

test("a password room joined by code asks for the password, rejects a wrong one, then lets you in", async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();
  try {
    const { code } = await createLockedRoom(host, "sesame");

    await guest.goto("/");
    await guest.getByTestId("nick-input").fill("Guest");
    await guest.getByTestId("join-code-input").fill(code);
    await guest.getByTestId("join-room-btn").click();

    // No password sent yet: the server refuses and home asks for it.
    const sheet = guest.getByTestId("password-sheet");
    await expect(sheet).toBeVisible();
    await sheet.getByTestId("join-password-input").fill("nope");
    await sheet.getByTestId("join-password-submit").click();
    await expect(sheet.getByTestId("join-password-error")).toBeVisible();
    await expect(guest).not.toHaveURL(/\/room\//);

    await sheet.getByTestId("join-password-input").fill("sesame");
    await sheet.getByTestId("join-password-submit").click();
    await guest.waitForURL(/\/room\/.+/);
    await expect(guest.getByTestId("room-code")).toHaveAttribute("data-code", code);
    await expect(host.getByTestId("ready-count")).toHaveAttribute("data-total", "2");

    // The password is remembered for this seat: a reload rejoins silently.
    await guest.reload();
    await expect(guest.getByTestId("room-code")).toBeVisible();
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});

test("tapping a locked public room asks for its password before joining", async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();
  try {
    const { roomId } = await createLockedRoom(host, "opensesame");

    await guest.goto("/");
    await guest.getByTestId("nick-input").fill("Lurker");
    await guest.getByTestId(`public-join-${roomId}`).click();
    const sheet = guest.getByTestId("password-sheet");
    await expect(sheet).toBeVisible();
    // Escape backs out without joining.
    await guest.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(guest).not.toHaveURL(/\/room\//);

    await guest.getByTestId(`public-join-${roomId}`).click();
    await sheet.getByTestId("join-password-input").fill("opensesame");
    await sheet.getByTestId("join-password-submit").click();
    await guest.waitForURL(new RegExp(`/room/${roomId}`));
    await expect(host.getByTestId("ready-count")).toHaveAttribute("data-total", "2");
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});
