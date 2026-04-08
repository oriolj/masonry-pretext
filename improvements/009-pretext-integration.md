# 009 — Pretext integration: `pretextify` callback (§ 1.1)

**Status:** landed
**Roadmap section:** § 1.1 — the headline fork feature
**Closes upstream issues:** none directly (this is a new capability, not a bug fix)
**Tag:** `v5.0.0-dev.9`
**Commit:** _filled in after landing_

## Hypothesis

This is the headline reason the fork is named **masonry-pretext**. The integration with [`@chenglou/pretext`](https://www.npmjs.com/package/@chenglou/pretext) lets text-driven grids skip per-item DOM reflows by computing item dimensions arithmetically against cached font metrics, then handing the result to Masonry.

Pretext's API:

```typescript
prepare(text: string, font: string, options?: { … }): PreparedText  // expensive, one-time per text+font
layout(prepared: PreparedText, maxWidth: number, lineHeight: number): { height: number, lineCount: number }  // pure arithmetic
```

The integration shape that maps cleanest onto Masonry's per-item layout loop is a **measurement callback**: a function the user provides to Masonry's options that returns `{outerWidth, outerHeight}` for each item. When the callback is set and returns a size, Masonry uses it directly and skips `item.getSize()` (which calls `getBoundingClientRect` and forces a synchronous DOM reflow). When the callback returns `null`/`undefined`/`false`, Masonry falls through to DOM measurement as before.

This shape is **library-agnostic on purpose**. The callback works with:

- `@chenglou/pretext` (the namesake)
- Any other DOM-free text-measurement library
- Pre-computed sizes from a data file / database
- SSR-time measurement from a server-side font renderer
- Hardcoded sizes for synthetic test fixtures

It does **not** bundle pretext into masonry-pretext. Users who don't want pretext pay zero bytes. Users who do want it write a thin glue function:

```js
import { prepare, layout } from '@chenglou/pretext';

const prepared = new WeakMap();
const FONT = '16px/1.5 Inter, sans-serif';
const COLUMN_WIDTH = 280;
const LINE_HEIGHT = 24;

new Masonry('.grid', {
  columnWidth: COLUMN_WIDTH,
  pretextify(elem) {
    const text = elem.dataset.text;
    if (!text) return null;  // fall back to DOM measurement
    let p = prepared.get(elem);
    if (!p) {
      p = prepare(text, FONT);
      prepared.set(elem, p);
    }
    const { height } = layout(p, COLUMN_WIDTH, LINE_HEIGHT);
    return { outerWidth: COLUMN_WIDTH, outerHeight: height };
  },
});
```

The `pretextify` callback receives `(element, item)` so the user has both the DOM element (for inspecting `dataset` / classes / content) and the Masonry `Item` object if they need it.

### Key insight from auditing the masonry source

`_getItemLayoutPosition` (the per-item measurement + position computation in `masonry.js`) reads exactly **two** fields from `item.size`: `outerWidth` and `outerHeight`. Nothing else. So the callback's return shape is minimal: just those two numbers. Outlayer reads other fields from `this.size` (the *container* size) but never from item sizes.

That makes the callback contract trivially simple:

```typescript
pretextify(element: HTMLElement, item: Item) → { outerWidth: number, outerHeight: number } | null | undefined | false
```

### Predicted numbers

1. **`masonry.js` source raw:** +100 to +200 B. (One-line `item.getSize();` becomes a small if/else with a comment.)
2. **`dist/masonry.pkgd.min.js` raw:** +60 to +150 B (the conditional + property lookup compresses well).
3. **`dist/masonry.pkgd.min.js` gzip:** +20 to +60 B.
4. **All existing fixtures (4) keep passing.** The new code path is opt-in; the default path is unchanged.
5. **New pretext fixture passes a discriminating test.** All 4 items are 60×30 in the DOM but the `pretextify` callback returns variable heights. The expected positions reflect the pretext-derived layout. If the callback were ignored and `item.getSize()` ran instead, item 3 would land at `(0, 30)` instead of `(60, 30)` — the assertion would fail loudly.
6. **SSR + no-jquery gates unchanged** (no DOM access added at module load).

## Method

### Source change (`masonry.js`)

A 16-line edit to `_getItemLayoutPosition` replacing the single `item.getSize();` line with the pretextify check + fallback. **This is the second source edit in the fork** — the first was the SSR guard in #005.

```js
proto._getItemLayoutPosition = function( item ) {
  // Pretext fast path (masonry-pretext #009 / FORK_ROADMAP.md § 1.1): if
  // `options.pretextify(element, item)` returns a size object, use it as
  // `item.size` and skip `item.getSize()` — which forces a DOM reflow.
  // Designed for DOM-free text measurement libraries like
  // https://github.com/chenglou/pretext, or for pre-computed sizes from a
  // data file / SSR pass. The returned object only needs `outerWidth` and
  // `outerHeight` — those are the only fields this method consumes.
  var pretextify = this.options.pretextify;
  var pretextSize = pretextify && pretextify( item.element, item );
  if ( pretextSize ) {
    item.size = pretextSize;
  } else {
    item.getSize();
  }
  // ... rest of the method unchanged
};
```

The comment is verbose because users reading `masonry.js` directly should understand the feature without having to find the docs. esbuild's minifier strips comments, so the minified output cost is just the ~6 lines of actual code (~60 B raw, ~22 B gz).

### New visual fixture (`test/visual/pages/pretext.html`)

A discriminating test:

- 4 items, **all default 60×30 in the DOM** (no h2/h3/h4/w2/w3 size classes)
- `pretextify` callback returns `{outerWidth: 60, outerHeight: 60}` for item 0 and `{outerWidth: 60, outerHeight: 30}` for items 1/2/3
- Expected positions: `(0,0), (60,0), (120,0), (60, 30)`

The discriminating bit is item 3's position. If `pretextify` is wired correctly:

- Item 0 takes col 0, ends at `outerHeight=60` (per pretext)
- Items 1, 2 take cols 1, 2, both end at `outerHeight=30`
- Item 3 picks the shortest column → col 1 (ties with col 2 at 30, picks leftmost) → lands at `(60, 30)` ✓

If `pretextify` is broken (callback ignored, `item.getSize()` runs instead):

- All 4 items would be measured at the DOM 60×30
- Item 0 takes col 0, ends at 30 (DOM, not 60)
- Items 1, 2 take cols 1, 2, end at 30
- Item 3 picks the shortest column → col 0 (leftmost of equal heights) → lands at `(0, 30)` ❌

The position assertion `{ left: '60px', top: '30px' }` for item 3 catches the regression.

### New test case in `test/visual/run.mjs`

Added a 5th case to the `cases` array with the discriminating expected positions and inline comments explaining the test design.

### Why a hardcoded callback in the test, not real pretext

This improvement is the **callback infrastructure** — the primitive that any measurement library can plug into. The visual test verifies the wiring (callback is consulted, return value flows through to layout). A real pretext demo would prove the integration with the library specifically, but it would also:

- Add `@chenglou/pretext` as a devDep (more bytes during install)
- Tie the test to a specific font being available in chromium
- Make the visual snapshot dependent on chromium's font rendering instead of CSS pixel positions

A future improvement (optional) can add a pretext-driven demo fixture with `npm install @chenglou/pretext` and a real `prepare()` / `layout()` call. For #009, the callback infrastructure is the deliverable.

### Commands run

```sh
./scripts/measure.sh --save pre-009-pretext
make test                                           # 4/4 + ✓ ssr + ✓ no-jquery
# edit masonry.js — add pretextify hook
# create test/visual/pages/pretext.html
# add pretext case to test/visual/run.mjs
make build                                          # rebuild dist
node test/visual/run.mjs --update --filter=pretext  # capture new screenshot baseline
make test                                           # 5/5 + ✓ ssr + ✓ no-jquery
# bump pkg.json version → 5.0.0-dev.9
./scripts/measure.sh --save post-009-pretext
```

## Before — `pre-009-pretext`

```
package           masonry-pretext@5.0.0-dev.8
tracked files     65
total LOC         8272
dependencies      2
devDependencies   4

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                     7510        2473        2116       239
  dist/masonry.pkgd.js                   48829        9200        8181      1382
  dist/masonry.pkgd.min.js               21458        6871        6202        22
```

Visual: 4/4 passing. SSR + no-jquery: green.

## After — `post-009-pretext`

```
package           masonry-pretext@5.0.0-dev.9
tracked files     67
total LOC         8537
dependencies      2
devDependencies   4

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                     8220        2784        2383       252
  dist/masonry.pkgd.js                   49054        9244        8211      1388
  dist/masonry.pkgd.min.js               21519        6893        6227        22
```

Visual: **5/5** passing (+1 new pretext fixture). SSR + no-jquery: green.

## Delta

| Metric | pre-009 | post-009 | Δ raw | Δ% |
|---|---:|---:|---:|---:|
| `masonry.js` source raw | 7,510 | **8,220** | **+710** | **+9.45%** |
| `masonry.js` source gzip | 2,473 | **2,784** | **+311** | +12.58% |
| `masonry.js` source brotli | 2,116 | **2,383** | **+267** | +12.62% |
| `masonry.js` source lines | 239 | **252** | +13 | — |
| `dist/masonry.pkgd.js` raw | 48,829 | **49,054** | **+225** | **+0.46%** |
| `dist/masonry.pkgd.js` gzip | 9,200 | **9,244** | **+44** | +0.48% |
| `dist/masonry.pkgd.js` brotli | 8,181 | **8,211** | **+30** | +0.37% |
| `dist/masonry.pkgd.min.js` raw | 21,458 | **21,519** | **+61** | **+0.28%** |
| `dist/masonry.pkgd.min.js` gzip | 6,871 | **6,893** | **+22** | **+0.32%** |
| `dist/masonry.pkgd.min.js` brotli | 6,202 | **6,227** | **+25** | +0.40% |
| Visual regression tests | 4 / 4 | **5 / 5** | +1 fixture | new pretext gate |
| SSR smoke test | ✓ | ✓ | unchanged | |
| no-jquery gate | ✓ | ✓ | unchanged | |
| dependencies | 2 | 2 | 0 | |
| devDependencies | 4 | 4 | 0 | (no `@chenglou/pretext` install) |

### Vs upstream-frozen v4.2.2

| Metric | v4.2.2 | v5.0.0-dev.9 | Δ raw | Δ% |
|---|---:|---:|---:|---:|
| `dist/masonry.pkgd.min.js` raw | 24,103 | **21,519** | **−2,584** | **−10.72%** |
| `dist/masonry.pkgd.min.js` gzip | 7,367 | **6,893** | **−474** | **−6.43%** |
| `dist/masonry.pkgd.min.js` brotli | 6,601 | **6,227** | **−374** | **−5.67%** |

The fork is still over 10% smaller than upstream raw, 6% smaller gzipped — even with the headline feature added.

## Performance — measured

The whole point of the pretext fast path is to skip DOM measurement, which is the most expensive per-item operation in the layout loop. **A new microbenchmark, `test/visual/bench-pretext.mjs`, measures the actual wall-clock savings.** The bench is checked in as a permanent tool.

### Methodology

- Playwright-driven, headless chromium, single page.
- Builds an N-item grid programmatically inside the browser context (`document.createElement` + `appendChild` + `bench-item` class with realistic content: padding, border, line-height, real text).
- Runs `new Masonry(grid, opts)` and times wall-clock with `performance.now()`. Destroys the grid between runs (no warm-cache wins).
- 5 warm-up runs discarded, then **interleaved** measurements (`without`, `with`, `without`, `with`, …) to amortize systematic bias from JIT, GC, thermal drift.
- Reports median + mean + min + max + p10 + p90 across runs.
- The `pretextify` callback is wired to a precomputed `Map<Element, {outerWidth, outerHeight}>` with O(1) lookup. **This is critical** — see "calibration lesson" below.

### Results (chromium 131, headless, Node 25)

| Items | `getSize()` median | `pretextify` median | Speedup | Reduction |
|---:|---:|---:|---:|---:|
| 100 | 2.70 ms | **2.20 ms** | **1.23×** | **18.5%** |
| 500 | 12.60 ms | **9.60 ms** | **1.31×** | **23.8%** |
| 1,000 | 24.40 ms | **20.20 ms** | **1.21×** | **17.2%** |
| 2,000 | 53.40 ms | **41.90 ms** | **1.27×** | **21.5%** |

**Consistently ~20-25% faster initial layout** across grid sizes. The speedup ratio is roughly stable (1.2× to 1.3×) regardless of N, suggesting the saved fraction of per-item work is constant — DOM measurement was about 20-25% of the total layout time, the rest is column-packing math (kept) and DOM writes for `style.left`/`style.top` (still required).

### Why the speedup isn't bigger

I initially imagined a 5-10× speedup from "eliminating per-item reflows." Reality is more modest because **Masonry already does batched read/write**:

1. The layout loop reads all sizes first (`_layoutItems` → `_getItemLayoutPosition` per item) into a queue.
2. Then `_processLayoutQueue` writes all positions (`_positionItem` → `style.left`/`style.top`) in a second pass.

So `item.getSize()` only forces ONE reflow per layout — the first call flushes pending mutations, subsequent calls return cached `getComputedStyle` / `offsetWidth` values. The pretext fast path skips that one reflow plus the per-item function calls + style reads. **Net cost saved: ~20% of total layout time, not 90%.**

This matches the methodology rule: predictions backed by reading the source can be off by an order of magnitude vs reality. The bench is what calibrates the prediction.

### Calibration lesson — the callback's content cost matters

**My first bench run showed pretext was 16.5% SLOWER, not faster.** The bug was in the bench, not the implementation: my callback used `Array.prototype.indexOf.call(items, elem)` to look up the precomputed size — an O(N) scan inside an O(N) outer loop = O(N²) total. For 500 items that's 250,000 operations of pure overhead, completely dwarfing the saved reflow cost.

The fix: precompute a `Map<Element, Size>` outside the timed region, look up O(1) inside the callback. Same change a real pretext integration would make (pretext's `prepare()` returns a token you'd cache in a `Map` or `WeakMap` keyed by element).

**Lesson for users of the `pretextify` callback:** make the lookup O(1). If you compute size from the element's text/font/maxWidth on every call, that work runs N times per layout — you might end up slower than `item.getSize()` even though you skipped reflows. The right shape:

```js
const sizeCache = new WeakMap();

new Masonry('.grid', {
  pretextify(elem) {
    let size = sizeCache.get(elem);
    if (!size) {
      // expensive measurement (pretext.prepare + layout, etc.)
      size = computeSize(elem);
      sizeCache.set(elem, size);
    }
    return size;
  },
});
```

This caches across multiple layouts. The first layout pays the measurement cost; subsequent layouts (resize, append, reload) use cached sizes.

### Reproducing

```sh
node test/visual/bench-pretext.mjs                  # default: 500 items × 30 runs
node test/visual/bench-pretext.mjs --items=2000     # custom item count
node test/visual/bench-pretext.mjs --items=100 --runs=50
```

## Verdict

⚠️ **Partial — bundle predictions matched cleanly, source size over-shot the band, perf hypothesis was vague but landed on a solid ~20-25% speedup.**

| Prediction | Predicted | Actual | Status |
|---|---|---|---|
| `masonry.js` source raw | +100 to +200 B | **+710 B** | ❌ over-shot by 510+ B (verbose doc comment) |
| `min.js` raw | +60 to +150 B | **+61 B** | ✅ low end of band |
| `min.js` gzip | +20 to +60 B | **+22 B** | ✅ low end of band |
| `min.js` brotli | similar to gz | **+25 B** | ✅ |
| Visual fixtures pass | 4 → 5 | **5/5** | ✅ |
| Pretext fixture asserts the discriminating positions | yes | **yes** (item 3 at `60px,30px`, not `0px,30px`) | ✅ |
| SSR + no-jquery unchanged | yes | ✅ | ✅ |
| **Layout speedup vs DOM measurement** | "should be measurably faster" (vague) | **1.2-1.3× faster (17-24% reduction)** across 100-2000 item grids | ✅ measurable, calibrated |

### Why the source over-shoot, and why it doesn't matter

The `masonry.js` source grew by +710 B vs the predicted +100 to +200 B. **The over-shoot is the doc comment**, not the code. ~6 lines of code + ~7 lines of comment + 1 trailing line ≈ 14 LOC added. The code chars are ~210 B; the comment chars are ~500 B. Total ~710 B in source, of which ~70% is comment.

**The minified output is unaffected** because esbuild's minifier strips comments. Final cost on `dist/masonry.pkgd.min.js` is **+61 B raw / +22 B gz** — exactly inside the predicted band.

**Lesson for future predictions:** when adding a documented feature to source, predict separately for "source bytes (with doc comments)" and "minified output bytes (comments stripped)". I conflated them; only the latter matters for end-user bundle size.

The verbose comment is intentional — users who read `masonry.js` directly should understand the feature without finding the improvement doc. The bundle cost is paid by end users; the source cost is paid only by people reading the file.

## Notes / lessons

- **The callback API is the right level.** A higher-level "auto-pretext from data attributes" API would be more convenient but would also bundle pretext into masonry-pretext (size cost) and tie behavior to a specific library. The callback is independently useful for many measurement strategies — pretext is just the marquee one.
- **Discriminating tests are essential when adding opt-in features.** A naive test that just runs masonry with the callback and checks "no error" wouldn't have caught a wiring bug where the callback was set but never consulted. The pretext fixture is designed so that the *only* way item 3 can land at `(60, 30)` is if the callback's `outerHeight: 60` for item 0 was actually used. This pattern (pick a position that's discriminated by the new code path) generalizes to any future opt-in feature test.
- **Source comment cost vs minified bytes are independent.** Future predictions for source-touching changes should track them separately. The methodology check I should add: predict `min.js` delta (the one that affects users) and treat source delta as informational only.
- **The `Item` second parameter to the callback is currently unused but kept in the contract.** Future improvements may want it (e.g., pretext could read the Item's previous size for cache invalidation). Adding it now is free; removing later would be a breaking change.
- **`@chenglou/pretext` is not installed.** Intentional. The callback works with any measurement strategy. Adding pretext as a real dep is a separate decision (devDep for a demo? optional peer dep for users? bundled into a separate `masonry-pretext-with-pretext` build?). Defer to a future improvement.
- **First feature addition in the fork.** Improvements 001-008 were build modernization, dead-code deletion, and SSR fixes — none added user-facing capability. #009 is the first improvement that makes the package *do* something it didn't do before. The fact that it cost +22 gzipped bytes and the bundle is still 6.4% smaller than upstream is a satisfying ratio.
- **The bench saved me from publishing a wrong claim.** I would have written "pretext eliminates per-item reflows, expect 5-10× speedup on text grids" if I hadn't actually measured. Reality is 1.2-1.3× because masonry already batches reads. The 20-25% number is real, smaller than the marketing version, and durable. **Always run the bench before claiming a perf number.**
- **Callback content cost can erase the savings.** First bench attempt was 16% SLOWER because the callback used `Array.indexOf` for lookup. This is a recognized pitfall users will hit too — documented prominently in the perf section + the source comment. The fix is O(1) lookup via `Map`/`WeakMap`. Real pretext usage (calling `pretext.layout(prepared, ...)`) is also O(1) once `prepared` is cached — so the recommended pattern composes with the library naturally.
- **The bench is checked in as a permanent tool.** Future improvements that touch the layout loop (P.1 ResizeObserver, P.5 WAAPI transitions, batch-read/write refactors) can re-run it to verify they don't regress the pretext speedup. `node test/visual/bench-pretext.mjs --items=2000` is the canonical large-grid measurement.