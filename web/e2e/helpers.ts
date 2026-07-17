import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { attachConsoleGuard } from "./fixtures";

export const ALL_GAMES = [
  "stop",
  "gartic",
  "garticphone",
  "cah",
  "trivia",
  "fibber",
  "invention",
] as const;
export type GameType = (typeof ALL_GAMES)[number];

// Per-game minimum players (mirrors lib/games.ts). Games not listed need 2.
export const MIN_PLAYERS: Record<string, number> = {
  garticphone: 3,
  cah: 3,
  fibber: 3,
};

export async function createRoom(page: Page, nick: string): Promise<string> {
  await page.goto("/");
  await page.getByTestId("nick-input").fill(nick);
  await page.getByTestId("create-room").click();
  await page.waitForURL(/\/room\/.+/);
  const code = await page.getByTestId("room-code").getAttribute("data-code");
  expect(code, "room code should be present").toBeTruthy();
  return code!;
}

export async function joinByCode(page: Page, nick: string, code: string) {
  await page.goto("/");
  await page.getByTestId("nick-input").fill(nick);
  await page.getByTestId("join-code-input").fill(code);
  await page.getByTestId("join-room-btn").click();
  await page.waitForURL(/\/room\/.+/);
}

// Deselect every playlist card except `keep`, forcing the random first pick to
// be that one game. The last remaining card can't be removed, so keep is safe.
export async function keepOnly(host: Page, keep: GameType) {
  for (const type of ALL_GAMES) {
    if (type === keep) continue;
    const card = host.getByTestId(`game-card-${type}`);
    if ((await card.getAttribute("data-selected")) === "true") {
      await card.click();
    }
  }
  await expect(host.getByTestId(`game-card-${keep}`)).toHaveAttribute(
    "data-selected",
    "true",
  );
}

export interface Room {
  pages: Page[];
  host: Page;
  guests: Page[];
  contexts: BrowserContext[];
  code: string;
  /** Close all contexts, then throw if any page logged a console error. */
  cleanup: () => Promise<void>;
}

// Spin up `count` isolated players (separate contexts => separate WS
// connections), host creates a room, the rest join by code. Nobody is ready yet.
export async function openRoom(browser: Browser, count: number): Promise<Room> {
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  const guards: (() => void)[] = [];
  for (let i = 0; i < count; i++) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    contexts.push(ctx);
    pages.push(page);
    guards.push(attachConsoleGuard(page));
  }
  const [host, ...guests] = pages;
  const code = await createRoom(host, "Host");
  for (let i = 0; i < guests.length; i++) {
    await joinByCode(guests[i], `Guest${i + 1}`, code);
  }
  const cleanup = async () => {
    const errs: string[] = [];
    for (const g of guards) {
      try {
        g();
      } catch (e) {
        errs.push((e as Error).message);
      }
    }
    for (const c of contexts) await c.close();
    if (errs.length) throw new Error(errs.join("\n\n"));
  };
  return { pages, host, guests, contexts, code, cleanup };
}

// Ready everyone and force the room into `game`, landing all players on the
// game surface. Returns the same Room handle.
export async function startGame(room: Room, game: GameType): Promise<Room> {
  await keepOnly(room.host, game);
  for (const page of room.pages) await page.getByTestId("ready-up").click();
  const n = room.pages.length;
  await expect(room.host.getByText(`${n}/${n}`)).toBeVisible();
  await room.host.getByTestId("start-game").click();
  // Start opens a how-to modal only when the next game is already resolved; the
  // first (random) game can start directly. Handle both: wait for whichever of
  // the modal or the surface appears, dismiss the modal if it's the one.
  const gotit = room.host.getByTestId("howto-gotit");
  await Promise.race([
    gotit.waitFor({ state: "visible" }),
    room.host.getByTestId("game-surface").waitFor({ state: "visible" }),
  ]);
  if (await gotit.isVisible()) await gotit.click();
  for (const page of room.pages) {
    await expect(page.getByTestId("game-surface")).toBeVisible();
  }
  return room;
}

// Drive a running Trivia game to the results screen. Every player answers each
// round (answer correctness is irrelevant); the option button's built-in
// actionability wait naturally rides out the ~6s reveal between rounds. Returns
// when the host sees the results actions. Trivia defaults to 8 rounds, so this
// takes ~50s — give callers a generous per-test timeout.
export async function playTriviaToResults(room: Room) {
  const voteNext = room.host.getByTestId("results-vote-next");
  for (let round = 0; round < 12; round++) {
    if (await voteNext.isVisible().catch(() => false)) return;
    const opt0 = room.host.getByTestId("trivia-option-0");
    // Next question answerable, or the game finished into results.
    await Promise.race([
      expect(opt0).toBeEnabled({ timeout: 15_000 }),
      voteNext.waitFor({ state: "visible", timeout: 15_000 }),
    ]).catch(() => {});
    if (await voteNext.isVisible().catch(() => false)) return;
    for (const page of room.pages) {
      await page.getByTestId("trivia-option-0").click({ timeout: 15_000 }).catch(() => {});
    }
  }
  await expect(voteNext).toBeVisible();
}
