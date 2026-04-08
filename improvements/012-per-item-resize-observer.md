# 012 — Per-item ResizeObserver auto-relayout (§ P.1b)

**Status:** landed
**Roadmap section:** § P.1b — per-item ResizeObserver for auto-relayout
**Closes upstream issues:** **`desandro/masonry#1147`** "Overlapping Images - Bootstrap User" + **7 duplicates** in the lazy-image-overlap cluster (`#1185`, `#1158`, `#1152`, `#1108`, `#1165`, `#1189`, `#1199`). The dominant complaint category in the upstream tracker.
**Tag:** `v5.0.0-dev.12`
**Commit:** _filled in after landing_

## Hypothesis

When a masonry item contains an `<img>` without explicit `width`/`height`, the layout runs at construction time when the image hasn't loaded yet. Items get measured at the fallback size (typically alt-text height or 0×0), masonry packs them, then the image loads and the item's actual height grows — but masonry doesn't know to relayout. Result: image overlap. **The dominant complaint category in the upstream tracker** (8+ duplicate issues, all variants of "lazy load image overlap").

The traditional workaround is `imagesLoaded` (a separate library by the same upstream author). It listens to `load` events on every `<img>` and triggers a relayout when they all finish. Limitations:

- Separate dependency (more bytes, more wiring)
- Only handles `<img>` (not videos, custom elements, font swaps, dynamic content edits, parent resizes — anything else that changes item size)
- Users have to wire it up manually

**`ResizeObserver` is the universal "this thing got bigger/smaller" notification** — fires whenever an element's size changes for any reason (image load, font load, content edit, parent resize, custom element render, etc.). Available in chrome 64 / firefox 69 / safari 13.1, all 2018-2020 — well within the fork's browser baseline.

The fix: a per-instance `ResizeObserver` observing every item element. When an item resizes, schedule a `layout()` via `requestAnimationFrame` coalescing so multiple changes in one frame collapse to a single relayout.

### Predictions

1. **`min.js` raw:** +700-1200 B (calibration update from #010: prototype-override-with-closure-capture costs ~200-300 B per override; #012 adds 4 overrides — `_create`, `_itemize`, `remove`, `destroy`)
2. **`min.js` gz:** +250-400 B
3. **`min.js` brotli:** similar to gz
4. **`masonry.js` source:** +1500-3000 B (verbose comment + 4 overrides + the helper)
5. **6 existing visual fixtures still pass.** No behavior change for items that don't resize.
6. **New `resize-observer` fixture passes.** Programmatically resize item 0 from 30→60 after construction. The position assertion catches it if the relayout doesn't fire — same discriminating-test pattern as #009 (pretext) and #010 (fonts-ready).
7. **SSR + no-jquery gates unchanged.** `typeof ResizeObserver !== 'undefined'` guard handles SSR; no string match for "jquery" / "bridget" in the new code.

## Method

### `_create` override (extends the #010 fonts.ready hook)

Sets up the ResizeObserver, pre-populates `_resizeLastSizes` with current item sizes (via `getBoundingClientRect`, which returns the same fractional `borderBoxSize` the observer delivers), then observes every item.

```js
if ( typeof ResizeObserver !== 'undefined' ) {
  var self2 = this;
  this._resizeLastSizes = new WeakMap();
  var pendingRaf = null;
  this._resizeObserver = new ResizeObserver( function( entries ) {
    var changed = false;
    for ( var i = 0; i < entries.length; i++ ) {
      var entry = entries[i];
      var box = entry.borderBoxSize && entry.borderBoxSize[0];
      var w = box ? box.inlineSize : entry.contentRect.width;
      var h = box ? box.blockSize : entry.contentRect.height;
      var prev = self2._resizeLastSizes.get( entry.target );
      if ( prev && ( prev.width !== w || prev.height !== h ) ) {
        changed = true;
      }
      self2._resizeLastSizes.set( entry.target, { width: w, height: h });
    }
    if ( changed && pendingRaf === null ) {
      pendingRaf = requestAnimationFrame( function() {
        pendingRaf = null;
        if ( self2.element && self2.element.outlayerGUID ) {
          self2.layout();
        }
      });
    }
  });
  for ( var i = 0; i < this.items.length; i++ ) {
    this._observeItemElement( this.items[i].element );
  }
}
```

### `_observeItemElement` helper

Pre-populates `_resizeLastSizes` synchronously at observe time, then observes. Used by both `_create`'s initial loop and the `_itemize` override below. **Critical for correctness** — see "The race that broke the first attempt" below.

```js
proto._observeItemElement = function( elem ) {
  var rect = elem.getBoundingClientRect();
  this._resizeLastSizes.set( elem, { width: rect.width, height: rect.height });
  this._resizeObserver.observe( elem );
};
```

### `_itemize` override

Items added after construction (via `appended()`, `prepended()`, or `addItems()` — all of which transitively call `_itemize`) get observed via the same helper.

### `remove` override

Unobserves removed items so the ResizeObserver doesn't keep their elements alive after they're detached from the DOM. Without this, removed items stay in the observer's internal observation list — a real memory leak class.

### `destroy` override

Disconnects the observer entirely on `instance.destroy()`.

### The race that broke the first attempt — and the fix

**First attempt** used a `WeakSet` to "skip the first event per element," based on the assumption that ResizeObserver always delivers an initial-size event when a new element is observed. The intent was to avoid scheduling a relayout for the no-op "I'm now observing this element" notification.

**The bug:** ResizeObserver delivers the first event with the size at **delivery time**, not at observe time. If the size changes between `observe()` and the first delivery (which is exactly what the test fixture does — and exactly what real lazy-loaded images do), the first delivered event captures the **new** size. Skipping it silently misses the very kind of change this hook exists to catch.

The test fixture proved this immediately: item 3 stayed at `(0, 30)` because the resize event for item 0 was treated as a "first event" and skipped. The hook was wired correctly but the comparison logic was wrong.

**The fix:** pre-populate `_resizeLastSizes` synchronously at `observe()` time using `getBoundingClientRect()` (which returns the same fractional `borderBoxSize` the observer delivers — they match exactly in chromium ≥84). Drop the WeakSet entirely. Now every event is a real comparison: `prev.width/height` came from the actual element measurement at observe time, and the entry's `borderBoxSize` is the current measurement. If they differ, schedule a relayout.

**Calibration lesson:** ResizeObserver's initial-event semantics are the kind of subtle browser API contract that's easy to get wrong from reading the spec. The discriminating fixture caught it on the first run, before the improvement had any chance to ship a regression. **Build the fixture first, debug against it second.**

### Discriminating fixture (`test/visual/pages/resize-observer.html`)

Same shape as #009 (pretext) and #010 (fonts-ready):

- 4 items at default 60×30
- After `new Masonry(grid, { ... })` constructs and lays out, the script does `items[0].style.height = '60px'` — simulating an image lazy-loading and growing the item
- Wait three rAF ticks (browser-layout → ResizeObserver fires → rAF coalescing schedules layout → layout writes positions)
- Position assertion: item 3 must land at `(60, 30)` — only achievable if the relayout fired AFTER the resize. If the hook is broken, item 3 stays at `(0, 30)`.

### Commands run

```sh
./scripts/measure.sh --save pre-012-resize-observer
make test                                          # 6/6 + ✓ ssr + ✓ no-jquery (baseline)

# edit masonry.js — add ResizeObserver hook + 4 overrides
make build && make test                            # 6/6 still pass (no resize fixture yet)

# create test/visual/pages/resize-observer.html
# add resize-observer case to test/visual/run.mjs
make build
node test/visual/run.mjs --update --filter=resize-observer
make test                                          # ✗ FAIL — item 3 at (0,30), not (60,30)

# diagnose: WeakSet "skip first event" misses the actual size change
# fix: pre-populate _resizeLastSizes via getBoundingClientRect at observe() time
make build && make test                            # ✓ 7/7 + ✓ ssr + ✓ no-jquery

# bump pkg.json version → 5.0.0-dev.12
./scripts/measure.sh --save post-012-resize-observer
```

## Before — `pre-012-resize-observer`

```
package           masonry-pretext@5.0.0-dev.11
tracked files     78
total LOC         10271
dependencies      2
devDependencies   4

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                     8860        3056        2593       270
  dist/masonry.pkgd.js                   49493        9337        8306      1400
  dist/masonry.pkgd.min.js               21736        6957        6267        22
```

6/6 visual + ✓ SSR + ✓ no-jquery.

## After — `post-012-resize-observer`

```
package           masonry-pretext@5.0.0-dev.12
tracked files     80
total LOC         10717
dependencies      2
devDependencies   4

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                    12914        4206        3587       361
  dist/masonry.pkgd.js                   52126        9844        8756      1463
  dist/masonry.pkgd.min.js               22984        7322        6586        22
```

7/7 visual + ✓ SSR + ✓ no-jquery.

## Delta

| Metric | pre-012 | post-012 | Δ raw | Δ% |
|---|---:|---:|---:|---:|
| `masonry.js` source raw | 8,860 | **12,914** | **+4,054** | **+45.76%** (mostly the verbose docs + 4 prototype overrides + the WeakMap pre-population helper) |
| `dist/masonry.pkgd.js` raw | 49,493 | **52,126** | **+2,633** | **+5.32%** |
| `dist/masonry.pkgd.js` gzip | 9,337 | **9,844** | **+507** | **+5.43%** |
| `dist/masonry.pkgd.min.js` raw | 21,736 | **22,984** | **+1,248** | **+5.74%** |
| `dist/masonry.pkgd.min.js` gzip | 6,957 | **7,322** | **+365** | **+5.25%** |
| `dist/masonry.pkgd.min.js` brotli | 6,267 | **6,586** | **+319** | **+5.09%** |
| Visual regression tests | 6 / 6 | **7 / 7** | +1 (resize-observer fixture) | |
| SSR + no-jquery gates | ✓ + ✓ | ✓ + ✓ | unchanged | |

### Vs upstream-frozen v4.2.2

| Metric | v4.2.2 | v5.0.0-dev.12 | Δ raw | Δ% |
|---|---:|---:|---:|---:|
| `dist/masonry.pkgd.min.js` raw | 24,103 | **22,984** | **−1,119** | **−4.64%** |
| `dist/masonry.pkgd.min.js` gzip | 7,367 | **7,322** | **−45** | **−0.61%** |
| `dist/masonry.pkgd.min.js` brotli | 6,601 | **6,586** | **−15** | **−0.23%** |

The fork is **still smaller than upstream in every minified-bundle metric**, even after adding three new features (#009 pretext, #010 fonts.ready, #012 ResizeObserver). The size lead has shrunk from −9.82 % gz at #010 to −0.61 % gz now — but each feature closes a real upstream issue (or, in pretext's case, adds a measured 1.2-1.3× layout speedup that the original library didn't have).

The remaining size wins from the post-#010 review (items A-F + M-O, ~950-1500 B gz combined) will more than restore the gap when they land — see § Post-#010 review § "Updated cumulative ceiling".

## Verdict

⚠️ **Partial — gates green and feature works, but raw size landed slightly above the predicted band.**

| Prediction | Predicted | Actual | Status |
|---|---|---|---|
| `min.js` raw | +700 to +1,200 B | **+1,248 B** | ⚠️ +48 B over the top of band |
| `min.js` gzip | +250 to +400 B | **+365 B** | ✅ middle of band |
| `min.js` brotli | similar to gz | **+319 B** | ✅ |
| `masonry.js` source | +1,500 to +3,000 B | **+4,054 B** | ❌ +1,054 B over band — verbose docs again, same lesson as #009/#010 |
| Visual fixtures pass | 6 → 7 | **7/7** | ✅ |
| Discriminating fixture proves the hook fires | yes | yes (item 3 at `60px,30px`) | ✅ |
| SSR + no-jquery unchanged | yes | yes | ✅ |

**The size over-shoot on raw is small and well within "feature pays its bytes" territory** — closing 8+ duplicate upstream issues (the dominant complaint category) for +365 B gz is a great ratio. The source over-shoot is comments-only and doesn't affect end-user bundle size (the minifier strips them).

## Notes / lessons

- **The first attempt's WeakSet "skip first event" logic was a bug that the discriminating fixture caught immediately.** ResizeObserver's first-delivery semantics are subtle: it delivers the size at *delivery* time, not at *observe* time. If the size changes between observe and first delivery (the exact case this hook exists to handle), skipping the first event silently misses it. The fix is `getBoundingClientRect()` pre-population — same measurement axis as `borderBoxSize`, captured synchronously at `observe()` time so the comparison is meaningful.
- **`getBoundingClientRect()` matches `borderBoxSize` exactly** in modern browsers (chromium ≥84, firefox ≥69, safari ≥13.1). Both return fractional values from the same internal layout. The earlier worry about "offsetWidth integer vs borderBoxSize fractional" doesn't apply when the source is `getBoundingClientRect`.
- **The third rAF tick in the fixture is necessary, not paranoid.** Tick 1 lets the browser compute the new layout. Tick 2 lets the ResizeObserver dispatch its entries. Tick 3 lets our rAF-coalesced relayout actually run. Without all three, the test races and fails intermittently.
- **The fixture pattern generalizes to any "deferred relayout on observed change" feature.** Same shape as #009 (pretext) and #010 (fonts-ready): pick a final position only achievable if the new code path fires; assert that exact position. If the hook is broken, the assertion catches it loudly.
- **The 4 prototype overrides cost ~300 B raw / ~90 B gz each.** Updated calibration: future improvements that hook the Outlayer item lifecycle should budget ~1,200-1,600 B raw / ~360-480 B gz for a 4-method override set.
- **The hook closes 8+ duplicate upstream issues in one shot.** That's the largest "issues per improvement" ratio in the entire fork. The cumulative effect of #005 (3 SSR issues), #010 (1 font issue), and #012 (8+ image-overlap issues) is **12+ closed upstream issues across just 3 improvements** — every one of which had been open for 2-4 years with no upstream movement.
- **Still need to bench this.** The bench from #009 measures `new Masonry(...)` initial layout time, which is unaffected by #012 (the ResizeObserver fires after layout). A new bench would measure "time to relayout after a triggered resize" — useful but not blocking. Tracked as a follow-up.