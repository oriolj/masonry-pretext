# 026 — WeakMap-keyed instance registry (item N)

**Status:** landed
**Roadmap section:** § Post-#010 (review #4) / FORK_ROADMAP.md item N
**Tag:** `v5.0.0-dev.26`

## Hypothesis

Replace `var GUID + var instances = {} + element.outlayerGUID expando` with a single module-level `WeakMap<Element, Outlayer>`. Eliminates:

- The `GUID` counter + integer ID allocations
- The `outlayerGUID` expando on every container element (potential memory leak if `destroy()` is never called)
- The global `instances{}` object that retains every instance reference indefinitely

The WeakMap automatically GCs entries when the container element is collected, even without explicit `destroy()`. The alive-check pattern in `masonry.js` (`self.element && self.element.outlayerGUID`) used by the `#010` fonts.ready callback and the `#012` ResizeObserver callback shifts to a `_destroyed` boolean set in `destroy()`.

## Method

### `outlayer.js` build-time patches

1. Replace `var GUID = 0; var instances = {};` with `var instances = new WeakMap();`
2. Constructor: replace `var id = ++GUID; this.element.outlayerGUID = id; instances[id] = this;` with `instances.set(this.element, this);`
3. `destroy()`: replace the GUID delete block with `instances.delete(this.element); this._destroyed = true;`
4. `Outlayer.data(elem)`: replace the GUID lookup with `return elem && instances.get(elem);`

### `masonry.js` source edits

Both alive-check call sites (#010 fonts.ready, #012 ResizeObserver) shift from:

```js
if ( self.element && self.element.outlayerGUID ) { self.layout(); }
```

to:

```js
if ( !self._destroyed ) { self.layout(); }
```

Cleaner, faster (no DOM expando read), and more semantically meaningful.

### `getItem` linear scan

The roadmap item N also mentions replacing the `proto.getItem` linear scan with a per-instance `WeakMap<Element, Item>`. **Deferred to a future improvement** to keep this commit focused on the global registry. Per-instance WeakMap requires touching `_itemize` (additions) AND `proto.remove` (deletions) AND lazy-initializing the WeakMap, which is a separate concern from the global registry overhaul.

## Numbers

| Metric | pre-026 | post-026 | Δ |
|---|---:|---:|---:|
| `dist/masonry.pkgd.js` raw | 57,230 | 57,043 | −187 |
| `dist/masonry.pkgd.js` gz | 10,771 | 10,716 | −55 |
| `dist/masonry.pkgd.min.js` raw | 24,846 | **24,731** | **−115** |
| `dist/masonry.pkgd.min.js` gz | 8,031 | **8,001** | **−30** |
| `dist/masonry.pkgd.min.js` brotli | 7,288 | **7,261** | **−27** |
| Visual + ssr + module + compute-layout + no-jquery | all green | all green | unchanged |

## Verdict

✅ **Match.** Smaller bundle + cleaner alive-checks + eliminates the `outlayerGUID` expando memory leak class. The per-instance `getItem` WeakMap is deferred but the dominant share of registry plumbing (the global instances object) is now WeakMap-based.

The fork's bundle is now back at the upstream byte size for the first time since #017. **Cumulative recovery from the SSR feature line: ~245 B gz across #023 + #024 + #026.**
