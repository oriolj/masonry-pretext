// test/visual/_bench-stats.mjs — shared statistics + grid-fixture helpers
// for the Node-side bench scripts (bench-server-layout, bench-hydration).
//
// `bench-pretext.mjs` runs its stats inside `page.evaluate()` (browser
// context) so it can't import from this file — its `stats()` is inlined.

/**
 * Median + mean + min/max + p10/p90 from a sample array.
 */
export function summarize( values ) {
  const sorted = [...values].sort( ( a, b ) => a - b );
  return {
    median: sorted[ Math.floor( sorted.length / 2 ) ],
    mean: sorted.reduce( ( s, x ) => s + x, 0 ) / sorted.length,
    min: sorted[0],
    max: sorted[ sorted.length - 1 ],
    p10: sorted[ Math.floor( sorted.length * 0.1 ) ],
    p90: sorted[ Math.floor( sorted.length * 0.9 ) ],
  };
}

/**
 * Format a millisecond value with adaptive precision.
 */
export function fmtMs( ms ) {
  if ( ms < 0.1 ) return ms.toFixed( 4 );
  if ( ms < 1 ) return ms.toFixed( 3 );
  if ( ms < 10 ) return ms.toFixed( 2 );
  return ms.toFixed( 1 );
}

/**
 * Format a CLS value (4 decimals — CLS is unitless and always small).
 */
export function fmtCls( v ) {
  return v.toFixed( 4 );
}

// ─────────────────────────────────────────────────────────────────────
// Shared grid-fixture constants. The bench scripts and the Astro example
// (`examples/astro/src/pages/index.astro`) intentionally share the same
// container/column dimensions and the same item-height formula so the
// numbers in the README headline are directly comparable to what a real
// SSR demo would produce. The Astro example keeps its own copy because
// it's a user-facing demo, not maintained source.
// ─────────────────────────────────────────────────────────────────────

export const COL_WIDTH = 240;
export const GUTTER = 16;
export const COLS = 3;
export const CONTAINER_WIDTH = COLS * COL_WIDTH + ( COLS - 1 ) * GUTTER; // 752

/**
 * Build N deterministic items with the same height formula as the Astro
 * demo. Used by both bench scripts so the inputs are identical.
 */
export function buildItems( n ) {
  const items = new Array( n );
  for ( let i = 0; i < n; i++ ) {
    items[i] = {
      outerWidth: COL_WIDTH,
      outerHeight: 80 + ( ( i * 37 ) % 220 ),
    };
  }
  return items;
}
