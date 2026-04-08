// Quick smoke test: launch chromium, load one fixture, dump positions.
// Used to debug the visual suite when `playwright test` produces no output.

import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureURL = pathToFileURL(path.join(__dirname, 'pages', 'basic.html')).toString();

console.log('launching browser...');
const browser = await chromium.launch({ headless: true });
console.log('launched, version=', browser.version());
const ctx = await browser.newContext();
const page = await ctx.newPage();
console.log('navigating to', fixtureURL);
await page.goto(fixtureURL);
await page.waitForFunction(() => window.__READY === true);

const positions = await page.evaluate(() => {
  const items = document.querySelectorAll('#basic-layout-top-left .item');
  return Array.from(items).map(el => ({
    left: el.style.left,
    top: el.style.top,
  }));
});
console.log('positions:', JSON.stringify(positions, null, 2));

await browser.close();
console.log('done');
