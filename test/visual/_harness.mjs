// test/visual/_harness.mjs — shared chromium boot for the visual + bench scripts.
//
// Both `run.mjs` (visual regression suite) and `bench-pretext.mjs`
// (microbenchmark) need the same setup: launch chromium, build a file://
// URL into `pages/`, navigate, wait for `window.__READY === true` (set by
// each fixture's inline init script). This module is the single source of
// truth for that handshake. ssr-smoke.mjs and no-jquery.mjs don't use
// chromium and don't import from here.

import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PAGES_DIR = path.join(__dirname, 'pages');

export function fixtureURL(name) {
  return pathToFileURL(path.join(PAGES_DIR, name)).toString();
}

/**
 * Launch headless chromium with a fresh context + page. Caller is responsible
 * for closing the returned `browser` (calling `page.close()` is not enough —
 * chromium leaks unless the browser itself is closed).
 */
export async function launchPage({ viewport = { width: 800, height: 600 } } = {}) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  return { browser, page };
}

export async function gotoFixture(page, name) {
  await page.goto(fixtureURL(name));
  await page.waitForFunction(() => window.__READY === true);
}
