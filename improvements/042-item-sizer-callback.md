# 042 — `itemSizer(element, columnWidth) → MasonrySize` callback

**Status:** landed
**Roadmap section:** § Downstream consumer asks · D.3 ⭐ (highest leverage)
**Closes upstream issues:** none (downstream SSR pipeline enabler)
**Commit(s):** 5.0.0-dev.42

## Hypothesis

Add a generalized per-item size callback that runs in BOTH browser
(`new Masonry(grid, { itemSizer })`) and pure-Node (`Masonry.computeLayout({
itemSizer })`), with the resolved column stride as input. The browser
callback receives the DOM element + stride; the SSR callback receives the
raw item descriptor + stride.

This is the most general size resolver — it lets a single source-of-truth
height formula live in one place and apply identically server- and
client-side. The motivation is **mixed-media SSR grids**: news cards,
podcast tiles, weather widgets, banner groups, etc. — items whose heights
are closed-form functions of column width but aren't pure text (so
`pretextify` doesn't fit).

**Predictions:**

- **Cost:** ~80-150 B gzipped on `dist/masonry.pkgd.min.js`. The new
  resolution branch in `_getItemLayoutPosition` + the parallel branch in
  `Masonry.computeLayout` + the per-item-`sizer` shape support.
- **Resolution order**: `itemSizer` first (highest priority), then
  `pretextify`, then `item.getSize()`. Each layer falls through if it
  returns null/undefined/false, so consumers can mix-and-match.
- **Test gates**: new `item-sizer.html` browser fixture + 2 new cases
  in `compute-layout.mjs` (top-level `itemSizer` AND per-item closure
  shape).
- **Browser sizer**: `(element, columnWidth) → MasonrySize`
- **SSR top-level sizer**: `(item, columnWidth) → MasonrySize`
- **SSR per-item sizer**: `item.sizer(stride, item.data) → MasonrySize`

## Method

- Files touched:
  - `masonry.js` — added the `itemSizer` lookup at the top of
    `_getItemLayoutPosition`'s size resolution chain. Falls through to
    `pretextify` (#009) if the sizer returns null. Also added the
    parallel branch in `Masonry.computeLayout` that handles three
    item shapes: per-item `sizer` closure, top-level `itemSizer`, or
    pre-measured `{outerWidth, outerHeight}`.
  - `masonry.d.ts` — added `itemSizer?(element, columnWidth)` to
    `MasonryOptions` and `itemSizer?(item, columnWidth)` to
    `ComputeLayoutOptions`. Updated `ComputeLayoutOptions.items` to
    accept the three shapes (pre-measured / per-item closure / generic
    data).
  - `test/visual/pages/item-sizer.html` — new discriminating fixture.
    4 items with `data-module-type` attributes ('tall' / 'short')
    and DOM height of 1px (so the sizer must override). Expected:
    item 3 lands at (60, 30) only if itemSizer fired.
  - `test/visual/run.mjs` — added the `item-sizer` case.
  - `test/visual/__screenshots__/item-sizer.png` — new baseline.
  - `test/visual/compute-layout.mjs` — added 2 new cases:
    `item-sizer (top-level)` and `item-sizer (per-item)`.
  - `package.json` — version bump to `5.0.0-dev.42`.
- Commands run:
  - `make build`
  - `node test/visual/run.mjs --filter=item-sizer --update` (snapshot)
  - `node test/visual/compute-layout.mjs`
  - `make test` (full gate)
- Manual verification: discriminator works because the DOM elements
  have height=1px (sentinel) and the sizer must override to produce
  the expected layout. Without the callback, item 3 would land at a
  different position.

## Before

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

## After

```
package           masonry-pretext@5.0.0-dev.42

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                    42779       13415       11619       992
  dist/masonry.pkgd.js                   53877       10459        9368      1473
  dist/masonry.pkgd.min.js               23977        7867        7106        19
  dist/masonry.cjs                       50823       10344        9278      1466
  dist/masonry.mjs                       52031       10830        9676      1490
```

Test status: 16 visual + ssr + module + 11 compute-layout + 4 compute-layouts + no-jquery — all green.

## Delta

| Metric | Before | After | Δ | % |
|---|---:|---:|---:|---:|
| dist/masonry.pkgd.min.js raw  | 23799 | 23977 | **+178** | +0.75% |
| dist/masonry.pkgd.min.js gzip |  7787 |  7867 |  **+80** | +1.03% |
| dist/masonry.pkgd.min.js br   |  7045 |  7106 |  **+61** | +0.87% |

Lands at the lower end of the predicted 80-150 B gz band.

## Verdict

✅ **Match.** Cost lands at 80 B gz (predicted 80-150). All test gates
green; new browser fixture verified to pass; both compute-layout SSR
shapes (top-level + per-item) verified to match the browser layout.

## Notes / lessons

- **Why three SSR shapes?** Pre-measured items still work (nothing
  changes for existing consumers). Top-level `itemSizer` is the
  ergonomic choice for grids where every item runs through the same
  resolver. Per-item `sizer` closures are useful for heterogeneous
  grids where each item carries its own height formula (e.g., one
  closure per module type, attached at item-build time). All three
  shapes coexist without overhead — the resolver picks the first
  non-null result.
- **The browser callback gets the DOM element**, the SSR callback
  gets whatever the consumer puts in `items[i]`. They have different
  signatures because their inputs are different — there's no clean
  way to abstract over "DOM element vs server-side data object" that
  doesn't add boilerplate at the call site.
- **Resolution order matters.** `itemSizer` runs FIRST, before
  `pretextify`. This means a consumer who's using both can have
  the sizer handle known module types and let `pretextify` handle
  pure-text items by returning null. The fall-through chain stays
  fast because each layer is a single function call + null check.
- **Discriminator design.** The fixture uses CSS `height: 1px` as a
  sentinel — it's a value the sizer must override to produce the
  expected layout. Without the callback, every item has DOM height
  1, the layout collapses to a different shape, and item 3 ends up
  somewhere else. Same pattern as `pretext.html` (#009): pick a
  final position only achievable through the new code path.
