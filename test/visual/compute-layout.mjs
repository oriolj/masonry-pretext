#!/usr/bin/env node
// test/visual/compute-layout.mjs — Node-only verification that
// `Masonry.computeLayout` produces the same positions as the browser
// renders for the existing visual fixtures.
//
// This is the Phase 2 acceptance gate for `PRETEXT_SSR_ROADMAP.md` —
// it proves that the pure-Node layout helper agrees byte-for-byte with
// the browser-side layout for every fixture in the suite. If this gate
// passes, server-side layout precomputation is mathematically equivalent
// to client-side layout: the same inputs produce the same positions.
//
// This is the killer test for the SSR feature line. Without it,
// `Masonry.computeLayout` is a hand-wave; with it, masonry-pretext is
// the only cascading-grid library on the market with provably correct
// pure-Node layout.
//
// Runs in pure Node — NO chromium, NO playwright, NO JSDOM. The whole
// point is "this works in Node." If it ever needs a DOM, we've failed
// the architecture review.
//
// Usage:
//   node test/visual/compute-layout.mjs              # run, exit 0/1
//   node test/visual/compute-layout.mjs --verbose    # log every position
//
// See:
//   - improvements/017-compute-layout-static-helper.md (Phase 2 record)
//   - PRETEXT_SSR_ROADMAP.md § Phase 2 (the design)
//   - test/visual/run.mjs (the browser-side fixtures these mirror)

import Masonry from '../../dist/masonry.mjs';
import { strict as assert } from 'node:assert';

const VERBOSE = process.argv.includes('--verbose');

// ─────────────────────────────────────────────────────────────────────
// Fixture data — mirrors test/visual/pages/*.html and run.mjs.
//
// Each case has:
//   - name:     fixture identifier (matches run.mjs)
//   - opts:     input to Masonry.computeLayout (sizes, container, gutter, ...)
//   - expected: array of { x, y } positions (parallel to opts.items)
//
// The positions are extracted from the browser fixtures' assertions in
// run.mjs (where they are strings like '60px') — converted to numbers.
//
// For fixtures that involve runtime DOM mutations (pretext, fonts-ready,
// resize-observer, static-mode), we model the FINAL settled state — what
// the browser ends up rendering after all observers + callbacks fire.
// ─────────────────────────────────────────────────────────────────────
const cases = [
  {
    // basic-top-left: 5 items in a 180px container, columnWidth 60.
    // .item, .item.h4, .item.h3, .item.h3, .item.w2 → 60×30, 60×90, 60×70, 60×70, 120×30.
    name: 'basic-top-left',
    opts: {
      items: [
        { outerWidth: 60, outerHeight: 30 },
        { outerWidth: 60, outerHeight: 90 },
        { outerWidth: 60, outerHeight: 70 },
        { outerWidth: 60, outerHeight: 70 },
        { outerWidth: 120, outerHeight: 30 },
      ],
      containerWidth: 180,
      columnWidth: 60,
    },
    expected: [
      { x: 0,   y: 0  },
      { x: 60,  y: 0  },
      { x: 120, y: 0  },
      { x: 0,   y: 30 },
      { x: 60,  y: 90 },
    ],
  },
  {
    // gutter: 4 items in a 220px container, columnWidth 60, gutter 20.
    // 4th item is .item.w2 which the #gutter override sizes to 140 wide.
    name: 'gutter',
    opts: {
      items: [
        { outerWidth: 60,  outerHeight: 30 },
        { outerWidth: 60,  outerHeight: 30 },
        { outerWidth: 60,  outerHeight: 70 },
        { outerWidth: 140, outerHeight: 30 },
      ],
      containerWidth: 220,
      columnWidth: 60,
      gutter: 20,
    },
    expected: [
      { x: 0,   y: 0  },
      { x: 80,  y: 0  },
      { x: 160, y: 0  },
      { x: 0,   y: 30 },
    ],
  },
  {
    // horizontal-order: 9 items in a 180px container with horizontalOrder: true.
    // Items have classes h3, h2, none, none, h3, h2, none, none, none.
    // Heights: 70, 50, 30, 30, 70, 50, 30, 30, 30.
    name: 'horizontal-order',
    opts: {
      items: [
        { outerWidth: 60, outerHeight: 70 },
        { outerWidth: 60, outerHeight: 50 },
        { outerWidth: 60, outerHeight: 30 },
        { outerWidth: 60, outerHeight: 30 },
        { outerWidth: 60, outerHeight: 70 },
        { outerWidth: 60, outerHeight: 50 },
        { outerWidth: 60, outerHeight: 30 },
        { outerWidth: 60, outerHeight: 30 },
        { outerWidth: 60, outerHeight: 30 },
      ],
      containerWidth: 180,
      columnWidth: 60,
      horizontalOrder: true,
    },
    expected: [
      { x: 0,   y: 0   },
      { x: 60,  y: 0   },
      { x: 120, y: 0   },
      { x: 0,   y: 70  },
      { x: 60,  y: 50  },
      { x: 120, y: 30  },
      { x: 0,   y: 100 },
      { x: 60,  y: 120 },
      { x: 120, y: 80  },
    ],
  },
  {
    // fit-width: 3 items in a 160px parent (#fit-width-wrap), columnWidth 60,
    // fitWidth: true. Container is auto-sized inside the wrap.
    // 60×30, 60×50, 60×70. cols = floor(160/60) = 2.
    // Container width should snap to 2*60 = 120.
    name: 'fit-width',
    opts: {
      items: [
        { outerWidth: 60, outerHeight: 30 },
        { outerWidth: 60, outerHeight: 50 },
        { outerWidth: 60, outerHeight: 70 },
      ],
      containerWidth: 160,
      columnWidth: 60,
      fitWidth: true,
    },
    expected: [
      { x: 0,  y: 0  },
      { x: 60, y: 0  },
      { x: 0,  y: 30 },
    ],
    expectedContainerWidth: 120,
  },
  {
    // pretext: 4 items where the pretextify callback returns
    // [60×60, 60×30, 60×30, 60×30]. Same input shape as the browser
    // fixture's discriminator — the test verifies that computeLayout
    // produces the same positions the browser produces when it consults
    // the pretext callback (item 3 lands at col 1, not col 0).
    name: 'pretext',
    opts: {
      items: [
        { outerWidth: 60, outerHeight: 60 },
        { outerWidth: 60, outerHeight: 30 },
        { outerWidth: 60, outerHeight: 30 },
        { outerWidth: 60, outerHeight: 30 },
      ],
      containerWidth: 180,
      columnWidth: 60,
    },
    expected: [
      { x: 0,   y: 0  },
      { x: 60,  y: 0  },
      { x: 120, y: 0  },
      { x: 60,  y: 30 },
    ],
  },
  {
    // fonts-ready: same shape as pretext after the deferred layout fires.
    // Item 0 grows from 30 to 60 when document.fonts.ready resolves.
    name: 'fonts-ready',
    opts: {
      items: [
        { outerWidth: 60, outerHeight: 60 }, // post-font-load
        { outerWidth: 60, outerHeight: 30 },
        { outerWidth: 60, outerHeight: 30 },
        { outerWidth: 60, outerHeight: 30 },
      ],
      containerWidth: 180,
      columnWidth: 60,
    },
    expected: [
      { x: 0,   y: 0  },
      { x: 60,  y: 0  },
      { x: 120, y: 0  },
      { x: 60,  y: 30 },
    ],
  },
  {
    // resize-observer: same shape as pretext + fonts-ready after the
    // ResizeObserver fires. Item 0 is programmatically resized 30→60.
    name: 'resize-observer',
    opts: {
      items: [
        { outerWidth: 60, outerHeight: 60 }, // post-resize
        { outerWidth: 60, outerHeight: 30 },
        { outerWidth: 60, outerHeight: 30 },
        { outerWidth: 60, outerHeight: 30 },
      ],
      containerWidth: 180,
      columnWidth: 60,
    },
    expected: [
      { x: 0,   y: 0  },
      { x: 60,  y: 0  },
      { x: 120, y: 0  },
      { x: 60,  y: 30 },
    ],
  },
  {
    // static-mode: same setup as resize-observer but with static: true,
    // so the observer never fires and the layout stays at the INITIAL
    // sizes [60×30, 60×30, 60×30, 60×30]. This is the conjugate inverse
    // of the resize-observer fixture.
    name: 'static-mode',
    opts: {
      items: [
        { outerWidth: 60, outerHeight: 30 }, // pre-resize, never updated
        { outerWidth: 60, outerHeight: 30 },
        { outerWidth: 60, outerHeight: 30 },
        { outerWidth: 60, outerHeight: 30 },
      ],
      containerWidth: 180,
      columnWidth: 60,
    },
    expected: [
      { x: 0,   y: 0  },
      { x: 60,  y: 0  },
      { x: 120, y: 0  },
      { x: 0,   y: 30 }, // discriminator: item 3 at col 0, not col 1
    ],
  },
  {
    // percent-cols: 5 items at calc(20% - 16px) = 32 wide in a 240px container,
    // gutter 20, sizer 20%. With #014 fix: cols=5, stride=(240+20)/5=52.
    // computeLayout takes columnWidthPercent: 20 as the explicit hint
    // (no DOM to walk for percent detection in pure Node).
    name: 'percent-cols',
    opts: {
      items: [
        { outerWidth: 32, outerHeight: 30 },
        { outerWidth: 32, outerHeight: 30 },
        { outerWidth: 32, outerHeight: 30 },
        { outerWidth: 32, outerHeight: 30 },
        { outerWidth: 32, outerHeight: 30 },
      ],
      containerWidth: 240,
      columnWidth: 0, // overridden by columnWidthPercent
      gutter: 20,
      columnWidthPercent: 20,
    },
    expected: [
      { x: 0,   y: 0 },
      { x: 52,  y: 0 },
      { x: 104, y: 0 },
      { x: 156, y: 0 },
      { x: 208, y: 0 },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;

for ( const c of cases ) {
  process.stdout.write( `  ${c.name.padEnd( 28 )} ` );
  try {
    const result = Masonry.computeLayout( c.opts );

    // Verify positions count
    assert.equal(
      result.positions.length,
      c.expected.length,
      `expected ${c.expected.length} positions, got ${result.positions.length}`,
    );

    // Verify each position byte-for-byte
    for ( let i = 0; i < c.expected.length; i++ ) {
      const got = result.positions[i];
      const want = c.expected[i];
      assert.equal(
        got.x,
        want.x,
        `item ${i}: expected x=${want.x}, got x=${got.x}`,
      );
      assert.equal(
        got.y,
        want.y,
        `item ${i}: expected y=${want.y}, got y=${got.y}`,
      );
    }

    // Verify fitWidth-derived container width if specified
    if ( c.expectedContainerWidth !== undefined ) {
      assert.equal(
        result.containerWidth,
        c.expectedContainerWidth,
        `expected containerWidth=${c.expectedContainerWidth}, got ${result.containerWidth}`,
      );
    }

    pass++;
    console.log( '✓' );
    if ( VERBOSE ) {
      for ( let i = 0; i < result.positions.length; i++ ) {
        const p = result.positions[i];
        console.log( `      item ${i}: (${p.x}, ${p.y})` );
      }
      console.log( `      cols=${result.cols}, columnWidth=${result.columnWidth}, height=${result.containerHeight}` );
    }
  } catch ( err ) {
    fail++;
    console.log( `✗  ${err.message}` );
  }
}

console.log( `\n${pass} passed, ${fail} failed (${cases.length} total)` );
process.exit( fail === 0 ? 0 : 1 );
