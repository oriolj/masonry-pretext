#!/usr/bin/env node
// test/visual/bench-server-layout.mjs — pure-Node microbenchmark for
// `Masonry.computeLayout` (Phase 5 of PRETEXT_SSR_ROADMAP.md).
//
// Times the cost of running the entire layout pipeline in Node for grids
// of N items. Validates the "fast enough to add <5ms to a server response"
// claim from the SSR feature line. NO chromium, NO playwright — runs in
// any Node ≥ 18.
//
// Output is plaintext for pasting into commit messages and the README's
// "Key improvements" headline row.
//
// Usage:
//   node test/visual/bench-server-layout.mjs                # default sizes + runs
//   node test/visual/bench-server-layout.mjs --runs=100     # more runs per size
//   node test/visual/bench-server-layout.mjs --sizes=200,800,3200

import { parseArgs } from 'node:util';
import Masonry from '../../dist/masonry.mjs';

const { values } = parseArgs({
  options: {
    runs:  { type: 'string', default: '50' },
    sizes: { type: 'string', default: '100,500,1000,5000' },
  },
});

const RUNS = Number( values.runs );
const SIZES = values.sizes.split( ',' ).map( Number );

// ─────────────────────────────────────────────────────────────────────
// Build a deterministic N-item grid. Heights follow the same formula as
// the Astro example so the bench output is reproducible AND comparable
// to a real-world demo.
// ─────────────────────────────────────────────────────────────────────
const COL_WIDTH = 240;
const GUTTER = 16;
const COLS = 3;
const CONTAINER_WIDTH = COLS * COL_WIDTH + ( COLS - 1 ) * GUTTER; // 752

function buildItems( n ) {
  const items = new Array( n );
  for ( let i = 0; i < n; i++ ) {
    items[i] = {
      outerWidth: COL_WIDTH,
      outerHeight: 80 + ( ( i * 37 ) % 220 ),
    };
  }
  return items;
}

function timeOne( items ) {
  const t0 = process.hrtime.bigint();
  Masonry.computeLayout({
    items,
    containerWidth: CONTAINER_WIDTH,
    columnWidth: COL_WIDTH,
    gutter: GUTTER,
  });
  const t1 = process.hrtime.bigint();
  // Convert nanoseconds → milliseconds with 4 decimal places of precision.
  return Number( t1 - t0 ) / 1_000_000;
}

function summarize( times ) {
  const sorted = [...times].sort( ( a, b ) => a - b );
  const median = sorted[ Math.floor( sorted.length / 2 ) ];
  const mean = sorted.reduce( ( s, x ) => s + x, 0 ) / sorted.length;
  const min = sorted[0];
  const max = sorted[ sorted.length - 1 ];
  const p10 = sorted[ Math.floor( sorted.length * 0.1 ) ];
  const p90 = sorted[ Math.floor( sorted.length * 0.9 ) ];
  return { median, mean, min, max, p10, p90 };
}

function fmt( ms ) {
  if ( ms < 0.1 ) return ms.toFixed( 4 );
  if ( ms < 1 ) return ms.toFixed( 3 );
  if ( ms < 10 ) return ms.toFixed( 2 );
  return ms.toFixed( 1 );
}

// ─────────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────────

console.log( '' );
console.log( '== Masonry.computeLayout — pure-Node microbench ==' );
console.log( '' );
console.log( `runs per size:  ${RUNS}` );
console.log( `node:           ${process.version}` );
console.log( `arch:           ${process.arch}` );
console.log( '' );
console.log( '  N items   |  median  |  mean    |  min     |  max     |  p10     |  p90     ' );
console.log( '  ----------+----------+----------+----------+----------+----------+----------' );

for ( const N of SIZES ) {
  const items = buildItems( N );

  // Warm-up — discard 5 runs so JIT, GC, and any first-call cost is
  // amortized out of the reported numbers.
  for ( let i = 0; i < 5; i++ ) timeOne( items );

  // Measured runs
  const times = new Array( RUNS );
  for ( let i = 0; i < RUNS; i++ ) {
    times[i] = timeOne( items );
  }

  const s = summarize( times );
  console.log(
    `  ${String( N ).padStart( 8 )}  |  ${fmt( s.median ).padStart( 6 )}ms |  ${fmt( s.mean ).padStart( 6 )}ms |  ${fmt( s.min ).padStart( 6 )}ms |  ${fmt( s.max ).padStart( 6 )}ms |  ${fmt( s.p10 ).padStart( 6 )}ms |  ${fmt( s.p90 ).padStart( 6 )}ms`
  );
}

console.log( '' );
console.log( '✓ Masonry.computeLayout runs in pure Node, no DOM, no chromium.' );
console.log( '  Recommended SSR usage: call from your server framework\'s route' );
console.log( '  handler (Astro frontmatter, Next.js Server Component, etc.) and' );
console.log( '  emit the returned positions inline as `style="left: Xpx; top: Ypx"`.' );
console.log( '  See examples/astro/ for the full pipeline.' );
console.log( '' );
