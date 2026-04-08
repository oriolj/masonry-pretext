#!/usr/bin/env node
// test/visual/run.mjs — masonry-pretext visual regression suite.
//
// Custom runner instead of `playwright test` because the upstream test
// runner produces no output in this sandbox (cause not yet diagnosed). The
// chromium API itself works fine, so this runner drives it directly: launch
// once, loop over fixtures, assert hardcoded positions for each, take a
// screenshot, diff against baseline.
//
// Usage:
//   node test/visual/run.mjs                # run, fail on diffs
//   node test/visual/run.mjs --update       # update screenshot baselines
//   node test/visual/run.mjs --filter=basic # run only matching fixtures
//
// See FORK_ROADMAP.md § Methodology, Layer 1 + Layer 2.

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { launchPage, gotoFixture } from './_harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
  {
    // Pretextify (#009) — see test/visual/pages/pretext.html for the discriminator design.
    name: 'pretext',
    page: 'pretext.html',
    container: '#pretext',
    expected: [
      { left: '0px',   top: '0px'  },
      { left: '60px',  top: '0px'  },
      { left: '120px', top: '0px'  },
      { left: '60px',  top: '30px' }, // discriminating: pretext → col 1, DOM → col 0
    ],
  },
  {
    // document.fonts.ready hook (#010) — see test/visual/pages/fonts-ready.html
    // for the discriminator design. The fixture mocks fonts.ready and item 0
    // grows from 30→60 when fonts "load". If the deferred layout fires, item 3
    // lands at (60, 30); if not, it lands at (0, 30).
    name: 'fonts-ready',
    page: 'fonts-ready.html',
    container: '#fonts-ready',
    expected: [
      { left: '0px',   top: '0px'  },
      { left: '60px',  top: '0px'  },
      { left: '120px', top: '0px'  },
      { left: '60px',  top: '30px' }, // discriminating: fonts.ready relayout fired
    ],
  },
  {
    // Per-item ResizeObserver (#012) — see test/visual/pages/resize-observer.html
    // for the discriminator design. The fixture programmatically resizes item 0
    // from 30→60 AFTER masonry has laid out. If the per-item ResizeObserver
    // schedules a relayout via rAF, item 3 lands at (60, 30); if not, it
    // stays at (0, 30).
    name: 'resize-observer',
    page: 'resize-observer.html',
    container: '#resize-observer',
    expected: [
      { left: '0px',   top: '0px'  },
      { left: '60px',  top: '0px'  },
      { left: '120px', top: '0px'  },
      { left: '60px',  top: '30px' }, // discriminating: ResizeObserver relayout fired
    ],
  },
  {
    // Static mode / SSR preset (#015) — see test/visual/pages/static-mode.html
    // for the discriminator design. Same fixture shape as resize-observer.html
    // but with `static: true`, which should skip ResizeObserver wire-up.
    // Item 0 is resized from 30→60 after construction; because the observer
    // is never constructed in static mode, the relayout does NOT fire and
    // item 3 stays at (0, 30) — the exact inverse of the resize-observer
    // fixture's expected position.
    name: 'static-mode',
    page: 'static-mode.html',
    container: '#static-mode',
    expected: [
      { left: '0px',   top: '0px'  },
      { left: '60px',  top: '0px'  },
      { left: '120px', top: '0px'  },
      { left: '0px',   top: '30px' }, // discriminating: NO relayout fired
    ],
  },
  {
    // Percentage columnWidth + gutter math fix (#014, closes desandro/masonry#1006).
    // See test/visual/pages/percent-cols.html for the discriminator design.
    // Container 240px, gutter 20px, sizer width 20%. Without the fix the
    // gutter-overshoot math drops to 3 columns and items 3+4 wrap to row 2;
    // with the fix the math snaps to round(100/20) = 5 columns and all 5
    // items pack into row 1.
    name: 'percent-cols',
    page: 'percent-cols.html',
    container: '#percent-cols',
    expected: [
      { left: '0px',   top: '0px' },
      { left: '52px',  top: '0px' },
      { left: '104px', top: '0px' },
      { left: '156px', top: '0px' },
      { left: '208px', top: '0px' }, // discriminating: 5-col layout, no wrap
    ],
  },
  {
    // SSR adoption (#018 / Phase 3) — see test/visual/pages/init-layout-false.html
    // for the discriminator design. Items are pre-positioned in a SINGLE-COLUMN
    // STACK at x=0 — a layout masonry would never produce naturally for 4 60×30
    // items in a 3-col 180px container. Constructed with `initLayout: false,
    // static: true`. If adoption works, items stay in the stack; if init-layout-
    // false is broken, items 1/2/3 get repositioned to the natural 3-col tile
    // and their x changes from 0 to 60/120/0.
    name: 'init-layout-false',
    page: 'init-layout-false.html',
    container: '#init-layout-false',
    expected: [
      { left: '0px', top: '0px'  },
      { left: '0px', top: '30px' }, // discriminating: stays at x=0 (not 60)
      { left: '0px', top: '60px' }, // discriminating: stays at x=0 (not 120)
      { left: '0px', top: '90px' }, // discriminating: stays at x=0 (not 0 in row 2)
    ],
  },
  {
    // MutationObserver auto-relayout (#031 / item K) — see
    // test/visual/pages/mutation-observer.html for the discriminator design.
    // Container has 4 items initially; a 5th is appended via grid.appendChild
    // AFTER masonry constructs. With observeMutations: true the MutationObserver
    // detects the childList change and schedules reloadItems + layout via rAF
    // coalescing. The 5th item lands at (60, 30) — the leftmost shortest col
    // among (60, 30, 30) for cols 0/1/2.
    name: 'mutation-observer',
    page: 'mutation-observer.html',
    container: '#mutation-observer',
    expected: [
      { left: '0px',   top: '0px'  },
      { left: '60px',  top: '0px'  },
      { left: '120px', top: '0px'  },
      { left: '0px',   top: '30px' },
      { left: '60px',  top: '30px' }, // discriminating: 5th item via grid.appendChild
    ],
  },
  {
    // pickColumn callback (#032 / item I) — see test/visual/pages/pick-column.html
    // for the discriminator design. 4 items in a 3-col 180px container with a
    // RIGHTMOST-shortest picker (uses <= instead of <). All items walk
    // right-to-left because every tie resolves to the highest index:
    //   item 0: colGroup=[0,0,0]   → col 2 (last with val=0) → (120, 0)
    //   item 1: colGroup=[0,0,30]  → col 1                    → (60,  0)
    //   item 2: colGroup=[0,30,30] → col 0                    → (0,   0)
    //   item 3: colGroup=[30,30,30]→ col 2 (last tie)         → (120, 30)
    // The default LEFTMOST picker would put item 0 at col 0 (left=0).
    name: 'pick-column',
    page: 'pick-column.html',
    container: '#pick-column',
    expected: [
      { left: '120px', top: '0px'  }, // discriminating: rightmost picker → col 2
      { left: '60px',  top: '0px'  },
      { left: '0px',   top: '0px'  },
      { left: '120px', top: '30px' }, // discriminating: rightmost picker → col 2
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────────

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
  await gotoFixture(page, c.page);

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
  const { browser, page } = await launchPage();

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
