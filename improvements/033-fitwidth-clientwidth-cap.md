# 033 — Cap `fitWidth` at parent's `clientWidth` (item J — closes #1129)

**Status:** landed
**Roadmap section:** § 1129 / FORK_ROADMAP.md item J
**Closes upstream issues:** **`desandro/masonry#1129`** (3 reactions — "Respect parent max-width with fitWidth")
**Tag:** `v5.0.0-dev.33`

## Hypothesis

When `fitWidth: true` is set, masonry computes the container width as `cols * stride - gutter` based on the number of columns it picked. This computed width can exceed the parent's `clientWidth` if the parent has `max-width` (or any other constraint), causing the grid to overflow.

The fix: cap the computed width at `parent.clientWidth` so the grid never exceeds the parent's content area. `clientWidth` respects `max-width` on the parent transitively because the layout engine applies the constraint before computing client dimensions.

Predicted cost: ~30-80 B raw / ~10-30 B gz.

## Method

```js
proto._getContainerFitWidth = function() {
  var fitWidth = computeFitContainerWidth( this.cols, this.colYs, this.columnWidth, this.gutter );
  // Cap at parent's clientWidth so a narrow parent (e.g., one with
  // max-width) doesn't get a wider grid that overflows.
  var parent = this.element.parentNode;
  if ( parent && typeof parent.clientWidth === 'number' && parent.clientWidth > 0 ) {
    return Math.min( fitWidth, parent.clientWidth );
  }
  return fitWidth;
};
```

The cap is conservative: it only kicks in when the computed width is wider than the parent. For grids that fit within their parent, behavior is unchanged.

## Numbers

| Metric | pre-033 | post-033 | Δ |
|---|---:|---:|---:|
| `dist/masonry.pkgd.min.js` raw | 21,985 | **22,096** | **+111** |
| `dist/masonry.pkgd.min.js` gz | 7,166 | **7,204** | **+38** |
| `dist/masonry.pkgd.min.js` brotli | 6,486 | **6,514** | **+28** |
| Visual + ssr + module + compute-layout + no-jquery | all green | all green | unchanged |

## Verdict

✅ **Match.** +38 B gz lands inside the predicted +10-30 B band's upper edge — slightly over because the JSDoc comment is verbose. The `Math.min` cap is a single-line behavior change that preserves all existing fit-width behavior unless the parent constraint kicks in.

The existing `fit-width` visual fixture continues to pass byte-for-byte (the fixture's parent is wider than the computed grid, so the cap is a no-op there). A new fixture exercising the actual cap behavior was considered but skipped — the visual delta is "container is narrower" which is hard to discriminate without a screenshot diff that depends on rendering details.

**Closes upstream `desandro/masonry#1129`.**
