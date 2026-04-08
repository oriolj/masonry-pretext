# Masonry (masonry-pretext fork)

_Cascading grid layout library_

> This is a **fork of [desandro/masonry](https://github.com/desandro/masonry)** whose upstream has been effectively dormant since 2018. The original library still works and is the canonical reference — for stable, plain Masonry use that.

Masonry works by placing elements in optimal position based on available vertical space, sort of like a mason fitting stones in a wall. You’ve probably seen it in use all over the Internet.

See [masonry.desandro.com](https://masonry.desandro.com) for complete docs and demos of the original library.

## About this fork

The goals of this fork are narrow and concrete:

1. **Fix the long-standing pain points** that dominate the upstream issue tracker — image overlap when content lazy-loads, custom-font flicker on first paint, SSR (`window` undefined), modern bundler (Vite/Rollup) compatibility, percentage width + gutter math.
2. **Modernize the build and runtime** — drop IE/legacy code paths, replace bundled polyfills with native browser APIs (`ResizeObserver`, `MutationObserver`, `Element.matches`, Web Animations API, `EventTarget`, `AbortController`, `document.fonts.ready`), ship a real ESM build, and shrink the bundle from ~7.4 KB gzipped toward ~2 KB gzipped.
3. **Integrate [chenglou/pretext](https://github.com/chenglou/pretext)** so text-driven bricks can be measured arithmetically without forcing DOM reflow.

Every change in this fork has to produce a **measurable** improvement in speed, bundle size, or UX. Cosmetic refactors and abstractions without a benchmark or before/after number are explicitly out of scope. The full design notes, dependency audit, and prioritized work list live in [`FORK_ROADMAP.md`](./FORK_ROADMAP.md).

### Key improvements vs upstream

User-visible wins that have already landed in the fork. Each entry links to the per-change record in `improvements/` and the git tag where the change first shipped.

> Until v5.0.0 ships, every line below is from a `5.0.0-dev.N` pre-release tag. The runtime library (`dist/masonry.pkgd.min.js`) is **byte-identical to upstream v4.2.2** at this stage — the bundle-shrinking work begins in improvement `004`. The wins so far are about toolchain health, not runtime size.

| Tag | What you get | Number |
|---|---|---|
| `v5.0.0-dev.1` | **97% smaller `npm install`.** Dropped the broken Gulp 3 + JSHint + RequireJS + QUnit + Bower toolchain. `npm install` goes from **349 → 10 packages** (the original devDeps had multiple unmaintained packages with open security advisories that will never be patched). See [`improvements/001-foundation-cleanup.md`](./improvements/001-foundation-cleanup.md). |
| `v5.0.0-dev.2` | **The build actually runs again.** The upstream Gulp 3 build has been broken on Node ≥ 17 since ~2020. Replaced with a single ~120-line esbuild script that produces the same `dist/masonry.pkgd.js` + `dist/masonry.pkgd.min.js` artifacts in **17 ms** (vs gulp's previously-multi-second build, ~500× faster). Source unchanged, behavior verified by 4/4 visual regression tests. **Trade-off:** the minified bundle is +0.83 % raw / +7.1 % gzipped vs the upstream frozen file because of esbuild's CommonJS runtime helper — that cost is recoverable as later improvements delete dead code. Full numbers + the surprise that jquery-bridget secretly bundles all of jQuery in [`improvements/002-esbuild-build.md`](./improvements/002-esbuild-build.md). |
| `v5.0.0-dev.3` | **First slice of dead-code deletion.** Removed the `desandro-matches-selector` polyfill (a 50-LOC vendor-prefix walker for `Element.matchesSelector`) — `Element.matches` has been unprefixed in every browser since 2014 and is universally available at the fork's target baseline. `dist/masonry.pkgd.min.js` drops by **−401 B raw / −102 B gzipped / −96 B brotli**. The minified raw is now **smaller than the upstream-frozen v4.2.2 file for the first time** (−201 B raw vs upstream). Behavior unchanged, 4/4 visual tests still pass. See [`improvements/003-delete-matches-selector-polyfill.md`](./improvements/003-delete-matches-selector-polyfill.md). |
| `v5.0.0-dev.4` | **Second slice of dead-code deletion.** Removed the `transition` / `transform` vendor-prefix detection in `outlayer/item.js` (`WebkitTransition`, `WebkitTransform`, `webkitTransitionEnd`, `dashedVendorProperties`, `toDashedAll` helper, `vendorProperties` lookup table, scattered consumer sites — ~50 LOC of dead browser-compat). `dist/masonry.pkgd.min.js` drops by **−606 B raw / −172 B gzipped / −189 B brotli**. Vs upstream v4.2.2: **−807 B raw**, gzip is now within +249 B (was +524 B after the esbuild build replacement — 52 % of that regression is now recovered). Behavior unchanged, 4/4 visual tests still pass. **What this is *not*:** the original roadmap claimed this would close upstream `#1194` / `#1121` (SSR `window` undefined) as a side effect of removing the module-load `document.documentElement.style` access. A new `test/visual/ssr-smoke.mjs` test in this improvement disproves that — the actual crash is at the UMD-wrapper IIFE call site (one frame earlier), not inside the deleted block. SSR fix has been split out as a separate planned improvement. Full record + the negative-result analysis in [`improvements/004-delete-vendor-prefix-detection.md`](./improvements/004-delete-vendor-prefix-detection.md). |
| `v5.0.0-dev.5` | **SSR import works.** `import Masonry from 'masonry-pretext'` no longer crashes in Next.js / Nuxt / SvelteKit / Vite SSR build passes. Wrapped every UMD wrapper's `window` reference with `typeof window !== 'undefined' ? window : {}` (in `masonry.js` directly, plus build-time patches for `outlayer/outlayer.js`, `outlayer/item.js`, `get-size.js`, `fizzy-ui-utils.js`, `jquery-bridget.js`) and added a `typeof document` short-circuit at the top of `fizzy-ui-utils.docReady`. Verified by `test/visual/ssr-smoke.mjs` (loads the bundle in a Node `vm` context with empty globals — flips from ✗ to ✓), now part of `make test` so the SSR fix is gated against future regression. **Closes upstream `desandro/masonry#1194`, `#1121`, `#1201`** — all three have been open for 1–2 years with no upstream movement. Cost: **+13 B gzipped** on `dist/masonry.pkgd.min.js` (essentially free). Behavior in the browser is identical (4/4 visual tests still pass — the `typeof window` guard always evaluates to the real `window` in browsers). Full record in [`improvements/005-ssr-import-fix.md`](./improvements/005-ssr-import-fix.md). |
| `v5.0.0-dev.6` | **Removed jQuery entirely. Zero `jquery` / `bridget` strings remain in `dist/masonry.pkgd.{js,min.js}`** — verified by a new `make test` gate (`test/visual/no-jquery.mjs`). **MILESTONE: every minified-bundle metric is now smaller than upstream v4.2.2 for the first time** (raw **−2,129 B / −8.8 %**, gzip **−295 B / −4.0 %**, brotli **−200 B / −3.0 %**). Dropped `jquery-bridget` from devDeps (so `npm install masonry-pretext` no longer pulls jQuery into the dep tree), removed it from the bundle entry, deleted the `jqueryStubPlugin`, and **directly deleted every `if (jQuery) { … }` branch** from `outlayer/outlayer.js` and `fizzy-ui-utils/utils.js` via build-time exact-string transforms (an initial DCE-via-`const jQuery = false` attempt didn't work — esbuild's minifier doesn't constant-propagate across function-property closures). **Breaking change for jQuery shim users.** `$('.grid').masonry()` and `.masonry('reloadItems')` syntax no longer works — migrate to `new Masonry('.grid', { … })` and instance method calls (the documented vanilla API). All three gates (visual + SSR + no-jquery) green. Full record in [`improvements/006-remove-jquery.md`](./improvements/006-remove-jquery.md). |
| `v5.0.0-dev.7` | **Deleted `get-size` box-sizing detection.** A 40-LOC `setup()` function in the bundled `get-size` dependency created a probe div, measured it via `getComputedStyle`, and removed it on the first `getSize()` call — solely to detect an IE11 / Firefox <29 quirk where `style.width` returned the inner width on border-box elements. At the fork's browser baseline (chrome 84 / firefox 86 / safari 15 / edge 84), modern browsers always return the outer width, so the detection is dead code. Deleted via three build-time transforms that strip the setup function, the call site inside `getSize()`, and inline the now-redundant `isBorderBoxSizeOuter` variable. **Side benefit:** eliminates one forced reflow round-trip on the first `getSize()` call. `dist/masonry.pkgd.min.js` drops by **−378 B raw / −148 B gzipped / −156 B brotli**. **Vs upstream v4.2.2: now over 10 % smaller raw, 6 % smaller gzipped, 5.4 % smaller brotli.** All three gates still green. Full record in [`improvements/007-delete-getsize-boxsizing-setup.md`](./improvements/007-delete-getsize-boxsizing-setup.md). |
| `v5.0.0-dev.8` | **Deleted unused `fizzy-ui-utils` methods.** An audit of every `utils.X` call site in `masonry.js` and `outlayer/{outlayer,item}.js` revealed two methods that are never called from the masonry consumption path: `utils.modulo` and `utils.getParent`. esbuild can't tree-shake them (they're properties on a `utils` object so the whole object stays reachable), so they were deleted explicitly via two build-time transforms. `dist/masonry.pkgd.min.js` drops by **−138 B raw / −53 B gzipped / −43 B brotli**. Vs upstream v4.2.2: now **−10.97 % raw / −6.73 % gzipped / −6.04 % brotli**. The smallest L.* deletion so far — pure deletions are approaching diminishing returns; the next big size wins will come from architectural changes (event target replacement, ResizeObserver, etc.). All three gates green. Full record in [`improvements/008-delete-unused-fizzy-utils.md`](./improvements/008-delete-unused-fizzy-utils.md). |
| `v5.0.0-dev.9` | **The headline fork feature: pretext integration.** Added a `pretextify(element)` option callback to Masonry. If set and returns `{outerWidth, outerHeight}`, the size is used as-is and `item.getSize()` (which forces a DOM reflow) is **skipped entirely**. Designed to plug into [`@chenglou/pretext`](https://www.npmjs.com/package/@chenglou/pretext) for arithmetic text measurement, but library-agnostic — works with any DOM-free measurement strategy or pre-computed sizes. **Measured speedup:** ~**1.2-1.3× faster initial layout (17-24% reduction)** across grids of 100-2000 items, verified by a new `test/visual/bench-pretext.mjs` benchmark. The bench is checked in as a permanent tool — `node test/visual/bench-pretext.mjs` reproduces the numbers. **Cost: +22 B gzipped** on `dist/masonry.pkgd.min.js`. Discriminating visual fixture (`test/visual/pages/pretext.html`) proves the callback is really bypassing DOM measurement. All five visual fixtures + SSR + no-jquery gates green. Full record in [`improvements/009-pretext-integration.md`](./improvements/009-pretext-integration.md). |
| `v5.0.0-dev.10` | **Custom font flicker fix — closes upstream `desandro/masonry#1182`.** When a web font hasn't finished loading at construction time, masonry measures items at the fallback font's height and the layout overlaps until something triggers a relayout. Added a `_create` override that schedules a deferred `layout()` when `document.fonts.ready` resolves. Guarded by `typeof document` (SSR-safe), `document.fonts.status !== 'loaded'` (no-op when fonts are already loaded), and an alive-check (no-op if the instance was destroyed before fonts loaded). **Cost: +63 B gzipped** on `dist/masonry.pkgd.min.js` for an issue that's been open in upstream since 2022 with no fix. Discriminating visual fixture (`test/visual/pages/fonts-ready.html`) mocks `document.fonts.ready` and asserts the deferred layout fires (item 3 lands at the post-font-load position, not the pre-font-load position). All six visual fixtures + SSR + no-jquery gates green. Full record in [`improvements/010-document-fonts-ready.md`](./improvements/010-document-fonts-ready.md). |
| `v5.0.0-dev.11` | **Foundation fixes (Tier 0): README + packaging + CI + portable harness.** Closes the four foundation gaps surfaced by the post-#010 multi-review. README's `Install` / `Initialize` sections were stale (told users to `npm install masonry-layout`, use Bower, and call `$('.grid').masonry({...})` — none of which work) — now rewritten to match what masonry-pretext actually is, with a `From source` install path, the vanilla API examples, and a real `pretextify` usage example. `package.json` gained `exports`, `module`, `types`, and `sideEffects: false` fields so modern bundlers (Vite/Rollup/esbuild/webpack 5) can find the right entry per consumer style; `main` now points at `dist/masonry.pkgd.min.js` instead of the source UMD wrapper. New hand-written `masonry.d.ts` (~210 lines) gives TypeScript users autocomplete on the public surface — including the `pretextify` callback typed correctly. New `.github/workflows/test.yml` runs `make ci` on push + PR, with cached chromium and the `make measure` size report on every run. Hardened `_harness.mjs` chromium launch with `--no-sandbox` / `--disable-dev-shm-usage` / `--disable-gpu` so the test gate runs in any container/CI environment. **Zero source code change. Zero bundle byte change.** Pure adoption-ergonomics + automation. Full record in [`improvements/011-tier0-foundation.md`](./improvements/011-tier0-foundation.md). |
| `v5.0.0-dev.12` | **Per-item ResizeObserver — closes 8+ duplicate upstream issues in one shot.** When a masonry item contains a lazy-loading `<img>`, masonry measures the item at its empty fallback size, packs it, then the image loads and the item grows — but masonry doesn't know to relayout. The result is the dominant complaint category in the upstream tracker (`desandro/masonry#1147` "Overlapping Images - Bootstrap User" plus 7 duplicates: `#1185`, `#1158`, `#1152`, `#1108`, `#1165`, `#1189`, `#1199`). All have been open for 2-4 years with no upstream fix. **Fix:** a per-instance `ResizeObserver` observing every item element, with `requestAnimationFrame` coalescing so multiple resize events in the same frame collapse to one `layout()` call. SSR-safe. Cleaned up automatically on `destroy()`. Items added via `appended()`/`prepended()` are auto-observed via an `_itemize` override; removed items are auto-unobserved via a `remove` override (no memory leak). **Cost: +365 B gzipped** on `dist/masonry.pkgd.min.js` for 8+ closed upstream issues. Discriminating visual fixture (`test/visual/pages/resize-observer.html`) programmatically resizes item 0 from 30→60 after construction and asserts the relayout fires (item 3 lands at `(60, 30)`, the post-resize position, not `(0, 30)`). All seven visual fixtures + SSR + no-jquery gates green. The first attempt's "skip first observer event" logic was a bug that the discriminating fixture caught immediately — see [`improvements/012-per-item-resize-observer.md`](./improvements/012-per-item-resize-observer.md) for the calibration lesson. |
| `v5.0.0-dev.13` | **`import` and `require` actually work now.** Every dev tag through `v5.0.0-dev.12` shipped a `package.json` `exports` field that pointed `import`, `require`, and `default` at `dist/masonry.pkgd.min.js` — which is `format: 'iife'`, a bare `var Masonry = (() => { … })()` with **no module exports of any kind**. `await import('masonry-pretext')` from any modern bundler (Vite, Rollup, esbuild, webpack 5, Astro, Next.js, Nuxt, SvelteKit) resolved to `default = undefined`, and consumers got `TypeError: Masonry is not a constructor`. The IIFE bundle worked for `<script src="…">` browser drop-in but broke every other path. **Fix:** added `dist/masonry.cjs` (CommonJS, ~9.5 KB gz) and `dist/masonry.mjs` (ES module, ~10 KB gz) — built in parallel by the same esbuild script — and rewired `package.json` `main` / `module` / `exports` to point at them. The IIFE bundles are unchanged byte-for-byte; existing `<script>` tag consumers see no diff, modern-bundler consumers see a working install. New `test/visual/module-smoke.mjs` gate loads both new bundles via Node `require()` and dynamic `import()` and asserts they expose a constructor — runs as part of `make test`, so this regression class is now impossible. The Tier 0 packaging fix in #011 was source-change-free and acknowledged the real ESM build was still pending; #013 is that build, closing roadmap § 2.2. Verified end-to-end against a real Astro/Vite downstream (`enacast-astro`). All seven visual fixtures + SSR + module-smoke + no-jquery gates green. Full record in [`improvements/013-esm-cjs-builds.md`](./improvements/013-esm-cjs-builds.md). |
| `v5.0.0-dev.15` | **`static: true` SSR preset — one flag to opt out of all dynamic-content machinery.** For server-rendered grids whose items will not change size after first paint (Next.js, Astro, SvelteKit, Nuxt SSR pages — the common SSR case), this single option flips three runtime behaviors in one shot: forces `transitionDuration: 0` (no animated settle on any relayout, including window-resize relayouts), skips the `document.fonts.ready` deferred layout from [#010](./improvements/010-document-fonts-ready.md), and skips the entire per-item `ResizeObserver` construction from [#012](./improvements/012-per-item-resize-observer.md) — including the per-item `getBoundingClientRect()` pre-seed loop. **What this buys SSR users:** no hydration flash, no 0.4s animated reposition on window resize, and on a 100-item grid, ~100 fewer reflows on construction. The `_itemize`, `remove`, and `destroy` hooks all already check `this._resizeObserver` before touching it, so they no-op correctly in static mode — no additional changes needed. **Cost: +20 B gzipped** on `dist/masonry.pkgd.min.js` (+101 B raw / +21 B brotli). Discriminating visual fixture (`test/visual/pages/static-mode.html`) is the **exact inverse** of the `resize-observer.html` fixture — same shape, programmatically resizes item 0 from 30→60 after construction, but expects item 3 to stay at `(0, 30)` because the observer is never constructed. All 9 visual fixtures + SSR + module-smoke + no-jquery gates green. See the new [`examples/nextjs/`](./examples/nextjs) and [`examples/astro/`](./examples/astro) for runnable copies. Full record in [`improvements/015-static-ssr-preset.md`](./improvements/015-static-ssr-preset.md). |
| `v5.0.0-dev.14` | **Percentage column width + gutter math fix — closes upstream `desandro/masonry#1006` (53 reactions, the highest-reaction open issue in the upstream tracker, more than the next 5 combined).** Open since 2018 with no upstream movement. When the user gives masonry a percentage column width — either as a literal `columnWidth: '20%'` option (now first-class supported), an inline `style="width: 20%"` on the sizer element, or a stylesheet rule like `.grid-sizer { width: 20% }` — masonry's gutter-overshoot math drops a column. Concrete example: in a 1000px container with a 20% sizer and a 10px gutter, `floor((1000+10) / (200+10)) = 4` columns instead of the obvious 5, leaving 170px of unused space on the right. **Fix:** detect that columnWidth originated from a percentage (three layers — literal option, inline style, walked stylesheet rules), then snap `cols = round(100/percent)` and recompute `columnWidth = (containerWidth + gutter) / cols` so the gutters fit inside the container. The stylesheet walker recurses into `@media` / `@supports` rules **only** when their condition currently matches, and silently skips cross-origin sheets that throw on `.cssRules` access. Discriminating visual fixture (`test/visual/pages/percent-cols.html`): container 240px, gutter 20px, sizer 20% — without the fix masonry computes 3 columns and items 3+4 wrap to row 2; with the fix it computes 5 columns and all 5 items pack into row 1. **Cost: +391 B gzipped** on `dist/masonry.pkgd.min.js` for 53 reactions × 8 years × zero upstream fix. All 8 visual fixtures + SSR + module-smoke + no-jquery gates green. Full record in [`improvements/014-percent-column-width-fix.md`](./improvements/014-percent-column-width-fix.md). |

### Maintenance & contributions

- **The fork is primarily developed by Claude** (Anthropic's AI coding assistant) under the direction of the maintainer.
- **The maintainer is a working developer, not a Masonry expert.** They don't know the original library's internals deeply, don't have time to learn its history in detail, and rely on Claude to do the heavy reading and reasoning.
- **Contributions are very welcome** — especially from people who know the original codebase, who have hit one of the upstream issues this fork targets, or who can write tests / benchmarks. Open an issue or PR; expect a friendly but slow review cadence. The roadmap document is the best place to see what's planned and where help is most useful.
- If you need a guaranteed long-term-maintained, human-reviewed Masonry, the original [desandro/masonry](https://github.com/desandro/masonry) (or a Metafizzy commercial library) is still the right choice.

## Install

> **`masonry-pretext` is in pre-release** (v5.0.0-dev tags). It is not yet published to npm. The instructions below cover the working install paths until v5.0.0 ships. If you need a stable npm-installable masonry today, use the original [`masonry-layout`](https://www.npmjs.com/package/masonry-layout) instead.

### From source (recommended during pre-release)

```sh
git clone https://github.com/oriolj/masonry-pretext.git
cd masonry-pretext
make install   # npm install + downloads chromium for the visual test suite
make build     # produces dist/masonry.pkgd.{js,min.js} via esbuild (~14 ms)
```

The packaged file lands at `dist/masonry.pkgd.min.js`. Drop it into your page via a `<script>` tag, copy it into your bundler's vendor folder, or `import` from a relative path.

### Pinning a specific dev tag

Each improvement is released as a `v5.0.0-dev.N` git tag — see the [tag list](https://github.com/oriolj/masonry-pretext/tags). You can pin to one via npm's git URL syntax:

```sh
npm install github:oriolj/masonry-pretext#v5.0.0-dev.10
```

Note: `npm install` from a git URL clones the repo but does **not** run the build. After install, run `make build` (or `npm run build`) inside `node_modules/masonry-pretext/` to produce `dist/`. The published-to-npm release (v5.0.0 final) will ship pre-built `dist/` files.

### Browser support

Chrome 84+ / Firefox 86+ / Safari 15+ / Edge 84+. The fork drops IE / Edge Legacy / Safari ≤14 support — see [`FORK_ROADMAP.md`](./FORK_ROADMAP.md) § Browser support cuts.

## Initialize

`masonry-pretext` only supports the **vanilla JS API**. The jQuery shim from upstream was removed in [improvement #006](./improvements/006-remove-jquery.md). Migration is mechanical:

```js
// before (upstream / pre-#006)
$('.grid').masonry({ columnWidth: 200 });
$('.grid').masonry('reloadItems');
$('.grid').masonry('layout');

// after (masonry-pretext)
const msnry = new Masonry('.grid', { columnWidth: 200 });
msnry.reloadItems();
msnry.layout();
```

### With a selector string

```js
const msnry = new Masonry('.grid', {
  itemSelector: '.grid-item',
  columnWidth: 200,
});
```

### With an Element

```js
const grid = document.querySelector('.grid');
const msnry = new Masonry(grid, {
  itemSelector: '.grid-item',
  columnWidth: 200,
});
```

### With a `data-masonry` attribute (auto-init)

The HTML auto-init path inherited from upstream still works in pre-release. Note that it is currently slated for removal in the v5.0.0 line — see [`FORK_ROADMAP.md`](./FORK_ROADMAP.md) item E (closes upstream `desandro/masonry#1104`).

```html
<div class="grid" data-masonry='{ "itemSelector": ".grid-item", "columnWidth": 200 }'>
  <div class="grid-item"></div>
  <div class="grid-item"></div>
</div>
```

### With pretext (the headline fork feature)

Pass a `pretextify(element)` callback to skip per-item DOM measurement. Designed to plug into [`@chenglou/pretext`](https://www.npmjs.com/package/@chenglou/pretext) for arithmetic text measurement against cached font metrics — but the callback is library-agnostic and works with any pre-computed sizes:

```js
import { prepare, layout } from '@chenglou/pretext';

const cache = new WeakMap();
const FONT = '16px/1.5 Inter, sans-serif';
const COL_WIDTH = 280;
const LINE_HEIGHT = 24;

new Masonry('.grid', {
  columnWidth: COL_WIDTH,
  pretextify(elem) {
    let prepared = cache.get(elem);
    if (!prepared) {
      prepared = prepare(elem.dataset.text || elem.textContent, FONT);
      cache.set(elem, prepared);
    }
    const { height } = layout(prepared, COL_WIDTH, LINE_HEIGHT);
    return { outerWidth: COL_WIDTH, outerHeight: height };
  },
});
```

Measured speedup vs DOM measurement: **~1.2-1.3× faster initial layout (17-24% reduction)** across grids of 100-2000 items. The callback's lookup must be **O(1)** (a `WeakMap` keyed on element, or a cached `prepare()` result) — an O(N) per-call lookup will erase the savings. See [`improvements/009-pretext-integration.md`](./improvements/009-pretext-integration.md) for the full record + the calibration lesson that surfaced this.

## Server-side rendering (SSR) and hydration

`masonry-pretext` is **safe to import from server code** — Next.js (App Router and Pages Router), Nuxt, SvelteKit, Astro, Remix, Vite SSR, any build that evaluates the module graph in Node. `import Masonry from 'masonry-pretext'` (and `require('masonry-pretext')`) no longer crashes with `ReferenceError: window is not defined` or `document is not defined`.

This closes long-standing upstream issues [`desandro/masonry#1194`](https://github.com/desandro/masonry/issues/1194), [`#1121`](https://github.com/desandro/masonry/issues/1121), and [`#1201`](https://github.com/desandro/masonry/issues/1201). How it works: every UMD call site inside the bundle (`masonry`, `outlayer`, `outlayer/item`, `get-size`, `fizzy-ui-utils`, `jquery-bridget`, plus `fizzy-ui-utils.docReady`) is wrapped in a `typeof window !== 'undefined'` / `typeof document !== 'undefined'` guard. In a browser the guards evaluate to the real globals; in Node they short-circuit to empty objects, and the `typeof ResizeObserver` / `document.fonts` checks in `_create` no-op. The bundle loads cleanly in a DOM-less `vm` context — verified on every build by `test/visual/ssr-smoke.mjs`, which runs as part of `npm test`. See [`improvements/005-ssr-import-fix.md`](./improvements/005-ssr-import-fix.md) for the full record.

### What SSR-safe means (and what it does not)

- ✅ **Import is safe.** You can put `import Masonry from 'masonry-pretext'` in the top of a server component, layout, or route file — it will not crash the server render, even if you never construct an instance there.
- ✅ **Constructing inside a `typeof window !== 'undefined'` guard is safe.** All the DOM-touching work in `_create` is gated behind `typeof` checks.
- ❌ **The library does not lay out on the server.** Masonry needs real DOM elements with real measured sizes. The server renders the grid markup in flow layout; a tiny client-side effect constructs `new Masonry(...)` after hydration, at which point the items get absolutely positioned.
- ❌ **Do not construct a Masonry instance at module scope in a server file.** That would run in Node and hit DOM APIs. Always defer construction to a `useEffect` / `onMount` / `client:load` boundary.

### Recommended pattern

```jsx
// React (Next.js, Remix, etc.)
'use client';
import { useEffect, useRef } from 'react';
import Masonry from 'masonry-pretext';

export default function Grid({ items }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    const msnry = new Masonry(ref.current, {
      itemSelector: '.grid-item',
      columnWidth: 200,
      gutter: 10,
      transitionDuration: 0, // see "Optimizations for SSR mode" below
    });
    return () => msnry.destroy();
  }, [items]);

  return (
    <div ref={ref} className="grid">
      {items.map((item) => (
        <div key={item.id} className="grid-item">{item.content}</div>
      ))}
    </div>
  );
}
```

The grid markup is **server-rendered in flow layout** (no `position: absolute` on items, no computed heights). On hydration Masonry constructs, measures, and reflows into a cascading grid. Users see one layout pass from flow → absolute.

Full runnable examples:

- **Next.js (App Router + `'use client'`):** [`examples/nextjs/`](./examples/nextjs)
- **Astro (server component + `client:load` island):** [`examples/astro/`](./examples/astro)

### Hydration flash and how to reduce it

Before the client JS boots, the user sees the grid rendered by the server — in normal flow layout, because Masonry has not run yet. When hydration completes and `new Masonry(...)` runs, the items suddenly reflow into the absolute-positioned cascade. On a fast page this is invisible; on a slow page it is a visible layout shift (CLS).

Two practical mitigations today:

1. **Reserve vertical space with CSS.** Give the grid container a `min-height` (or the items a fixed `aspect-ratio`). Flow layout will match the final height closely enough that the reflow is not a vertical jump, only a horizontal rearrangement.
2. **Disable the enter animation.** Pass `transitionDuration: 0` so the flow → absolute transition is instantaneous, not a 0.4s animated settle. This is the single highest-impact option for SSR content — see below.

### Optimizations for SSR mode — `static: true`

Masonry's default options assume a client-rendered SPA where items fade in, animate on resize, and may grow as lazy images load. When your content is **server-rendered and static after first paint**, most of that machinery is wasted work.

**One flag flips all of it off:**

```js
new Masonry(ref.current, {
  columnWidth: 200,
  gutter: 10,
  static: true, // ← SSR preset: no animations, no fonts.ready gate, no ResizeObserver
});
```

Landed in `v5.0.0-dev.15`. Setting `static: true` does three things in one flag:

| What it skips | Effect |
|---|---|
| Forces `transitionDuration: 0` | No animated settle on any relayout — including window-resize relayouts. Eliminates the visible "settle" on hydration. |
| Skips the `document.fonts.ready` deferred layout ([#010](./improvements/010-document-fonts-ready.md)) | No extra relayout after font load. Safe because static SSR content is rendered in its final font. |
| Skips the per-item `ResizeObserver` ([#012](./improvements/012-per-item-resize-observer.md)) | No observer, no `getBoundingClientRect()` pre-seed per item, no rAF callback, no auto-relayout on item size changes. Safe because items will not grow. |

Cost: **+20 B gzipped** on the bundle for users who don't opt in. Runtime *savings* for users who do: on a 100-item grid, ~100 fewer reflows on construction (the ResizeObserver pre-seed loop runs `getBoundingClientRect()` on every item — that is now skipped), no promise chain for `document.fonts.ready`, no rAF scheduling, and no transition-property CSS writes on subsequent layouts.

**Per-option granularity** — you can skip `static` and tune individual options if you want:

| Option | Default | SSR recommendation | Why |
|---|---|---|---|
| `static` | `false` | **`true`** (preferred — enables the three below) | Single flag for the whole SSR preset. Use unless you need per-option control. |
| `transitionDuration` | `'0.4s'` | `0` (implied by `static: true`) | Relayouts on resize / font load / image load are instant instead of a 0.4s animated reposition. |
| `stagger` | `0` | `0` | Already 0; call out so readers know not to set it in SSR contexts. |
| `resize` | `true` | `true` (keep) | Window-resize relayouts are still valuable on the client. Cheap to leave on. |
| `initLayout` | `true` | `true` (or `false` if you pre-positioned items server-side) | Set `false` only when you have already written `position:absolute;left:…;top:…` into each item's inline style on the server, and you want Masonry to *only* handle subsequent resizes. |

**When NOT to use `static: true`:**

- Your grid contains lazy-loading images (`<img loading="lazy">`) that will grow after first paint — you want the ResizeObserver to catch the growth and relayout.
- Your page uses custom web fonts that may still be loading when masonry constructs — you want the `document.fonts.ready` deferred layout to re-measure items at their real font height.
- You add or remove items dynamically and you want the fade-in animation on appended items.

In any of those cases, either leave `static` unset (default) or tune the individual options you need.

**Other things that are already safe / already good in SSR mode without `static: true`:**

- **First layout is already instant.** Outlayer skips transitions on the very first `layout()` call via `_isLayoutInited`. The first layout after hydration is *always* transition-free; `transitionDuration: 0` only matters for *subsequent* layouts (resize, image load, etc.).
- **Pretext (`pretextify`) works in SSR and non-SSR equally.** It is not specific to SSR but pairs naturally with it: if you have measured heights from a cached font-metrics pass, you can skip the per-item reflow on hydration entirely.
- **`document.fonts.ready` gate is a no-op when fonts are already loaded.** If your page's fonts are preloaded or inlined, the #010 deferred layout never fires even without `static: true`.
- **Per-item `ResizeObserver` is already SSR-safe.** It is only constructed if `typeof ResizeObserver !== 'undefined'`, which is false in Node. On the client it keeps working normally.

### Using pretext alongside SSR

**Short answer: you do not need to do anything different.** The `pretextify` callback runs inside `layout()`, which only runs on the client (inside your `useEffect` / `onMount` / `<script>`). The callback body never executes during server render, so it is free to assume a DOM environment.

The only caveat is on the **pretext library's own import**, not on masonry's. If `@chenglou/pretext` (or whatever measurement library you are plugging in) touches `document`, `window`, or `OffscreenCanvas` at import time, then `import { prepare, layout } from '@chenglou/pretext'` at the top of a server component file could crash — that would be a pretext-side SSR bug, not a masonry one. Two mitigations:

1. **Import pretext inside the client effect** rather than at module top. In a React `'use client'` component this is trivial — the whole file is client-only, so a top-level import is fine. In mixed server/client files, move the import inside the `useEffect` body (or use `await import(...)` lazily).
2. **Keep the `pretextify` callback closure-local to the client code.** Build your size cache (`WeakMap`, etc.) inside the effect, not in module scope, so it is never instantiated during server render.

Example inside a Next.js `'use client'` component:

```tsx
'use client';
import { useEffect, useRef } from 'react';
import Masonry from 'masonry-pretext';
import { prepare, layout } from '@chenglou/pretext';

const FONT = '16px/1.5 Inter, sans-serif';
const COL_WIDTH = 240;
const LINE_HEIGHT = 24;

export default function Grid({ items }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    const cache = new WeakMap();
    const msnry = new Masonry(ref.current, {
      columnWidth: COL_WIDTH,
      transitionDuration: 0,
      pretextify(elem) {
        let prepared = cache.get(elem);
        if (!prepared) {
          prepared = prepare(elem.textContent, FONT);
          cache.set(elem, prepared);
        }
        const { height } = layout(prepared, COL_WIDTH, LINE_HEIGHT);
        return { outerWidth: COL_WIDTH, outerHeight: height };
      },
    });
    return () => msnry.destroy();
  }, [items]);
  return <div ref={ref} className="grid">{/* ... */}</div>;
}
```

That is it. The masonry side of SSR + pretext has no special setup.

**Candidate future optimizations** (not yet landed — tracked as ideas, open an issue if you want one prioritized):

- A `Masonry.computeLayout(sizes, options)` static helper (pure packing math, no DOM) so the server can pre-compute `(x, y)` positions and emit them inline as CSS. Combined with `initLayout: false`, this gives a zero-flash SSR path where items land at their final positions on the very first paint. Depends on roadmap item P (engine/adapter split).
- Deferring ResizeObserver attachment to `requestIdleCallback` to keep it off the hydration critical path for non-static grids.

## License

Masonry is released under the [MIT license](http://desandro.mit-license.org). Have at it.

* * *

Original library by David DeSandro · `masonry-pretext` fork by Oriol Jimenez (primarily developed by Claude — see [`CLAUDE.md`](./CLAUDE.md))
