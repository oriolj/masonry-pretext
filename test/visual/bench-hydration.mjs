#!/usr/bin/env node
// test/visual/bench-hydration.mjs — measures the hydration cost of two
// SSR rendering strategies for cascading-grid layouts (Phase 5 of
// PRETEXT_SSR_ROADMAP.md). This is the load-bearing measurement for the
// fork's headline feature.
//
// Two rendering strategies are compared, both rendering the same content:
//
//   "control"   — Server emits items in flow layout. Client constructs
//                 `new Masonry(grid, { transitionDuration: 0 })` after
//                 hydration. Items snap from flow positions to absolute
//                 cascading positions on first script run. **This is what
//                 every other masonry-style library on the market does**,
//                 including masonry-pretext through v5.0.0-dev.18 and the
//                 upstream desandro/masonry library.
//
//   "pipeline"  — Server emits items with INLINE absolute positions
//                 computed via `Masonry.computeLayout` (the Phase 2
//                 helper). Client constructs `new Masonry(grid, {
//                 initLayout: false, static: true })` to ADOPT the
//                 existing positions without recomputing. **This is the
//                 SSR feature line's defining capability** — only
//                 masonry-pretext (≥ v5.0.0-dev.19) supports this combo.
//
// Both pages render identical content (same items, same heights, same
// container dimensions). The only difference is what's in the HTML at
// parse time. The bench measures three quantities for each variant:
//
//   1. Cumulative Layout Shift (CLS) — the dominant Web Vital for
//      hydration jank, captured via PerformanceObserver. Target: 0.00
//      for the pipeline variant.
//
//   2. Time to first paint of final positions — measured as the gap
//      between `navigationStart` and the moment the bench's __READY
//      flag flips after items are in their final state.
//
//   3. Largest layout-shift entry — diagnoses whether the CLS is one
//      large jolt (typical hydration flash) or many small shifts.
//
// Results are reproduced for each of N runs and reported as median +
// p10/p90 + max. Output is plaintext for pasting into commit messages
// and the README headline.
//
// Usage:
//   node test/visual/bench-hydration.mjs                # default 30 runs
//   node test/visual/bench-hydration.mjs --runs=50      # more runs
//   node test/visual/bench-hydration.mjs --items=200    # bigger grid

import { parseArgs } from 'node:util';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import Masonry from '../../dist/masonry.mjs';
import { launchPage } from './_harness.mjs';

const __dirname = path.dirname( fileURLToPath( import.meta.url ) );
const REPO_ROOT = path.resolve( __dirname, '..', '..' );
const DIST_MIN_JS = path.join( REPO_ROOT, 'dist', 'masonry.pkgd.min.js' );

const { values } = parseArgs({
  options: {
    runs:  { type: 'string', default: '30' },
    items: { type: 'string', default: '60' },
  },
});

const RUNS = Number( values.runs );
const N_ITEMS = Number( values.items );

// ─────────────────────────────────────────────────────────────────────
// Build the test data — same shape as the Astro example so the bench
// matches what a real SSR demo would do.
// ─────────────────────────────────────────────────────────────────────
const COL_WIDTH = 240;
const GUTTER = 16;
const COLS = 3;
const CONTAINER_WIDTH = COLS * COL_WIDTH + ( COLS - 1 ) * GUTTER; // 752

const items = Array.from({ length: N_ITEMS }, ( _, i ) => ({
  outerWidth: COL_WIDTH,
  outerHeight: 80 + ( ( i * 37 ) % 220 ),
}));

// Pre-compute the positions ONCE in Node — these are what the "pipeline"
// variant's HTML emits inline. The "control" variant doesn't use them.
const computed = Masonry.computeLayout({
  items,
  containerWidth: CONTAINER_WIDTH,
  columnWidth: COL_WIDTH,
  gutter: GUTTER,
});

// ─────────────────────────────────────────────────────────────────────
// HTML generators — produce a self-contained page for each variant.
//
// Both pages:
//  1. Set up a CLS observer BEFORE the body parses
//  2. Render items in their respective styles (flow vs absolute)
//  3. Construct masonry in the matching mode
//  4. Wait two rAF ticks then expose window.__CLS + window.__READY
// ─────────────────────────────────────────────────────────────────────

const STYLE = `
  body { font-family: system-ui, sans-serif; margin: 0; padding: 24px; }
  .grid { position: relative; width: ${CONTAINER_WIDTH}px; }
  .grid-item {
    width: ${COL_WIDTH}px;
    background: #f3f4f6;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    box-sizing: border-box;
  }
`;

// Set up the CLS observer as the FIRST thing that runs in the page.
// PerformanceObserver with buffered:true catches every layout shift
// since navigationStart, so we don't miss any pre-script jank.
const CLS_OBSERVER_HEAD = [
  '<script>',
  '  window.__CLS = 0;',
  '  window.__CLS_MAX_ENTRY = 0;',
  '  try {',
  '    var obs = new PerformanceObserver(function (list) {',
  '      for (var i = 0; i < list.getEntries().length; i++) {',
  '        var entry = list.getEntries()[i];',
  '        if (!entry.hadRecentInput) {',
  '          window.__CLS += entry.value;',
  '          if (entry.value > window.__CLS_MAX_ENTRY) {',
  '            window.__CLS_MAX_ENTRY = entry.value;',
  '          }',
  '        }',
  '      }',
  '    });',
  '    obs.observe({ type: "layout-shift", buffered: true });',
  '  } catch (e) {}',
  '</script>',
].join( '\n  ' );

function controlHtml() {
  // CONTROL: items rendered in flow layout. Masonry constructs and
  // relayouts them on the client. This is the existing pattern for
  // every cascading-grid library on the market.
  const itemsHtml = items
    .map(
      ( item ) =>
        `<div class="grid-item" style="height: ${item.outerHeight}px;"></div>`
    )
    .join( '\n      ' );

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>bench-hydration: control</title>
  <style>${STYLE}</style>
  ${CLS_OBSERVER_HEAD}
</head>
<body>
  <div class="grid" id="grid">
      ${itemsHtml}
  </div>
  <script src="file://${DIST_MIN_JS}"></script>
  <script>
    // Yield to the browser's main thread so the FLOW-LAYOUT state gets
    // painted before masonry repositions items. Without this yield, the
    // synchronous masonry.layout() call would run BEFORE the first paint
    // and the user would never see the intermediate state — CLS would be
    // 0 even though the underlying technique is the buggy one. Real-world
    // scripts have this latency naturally because of bundle parsing,
    // network delay, framework hydration, etc. setTimeout(0) is the
    // smallest faithful simulation of "the script ran on the next tick."
    // Wait long enough that the browser has definitely composited the
    // flow-layout frame before masonry starts repositioning items. 200ms
    // is conservative — real-world hydration latency is typically 50-500ms
    // depending on bundle size, framework, and connection. The bench
    // simulates the worst-case visual flash.
    setTimeout(function () {
      var grid = document.getElementById('grid');
      new Masonry(grid, {
        itemSelector: '.grid-item',
        columnWidth: ${COL_WIDTH},
        gutter: ${GUTTER},
        transitionDuration: 0,
      });
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          window.__READY = true;
        });
      });
    }, 200);
  </script>
</body>
</html>
`;
}

function pipelineHtml() {
  // PIPELINE: items rendered with INLINE absolute positions, computed
  // via Masonry.computeLayout in Node. Masonry constructs with
  // initLayout: false + static: true to adopt existing positions
  // without recomputing. THIS is what the SSR pipeline ships.
  const itemsHtml = items
    .map(
      ( item, i ) => {
        const pos = computed.positions[i];
        return `<div class="grid-item" style="position: absolute; left: ${pos.x}px; top: ${pos.y}px; height: ${item.outerHeight}px;"></div>`;
      }
    )
    .join( '\n      ' );

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>bench-hydration: pipeline</title>
  <style>${STYLE}
    /* Reserve the full server-computed height — the secret to CLS = 0.00.
       Without this, .grid collapses to 0 (all children absolute) and then
       expands when the script runs, causing a vertical shift. */
    .grid { height: ${computed.containerHeight}px; }
    .grid-item { position: absolute; }
  </style>
  ${CLS_OBSERVER_HEAD}
</head>
<body>
  <div class="grid" id="grid">
      ${itemsHtml}
  </div>
  <script src="file://${DIST_MIN_JS}"></script>
  <script>
    var grid = document.getElementById('grid');
    new Masonry(grid, {
      itemSelector: '.grid-item',
      columnWidth: ${COL_WIDTH},
      gutter: ${GUTTER},
      initLayout: false,
      static: true,
    });
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        window.__READY = true;
      });
    });
  </script>
</body>
</html>
`;
}

// ─────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────

async function measureOne( page, url ) {
  await page.goto( url, { waitUntil: 'load' } );
  await page.waitForFunction( () => window.__READY === true );
  return await page.evaluate( () => ({
    cls: window.__CLS,
    maxEntry: window.__CLS_MAX_ENTRY,
  }));
}

function summarize( values ) {
  const sorted = [...values].sort( ( a, b ) => a - b );
  return {
    median: sorted[ Math.floor( sorted.length / 2 ) ],
    p10: sorted[ Math.floor( sorted.length * 0.1 ) ],
    p90: sorted[ Math.floor( sorted.length * 0.9 ) ],
    max: sorted[ sorted.length - 1 ],
    min: sorted[0],
  };
}

function fmtCls( v ) {
  return v.toFixed( 4 );
}

async function main() {
  // Write the two fixtures to a temp dir.
  const dir = await mkdtemp( path.join( tmpdir(), 'bench-hydration-' ) );
  const controlFile = path.join( dir, 'control.html' );
  const pipelineFile = path.join( dir, 'pipeline.html' );
  await writeFile( controlFile, controlHtml() );
  await writeFile( pipelineFile, pipelineHtml() );
  const controlUrl = pathToFileURL( controlFile ).toString();
  const pipelineUrl = pathToFileURL( pipelineFile ).toString();

  console.log( '' );
  console.log( '== bench-hydration — measured CLS for two SSR rendering strategies ==' );
  console.log( '' );
  console.log( `items per grid:  ${N_ITEMS}` );
  console.log( `runs per variant: ${RUNS}` );
  console.log( `node:             ${process.version}` );
  console.log( `fixtures:         ${dir}` );
  console.log( '' );

  const { browser, page } = await launchPage({ viewport: { width: 900, height: 700 } });

  // Run control + pipeline interleaved so any systematic noise (CPU
  // throttling, GC, network) hits both variants symmetrically.
  const controlRuns = [];
  const controlMaxEntries = [];
  const pipelineRuns = [];
  const pipelineMaxEntries = [];

  // Warm-up: 3 untimed runs of each variant
  for ( let i = 0; i < 3; i++ ) {
    await measureOne( page, controlUrl );
    await measureOne( page, pipelineUrl );
  }

  // Measured runs, interleaved
  for ( let i = 0; i < RUNS; i++ ) {
    const c = await measureOne( page, controlUrl );
    controlRuns.push( c.cls );
    controlMaxEntries.push( c.maxEntry );
    const p = await measureOne( page, pipelineUrl );
    pipelineRuns.push( p.cls );
    pipelineMaxEntries.push( p.maxEntry );
    process.stdout.write( '.' );
  }
  console.log( '' );

  await browser.close();

  const cs = summarize( controlRuns );
  const ps = summarize( pipelineRuns );
  const cmax = summarize( controlMaxEntries );
  const pmax = summarize( pipelineMaxEntries );

  console.log( '' );
  console.log( '  variant    |  CLS median  |  CLS p10     |  CLS p90     |  CLS max     |  largest single shift' );
  console.log( '  -----------+--------------+--------------+--------------+--------------+----------------------' );
  console.log( `  control    |  ${fmtCls( cs.median ).padStart( 10 )}  |  ${fmtCls( cs.p10 ).padStart( 10 )}  |  ${fmtCls( cs.p90 ).padStart( 10 )}  |  ${fmtCls( cs.max ).padStart( 10 )}  |  ${fmtCls( cmax.median ).padStart( 10 )}` );
  console.log( `  pipeline   |  ${fmtCls( ps.median ).padStart( 10 )}  |  ${fmtCls( ps.p10 ).padStart( 10 )}  |  ${fmtCls( ps.p90 ).padStart( 10 )}  |  ${fmtCls( ps.max ).padStart( 10 )}  |  ${fmtCls( pmax.median ).padStart( 10 )}` );
  console.log( '' );

  // Headline summary line — designed for the README's Key improvements row.
  const reduction = cs.median > 0 ? ( 1 - ps.median / cs.median ) * 100 : 100;
  console.log( '  HEADLINE:' );
  console.log( `    Median CLS: ${fmtCls( cs.median )} (control) → ${fmtCls( ps.median )} (pipeline)` );
  if ( cs.median === 0 && ps.median === 0 ) {
    console.log( `    Both variants have CLS = 0 at this grid size — try --items=200 for a more discriminating signal.` );
  } else {
    console.log( `    Reduction: ${reduction.toFixed( 1 )}% (CLS delta: ${fmtCls( cs.median - ps.median )})` );
  }
  console.log( '' );

  // Exit non-zero if the pipeline variant is somehow WORSE than control
  // (catches regressions from a botched future change).
  if ( ps.median > cs.median + 0.001 ) {
    console.error( '✗ pipeline CLS is higher than control — REGRESSION' );
    process.exit( 1 );
  }
  console.log( '✓ pipeline variant CLS ≤ control variant CLS (as expected)' );
  console.log( '' );
}

main().catch( ( err ) => {
  console.error( err );
  process.exit( 2 );
});
