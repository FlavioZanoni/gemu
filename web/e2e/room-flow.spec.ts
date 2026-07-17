import { test, expect, type Page } from "@playwright/test";

// Multi-player flow: a host creates a room, a second player joins by code,
// both see each other in the green room, and the host force-starts a game
// so both land on the game surface. Two isolated browser contexts stand in
// for two real players (separate JS realms => separate WS connections).

async function hostCreatesRoom(page: Page, nick: string): Promise<string> {
  await page.goto("/");
  await page.getByTestId("nick-input").fill(nick);
  await page.getByTestId("create-room").click();
  await page.waitForURL(/\/room\/.+/);
  const code = await page.getByTestId("room-code").getAttribute("data-code");
  expect(code).toBeTruthy();
  return code!;
}

async function joinByCode(page: Page, nick: string, code: string) {
  await page.goto("/");
  await page.getByTestId("nick-input").fill(nick);
  await page.getByTestId("join-code-input").fill(code);
  await page.getByTestId("join-room-btn").click();
  await page.waitForURL(/\/room\/.+/);
}

test("two players meet in the green room and start a game", async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  try {
    const code = await hostCreatesRoom(host, "Host");
    await joinByCode(guest, "Guest", code);

    // Both players see both contestants.
    for (const page of [host, guest]) {
      await expect(page.getByText("Host", { exact: false }).first()).toBeVisible();
      await expect(page.getByText("Guest", { exact: false }).first()).toBeVisible();
    }

    // Trim the playlist to a single 2-player game so the random first pick is
    // deterministic and startable with two players. The last game can't be
    // removed, so we deselect everything except Stop.
    for (const type of ["gartic", "garticphone", "cah", "trivia", "fibber", "invention"]) {
      await host.getByTestId(`game-card-${type}`).click();
    }
    await expect(host.getByTestId("game-card-stop")).toHaveAttribute("data-selected", "true");

    // A non-forced start needs everyone ready. Ready both players and wait for
    // the host's contestant tally to reflect 2/2 (server broadcast landed).
    await host.getByTestId("ready-up").click();
    await guest.getByTestId("ready-up").click();
    await expect(host.getByText("2/2")).toBeVisible();

    // Host starts: the how-to modal appears, then "got it" kicks off the game.
    await host.getByTestId("start-game").click();
    await host.getByTestId("howto-gotit").click();

    // Both players land on the game surface.
    await expect(host.getByTestId("game-surface")).toBeVisible();
    await expect(guest.getByTestId("game-surface")).toBeVisible();
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});
