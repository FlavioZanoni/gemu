import { test, expect } from "./fixtures";
import { attachConsoleGuard } from "./fixtures";
import type { Browser, FrameLocator, Page } from "@playwright/test";

// Gemu as an awful.chat app (awful-contract v1). A stand-in host page frames
// the app exactly like awful.chat does (sandbox, no referrer) and speaks the
// handshake: it answers `ready` with `hello`, and records what the app sends.

const HOST_URL = "http://awful.test/host";

// The stand-in host is a "public" page framing a localhost app; Chrome's
// local-network-access checks would block that, a real deploy never hits it.
test.use({
  launchOptions: {
    args: ["--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessForNavigations"],
  },
});

const hostPage = (appUrl: string) => `<!doctype html>
<html><head><meta charset="utf-8"><title>awful host</title>
<style>html,body{margin:0;height:100%;background:#000}iframe{border:0;width:100%;height:100%}</style>
</head><body>
<iframe id="app" src="${appUrl}" referrerpolicy="no-referrer"
  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
<script>
  const q = new URLSearchParams(location.search);
  const self = { id: q.get("pid"), name: q.get("name"), color: null };
  window.__fromApp = [];
  const frame = document.getElementById("app");
  window.addEventListener("message", (e) => {
    if (e.source !== frame.contentWindow || !e.data || e.data.awful !== 1) return;
    window.__fromApp.push(e.data.type === "activity" ? "activity:" + e.data.name : e.data.type);
    if (e.data.type === "ready") {
      frame.contentWindow.postMessage({
        awful: 1, type: "hello",
        session: { id: q.get("session"), startedAt: Date.now(), args: q.get("args") || "" },
        self, players: [self], theme: "dark", locale: q.get("locale") || "en-US",
      }, "*");
    }
  });
</script></body></html>`;

async function openInAwful(
  browser: Browser,
  baseURL: string,
  opts: { session: string; pid: string; name: string; locale?: string; args?: string },
): Promise<{ page: Page; app: FrameLocator; check: () => void; close: () => Promise<void> }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const check = attachConsoleGuard(page);
  await page.route(`${HOST_URL}**`, (route) =>
    route.fulfill({ contentType: "text/html", body: hostPage(`${baseURL}/`) }),
  );
  const params = new URLSearchParams({ session: opts.session, pid: opts.pid, name: opts.name });
  if (opts.locale) params.set("locale", opts.locale);
  if (opts.args) params.set("args", opts.args);
  await page.goto(`${HOST_URL}?${params}`);
  return { page, app: page.frameLocator("#app"), check, close: () => ctx.close() };
}

test("the app may be framed by any awful.chat instance", async ({ request }) => {
  const res = await request.get("/");
  expect(res.headers()["content-security-policy"]).toContain("frame-ancestors *");
  expect(res.headers()["x-frame-options"]).toBeUndefined();
});

test("everyone opening one awful card lands in the same room", async ({ browser, baseURL }) => {
  const session = `s_${Date.now().toString(36)}`;
  const ana = await openInAwful(browser, baseURL!, {
    session,
    pid: "p_ana",
    name: "Ana",
    locale: "pt-BR",
  });
  const bo = await openInAwful(browser, baseURL!, { session, pid: "p_bo", name: "Ana" });
  try {
    // Straight into the green room: no nickname form, the host's name is used.
    const anaCode = ana.app.getByTestId("room-code");
    await expect(anaCode).toBeVisible({ timeout: 20_000 });
    const code = await anaCode.getAttribute("data-code");

    const boCode = bo.app.getByTestId("room-code");
    await expect(boCode).toBeVisible({ timeout: 20_000 });
    expect(await boCode.getAttribute("data-code")).toBe(code);

    // Same awful name twice: the second seat is suffixed, not refused.
    await expect(ana.app.getByText("Ana 2").first()).toBeVisible();

    // The first opener hosts; the host's locale came from hello.
    await expect(ana.app.getByTestId("start-game")).toBeVisible();
    await expect(bo.app.getByTestId("start-game")).toHaveCount(0);

    // Reloading the tile is a rejoin into the same seat, not a new player.
    await ana.page.reload();
    await expect(ana.app.getByTestId("room-code")).toHaveAttribute("data-code", code!, {
      timeout: 20_000,
    });
    await expect(ana.app.getByTestId("start-game")).toBeVisible();
    await expect(bo.app.getByTestId("ready-count")).toHaveText("0 ready / 2");
    await expect(bo.app.getByText("Ana 3")).toHaveCount(0);

    // A different card is a different room.
    const cy = await openInAwful(browser, baseURL!, { session: `${session}x`, pid: "p_cy", name: "Cy" });
    try {
      const cyCode = cy.app.getByTestId("room-code");
      await expect(cyCode).toBeVisible({ timeout: 20_000 });
      expect(await cyCode.getAttribute("data-code")).not.toBe(code);
      cy.check();
    } finally {
      await cy.close();
    }

    // The app said `ready` and nothing secret-looking beyond protocol types.
    const sent = await ana.page.evaluate(() => (window as unknown as { __fromApp: string[] }).__fromApp);
    expect(sent).toContain("ready");
    // Between games the activity is just the app; reloading re-announces it.
    expect(sent.filter((m) => m.startsWith("activity:")).at(-1)).toBe("activity:Gemu");

    // Both frames can play: start a game and both reach the game surface.
    await ana.app.getByTestId("ready-up").click();
    await bo.app.getByTestId("ready-up").click();
    await ana.app.getByTestId("start-game").click();
    // Drumroll → intro; once both tap GOT IT the game starts by itself.
    await ana.app.getByTestId("intro-ready").click({ timeout: 20_000 });
    await bo.app.getByTestId("intro-ready").click({ timeout: 20_000 });
    await expect(ana.app.getByTestId("game-surface")).toBeVisible({ timeout: 20_000 });
    await expect(bo.app.getByTestId("game-surface")).toBeVisible({ timeout: 20_000 });
    // While playing, the host is told the game's name — and nothing else.
    await expect
      .poll(() =>
        ana.page.evaluate(() =>
          (window as unknown as { __fromApp: string[] }).__fromApp.filter((m) => m.startsWith("activity:")).at(-1),
        ),
      )
      .toMatch(/^activity:(?!Gemu$).+/);

    ana.check();
    bo.check();
  } finally {
    await ana.close();
    await bo.close();
  }
});

test("args with a room code join that existing room", async ({ browser, baseURL }) => {
  // A room made the normal way...
  const ctx = await browser.newContext();
  const host = await ctx.newPage();
  await host.goto("/");
  await host.getByTestId("nick-input").fill("Host");
  await host.getByTestId("create-room").click();
  await host.getByTestId("create-room-confirm").click();
  await host.waitForURL(/\/room\/.+/);
  const code = await host.getByTestId("room-code").getAttribute("data-code");

  // ...joined from awful with `/app <url> CODE`.
  const di = await openInAwful(browser, baseURL!, {
    session: `s_args_${Date.now().toString(36)}`,
    pid: "p_di",
    name: "Di",
    args: code!,
  });
  try {
    await expect(di.app.getByTestId("room-code")).toHaveAttribute("data-code", code!, {
      timeout: 20_000,
    });
    await expect(host.getByText("Di").first()).toBeVisible();
    di.check();
  } finally {
    await di.close();
    await ctx.close();
  }
});
