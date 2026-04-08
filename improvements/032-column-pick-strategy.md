# 032 — Column-pick strategy callback (item I — closes upstream #811)

**Status:** landed
**Roadmap section:** § 811 / FORK_ROADMAP.md item I
**Closes upstream issues:** **`desandro/masonry#811`** (10 reactions — "Custom column placement strategy")
**Tag:** `v5.0.0-dev.32`

## Hypothesis

The current `getTopColPosition` always picks the leftmost-shortest column. Users have been asking for a way to override this since 2017 (`desandro/masonry#811`). Common alternatives:

- **Rightmost shortest** — visual variety, breaks the "items always cling to the left" pattern
- **Round-robin** — predictable distribution, ignore item content
- **Random** — chaos
- **Content-aware** — pick based on item text/class/data attributes

Add an `options.pickColumn` callback that receives the `colGroup` array (Y values for each valid horizontal position) and returns the chosen index. Default behavior is preserved exactly when the option is unset.

Predicted cost: ~50-150 B gz (one new option, one new helper function `indexOfMin`, one parameter through the call chain).

## Method

### `getTopColPosition` accepts a `pickColumn` arg

```js
function getTopColPosition( colSpan, colYs, cols, pickColumn ) {
  var colGroup = getTopColGroup( colSpan, colYs, cols );
  var col = pickColumn ? pickColumn( colGroup ) : indexOfMin( colGroup );
  return {
    col: col,
    y: colGroup[ col ],
  };
}

function indexOfMin( arr ) {
  var min = arr[0];
  var idx = 0;
  for ( var i = 1; i < arr.length; i++ ) {
    if ( arr[i] < min ) { min = arr[i]; idx = i; }
  }
  return idx;
}
```

The `indexOfMin` extraction also replaces the previous `Math.min.apply(Math, colGroup) + colGroup.indexOf(minimumY)` two-pass approach with a single-pass loop — slight perf win on top of enabling the customization hook.

### `placeItem` + `Masonry.computeLayout` thread the option through

The state object passed to `placeItem` now carries `pickColumn`:

```js
var state = {
  cols: this.cols,
  colYs: this.colYs,
  columnWidth: this.columnWidth,
  horizontalColIndex: this.horizontalColIndex,
  horizontalOrder: this.options.horizontalOrder,
  pickColumn: this.options.pickColumn,
};
```

`Masonry.computeLayout` (Phase 2 of PRETEXT_SSR) reads `opts.pickColumn` and threads it through the same state object — the option works in pure-Node SSR layout precomputation just like in client-side layout.

### `proto._getTopColPosition` proto wrapper updated

The backward-compat shim from #016 forwards `this.options.pickColumn` to the helper. Plugin authors who reach into `instance._getTopColPosition()` directly get the pickColumn behavior automatically.

### `masonry.d.ts` — `pickColumn?: (colGroup: number[]) => number`

Added to both `MasonryOptions` and `ComputeLayoutOptions` with full JSDoc and three example strategies (rightmost shortest, round-robin, random).

### Discriminating fixture (`test/visual/pages/pick-column.html`)

4 items in a 3-col 180px container with a RIGHTMOST-shortest picker (`<=` instead of `<`). Layout trace:

| Item | colGroup before | Default picker | Rightmost picker |
|---|---|---|---|
| 0 | `[0, 0, 0]` | col 0, y=0 | **col 2, y=0** |
| 1 | `[0, 0, 30]` (default) / `[30, 30, 0]` (right) | col 1, y=0 | **col 1, y=0** (only zero left) |
| ... | | | |
| 3 | `[30, 30, 30]` | col 0, y=30 | **col 2, y=30** |

The two pickers produce **opposite** layouts — items walk left-to-right with the default vs right-to-left with the rightmost picker. The position assertion checks both ends (item 0 at left=120 not left=0, item 3 at left=120 not left=0). Verified to fail loudly when `pickColumn` is unset.

## Numbers

| Metric | pre-032 | post-032 | Δ |
|---|---:|---:|---:|
| `dist/masonry.pkgd.js` raw | 49,007 | 49,426 | +419 |
| `dist/masonry.pkgd.js` gz | 9,426 | 9,518 | +92 |
| `dist/masonry.pkgd.min.js` raw | 21,822 | **21,985** | **+163** |
| `dist/masonry.pkgd.min.js` gz | 7,120 | **7,166** | **+46** |
| `dist/masonry.pkgd.min.js` brotli | 6,453 | **6,486** | **+33** |
| Visual regression tests | 11/11 | **12/12** | +1 (`pick-column`) |
| Compute-layout test | 9/9 | 9/9 | byte-for-byte unchanged |
| Other gates | all green | all green | unchanged |

### Vs upstream-frozen v4.2.2

| Metric | v4.2.2 | v5.0.0-dev.32 | Δ |
|---|---:|---:|---:|
| `dist/masonry.pkgd.min.js` raw | 24,103 | **21,985** | **−2,118 (−8.79 %)** |
| `dist/masonry.pkgd.min.js` gz | 7,367 | **7,166** | **−201 (−2.73 %)** |
| `dist/masonry.pkgd.min.js` brotli | 6,601 | **6,486** | **−115 (−1.74 %)** |

Still comfortably below upstream gz.

## Verdict

✅ **Match — landed at the lower end of the predicted +50-150 B gz band (46 B actual).** The under-shoot is because `indexOfMin` replaces the existing `Math.min.apply(Math, ...) + colGroup.indexOf()` pattern — net code growth was less than expected.

**Closes upstream `desandro/masonry#811`** (10 reactions, open since 2017). The user-facing API is one option, the internal change is one parameter threaded through the call chain. `Masonry.computeLayout` accepts it too — server and client share the same picker logic.

## Notes / lessons

- **The `colGroup` parameter is the right abstraction**, not raw `colYs` + `colSpan`. The picker doesn't need to know how many columns the item spans — `colGroup` already accounts for the span (it's an array with one entry per valid horizontal position).
- **Closure-based stateful pickers** (round-robin counter, content-aware mappings) work because the user constructs the closure in their option object literal. Each masonry instance gets its own picker function and closure state.
- **Item J (parent max-width with fitWidth)** is a related upstream issue (#1129, 3 reactions) that's still pending. Could be batched into a follow-up. Less impactful than I (10 vs 3 reactions).
- **The `indexOfMin` extraction** is a small bonus refactor: the previous `Math.min.apply(Math, colGroup) + colGroup.indexOf(minimumY)` did two passes (find min, then find its index). The new helper does one pass. Net win on the layout hot path.
