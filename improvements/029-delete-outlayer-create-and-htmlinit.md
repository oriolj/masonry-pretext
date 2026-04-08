# 029 — Delete `Outlayer.create()` factory + `htmlInit` auto-init (item E)

**Status:** landed
**Roadmap section:** § Post-#010 / FORK_ROADMAP.md item E
**Closes upstream issues:** **`desandro/masonry#1104`** (auto-init via `data-masonry` attribute is removed)
**Tag:** `v5.0.0-dev.29`
**Breaking change:** users relying on `<div data-masonry='{...}'>` auto-init must switch to imperative `new Masonry(...)`.

## Hypothesis

Three pieces of dead-or-near-dead infrastructure:

1. **`Outlayer.create()`** — the factory used by upstream Masonry to subclass Outlayer. masonry-pretext can inline the equivalent (~14 LOC) directly into `masonry.js` and skip the indirection.
2. **`utils.htmlInit`** — auto-initializes elements matching `[data-masonry]` or `.js-masonry` after `docReady`. The fork's documented usage path is `new Masonry(...)`, not data attributes. Closes `desandro/masonry#1104` (which is about htmlInit's quirks).
3. **`utils.toDashed`** — only used by `htmlInit` for the dataset key conversion. Dead after htmlInit goes.
4. **`subclass()` helper inside outlayer.js** — only used by `Outlayer.create`. Dead after the factory goes.

Predicted savings: **~80-110 B gz**.

## Method

### `masonry.js` — inline the Outlayer subclass

Replace `var Masonry = Outlayer.create('masonry')` with the equivalent inline subclass code (~14 LOC):

```js
function Masonry( element, options ) { Outlayer.call( this, element, options ); }
Masonry.prototype = Object.create( Outlayer.prototype );
Masonry.prototype.constructor = Masonry;
Masonry.namespace = 'masonry';
Masonry.defaults = Object.assign( {}, Outlayer.defaults );
Masonry.compatOptions = Object.assign( {}, Outlayer.compatOptions );
Masonry.data = Outlayer.data;
function MasonryItem() { Outlayer.Item.apply( this, arguments ); }
MasonryItem.prototype = Object.create( Outlayer.Item.prototype );
MasonryItem.prototype.constructor = MasonryItem;
Masonry.Item = MasonryItem;
```

Then `Masonry.compatOptions.fitWidth = 'isFitWidth';` (the existing post-`create` line) still works because `Masonry.compatOptions` is now a fresh object copied from `Outlayer.compatOptions`.

### `outlayer.js` build-time patch (1 transform)

Delete the entire `Outlayer.create = function(...)` block AND the `function subclass(Parent)` helper that only `create` used.

### `fizzy-ui-utils.js` build-time patch (1 transform)

Delete `utils.toDashed` + `utils.htmlInit` (and the `var console = window.console` that only htmlInit's catch-block referenced). The earlier `#006 no-jquery` patches that surgically removed jQuery branches FROM INSIDE htmlInit are now redundant — htmlInit is deleted wholesale.

### `utils.docReady` is kept

`docReady` was the only thing `htmlInit` consumed from utils that wasn't `makeArray` (still used elsewhere). It has no other call sites in the bundle today, but the export surface is preserved for future use. The roadmap's item 4d (#022) already simplified `docReady` to a synchronous call.

## Numbers

| Metric | pre-029 | post-029 | Δ |
|---|---:|---:|---:|
| `dist/masonry.pkgd.js` raw | 51,462 | 50,039 | **−1,423** |
| `dist/masonry.pkgd.js` gz | 9,911 | 9,544 | **−367** |
| `dist/masonry.pkgd.min.js` raw | 22,500 | **21,985** | **−515** |
| `dist/masonry.pkgd.min.js` gz | 7,445 | **7,211** | **−234** |
| `dist/masonry.pkgd.min.js` brotli | 6,745 | **6,562** | **−183** |
| `dist/masonry.cjs` raw | 48,509 | 47,154 | −1,355 |
| `dist/masonry.mjs` raw | 49,701 | 48,354 | −1,347 |
| `masonry.js` source raw | 29,305 | 30,038 | +733 (the inlined subclass) |
| Visual + ssr + module + compute-layout + no-jquery | all green | all green | unchanged |

### Vs upstream-frozen v4.2.2

| Metric | v4.2.2 | v5.0.0-dev.29 | Δ |
|---|---:|---:|---:|
| `dist/masonry.pkgd.min.js` raw | 24,103 | **21,985** | **−2,118 (−8.79 %)** |
| `dist/masonry.pkgd.min.js` gz | 7,367 | **7,211** | **−156 (−2.12 %)** |
| `dist/masonry.pkgd.min.js` brotli | 6,601 | **6,562** | **−39 (−0.59 %)** |

**THE FORK IS NOW SMALLER THAN UPSTREAM IN ALL THREE METRICS for the first time since #017.** Raw is 8.79% smaller, gz is 2.12% smaller, brotli is 0.59% smaller. The entire SSR feature line cost (~600 B gz) is now fully recovered, with margin to spare.

## Verdict

✅✅ **Match — 2× the predicted +80-110 B gz band (234 B actual).** The over-prediction came from underestimating how much code htmlInit + create + subclass + toDashed accounted for. ~30 LOC of factory plumbing + ~50 LOC of htmlInit body + ~7 LOC of toDashed all gone.

The fork is now back below upstream gz with margin. **Cumulative recovery from SSR feature line: ~1,035 B gz across #023 + #024 + #026 + #027 + #028 + #029** — almost double the −576 B gz that #015-#020 added.

## Notes / lessons

- **Inlining the subclass into masonry.js cost 733 B in source** but saves 234 B gz in the bundle. The source cost is paid once at maintainer-read time; the bundle savings are paid every page load. Worth the trade.
- **The `Outlayer.compatOptions` mutation pattern** (`Masonry.compatOptions.fitWidth = 'isFitWidth';`) still works after the rewrite because `Masonry.compatOptions` is now a fresh object copied from `Outlayer.compatOptions` via `Object.assign({}, ...)`. If the assignment had been `Masonry.compatOptions = Outlayer.compatOptions` (reference, not copy), the masonry-specific compat would have polluted the shared base.
- **Closes upstream `#1104`** — the data-masonry auto-init had quirks around timing (sync vs async ready), error swallowing (one bad data attribute would break all auto-init), and namespace collisions. None of these affect users who write `new Masonry(...)` explicitly. Migration: convert `<div data-masonry='{"columnWidth":200}'>` to a `<script>new Masonry('.grid', {columnWidth: 200})</script>` block at the bottom of the page.
- **`Object.assign({}, ...)`** is universally available at our browser baseline (chrome 84+ etc). Used twice in the inlined subclass. Could shave a few more bytes by switching to `{...Outlayer.defaults}` spread syntax — left for a future micro-optimization pass.
- **`Item.D` (inline EvEmitter)** is the next deletion candidate. With hide/reveal/stagger gone and the `this.once('transitionEnd', ...)` callsite from `Item.remove()` deleted, the only remaining `once()` callers are the public API for plugin authors. Worth checking if any internal code still uses `once()` before deleting.
