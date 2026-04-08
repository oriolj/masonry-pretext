# 048 — `msnry.diagnose()` structured snapshot

**Status:** landed
**Roadmap section:** § Downstream consumer asks · D.11
**Closes upstream issues:** none (downstream debug helper standardization)
**Commit(s):** 5.0.0-dev.48

## Hypothesis

Add a `msnry.diagnose()` instance method that returns a typed
`MasonryDiagnostic` object describing the current state of the
instance — cols, columnWidth, container size, items list (with
positions + sizes + observer state), observer status, last layout
timestamp, last relayout reason. Standardized shape that dev tools /
testing frameworks can consume programmatically instead of parsing
console logs.

Each consumer that wanted this used to write its own ad-hoc
`window.debugMasonry()`; a built-in version saves that boilerplate
and gives a consistent shape across projects.

**Predictions:**

- **Cost:** ~150-300 B gzipped on `dist/masonry.pkgd.min.js`. The
  diagnose method itself is ~30 LOC, plus a `proto.layout` wrapper
  that records the timestamp, plus 4 small `_lastRelayoutReason =
  '...'` assignments at the various callsite (fonts.ready, ResizeObserver,
  MutationObserver, window-resize hybrid handoff).
- **Test gate:** new `diagnose.html` discriminating fixture +
  `pageAssert` that exercises every field of the snapshot shape.

## Method

- Files touched:
  - `masonry.js` —
    1. Added `proto.diagnose` returning the structured snapshot.
    2. Added `proto.layout` wrapper that records `_lastLayoutTimestamp`
       on every layout pass.
    3. Added `_lastRelayoutReason` assignments at four callsites:
       fonts.ready callback, ResizeObserver rAF, MutationObserver rAF,
       and the hybrid resize() handoff.
  - `masonry.d.ts` — added `MasonryDiagnostic` interface near the
    other type definitions and a `diagnose(): MasonryDiagnostic`
    method declaration on the `Masonry` class.
  - `test/visual/pages/diagnose.html` — new fixture that calls
    `diagnose()` immediately after construction and stashes the
    result on `window.__DIAGNOSTIC` for the runner.
  - `test/visual/run.mjs` — added `diagnose` case with a thorough
    `pageAssert` that walks every field of the snapshot.
  - `test/visual/__screenshots__/diagnose.png` — new baseline.
  - `package.json` — version bump to `5.0.0-dev.48`.

## Before

```
package           masonry-pretext@5.0.0-dev.47

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                    53296       16447       14264      1192
  dist/masonry.pkgd.js                   57166       11021        9889      1553
  dist/masonry.pkgd.min.js               25813        8360        7553        19
  dist/masonry.cjs                       53952       10902        9796      1546
  dist/masonry.mjs                       55160       11391       10197      1570
```

## After

```
package           masonry-pretext@5.0.0-dev.48

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                    56149       17247       14933      1260
  dist/masonry.pkgd.js                   59257       11420       10235      1600
  dist/masonry.pkgd.min.js               26998        8679        7841        19
  dist/masonry.cjs                       55949       11310       10141      1593
  dist/masonry.mjs                       57157       11798       10560      1617
```

Test status: 22 visual + ssr + module + 11 compute-layout + 4 compute-layouts + no-jquery — all green.

## Delta

| Metric | Before | After | Δ | % |
|---|---:|---:|---:|---:|
| dist/masonry.pkgd.min.js raw  | 25813 | 26998 | **+1185** | +4.59% |
| dist/masonry.pkgd.min.js gzip |  8360 |  8679 |  **+319** | +3.82% |
| dist/masonry.pkgd.min.js br   |  7553 |  7841 |  **+288** | +3.81% |

Slightly above the predicted upper end (predicted 150-300, actual
319 gz). The breakdown:

- ~110 B for the diagnose function body (the conditional cascade
  for `observerStatus` + the `items.map` + the typed shape construction)
- ~60 B for the `proto.layout` wrapper (the closure + the timestamp
  assignment + the base call)
- ~30 B for the 4 `_lastRelayoutReason` assignments (each ~7-8 B
  with the string literal cost)
- ~120 B for the various string literals in the conditional cascade
  (`'wired (dynamicItems)'`, `'skipped (hybrid armed)'`, etc.) which
  don't compress well because they're each unique

## Verdict

⚠️ **Partial.** Cost lands at 319 B gz, slightly above the predicted
150-300 band. The dominant cost is the unique string literals in the
observer-status cascade — the cascade itself is small but each
status string adds ~15 B that doesn't compress with anything else.
Could be trimmed by collapsing the string variants (e.g., a single
`observerStatus: 'wired' | 'skipped'` field plus a separate
`reason: 'dynamicItems' | 'static' | 'hybrid'` field), but the
trade-off is consumer ergonomics (a single human-readable string
is easier to log than two booleans). Shipping as-is; revisit in a
simplify pass if the bytes matter for v5.0.0.

## Notes / lessons

- **The biggest cost is human-readable strings.** Each of the
  observer-status variants (`'wired'`, `'wired (dynamicItems)'`,
  `'skipped (static mode)'`, etc.) is a unique literal that the
  minifier can't deduplicate. Compressed gz cost is dominated by
  these strings, not by the diagnose code itself.
- **`proto.layout` wrapper is load-bearing.** Without it, there's
  no central place to record the layout timestamp. Wrapping it
  costs ~60 B but is the cleanest way to track every layout pass
  regardless of who triggered it.
- **The 4 `_lastRelayoutReason` assignments** could be simplified
  by passing the reason as an arg to `layout()`, but `layout()` is
  the public API and adding an arg would either break the
  signature or require an opt-in. The assign-then-call pattern is
  uglier but contained.
- **The diagnose result contains live `Element` references.**
  Calling `JSON.stringify(diagnostic)` won't work directly because
  DOM elements aren't serializable. Documented in the JSDoc.
- **Tier 3 closeout starts here.** D.11 is the last Tier 3 item
  before D.8 (the Astro subpath, which is more of a packaging
  exercise than a code change).
