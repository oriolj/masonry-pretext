# 013 — ESM + CJS bundle outputs (real § 2.2)

**Status:** landed
**Roadmap section:** § 2.2 (Ship a real ESM build with `exports` field)
**Closes upstream issues:** none directly, but unblocks **every** modern-bundler consumer (Vite, Rollup, esbuild, webpack 5, Astro, Next.js, Nuxt, SvelteKit, etc.)
**Tag:** `v5.0.0-dev.13`
**Commit:** _filled in after landing_

## Hypothesis

The Tier 0 packaging fix in #011 added the `exports` field to `package.json` but pointed every condition (`import`, `require`, `default`) at `dist/masonry.pkgd.min.js`. That bundle is `format: 'iife'` + `globalName: 'Masonry'` — which produces:

```js
"use strict";var Masonry=(()=>{ /* … */ })();
```

A bare top-level `var`. **No `module.exports`. No `export default`. Nothing for a bundler's module loader to attach to.** When Vite (or any other modern bundler) does `await import('masonry-pretext')`, the dynamic import resolves to a module record with `default = undefined`, and the consumer gets:

```
TypeError: Masonry is not a constructor
  at initMasonry
```

This is the exact failure mode caught by an external consumer (`enacast-astro`) during the dev.12 → dev.13 upgrade. The IIFE works for `<script src="…">` browser drop-in (because the top-level `var` becomes a window global in script-tag context) but **not** for any importer that goes through a module loader. The Tier 0 metadata fix only changed the *advertisement* — bundlers still got a non-functional artifact.

This improvement ships the real fix: two new bundle outputs in module-friendly formats, plus an `exports` map that routes consumers to the right one.

### Predictions

1. **Two new files in `dist/`**: `masonry.cjs` (CommonJS, ~48 KB raw) and `masonry.mjs` (ES module, ~50 KB raw). Both unminified — bundlers minify the consumer's final output, so shipping pre-minified library code only inflates source maps.
2. **`make test`**: still 7/7 visual + ✓ SSR + ✓ no-jquery, **plus** a new ✓ module-smoke gate that loads both bundles via Node's actual `require()` and `import()`.
3. **`require('masonry-pretext')` from Node**: returns the constructor function directly (`typeof === 'function'`, `prototype.layout` is callable).
4. **`import('masonry-pretext').then(m => m.default)` from Node**: same constructor as the CJS path.
5. **The IIFE bundles are unchanged byte-for-byte** — `dist/masonry.pkgd.{js,min.js}` are produced by the same esbuild call as before. Existing `<script>` tag consumers see no diff.
6. **In `enacast-astro`** (the canary downstream): the `await import('masonry-pretext')` call in `MasonryGrid.tsx` resolves to a working constructor, the masonry layout actually runs in the browser, and the previously-failing `SantJustWeekly` modular page renders with positioned items.

## Method

### Files touched

- `scripts/build.mjs` — split the entry into `cjsEntryContents` (existing `module.exports = require(...)`) + new `esmEntryContents` (`import M from '...'; export default M;`); refactored `sharedConfig` into `baseConfig` + `iifeSharedConfig` + new `cjsConfig` + new `esmConfig`; added two more parallel `esbuild.build()` calls; updated the size-logging block to print all four files.
- `package.json` —
  - bumped `version` `5.0.0-dev.12` → `5.0.0-dev.13`
  - `main`: `./dist/masonry.pkgd.min.js` → `./dist/masonry.cjs`
  - `module`: `./dist/masonry.pkgd.min.js` → `./dist/masonry.mjs`
  - `exports['.']`: rewired `import` → `masonry.mjs`, `require` → `masonry.cjs`, `default` → `masonry.mjs`
  - added subpath exports for the IIFE bundles: `./browser` → `masonry.pkgd.min.js`, `./browser/unminified` → `masonry.pkgd.js`. The pre-existing `./unminified` subpath is left intact for backwards compat with anyone who pinned to dev.11/dev.12.
  - added `test:modules` npm script + wired `node test/visual/module-smoke.mjs` into the main `test` script
- `test/visual/module-smoke.mjs` (new, ~80 lines) — Node smoke test that loads `dist/masonry.cjs` via `createRequire(...)` and `dist/masonry.mjs` via dynamic `import(pathToFileURL(...))`, then asserts the result is a constructor with a callable `prototype.layout`. Distinct from `ssr-smoke.mjs` (which loads the IIFE as raw text into a `vm.runInContext` and only validates SSR safety, not module-loader resolution).
- `Makefile` — added `node test/visual/module-smoke.mjs` to the `test` and `test-update` targets, between the SSR smoke and the no-jquery check.
- `scripts/measure.sh` — added `file_row` lines for `dist/masonry.cjs` and `dist/masonry.mjs` so the metric table shows all four bundles.

### Why three formats and not two

Modern packages typically ship just CJS + ESM and let bundlers handle the rest. We keep IIFE because:
- The visual test suite loads `dist/masonry.pkgd.min.js` via `<script>` in raw HTML pages (`test/visual/pages/*.html`). Switching them to ESM would require an HTTP server or a build step inside the test fixtures — net negative.
- It's the path documented for direct CDN usage (`<script src="…masonry.pkgd.min.js">`). Removing it would silently break that workflow.
- Building the IIFE is free — esbuild produces all four outputs in ~17 ms.

### Why CJS and ESM are not minified

- esbuild can minify them, but the consumer's bundler will minify the final output again, so pre-minifying the library only saves an insignificant amount of bandwidth on `node_modules/` while making source maps point at obfuscated names. Modern packaging convention is to ship readable library code.
- The IIFE bundles are minified because their consumers (`<script>` tag users) have no bundler in the pipeline to minify for them.

### Why `platform: 'browser'` (not `'neutral'`) for the module bundles

The bundle's dependency tree is browser-targeted (DOM access, `getComputedStyle`, `MutationObserver`, `ResizeObserver`). The SSR patches in #005 add `typeof window !== 'undefined'` guards at module-load time, which makes the bundles **safe to import** in Node — but they're not meant to actually run in Node. Using `platform: 'browser'` is the honest signal of intent and matches the IIFE config. The new module-smoke test verifies that "import in Node without crashing" still works.

### Why the entry path uses absolute paths in `JSON.stringify`

esbuild's `stdin.contents` doesn't have a real file path on disk, so relative imports like `require('./masonry.js')` don't have a base directory to resolve against. `stdin.resolveDir = ROOT` *should* fix that, but the absolute-path approach is what the existing IIFE entry already uses (and it works), so I kept the convention for consistency. It's also more robust against future refactors that move the build script around.

### Manual verification commands

```bash
# Build all four bundles
node scripts/build.mjs

# CJS smoke
node -e "const M = require('./dist/masonry.cjs'); \
  console.log(typeof M, typeof M.prototype.layout)"

# ESM smoke
node --input-type=module -e "import('./dist/masonry.mjs').then(m => \
  console.log(typeof m.default, typeof m.default.prototype.layout))"

# Full gate (rebuilds + 7 visual + ssr-smoke + module-smoke + no-jquery)
make test
```

## Before — `pre-013`

```
package           masonry-pretext@5.0.0-dev.12
tracked files     82
total LOC         13889
dependencies      2
devDependencies   4

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                    12914        4206        3587       361
  dist/masonry.pkgd.js                   52126        9844        8759      1463
  dist/masonry.pkgd.min.js               22984        7323        6591        22
```

7/7 visual + ✓ SSR + ✓ no-jquery (run via `make test`).

`require('masonry-pretext')` from a Node REPL returns `{}` (esbuild's IIFE wrapper has no exports).

`enacast-astro` console: `TypeError: Masonry is not a constructor at initMasonry`.

## After — `post-013`

```
package           masonry-pretext@5.0.0-dev.13
tracked files     84
total LOC         13893
dependencies      2
devDependencies   4

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                    12914        4206        3587       361
  dist/masonry.pkgd.js                   52126        9844        8759      1463
  dist/masonry.pkgd.min.js               22984        7323        6591        22
  dist/masonry.cjs                       49099        9735        8669      1456
  dist/masonry.mjs                       50288       10215        9079      1480
```

7/7 visual + ✓ SSR + ✓ **module-smoke (NEW)** + ✓ no-jquery (run via `make test`).

`require('./dist/masonry.cjs')` returns a constructor function with `name === 'SubClass'` and the full prototype chain (`_create`, `_observeItemElement`, `_itemize`, `remove`, `destroy`, `_resetLayout`, `measureColumns`, `layout`, …).

`import('./dist/masonry.mjs')` returns a module record `{ default: <constructor> }` with the same prototype chain.

`enacast-astro` console: layout runs, items get positioned, the `SantJustWeekly` masonry page renders correctly.

## Delta

| Metric                                  |     pre-013 |    post-013 | Δ          |
| ---                                     |         ---:|         ---:| ---        |
| `dist/masonry.pkgd.js` raw              |      52,126 |      52,126 | **0**      |
| `dist/masonry.pkgd.min.js` raw          |      22,984 |      22,984 | **0**      |
| `dist/masonry.pkgd.min.js` gzip         |       7,323 |       7,323 | **0**      |
| `dist/masonry.cjs` raw                  |    (absent) |      49,099 | **+49 KB** |
| `dist/masonry.cjs` gzip                 |    (absent) |       9,735 | **+9.7 KB**|
| `dist/masonry.mjs` raw                  |    (absent) |      50,288 | **+50 KB** |
| `dist/masonry.mjs` gzip                 |    (absent) |      10,215 | **+10 KB** |
| Tracked files                           |          82 |          84 | +2         |
| Total LOC                               |      13,889 |      13,893 | +4 (build script + measure.sh) |
| Visual + smoke gates                    | 7 + ✓ + ✓   | 7 + ✓ + ✓ + ✓ | +1 (module-smoke) |
| `dependencies`                          |           2 |           2 | unchanged  |
| `devDependencies`                       |           4 |           4 | unchanged  |
| Build time (4 outputs vs 2)             |      ~14 ms |      ~18 ms | +4 ms      |
| Modern-bundler consumers can install    | **broken**  | **works**   | ✅          |

The new `dist/` files add ~100 KB raw / ~20 KB gz to the **published tarball**, but **zero** to what any consumer ships in their own bundle. Modern bundlers tree-shake into a single output and only ESM-or-CJS gets pulled in (depending on resolver), not both. The `<script>` tag path is unaffected — those users still download just `masonry.pkgd.min.js`.

## Verdict

✅ **Match.** All six predictions held.

| Prediction                                              | Predicted             | Actual                | Status |
| ---                                                     | ---                   | ---                   | ---    |
| `dist/masonry.cjs` + `dist/masonry.mjs` produced        | yes, ~48 + ~50 KB raw | 49,099 + 50,288 B raw | ✅      |
| `make test` still passes (now with module-smoke)        | 7 + ✓×3               | 7 + ✓×3               | ✅      |
| `require('./dist/masonry.cjs')` → constructor           | yes                   | yes (`function`)      | ✅      |
| `import('./dist/masonry.mjs').default` → constructor    | yes                   | yes (`function`)      | ✅      |
| IIFE bundles byte-identical                             | yes                   | yes (52,126 / 22,984) | ✅      |
| `enacast-astro` browser test passes                     | yes                   | _verified post-build_ | ✅      |

## Notes / lessons

- **The Tier 0 metadata fix in #011 was necessary but not sufficient.** It pointed `exports` at the existing dist files without verifying that those files actually had module exports. The lesson: when adding `exports` conditions, smoke-test each one (`require()` for `require`, `import()` for `import`) before claiming the field is correct. Adding the new `module-smoke.mjs` to the test gate makes this regression-impossible going forward.
- **`format: 'iife'` is for browser globals only.** It's tempting to think esbuild's IIFE bundle is "just" a JS module that happens to also assign to a global, but it has no module exports of any kind. If you want both `<script>` tag drop-in *and* bundler import support, you need separate builds. esbuild handles this in the same script with negligible overhead.
- **`stdin.contents` with absolute paths inside `require()` is uglier but more reliable** than relative paths + `stdin.resolveDir`. The two should be equivalent, but the absolute-path version is what the IIFE entry already used and what works without surprises across esbuild versions.
- **Three `default` and `import` entries pointing at the same file is intentional.** The roadmap snippet (§ 2.2) showed `"default": "./dist/masonry.js"` (the IIFE). I picked `./dist/masonry.mjs` for `default` instead because the modern convention is "default = import for any tool that walks the conditions." A consumer that only checks `default` (rare) gets the ESM bundle, which is what they almost certainly want.
- **The `./browser` and `./browser/unminified` subpath exports are escape hatches for the script-tag use case** when consumers want to reach the IIFE bundle via the package name instead of digging into `node_modules/masonry-pretext/dist/`. The pre-existing `./unminified` is also kept so dev.11/dev.12 users who pinned to it don't break.
- **Enabling the SSR-safe import path in module bundles required no source changes** — the `typeof window !== 'undefined'` patches from #005 were already in place because the IIFE's SSR smoke needed them. The new CJS/ESM bundles inherit them automatically. Free win.
- **`make test` is now an "every-condition" gate.** It runs the IIFE in vm context (SSR-safe in script-tag form), the CJS in Node `require()` (SSR-safe in CommonJS form), the ESM in Node `import()` (SSR-safe in ES-module form), AND the visual regression suite in chromium (the actual layout works in a browser). Four loaders × one source = four chances to catch a regression. This is the kind of test coverage Tier 0 was supposed to deliver.
- **Future work for § 2.2 closeout:** the roadmap also mentions "Build a sample Vite app importing Masonry, compare `dist/assets/*.js` size before/after" as the verification step. The `enacast-astro` canary essentially is that — a real Astro/Vite project consuming the package. A standalone minimal repro could live under `test/integration/vite-consumer/` for CI purposes; deferred since the current downstream test exists.
