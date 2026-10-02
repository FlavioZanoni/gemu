import { defineConfig, devices } from "@playwright/test";

// End-to-end tests drive a real browser against the real stack: a dedicated
// Go server on :8099 and the Next app on :3939 (isolated from the dev ports).
// Both are started by Playwright and torn down after the run. E2E_WS_PORT /
// E2E_WEB_PORT / E2E_DIST_DIR let several runs share a machine.
const WS_PORT = Number(process.env.E2E_WS_PORT) || 8099;
const WEB_PORT = Number(process.env.E2E_WEB_PORT) || 3939;
const DIST_DIR = process.env.E2E_DIST_DIR || ".next-local";

export default defineConfig({
  testDir: "./e2e",
  // Multi-context flows (3 players) plus first-time dev compilation of each
  // game surface run long; keep headroom so slowness never reads as failure.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // Build then run the Go server (embeds decks, so the binary is
      // self-contained). Health-check gates readiness.
      command: `sh -c "go build -o /tmp/gemu-e2e-${WS_PORT} ./cmd/server && WS_ADDR=:${WS_PORT} /tmp/gemu-e2e-${WS_PORT}"`,
      cwd: "../server",
      url: `http://localhost:${WS_PORT}/healthz`,
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: `next dev --port ${WEB_PORT}`,
      cwd: ".",
      url: `http://localhost:${WEB_PORT}`,
      timeout: 120_000,
      // Always boot our own instance on a dedicated port so we never reuse
      // an unrelated dev server that happens to be listening.
      reuseExistingServer: false,
      env: {
        NEXT_PUBLIC_WS_URL: `ws://localhost:${WS_PORT}/ws`,
        NEXT_DIST_DIR: DIST_DIR,
      },
    },
  ],
});
