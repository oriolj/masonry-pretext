#!/usr/bin/env node
// test/visual/bench-pretext.mjs — microbenchmark for the pretext fast path.
//
// Times `new Masonry(grid, opts)` on a programmatically-built N-item grid,
// once with the default DOM-measuring path and once with `pretextify` set to
// an O(1) Map lookup. Both paths build the same grid + Map outside the timed
// region (the Map allocation is a no-op for the without-callback path —
// kept for symmetry so GC pressure is identical between the two sets).
// Reports median + spread; output is plaintext for pasting into commit
// messages and improvement docs.
//
// Usage:
//   node test/visual/bench-pretext.mjs               # 500 items × 30 runs
//   node test/visual/bench-pretext.mjs --items=2000 --runs=20

import { parseArgs } from 'node:util';
import { launchPage, gotoFixture } from './_harness.mjs';

const { values } = parseArgs({
  options: {
    items: { type: 'string', default: '500' },
    runs:  { type: 'string', default: '30'  },
  },
});
const ITEMS = Number(values.items);
const RUNS = Number(values.runs);

const { browser, page } = await launchPage({ viewport: { width: 1024, height: 800 } });
await gotoFixture(page, 'bench.html');

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

  function timeOne(useCallback) {
    const grid = buildGrid();
    // Build the size Map in BOTH paths so GC pressure is symmetric across
    // interleaved runs (otherwise the without-callback set sees GC from the
    // previous with-callback iteration's Map and the bench is biased — see
    // improvements/009 calibration notes).
    const items = grid.querySelectorAll('.bench-item');
    const sizeMap = new Map();
    for (let i = 0; i < items.length; i++) {
      sizeMap.set(items[i], {
        outerWidth: COL_WIDTH,
        // Vary heights so column packing has real work to do.
        outerHeight: 30 + (i % 5) * 8,
      });
    }
    const opts = { columnWidth: COL_WIDTH, transitionDuration: 0 };
    if (useCallback) {
      opts.pretextify = (elem) => sizeMap.get(elem);
    }
    const t0 = performance.now();
    new Masonry(grid, opts);
    const t1 = performance.now();
    grid.remove();
    return t1 - t0;
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

  const without = [];
  const withCb = [];
  // Warm-up: 5 of each, interleaved like the measurement set so JIT shapes
  // match what the timed region will see.
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
