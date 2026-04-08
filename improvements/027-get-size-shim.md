# 027 — `get-size` shim — drop the runtime dep (item O)

**Status:** landed
**Roadmap section:** § Post-#010 (review #4 + review #5 sharpening) / FORK_ROADMAP.md item O
**Tag:** `v5.0.0-dev.27`

## Hypothesis

Replace the bundled `desandro/get-size` package (~200 LOC) with a ~25 LOC inlined shim. The original includes:

- A `setup()` probe to detect IE11/Firefox-<29 box-sizing quirks (#007 already deleted that)
- A `getStyleSize()` helper that explicitly rejects percent strings
- A 14-property box-model extraction loop
- A `getZeroSize()` builder for hidden elements
- A `getStyle()` wrapper with a Firefox bug workaround

At our browser baseline (chrome 84+ / firefox 86+ / safari 15+ / edge 84+):

- `offsetWidth/offsetHeight` return the visual box dimensions (including padding + border, regardless of `box-sizing`). **No probe needed.**
- `getComputedStyle` returns resolved px values for all numeric props. **No `getStyleSize` needed.**

Predicted savings: **~150-280 B gz** + drop one runtime dep (`get-size`) so masonry-pretext's runtime `dependencies` count goes from 2 → 1.

## Method

Mirroring the matches-selector shim pattern from #003: a new esbuild plugin (`getSizeShimPlugin`) intercepts the `get-size` import resolution and substitutes the inlined shim. Registered alongside the matches-selector shim in `baseConfig.plugins`.

The shim returns the same object shape that masonry/outlayer consumes (`width/height/innerWidth/innerHeight/outerWidth/outerHeight` plus the 12 padding/margin/border properties used by `_getBoundingRect` and `_setContainerMeasure`). String selectors are still resolved via `document.querySelector` for backward compat with `_getMeasurement`.

```js
function getSize( elem ) {
  if ( typeof elem == 'string' ) elem = document.querySelector( elem );
  if ( !elem || typeof elem != 'object' || !elem.nodeType ) return;
  var style = getComputedStyle( elem );
  var size, i;
  if ( style.display == 'none' ) {
    size = { width: 0, height: 0, innerWidth: 0, innerHeight: 0, outerWidth: 0, outerHeight: 0 };
    for ( i = 0; i < 12; i++ ) size[ GS_PROPS[i] ] = 0;
    return size;
  }
  size = { width: elem.offsetWidth, height: elem.offsetHeight };
  for ( i = 0; i < 12; i++ ) {
    size[ GS_PROPS[i] ] = parseFloat( style[ GS_PROPS[i] ] ) || 0;
  }
  size.innerWidth = size.width - size.paddingLeft - size.paddingRight - size.borderLeftWidth - size.borderRightWidth;
  size.innerHeight = size.height - size.paddingTop - size.paddingBottom - size.borderTopWidth - size.borderBottomWidth;
  size.outerWidth = size.width + size.marginLeft + size.marginRight;
  size.outerHeight = size.height + size.marginTop + size.marginBottom;
  return size;
}
```

The previous `node_modules/get-size/get-size.js` `DEP_FILE_PATCHES` block (with #005 SSR transform + 3 #007 box-sizing transforms) is no longer reached because the shim resolves first. Block left as a comment for the audit trail.

`get-size` removed from `package.json` `dependencies`. masonry-pretext now has **one runtime dependency** (`outlayer`). The transitive `outlayer → get-size` is still satisfied at install time but never actually loaded by the dist outputs.

## Numbers

| Metric | pre-027 | post-027 | Δ |
|---|---:|---:|---:|
| `dist/masonry.pkgd.js` raw | 57,043 | 54,495 | **−2,548** |
| `dist/masonry.pkgd.js` gz | 10,716 | 10,295 | **−421** |
| `dist/masonry.pkgd.min.js` raw | 24,731 | **23,967** | **−764** |
| `dist/masonry.pkgd.min.js` gz | 8,001 | **7,733** | **−268** |
| `dist/masonry.pkgd.min.js` brotli | 7,261 | **7,017** | **−244** |
| `dist/masonry.cjs` raw | 53,766 | 51,358 | −2,408 |
| `dist/masonry.mjs` raw | 54,956 | 52,550 | −2,406 |
| Runtime `dependencies` | 2 | **1** | −1 |
| Visual + ssr + module + compute-layout + no-jquery | all green | all green | unchanged |

### Vs upstream-frozen v4.2.2

| Metric | v4.2.2 | v5.0.0-dev.27 | Δ |
|---|---:|---:|---:|
| `dist/masonry.pkgd.min.js` raw | 24,103 | **23,967** | **−136** |
| `dist/masonry.pkgd.min.js` gz | 7,367 | 7,733 | +366 |

The fork is **back below upstream raw** (−136 B). Gzipped is still +366 B above upstream — the SSR feature line cost has not yet been fully recovered. Items A, C, D, E, J still pending; combined with the existing −268 B gz savings here, the fork should be back below upstream gz with margin to spare.

## Verdict

✅ **Match — landed at the upper end of the predicted +150-280 B gz band, plus dropped a runtime dep.** The shim's correctness was verified by all 10 visual fixtures + 9 compute-layout cases + ssr-smoke + module-smoke + no-jquery passing on the first build with no debugging needed.

The shim's `offsetWidth + getComputedStyle + parseFloat` pattern is fundamentally simpler than the original's multi-branch box-sizing detection, AND faster (one `getComputedStyle` call instead of one per measurement check). Per-call allocation is a single object literal — same as the original.

## Notes / lessons

- **Shim plugins beat dep-file patches** when the goal is wholesale replacement. The matches-selector shim (#003) and now this get-size shim both replace the entire upstream package with ~10-25 LOC of inline source. The DEP_FILE_PATCHES approach excels for surgical edits to a few lines; full replacements should use a shim from the start.
- **The previous `get-size.js` `DEP_FILE_PATCHES` are now dead code** but kept as a comment for the audit trail. Future deletion is fine if a contributor finds the dead block confusing.
- **Dropping `get-size` from `dependencies`** is technically a transparent change because outlayer's transitive dep still satisfies the install. But the user-facing message ("masonry-pretext now has 1 runtime dep") is meaningfully different from "2 runtime deps" — supply-chain audit tools surface the latter and not the former.
- **The shim is masonry-specific in shape** (it returns exactly the fields masonry uses) but generic enough to drop into any consumer of `desandro/get-size`. If a user clones masonry-pretext for their own layout library, the shim plugin is reusable.
