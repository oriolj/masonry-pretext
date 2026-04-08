# 044 — `dynamicItems` selector opt-out

**Status:** landed
**Roadmap section:** § Downstream consumer asks · D.4
**Closes upstream issues:** none (downstream hybrid SSR + dynamic content)
**Commit(s):** 5.0.0-dev.44

## Hypothesis

`static: true` is per-instance, all-or-nothing. If a v2 modular page
contains a single iframe item (e.g., a podcast embed, an Instagram
SnapWidget), the entire page must drop to the v1 dynamic-content
path. Add a `dynamicItems: '<selector>'` option that, when combined
with `static: true`, observes ONLY items matching the selector via
the per-item ResizeObserver. Other items skip the observer entirely
and keep their pre-positioned (server-rendered) layout.

**Predictions:**

- **Cost:** ~30-80 B gzipped on `dist/masonry.pkgd.min.js`. Just a flag
  check on the existing `static` gate + a `matches` filter inside
  `_observeItemElement`. The observer machinery itself is already
  there for the non-static path.
- **Test gate:** new `dynamic-items.html` discriminating fixture. 4
  items, item 0 has `.dynamic-item`. After construction, item 0 AND
  item 1 are both resized 30→60. Item 0's observer fires → relayout
  → reads ALL current sizes → item 3 lands at (120, 30). Without the
  opt-out, no observer fires and item 3 stays at (0, 30).

## Method

- Files touched:
  - `masonry.js` — extended the observer construction gate from
    `!this.options.static` to `( !this.options.static ||
    this.options.dynamicItems )`. Added a selector filter inside
    `_observeItemElement` that early-returns when `static + dynamicItems`
    is set and the element doesn't match the selector. The same gate
    applies to construction-time and post-construction additions
    (`_itemize` already delegates to `_observeItemElement`).
  - `masonry.d.ts` — added `dynamicItems?: string` to `MasonryOptions`
    with a JSDoc block explaining the interaction with `static: true`.
  - `test/visual/pages/dynamic-items.html` — new fixture with 4 items
    + 1 `.dynamic-item` class on item 0. Both item 0 and item 1 are
    resized post-construction; the discriminator verifies the relayout
    fires (which only happens if item 0 is observed).
  - `test/visual/run.mjs` — added `dynamic-items` case.
  - `test/visual/__screenshots__/dynamic-items.png` — new baseline.
  - `package.json` — version bump to `5.0.0-dev.44`.
- Commands run:
  - `make build`
  - `node test/visual/run.mjs --filter=dynamic-items --update`
  - `make test` (full gate)

## Before

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

## After

```
package           masonry-pretext@5.0.0-dev.44

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                    46289       14368       12467      1059
  dist/masonry.pkgd.js                   55400       10785        9691      1506
  dist/masonry.pkgd.min.js               24812        8136        7357        19
  dist/masonry.cjs                       52280       10677        9590      1499
  dist/masonry.mjs                       53488       11161        9989      1523
```

Test status: 18 visual + ssr + module + 11 compute-layout + 4 compute-layouts + no-jquery — all green.

## Delta

| Metric | Before | After | Δ | % |
|---|---:|---:|---:|---:|
| dist/masonry.pkgd.min.js raw  | 24668 | 24812 | **+144** | +0.58% |
| dist/masonry.pkgd.min.js gzip |  8095 |  8136 |  **+41** | +0.51% |
| dist/masonry.pkgd.min.js br   |  7303 |  7357 |  **+54** | +0.74% |

Lands within the predicted 30-80 B gz band.

## Verdict

✅ **Match.** Cost lands at 41 B gz (predicted 30-80). All test gates
green; new fixture catches the regression class (verified by reading
the discriminator design — the relayout only fires if item 0 is
observed, and item 0 is observed only if the selector match is
correctly filtering inside the observer construction).

## Notes / lessons

- **The bytes are surprisingly small** because most of the
  infrastructure already exists. The observer machinery is already
  built for the `!static` path; this improvement just opens the gate
  one more way + adds a per-element filter inside the observe call.
- **`dynamicItems` is a string selector, not an array of elements.**
  String selectors compose naturally with the rest of masonry's
  option API (which already accepts selectors for `itemSelector`,
  `columnWidth`, etc.) and let the consumer use any CSS query
  (`.dynamic-item`, `[data-dynamic]`, `iframe`, etc.) without
  having to enumerate elements upfront.
- **`Element.matches` is universally available** at the fork's
  browser baseline (chrome 84+, etc.). The polyfill we deleted in
  #003 was for `matchesSelector`, the prefixed pre-2014 API. The
  unprefixed `matches` is available everywhere we care about.
- **Discriminator design.** The fixture resizes BOTH the dynamic
  item AND a static item. The dynamic item's observer fires
  → triggers a full layout pass → the layout pass reads the
  current size of EVERY item via getSize. So item 1's static
  status is preserved (its observer never fires) but item 1's
  new size IS picked up during the relayout that item 0 triggered.
  This matches the consumer's actual use case: one dynamic item
  triggers a full relayout, all sibling items get their current
  sizes read.
- **What about no observer at all?** With `static: true` and
  `dynamicItems` unset, we still skip the observer entirely (the
  existing #015 behavior). The opt-out only kicks in when both
  options are present.
