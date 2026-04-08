#!/usr/bin/env node
// test/visual/compute-layouts.mjs — Node-only verification that
// `Masonry.computeLayouts` (the multi-breakpoint helper, #041 / D.1)
// produces the same positions per breakpoint as a hand-rolled
// `computeLayout` loop with the same inputs.
//
// The discriminator is structural: each breakpoint should produce
// EXACTLY what `Masonry.computeLayout` would produce if called with
// that breakpoint's containerWidth/columnWidth/gutter directly. The
// helper is a pure wrapper — no surprise behavior.
//
// Runs in pure Node — NO chromium, NO playwright, NO JSDOM.
//
// Usage:
//   node test/visual/compute-layouts.mjs              # run, exit 0/1
//   node test/visual/compute-layouts.mjs --verbose    # log every position

import Masonry from '../../dist/masonry.mjs';
import { strict as assert } from 'node:assert';

const VERBOSE = process.argv.includes( '--verbose' );

// Sample item set: 6 mixed-height bricks. Repeated across all breakpoints
// (the same items render at different positions per breakpoint).
const items = [
  { outerWidth: 0, outerHeight: 100 },
  { outerWidth: 0, outerHeight: 200 },
  { outerWidth: 0, outerHeight: 150 },
  { outerWidth: 0, outerHeight: 80  },
  { outerWidth: 0, outerHeight: 220 },
  { outerWidth: 0, outerHeight: 60  },
];

// Per-breakpoint outer-width has to match columnWidth (1-col items).
// We patch the items per pass below — `computeLayouts` doesn't rewrite
// item sizes, the consumer does.
function withWidth( arr, w ) {
  return arr.map( i => ({ outerWidth: w, outerHeight: i.outerHeight }) );
}

const breakpoints = [
  { name: 'mobile',  containerWidth: 360,  columnWidth: 360, gutter: 0  },
  { name: 'tablet',  containerWidth: 720,  columnWidth: 352, gutter: 16 },
  { name: 'desktop', containerWidth: 1024, columnWidth: 336, gutter: 16 },
  { name: 'wide',    containerWidth: 1280, columnWidth: 256, gutter: 16 },
];

let pass = 0;
let fail = 0;

// ─────────────────────────────────────────────────────────────────────
// Test 1 — basic agreement: each breakpoint's result should be
// identical to a direct `computeLayout` call with the same inputs.
// ─────────────────────────────────────────────────────────────────────
process.stdout.write( '  multi-breakpoint agreement       ' );
try {
  // For this test we keep items unchanged across breakpoints (the helper
  // doesn't rewrite item sizes). Use a constant width that fits in every
  // breakpoint's columnWidth.
  const itemsForAgreement = items.map( i => ({ outerWidth: 250, outerHeight: i.outerHeight }) );

  const result = Masonry.computeLayouts(
    { items: itemsForAgreement, columnWidth: 0, containerWidth: 0 },
    breakpoints,
  );

  for ( const bp of breakpoints ) {
    assert.ok( result[ bp.name ], `missing result for breakpoint '${bp.name}'` );

    // Compute the expected layout via a direct computeLayout call.
    const expected = Masonry.computeLayout({
      items: itemsForAgreement,
      containerWidth: bp.containerWidth,
      columnWidth: bp.columnWidth,
      gutter: bp.gutter,
    });

    assert.equal(
      result[ bp.name ].cols,
      expected.cols,
      `${bp.name}: cols expected ${expected.cols}, got ${result[ bp.name ].cols}`,
    );
    assert.equal(
      result[ bp.name ].positions.length,
      expected.positions.length,
      `${bp.name}: positions length mismatch`,
    );
    for ( let i = 0; i < expected.positions.length; i++ ) {
      assert.deepEqual(
        result[ bp.name ].positions[i],
        expected.positions[i],
        `${bp.name}: item ${i} position mismatch`,
      );
    }
    if ( VERBOSE ) {
      console.log( `      ${bp.name}: ${result[ bp.name ].cols} cols, ${result[ bp.name ].positions.length} positions` );
    }
  }
  pass++;
  console.log( '✓' );
} catch ( err ) {
  fail++;
  console.log( '✗  ' + err.message );
}

// ─────────────────────────────────────────────────────────────────────
// Test 2 — per-breakpoint cols actually differ. Catches the bug where
// the helper accidentally reuses a single result across breakpoints.
// ─────────────────────────────────────────────────────────────────────
process.stdout.write( '  per-breakpoint cols differ       ' );
try {
  const result = Masonry.computeLayouts(
    { items: withWidth( items, 200 ), columnWidth: 0, containerWidth: 0 },
    [
      { name: 'narrow', containerWidth: 200,  columnWidth: 200, gutter: 0 },
      { name: 'wide',   containerWidth: 1200, columnWidth: 200, gutter: 0 },
    ],
  );
  assert.equal( result.narrow.cols, 1, `narrow expected 1 col, got ${result.narrow.cols}` );
  assert.equal( result.wide.cols, 6, `wide expected 6 cols, got ${result.wide.cols}` );
  // Narrow should stack everything in col 0 (x=0 always).
  for ( const p of result.narrow.positions ) {
    assert.equal( p.x, 0, `narrow item should be at x=0, got x=${p.x}` );
  }
  // Wide should have items at x=0,200,400,600,800,1000 (one per col, all top).
  for ( let i = 0; i < result.wide.positions.length; i++ ) {
    assert.equal( result.wide.positions[i].x, i * 200, `wide item ${i} x mismatch` );
    assert.equal( result.wide.positions[i].y, 0, `wide item ${i} should be at y=0` );
  }
  pass++;
  console.log( '✓' );
} catch ( err ) {
  fail++;
  console.log( '✗  ' + err.message );
}

// ─────────────────────────────────────────────────────────────────────
// Test 3 — base options propagate. `fitWidth`, `pickColumn`, `stamps`,
// `horizontalOrder` should all be inherited from `opts` per pass.
// ─────────────────────────────────────────────────────────────────────
process.stdout.write( '  base options propagate          ' );
try {
  const fitItems = [
    { outerWidth: 100, outerHeight: 50 },
    { outerWidth: 100, outerHeight: 50 },
    { outerWidth: 100, outerHeight: 50 },
  ];
  // Container is 1000 wide but only 3 items × 100 cw = 300 used.
  // fitWidth should snap container down.
  const result = Masonry.computeLayouts(
    { items: fitItems, columnWidth: 0, containerWidth: 0, fitWidth: true },
    [{ name: 'big', containerWidth: 1000, columnWidth: 100, gutter: 0 }],
  );
  assert.equal( result.big.cols, 10, `expected 10 cols, got ${result.big.cols}` );
  // 3 items used, 7 cols unused → snapped width = 3 * 100 - 0 = 300
  assert.equal(
    result.big.containerWidth,
    300,
    `expected snapped containerWidth=300, got ${result.big.containerWidth}`,
  );
  pass++;
  console.log( '✓' );
} catch ( err ) {
  fail++;
  console.log( '✗  ' + err.message );
}

// ─────────────────────────────────────────────────────────────────────
// Test 4 — gutter override per breakpoint. If a breakpoint omits
// `gutter`, the base options' gutter is used; if it provides one, the
// override wins.
// ─────────────────────────────────────────────────────────────────────
process.stdout.write( '  per-breakpoint gutter override   ' );
try {
  const result = Masonry.computeLayouts(
    { items: [{ outerWidth: 100, outerHeight: 50 }], columnWidth: 0, containerWidth: 0, gutter: 99 },
    [
      { name: 'with-base',     containerWidth: 200, columnWidth: 100 },          // inherits 99
      { name: 'with-override', containerWidth: 200, columnWidth: 100, gutter: 0 }, // 0 wins
    ],
  );
  // with-base: gutter=99. (200+99)/(100+99) ≈ 1.5 cols → floor = 1 col
  assert.equal(
    result['with-base'].cols,
    1,
    `with-base expected 1 col, got ${result['with-base'].cols}`,
  );
  // with-override: gutter=0. 200/100 = 2 cols
  assert.equal(
    result['with-override'].cols,
    2,
    `with-override expected 2 cols, got ${result['with-override'].cols}`,
  );
  pass++;
  console.log( '✓' );
} catch ( err ) {
  fail++;
  console.log( '✗  ' + err.message );
}

// ─────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────
console.log( '' );
console.log( `${pass} passed, ${fail} failed (${pass + fail} total)` );
process.exit( fail ? 1 : 0 );
