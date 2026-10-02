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
  // The create-room sheet (name / visibility / size / password): defaults.
  await page.getByTestId("create-room-confirm").click();
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
// game surface. Returns the same Room handle. Flow: START THE SHOW draws the
// (only) playlist game → drumroll → intro; the host starts it from there.
export async function startGame(room: Room, game: GameType): Promise<Room> {
  await keepOnly(room.host, game);
  for (const page of room.pages) await page.getByTestId("ready-up").click();
  const n = room.pages.length;
  const readyCount = room.host.getByTestId("ready-count");
  await expect(readyCount).toHaveAttribute("data-ready", String(n));
  await expect(readyCount).toHaveAttribute("data-total", String(n));
  await room.host.getByTestId("start-game").click();
  // The intro's start button sits under the drumroll overlay for ~3.5s; the
  // click waits it out. (Older flows went straight to the surface.)
  const introStart = room.host.getByTestId("intro-start");
  await Promise.race([
    introStart.waitFor({ state: "visible", timeout: 20_000 }),
    room.host.getByTestId("game-surface").waitFor({ state: "visible", timeout: 20_000 }),
  ]);
  if (await introStart.isVisible().catch(() => false)) {
    await introStart.click({ timeout: 15_000 }).catch(() => {});
  }
  const gotit = room.host.getByTestId("howto-gotit");
  if (await gotit.isVisible().catch(() => false)) await gotit.click();
  for (const page of room.pages) {
    await expect(page.getByTestId("game-surface")).toBeVisible({ timeout: 15_000 });
    // Games auto-open their own how-to modal on round 1 for every player; it
    // overlays the surface, so dismiss it wherever it appeared.
    const inGameGotit = page.getByTestId("howto-gotit");
    if (await inGameGotit.isVisible().catch(() => false)) {
      await inGameGotit.click();
    }
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

// ---- Connection control (network drops on demand) ----
// installWsControl wraps window.WebSocket in every page of `ctx`: dropConnection
// closes the live sockets and makes every new one hang in CONNECTING (no
// network error, so no console noise); restoreConnection lets the client's own
// reconnect loop through again.
export async function installWsControl(ctx: BrowserContext) {
  await ctx.addInitScript(() => {
    type Ctl = { blocked: boolean; live: WebSocket[]; fakes: EventTarget[] };
    const w = window as unknown as { __gemuWs: Ctl; WebSocket: typeof WebSocket };
    const ctl: Ctl = { blocked: false, live: [], fakes: [] };
    w.__gemuWs = ctl;
    const Real = w.WebSocket;
    class Controlled extends Real {
      constructor(url: string | URL, protocols?: string | string[]) {
        // Only the game server's socket; Next's dev HMR socket stays alone.
        const ours = !String(url).includes("/_next/");
        if (ours && ctl.blocked) {
          const fake = new EventTarget() as EventTarget & Record<string, unknown>;
          fake.readyState = 0;
          fake.url = String(url);
          fake.send = () => {
            throw new DOMException("still connecting", "InvalidStateError");
          };
          fake.close = () => {
            if (fake.readyState === 3) return;
            fake.readyState = 3;
            fake.dispatchEvent(new Event("close"));
          };
          ctl.fakes.push(fake);
          return fake as unknown as Controlled;
        }
        super(url, protocols);
        if (ours) ctl.live.push(this);
      }
    }
    w.WebSocket = Controlled;
  });
}

export async function dropConnection(page: Page) {
  await page.evaluate(() => {
    const ctl = (window as unknown as { __gemuWs: { blocked: boolean; live: WebSocket[] } }).__gemuWs;
    ctl.blocked = true;
    ctl.live.splice(0).forEach((s) => s.close());
  });
}

export async function restoreConnection(page: Page) {
  await page.evaluate(() => {
    const ctl = (window as unknown as {
      __gemuWs: { blocked: boolean; fakes: { close: () => void }[] };
    }).__gemuWs;
    ctl.blocked = false;
    // Fail the hanging attempts: the client schedules a real reconnect.
    ctl.fakes.splice(0).forEach((f) => f.close());
  });
}

/** Counts outgoing WS frames of one message type sent by `page` from now on. */
export function countSentFrames(page: Page, type: string) {
  const counter = { count: 0 };
  page.on("websocket", (ws) => {
    ws.on("framesent", (frame) => {
      const text = typeof frame.payload === "string" ? frame.payload : frame.payload.toString();
      try {
        if ((JSON.parse(text) as { type?: string }).type === type) counter.count += 1;
      } catch {
        // not JSON: not ours
      }
    });
  });
  return counter;
}

/** Silently drops the next `count` outgoing game.action messages whose
 *  payload.action is `action` on this page — the client believes they were
 *  sent (a lost action), the server never sees them. */
export async function dropNextGameAction(page: Page, action: string, count = 1) {
  await page.evaluate(
    ([dropAction, dropCount]) => {
      type Drop = { action: string; left: number };
      const w = window as unknown as { __gemuDrop?: Drop };
      w.__gemuDrop = { action: dropAction, left: dropCount };
      const proto = WebSocket.prototype as WebSocket & { __gemuDropPatched?: boolean };
      if (proto.__gemuDropPatched) return;
      proto.__gemuDropPatched = true;
      const realSend = proto.send;
      proto.send = function send(this: WebSocket, data: Parameters<WebSocket["send"]>[0]) {
        const drop = w.__gemuDrop;
        if (drop && drop.left > 0 && typeof data === "string") {
          try {
            const msg = JSON.parse(data) as { type?: string; payload?: { action?: string } };
            if (msg.type === "game.action" && msg.payload?.action === drop.action) {
              drop.left -= 1;
              return;
            }
          } catch {
            // not JSON: pass through
          }
        }
        return realSend.call(this, data);
      };
    },
    [action, count] as const,
  );
}
