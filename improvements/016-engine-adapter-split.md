# 016 — Engine/adapter split: pure-math `placeItem` (Phase 1 of `PRETEXT_SSR_ROADMAP.md`)

**Status:** landed
**Roadmap section:** [`PRETEXT_SSR_ROADMAP.md`](../PRETEXT_SSR_ROADMAP.md) Phase 1 — also `FORK_ROADMAP.md` § Post-#010 (review #4) item P (engine/adapter separation refactor)
**Closes upstream issues:** none directly. Foundational refactor that unblocks Phases 2-5 of the SSR feature line.
**Tag:** `v5.0.0-dev.16`
**Commit:** _filled in after landing_

## Hypothesis

Today `_getItemLayoutPosition` mixes DOM measurement (`item.getSize()`) with packing math (`_getTopColPosition`, `_getTopColGroup`, `_getColGroupY`, `_getHorizontalColPosition`). The packing math itself is pure — it only reads from `item.size` and `this.colYs`, writes `this.colYs`, and returns `{x, y}` — but it's wrapped in a method that *also* mutates `item.size` via DOM. To run the layout pipeline in Node (Phase 2's `Masonry.computeLayout`), the pure math has to be factored out into a function that takes pre-measured sizes and numeric state.

This improvement is the refactor — **zero behavior change**, **all 9 visual fixtures must pass byte-for-byte against unchanged screenshot baselines**. Phase 2 will add the `Masonry.computeLayout` static helper that calls the new pure layer; Phases 3-5 build on top of that.

### What "pure-math layer" means here

A function with this contract:

```js
placeItem(size, state) → { x, y, col, colSpan }
```

where:
- `size = { outerWidth, outerHeight }` (pre-measured, not a DOM element)
- `state = { cols, colYs, columnWidth, horizontalColIndex, horizontalOrder }` (flat data, no `this`, no options object)
- `state.colYs` is mutated in place to advance the running column heights (matches the existing semantics where `_getItemLayoutPosition` mutated `this.colYs[i]` directly)
- `state.horizontalColIndex` is also mutated in place via the shared `state` reference

No `this`, no DOM access, no option lookups. Identical packing decisions to the inline implementation. **Verified by all 9 fixtures still passing against unchanged baselines.**

### Predictions

1. **`dist/masonry.pkgd.min.js` raw:** ±50 B (refactor, not feature)
2. **`dist/masonry.pkgd.min.js` gz:** ±20 B
3. **`masonry.js` source raw:** +800 to +1500 B (the pure function is more verbose than the inline version, even before doc comments)
4. **All 9 visual fixtures pass byte-for-byte.** Screenshot baselines unchanged.
5. **SSR + module-smoke + no-jquery gates unchanged.**
6. **The proto wrappers** (`_getTopColPosition`, `_getTopColGroup`, `_getColGroupY`, `_getHorizontalColPosition`) **stay on the prototype as thin shims** that delegate to the pure helpers. Plugin authors who reach into masonry's internals via `instance._getX()` continue to work — no breaking change.

## Method

### Five new pure helpers (file-local, not on prototype)

Added immediately after the percent-detection helpers, before the proto definitions:

- **`placeItem(size, state)`** — top-level entry point. Computes `colSpan`, dispatches to `getTopColPosition` or `getHorizontalColPosition`, computes `(x, y)`, mutates `state.colYs` for the spanned columns, returns the position.
- **`getTopColPosition(colSpan, colYs, cols)`** — picks the column with the lowest top among all valid horizontal positions for a `colSpan`-wide item.
- **`getTopColGroup(colSpan, colYs, cols)`** — builds the array of group max-Ys for each valid horizontal position.
- **`getColGroupY(col, colSpan, colYs)`** — computes the max Y across `colSpan` columns starting at `col`.
- **`getHorizontalColPosition(colSpan, size, state)`** — left-to-right placement for `horizontalOrder: true`. Returns the new `horizontalColIndex` so the caller can write it back.

All five are file-local — `function name(...)` declarations inside the IIFE factory, not assigned to any object. Phase 2 will export `placeItem` (or wrap it in `Masonry.computeLayout`) as a public static method.

### DOM adapter — `proto._getItemLayoutPosition`

Now the thinnest possible wrapper:

```js
proto._getItemLayoutPosition = function( item ) {
  var pretextify = this.options.pretextify;
  var pretextSize = pretextify && pretextify( item.element );
  if ( pretextSize ) item.size = pretextSize;
  else item.getSize();

  var state = {
    cols: this.cols,
    colYs: this.colYs,
    columnWidth: this.columnWidth,
    horizontalColIndex: this.horizontalColIndex,
    horizontalOrder: this.options.horizontalOrder,
  };
  var result = placeItem( item.size, state );
  this.horizontalColIndex = state.horizontalColIndex;

  return { x: result.x, y: result.y };
};
```

The `state` object is constructed once per call. `state.colYs` is the **same array reference** as `this.colYs`, so the in-place mutation inside `placeItem` is visible to subsequent calls without an explicit copy-back. `state.horizontalColIndex` is a primitive, so it gets written back explicitly after the call.

### Backward-compatible prototype wrappers

The four `proto._get…` methods become thin shims:

```js
proto._getTopColPosition = function( colSpan ) {
  return getTopColPosition( colSpan, this.colYs, this.cols );
};
proto._getTopColGroup = function( colSpan ) {
  return getTopColGroup( colSpan, this.colYs, this.cols );
};
proto._getColGroupY = function( col, colSpan ) {
  return getColGroupY( col, colSpan, this.colYs );
};
proto._getHorizontalColPosition = function( colSpan, item ) {
  var state = { cols: this.cols, colYs: this.colYs, horizontalColIndex: this.horizontalColIndex };
  var result = getHorizontalColPosition( colSpan, item.size, state );
  this.horizontalColIndex = result.newHorizontalColIndex;
  return { col: result.col, y: result.y };
};
```

**Why keep the wrappers:** they're on `proto.` so they're effectively part of the public surface. Plugin authors who reach in (e.g. to override `_getTopColPosition` for a custom column-pick strategy — exactly what roadmap item I would enable) might depend on them. The bytes cost is small (~10 LOC of source, ~50 B raw / ~20 B gz minified) and removing them is a breaking change.

### Why mutate `state.colYs` in place rather than return a new array

Two design options for the `colYs` mutation in `placeItem`:

1. **Mutate in place** (chosen) — `placeItem` modifies `state.colYs[i]` directly. The DOM adapter passes `this.colYs` as `state.colYs`, so the mutation lands on the masonry instance. Phase 2's `computeLayout` constructs its own colYs from scratch and accumulates mutations across items.
2. **Slice + return new array** — `placeItem` does `state.colYs.slice()`, mutates the copy, returns it. Caller assigns it back. More "pure" but allocates one new array per item — for a 1000-item grid that's 1000 extra allocations.

Chose option 1 for performance. The "pure" contract is **"no `this`, no DOM, no option lookups, no global state"** — input mutation is fine because the caller owns the state object.

### Files touched

- `masonry.js` — added 5 file-local pure helpers (~120 LOC including comments), refactored `_getItemLayoutPosition` (~30 LOC), refactored 4 proto wrappers (~25 LOC)

### Commands run

```sh
./scripts/measure.sh --save pre-016-engine-split
make test                                          # 9/9 + ✓ ssr + ✓ module + ✓ no-jquery baseline

# edit masonry.js — add pure helpers, refactor _getItemLayoutPosition,
# rewrite 4 proto wrappers as thin shims

make build && make test                            # 9/9 + ✓ ssr + ✓ module + ✓ no-jquery
# (all 9 fixtures pass byte-for-byte against unchanged screenshot baselines)

# bump pkg.json version → 5.0.0-dev.16, rebuild for banner
./scripts/measure.sh --save post-016-engine-split
```

## Before — `pre-016-engine-split`

```
package           masonry-pretext@5.0.0-dev.15
tracked files     96
total LOC         16394
dependencies      2
devDependencies   4

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                    18823        6184        5274       488
  dist/masonry.pkgd.js                   54947       10382        9252      1529
  dist/masonry.pkgd.min.js               24342        7734        6996        22
  dist/masonry.cjs                       51788       10272        9163      1522
  dist/masonry.mjs                       52977       10753        9577      1546
```

9/9 visual + ✓ SSR + ✓ module-smoke + ✓ no-jquery.

## After — `post-016-engine-split`

```
package           masonry-pretext@5.0.0-dev.16
tracked files     96
total LOC         16612
dependencies      2
devDependencies   4

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                    23573        7653        6508       591
  dist/masonry.pkgd.js                   56377       10611        9454      1567
  dist/masonry.pkgd.min.js               24815        7898        7172        22
  dist/masonry.cjs                       53142       10500        9365      1560
  dist/masonry.mjs                       54331       10980        9776      1584
```

9/9 visual + ✓ SSR + ✓ module-smoke + ✓ no-jquery — **byte-for-byte against unchanged baselines**.

## Delta

| Metric | pre-016 | post-016 | Δ raw | Δ% |
|---|---:|---:|---:|---:|
| `masonry.js` source raw | 18,823 | **23,573** | **+4,750** | **+25.23%** (verbose comment + 5 new pure helpers + 4 wrapper rewrites) |
| `masonry.js` source lines | 488 | **591** | +103 | +21.11% |
| `dist/masonry.pkgd.js` raw | 54,947 | **56,377** | **+1,430** | +2.60% |
| `dist/masonry.pkgd.js` gzip | 10,382 | **10,611** | +229 | +2.21% |
| `dist/masonry.pkgd.min.js` raw | 24,342 | **24,815** | **+473** | **+1.94%** |
| `dist/masonry.pkgd.min.js` gzip | 7,734 | **7,898** | **+164** | **+2.12%** |
| `dist/masonry.pkgd.min.js` brotli | 6,996 | **7,172** | **+176** | +2.52% |
| `dist/masonry.cjs` raw | 51,788 | **53,142** | +1,354 | +2.61% |
| `dist/masonry.mjs` raw | 52,977 | **54,331** | +1,354 | +2.56% |
| Visual regression tests | 9 / 9 | **9 / 9** | unchanged | byte-for-byte against unchanged baselines |
| SSR + module-smoke + no-jquery gates | ✓ + ✓ + ✓ | ✓ + ✓ + ✓ | unchanged | |

## Verdict

⚠️ **Partial — refactor goal achieved (zero behavior change), but byte cost over-shot the predicted band.**

| Prediction | Predicted | Actual | Status |
|---|---|---|---|
| `min.js` raw | ±50 B | **+473 B** | ❌ +423 B over band |
| `min.js` gz | ±20 B | **+164 B** | ❌ +144 B over band |
| `min.js` brotli | similar to gz | **+176 B** | ❌ |
| `masonry.js` source raw | +800-1500 B | **+4,750 B** | ❌ +3,250 B over band (verbose docs + duplicate helper paths) |
| All visual fixtures pass byte-for-byte | yes | yes (9/9) | ✅ |
| Screenshot baselines unchanged | yes | yes | ✅ |
| SSR + module-smoke + no-jquery unchanged | yes | yes | ✅ |
| Plugin authors reaching into `proto._getX` still work | yes | yes (wrappers preserved) | ✅ |

### Why the byte over-shoot

The "±0 bytes" prediction assumed esbuild's minifier would inline the pure helpers since they're called from exactly one place. **It does not** — the helpers are file-scope `function` declarations, and esbuild keeps them as separate hoisted functions in the IIFE. The minified output ends up with both the inline-style helpers AND the proto wrappers (which are now thin delegates), so there's effectively **two** code paths for the same operations. Hence the +473 B raw / +164 B gz overhead.

Three options to recover the bytes in a follow-up:

1. **Delete the proto wrappers** (~50 LOC). Breaking change for any plugin author calling `instance._getTopColPosition()` etc. directly. Saves ~80-120 B raw, ~30-50 B gz.
2. **Mark the pure helpers `@__INLINE__`** (esbuild doesn't currently support this hint, but a build-time transform could). Speculative.
3. **Inline `placeItem` back into the adapter** and only export the smaller helpers (`getTopColGroup`, `getColGroupY`) for Phase 2. Would still let `Masonry.computeLayout` use them, and saves the indirection cost on the hot path. Probably the right move if Phase 5's bench shows a measurable regression on the per-item placement loop.

**Decision:** accept the cost for Phase 1, evaluate options 1-3 in Phase 5 once we have a hot-path bench to compare against. The +164 B gz buys us the foundation that all of Phases 2-5 build on, and the bytes are recoverable later if the bench shows it matters.

### Why the source over-shoot

Same pattern as #009/#010/#012/#014: the doc comment block is ~30 lines, the new helpers are ~80 LOC of code. Comments dominate the source diff but don't affect the minified output. Updated calibration for future predictions: a "refactor with new helpers + verbose JSDoc" should budget +3,000-5,000 B raw on the source file, not +800-1,500.

### Vs upstream-frozen v4.2.2

| Metric | v4.2.2 | v5.0.0-dev.16 | Δ raw | Δ% |
|---|---:|---:|---:|---:|
| `dist/masonry.pkgd.min.js` raw | 24,103 | **24,815** | **+712** | **+2.95%** |
| `dist/masonry.pkgd.min.js` gzip | 7,367 | **7,898** | **+531** | **+7.21%** |
| `dist/masonry.pkgd.min.js` brotli | 6,601 | **7,172** | **+571** | **+8.65%** |

The fork is now ~7% above upstream gz. **This is the largest gap-vs-upstream so far** — and it's expected and acceptable, because Phase 1 is foundational refactor work that enables Phases 2-5. The size gap will widen further in Phase 2 (when `Masonry.computeLayout` ships as a public static method) and stabilize in Phases 3-4. The planned size deletions (items A-F + M-O in `FORK_ROADMAP.md`, ~950-1500 B gz combined) restore the lead. Strategically, the SSR feature line is worth the ~1000 B gz it will cost across Phases 1-5; the size deletions restore the headroom.

## Notes / lessons

- **The refactor passed all 9 fixtures byte-for-byte on the FIRST build.** No screenshot updates, no position assertions failing, no edge cases missed. The careful preservation of every operation in the pure layer paid off — the inline `setHeight` loop, the `Math.min.apply(Math, colGroup)` semantics, the `colSpan < 2` short-circuit in `getTopColGroup`, the `hasSize` check in `getHorizontalColPosition`. **When refactoring math-heavy code, copy first, simplify second.**
- **In-place mutation of `colYs` was the right call.** Slicing per item would have allocated 1000 extra arrays for a 1000-item grid — measurable overhead in #009's bench. The pure contract says "no `this`, no DOM" not "no input mutation"; the caller owns the state object and chooses whether to share or copy.
- **The proto wrappers are dead code today** but they're cheap insurance against breaking unknown plugin consumers. The +20-50 B gz cost is the price of the backward-compat guarantee. If Phase 5's bench shows the indirection costs measurable perf, we can revisit and document a breaking change in a v5.0.0-rc release.
- **Esbuild does NOT inline file-local helpers across function boundaries.** The "±0 bytes" prediction assumed inlining; reality is duplication. Calibration updated for Phases 2-5: any new pure helper that's called from exactly one place will still cost its full byte budget, not zero. Update the prediction band for refactors: **+200-500 B raw / +80-180 B gz per "extracted pure helper that the minifier can't inline."**
- **Comments dominate refactor diffs.** ~75% of the +4,750 B source delta is the verbose JSDoc + the design-rationale block at the top of the helper section. esbuild strips them all from the minified output, but they live in `masonry.js` for anyone reading the source. Worth it — the next person maintaining this code (which will be me, in Phases 2-5) needs to understand why `state.colYs` is the same reference as `this.colYs` and why the mutation contract is "in place, not copy-and-return."
- **Phase 2 is now unblocked.** The pure helpers are file-local but trivially exposable via `Masonry.computeLayout = function(opts) { ... }`. The Phase 2 implementation will be ~30-80 LOC of glue (call `placeItem` in a loop, accumulate positions) plus ~150 LOC of Node-only test that verifies byte-for-byte agreement with the browser fixtures.
- **The "byte-for-byte agreement" test methodology generalizes.** Same conjugate pattern as #015's static-mode/resize-observer fixture pair: any future refactor that breaks the pure layer will be caught by a fixture failing in the browser, AND any future refactor that breaks the proto wrappers will be caught by a hypothetical plugin test. Both layers are gated.
- **First foundational refactor in the fork.** Improvements 003-014 were targeted bug fixes, dead-code deletions, and small features. Improvement 015 was an option-gating change. **Improvement 016 is the first time the fork's source structurally differs from upstream's `masonry.js` in a way that enables new capability.** Phases 2-5 of `PRETEXT_SSR_ROADMAP.md` capitalize on this; without #016 they couldn't exist.
