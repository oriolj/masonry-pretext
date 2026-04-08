#!/usr/bin/env node
// test/visual/run.mjs — masonry-pretext visual regression suite.
//
// Custom runner instead of `playwright test` because the upstream test
// runner produces no output in this sandbox (open issue, not yet diagnosed).
// The chromium API itself works fine — see test/visual/smoke.mjs — so this
// runner drives chromium directly: launch once, loop over fixtures, assert
// hardcoded positions for each, take a screenshot, diff against baseline.
//
// Usage:
//   node test/visual/run.mjs                # run, fail on diffs
//   node test/visual/run.mjs --update       # update screenshot baselines
//   node test/visual/run.mjs --filter=basic # run only matching fixtures
//
// See FORK_ROADMAP.md § Methodology, Layer 1 + Layer 2.

import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGES_DIR = path.join(__dirname, 'pages');
const SNAP_DIR = path.join(__dirname, '__screenshots__');

const args = new Set(process.argv.slice(2));
const UPDATE = args.has('--update') || args.has('-u');
const filterArg = [...args].find(a => a.startsWith('--filter='));
const FILTER = filterArg ? filterArg.split('=')[1] : null;

// ─────────────────────────────────────────────────────────────────────────────
// Test cases.
//
// Each case names a fixture HTML file in pages/, the container selector
// inside it, the expected pixel positions of every item, and a screenshot
// label. Position arrays mirror the upstream qunit tests in test/unit/*.js
// but live here because the upstream suite needs bower_components/.
// ─────────────────────────────────────────────────────────────────────────────
const cases = [
  {
    name: 'basic-top-left',
    page: 'basic.html',
    container: '#basic-layout-top-left',
    expected: [
      { left: '0px',   top: '0px'  },
      { left: '60px',  top: '0px'  },
      { left: '120px', top: '0px'  },
      { left: '0px',   top: '30px' },
      { left: '60px',  top: '90px' },
    ],
  },
  {
    name: 'gutter',
    page: 'gutter.html',
    container: '#gutter',
    expected: [
      { left: '0px',   top: '0px'  },
      { left: '80px',  top: '0px'  },
      { left: '160px', top: '0px'  },
      { left: '0px',   top: '30px' },
    ],
  },
  {
    name: 'horizontal-order',
    page: 'horizontal-order.html',
    container: '#horizontal-order',
    expected: Array.from({ length: 9 }, (_, i) => ({
      left: `${(i % 3) * 60}px`,
      // top is content-dependent; assert column only
      top: null,
    })),
  },
  {
    name: 'fit-width',
    page: 'fit-width.html',
    container: '#fit-width',
    // wrap is 160px, columnWidth is 60 → fitWidth derives 2 columns
    // (matches upstream test/unit/fit-width.js, which asserts msnry.cols === 2).
    expected: [
      { left: '0px',  top: '0px'  },
      { left: '60px', top: '0px'  },
      { left: '0px',  top: '30px' },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────────

function fixtureURL(name) {
  return pathToFileURL(path.join(PAGES_DIR, name)).toString();
}

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function readScreenshotPair(actualBuf, baselinePath) {
  const actual = PNG.sync.read(actualBuf);
  const baselineBuf = await readFile(baselinePath);
  const baseline = PNG.sync.read(baselineBuf);
  return { actual, baseline };
}

async function runCase(page, c) {
  await page.goto(fixtureURL(c.page));
  await page.waitForFunction(() => window.__READY === true);

  // ── Layer 1: position assertions ───────────────────────────────────────────
  const positions = await page.evaluate((sel) => {
    return Array.from(document.querySelectorAll(`${sel} .item`)).map(el => ({
      left: el.style.left,
      top: el.style.top,
    }));
  }, c.container);

  if (positions.length !== c.expected.length) {
    return { ok: false, reason: `expected ${c.expected.length} items, got ${positions.length}` };
  }

  for (let i = 0; i < positions.length; i++) {
    const got = positions[i];
    const want = c.expected[i];
    if (want.left !== null && got.left !== want.left) {
      return { ok: false, reason: `item ${i}: left expected ${want.left} got ${got.left}` };
    }
    if (want.top !== null && got.top !== want.top) {
      return { ok: false, reason: `item ${i}: top expected ${want.top} got ${got.top}` };
    }
  }

  // ── Layer 2: screenshot diff ──────────────────────────────────────────────
  await mkdir(SNAP_DIR, { recursive: true });
  const baselinePath = path.join(SNAP_DIR, `${c.name}.png`);
  const actualPath = path.join(SNAP_DIR, `${c.name}.actual.png`);
  const diffPath = path.join(SNAP_DIR, `${c.name}.diff.png`);

  // Clip to the container so the screenshot is independent of body padding.
  const clip = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    return {
      x: Math.floor(r.left),
      y: Math.floor(r.top),
      width: Math.ceil(r.width),
      // include enough vertical room for the tallest items
      height: Math.ceil(r.height + 200),
    };
  }, c.container);

  const actualBuf = await page.screenshot({ clip });

  if (UPDATE || !(await exists(baselinePath))) {
    await writeFile(baselinePath, actualBuf);
    return { ok: true, snapshot: 'updated' };
  }

  const { actual, baseline } = await readScreenshotPair(actualBuf, baselinePath);
  if (actual.width !== baseline.width || actual.height !== baseline.height) {
    await writeFile(actualPath, actualBuf);
    return {
      ok: false,
      reason: `screenshot size mismatch: actual=${actual.width}x${actual.height} baseline=${baseline.width}x${baseline.height}`,
    };
  }

  const diff = new PNG({ width: actual.width, height: actual.height });
  const numDiff = pixelmatch(
    actual.data, baseline.data, diff.data,
    actual.width, actual.height,
    { threshold: 0.1 },
  );

  if (numDiff > 0) {
    await writeFile(actualPath, actualBuf);
    await writeFile(diffPath, PNG.sync.write(diff));
    return { ok: false, reason: `screenshot diff: ${numDiff} pixels` };
  }

  return { ok: true };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 800, height: 600 },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();

  const filtered = FILTER ? cases.filter(c => c.name.includes(FILTER)) : cases;

  let pass = 0, fail = 0;
  for (const c of filtered) {
    process.stdout.write(`  ${c.name.padEnd(28)} `);
    try {
      const r = await runCase(page, c);
      if (r.ok) {
        pass++;
        console.log(r.snapshot === 'updated' ? '✓ (snapshot updated)' : '✓');
      } else {
        fail++;
        console.log(`✗  ${r.reason}`);
      }
    } catch (err) {
      fail++;
      console.log(`✗  ${err.message}`);
    }
  }

  await browser.close();

  console.log(`\n${pass} passed, ${fail} failed (${filtered.length} total)`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('runner error:', err);
  process.exit(2);
});
