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
  {
    // <masonry-grid> Custom Element wrapper (#034 / item Q) — see
    // test/visual/pages/web-component.html for the discriminator. The
    // element auto-constructs masonry on connectedCallback, reads options
    // from data-* attributes, ships observeMutations: true + transitionDuration: 0.
    // Same 4-item / 3-col layout as basic-top-left default behavior.
    name: 'web-component',
    page: 'web-component.html',
    container: '#web-component',
    expected: [
      { left: '0px',   top: '0px'  },
      { left: '60px',  top: '0px'  },
      { left: '120px', top: '0px'  },
      { left: '0px',   top: '30px' },
    ],
  },
  {
    // pretextOptions shorthand (#035 / PRETEXT_SSR Phase 6) — see
    // test/visual/pages/pretext-options.html. Same shape as pretext.html
    // (#009) but uses the new convenience layer instead of a hand-written
    // pretextify callback. If wired, item 0 measures as 60 (not 30) and
    // item 3 lands at (60, 30). If broken, item 3 lands at (0, 30).
    name: 'pretext-options',
    page: 'pretext-options.html',
    container: '#pretext-options',
    expected: [
      { left: '0px',   top: '0px'  },
      { left: '60px',  top: '0px'  },
      { left: '120px', top: '0px'  },
      { left: '60px',  top: '30px' }, // discriminating: pretextOptions consulted
    ],
  },
  {
    // diagnose() (#048 / D.11) — see test/visual/pages/diagnose.html.
    // 4 items in a 3-col 180px container, default options. The
    // pageAssert exercises every field of the MasonryDiagnostic shape.
    name: 'diagnose',
    page: 'diagnose.html',
    container: '#diagnose',
    expected: [
      { left: '0px',   top: '0px'  },
      { left: '60px',  top: '0px'  },
      { left: '120px', top: '0px'  },
      { left: '0px',   top: '30px' },
    ],
    pageAssert: () => {
      const d = window.__DIAGNOSTIC;
      if (!d) return '__DIAGNOSTIC not captured';
      if (d.cols !== 3) return `cols expected 3, got ${d.cols}`;
      if (d.columnWidth !== 60) return `columnWidth expected 60, got ${d.columnWidth}`;
      if (d.containerWidth !== 180) return `containerWidth expected 180, got ${d.containerWidth}`;
      if (d.containerHeight !== 60) return `containerHeight expected 60, got ${d.containerHeight}`;
      if (!Array.isArray(d.items)) return 'items not an array';
      if (d.items.length !== 4) return `items length expected 4, got ${d.items.length}`;
      // Each item should have element + position + size + observerWired.
      for (let i = 0; i < d.items.length; i++) {
        const it = d.items[i];
        if (!it.element) return `item ${i}: missing element`;
        if (typeof it.position?.x !== 'number') return `item ${i}: position.x not a number`;
        if (typeof it.position?.y !== 'number') return `item ${i}: position.y not a number`;
        if (typeof it.size?.outerWidth !== 'number') return `item ${i}: size.outerWidth not a number`;
        if (typeof it.observerWired !== 'boolean') return `item ${i}: observerWired not a boolean`;
        // All items should be observer-wired (default options, no static mode).
        if (!it.observerWired) return `item ${i}: expected observerWired=true (default options)`;
      }
      // Observer status: resize wired (default), mutation skipped (no observeMutations),
      // fontsReady fired (assume the test page's fonts are already loaded).
      if (d.observers.resize !== 'wired') return `resize observer status expected 'wired', got ${d.observers.resize}`;
      if (d.observers.mutation !== 'skipped') return `mutation observer status expected 'skipped', got ${d.observers.mutation}`;
      // fontsReady is timing-dependent — accept either 'fired' or 'pending' as long as it's not 'skipped'.
      if (d.observers.fontsReady === 'skipped') return `fontsReady status expected 'fired'/'pending', got 'skipped'`;
      if (typeof d.lastLayoutTimestamp !== 'number') return 'lastLayoutTimestamp not a number';
      if (d.lastLayoutTimestamp <= 0) return `lastLayoutTimestamp expected > 0, got ${d.lastLayoutTimestamp}`;
      // No observer has fired yet, so lastRelayoutReason is null.
      if (d.lastRelayoutReason !== null) return `lastRelayoutReason expected null, got ${d.lastRelayoutReason}`;
      return null;
    },
  },
  {
    // pause/resume (#047 / D.10) — see test/visual/pages/pause-resume.html
    // for the discriminator design. After construction, calls
    // msnry.pause(), mutates item 0's height (would normally trigger
    // a relayout via ResizeObserver), then calls msnry.resume() which
    // schedules a catch-up layout. The pageAssert verifies that the
    // pre-resume layout count was unchanged from the initial layout
    // (i.e., the pause actually suppressed the observer's relayout)
    // and the post-resume count incremented by 1 (the catch-up).
    name: 'pause-resume',
    page: 'pause-resume.html',
    container: '#pause-resume',
    expected: [
      { left: '0px',   top: '0px'  },
      { left: '60px',  top: '0px'  },
      { left: '120px', top: '0px'  },
      { left: '60px',  top: '30px' }, // discriminating: catch-up layout fired
    ],
    pageAssert: () => {
      const pre = window.__PRE_RESUME_LAYOUT_COUNT;
      const post = window.__POST_RESUME_LAYOUT_COUNT;
      if (pre === undefined) return '__PRE_RESUME_LAYOUT_COUNT not captured';
      if (post === undefined) return '__POST_RESUME_LAYOUT_COUNT not captured';
      // Pre-resume: only the initial layout has happened. The
      // observer fired (because items[0] grew) but pause suppressed
      // the relayout, so the count should still be 1.
      if (pre !== 1) return `expected pre-resume count 1 (pause suppressed observer relayout), got ${pre}`;
      // Post-resume: the catch-up layout from resume() ran, so count = 2.
      if (post !== 2) return `expected post-resume count 2 (catch-up layout), got ${post}`;
      return null;
    },
  },
  {
    // replaceItems atomic swap (#046 / D.9) — see test/visual/pages/replace-items.html
    // for the discriminator design. Starts with 3 old items, then calls
    // replaceItems with 4 new items (item 0 is taller). Layout assertion
    // verifies the new layout shape; pageAssert verifies the items
    // collection was correctly swapped and observers are still wired.
    name: 'replace-items',
    page: 'replace-items.html',
    container: '#replace-items',
    itemSelector: '.new-item',
    expected: [
      { left: '0px',   top: '0px'  },
      { left: '60px',  top: '0px'  },
      { left: '120px', top: '0px'  },
      { left: '60px',  top: '30px' }, // discriminating: layout reflects 4 new items
    ],
    pageAssert: () => {
      const state = window.__POST_SWAP_STATE;
      if (!state) return '__POST_SWAP_STATE not captured';
      if (state.itemCount !== 4) return `expected 4 items after swap, got ${state.itemCount}`;
      if (!state.itemElementsAreNew) return 'old items still in msnry.items';
      if (!state.hasResizeObserver) return 'ResizeObserver was destroyed across the swap';
      return null;
    },
  },
  {
    // static: 'until-resize' hybrid mode (#045 / D.2) — see
    // test/visual/pages/static-until-resize.html. Constructs with
    // `static: 'until-resize'` and a non-zero transitionDuration.
    // Initial layout is 3-col (180px container). After construction
    // the container is narrowed to 120px and msnry.resize() is called
    // manually (bypassing the 100ms debounce). The hybrid handoff
    // fires: _isHybridArmed flips to false, transitionDuration
    // restored, ResizeObserver constructed retroactively. Layout
    // repacks for 2 cols.
    name: 'static-until-resize',
    page: 'static-until-resize.html',
    container: '#static-until-resize',
    expected: [
      { left: '0px',  top: '0px'  },
      { left: '60px', top: '0px'  },
      { left: '0px',  top: '30px' },
      { left: '60px', top: '30px' }, // discriminating: 2-col layout, post-resize
    ],
    pageAssert: () => {
      const initial = window.__INITIAL_STATE;
      const post = window.__POST_RESIZE_STATE;
      if (!initial) return '__INITIAL_STATE not captured';
      if (!post) return '__POST_RESIZE_STATE not captured';
      // Initial: hybrid armed, transitionDuration overridden to 0
      if (initial.isHybridArmed !== true) {
        return `initial _isHybridArmed expected true, got ${initial.isHybridArmed}`;
      }
      if (initial.transitionDuration !== 0) {
        return `initial transitionDuration expected 0, got ${initial.transitionDuration}`;
      }
      if (initial.hasObserver !== false) {
        return `initial _resizeObserver expected null, got truthy`;
      }
      // Post-resize: handoff fired
      if (post.isHybridArmed !== false) {
        return `post _isHybridArmed expected false, got ${post.isHybridArmed}`;
      }
      if (post.transitionDuration !== '0.4s') {
        return `post transitionDuration expected '0.4s', got ${post.transitionDuration}`;
      }
      if (post.hasObserver !== true) {
        return `post _resizeObserver expected truthy, got falsy`;
      }
      if (post.staticOption !== false) {
        return `post static option expected false, got ${post.staticOption}`;
      }
      return null;
    },
  },
  {
    // dynamicItems opt-out (#044 / D.4) — see test/visual/pages/dynamic-items.html
    // for the discriminator design. 4 items in a 3-col 180px container,
    // all 60×30 initially. Item 0 has the .dynamic-item class. With
    // `static: true + dynamicItems: '.dynamic-item'`, only item 0
    // gets the per-item ResizeObserver. After construction, items[0]
    // and items[1] are both resized 30→60. Item 0's observer fires
    // → relayout → reads ALL current sizes → repositions everything.
    //
    // Expected post-relayout positions (item 0 = 60h, item 1 = 60h):
    //   item 0 (60h) → col 0,  (0, 0),  colYs = [60, 0, 0]
    //   item 1 (60h) → col 1,  (60, 0), colYs = [60, 60, 0]
    //   item 2 (30h) → col 2,  (120,0), colYs = [60, 60, 30]
    //   item 3 (30h) → col 2,  (120,30) — col 2 is shortest at y=30
    //
    // The discriminator: item 3 lands at (120, 30) only if dynamicItems
    // is correctly observing item 0 inside static mode. Without it,
    // no relayout fires, and item 3 stays at (0, 30) with pre-resize
    // colYs.
    name: 'dynamic-items',
    page: 'dynamic-items.html',
    container: '#dynamic-items',
    expected: [
      { left: '0px',   top: '0px'  },
      { left: '60px',  top: '0px'  },
      { left: '120px', top: '0px'  },
      { left: '120px', top: '30px' }, // discriminating: relayout from item 0 fired
    ],
  },
  {
    // measureFromAttributes (#043 / D.7) — see
    // test/visual/pages/measure-from-attributes.html for the discriminator
    // design. 4 items each with a hidden 1×1 SVG <img> declaring different
    // aspect ratios via width/height attrs (60×90, 60×30, 60×30, 60×90).
    // Items have CSS height: 1px sentinel; measureFromAttributes overrides.
    // Same expected layout as item-sizer.
    name: 'measure-from-attributes',
    page: 'measure-from-attributes.html',
    container: '#measure-from-attributes',
    expected: [
      { left: '0px',   top: '0px'  },
      { left: '60px',  top: '0px'  },
      { left: '120px', top: '0px'  },
      { left: '60px',  top: '30px' }, // discriminating: img attrs respected
    ],
  },
  {
    // itemSizer callback (#042 / D.3) — see test/visual/pages/item-sizer.html
    // for the discriminator design. 4 items with no DOM-derivable height
    // (CSS sets height to 1px sentinel); itemSizer returns 90 for 'tall'
    // and 30 for 'short' based on data-module-type. Items: tall, short,
    // short, tall. Expected:
    //   item 0 (tall):  (0,   0)  → colYs = [90, 0,  0]
    //   item 1 (short): (60,  0)  → colYs = [90, 30, 0]
    //   item 2 (short): (120, 0)  → colYs = [90, 30, 30]
    //   item 3 (tall):  (60,  30) → leftmost shortest is col 1 at y=30
    // Without itemSizer: every item has DOM height 1, layout collapses,
    // item 3 lands at (0, 1) or similar — not (60, 30).
    name: 'item-sizer',
    page: 'item-sizer.html',
    container: '#item-sizer',
    expected: [
      { left: '0px',   top: '0px'  },
      { left: '60px',  top: '0px'  },
      { left: '120px', top: '0px'  },
      { left: '60px',  top: '30px' }, // discriminating: itemSizer fired
    ],
  },
  {
    // layoutError event (#040 / D.6) — see test/visual/pages/layout-error.html
    // for the discriminator design. 3 visible items + 1 display:none item
    // interleaved at index 2. The hidden item triggers a 'zero-width'
    // layoutError emission; the fixture captures it into __LAYOUT_ERRORS,
    // and the pageAssert below verifies exactly one entry was captured
    // with the right reason / index. The 3 visible items still lay out
    // normally, asserted via the standard position check (with the
    // `:not(.hidden)` filter to skip the hidden one).
    name: 'layout-error',
    page: 'layout-error.html',
    container: '#layout-error',
    itemSelector: '.item:not(.hidden)',
    expected: [
      { left: '0px',   top: '0px'  },
      { left: '60px',  top: '0px'  },
      // item 2 is hidden, skipped by itemSelector
      { left: '120px', top: '0px'  }, // item 3 lands at col 2 (col 2's colYs is still 0
                                       // because the hidden item's colSpan was 0)
    ],
    pageAssert: () => {
      const errs = window.__LAYOUT_ERRORS;
      if (!Array.isArray(errs)) return 'window.__LAYOUT_ERRORS not set';
      if (errs.length !== 1) return `expected exactly 1 layoutError, got ${errs.length}`;
      const e = errs[0];
      if (e.reason !== 'zero-width') return `expected reason 'zero-width', got '${e.reason}'`;
      if (e.index !== 2) return `expected index 2 (the hidden item), got ${e.index}`;
      if (e.cols !== 3) return `expected cols 3, got ${e.cols}`;
      if (e.columnWidth !== 60) return `expected columnWidth 60, got ${e.columnWidth}`;
      return null;
    },
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
  // Cases may set `itemSelector` to override the default `.item` (used by
  // the layout-error fixture which has `.item` and `.item.hidden` siblings
  // and only wants the visible ones in the position assertion).
  const itemSelector = c.itemSelector || '.item';
  const positions = await page.evaluate(({ sel, itemSel }) => {
    return Array.from(document.querySelectorAll(`${sel} ${itemSel}`)).map(el => ({
      left: el.style.left,
      top: el.style.top,
    }));
  }, { sel: c.container, itemSel: itemSelector });

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

  // ── Layer 1b: optional page-side assertion (custom JS executed in the
  // fixture's window). The fixture exposes some discriminating state via
  // window globals (e.g., __LAYOUT_ERRORS for the layoutError event), and
  // the case's `pageAssert` is a stringified function that returns a
  // failure reason or null. Used for fixtures whose discriminator can't be
  // expressed as item positions alone.
  if (c.pageAssert) {
    const assertResult = await page.evaluate(c.pageAssert);
    if (assertResult) {
      return { ok: false, reason: `pageAssert: ${assertResult}` };
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
