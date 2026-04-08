# 025 — Allocation-free `getColGroupY` hot path (item M)

**Status:** landed
**Roadmap section:** § Post-#010 (review #4) / FORK_ROADMAP.md item M
**Tag:** `v5.0.0-dev.25`

## Hypothesis

`getColGroupY` was implemented as `colYs.slice(col, col+colSpan)` followed by `Math.max.apply(Math, ...)`. Both operations allocate per call:

- `slice()` creates a new array of length `colSpan`
- `Math.max.apply` allocates an arguments array internally

For an N-item multi-col grid this happens N times per layout call. ResizeObserver-driven relayouts (#012) fire dozens of times per second during a window-resize drag, so the allocation pressure is real.

Replace with a direct max-loop. Same correctness for all `colSpan` values (the loop body never executes when `colSpan=1`, returning `colYs[col]` unchanged). Zero allocation per call.

**Numeric prediction:** ±10 B gz on the bundle (the loop is similar size to the original); the win is runtime-perf and GC pressure, not bytes.

## Method

```js
function getColGroupY( col, colSpan, colYs ) {
  // Direct max-loop instead of slice() + Math.max.apply (#025 / item M).
  // For a 1000-item multi-col grid this saves 1000 array allocations
  // per layout (one slice() per call) plus the Math.max.apply
  // arguments-array allocation. Handles colSpan=1 correctly because
  // the loop body never executes.
  var max = colYs[ col ];
  var end = col + colSpan;
  for ( var i = col + 1; i < end; i++ ) {
    if ( colYs[i] > max ) max = colYs[i];
  }
  return max;
}
```

## Numbers

| Metric | pre-025 | post-025 | Δ |
|---|---:|---:|---:|
| `dist/masonry.pkgd.min.js` raw | 24,855 | 24,846 | −9 |
| `dist/masonry.pkgd.min.js` gz | 8,026 | 8,031 | +5 (within compression jitter) |
| `dist/masonry.pkgd.min.js` brotli | 7,281 | 7,288 | +7 |
| Visual + ssr + module + compute-layout + no-jquery | all green | all green | unchanged |

Bundle is essentially unchanged. The win is the per-item allocation savings on the layout hot path — measurable in a microbench but not in the byte counter.

## Verdict

✅ **Match — the prediction said "±10 B gz on bundle, win is runtime-perf"**. Refactor landed with no behavior change (10/10 visual fixtures + 9/9 compute-layout pass byte-for-byte against unchanged baselines). The runtime allocation savings are real but unmeasured by `bench-pretext.mjs` (which uses single-col items where `colSpan < 2` was already a fast path). A future bench could exercise multi-col items at scale to put a number on the savings; the eliminated allocations are correct regardless.
