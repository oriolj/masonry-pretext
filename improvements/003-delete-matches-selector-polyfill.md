# 003 — Delete the `desandro-matches-selector` polyfill (§ L.1)

**Status:** landed
**Roadmap section:** § L.1
**Closes upstream issues:** none directly
**Tag:** `v5.0.0-dev.3`
**Commit:** _filled in after landing_

## Hypothesis

`desandro-matches-selector` is a 50-LOC polyfill bundled into `dist/masonry.pkgd.{js,min.js}` via the dep chain `masonry → outlayer → fizzy-ui-utils → desandro-matches-selector`. It walks `Element.prototype` looking for one of:

```js
['matches', 'matchesSelector', 'webkitMatchesSelector',
 'mozMatchesSelector', 'msMatchesSelector', 'oMatchesSelector']
```

This is **dead code in 2026.** `Element.matches` shipped unprefixed in:

- Chrome 34 (March 2014)
- Firefox 34 (December 2014)
- Safari 7.1 (September 2014)
- Edge — every version since the Chromium switch

It is **universally available at our target browser baseline** (chrome 84 / firefox 86 / safari 15 / edge 84, all 2020–2021 — see `FORK_ROADMAP.md` § Browser support cuts).

The polyfill consumers (`fizzy-ui-utils.getParent` and `fizzy-ui-utils.filterFindElements`) only ever pass `(elem, selector)` and only ever expect a boolean back. The replacement is a one-liner: `function(elem, selector) { return elem.matches(selector); }`.

Predictions:

1. **`dist/masonry.pkgd.min.js` raw:** −300 to −450 B (the polyfill takes ~480 B raw post-minify; the one-liner replacement is ~80 B; net ~400 B saving).
2. **`dist/masonry.pkgd.min.js` gzip:** −80 to −150 B. The vendor-prefix array compresses well, so gzip savings are smaller than raw.
3. **`dist/masonry.pkgd.min.js` brotli:** similar to gzip, maybe slightly better.
4. **`dist/masonry.pkgd.js` (unminified):** larger raw saving because the polyfill comments + UMD wrapper are gone — predict −800 to −1,200 B raw, −100 to −200 B gz.
5. **Visual regression suite:** must remain 4/4 passing. If anything in the masonry/outlayer/fizzy-ui-utils chain calls `matchesSelector` with a non-Element argument, `Element.matches` would throw. The polyfill version has the same behavior (it dispatches to the same platform method), so this should be safe — but the visual suite is the gate.
6. **No source change to `masonry.js`.** The deletion happens at build time via an esbuild plugin, not by editing `node_modules/`.

If the prediction holds, **`dist/masonry.pkgd.min.js` raw will go below upstream's frozen v4.2.2 number for the first time in the fork**, partially recovering the +200 B raw cost from the post-002 esbuild regression.

## Method

### The shim plugin

I cannot edit code inside `node_modules/desandro-matches-selector/` without forking the package. Instead, an inline esbuild plugin (mirroring the existing `jquery-stub` plugin from improvement 002) intercepts `require('desandro-matches-selector')` at bundle time and substitutes a one-line module:

```js
const matchesSelectorShimPlugin = {
  name: 'matches-selector-shim',
  setup(build) {
    build.onResolve({ filter: /^desandro-matches-selector$/ }, () => ({
      path: 'matches-selector-shim',
      namespace: 'matches-selector-shim',
    }));
    build.onLoad({ filter: /.*/, namespace: 'matches-selector-shim' }, () => ({
      contents:
        'module.exports = function(elem, selector) { return elem.matches(selector); };',
      loader: 'js',
    }));
  },
};
```

Added to `scripts/build.mjs` next to the existing `jqueryStubPlugin`. The plugin list in `sharedConfig.plugins` becomes `[jqueryStubPlugin, matchesSelectorShimPlugin]`.

### Why a build-time shim, not a source change

- The polyfill lives in `node_modules/desandro-matches-selector/matches-selector.js`, which is a third-party dep we don't own.
- Forking the dep + repointing `package.json` would add maintenance burden for a 50-LOC change.
- Editing `node_modules/` directly is fragile (lost on `npm install`).
- The shim plugin is the same shape as the jquery-stub plugin from #002, so the build-script architecture stays consistent.
- Future improvements 004/005/006 (delete vendor-prefix detection, getSize box-sizing setup, etc.) will use the same pattern.

### Commands run

```sh
./scripts/measure.sh --save pre-003-matches      # capture pre-state
# edit scripts/build.mjs — add matchesSelectorShimPlugin
make build                                       # esbuild output
make test                                        # 4/4 passing
./scripts/measure.sh --save post-003-matches     # capture post-state
```

## Before — `pre-003-matches`

```
package           masonry-pretext@5.0.0-dev.2
tracked files     59
total LOC         6666
dependencies      2
devDependencies   5

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                     7473        2455        2108       239
  dist/masonry.pkgd.js                   56540       10646        9435      1598
  dist/masonry.pkgd.min.js               24303        7890        7136        22
```

Visual test status: 4/4 passing.

## After — `post-003-matches`

```
package           masonry-pretext@5.0.0-dev.3
tracked files     60
total LOC         6728
dependencies      2
devDependencies   5

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                     7473        2455        2108       239
  dist/masonry.pkgd.js                   55543       10521        9317      1569
  dist/masonry.pkgd.min.js               23902        7788        7040        22
```

Visual test status: 4/4 passing. Build time: 18 ms (unchanged).

## Delta

| Metric | pre-003 | post-003 | Δ raw | Δ% |
|---|---:|---:|---:|---:|
| `masonry.js` source | 7,473 / 2,455 / 2,108 | 7,473 / 2,455 / 2,108 | 0 | 0 |
| `dist/masonry.pkgd.js` raw | 56,540 | **55,543** | **−997** | **−1.76%** |
| `dist/masonry.pkgd.js` gzip | 10,646 | **10,521** | **−125** | **−1.17%** |
| `dist/masonry.pkgd.js` brotli | 9,435 | **9,317** | **−118** | **−1.25%** |
| `dist/masonry.pkgd.js` lines | 1,598 | 1,569 | −29 | — |
| `dist/masonry.pkgd.min.js` raw | 24,303 | **23,902** | **−401** | **−1.65%** |
| `dist/masonry.pkgd.min.js` gzip | 7,890 | **7,788** | **−102** | **−1.29%** |
| `dist/masonry.pkgd.min.js` brotli | 7,136 | **7,040** | **−96** | **−1.34%** |
| Visual tests | 4 / 4 | 4 / 4 | 0 | — |
| dependencies | 2 | 2 | 0 | — |
| devDependencies | 5 | 5 | 0 | — |
| build time | 18 ms | 18 ms | 0 | — |

### Vs the upstream-frozen v4.2.2 baseline

Going forward this is the user-facing comparison row. (The post-002 esbuild baseline is the engineering comparison.)

| Metric | upstream v4.2.2 | post-003 | Δ raw | Δ% |
|---|---:|---:|---:|---:|
| `dist/masonry.pkgd.min.js` raw | 24,103 | **23,902** | **−201** | **−0.83%** |
| `dist/masonry.pkgd.min.js` gzip | 7,367 | 7,788 | +421 | +5.71% |
| `dist/masonry.pkgd.min.js` brotli | 6,601 | 7,040 | +439 | +6.65% |

**The minified raw is now smaller than upstream for the first time.** The gzip + brotli are still slightly larger because esbuild's CommonJS runtime helper compresses worse than UglifyJS's RequireJS-AMD output (the structural cost from improvement 002). Roughly **20% of the post-002 gzip regression is now recovered** — improvements 004–006 should close the rest of the gap.

## Verdict

✅ **Match.** All six predictions held within the stated bands.

| Prediction | Predicted | Actual | Status |
|---|---|---|---|
| min.js raw | −300 to −450 B | **−401 B** | ✅ middle of band |
| min.js gz | −80 to −150 B | **−102 B** | ✅ middle of band |
| min.js br | similar to gz | **−96 B** | ✅ |
| pkgd.js raw | −800 to −1,200 B | **−997 B** | ✅ middle of band |
| pkgd.js gz | −100 to −200 B | **−125 B** | ✅ middle of band |
| Visual tests pass | 4/4 | 4/4 | ✅ |
| Source unchanged | yes | yes | ✅ |

**This is the first improvement that landed strictly inside the predicted band on every numeric column** — a sign the calibration from #001 + #002 (and the cleaner methodology) is paying off.

## Notes / lessons

- **The build-time shim plugin pattern is reusable.** Same shape as `jquery-stub` from #002. The next improvements (delete vendor-prefix detection, delete getSize box-sizing setup) will use variants of the same pattern — possibly substituting `outlayer/item.js` and `get-size.js` modules instead of just declared deps. May need a path-based filter rather than a package-name filter for those.
- **`Element.matches` is safe at our target baseline.** Verified that nothing in the masonry/outlayer/fizzy-ui-utils call chain passes a non-Element to `matchesSelector`. If it did, both the polyfill and the native API would throw the same `TypeError`, so behavior is preserved.
- **Pre/post measurement labels overlapped temporarily.** I captured `pre-003-matches` against commit `8f1f497` (before the Makefile housekeeping commit), then captured `post-003-matches` against commit `ac177b8` (after the Makefile commit). The Makefile is a doc-only change with zero library bytes, so the dist deltas are clean attribution to the matchesSelector deletion. The +1 file count delta is the Makefile, not part of #003.
- **First "raw bytes < upstream" data point.** This is the threshold where the fork starts being a strict size win at the user-facing comparison level. Gzip is lagging because of the esbuild CJS runtime cost, but the trend is clearly downward and the next few deletions should close the gap.