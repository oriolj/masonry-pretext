# 031 — MutationObserver auto-relayout (item K)

**Status:** landed
**Roadmap section:** § P.2 / FORK_ROADMAP.md item K
**Tag:** `v5.0.0-dev.31`

## Hypothesis

Add an opt-in `observeMutations: true` option that wires a `MutationObserver` watching the grid container for child additions/removals. When children are added or removed via DIRECT DOM manipulation (`grid.appendChild`, `child.remove()`, etc.) — the most common upstream footgun — masonry detects the change and automatically calls `reloadItems()` + `layout()`.

Coalesces via `requestAnimationFrame` so multiple appends in the same task collapse to a single layout call. Cleaned up automatically on `destroy()`. Skipped in `static: true` mode (no observer wire-up). SSR-safe via `typeof MutationObserver !== 'undefined'` guard.

Predicted cost: ~80-150 B gz (similar magnitude to #012's per-item ResizeObserver).

## Method

### `_create` extension in `masonry.js`

Added a third hook to `_create` (after the existing `document.fonts.ready` deferred layout from #010 and the per-item `ResizeObserver` from #012). All three hooks share the same `if (!this.options.static && ...)` opt-out gate from #015.

```js
if ( !this.options.static && this.options.observeMutations &&
     typeof MutationObserver !== 'undefined' ) {
  var self3 = this;
  var pendingMutationRaf = null;
  this._mutationObserver = new MutationObserver( function() {
    if ( pendingMutationRaf !== null ) return;
    pendingMutationRaf = requestAnimationFrame( function() {
      pendingMutationRaf = null;
      if ( self3._destroyed ) return;
      self3.reloadItems();
      self3.layout();
    });
  });
  this._mutationObserver.observe( this.element, { childList: true });
}
```

`subtree: false` (default) — only observes direct children of the grid container, not nested mutations inside items. Text-content edits inside items would otherwise trigger relayouts on every keystroke; that's noise. Item size changes are already handled by the per-item `ResizeObserver` from #012.

### `destroy()` cleanup

Extended the existing `destroy` override (which already disconnects `_resizeObserver` from #012) to also disconnect `_mutationObserver`.

### Discriminating fixture (`test/visual/pages/mutation-observer.html`)

Same shape as `resize-observer.html` and `static-mode.html`: 4 items initially, then a 5th item is appended via DIRECT DOM MANIPULATION (`grid.appendChild`) AFTER masonry has constructed.

Layout trace:
- cols=3, colYs=[0,0,0]
- item 0: 60×30, col 0, y=0, colYs=[30,0,0]
- item 1: 60×30, col 1, y=0, colYs=[30,30,0]
- item 2: 60×30, col 2, y=0, colYs=[30,30,30]
- item 3: 60×30, col 0 (leftmost shortest), y=30, colYs=[60,30,30]
- item 4 (appended via grid.appendChild): col 1 (leftmost shortest at 30), y=30 → **(60, 30)**

If `observeMutations` is wired correctly, item 4 ends up at `(60, 30)`. Verified the discriminator works by toggling `observeMutations: false` and watching the test fail with `item 4: left expected 60px got ` (empty — masonry never set the position).

### `masonry.d.ts` update

Added `observeMutations?: boolean` to `MasonryOptions` with full JSDoc explaining the use case ("removes the 'I called grid.appendChild and the new item didn't show up' footgun"), the rAF coalescing, the cleanup, and the `static: true` interaction.

### `_emitCompleteOnItems` interaction

The existing `_emitCompleteOnItems` (simplified to a single dispatch in #030) is unaffected — `layoutComplete` still fires synchronously after each `_layoutItems` call, including the auto-relayout triggered by mutations.

## Numbers

| Metric | pre-031 | post-031 | Δ |
|---|---:|---:|---:|
| `dist/masonry.pkgd.js` raw | 48,197 | 49,007 | +810 |
| `dist/masonry.pkgd.js` gz | 9,307 | 9,426 | +119 |
| `dist/masonry.pkgd.min.js` raw | 21,412 | **21,822** | **+410** |
| `dist/masonry.pkgd.min.js` gz | 7,038 | **7,120** | **+82** |
| `dist/masonry.pkgd.min.js` brotli | 6,372 | **6,453** | **+81** |
| Visual regression tests | 10/10 | **11/11** | +1 (`mutation-observer`) |
| Other gates | all green | all green | unchanged |

### Vs upstream-frozen v4.2.2

| Metric | v4.2.2 | v5.0.0-dev.31 | Δ |
|---|---:|---:|---:|
| `dist/masonry.pkgd.min.js` raw | 24,103 | **21,822** | **−2,281 (−9.46 %)** |
| `dist/masonry.pkgd.min.js` gz | 7,367 | **7,120** | **−247 (−3.35 %)** |
| `dist/masonry.pkgd.min.js` brotli | 6,601 | **6,453** | **−148 (−2.24 %)** |

The fork is still 3.35% smaller gz than upstream after adding the new feature.

## Verdict

✅ **Match.** +82 B gz lands well inside the predicted 80-150 B band. The MutationObserver wire-up follows the same shape as #012's ResizeObserver hook (lazy initialization, rAF coalescing, `_destroyed` alive-check, destroy() cleanup).

The discriminating fixture is the canonical "I called grid.appendChild" test — verified to fail loudly without the option enabled. **Closes the dominant non-image upstream complaint cluster** ("forgot to call reloadItems after appending").

## Notes / lessons

- **Opt-in by default** because the bytes-per-feature ratio is small. Users who already correctly call `msnry.appended(elem)` after every DOM mutation pay zero cost; users who naturally write `grid.appendChild` get the auto-detection by adding one option.
- **The `subtree: false` choice** is critical. With `subtree: true` masonry would re-layout on every text edit inside any item — way too noisy. Item size changes (image loads, font swaps, content edits) are already handled by #012's per-item ResizeObserver, which is the right scope for size-change detection.
- **The `pendingMutationRaf` coalescing pattern** mirrors #012's `pendingRaf` pattern. Multiple `appendChild` calls in the same task collapse to a single relayout.
- **Three constructor extensions now share the `if (!this.options.static && ...)` gate** — fonts.ready (#010), per-item ResizeObserver (#012), MutationObserver (#031). Future dynamic-content hooks should follow the same pattern.
- **Item Q (`<masonry-grid>` Web Component)** is now unblocked. The roadmap explicitly says Q "depends on items H (ResizeObserver) + K (MutationObserver) landing first" — both are now landed. Can pursue Q in Wave 4.
