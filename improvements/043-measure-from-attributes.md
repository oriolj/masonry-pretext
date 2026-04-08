# 043 — `measureFromAttributes` option

**Status:** landed
**Roadmap section:** § Downstream consumer asks · D.7
**Closes upstream issues:** none (downstream image-driven dynamic content)
**Commit(s):** 5.0.0-dev.43

## Hypothesis

Add a `measureFromAttributes: true` option that walks each item element
looking for an aspect-ratio hint and computes the item height as a
closed-form function of the resolved column width. This eliminates the
need to wait for `<img>` children to actually load before masonry can
position the items correctly. **Browser-side only** — `Masonry.computeLayout`
consumers should use the more general `itemSizer` (D.3) instead.

Aspect-ratio sources, in priority order:

1. `[data-aspect-ratio="1.78"]` on the item itself
2. First `<img width height>` child (any depth via `querySelector`)
3. First `<img style="aspect-ratio: 16/9">` child (handles `16/9`,
   `1.78`, etc.)

The first hint found wins; if none, masonry falls through to `pretextify`
then `item.getSize()`.

**Predictions:**

- **Cost:** ~150-250 B gzipped on `dist/masonry.pkgd.min.js`. The new
  resolution branch + the `measureFromAttributes` helper function
  (querySelector + parseFloat + an aspect-ratio regex). Larger than
  the other Tier 2 items because of the helper, not because of the
  resolution chain.
- **Side benefit:** the size resolution chain in `_getItemLayoutPosition`
  gets refactored from nested `if/else` branches to a flat `if (!size)`
  sequence, so adding new resolvers later costs roughly one if-check
  instead of duplicated trailing fall-through code.
- **Test gate:** new `measure-from-attributes.html` discriminating
  fixture with hidden 1×1 SVG `<img>` elements declaring different
  aspect ratios via `width`/`height` attributes.

## Method

- Files touched:
  - `masonry.js` — added the `measureFromAttributes` helper function
    (top-level, near the other pure helpers); refactored
    `_getItemLayoutPosition` from nested if/else branches to a flat
    `if (!size)` resolution chain (a side benefit of adding the new
    resolver: simpler control flow).
  - `masonry.d.ts` — added `measureFromAttributes?: boolean` to
    `MasonryOptions` with a JSDoc block explaining the aspect-ratio
    sources, the resolution-chain position, and the modern-browser
    `aspect-ratio` CSS interaction.
  - `test/visual/pages/measure-from-attributes.html` — new fixture.
    4 items with hidden 1×1 SVG `<img>` children declaring 60×90
    or 60×30 aspect ratios via `width`/`height` attributes. Items
    have CSS `height: 1px` sentinel; `<img>` elements have
    `display: none` to prevent native browser aspect-ratio
    reservation from matching the layer's output.
  - `test/visual/run.mjs` — added `measure-from-attributes` case.
  - `test/visual/__screenshots__/measure-from-attributes.png` — new baseline.
  - `package.json` — version bump to `5.0.0-dev.43`.
- Commands run:
  - `make build`
  - `node test/visual/run.mjs --filter=measure-from-attributes --update`
  - `make test` (full gate)

## Before

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

## After

```
package           masonry-pretext@5.0.0-dev.43

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                    45108       14026       12160      1039
  dist/masonry.pkgd.js                   55170       10731        9642      1502
  dist/masonry.pkgd.min.js               24668        8095        7303        19
  dist/masonry.cjs                       52058       10624        9538      1495
  dist/masonry.mjs                       53266       11109        9948      1519
```

Test status: 17 visual + ssr + module + 11 compute-layout + 4 compute-layouts + no-jquery — all green.

## Delta

| Metric | Before | After | Δ | % |
|---|---:|---:|---:|---:|
| dist/masonry.pkgd.min.js raw  | 23977 | 24668 | **+691** | +2.88% |
| dist/masonry.pkgd.min.js gzip |  7867 |  8095 | **+228** | +2.90% |
| dist/masonry.pkgd.min.js br   |  7106 |  7303 | **+197** | +2.77% |

Lands at the upper end of the predicted 150-250 B gz band. The bytes
break down roughly as: ~120 B for the helper function (querySelector
selector string, attribute getter, aspect-ratio regex, parseFloat),
~50 B for the new resolution-chain branch, ~50 B for the type-narrowing
bookkeeping after the chain refactor.

## Verdict

✅ **Match.** Cost lands at 228 B gz (predicted 150-250). All test
gates green; new browser fixture verified to discriminate correctly.

## Notes / lessons

- **Why is this more expensive than `itemSizer`?** Because
  `measureFromAttributes` does work that `itemSizer` delegates to the
  consumer. The helper has to walk the DOM, parse attributes, handle
  three different aspect-ratio sources, and return a size — versus
  `itemSizer` which just calls a user-supplied function. The bytes
  buy ergonomics: consumers who would otherwise write the same
  `walk-for-img-and-read-attrs` code in their own callback get it
  built in.
- **The resolution chain refactor was a small but real win.** Going
  from nested if/else to flat `if (!size)` sequence saves ~24 B gz
  (the savings from re-computing the diff before vs after the
  refactor inside this same improvement). It's a wash on the
  improvement balance sheet — the new resolver costs 252 B gz, the
  refactor saves 24 B gz, net +228 B gz — but it makes the next
  resolver in the chain (if there is one) cheaper to add.
- **Browser-side only.** `Masonry.computeLayout` consumers should
  use `itemSizer` instead — they have raw data objects, not DOM
  elements with `<img>` children, so a `measureFromAttributes`
  equivalent in pure-Node would just be "call your aspect-ratio
  formula". `itemSizer` already does that, more flexibly.
- **Discriminator design.** The fixture hides the `<img>` children
  via `display: none` so the browser's native `aspect-ratio` CSS
  reservation can't accidentally produce the right layout. With
  `display: none`, `getSize()` returns the item's CSS height
  (1px sentinel), so the layout collapses unless
  `measureFromAttributes` reads the img attrs and overrides.
- **The 'fail closed' fall-through.** If the helper finds no hint
  (no `[data-aspect-ratio]`, no `<img>` with width/height attrs,
  no `<img>` with `aspect-ratio` style), it returns `null` and the
  chain falls through to `pretextify` then `getSize()`. So enabling
  the option on a grid with mixed item types is safe — items
  without aspect-ratio hints behave exactly as if the option
  were `false`.
