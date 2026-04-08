#!/usr/bin/env node
// test/visual/bench-pretext.mjs — microbenchmark for the pretext fast path.
//
// Measures how much wall-clock time the `pretextify` callback saves vs
// calling `item.getSize()` (the DOM-measuring default) on a grid of N items.
// Builds the grid programmatically inside the browser context, runs Masonry
// many times under each configuration, reports the median + spread.
//
// Usage:
//   node test/visual/bench-pretext.mjs                # default: 500 items, 30 runs
//   node test/visual/bench-pretext.mjs --items=1000 --runs=20
//
// Output is plaintext suitable for pasting into improvement doc / commit msg.
//
// Methodology:
//   - Same grid built fresh for every run (fair comparison, no warm-cache wins).
//   - 5 warm-up runs before each measurement set, discarded.
//   - Median + min + max reported.
//   - The pretextify callback returns precomputed sizes; in real usage the
//     equivalent prepare+layout cost would be a one-time setup outside the
//     hot path. This bench isolates the layout-loop savings, not the
//     measurement library's setup cost.

import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const fixtureURL = pathToFileURL(path.join(__dirname, 'pages', 'bench.html')).toString();

const args = new Map(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--(\w+)=(.+)$/);
    return m ? [m[1], m[2]] : [a, true];
  }),
);
const ITEMS = Number(args.get('items') ?? 500);
const RUNS = Number(args.get('runs') ?? 30);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1024, height: 800 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(fixtureURL);
await page.waitForFunction(() => window.__READY === true);

const result = await page.evaluate(({ items: ITEMS, runs: RUNS }) => {
  const COL_WIDTH = 60;

  function buildGrid() {
    const grid = document.createElement('div');
    grid.style.position = 'relative';
    grid.style.width = (COL_WIDTH * 6) + 'px';
    for (let i = 0; i < ITEMS; i++) {
      const item = document.createElement('div');
      item.className = 'bench-item';
      item.textContent = 'Item ' + i + ' — lorem ipsum dolor sit amet, consectetur adipiscing elit';
      grid.appendChild(item);
    }
    document.body.appendChild(grid);
    return grid;
  }

  function destroyGrid(grid) {
    grid.remove();
  }

  function timeOne(useCallback) {
    const grid = buildGrid();
    // Precompute sizes + an O(1) element→size Map outside the timed region.
    // This mirrors realistic pretext usage: prepare() runs once at startup
    // (or per content edit), the per-item lookup in the hot path is a hash
    // lookup, not an O(N) scan. An earlier version of this bench used
    // Array.indexOf inside the callback and was 16% SLOWER than the DOM
    // path because the per-call O(N) lookup dominated the savings —
    // worth remembering: the callback's CONTENT cost matters as much
    // as the saved reflows.
    let sizeMap = null;
    if (useCallback) {
      const items = grid.querySelectorAll('.bench-item');
      sizeMap = new Map();
      for (let i = 0; i < items.length; i++) {
        sizeMap.set(items[i], {
          outerWidth: COL_WIDTH,
          // Vary heights slightly so column packing has real work to do.
          outerHeight: 30 + (i % 5) * 8,
        });
      }
    }
    const opts = { columnWidth: COL_WIDTH, transitionDuration: 0 };
    if (useCallback) {
      opts.pretextify = (elem) => sizeMap.get(elem);
    }
    const t0 = performance.now();
    new Masonry(grid, opts);
    const t1 = performance.now();
    destroyGrid(grid);
    return t1 - t0;
  }

  function runSet(useCallback, runs) {
    // 5 warm-up runs to amortize JIT, deopts, font loading, etc.
    for (let i = 0; i < 5; i++) timeOne(useCallback);
    const times = [];
    for (let i = 0; i < runs; i++) times.push(timeOne(useCallback));
    return times;
  }

  function stats(times) {
    const sorted = [...times].sort((a, b) => a - b);
    return {
      median: sorted[Math.floor(sorted.length / 2)],
      mean: times.reduce((s, x) => s + x, 0) / times.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      p10: sorted[Math.floor(sorted.length * 0.1)],
      p90: sorted[Math.floor(sorted.length * 0.9)],
    };
  }

  // Interleave runs to avoid systematic bias from warm caches or thermal drift
  // affecting one set more than the other.
  const without = [];
  const withCb = [];
  // Warm-up for both
  for (let i = 0; i < 5; i++) { timeOne(false); timeOne(true); }
  for (let i = 0; i < RUNS; i++) {
    without.push(timeOne(false));
    withCb.push(timeOne(true));
  }

  return {
    items: ITEMS,
    runs: RUNS,
    without: stats(without),
    withCallback: stats(withCb),
    raw: { without, withCb },
  };
}, { items: ITEMS, runs: RUNS });

await browser.close();

const { without, withCallback } = result;
const speedup = without.median / withCallback.median;
const reductionPct = (1 - withCallback.median / without.median) * 100;
const fmt = (n) => n.toFixed(2).padStart(7) + ' ms';

console.log('');
console.log(`pretext bench  (${result.items} items × ${result.runs} runs)`);
console.log('');
console.log('                       median        mean         min         max         p10         p90');
console.log('  without pretextify ' + fmt(without.median) + '  ' + fmt(without.mean) + '  ' + fmt(without.min) + '  ' + fmt(without.max) + '  ' + fmt(without.p10) + '  ' + fmt(without.p90));
console.log('  with pretextify    ' + fmt(withCallback.median) + '  ' + fmt(withCallback.mean) + '  ' + fmt(withCallback.min) + '  ' + fmt(withCallback.max) + '  ' + fmt(withCallback.p10) + '  ' + fmt(withCallback.p90));
console.log('');
console.log(`  speedup            ${speedup.toFixed(2)}× faster (median)`);
console.log(`  time reduction     ${reductionPct.toFixed(1)}%`);
console.log('');
