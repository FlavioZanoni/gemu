import { test, expect } from "./fixtures";
import { openRoom, startGame } from "./helpers";

// Multi-player flow: a host creates a room, a second player joins by code, both
// see each other in the green room, and the host starts a game so both land on
// the game surface. Two isolated contexts stand in for two real players.

test("two players meet in the green room and start a game", async ({ browser }) => {
  const room = await openRoom(browser, 2);
  const [host, guest] = room.pages;
  try {
    // Both players see both contestants.
    for (const page of [host, guest]) {
      await expect(page.getByText("Host", { exact: false }).first()).toBeVisible();
      await expect(page.getByText("Guest1", { exact: false }).first()).toBeVisible();
    }

    // Ready both, force Stop, and confirm both land on the surface.
    await startGame(room, "stop");
    await expect(host.getByTestId("game-surface")).toBeVisible();
    await expect(guest.getByTestId("game-surface")).toBeVisible();
  } finally {
    await room.cleanup();
  }
});

test("leaving from the lobby returns home and the room list is fresh", async ({ browser }) => {
  const room = await openRoom(browser, 2);
  const [host, guest] = room.pages;
  try {
    // The guest leaves through the room menu (reachable on every screen).
    await guest.getByTestId("room-menu").click();
    await guest.getByTestId("leave-room").click();
    await guest.waitForURL((url) => !url.pathname.startsWith("/room/"));
    // Home's socket was already open: the public list must still load (it
    // used to sit on "Offline" with no rooms).
    await expect(guest.getByTestId("lobby-status")).toHaveText("Live");
    const roomId = host.url().split("/room/")[1];
    await expect(guest.getByTestId(`public-room-${roomId}`)).toBeVisible();
    // The host sees them go.
    await expect(host.getByTestId("ready-count")).toHaveAttribute("data-total", "1");
  } finally {
    await room.cleanup();
  }
});

test("a kicked player sees why and can go home", async ({ browser }) => {
  const room = await openRoom(browser, 2);
  const [host, guest] = room.pages;
  try {
    await host.getByTestId("kick-Guest1").click();
    await expect(guest.getByTestId("kicked-screen")).toBeVisible();
    await expect(guest.getByText("Voted off the island")).toBeVisible();
    await guest.getByTestId("kicked-home").click();
    await guest.waitForURL((url) => !url.pathname.startsWith("/room/"));
    await expect(guest.getByTestId("create-room")).toBeVisible();
    await expect(host.getByTestId("player-chip-Guest1")).toHaveCount(0);
  } finally {
    await room.cleanup();
  }
});

test("menus close with Escape and return focus", async ({ browser }) => {
  const room = await openRoom(browser, 2);
  const host = room.host;
  try {
    await host.getByTestId("room-menu").click();
    const dialog = host.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // Focus moved inside the dialog.
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await host.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(host.getByTestId("room-menu")).toBeFocused();
  } finally {
    await room.cleanup();
  }
});
