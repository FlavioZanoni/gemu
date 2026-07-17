import { test as base, expect, type Page } from "@playwright/test";

// Console noise from Next dev / the browser that is not an app bug. Keep this
// list tight — the whole point of the guard is to catch real React errors.
const BENIGN = [
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  /\[HMR\]/i,
  /favicon\.ico/i,
  /ResizeObserver loop/i,
];

// Attach a console/pageerror collector to a page. Returns a check() that throws
// if any non-benign error was seen. Use this for pages you create by hand
// (multi-context tests); the `page` fixture below guards itself automatically.
export function attachConsoleGuard(page: Page): () => void {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && !BENIGN.some((r) => r.test(msg.text()))) {
      errors.push(`console.error: ${msg.text()}`);
    }
  });
  page.on("pageerror", (err) => {
    errors.push(`pageerror: ${err.message}`);
  });
  return () => {
    if (errors.length) {
      throw new Error(`Console errors during test:\n${errors.join("\n")}`);
    }
  };
}

// `test` from here fails any single-page test that logs a React/runtime error.
export const test = base.extend<{ consoleGuard: void }>({
  consoleGuard: [
    async ({ page }, use) => {
      const check = attachConsoleGuard(page);
      await use();
      check();
    },
    { auto: true },
  ],
});

export { expect };
