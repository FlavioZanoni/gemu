import { test, expect } from "./fixtures";
import {
  countSentFrames,
  createRoom,
  dropConnection,
  installWsControl,
  openRoom,
  restoreConnection,
  startGame,
} from "./helpers";

// A page reload drops the WebSocket. The store must transparently rejoin using
// the persisted session, so the player stays in the room instead of getting
// bounced back to the join gate — a regression we've paid for before.

test("reloading in the green room keeps you in the room", async ({ browser }) => {
  const room = await openRoom(browser, 2);
  try {
    await expect(room.host.getByTestId("room-code")).toBeVisible();
    const joins = countSentFrames(room.host, "room.join");
    await room.host.reload();
    // Back in the lobby, not the join gate.
    await expect(room.host.getByTestId("room-code")).toBeVisible();
    await expect(room.host.getByTestId("start-game")).toBeVisible();
    // The auto-join went out once (it used to be queued AND re-sent).
    await room.host.waitForTimeout(1000);
    expect(joins.count).toBe(1);
  } finally {
    await room.cleanup();
  }
});

test("reloading mid-game returns to the game surface", async ({ browser }) => {
  const room = await openRoom(browser, 2);
  try {
    await startGame(room, "stop");
    const guest = room.guests[0];
    await guest.reload();
    await expect(guest.getByTestId("game-surface")).toBeVisible();
  } finally {
    await room.cleanup();
  }
});

test("opening the room in a second tab moves the seat there; the first can take it back", async ({ browser }) => {
  const room = await openRoom(browser, 2);
  try {
    const first = room.guests[0];
    const roomUrl = first.url();
    // Same browser profile (same session cookie) → same seat.
    const second = await room.contexts[1].newPage();
    await second.goto(roomUrl);
    await expect(second.getByTestId("room-code")).toBeVisible();
    await expect(first.getByTestId("replaced-screen")).toBeVisible();
    // Still one Guest1 in the room, not two.
    await expect(room.host.getByTestId("ready-count")).toHaveAttribute("data-total", "2");

    // Take it back in the first tab.
    await first.getByTestId("reclaim-room").click();
    await expect(first.getByTestId("room-code")).toBeVisible();
    await expect(second.getByTestId("replaced-screen")).toBeVisible();
    await second.close();
  } finally {
    await room.cleanup();
  }
});

test("a create asked for while offline goes out once when the connection is back", async ({ browser }) => {
  const ctx = await browser.newContext();
  await installWsControl(ctx);
  const page = await ctx.newPage();
  try {
    await page.goto("/");
    await expect(page.getByTestId("lobby-status")).toHaveText("Live");
    const creates = countSentFrames(page, "room.create");
    await dropConnection(page);
    await expect(page.getByTestId("lobby-status")).not.toHaveText("Live");
    await page.getByTestId("nick-input").fill("Offline");
    await page.getByTestId("create-room").click();
    await page.getByTestId("create-room-confirm").click();
    await page.waitForTimeout(800);
    expect(creates.count).toBe(0);
    await restoreConnection(page);
    // Not "connection lost": it never went out, so it's simply sent now.
    await page.waitForURL(/\/room\/.+/);
    await expect(page.getByTestId("room-code")).toBeVisible();
    await page.waitForTimeout(500);
    expect(creates.count).toBe(1);
  } finally {
    await ctx.close();
  }
});

test("a join that timed out offline is not sent later", async ({ browser }) => {
  test.setTimeout(60_000);
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  await installWsControl(guestCtx);
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();
  try {
    const code = await createRoom(host, "Host");
    await guest.goto("/");
    await expect(guest.getByTestId("lobby-status")).toHaveText("Live");
    const joins = countSentFrames(guest, "room.join");
    await dropConnection(guest);
    await guest.getByTestId("nick-input").fill("Late");
    await guest.getByTestId("join-code-input").fill(code);
    await guest.getByTestId("join-room-btn").click();
    // The 15s no-answer timeout gives up on it…
    await expect(guest.getByTestId("home-join-error")).toBeVisible({ timeout: 20_000 });
    await restoreConnection(guest);
    await expect(guest.getByTestId("lobby-status")).toHaveText("Live");
    // …and the reconnect must not sneak it out afterwards.
    await guest.waitForTimeout(1500);
    expect(joins.count).toBe(0);
    await expect(guest).not.toHaveURL(/\/room\//);
    await expect(host.getByTestId("ready-count")).toHaveAttribute("data-total", "1");
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});

test("a game action while disconnected says so instead of vanishing", async ({ browser }) => {
  const room = await openRoom(browser, 2);
  try {
    const guest = room.guests[0];
    await installWsControl(room.contexts[1]);
    await guest.reload(); // picks up the controlled WebSocket
    await expect(guest.getByTestId("room-code")).toBeVisible();
    await startGame(room, "trivia");
    const option = guest.getByTestId("trivia-option-0");
    await expect(option).toBeEnabled({ timeout: 15_000 });

    await dropConnection(guest);
    await expect(guest.getByTestId("banner-reconnecting")).toBeVisible();
    await option.click();
    const toast = guest.getByTestId("action-error");
    await expect(toast).toHaveAttribute("data-code", "not_connected");
    await expect(toast).toContainText("Reconnecting");

    await restoreConnection(guest);
    await expect(guest.getByTestId("banner-reconnecting")).toBeHidden({ timeout: 15_000 });
    await expect(guest.getByTestId("game-surface")).toBeVisible();
  } finally {
    await room.cleanup();
  }
});
