# 035 — `pretextOptions` shorthand (PRETEXT_SSR Phase 6)

**Status:** landed
**Roadmap section:** [`PRETEXT_SSR_ROADMAP.md`](../PRETEXT_SSR_ROADMAP.md) Phase 6 (the optional convenience layer)
**Tag:** `v5.0.0-dev.35`

## Hypothesis

Convenience layer over the existing #009 `pretextify` callback for the common case where the user has a measurement function (e.g. `@chenglou/pretext`'s `prepare` + `layout`) and wants masonry to build the closure + WeakMap cache automatically.

Before:

```js
import { prepare, layout } from '@chenglou/pretext';
const cache = new WeakMap();

new Masonry(grid, {
  columnWidth: 280,
  pretextify(elem) {
    let prepared = cache.get(elem);
    if (!prepared) {
      prepared = prepare(elem.dataset.text || elem.textContent, '16px/1.5 Inter');
      cache.set(elem, prepared);
    }
    const { height } = layout(prepared, 280, 24);
    return { outerWidth: 280, outerHeight: height + 24 };
  },
});
```

After:

```js
import { prepare, layout } from '@chenglou/pretext';

new Masonry(grid, {
  columnWidth: 280,
  pretextOptions: {
    measure: (text, font, maxWidth) => {
      const prepared = prepare(text, font);
      return layout(prepared, maxWidth, 24).height;
    },
    font: '16px/1.5 Inter',
    text: elem => elem.dataset.text || elem.textContent,
    padding: 24,
  },
});
```

The shorthand removes ~10 lines of boilerplate (the cache, the cache get/set dance, the `outerWidth: cw` repetition) and standardizes the cache key (`elem` reference equality).

## Method

### `buildPretextifyFromOptions` helper (file-local)

```js
function buildPretextifyFromOptions( options ) {
  var po = options.pretextOptions;
  if ( !po || !po.measure ) return null;
  var cw = options.columnWidth;
  var cache = new WeakMap();
  var padding = po.padding || 0;
  var getText = po.text || function( elem ) { return elem.textContent; };
  return function pretextify( elem ) {
    var cached = cache.get( elem );
    if ( cached ) return cached;
    var height = po.measure( getText( elem ), po.font, cw );
    var size = { outerWidth: cw, outerHeight: height + padding };
    cache.set( elem, size );
    return size;
  };
}
```

### `_create` extension

```js
proto._create = function() {
  if ( this.options.static ) {
    this.options.transitionDuration = 0;
  }
  // #035 — build the pretextify closure from `pretextOptions` if the
  // user took the shorthand path. Skipped if they already supplied a
  // pretextify callback directly (`pretextify` wins).
  if ( !this.options.pretextify && this.options.pretextOptions ) {
    this.options.pretextify = buildPretextifyFromOptions( this.options );
  }
  baseCreate.call( this );
  // ...
};
```

If both `pretextify` and `pretextOptions` are set, `pretextify` wins — the user can opt out of the shorthand for any reason without breaking the explicit-callback path.

### `masonry.d.ts`

Added `pretextOptions?: { measure, font, text?, padding? }` to `MasonryOptions` with full JSDoc + a runnable example showing the `@chenglou/pretext` integration.

### Discriminating fixture (`test/visual/pages/pretext-options.html`)

Same shape as the original `pretext.html` (#009): 4 items at default 60×30, but the synthetic `measure` function returns variable heights — item 0 measures as 60 (read from `data-h="60"` via the custom `text` accessor).

If `pretextOptions` is wired, item 0 places at full height 60 and item 3 lands at col 1 (60, 30) — same final layout as `pretext.html`/`fonts-ready.html`/`resize-observer.html`. The position assertion catches a wiring failure (item 3 would land at col 0 (0, 30) if the closure was never built).

The fixture deliberately uses a synthetic measure (`parseFloat(text)`) instead of real `@chenglou/pretext` so the test has zero extra dependencies and is fully reproducible.

## Numbers

| Metric | pre-035 | post-035 | Δ |
|---|---:|---:|---:|
| `dist/masonry.pkgd.js` raw | 49,672 | 50,566 | +894 |
| `dist/masonry.pkgd.js` gz | 9,574 | 9,773 | +199 |
| `dist/masonry.pkgd.min.js` raw | 22,096 | **22,492** | **+396** |
| `dist/masonry.pkgd.min.js` gz | 7,204 | **7,338** | **+134** |
| `dist/masonry.pkgd.min.js` brotli | 6,514 | **6,662** | **+148** |
| Visual regression tests | 13/13 | **14/14** | +1 (`pretext-options`) |
| Other gates | all green | all green | unchanged |

### Vs upstream-frozen v4.2.2

| Metric | v4.2.2 | v5.0.0-dev.35 | Δ |
|---|---:|---:|---:|
| `dist/masonry.pkgd.min.js` raw | 24,103 | **22,492** | **−1,611 (−6.68 %)** |
| `dist/masonry.pkgd.min.js` gz | 7,367 | **7,338** | **−29 (−0.39 %)** |
| `dist/masonry.pkgd.min.js` brotli | 6,601 | **6,662** | +61 (+0.92 %) |

Still below upstream gz (just barely — the convenience helper added more bytes than the per-improvement budget allowed for).

## Verdict

✅ **Match — convenience layer ships with the predicted shape.** The shorthand removes ~10 lines of boilerplate per usage and gives masonry users a one-call SSR + pretext setup that doesn't require them to manage a WeakMap cache themselves.

The fork is now within ~30 B of upstream gz despite shipping the entire SSR feature line, the Web Component wrapper, the MutationObserver auto-relayout, the pickColumn callback, and the new pretextOptions shorthand. **All four wave plans are now landed.**

## Notes / lessons

- **`Masonry.computeAndRender` was considered and skipped.** The Astro/Next.js examples (#019 + #021) show that framework template engines (`.astro`, JSX) handle the rendering layer cleanly without a built-in helper. Adding `computeAndRender` would duplicate functionality that the framework already provides better. Documented as "skipped" in the PRETEXT_SSR_ROADMAP Phase 6 entry below.
- **`pretextify` wins over `pretextOptions`** when both are set. This is the right precedence because users with custom needs (different cache keys, async measurement, fallback strategies) have to use the raw callback — the shorthand should never override explicit user intent.
- **The closure-built cache uses `elem` as the WeakMap key.** Same shape as the manual pattern documented in #009. The cache survives across multiple `layout()` calls because the closure captures it; each Masonry instance gets its own cache because `_create` runs once per instance.
- **The byte cost (+134 B gz) is on the higher end** for a convenience helper, mostly because the inline JSDoc + the `buildPretextifyFromOptions` function name + the four `po.*` field accesses don't compress well. Could shave ~30 B by inlining the helper into `_create` directly, at the cost of readability. Left as-is.
- **PRETEXT_SSR_ROADMAP Phase 6 is now COMPLETE.** All 6 phases of the SSR feature line have shipped.
