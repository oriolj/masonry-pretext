# 046 — `replaceItems(newElems)` atomic swap

**Status:** landed
**Roadmap section:** § Downstream consumer asks · D.9
**Closes upstream issues:** none (downstream SPA navigation ergonomics)
**Commit(s):** 5.0.0-dev.46

## Hypothesis

Add a `replaceItems(newElems)` method that removes all current items
AND appends the new set in a single relayout pass. Equivalent to
`destroy() + new Masonry(...)` but reuses the existing observer
wiring + column measurements + rAF coalescing state, so SPA navigation
between two structurally similar grids skips the construction cost.

**Predictions:**

- **Cost:** ~30-80 B gzipped on `dist/masonry.pkgd.min.js`. The new
  method is a thin orchestration of existing API surface
  (`baseRemove` + `_itemize` + `concat` + `layout`).
- **Test gate:** new `replace-items.html` discriminating fixture.
  Starts with 3 items, calls `replaceItems` with 4 new items
  (item 0 is taller than the rest). The new layout has a different
  shape — item 3 lands at (60, 30) only if replaceItems correctly
  removed the old set + appended the new set + relaid out.

## Method

- Files touched:
  - `masonry.js` — added `proto.replaceItems` after the
    `appended`/`prepended` overrides. Implementation uses `baseRemove`
    (the saved Outlayer remove) + `_itemize` (the override that
    auto-observes new items) + `Array.concat` + `layout()`. Wraps the
    `_itemize` step in the mutation re-entry guard so #031's
    MutationObserver doesn't double-fire.
  - `masonry.d.ts` — added `replaceItems(elements)` method declaration
    on the `Masonry` class with a JSDoc block explaining the use case.
  - `test/visual/pages/replace-items.html` — new fixture that starts
    with 3 old items, dynamically injects 4 new items into the DOM,
    and calls `replaceItems(newElems)`.
  - `test/visual/run.mjs` — added `replace-items` case with both
    position assertions (verifying the post-swap layout) and a
    `pageAssert` (verifying `msnry.items` was correctly swapped and
    the ResizeObserver instance was preserved across the swap).
  - `test/visual/__screenshots__/replace-items.png` — new baseline.
  - `package.json` — version bump to `5.0.0-dev.46`.

## Before

```
package           masonry-pretext@5.0.0-dev.45

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                    49734       15404       13375      1121
  dist/masonry.pkgd.js                   56231       10892        9768      1525
  dist/masonry.pkgd.min.js               25392        8250        7445        19
  dist/masonry.cjs                       53073       10782        9659      1518
  dist/masonry.mjs                       54281       11267       10079      1542
```

## After

```
package           masonry-pretext@5.0.0-dev.46

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                    51638       15958       13853      1160
  dist/masonry.pkgd.js                   56813       10968        9841      1543
  dist/masonry.pkgd.min.js               25640        8309        7500        19
  dist/masonry.cjs                       53619       10850        9737      1536
  dist/masonry.mjs                       54827       11340       10153      1560
```

Test status: 20 visual + ssr + module + 11 compute-layout + 4 compute-layouts + no-jquery — all green.

## Delta

| Metric | Before | After | Δ | % |
|---|---:|---:|---:|---:|
| dist/masonry.pkgd.min.js raw  | 25392 | 25640 | **+248** | +0.98% |
| dist/masonry.pkgd.min.js gzip |  8250 |  8309 |  **+59** | +0.72% |
| dist/masonry.pkgd.min.js br   |  7445 |  7500 |  **+55** | +0.74% |

Within the predicted 30-80 B gz band.

## Verdict

✅ **Match.** Cost lands at 59 B gz (predicted 30-80). All test gates
green; new fixture verified to discriminate (the post-swap layout
is fundamentally different from any layout 3 old items could produce).

## Notes / lessons

- **The implementation is genuinely thin.** Most of the work is
  delegated to the existing API surface — `baseRemove` (which already
  unobserves removed items via the proto.remove override),
  `_itemize` (which already observes new items via the proto._itemize
  override), and the existing `layout()`. The new method is just an
  orchestration: remove all + add all + relayout once.
- **The mutation re-entry guard is needed.** When `observeMutations:
  true` (#031), removing or appending items via the DOM fires
  childList mutations. Without the guard, the MutationObserver would
  schedule a spurious second relayout immediately after `replaceItems`
  returns. The guard wraps the `_itemize` step inside `replaceItems`
  so the swap is atomic from the MutationObserver's perspective.
- **Why not insert the new elements ourselves?** Because the existing
  `appended()` API surface doesn't insert either — it expects the
  caller to put the elements in the DOM first, then notify masonry.
  `replaceItems` follows the same convention so callers don't have
  to learn a new pattern.
- **Discriminator design.** The fixture starts with 3 items + ends
  with 4. Item 3 simply doesn't exist in the original DOM. So the
  position assertion on item 3 is fundamentally testing "did
  replaceItems append the new set?" — there's no way for the test
  to pass unless the items were swapped correctly. The pageAssert
  also verifies the items collection was rewritten (no old items
  remain) and the observer was preserved across the swap (confirming
  the "skip the construction cost" claim).
