# Release notes — masonry-pretext

User-visible changes in the fork. The format roughly follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) but with two extras specific to this fork:

- An **upstream-issue** column for changes that close a known issue in `desandro/masonry`.
- A **predicted vs actual** line for any change that targeted a numeric improvement (size, perf), per the methodology in `FORK_ROADMAP.md` § Methodology.

The full per-change records — hypothesis, before/after measurements, test status, verdict — live in [`improvements/`](./improvements/). This file is the user-facing summary; `improvements/` is the engineering audit trail.

> **Heads up:** masonry-pretext is a fork. It is not a drop-in replacement for `masonry-layout` v4.2.2. Versions are pre-release until v5.0.0 ships. Check the changes below carefully if you are migrating an existing project.

---

## Unreleased — v5.0.0-dev

Work in progress toward v5.0.0. See [`FORK_ROADMAP.md`](./FORK_ROADMAP.md) for the full plan and [`improvements/`](./improvements/) for per-change details.

---

## v5.0.0-dev.11 — 2026-04-08 — Tier 0 foundation: README + packaging + CI + portable harness

> Tag: `v5.0.0-dev.11` · Improvement: [`011-tier0-foundation.md`](./improvements/011-tier0-foundation.md) · Closes upstream: _none directly_

### Headline

Closes the four foundation gaps surfaced by the post-#010 multi-review (`FORK_ROADMAP.md` § Post-#010 review). **Zero source code change, zero bundle byte change.** Pure adoption ergonomics + automation. Highest-leverage improvement so far per unit of effort.

### Removed

- **Stale upstream README sections** — `Install` / `CDN` / `Package managers` / `Initialize` / `Support Masonry development`. They told users to `npm install masonry-layout`, `bower install`, use unpkg URLs pointing at upstream's frozen v4.2.2, and call `$('.grid').masonry({...})` (jQuery removed in #006). None worked. Replaced with masonry-pretext-correct content.

### Added

- **`masonry.d.ts`** — hand-written TypeScript declarations covering the public API (~210 lines). Includes `MasonryOptions` (with the legacy `is`-prefixed compat aliases), `Masonry` class, `MasonrySize`/`MasonryItem` interfaces, and the `pretextify` callback typed correctly.
- **`.github/workflows/test.yml`** — GitHub Actions CI. Runs `make ci` on every push to master and every PR. Caches the chromium download. Uses Node 22, ubuntu-latest, `npx playwright install --with-deps chromium`. The "every commit must pass `make test`" rule from § Methodology is now enforced by automation, not just convention.
- **README sections**: `From source` install, `Pinning a specific dev tag` via `npm install github:...#v5.0.0-dev.10`, `Browser support`, `With pretext` example showing the headline fork feature with `@chenglou/pretext`.
- **`package.json` `exports` field** with `types` / `import` / `require` / `default` conditions on `.`, plus `./source` and `./unminified` subpath exports for advanced users.
- **`package.json` `sideEffects: false`** so bundlers can tree-shake.
- **`package.json` `module` + `types` fields**.

### Changed

- **`package.json` `main`**: `"masonry.js"` → `"./dist/masonry.pkgd.min.js"`. The previous `main` pointed at the source UMD wrapper, which works but doesn't include the build-time transforms (vendor prefix deletion, jQuery removal, etc.). Pointing at the bundled file gives consumers the optimized version.
- **`test/visual/_harness.mjs`** chromium launch hardened: now passes `--no-sandbox`, `--disable-dev-shm-usage`, `--disable-gpu`. Required for the test suite to run in unprivileged containers (GitHub Actions, Docker, sandboxed dev environments). Verified by an external reviewer whose `npm test` failed on Chromium launch in their sandbox before this change.
- **`package.json` `files`** array: added `"masonry.d.ts"` so it ships in the npm tarball.
- **Footer credit** in README: "Original library by David DeSandro · `masonry-pretext` fork by Oriol Jimenez (primarily developed by Claude)".

### Numbers

| File | Metric | pre-011 | v5.0.0-dev.11 | Δ |
|---|---|---:|---:|---:|
| `dist/masonry.pkgd.js` | raw / gz / br | 49,493 / 9,337 / 8,306 | 49,493 / 9,337 / 8,306 | **0** (no source change) |
| `dist/masonry.pkgd.min.js` | raw / gz / br | 21,736 / 6,957 / 6,267 | 21,736 / 6,957 / 6,267 | **0** (no source change) |
| Visual + SSR + no-jquery gates | passing | all | all | unchanged |
| `npm pack --dry-run` files | count | 5 | **6** | +1 (`masonry.d.ts`) |
| `npm pack --dry-run` tarball size | | ~21 KB | ~28 KB | +7 KB |
| Tracked files | | 75 | 77 | +2 (`masonry.d.ts`, `.github/workflows/test.yml`) |
| `dependencies` | | 2 | 2 | unchanged |
| `devDependencies` | | 4 | 4 | unchanged |

### Predicted vs actual

All six predictions matched (dist byte-identical, all gates pass, npm pack shows new d.ts, devDeps/deps unchanged, README is followable).

### Migration notes

- **Stale README readers:** if you were following the old README's `npm install masonry-layout` instructions on this fork's repo, they were never going to work. Use the new `From source` section.
- **TypeScript users:** you now get autocomplete via `masonry.d.ts`. Import like `import Masonry, { MasonryOptions } from 'masonry-pretext'` (assuming you've installed via the git URL). If types drift from runtime, file an issue — the d.ts is hand-written and could lag.
- **Bundler users:** the `exports` field now exists, so Vite/Rollup/webpack 5 will pick `dist/masonry.pkgd.min.js` instead of guessing at the source. If you specifically want the source (for custom build tooling), use `import 'masonry-pretext/source'`.
- **CI consumers:** the new GitHub Actions workflow validates every PR. Forking + cloning + opening a PR will auto-run the gates.
- **`dist/` file consumers:** byte-identical to pre-011. No SRI hash regeneration needed.

---

## v5.0.0-dev.10 — 2026-04-08 — `document.fonts.ready` first-paint gate (§ P.4)

> Tag: `v5.0.0-dev.10` · Improvement: [`010-document-fonts-ready.md`](./improvements/010-document-fonts-ready.md) · **Closes upstream**: [`desandro/masonry#1182`](https://github.com/desandro/masonry/issues/1182)

### Headline

When a custom web font hasn't finished loading at masonry construction time, items get measured at the fallback font's rendered height and the resulting layout overlaps until something triggers a relayout. This has been upstream issue `#1182` since 2022 with no fix.

The web platform has a clean primitive for this: `document.fonts.ready` is a Promise that resolves when all currently-pending font loads finish. Wired into masonry's `_create` so the layout automatically reruns when fonts are ready.

### Added

- **`_create` override in `masonry.js`** that schedules a deferred `layout()` via `document.fonts.ready.then(...)`. Guarded by `typeof document` (SSR-safe), `document.fonts.status !== 'loaded'` (no-op when fonts are already loaded), and `self.element && self.element.outlayerGUID` (no-op if the instance was destroyed before fonts loaded).
- **`test/visual/pages/fonts-ready.html`** — discriminating fixture that mocks `document.fonts.status` and `document.fonts.ready` BEFORE loading the bundle. CSS grows item 0 from 30→60px when `[data-fonts-loaded]` is set. After resolving the mock promise, the position assertion verifies item 3 lands at `(60, 30)` (post-font-load) rather than `(0, 30)` (pre-font-load).
- **6th visual regression fixture in `make test`.** Was 5/5 visual + ssr + no-jquery, now 6/6 + ssr + no-jquery.

### Numbers

| File | Metric | pre-010 | v5.0.0-dev.10 | Δ |
|---|---|---:|---:|---:|
| `masonry.js` source | raw | 7,997 | 8,860 | +863 B (mostly the doc comment, stripped by minifier) |
| `dist/masonry.pkgd.min.js` | raw | 21,517 | **21,736** | **+219 B (+1.02 %)** |
| `dist/masonry.pkgd.min.js` | gzip | 6,894 | **6,957** | **+63 B (+0.91 %)** |
| `dist/masonry.pkgd.min.js` | brotli | 6,224 | **6,267** | **+43 B (+0.69 %)** |
| Visual regression tests | passing | 5 / 5 | **6 / 6** | +1 (fonts-ready fixture) |
| SSR + no-jquery gates | passing | ✓ + ✓ | ✓ + ✓ | unchanged |

### vs upstream-frozen v4.2.2

| Metric | v4.2.2 | v5.0.0-dev.10 | Δ |
|---|---:|---:|---:|
| `dist/masonry.pkgd.min.js` raw | 24,103 | **21,736** | **−2,367 B (−9.82 %)** |
| `dist/masonry.pkgd.min.js` gzip | 7,367 | **6,957** | **−410 B (−5.57 %)** |
| `dist/masonry.pkgd.min.js` brotli | 6,601 | **6,267** | **−334 B (−5.06 %)** |

The fork is **still over 9 % smaller raw / 5.5 % smaller gzipped** vs upstream after both feature additions (#009 pretext + #010 fonts-ready).

### Predicted vs actual

- min.js raw: +60-120 B predicted, **+219 B actual** (~100 B over the band). Calibration: method overrides with closure-captured base + conditional + async callback cost ~150-250 minified bytes, not ~80. Updating future predictions.
- min.js gz: +25-60 B predicted, **+63 B actual** (3 B over the top of the band).
- All gates green; new discriminating fixture verifies the hook fires correctly.

### Migration notes

- **None for existing users.** The hook is opt-in via the platform: if `document.fonts.status === 'loaded'` at construction, the guard short-circuits and behavior is identical to before. If fonts are pending, you get an automatic relayout when they load — no API change required.
- **CDN consumers**: regenerate SRI hashes (bundle bytes have changed).

---

## v5.0.0-dev.9 — 2026-04-08 — Pretext integration: `pretextify` callback (§ 1.1) — **HEADLINE FEATURE**

> Tag: `v5.0.0-dev.9` · Improvement: [`009-pretext-integration.md`](./improvements/009-pretext-integration.md)

### Headline

The reason the fork is named **masonry-pretext**. Added a `pretextify(element, item)` option callback to Masonry: if set and returns `{outerWidth, outerHeight}`, that size is used as-is and `item.getSize()` (which forces a DOM reflow) is **skipped entirely**. Designed to plug into [`@chenglou/pretext`](https://www.npmjs.com/package/@chenglou/pretext) for arithmetic text measurement against cached font metrics, but **library-agnostic on purpose** — works with any DOM-free measurement library, pre-computed sizes from a data file, server-side measurement, or hardcoded fixture values.

### Measured performance

**`test/visual/bench-pretext.mjs`** — a new Playwright-driven microbenchmark, checked in as a permanent tool:

| Items | DOM measurement (median) | `pretextify` (median) | Speedup |
|---:|---:|---:|---:|
| 100 | 2.70 ms | 2.20 ms | **1.23×** (−18.5 %) |
| 500 | 12.60 ms | 9.60 ms | **1.31×** (−23.8 %) |
| 1,000 | 24.40 ms | 20.20 ms | **1.21×** (−17.2 %) |
| 2,000 | 53.40 ms | 41.90 ms | **1.27×** (−21.5 %) |

Consistently **~20-25 % faster initial layout** across grid sizes. The savings are smaller than the "5-10× faster" mental model you might assume from "skip per-item reflows" because **Masonry already does batched read/write** — the first `getSize()` flushes the layout, subsequent reads return cached values. The pretext fast path skips that one reflow + the per-item function-call overhead, which works out to ~20 % of total layout time. **Real, measurable, durable.**

### Usage

```js
import { prepare, layout } from '@chenglou/pretext';

const cache = new WeakMap();
const FONT = '16px/1.5 Inter, sans-serif';

new Masonry('.grid', {
  columnWidth: 280,
  pretextify(elem) {
    let prepared = cache.get(elem);
    if (!prepared) {
      prepared = prepare(elem.dataset.text || elem.textContent, FONT);
      cache.set(elem, prepared);
    }
    const { height } = layout(prepared, 280, 24);
    return { outerWidth: 280, outerHeight: height };
  },
});
```

The callback's lookup must be **O(1)** (`WeakMap`/`Map`/cached `prepare()` result). An O(N) per-call lookup will erase the savings — see the bench-discovered calibration lesson in `improvements/009-pretext-integration.md`.

### Added

- **`pretextify` option** in `masonry.js`. The first user-facing feature added in the fork (improvements 001-008 were build, deletion, SSR fixes).
- **`test/visual/pages/pretext.html`** — discriminating fixture: 4 items with default 60×30 DOM size, `pretextify` callback returns variable heights, expected positions reflect the pretext-derived layout. Item 3 specifically lands at `(60, 30)` not `(0, 30)` — the position assertion catches any wiring regression.
- **`test/visual/bench-pretext.mjs`** — Playwright-driven microbenchmark. `node test/visual/bench-pretext.mjs` runs 500 items × 30 runs by default. Supports `--items=N` and `--runs=N`.
- **5th visual fixture in `make test`.** Was 4 visual + SSR + no-jquery (3 gates), now 5 visual + SSR + no-jquery.

### Numbers

| File | Metric | pre-009 | v5.0.0-dev.9 | Δ |
|---|---|---:|---:|---:|
| `masonry.js` source | raw | 7,510 | 8,220 | +710 B (mostly the doc comment, stripped by minifier) |
| `dist/masonry.pkgd.min.js` | raw | 21,458 | **21,519** | **+61 B (+0.28 %)** |
| `dist/masonry.pkgd.min.js` | gzip | 6,871 | **6,893** | **+22 B (+0.32 %)** |
| `dist/masonry.pkgd.min.js` | brotli | 6,202 | **6,227** | **+25 B (+0.40 %)** |
| Visual regression tests | passing | 4 / 4 | **5 / 5** | +1 (pretext fixture) |
| SSR + no-jquery gates | passing | ✓ + ✓ | ✓ + ✓ | unchanged |

### vs upstream-frozen v4.2.2

| Metric | v4.2.2 | v5.0.0-dev.9 | Δ |
|---|---:|---:|---:|
| `dist/masonry.pkgd.min.js` raw | 24,103 | **21,519** | **−2,584 B (−10.72 %)** |
| `dist/masonry.pkgd.min.js` gzip | 7,367 | **6,893** | **−474 B (−6.43 %)** |
| `dist/masonry.pkgd.min.js` brotli | 6,601 | **6,227** | **−374 B (−5.67 %)** |

The fork is **still over 10 % smaller than upstream raw and 6 % smaller gzipped — even with the headline feature added**. Cost of pretext integration: +22 gzipped bytes for a 17-24 % runtime speedup on opted-in grids.

### Migration notes

- **None for existing users.** `pretextify` is opt-in. Code that doesn't set the option is unaffected — `item.getSize()` runs as before.
- **CDN consumers**: regenerate SRI hashes (bundle bytes have changed).

---

## v5.0.0-dev.8 — 2026-04-08 — Delete unused fizzy-ui-utils methods (§ L.4 partial)

> Tag: `v5.0.0-dev.8` · Improvement: [`008-delete-unused-fizzy-utils.md`](./improvements/008-delete-unused-fizzy-utils.md)

Audit-and-prune pass on `fizzy-ui-utils`. Grepped every `utils.X` call site in `masonry.js` + `outlayer/{outlayer,item}.js` to identify methods that are never reached from the masonry consumption path. **Two methods are dead:** `utils.modulo` and `utils.getParent`. esbuild can't tree-shake them because they're properties on a `utils` object — the whole object stays reachable, all properties stay. Deleted explicitly via build-time exact-string transforms.

### Removed (from the bundle, not from the dep on disk)

- **`utils.modulo`** — `(num, div) => ((num % div) + div) % div`. Never called from masonry/outlayer.
- **`utils.getParent`** — DOM walk to find a matching ancestor. Never called from masonry/outlayer.

### Numbers

| File | Metric | pre-008 | v5.0.0-dev.8 | Δ |
|---|---|---:|---:|---:|
| `dist/masonry.pkgd.js` | raw | 49,191 | **48,829** | **−0.74 %** |
| `dist/masonry.pkgd.js` | gzip | 9,271 | **9,200** | **−0.77 %** |
| `dist/masonry.pkgd.min.js` | raw | 21,596 | **21,458** | **−0.64 %** |
| `dist/masonry.pkgd.min.js` | gzip | 6,924 | **6,871** | **−0.77 %** |
| `dist/masonry.pkgd.min.js` | brotli | 6,245 | **6,202** | **−0.69 %** |
| Visual + SSR + no-jquery gates | passing | all | all | unchanged |

### vs upstream-frozen v4.2.2

| Metric | v4.2.2 | v5.0.0-dev.8 | Δ |
|---|---:|---:|---:|
| `dist/masonry.pkgd.min.js` raw | 24,103 | **21,458** | **−2,645 B (−10.97 %)** |
| `dist/masonry.pkgd.min.js` gzip | 7,367 | **6,871** | **−496 B (−6.73 %)** |
| `dist/masonry.pkgd.min.js` brotli | 6,601 | **6,202** | **−399 B (−6.04 %)** |

### Predicted vs actual

All three numeric predictions inside their bands, all at the **low end** — expected for a deletion this small (~15 LOC of source).

### Migration notes

- **None.** Behavior is unchanged in any browser. CDN consumers should regenerate SRI hashes (bundle bytes have changed).

---

## v5.0.0-dev.7 — 2026-04-08 — Delete get-size box-sizing setup (§ L.3)

> Tag: `v5.0.0-dev.7` · Improvement: [`007-delete-getsize-boxsizing-setup.md`](./improvements/007-delete-getsize-boxsizing-setup.md)

Continuing the dead-code deletion sweep. The bundled `get-size` dependency had a one-time `setup()` function that mounted a probe div to the document, measured it via `getComputedStyle`, and removed it — solely to detect an IE11 / Firefox <29 quirk where `style.width` returned the inner width on border-box elements. At our browser baseline (chrome 84 / firefox 86 / safari 15 / edge 84), the modern behavior is universal — `setup()` always set `isBoxSizeOuter` to `true`, making `isBorderBoxSizeOuter = isBorderBox && true` equivalent to just `isBorderBox`. Pure dead code.

### Removed

- **The `setup()` function** in `node_modules/get-size/get-size.js` (~40 LOC) — the probe-div detection.
- **The `setup();` call** at the top of `getSize()`.
- **The `var isBorderBoxSizeOuter = isBorderBox && isBoxSizeOuter;` declaration** — replaced with direct use of `isBorderBox` in the width/height computation.

### Side benefit

**One forced reflow eliminated** on the first `getSize()` call. `setup()` did `document.createElement('div')` → `appendChild` → `getComputedStyle` → `removeChild`. That round-trip is gone.

### Numbers

| File | Metric | pre-007 | v5.0.0-dev.7 | Δ |
|---|---|---:|---:|---:|
| `dist/masonry.pkgd.js` | raw | 50,043 | **49,191** | **−1.70 %** |
| `dist/masonry.pkgd.js` | gzip | 9,460 | **9,271** | **−2.00 %** |
| `dist/masonry.pkgd.js` | brotli | 8,412 | **8,244** | **−2.00 %** |
| `dist/masonry.pkgd.min.js` | raw | 21,974 | **21,596** | **−1.72 %** |
| `dist/masonry.pkgd.min.js` | gzip | 7,072 | **6,924** | **−2.09 %** |
| `dist/masonry.pkgd.min.js` | brotli | 6,401 | **6,245** | **−2.44 %** |
| Visual + SSR + no-jquery gates | passing | all | all | unchanged |

### vs upstream-frozen v4.2.2

| Metric | v4.2.2 | v5.0.0-dev.7 | Δ |
|---|---:|---:|---:|
| `dist/masonry.pkgd.min.js` raw | 24,103 | **21,596** | **−2,507 B (−10.40 %)** |
| `dist/masonry.pkgd.min.js` gzip | 7,367 | **6,924** | **−443 B (−6.01 %)** |
| `dist/masonry.pkgd.min.js` brotli | 6,601 | **6,245** | **−356 B (−5.39 %)** |

The fork is now over **10 % smaller than upstream in raw bytes, 6 % smaller in gzip, 5.4 % smaller in brotli.**

### Predicted vs actual

All five numeric predictions inside their bands. The brotli savings (−156 B) over-shot the predicted top of band (−150 B) by 6 bytes — calibration: brotli's dictionary-based compression handles short repeated patterns slightly better than gzip on small bundles.

### Migration notes

- **None.** Behavior is unchanged in any browser at the fork's target baseline. CDN consumers should regenerate SRI hashes (bundle bytes have changed).

---

## v5.0.0-dev.6 — 2026-04-08 — Remove jQuery entirely (§ 2.5) — **BREAKING CHANGE**

> Tag: `v5.0.0-dev.6` · Improvement: [`006-remove-jquery.md`](./improvements/006-remove-jquery.md)

### Headline

**Zero `jquery` / `bridget` references remain in `dist/masonry.pkgd.{js,min.js}`.** Verified by a new permanent `make test` gate (`test/visual/no-jquery.mjs`).

**For the first time in the fork, every minified-bundle size metric is below upstream v4.2.2.** The post-002 esbuild gzip regression (+524 B over upstream) is fully repaid, and the fork is now meaningfully smaller in raw, gzip, and brotli.

| Metric | upstream v4.2.2 | v5.0.0-dev.6 | Δ |
|---|---:|---:|---:|
| `dist/masonry.pkgd.min.js` raw | 24,103 | **21,974** | **−2,129 B (−8.83 %)** |
| `dist/masonry.pkgd.min.js` gzip | 7,367 | **7,072** | **−295 B (−4.00 %)** |
| `dist/masonry.pkgd.min.js` brotli | 6,601 | **6,401** | **−200 B (−3.03 %)** |

### ⚠️ Breaking change

**The jQuery shim is gone.** The `$('.grid').masonry({ … })` and `.masonry('reloadItems')` syntax no longer works. Migrate to:

```js
// before
$('.grid').masonry({ columnWidth: 200 });
$('.grid').masonry('reloadItems');
$('.grid').masonry('layout');

// after
const msnry = new Masonry('.grid', { columnWidth: 200 });
msnry.reloadItems();
msnry.layout();
```

The vanilla API has always been the documented primary path; this just removes the optional shim. If you previously had `<script src="jquery.js">` followed by `<script src="masonry.pkgd.min.js">`, you can drop the jQuery script tag — Masonry no longer cares whether jQuery is on the page.

### Removed

- **`jquery-bridget` dropped from `devDependencies`.** `npm install masonry-pretext` no longer walks the tree to install jQuery (jquery-bridget declared `jquery` as a hard runtime dep, which transitively pulled all of jQuery into `node_modules` even though the bundle never used it at runtime).
- **`jquery-bridget` removed from the bundle entry** in `scripts/build.mjs`. The packaged file no longer contains the bridget shim code.
- **Every `if (jQuery) { … }` branch** in `outlayer/outlayer.js` and `fizzy-ui-utils/utils.js` (the constructor `$element` setup, the `dispatchEvent` jQuery event firing, the `destroy` `jQuery.removeData` call, the `Outlayer.create` `$.bridget` call, the `htmlInit` `$.data` call) — directly deleted via build-time exact-string transforms. **Initial attempt** used `const jQuery = false` + esbuild's minifier DCE; that left dead `bridget` references in the minified output because esbuild's constant-folding doesn't cross function-property closures. **Working approach** is direct deletion of each branch.
- **`jqueryStubPlugin`** from `scripts/build.mjs` (the plugin that intercepted `require('jquery')` since #002). With nothing in the bundle requesting jQuery anymore, the stub has nothing to intercept.

### Added

- **`test/visual/no-jquery.mjs`** — string-presence gate that asserts `dist/masonry.pkgd.{js,min.js}` contain zero `jquery` / `bridget` references. Now part of `make test` so future improvements can never silently reintroduce jQuery code (which a behavior-only test would miss).
- **`npm run test:no-jquery`** script for running the gate in isolation.

### Changed

- **`scripts/build.mjs` plugin restructure**: `ssrDomGuardPlugin` renamed to `depFilePatchesPlugin` (and `SSR_FILE_PATCHES` → `DEP_FILE_PATCHES`). The plugin's name was already wrong after #005; this commit broadens it to "all per-file build-time transforms grouped by concern." Each file's transform list now mixes SSR guards, jQuery removal, and any future per-file patches.
- **`devDependencies`** count: 5 → 4.

### Numbers — full delta

| File | Metric | pre-006 | v5.0.0-dev.6 | Δ |
|---|---|---:|---:|---:|
| `dist/masonry.pkgd.js` | raw | 54,501 | **50,043** | **−8.18 %** |
| `dist/masonry.pkgd.js` | gzip | 10,293 | **9,460** | **−8.09 %** |
| `dist/masonry.pkgd.js` | brotli | 9,107 | **8,412** | **−7.63 %** |
| `dist/masonry.pkgd.min.js` | raw | 23,450 | **21,974** | **−6.29 %** |
| `dist/masonry.pkgd.min.js` | gzip | 7,629 | **7,072** | **−7.30 %** |
| `dist/masonry.pkgd.min.js` | brotli | 6,898 | **6,401** | **−7.20 %** |
| Visual regression tests | passing | 4 / 4 | 4 / 4 | unchanged |
| SSR smoke test | passing | ✓ | ✓ | unchanged |
| **no-jquery gate** | passing | (n/a) | **0 / 0 refs** | new gate |
| `devDependencies` | count | 5 | 4 | −1 |

### Predicted vs actual

| Prediction | Predicted | Actual |
|---|---|---|
| min.js raw | −1,400 to −1,900 B | **−1,476 B** ✅ low end of band |
| min.js gzip | −480 to −750 B | **−557 B** ✅ middle of band |
| min.js brotli | similar to gzip | **−497 B** ✅ middle of band |
| **min.js gzip vs upstream flips below** | yes (−170 to −370 B) | **yes (−295 B)** ✅ middle of range — **THE MILESTONE** |
| Visual + SSR + no-jquery gates | green | green |

All four size predictions inside their bands. The headline "gz drops below upstream" landed cleanly in the middle.

### Migration notes

- **If you used the vanilla API (`new Masonry('.grid', { … })`):** zero change. Behavior is identical.
- **If you used the jQuery shim (`$('.grid').masonry({ … })`):** migrate to the vanilla API. The conversion is mechanical — every shim call has a 1-to-1 vanilla equivalent.
- **CDN consumers:** `dist/masonry.pkgd.min.js` byte content has changed substantially; regenerate SRI hashes.
- **`npm install masonry-pretext` no longer installs jQuery** as a transitive dep. If your project relies on jquery-from-masonry's-dep-tree (rare, but possible), you'll need to add jQuery as a direct dep.

---

## v5.0.0-dev.5 — 2026-04-08 — SSR import fix (§ L.2b)

> Tag: `v5.0.0-dev.5` · Improvement: [`005-ssr-import-fix.md`](./improvements/005-ssr-import-fix.md) · **Closes upstream**: [`desandro/masonry#1194`](https://github.com/desandro/masonry/issues/1194), [`#1121`](https://github.com/desandro/masonry/issues/1121), [`#1201`](https://github.com/desandro/masonry/issues/1201)

`import Masonry from 'masonry-pretext'` no longer crashes during Next.js / Nuxt / SvelteKit / Vite SSR build passes. The fix wraps every UMD wrapper's `window` reference with `typeof window !== 'undefined' ? window : {}` so the bundle can be loaded in a Node `vm` context with empty globals. Behavior in the browser is identical — the guard always evaluates to the real `window`, so the visual regression suite is unchanged.

This is the actual fix for the SSR claim that improvement `004` proved was *not* automatic. The new `test/visual/ssr-smoke.mjs` test (added in `004` as a diagnostic; never passed until now) is the verification: it loads `dist/masonry.pkgd.min.js` in a Node `vm` context with empty globals and asserts the IIFE doesn't throw.

### Added

- **`test/visual/ssr-smoke.mjs` is now in `make test`** as a permanent gate. Future improvements that touch module-load DOM access will be blocked at the gate if they introduce a regression.
- **`npm run test:ssr`** script for running the SSR smoke test in isolation.

### Changed

- **`masonry.js` source (line 33):** UMD invocation now passes `typeof window !== 'undefined' ? window : {}` instead of bare `window`. This is the **first source edit** in the fork — every previous improvement went through a build-time plugin. Both `dist/` consumers and direct `require('masonry-pretext')` users get the fix.
- **Build-time patches** (via `scripts/build.mjs` plugins) wrap the UMD call sites in `outlayer/outlayer.js`, `outlayer/item.js`, `get-size/get-size.js`, `fizzy-ui-utils/utils.js`, and `jquery-bridget/jquery-bridget.js`.
- **`fizzy-ui-utils/utils.js` `docReady`** gets a `typeof document === 'undefined' ? return` short-circuit. `Outlayer.create('masonry')` runs at module load and transitively reaches `docReady` via `htmlInit` — the guard prevents the chain from crashing in Node.

### Numbers

| File | Metric | pre-005 | v5.0.0-dev.5 | Δ |
|---|---|---:|---:|---:|
| `masonry.js` source | raw | 7,473 | 7,510 | **+37 B** |
| `dist/masonry.pkgd.min.js` | raw | 23,296 | 23,450 | **+154 B (+0.66 %)** |
| `dist/masonry.pkgd.min.js` | gzip | 7,616 | **7,629** | **+13 B (+0.17 %)** |
| `dist/masonry.pkgd.min.js` | brotli | 6,851 | 6,898 | +47 B |
| Visual regression tests | passing | 4 / 4 | **4 / 4** | unchanged |
| **SSR smoke test** | passing | **✗** | **✓** | **first pass** |

### vs upstream-frozen v4.2.2

| Metric | v4.2.2 | v5.0.0-dev.5 | Δ |
|---|---:|---:|---:|
| `dist/masonry.pkgd.min.js` raw | 24,103 | **23,450** | **−653 B (−2.71 %)** |
| `dist/masonry.pkgd.min.js` gzip | 7,367 | 7,629 | +262 B (+13 vs #004 — that's the entire SSR cost) |
| **SSR import works** | ✗ | **✓** | **first time** |

The +13 B gzipped cost for the SSR fix is **essentially free** — three upstream issues (open for 1–2 years with no movement) close in exchange for less than a gzipped sentence's worth of bytes.

### Predicted vs actual

All six predictions matched within their stated bands. **One under-prediction**: I planned the fix as a single round of patches; the actual investigation needed three iterations of `ssr-smoke.mjs` (forgot `jquery-bridget`'s UMD wrapper, then forgot `fizzy-ui-utils.docReady`'s direct `document.readyState` access). Each missing patch was surfaced in <30 seconds by the test, fixed in another minute, and verified by the next `make test` run. **The methodology converged to a working SSR fix in three iterations** because the gate was already in place.

### Migration notes

- **Browser consumers:** zero behavioral change. The guard always evaluates to the real `window` in any browser context. CDN consumers should regenerate SRI hashes (bundle bytes have changed).
- **SSR consumers:** `import Masonry from 'masonry-pretext'` now works. You still can't `new Masonry(...)` in a Node SSR context — Masonry needs a real DOM at instantiation time — but you can put the `new Masonry` call inside a `useEffect` / `onMount` / client-only block as you would for any client-side library, and the import won't crash the build.

---

## v5.0.0-dev.4 — 2026-04-08 — Delete vendor-prefix detection (§ L.2a)

> Tag: `v5.0.0-dev.4` · Improvement: [`004-delete-vendor-prefix-detection.md`](./improvements/004-delete-vendor-prefix-detection.md) · Closes upstream: _none — see "SSR claim" below_

Second deletion sweep. Removes the vendor-prefix detection block in `outlayer/item.js` plus every consumer site (the `vendorProperties` lookup, the `toDashedAll` helper, the `dashedVendorProperties` table, the `proto.onwebkitTransitionEnd` / `proto.onotransitionend` handlers, the `transitionProperty` truthy guard in `proto.remove`). `transition` and `transform` have been unprefixed in every browser since 2014 and are universally available at the fork's target baseline (Chrome 84 / Firefox 86 / Safari 15 / Edge 84) — the polyfill machinery is dead code.

Applied via a new build-time esbuild plugin (`outlayerItemModernPlugin`) that runs six exact-string substitutions on `node_modules/outlayer/item.js`. Each substitution must succeed or the build aborts loudly — guards against silent breakage if `outlayer` is ever updated upstream.

### Removed

- ~50 raw LOC of dead vendor-prefix detection in `outlayer/item.js`, plus ~30 dependent use sites.
- The `vendorProperties` lookup table (and the per-call indirection in `proto.css`).
- The `toDashedAll` helper.
- `proto.onwebkitTransitionEnd` and `proto.onotransitionend` legacy event handlers.
- `dashedVendorProperties` lookup table.

### Added

- **`test/visual/ssr-smoke.mjs`** — diagnostic script that loads the bundled file in a Node `vm` context with empty globals and asserts the IIFE doesn't throw. Currently fails (see "SSR claim" below). Will be promoted to `make test` when the SSR fix lands.

### Numbers

| File | Metric | pre-004 | v5.0.0-dev.4 | Δ |
|---|---|---:|---:|---:|
| `dist/masonry.pkgd.js` | raw | 55,543 | **54,224** | **−2.37 %** |
| `dist/masonry.pkgd.js` | gzip | 10,521 | **10,285** | **−2.24 %** |
| `dist/masonry.pkgd.js` | brotli | 9,317 | **9,099** | **−2.34 %** |
| `dist/masonry.pkgd.min.js` | raw | 23,902 | **23,296** | **−2.53 %** |
| `dist/masonry.pkgd.min.js` | gzip | 7,788 | **7,616** | **−2.21 %** |
| `dist/masonry.pkgd.min.js` | brotli | 7,040 | **6,851** | **−2.69 %** |
| Visual regression tests | passing | 4 / 4 | **4 / 4** | unchanged |

### Vs upstream-frozen v4.2.2

| Metric | v4.2.2 | v5.0.0-dev.4 | Δ |
|---|---:|---:|---:|
| `dist/masonry.pkgd.min.js` raw | 24,103 | **23,296** | **−807 B** |
| `dist/masonry.pkgd.min.js` gzip | 7,367 | 7,616 | +249 B |
| `dist/masonry.pkgd.min.js` brotli | 6,601 | 6,851 | +250 B |

**52 % of the post-002 esbuild gzip regression is now recovered.** Was +524 B over upstream after #002, +421 B after #003, now +249 B after #004. Two more deletions of similar size and we'll be at parity or below.

### SSR claim — disproven by the new `ssr-smoke.mjs` test

The original roadmap predicted this improvement would close upstream issues `#1194` and `#1121` (SSR `window` undefined) by removing the `var docElemStyle = document.documentElement.style;` line at the top of `outlayer/item.js`. **That prediction is wrong** — verified by the new `test/visual/ssr-smoke.mjs` script:

- Pre-004 bundle: crashes at line 22 with `window is not defined`.
- Post-004 bundle: crashes at line 22 with `window is not defined`. **Same line, same error.**

The crash isn't inside the `outlayer/item.js` factory body (which is what #004 deleted) — it's at the UMD wrapper's IIFE call site `(function(g,l){...})(window,...)`, which dereferences `window` as a free variable before the factory body even runs. This is one stack frame *earlier* than where the prediction assumed the crash would happen.

SSR fix is now planned as a separate improvement (**§ L.2b**) that wraps every UMD invocation site with `typeof window !== 'undefined' ? window : {}`. The `ssr-smoke.mjs` script will be the gate for that improvement.

### Predicted vs actual

All five **size** predictions matched within their stated bands. The **SSR** prediction was disproven by direct test — documented in full in the improvement file.

### Migration notes

- **None for browser consumers.** Behavior is unchanged in any supported browser.
- **CDN consumers**: `dist/masonry.pkgd.min.js` byte content has changed; regenerate SRI hashes if you pin them.
- **SSR consumers**: still broken. The fix is roadmap § L.2b, scheduled next.

---

## v5.0.0-dev.3 — 2026-04-08 — Delete matchesSelector polyfill (§ L.1)

> Tag: `v5.0.0-dev.3` · Improvement: [`003-delete-matches-selector-polyfill.md`](./improvements/003-delete-matches-selector-polyfill.md) · Closes upstream: _none directly_

First "delete dead browser-compat code" step. The bundled `desandro-matches-selector` polyfill walked `webkitMatchesSelector` / `mozMatchesSelector` / `msMatchesSelector` / `oMatchesSelector` looking for a usable method on `Element.prototype`. `Element.matches` has been unprefixed in every browser since 2014 and is universally available at the fork's target baseline (Chrome 84 / Firefox 86 / Safari 15 / Edge 84) — the polyfill is dead code.

Replaced via a build-time esbuild plugin that intercepts `require('desandro-matches-selector')` and substitutes the one-liner: `function(elem, selector) { return elem.matches(selector); }`. No source change in `masonry.js`; the dep tree on disk is unchanged; only the bundled output is smaller.

### Removed

- **`desandro-matches-selector` polyfill from the bundled output** (~50 LOC of vendor-prefix walking).

### Numbers

| File | Metric | pre-003 | v5.0.0-dev.3 | Δ |
|---|---|---:|---:|---:|
| `dist/masonry.pkgd.js` | raw | 56,540 | **55,543** | **−1.76 %** |
| `dist/masonry.pkgd.js` | gzip | 10,646 | **10,521** | **−1.17 %** |
| `dist/masonry.pkgd.js` | brotli | 9,435 | **9,317** | **−1.25 %** |
| `dist/masonry.pkgd.min.js` | raw | 24,303 | **23,902** | **−1.65 %** |
| `dist/masonry.pkgd.min.js` | gzip | 7,890 | **7,788** | **−1.29 %** |
| `dist/masonry.pkgd.min.js` | brotli | 7,136 | **7,040** | **−1.34 %** |
| Visual regression tests | passing | 4 / 4 | **4 / 4** | unchanged |

### vs upstream-frozen v4.2.2 baseline

| Metric | v4.2.2 | v5.0.0-dev.3 | Δ |
|---|---:|---:|---:|
| `dist/masonry.pkgd.min.js` raw | 24,103 | **23,902** | **−201 B** |
| `dist/masonry.pkgd.min.js` gzip | 7,367 | 7,788 | +421 B (post-002 esbuild cost, recovering) |
| `dist/masonry.pkgd.min.js` brotli | 6,601 | 7,040 | +439 B (recovering) |

**First version of the fork where `dist/masonry.pkgd.min.js` raw bytes are below upstream.** Roughly 20 % of the post-002 gzip regression is now recovered. Improvements 004–006 (delete vendor-prefix detection, delete getSize box-sizing setup, inline fizzy-ui-utils) should close the rest of the gap.

**Predicted vs actual:** all six predictions landed inside their stated bands. First improvement to land strictly inside the predicted bands on every numeric column — a sign the calibration from #001 + #002 is working.

### Migration notes

- **None.** Behavior is unchanged. Browsers older than the target baseline (chrome 84 / firefox 86 / safari 15 / edge 84) would now fall through to a `TypeError` if they tried to load the bundle, but those browsers were already unsupported per `FORK_ROADMAP.md` § Browser support cuts.

---

## v5.0.0-dev.2 — 2026-04-08 — Working build pipeline (esbuild)

> Tag: `v5.0.0-dev.2` · Improvement: [`002-esbuild-build.md`](./improvements/002-esbuild-build.md) · Closes upstream: _none directly; unblocks every later size improvement_

Replace the upstream Gulp 3 + RequireJS + UglifyJS pipeline (broken on Node ≥ 17 since ~2020) with a single esbuild script. The build artifacts (`dist/masonry.pkgd.js` + `dist/masonry.pkgd.min.js`) are now regeneratable from source on every commit, which is the prerequisite for every later size-targeting improvement.

### Added

- **`scripts/build.mjs`** — ~120-line esbuild bundler. Produces both unminified and minified output in **17 ms total**. Run via `npm run build`.
- **`npm run build`** script added to `package.json`.
- **Inline jquery stub plugin** inside `scripts/build.mjs` — neutralizes `jquery-bridget`'s hard runtime dependency on jQuery so the bundle doesn't accidentally inline 85 KB of jQuery. Mirrors the upstream `paths: { jquery: 'empty:' }` trick from RequireJS.

### Changed

- **`dist/masonry.pkgd.js`** is now generated by esbuild instead of being the upstream-frozen v4.2.2 byte. **Behavior is verified identical** by the visual regression suite (4/4 passing).
- **`playwright.config.js` → `playwright.config.mjs`** — `.mjs` extension makes it ESM regardless of package type.
- **`"type": "module"` removed from `package.json`** — it was incompatible with esbuild's UMD analysis of `masonry.js` and the dependency tree. The build/test scripts that need ESM use `.mjs` extensions.

### Numbers (vs the upstream-frozen v4.2.2 dist)

| File | Metric | v4.2.2 | v5.0.0-dev.2 | Δ |
|---|---|---:|---:|---:|
| `dist/masonry.pkgd.js` | raw | 63,316 | 56,540 | **−10.7 %** |
| `dist/masonry.pkgd.js` | gzip | 15,752 | 10,647 | **−32.4 %** |
| `dist/masonry.pkgd.js` | brotli | 13,742 | 9,435 | **−31.3 %** |
| `dist/masonry.pkgd.min.js` | raw | 24,103 | 24,303 | **+0.83 %** |
| `dist/masonry.pkgd.min.js` | gzip | 7,367 | 7,891 | **+7.1 %** |
| `dist/masonry.pkgd.min.js` | brotli | 6,601 | 7,140 | **+8.2 %** |
| Build time | wall-clock | broken on Node ≥ 17 | **17 ms** | ~500× faster vs original |
| Visual regression tests | passing | 4 / 4 | **4 / 4** | unchanged |

**Predicted vs actual:** five of six predictions matched (build time ✅, source unchanged ✅, visual tests ✅, devDeps growth ✅, unminified shrink ✅ — the last one was a surprise upside). The miss: predicted a roughly neutral minified bundle, actual is **+524 B gzipped** (+7.1 %) due to esbuild's CommonJS runtime helper that UglifyJS didn't need. The cost is structural to esbuild's CJS handling and is recoverable as the next improvements delete dead code from the source — see `FORK_ROADMAP.md` § L.1–L.4.

### Migration notes

- **CDN consumers may see slightly different bytes.** `dist/masonry.pkgd.min.js` is now esbuild-generated rather than upstream-frozen. Behavior is verified identical, but the bytes don't match. If you pin a SRI hash, regenerate it.
- **`npm run build`** is the new way to regenerate `dist/`. The old `gulp` command no longer exists.

---

## v5.0.0-dev.1 — 2026-04-08 — Foundation cleanup

> Tag: `v5.0.0-dev.1` · Improvement: [`001-foundation-cleanup.md`](./improvements/001-foundation-cleanup.md) · Closes upstream: _none directly, but unblocks every later improvement_

The first landed change in the fork. **Library bytes are unchanged** — `dist/masonry.pkgd.min.js` is byte-identical to upstream v4.2.2 (24,103 B / 7,367 B gz / 6,601 B br). What changed is everything around it: the build pipeline, the dev dependencies, the test runner, and the package metadata.

### Removed

- **`bower.json`** — Bower has been deprecated since 2017.
- **`composer.json`** — Composer is a PHP package manager and never made sense for a JavaScript layout library.
- **`gulpfile.js`** — Gulp 3 won't run on Node ≥ 16; the build references `bower_components/` which never existed in this checkout.
- **`.jshintrc`, `test/.jshintrc`** — JSHint dev dependency removed.
- **`test/index.html`** — QUnit-in-browser harness; depends on `bower_components/` and the `qunitjs` dev dependency.
- **11 dev dependencies**: `chalk`, `gulp`, `gulp-jshint`, `gulp-json-lint`, `gulp-rename`, `gulp-replace`, `gulp-requirejs-optimize`, `gulp-uglify`, `gulp-util`, `jquery`, `jquery-bridget`, `jshint`, `minimist`, `qunitjs`. The whole tree had multiple unmaintained packages with open security advisories.

### Added

- **`test/visual/`** — self-contained Playwright-based visual regression suite. Position assertions + screenshot diffs against checked-in baselines. Loads only `dist/masonry.pkgd.min.js`, no Bower required. Run via `npm test`.
- **`scripts/measure.sh`** — hermetic size/LOC/dep metrics. Run via `npm run measure`.
- **`metrics/history.tsv`** — append-only measurement log so every change's delta is auditable.
- **`improvements/`** — one file per landed change. Standard template; full hypothesis → method → before → after → verdict.

### Changed

- **Package renamed `masonry-layout` → `masonry-pretext`** to avoid npm conflict with upstream.
- **Version bumped `4.2.2` → `5.0.0-dev.1`** to signal this is pre-release fork work, not a drop-in upstream replacement.
- **`type: "module"`** added to `package.json`. The visual test runner is ESM.
- **`scripts.test`**: was `test/index.html` (a no-op string pointing at the QUnit page), now `node test/visual/run.mjs`.
- **`repository`, `bugs`, `homepage`** repointed at `oriolj/masonry-pretext`.

### Foundation (per-improvement, no library effect)

- Established measurement methodology and baseline. See [`improvements/000-baseline.md`](./improvements/000-baseline.md).
- Documented fork direction in `README.md`, `CLAUDE.md`, `FORK_ROADMAP.md`.
- Added per-improvement record format ([`improvements/TEMPLATE.md`](./improvements/TEMPLATE.md)).

### Numbers

| Metric | v4.2.2 baseline | v5.0.0-dev.1 | Δ |
|---|---:|---:|---:|
| `npm install` package count | **349** | **10** | **−97.1%** |
| `devDependencies` listed | 14 | 3 | −78.6% |
| Runtime `dependencies` | 2 | 2 | 0 |
| `dist/masonry.pkgd.min.js` raw | 24,103 B | 24,103 B | 0 |
| `dist/masonry.pkgd.min.js` gzip | 7,367 B | 7,367 B | 0 |
| `dist/masonry.pkgd.min.js` brotli | 6,601 B | 6,601 B | 0 |
| Visual regression tests | 0 | 4 (passing) | +4 |

**Predicted vs actual:** all six predictions in the hypothesis section of `improvements/001-foundation-cleanup.md` matched within rounding. Predicted ~10 npm packages → actual 10. Predicted devDeps 14 → 3 → matched. Predicted dist bytes unchanged → matched. The change loop worked end-to-end.

### Migration notes

- **Not a drop-in upgrade.** If you currently `npm install masonry-layout@4.2.2`, do not blindly switch to `masonry-pretext@5.0.0-dev.1` — it's a pre-release. Wait for v5.0.0.
- **CDN consumers are unaffected.** `dist/masonry.pkgd.min.js` is byte-identical to upstream.
- **If you forked the build pipeline,** your fork is still based on the broken Gulp 3 toolchain. The replacement esbuild build is roadmap § 2.1 (improvement 002).

---

## Unreleased changes

### Added

_(none yet)_

### Changed

_(none yet)_

### Removed

_(none yet)_

### Fixed

_(none yet)_

### Performance

_(none yet — perf changes require benchmark numbers per `FORK_ROADMAP.md` § Methodology)_

---

## How to read entries below this line (template)

Once real changes start landing, each entry in this file follows this shape:

```
### Removed
- **Deleted `desandro-matches-selector` polyfill.** `Element.matches` is unprefixed since 2014 — the polyfill was dead code in every supported browser.
  - Closes upstream `desandro/masonry#____`
  - Predicted: −600 B raw, −250 B gzipped on `dist/masonry.pkgd.min.js`
  - Actual: _filled in from improvements/NNN-*.md after the change lands_
  - Full record: [`improvements/NNN-delete-matches-polyfill.md`](./improvements/NNN-delete-matches-polyfill.md)
```

The "predicted vs actual" line is non-negotiable for any change targeting a numeric improvement. If actual ≠ predicted, both numbers stay in this file as a calibration record — that gap is how future predictions get sharper.