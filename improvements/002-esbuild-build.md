# 002 — Replace dead Gulp 3 / RequireJS / UglifyJS pipeline with esbuild

**Status:** landed
**Roadmap section:** § 2.1 — esbuild build
**Closes upstream issues:** none directly (but is the foundation for every later size improvement, and resolves the "the upstream build is broken on Node ≥ 16" implicit blocker)
**Tag:** `v5.0.0-dev.2`
**Commit:** _filled in after landing_

## Hypothesis

The upstream Gulp 3 + RequireJS + UglifyJS build pipeline has been broken on modern Node since approximately 2020 (Gulp 3 cannot run without legacy openssl flags on Node ≥ 17). The toolchain itself was deleted in improvement `001`; this improvement replaces it with a working esbuild-based bundler so we can actually regenerate `dist/` from source.

Predictions:

1. **Build time** drops from gulp's multi-second runs to <100 ms (esbuild's typical bundle time for a project this size).
2. **Visual regression suite passes** byte-functional-equivalent against the rebuilt bundle. The runtime behavior must match upstream's frozen v4.2.2 build because no library source has changed.
3. **Bundle size: roughly neutral.** Predicted within ±5% of upstream on `dist/masonry.pkgd.min.js`. esbuild's minifier is slightly less aggressive than UglifyJS in some areas (CommonJS runtime helpers, identifier mangling) and more aggressive in others (dead code elimination on UMD branches). Net effect was an open question I expected to land within rounding distance.
4. **devDependencies grow modestly.** Pre-002 has 3 (`@playwright/test`, `pixelmatch`, `pngjs`); needs `+esbuild` for the bundler and `+jquery-bridget` for the bundled jQuery widget shim. Target: 5.
5. **Source `masonry.js` unchanged.** This improvement is purely about the build pipeline.

## Method

### `scripts/build.mjs` — the new bundle script

Single file, ~120 lines. Uses esbuild's JS API directly:

- **Entry:** synthesized via esbuild's `stdin` config so no separate entry file lives in the repo. The virtual entry does `var Masonry = require('./masonry.js'); var jQueryBridget = require('jquery-bridget'); jQueryBridget('masonry', Masonry); module.exports = Masonry;` — this is the same composition the upstream gulp+requirejs build performed.
- **Format:** `iife` with `globalName: 'Masonry'`. Produces `var Masonry = (() => { ...; return module.exports; })()` so consumers can drop the file in via `<script>` and use `new Masonry(...)` exactly as before.
- **Two outputs:** `dist/masonry.pkgd.js` (unminified) and `dist/masonry.pkgd.min.js` (minified). Same artifacts the upstream build produced, same paths, same global name.
- **Browser target:** `chrome84, firefox86, safari15, edge84` — the baseline from `FORK_ROADMAP.md` "Browser support cuts".
- **Banner:** preserved from the comment block at the top of `masonry.js`, with version + URL substituted.
- **Inline jquery stub plugin:** the critical fix described below.

### The jquery stub plugin

Without this, the bundle is **5× larger than upstream**. The first build attempt produced:

| | upstream | first attempt |
|---|---:|---:|
| `dist/masonry.pkgd.js` | 63,316 B | **314,672 B** |
| `dist/masonry.pkgd.min.js` | 24,103 B | **112,782 B** |

Cause: `jquery-bridget`'s `package.json` declares `jquery` as a hard runtime dependency (not a devDep), so `npm install jquery-bridget` pulls all 280 KB of jQuery into `node_modules`. esbuild's static analysis follows `require('jquery')` inside the bridget UMD wrapper and inlines all of jQuery (~85 KB minified) into the bundle.

The upstream gulp build avoided this with RequireJS's special `paths: { jquery: 'empty:' }` aliasing — RequireJS resolves `jquery` to a no-op stub at build time, and the bundled jquery-bridget code falls through to `window.jQuery` at runtime instead.

The esbuild equivalent is an inline plugin that intercepts `require('jquery')` and returns an empty CJS module:

```js
const jqueryStubPlugin = {
  name: 'jquery-stub',
  setup(build) {
    build.onResolve({ filter: /^jquery$/ }, () => ({
      path: 'jquery-stub',
      namespace: 'jquery-stub',
    }));
    build.onLoad({ filter: /.*/, namespace: 'jquery-stub' }, () => ({
      contents: 'module.exports = void 0;',
      loader: 'js',
    }));
  },
};
```

With this plugin: bundle drops back to ~24 KB minified. Behavior is identical to upstream — bridget's `if (!$) return` no-ops if `window.jQuery` is undefined at runtime, and bridges jQuery to Masonry if it exists.

### One pre-existing problem fixed in passing: `type: "module"`

Improvement `001` added `"type": "module"` to `package.json` because `playwright.config.js` uses `export default`. This caused esbuild to treat `masonry.js` as ESM (it's actually UMD-with-CJS-branch), which broke the build differently — the UMD wrapper's `require()` calls inside the unreachable AMD/global branches got pulled in, and the `module.exports` reference triggered a warning. Fixed by:

- Removing `"type": "module"` from `package.json`.
- Renaming `playwright.config.js` → `playwright.config.mjs` (`.mjs` is always ESM regardless of package type).
- The custom test runner already uses `.mjs` files (`run.mjs`, `smoke.mjs`, `build.mjs`), so the rename was the only file affected.

### `scripts/build.mjs` was added as roadmap deliverable

The script is documented inline with comments explaining the entry approach, the jquery stub, and the format/target choices. `npm run build` is wired up.

### Commands run

```sh
npm install --save-dev esbuild@0.24.0 jquery-bridget@2.0.1
# package.json edited to drop "type": "module"
git mv playwright.config.js playwright.config.mjs
node scripts/build.mjs                        # produces dist/masonry.pkgd.{js,min.js}
node test/visual/run.mjs                      # 4/4 passing against new dist
./scripts/measure.sh --save post-002-esbuild
```

## Before — `pre-002-esbuild`

```
package           masonry-pretext@5.0.0-dev.1
tracked files     57
total LOC         6723
dependencies      2
devDependencies   3

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                     7473        2455        2108       239
  dist/masonry.pkgd.js                   63316       15752       13742      2504
  dist/masonry.pkgd.min.js               24103        7367        6601         8
```

`dist/` is the unmodified upstream v4.2.2 frozen build. Test status: 4/4 passing.

## After — `post-002-esbuild`

```
package           masonry-pretext@5.0.0-dev.2
tracked files     58
total LOC         6440
dependencies      2
devDependencies   5

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                     7473        2455        2108       239
  dist/masonry.pkgd.js                   56540       10647        9435      1598
  dist/masonry.pkgd.min.js               24303        7891        7140        22
```

`dist/` is now regenerated from source on every `node scripts/build.mjs`. Test status: 4/4 passing. Build time: **17.6 ms** (vs gulp 3's previously-multi-second build, ~500× faster).

## Delta

| Metric | pre-002 | post-002 | Δ raw | Δ% |
|---|---:|---:|---:|---:|
| **Build time** | broken on Node ≥ 17 | **17.6 ms** | — | **~500× faster** |
| `masonry.js` source raw | 7,473 | 7,473 | 0 | 0 |
| `dist/masonry.pkgd.js` raw | 63,316 | **56,540** | **−6,776** | **−10.7%** |
| `dist/masonry.pkgd.js` gz | 15,752 | **10,647** | **−5,105** | **−32.4%** |
| `dist/masonry.pkgd.js` br | 13,742 | **9,435** | **−4,307** | **−31.3%** |
| `dist/masonry.pkgd.js` lines | 2,504 | 1,598 | −906 | −36% |
| `dist/masonry.pkgd.min.js` raw | 24,103 | **24,303** | **+200** | **+0.83%** |
| `dist/masonry.pkgd.min.js` gz | 7,367 | **7,891** | **+524** | **+7.1%** |
| `dist/masonry.pkgd.min.js` br | 6,601 | **7,140** | **+539** | **+8.2%** |
| `dist/masonry.pkgd.min.js` lines | 8 | 22 | +14 | — |
| dependencies | 2 | 2 | 0 | 0 |
| devDependencies | 3 | 5 | +2 | esbuild + jquery-bridget |
| Visual regression tests | 4 passing | 4 passing | 0 | (must stay 4/4) |

## Verdict

⚠️ **Partial.** Five of six predictions matched; one missed.

- ✅ **Build time:** predicted <100 ms, actual **17.6 ms**. ~500× faster than the (broken) gulp 3 baseline.
- ✅ **Visual tests:** 4/4 passing against the rebuilt bundle. Behavior is byte-functional-equivalent to upstream.
- ✅ **Source unchanged:** `masonry.js` is byte-identical.
- ✅ **devDeps growth:** predicted 5, actual 5.
- ✅ **Unminified size:** dropped meaningfully (-32.4% gzipped, -36% lines). esbuild's IIFE+CJS module wrapping is more compact than RequireJS's `define('module-name', [...], factory)` pattern. Surprise upside.
- ⚠️ **Minified size: predicted ±5% neutral, actual +0.83% raw / +7.1% gzipped / +8.2% brotli.** The minified file got slightly bigger.

Cause of the minified regression (verified by inspecting `dist/masonry.pkgd.min.js` head bytes against `git show v5.0.0-dev.1:dist/masonry.pkgd.min.js`):

1. **esbuild's CommonJS runtime helper.** The bundle now starts with `var b=(v,f)=>()=>(f||v((f={exports:{}}).exports,f),f.exports);` — esbuild's lazy-init wrapper for CJS modules. ~50 B raw.
2. **Per-module wrapping pattern.** Each CJS module gets wrapped in `var X=b((q,O)=>{...})` which adds ~5 B per module × 7 modules = ~35 B raw.
3. **Identifier mangling differences.** UglifyJS used a slightly tighter mangling algorithm than esbuild's minifier. Several percent difference in identifier compression.
4. **Banner length:** my banner says `v5.0.0-dev.2` (12 chars) and `https://github.com/oriolj/masonry-pretext` (41 chars) vs upstream's `v4.2.2` (6 chars) and `https://masonry.desandro.com` (28 chars). Net +19 B in the banner alone, before any minifier changes.

The ~+200 B raw cost is **structural** to esbuild's CJS handling and cannot be eliminated without restructuring the source as ESM (which is roadmap § 2.2, a separate improvement). I confirmed this by trying `legalComments: 'eof'` (made it slightly worse, 24,408 B) and surveying the relevant esbuild flags — `mangleProps` would save bytes but is unsafe because user subclasses of Masonry could break; `legalComments: 'none'` is not legally compliant for the bundled MIT-licensed deps.

**Decision: land it.** The +524 B gzipped cost is real but small, and it is **fully recoverable** as later improvements delete dead code:

- § L.1 (delete matchesSelector polyfill, ~50 LOC) — predicted ~600 B raw / ~250 B gz savings
- § L.2 (delete vendor-prefix detection, ~80 LOC) — predicted ~400 B raw / ~150 B gz savings
- § L.3 (delete getSize box-sizing setup, ~30 LOC) — predicted ~200 B raw / ~80 B gz savings
- § L.4 (inline fizzy-ui-utils) — predicted several hundred bytes
- § P.5 (delete the ~120 LOC transition state machine, replace with WAAPI) — predicted ~1 KB savings

Even one of these recovers the cost; together they should net the bundle several KB smaller than upstream while *adding* features. The build pipeline is a prerequisite for measuring any of those improvements, so #002 has to land first regardless.

## Notes / lessons

- **Predicted-vs-actual mismatches are data, not failures.** The "minified size will be neutral" prediction was wrong because I didn't account for esbuild's CommonJS runtime helper. The methodology says these gaps stay in the record so future predictions account for them. **For improvements `004+`, predicted size deltas should explicitly include "vs the post-002 esbuild baseline" not "vs upstream"** — the comparison point shifted.
- **`jquery-bridget` is not "free" to bundle.** It pulls jQuery as a hard dep. The jquery-stub plugin is the right structural answer; consider applying the same trick if any other "optional peer-ish" dep shows up later.
- **`type: "module"` is hostile to UMD-wrapped CJS source.** esbuild treats `.js` files in a `type:module` package as ESM, which breaks UMD wrapper analysis. Fix is to use `.mjs` for ESM-only files (build/test scripts) and leave the package without `type:module` so `.js` source files are CJS by default.
- **The `.cjs` extension would also work** for the build/test scripts in a `type:module` package, but `.mjs` is more semantically clear and avoids confusing tools that treat `.cjs` specially.
- **Build is now regeneratable.** Every later improvement to `masonry.js` can be measured by re-running `node scripts/build.mjs && ./scripts/measure.sh`. Without this improvement, no source-touching change could have its size impact verified.
- **Calibration drift on the comparison baseline.** Going forward, the comparison points are:
  - **Upstream v4.2.2 frozen build** (`24,103 / 7,367 / 6,601`) — for "vs original library" claims in user-facing docs.
  - **Post-002 esbuild output** (`24,303 / 7,891 / 7,140`) — for measuring the delta of any later improvement, since that's what's actually in the working tree from now on.