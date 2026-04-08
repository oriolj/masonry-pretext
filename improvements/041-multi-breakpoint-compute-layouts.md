# 041 — `Masonry.computeLayouts(opts, breakpoints[])`

**Status:** landed
**Roadmap section:** § Downstream consumer asks · D.1
**Closes upstream issues:** none (downstream responsive SSR enabler)
**Commit(s):** 5.0.0-dev.41

## Hypothesis

Add a multi-breakpoint helper that wraps `Masonry.computeLayout` in a
per-breakpoint loop and returns a `{ name → ComputeLayoutResult }` map.
The motivation is responsive SSR: the server doesn't know which
breakpoint a viewer is on, so it computes layouts for ALL of them up
front and emits each set in the rendered HTML; the client picks the
right one via `matchMedia`.

This is a thin wrapper. The hard part of the SSR feature line was
`Masonry.computeLayout` itself (#017). The "multi-breakpoint" version
is a 5-line `for` loop over the existing helper.

**Predictions:**

- **Cost:** ~50-100 B gzipped on `dist/masonry.pkgd.min.js`. Just the
  loop body + the `Object.assign` per-breakpoint spread + the
  result-key write.
- **Test gate:** new `compute-layouts.mjs` Node-only test. Four cases:
  (1) per-breakpoint result agrees byte-for-byte with a direct
  `computeLayout` call with the same inputs, (2) cols actually differ
  per breakpoint (catches accidental result-reuse), (3) base `opts`
  fields like `fitWidth` propagate, (4) per-breakpoint `gutter`
  override wins over the base `gutter`.
- **Behavior:** the helper does NOT rewrite item sizes. Consumers
  whose item heights depend on per-breakpoint column width must
  recompute the items themselves before calling — that's a separate
  helper (D.3 / `itemSizer`), out of scope here.

## Method

- Files touched:
  - `masonry.js` — added `Masonry.computeLayouts` after
    `Masonry.computeLayout`. Implementation is a `for` loop that
    spreads `opts` via `Object.assign` and overrides
    `containerWidth`/`columnWidth`/optionally `gutter` per breakpoint.
  - `masonry.d.ts` — added `Breakpoint` interface, `static
    computeLayouts(...)` method on the `Masonry` class.
  - `test/visual/compute-layouts.mjs` — new Node-only test with 4 cases.
  - `Makefile` — added `compute-layouts.mjs` to the `test` and
    `test-update` targets.
  - `package.json` — version bump to `5.0.0-dev.41`; added
    `test:compute-layouts` script and the new node invocation to the
    `test` script.
- Commands run:
  - `make build`
  - `node test/visual/compute-layouts.mjs`
  - `make test` (full gate)
- Manual verification: ran the new test in isolation first, all 4
  cases passed on the first build (no debugging needed — the helper
  is so thin there's nothing to get wrong).

## Before

```
package           masonry-pretext@5.0.0-dev.40

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                    38176       12005       10399       909
  dist/masonry.pkgd.js                   52767       10249        9186      1444
  dist/masonry.pkgd.min.js               23564        7724        6966        19
  dist/masonry.cjs                       49771       10136        9084      1437
  dist/masonry.mjs                       50977       10622        9489      1461
```

Test status: 15 visual + ssr + module + 9 compute-layout + no-jquery — green.

## After

```
package           masonry-pretext@5.0.0-dev.41

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                    40599       12728       11025       951
  dist/masonry.pkgd.js                   53274       10344        9273      1457
  dist/masonry.pkgd.min.js               23799        7787        7045        19
  dist/masonry.cjs                       50252       10230        9179      1450
  dist/masonry.mjs                       51460       10717        9581      1474
```

Test status: 15 visual + ssr + module + 9 compute-layout + 4 compute-layouts + no-jquery — all green.

## Delta

| Metric | Before | After | Δ | % |
|---|---:|---:|---:|---:|
| dist/masonry.pkgd.min.js raw  | 23564 | 23799 | **+235** | +1.00% |
| dist/masonry.pkgd.min.js gzip |  7724 |  7787 | **+63**  | +0.82% |
| dist/masonry.pkgd.min.js br   |  6966 |  7045 | **+79**  | +1.13% |

Lands within the predicted 50-100 B gz band.

## Verdict

✅ **Match.** Cost lands at 63 B gz (predicted 50-100). All test gates
green; new compute-layouts gate added to the suite for permanent
coverage.

## Notes / lessons

- The helper is intentionally NOT a deduper. Calling `computeLayouts`
  with two breakpoints that resolve to the same `cols` / `columnWidth`
  still runs the placement loop twice. The math is fast enough
  (0.131 ms / 5000 items per #020 bench) that the saved complexity
  is worth more than the saved CPU.
- **`gutter` is the only optional per-breakpoint override.** I
  considered allowing every `ComputeLayoutOptions` field to be
  overridden per breakpoint, but couldn't think of a real use case
  for per-breakpoint `fitWidth` / `horizontalOrder` / `pickColumn`
  / `stamps`. The current API can be extended later if needed.
- **Item sizes are inherited as-is.** Consumers whose item heights
  depend on the per-breakpoint column width (because text reflows
  at narrower columns) must recompute the items themselves before
  calling. The right tool for that is D.3 (`itemSizer` callback),
  which is the next improvement.
- The new test gate (4 cases) catches the obvious regressions: the
  agreement check is the structural one — if a breakpoint result
  diverges from a direct `computeLayout` call with the same inputs,
  the helper has a bug. The "cols differ" check catches an
  accidental result-reuse bug (e.g., a closure-over-loop-variable
  mistake). The "options propagate" check catches a forgotten field.
  The "gutter override" check catches a wrong override.
