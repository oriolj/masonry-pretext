# Release notes — masonry-pretext

User-visible changes in the fork. The format roughly follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) but with two extras specific to this fork:

- An **upstream-issue** column for changes that close a known issue in `desandro/masonry`.
- A **predicted vs actual** line for any change that targeted a numeric improvement (size, perf), per the methodology in `FORK_ROADMAP.md` § Methodology.

The full per-change records — hypothesis, before/after measurements, test status, verdict — live in [`improvements/`](./improvements/). This file is the user-facing summary; `improvements/` is the engineering audit trail.

> **Heads up:** masonry-pretext is a fork. It is not a drop-in replacement for `masonry-layout` v4.2.2. Versions are pre-release until v5.0.0 ships. Check the changes below carefully if you are migrating an existing project.

---

## Unreleased — v5.0.0-dev

Work in progress toward v5.0.0. See [`FORK_ROADMAP.md`](./FORK_ROADMAP.md) for the full plan, [`PRETEXT_SSR_ROADMAP.md`](./PRETEXT_SSR_ROADMAP.md) for the SSR feature line, and [`improvements/`](./improvements/) for per-change details.

### v5.0.0-dev.42 — 2026-04-09 — `itemSizer` callback ⭐ (D.3)

> Tag: `v5.0.0-dev.42` · Improvement: [`042-item-sizer-callback.md`](./improvements/042-item-sizer-callback.md) · Closes downstream consumer ask **D.3** — the highest-leverage Tier 1 item

A new `itemSizer(element, columnWidth) → MasonrySize` constructor option lets non-text grids declare per-item heights as closed-form functions of column width. The same callback shape works in pure-Node via `Masonry.computeLayout({ itemSizer })`, so a single height formula can live in one place and apply identically server- and client-side.

**This is the structural unblocker for mixed-media SSR grids.** News cards (image aspect-ratio + title lines), podcast tiles, weather widgets, banner groups — anything whose height is computable from the column width — can now describe its sizes in one callback that runs in both Astro/Next.js frontmatter and the browser.

```ts
const itemSizer = (element, columnWidth) => {
  const moduleType = element.dataset.moduleType;
  if (moduleType === 'NewsCard') {
    const aspect = parseFloat(element.dataset.aspectRatio || '1.78');
    return { outerWidth: columnWidth, outerHeight: columnWidth / aspect + 124 };
  }
  if (moduleType === 'PodcastTile') {
    return { outerWidth: columnWidth, outerHeight: columnWidth + 56 };
  }
  return null; // fall through to pretextify / DOM measurement
};

// Server (Astro frontmatter):
const layout = Masonry.computeLayout({
  items: modules.map(m => ({ moduleType: m.type, aspectRatio: m.aspectRatio })),
  itemSizer: (item, cw) => itemSizer({ dataset: item }, cw),
  containerWidth: 1248,
  columnWidth: 280,
  gutter: 16,
});

// Client:
new Masonry(grid, { itemSizer, columnWidth: 280, gutter: 16 });
```

**Resolution order in `_getItemLayoutPosition`:**

1. `itemSizer(element, columnWidth)` ← runs first
2. `pretextify(element)` ← falls through if (1) returns null
3. `item.getSize()` ← falls through if (2) returns null

Each layer falls through if it returns `null | undefined | false`, so consumers can mix-and-match (e.g., a sizer for known module types, `pretextify` for pure-text items, DOM measurement for the long tail).

**`Masonry.computeLayout` accepts three item shapes:**

- `{ outerWidth, outerHeight }` — original pre-measured shape, unchanged
- `{ data, sizer(stride, data) }` — per-item closure (heterogeneous grids)
- generic data + top-level `itemSizer(item, stride)` — single resolver for every item

**Cost:** +80 B gzipped on `dist/masonry.pkgd.min.js`. New `item-sizer.html` discriminating fixture (4 items with `height: 1px` sentinel that the sizer must override). New compute-layout cases for both top-level and per-item closure shapes. All test gates green.

### v5.0.0-dev.41 — 2026-04-09 — Multi-breakpoint `Masonry.computeLayouts` (D.1)

> Tag: `v5.0.0-dev.41` · Improvement: [`041-multi-breakpoint-compute-layouts.md`](./improvements/041-multi-breakpoint-compute-layouts.md) · Closes downstream consumer ask **D.1**

A new static helper `Masonry.computeLayouts(opts, breakpoints)` wraps `Masonry.computeLayout` in a per-breakpoint loop and returns a `{ name → ComputeLayoutResult }` map. **The motivation is responsive SSR**: a server can't know which breakpoint a viewer is on, so it computes layouts for ALL of them up front and emits each set in the rendered HTML; the client picks the right one via `matchMedia`.

```ts
const layouts = Masonry.computeLayouts(
  { items: sizes, columnWidth: 0, containerWidth: 0 },
  [
    { name: 'mobile',  containerWidth: 360,  columnWidth: 360, gutter: 0  },
    { name: 'tablet',  containerWidth: 720,  columnWidth: 352, gutter: 16 },
    { name: 'desktop', containerWidth: 1024, columnWidth: 336, gutter: 16 },
    { name: 'wide',    containerWidth: 1280, columnWidth: 100, gutter: 16 },
  ],
);
// → { mobile: ComputeLayoutResult, tablet: ..., desktop: ..., wide: ... }
```

The helper is intentionally a thin wrapper, not a deduper — calling it with two breakpoints that resolve to the same `cols` still runs the placement loop twice. The math is fast enough (`computeLayout` runs in ~0.131 ms for a 5000-item grid per the #020 bench) that the saved complexity is worth more than the saved CPU.

**Item sizes are inherited as-is across breakpoints.** Consumers whose item heights depend on the per-breakpoint column width must recompute the items themselves before calling — that's the next improvement (D.3 / `itemSizer`).

**Cost:** +63 B gzipped on `dist/masonry.pkgd.min.js`. New `compute-layouts.mjs` Node-only test gate runs as part of `make test`, with 4 discriminating cases (agreement / cols-differ / options-propagate / gutter-override).

### v5.0.0-dev.40 — 2026-04-09 — `'layoutError'` event (D.6)

> Tag: `v5.0.0-dev.40` · Improvement: [`040-layout-error-event.md`](./improvements/040-layout-error-event.md) · Closes downstream consumer ask **D.6**

A new `'layoutError'` event surfaces silent layout failures so multi-tenant frontends can forward them to error trackers (Sentry, Datadog, Rollbar) instead of guessing why an item ended up at `(0, 0)`. The library still positions the item — the event is informational.

```js
msnry.on('layoutError', function (event) {
  // event.reason is one of: 'detached' | 'zero-width' | 'colspan-overflow'
  // event.item, event.cols, event.columnWidth are also exposed
  Sentry.captureMessage(`masonry layoutError: ${event.reason}`, {
    extra: { html: event.item.element.outerHTML, cols: event.cols },
  });
});
```

**Reasons in the initial set:**

- `'detached'` — `item.element.parentNode === null` (the element was removed from the DOM between construction and layout)
- `'zero-width'` — `item.size.outerWidth === 0` (typically a `display: none` item, or one whose CSS dimensions couldn't be measured)
- `'colspan-overflow'` — the item is wider than the entire grid, so its computed `colSpan` exceeds `cols`

**`'measurement-failed'` is intentionally not in the initial set:** `item.getSize()` already swallows missing-style failures by returning a zero-size object, which `'zero-width'` covers. Adding a try/catch around `getSize` would mask real bugs.

**Hot path stays branchless** for grids that don't subscribe — the new code only runs after the existing `this._events && this._events.layoutError` listener-array check.

**Cost:** +136 B gzipped on `dist/masonry.pkgd.min.js`. Discriminating fixture (`test/visual/pages/layout-error.html`) verified to catch the regression class by manually disabling the emit and watching the assertion fail. New `pageAssert` mechanism in the runner for non-positional discriminators.

### v5.0.0-dev.39 — 2026-04-09 — Per-instance `silent` option (D.12)

> Tag: `v5.0.0-dev.39` · Improvement: [`039-per-instance-silent.md`](./improvements/039-per-instance-silent.md) · Closes downstream consumer ask **D.12**

The one-time `console.info` banner from `v5.0.0-dev.37` was suppressible only via the global flag `Masonry.silent = true`. **You can now also pass `silent: true` to the constructor for per-instance suppression**, useful for grids where the banner would be inappropriate (server-rendered preview iframes, hidden pre-render passes, embedded widgets that shouldn't leak fork branding).

```js
new Masonry(grid, { silent: true });
```

**Precedence:** per-instance `silent` wins over `Masonry.silent` because it's the more specific signal. A silent instance does NOT consume the one-shot banner — a later non-silent instance still triggers it. Setting `silent: true` on one grid does not mutate any global state.

**Cost:** +5 B gzipped on `dist/masonry.pkgd.min.js`. Documented in `masonry.d.ts`. All test gates green.

### v5.0.0-dev.38 — 2026-04-09 — Source maps in `dist/` (D.5)

> Tag: `v5.0.0-dev.38` · Improvement: [`038-source-maps.md`](./improvements/038-source-maps.md) · Closes downstream consumer ask **D.5**

Every output bundle now ships an external `*.map` sibling with `sourcesContent` inlined. Production error trackers (Sentry, Datadog, Rollbar) can resolve minified stack traces back to `masonry.js` line numbers without additional tooling.

**Cost on the served bundle is just the `sourceMappingURL` directive comment**: +45 B raw / +34 B gzipped on `dist/masonry.pkgd.min.js`. The maps themselves are external — the browser never loads them, only debuggers and error trackers do.

**No source code change.** Single-line change to `scripts/build.mjs`'s `baseConfig` (`sourcemap: true` + `sourcesContent: true`). All seven build targets pick up the change via the existing `makeBuildConfig` factory. All test gates green.

### Downstream verification — `enacast-astro` shipped masonry-v2 against `v5.0.0-dev.36`

A real downstream consumer (`enacast-astro`, an Astro 6 + Preact frontend for a multi-tenant radio platform) shipped a zero-flash SSR rendering pipeline against `v5.0.0-dev.36` with **zero library changes required**. The implementation:

- Calls `Masonry.computeLayout` in the Astro frontmatter (server-side, pure Node) with per-module-type closed-form height formulas in `src/utils/module-heights.ts`. No `pretextify` callback needed — items are mixed-media (images + text + small embeds), not pure text.
- Emits inline absolute positions (`left`/`top`) on each module's wrapper `<div>`. Container reserves the full computed height via `min-height` so flow layout matches before any JS runs.
- Hydrates with `new Masonry(grid, { initLayout: false, static: true })` so the library adopts the server positions and skips the per-item ResizeObserver / `document.fonts.ready` hook.
- Backend (Django) gained a new `ModularPage.layout_strategy` enum field (`'grid' | 'masonry' | 'masonry-static'`) replacing the legacy `use_masonry_layout` boolean. The backend rejects unsupported module types at save time (whitelist: News, Podcast, Weather, Agenda — all module types whose rendered height is statically knowable from the API response).
- Backoffice (Next.js admin panel) filters the module-type picker on v2 pages and shows an actionable error banner when a radio tries to switch a v1 page with offending modules to v2. Defense-in-depth: backend rejects, backoffice prevents.

**Result:** end-to-end zero-flash modular pages with the expected CLS = 0.00 outcome on the canary content type. The 12 downstream consumer asks (D.1–D.12) in `FORK_ROADMAP.md` remain on the roadmap as **future improvements that would unlock progressively more pages**, but none of them are blocking. Specifically:

- **D.1 (multi-breakpoint `computeLayouts`)** — without it, the v2 path is single-breakpoint (desktop-only positions). Mobile users see desktop positions on first paint and the layout corrects on the next viewport change. Acceptable for the canary; D.1 would make the mobile path exact.
- **D.3 (`itemSizer` callback)** — without it, the consumer's height formulas live in their own `module-heights.ts` instead of being pluggable through the library. Cosmetic improvement; not blocking.
- **D.4 (per-item dynamic-content opt-out)** — without it, the V2 whitelist excludes iframe / Instagram / Twitter / YouTube modules entirely. With D.4, a v2 page could tolerate one or two embeds while keeping the rest static.

**Conclusion:** the existing `v5.0.0-dev.36` API surface (`Masonry.computeLayout` + `static: true` + `initLayout: false`) is sufficient to ship a real zero-flash SSR consumer with the documented constraints in `examples/astro/README.md`. The downstream did not need to monkey-patch, fork, or extend the library — just consume it.

See the consumer's `masonry.md` (in the `enacast-astro` repo) for the full architecture, the per-module-type height formulas, the View Transitions integration, and the mobile-fallback caveat. The `RELEASE_NOTES.md` in `enacast-astro` (under "Unreleased") and in `enacast` (the Django backend) document the full multi-repo change set.

---

## v5.0.0-dev.20 — 2026-04-08 — Hydration + server-layout benchmarks + README headline (§ SSR / PRETEXT_SSR Phase 5)

> Tag: `v5.0.0-dev.20` · Improvement: [`020-bench-and-headline.md`](./improvements/020-bench-and-headline.md) · **The load-bearing measurement step** — Phase 5 of [`PRETEXT_SSR_ROADMAP.md`](./PRETEXT_SSR_ROADMAP.md), marked ⚠️ non-negotiable in the roadmap because the entire SSR feature line is a hand-wave without measured numbers in the README.

### Headline

**Cumulative Layout Shift drops from 0.7421 to 0.0000 — measured.** No other masonry-style library on the market can do this. With the SSR pipeline (`Masonry.computeLayout` server-side + `initLayout: false + static: true` client-side), cascading-grid pages render correctly on first paint — no flow-to-absolute reflow, no animated settle, no observable hydration jank. Reproduce with `make bench`.

`Masonry.computeLayout` itself runs in **0.131 ms median for a 5000-item grid** in pure Node — 38× under the predicted 5 ms budget. Server-side layout cost is effectively free for any realistic grid.

### Added

- **`test/visual/bench-server-layout.mjs`** — pure-Node microbenchmark. Times `Masonry.computeLayout` via `process.hrtime.bigint()`, 5 untimed warmup runs + 50 measured per size, reports median + spread for N=100/500/1000/5000.
- **`test/visual/bench-hydration.mjs`** — Playwright-driven CLS bench. Generates two HTML fixtures at runtime in a temp dir (control = flow-then-relayout, pipeline = inline-positions-from-`computeLayout`), runs 30 interleaved runs in chromium, captures CLS via `PerformanceObserver({type: 'layout-shift', buffered: true})`, reports median + p10/p90 + max.
- **`make bench` target** — runs both benches in sequence. Slow (~2 minutes) so it's NOT part of `make test`. Anyone can reproduce the headline numbers locally.
- **README "🎯 The headline feature: zero-flash SSR cascading grids"** — new callout section directly under "About this fork", before the Key improvements table. Has the headline number in the first sentence, a side-by-side CLS comparison table, links to the three improvements that ship the pipeline, a reproduce-the-numbers instruction, a pointer to the Astro example, and a pointer to `PRETEXT_SSR_ROADMAP.md`.

### Numbers

| File                       |     pre-020 |    post-020 | Δ          |
| ---                        |         ---:|         ---:| ---        |
| `dist/masonry.pkgd.js`     |      58,960 |      58,960 | **0**      |
| `dist/masonry.pkgd.min.js` |      25,756 |      25,756 | **0**      |
| Hydration CLS — control    | (unmeasured) |      0.7421 | **MEASURED** |
| Hydration CLS — pipeline   | (unmeasured) |      0.0000 | **MEASURED** |
| Hydration CLS reduction    | (unmeasured) |        100% | **HEADLINE** |
| `computeLayout(5000)` median | (unmeasured) |   0.131 ms | **MEASURED — 38× under budget** |
| Visual + ssr + module + compute-layout + no-jquery gates | all green | all green | unchanged |

**Zero source change to `masonry.js` — Phase 5 is purely measurement + documentation.**

### Migration

No action needed for any existing user. This release adds benchmarks + the README headline; the library itself is byte-identical to dev.19.

---

## v5.0.0-dev.19 — 2026-04-08 — End-to-end Astro SSR pipeline example (§ SSR / PRETEXT_SSR Phase 4)

> Tag: `v5.0.0-dev.19` · Improvement: [`019-astro-ssr-pipeline-example.md`](./improvements/019-astro-ssr-pipeline-example.md) · **Closes upstream**: none — runnable demo of the Phase 1-3 machinery.

### Headline

**The runnable proof.** `examples/astro/` is now an end-to-end SSR demo that uses every piece of the SSR feature line: `Masonry.computeLayout` in the Astro frontmatter (Node), inline absolute positions in the server-rendered HTML, and `new Masonry(grid, { initLayout: false, static: true })` on the client to adopt the existing positions. Drop the file into a fresh Astro project, install `masonry-pretext`, run `npm run dev`, and verify CLS = 0.00 in DevTools yourself.

### Changed

- **`examples/astro/src/pages/index.astro`** — full rewrite (~145 lines). The previous version used the simpler `static: true` only pattern; the new version wires the full pipeline. Hardcoded item heights for reproducibility (real apps swap in `pretext.layout()`); the swap-in is documented in the example README.
- **`examples/astro/README.md`** — full rewrite (~115 lines). Restructured around the four-step pipeline: server-side measurement → `computeLayout` → emit inline positions → client-side adoption. Has a side-by-side CLS comparison table and a "When NOT to use this pattern" section documenting the four constraints.

### Unchanged (intentional)

- **Zero changes to `masonry.js`, `masonry.d.ts`, `dist/`, `test/visual/`** — the example is documentation + runnable demo, not library code.
- **Next.js example** stays at the simpler pattern (originally documented as PR-welcome; brought to parity in a followup after `dev.20`).

---

## v5.0.0-dev.18 — 2026-04-08 — `initLayout: false` SSR adoption verification (§ SSR / PRETEXT_SSR Phase 3)

> Tag: `v5.0.0-dev.18` · Improvement: [`018-init-layout-false-adoption.md`](./improvements/018-init-layout-false-adoption.md) · **The smallest improvement on record** — zero bundle bytes, locks in the entire client-side half of the SSR feature line.

### Headline

**Verifies that the SSR adoption path already works.** Phase 2 (#017) added `Masonry.computeLayout` (server-side helper). Phase 3's question: does the client adopt those positions correctly when constructing masonry? Answer (after reading the Outlayer + Item source carefully): **yes, out of the box, no source change needed**. `initLayout: false` from Outlayer skips the constructor's `layout()` call, `Item._create`'s `style.position = 'absolute'` is a no-op for items the server already pre-rendered with that, and `static: true` (#015) skips every dynamic-content hook that could later overwrite the SSR positions.

Phase 3 adds the discriminating fixture that locks this in permanently.

### Added

- **`test/visual/pages/init-layout-false.html`** — discriminating fixture. Pre-positions 4 items in a single-column stack at `(0,0), (0,30), (0,60), (0,90)` — a layout shape masonry would NEVER produce naturally for 4 60×30 items in a 3-col 180px container. If `initLayout: false` adoption works correctly, items stay in the stack. If broken, items get repositioned to the natural 3-col tile and the position assertion catches it (item 1 jumps from `0px` to `60px`). Verified by toggling `initLayout: false → true` and watching the fixture fail loudly.
- **New `init-layout-false` case in `test/visual/run.mjs`** — runs as part of `make test`.

### Numbers

| Metric | Δ |
|---|---|
| `dist/masonry.pkgd.{cjs,mjs,pkgd.js,pkgd.min.js}` | **0 bytes** (byte-identical to dev.17) |
| `masonry.js` source raw | 0 (no source change) |
| Visual regression tests | 9/9 → **10/10** (+`init-layout-false`) |
| Other gates | unchanged |

---

## v5.0.0-dev.17 — 2026-04-08 — `Masonry.computeLayout` static helper (§ SSR / PRETEXT_SSR Phase 2)

> Tag: `v5.0.0-dev.17` · Improvement: [`017-compute-layout-static-helper.md`](./improvements/017-compute-layout-static-helper.md) · **THE killer feature** — pure-Node cascading-grid layout precomputation.

### Headline

**`Masonry.computeLayout(opts)` exists.** A static method on the constructor that takes pre-measured item sizes + container/column metadata and returns absolute positions. **No DOM, no instance, no `this`** — runs in Node, edge functions, web workers, or any JavaScript runtime. The killer use case: server-side cascading-grid layout for SSR pages.

```ts
import Masonry from 'masonry-pretext';

const { positions, containerHeight } = Masonry.computeLayout({
  items: [{outerWidth: 280, outerHeight: 192}, ...],
  containerWidth: 920,
  columnWidth: 280,
  gutter: 16,
});
// → positions: [{x: 0, y: 0}, {x: 296, y: 0}, ...]  in pure Node, no DOM needed
```

**Byte-for-byte identical** to the browser-side layout. Verified by `test/visual/compute-layout.mjs`, a Node-only test that runs `Masonry.computeLayout` against all 9 visual fixtures and asserts every position matches the browser-rendered values, on the first build, with no debugging required.

### Added

- **`Masonry.computeLayout(opts)` static method** in `masonry.js` (~70 LOC of glue around the pure helpers from #016).
- **`ComputeLayoutOptions` + `ComputeLayoutResult`** TypeScript interfaces in `masonry.d.ts` with full JSDoc + a runnable example in the JSDoc.
- **`test/visual/compute-layout.mjs`** — Node-only test gate. Imports `Masonry` from `dist/masonry.mjs`, runs through all 9 fixture cases, asserts position-by-position agreement with the browser fixtures. Now part of `make test`.
- **`test:compute-layout` npm script** for running the gate standalone.

### Changed

- **`Makefile` `make test` and `make test-update`** — `compute-layout.mjs` runs between `module-smoke.mjs` and `no-jquery.mjs`.

### Numbers

| Metric | pre-017 | post-017 | Δ |
|---|---:|---:|---:|
| `dist/masonry.pkgd.min.js` raw | 24,815 | **25,756** | +941 |
| `dist/masonry.pkgd.min.js` gz | 7,898 | **8,291** | **+393** |
| `dist/masonry.pkgd.min.js` brotli | 7,172 | **7,527** | +355 |
| Visual regression tests | 9/9 | 9/9 | unchanged |
| **Compute-layout test** | (absent) | **9/9** | **NEW gate — byte-for-byte agreement** |

The +393 B gz buys the entire SSR feature line. Subsequent simplify pass extracted shared `deriveCols` / `applyStamp` / `computeFitContainerWidth` helpers between `proto.*` and `Masonry.computeLayout`, recovering some of the bytes.

---

## v5.0.0-dev.16 — 2026-04-08 — Engine/adapter split: pure-math `placeItem` (§ SSR / PRETEXT_SSR Phase 1)

> Tag: `v5.0.0-dev.16` · Improvement: [`016-engine-adapter-split.md`](./improvements/016-engine-adapter-split.md) · **Foundational refactor** — zero behavior change, prerequisite for `Masonry.computeLayout`.

### Headline

**The packing math is now extracted into a pure-math layer that can run without a DOM.** `_getItemLayoutPosition` was mixing DOM measurement (`item.getSize()`) with packing math; the math itself was already pure (it only reads from `item.size` and `this.colYs`), but it was wrapped in a method that *also* mutates `item.size` via DOM. Phase 1 extracts the pure math into a top-level `placeItem(size, state)` function that takes pre-measured sizes and numeric state and returns placement decisions — no `this`, no DOM, no option lookups. Phase 2 (#017) makes this layer publicly callable.

**All 9 visual fixtures pass byte-for-byte against unchanged screenshot baselines.** The strongest possible regression test for a math-heavy refactor.

### Added (file-local, not on prototype)

- **`placeItem(size, state)`** — top-level entry point. Computes `colSpan`, dispatches to `getTopColPosition` or `getHorizontalColPosition`, computes `(x, y)`, mutates `state.colYs` for the spanned columns.
- **`getTopColPosition(colSpan, colYs, cols)`**, **`getTopColGroup(colSpan, colYs, cols)`**, **`getColGroupY(col, colSpan, colYs)`**, **`getHorizontalColPosition(colSpan, size, state)`** — supporting helpers, all pure.

### Changed

- **`proto._getItemLayoutPosition`** — now the thinnest possible wrapper: `pretextify`-or-`getSize`, build state object, call `placeItem`, write back primitives.
- **`proto._getTopColPosition` / `_getTopColGroup` / `_getColGroupY` / `_getHorizontalColPosition`** — kept on prototype as thin shims that delegate to the pure helpers, for plugin authors who reach into masonry's internals.

### Numbers

| Metric | pre-016 | post-016 | Δ |
|---|---:|---:|---:|
| `dist/masonry.pkgd.min.js` raw | 24,342 | 24,815 | **+473** |
| `dist/masonry.pkgd.min.js` gz | 7,734 | 7,898 | **+164** |
| Visual regression tests | 9/9 | 9/9 | byte-for-byte against unchanged baselines |
| Other gates | all green | all green | unchanged |

The byte over-shoot vs the predicted "±0" is because esbuild's minifier doesn't inline file-local helpers across function boundaries — both the pure helpers AND the proto wrapper delegates ship in the minified output. Updated calibration: `+200-500 B raw / +80-180 B gz per "extracted pure helper that the minifier can't inline."` Bytes recoverable by deleting the proto wrappers (breaking change for plugin authors) — deferred to a future v5.0.0-rc.

---

## v5.0.0-dev.15 — 2026-04-08 — `static: true` SSR preset + new `PRETEXT_SSR_ROADMAP.md` (§ SSR / PRETEXT_SSR Phase 0.5)

> Tag: `v5.0.0-dev.15` · Improvement: [`015-static-ssr-preset.md`](./improvements/015-static-ssr-preset.md) · **Closes upstream**: none directly — first-class answer to the "SSR + masonry ergonomics" question.

### Headline

**One flag to opt out of all dynamic-content machinery.** For server-rendered grids whose items will not change size after first paint:

```js
new Masonry(grid, {
  columnWidth: 280,
  static: true,  // ← skips fonts.ready hook + ResizeObserver, forces transitionDuration: 0
});
```

`options.static` flips three runtime behaviors in one shot: forces `transitionDuration: 0`, skips the `document.fonts.ready` deferred layout from #010, and skips the per-item `ResizeObserver` construction from #012. For server-rendered content (Next.js, Astro, SvelteKit, Nuxt SSR pages — the common SSR case) this eliminates the hydration flash AND the runtime cost of the dynamic-content hooks.

### Added

- **`options.static` boolean** in `masonry.js` (gates the existing #010 + #012 hooks behind `if (!this.options.static)`).
- **`static?: boolean`** in `masonry.d.ts` with full JSDoc documenting the three behaviors it disables.
- **`test/visual/pages/static-mode.html`** — discriminating fixture. The **exact inverse** of `resize-observer.html` (#012): same setup, same items, same programmatic resize of item 0 from 30→60 after construction, but constructed with `static: true`. Item 3 stays at `(0, 30)` (no relayout) instead of moving to `(60, 30)` (relayout fired). The two fixtures form a conjugate pair that mutually enforce the `static` branch.
- **NEW `PRETEXT_SSR_ROADMAP.md`** at the repo root (~700 lines) — the focused single-feature roadmap for the broader pretext + SSR + computeLayout vision. Six phases: Phase 0.5 (this preset), Phase 1 (engine/adapter split), Phase 2 (`Masonry.computeLayout`), Phase 3 (`initLayout: false` adoption), Phase 4 (working Astro example), Phase 5 (benchmarks + README headline). Sibling document to `FORK_ROADMAP.md`.
- **README "Optimizations for SSR mode — `static: true`"** — rewritten section documenting the single-flag UX (replaces the previous manual three-option recipe).

### Changed

- **`examples/astro/` and `examples/nextjs/`** — both updated to use `static: true` instead of the manual `transitionDuration: 0` workaround.
- **`FORK_ROADMAP.md` § Progress** — new item S marked ✅ landed, promoted from the README's "candidate future optimizations" list after #014.

### Numbers

| Metric | pre-015 | post-015 | Δ |
|---|---:|---:|---:|
| `dist/masonry.pkgd.min.js` raw | 24,241 | 24,342 | **+101** |
| `dist/masonry.pkgd.min.js` gz | 7,714 | 7,734 | **+20** |
| `dist/masonry.pkgd.min.js` brotli | 6,973 | 6,994 | **+21** |
| Visual regression tests | 8/8 | **9/9** | +1 (`static-mode`) |
| Other gates | all green | all green | unchanged |

**The smallest dev release in size cost since #009** (+22 B gz). +20 B gz for an SSR ergonomic feature that closes the "users have to manually disable three different hooks" usability gap.

### Predicted vs actual

| Metric | Predicted | Actual | Status |
|---|---|---|---|
| `min.js` raw | +60 to +150 B | **+101 B** | ✅ middle of band |
| `min.js` gzip | +20 to +60 B | **+20 B** | ✅ low end of band |
| `masonry.js` source raw | +400 to +700 B | **+462 B** | ✅ middle of band |
| Visual fixtures | 8 → 9 | 9/9 | ✅ |
| Discriminator FAILS without fix | yes | yes (item 3 at `(60, 30)` instead of `(0, 30)`) | ✅ |
| SSR + module + no-jquery gates | unchanged | unchanged | ✅ |

---

## v5.0.0-dev.14 — 2026-04-08 — Percentage column width + gutter math fix (§ P.1, closes upstream #1006)

> Tag: `v5.0.0-dev.14` · Improvement: [`014-percent-column-width-fix.md`](./improvements/014-percent-column-width-fix.md) · **Closes upstream**: [`desandro/masonry#1006`](https://github.com/desandro/masonry/issues/1006) (53 reactions — the highest-reaction open issue in the upstream tracker)

### Headline

**Percentage `columnWidth` + non-zero `gutter` now pick the right number of columns.** When masonry's `columnWidth` originates from a percentage — either via the new first-class literal `columnWidth: '20%'`, an inline `style="width: 20%"` on the sizer element, or a stylesheet rule like `.grid-sizer { width: 20% }` — the gutter-overshoot math in `measureColumns` no longer drops a column. The bug had been open in upstream since 2018 with **53 reactions** and zero movement; this is the highest-reaction unresolved issue in `desandro/masonry`.

Concrete example: in a 1000px container with a `.grid-sizer { width: 20% }` and a 10px gutter, upstream computes `floor((1000+10) / (200+10)) = 4` columns instead of the obvious 5, leaving 170px of unused space on the right. With the fix, masonry detects the percentage origin and snaps to `cols = round(100/20) = 5`, then derives `columnWidth = (1000+10)/5 = 202` so the gutters fit inside the container.

### Added

- **First-class literal percentage option:** `new Masonry(grid, { columnWidth: '20%' })` is now supported directly. Previously this would crash at construction time because `_getMeasurement` called `querySelector('20%')` (an invalid CSS selector) and threw a `SyntaxError`. The literal-percent path is detected before `_getMeasurement` runs and short-circuits the call.
- **`test/visual/pages/percent-cols.html`** — discriminating fixture for the fix. Container 240px, gutter 20px, sizer 20%. Without the fix, masonry computes 3 columns and items 3+4 wrap to row 2; with the fix, masonry computes 5 columns and all 5 items pack into row 1. The position assertion in `test/visual/run.mjs` checks the exact post-fix pixel positions and fails loudly on the broken case (verified by toggling the fix off via `if (false && ...)`).

### Changed

- **`masonry.js` — `proto._resetLayout`:** detects percent-origin column widths via three layers (literal option, inline style on sizer, matched CSS rule walked from `document.styleSheets`) and stashes `_columnWidthPercent` for `measureColumns` to consume. Cross-origin stylesheets throw on `.cssRules` access and are silently skipped; `@media` and `@supports` rules are recursed into only when their condition currently matches `window.matchMedia(rule.media.mediaText)` (otherwise we'd pick up percents from inactive viewports).
- **`masonry.js` — `proto.measureColumns`:** new gated branch at the top of the function. When `_columnWidthPercent` is set, derives `cols = round(100/percent)` directly and recomputes `columnWidth = (containerWidth + gutter) / cols`. The stride formula matches the existing code's convention where `this.columnWidth += this.gutter` makes `columnWidth` a per-column **stride** (item width + gutter), not just the item width.

### Unchanged (intentional)

- **All non-percent column-width paths.** Fixed-pixel `columnWidth` (e.g. `columnWidth: 200`) and selector-pointing-to-non-percent-sizer (e.g. `columnWidth: '.grid-sizer'` where `.grid-sizer` has a fixed pixel width) take the standard branch unchanged. The percent path is gated entirely on `_columnWidthPercent` being non-null after detection.
- **The other 7 visual fixtures** all still pass byte-for-byte against their existing screenshot baselines. No screenshot baseline updates besides the new `percent-cols.png`.
- **SSR safety**, **module-smoke**, **no-jquery** — all three gates unchanged. The detection helpers are wrapped in `typeof document === 'undefined'` and `typeof window === 'undefined'` guards.

### Numbers

| File                       |    pre-014 |    post-014 | Δ raw     | Δ%       |
| ---                        |        ---:|         ---:| ---:      | ---:     |
| `masonry.js` (source)      |     12,914 |     18,361  | **+5,447** | **+42.18%** (verbose comments — same pattern as #009/#010/#012) |
| `dist/masonry.pkgd.js`     |     52,126 |     54,801  | +2,675    | +5.13%   |
| `dist/masonry.pkgd.min.js` raw  | 22,984 | **24,241**  | **+1,257** | **+5.47%** |
| `dist/masonry.pkgd.min.js` gzip |  7,323 | **7,714**   | **+391**   | **+5.34%** |
| `dist/masonry.pkgd.min.js` brotli |  6,591 | **6,973**   | **+382** | **+5.80%** |
| `dist/masonry.cjs`         |     49,099 |     51,648  | +2,549    | +5.19%   |
| `dist/masonry.mjs`         |     50,288 |     52,837  | +2,549    | +5.07%   |
| Visual regression tests    |        7/7 |        8/8  | +1        |          |
| Test gates                 | 7 + ✓ + ✓ + ✓ | 8 + ✓ + ✓ + ✓ | unchanged |        |
| Tracked files              |         85 |          87 | +2        | (fixture html + screenshot baseline) |

### Vs upstream-frozen v4.2.2

| Metric                          |  v4.2.2 | v5.0.0-dev.14 | Δ raw  | Δ%      |
| ---                             |    ---: |          ---: |  ---:  |    ---: |
| `dist/masonry.pkgd.min.js` raw  | 24,103  |    **24,241** | +138   |  +0.57% |
| `dist/masonry.pkgd.min.js` gzip |  7,367  |    **7,714**  | +347   |  +4.71% |
| `dist/masonry.pkgd.min.js` brotli| 6,601  |    **6,973**  | +372   |  +5.63% |

The fork has slipped to **slightly above upstream** in all three metrics for the first time since #006. **Expected and acceptable** — the combined cost of `#009 pretext + #010 fonts + #012 ResizeObserver + #014 percent fix` (~841 B gz cumulative) closes 10+ long-stale upstream issues plus a measured 17-24% layout speedup, and the next batch of pure deletions (items A-F + M-O in `FORK_ROADMAP.md`, ~950-1500 B gz combined) restores the lead with margin to spare.

### Predicted vs actual

| Metric                 | Predicted               | Actual    | Verdict        |
| ---                    | ---                     |       ---:| ---            |
| `min.js` raw           | +900 to +1,500 B        | +1,257 B  | ✅ middle of band |
| `min.js` gzip          | +300 to +500 B          | +391 B    | ✅ middle of band |
| `min.js` brotli        | similar to gzip         | +382 B    | ✅              |
| `masonry.js` source    | +4,000 to +6,000 B      | +5,447 B  | ✅ upper band   |
| Visual fixtures        | 7 → 8                   | 8/8       | ✅              |
| Discriminator fails without fix | yes            | yes (item 1 at 68px) | ✅      |

**The predictions calibrated correctly this time** — `+391 B gz` is squarely in the predicted `+300 to +500 B` band. Cumulative calibration from #009-#012 produced sharp predictions.

### Migration

**No action needed for any existing user.** All the existing column-width input forms still work — fixed-pixel `columnWidth: 200`, selector strings `columnWidth: '.grid-sizer'`, HTMLElement references `columnWidth: someEl`. The fix only changes behavior when masonry detects that the resolved columnWidth originated from a percentage, and only changes it in the direction the upstream issue described.

If you were working around `#1006` by hand-computing the column count and passing it as fixed pixels — you can drop the workaround. The literal-percent option `columnWidth: '20%'` is also new and is the cleanest expression of "I want N columns of 1/N width each".

If you have stylesheet-defined percent widths loaded from a **cross-origin** CDN, layer 3 (stylesheet walking) won't see them due to the same-origin policy — falls back gracefully to no detection. Workaround: switch to layer 1 (literal `'20%'` option) or layer 2 (inline `style="width: 20%"` on the sizer).

---

## v5.0.0-dev.13 — 2026-04-08 — Real ESM + CJS bundle outputs (§ 2.2)

> Tag: `v5.0.0-dev.13` · Improvement: [`013-esm-cjs-builds.md`](./improvements/013-esm-cjs-builds.md) · **Closes upstream**: none directly, but unblocks every modern-bundler consumer

### Headline

**`import` and `require` actually work now.** Every dev tag through `v5.0.0-dev.12` shipped a `package.json` `exports` field that pointed `import`, `require`, and `default` at `dist/masonry.pkgd.min.js`, which is `format: 'iife'` — a bare `var Masonry = (() => { … })()` with **no module exports of any kind**. `await import('masonry-pretext')` from any modern bundler (Vite, Rollup, esbuild, webpack 5, Astro, Next.js, Nuxt, SvelteKit) resolved to `default = undefined`, and consumers got `TypeError: Masonry is not a constructor`. The IIFE bundle worked for `<script src="…">` browser drop-in but broke every other path. This release ships the real fix.

### Added

- **`dist/masonry.cjs`** — CommonJS bundle, ~48 KB raw / ~9.5 KB gz / 1456 lines. `module.exports = Masonry`. Resolved by Node `require()`, webpack 4, and any tool that prefers CJS.
- **`dist/masonry.mjs`** — ES module bundle, ~50 KB raw / ~10 KB gz / 1480 lines. `export default Masonry`. Resolved by Vite, Rollup, esbuild, webpack 5, Astro, Next.js 13+, Nuxt 3, SvelteKit, and any tool reading the `import` condition.
- **`./browser` + `./browser/unminified` subpath exports** in `package.json` so consumers can explicitly reach the IIFE bundle by name (`import 'masonry-pretext/browser'`) instead of digging into `node_modules/`.
- **`test/visual/module-smoke.mjs`** — new smoke test that loads `dist/masonry.cjs` via Node `require()` and `dist/masonry.mjs` via dynamic `import()`, then asserts both expose a constructor with `prototype.layout`. Runs as part of `make test`. Distinct from `ssr-smoke.mjs` (which only validates SSR safety of the IIFE bundle in `vm.runInContext`).
- **`test:modules` npm script** for running `module-smoke.mjs` standalone.

### Changed

- **`package.json` `main`** — `./dist/masonry.pkgd.min.js` → `./dist/masonry.cjs`
- **`package.json` `module`** — `./dist/masonry.pkgd.min.js` → `./dist/masonry.mjs`
- **`package.json` `exports['.']`**:
  - `import` — `./dist/masonry.pkgd.min.js` → `./dist/masonry.mjs`
  - `require` — `./dist/masonry.pkgd.min.js` → `./dist/masonry.cjs`
  - `default` — `./dist/masonry.pkgd.min.js` → `./dist/masonry.mjs`
- **`scripts/build.mjs`** — refactored shared config into `baseConfig` + `iifeSharedConfig` + new `cjsConfig` + new `esmConfig`; runs four esbuild builds in parallel instead of two; added size logging for the new files. Build time went from ~14 ms (2 outputs) to ~18 ms (4 outputs).
- **`scripts/measure.sh`** — table now lists the new `dist/masonry.cjs` and `dist/masonry.mjs` rows alongside the IIFE bundles.
- **`Makefile`** — `make test` (and `make test-update`) now runs `module-smoke.mjs` between the SSR smoke and the no-jquery check.

### Unchanged (intentional)

- **`dist/masonry.pkgd.js` and `dist/masonry.pkgd.min.js`** — same byte count as dev.12 (the only diff is the embedded version string in the banner header, `v5.0.0-dev.12` → `v5.0.0-dev.13`, same length). The visual regression suite still loads the minified IIFE via `<script>`, and the existing CDN-style `<script src="…">` consumption path is preserved.
- **`./source` and `./unminified` subpath exports** — kept for backwards compat with anyone who pinned to dev.11/dev.12 and used those paths.
- **No source code changes.** `masonry.js` is byte-identical. The fix is entirely in build outputs and packaging metadata.

### Why this is § 2.2 of the roadmap, not a hotfix

The original Tier 0 packaging fix (improvement #011) explicitly noted that the full ESM build was "still pending" and acknowledged the `import`/`require` conditions were pointing at the IIFE as a temporary placeholder. § 2.2 of `FORK_ROADMAP.md` is the planned scope for shipping real ESM + CJS bundles. This improvement closes that planned scope; the Tier 0 fix in #011 stopped halfway because it was trying to be source-change-free.

### Migration

- **No action needed for `<script>` tag users.** `dist/masonry.pkgd.{js,min.js}` are unchanged.
- **No action needed for npm consumers either** — `import 'masonry-pretext'` and `require('masonry-pretext')` will now resolve to the new bundles automatically. The previously-broken consumers start working without any code changes on their end.
- **If you were already pinning to a subpath** (`masonry-pretext/source` or `masonry-pretext/unminified`) — those still work, byte-identically.
- **If you want to keep using the IIFE bundle from a bundler context** for some reason — use the new explicit subpath: `import 'masonry-pretext/browser'`. (Almost certainly a sign that something else is wrong, but the escape hatch is there.)

### Numbers

| File                       |     pre-013 |    post-013 | Δ          |
| ---                        |         ---:|         ---:| ---        |
| `dist/masonry.pkgd.js`     |      52,126 |      52,126 | **0**      |
| `dist/masonry.pkgd.min.js` |      22,984 |      22,984 | **0**      |
| `dist/masonry.cjs`         |    (absent) |      49,099 | **+49 KB** |
| `dist/masonry.mjs`         |    (absent) |      50,288 | **+50 KB** |
| Test gates                 | 7 + ✓ + ✓   | 7 + ✓ + ✓ + ✓ | +1 (module-smoke) |
| Bundle outputs             |           2 |           4 | +2         |
| Modern-bundler consumers   | **broken**  | **works**   | ✅          |

The new files add ~100 KB raw / ~20 KB gz to the **published tarball**, but **zero** to what consumers ship in their final bundles — modern bundlers tree-shake into a single output and only one of CJS/ESM gets pulled in (depending on resolver), not both.

### Predicted vs actual

Predicted: two new bundles (~48 + ~50 KB raw), 7+✓+✓+✓ tests, IIFE byte-identical, downstream consumer works.
Actual: 49,099 + 50,288 B raw, 7+✓+✓+✓ tests, IIFE byte-identical (52,126 / 22,984), downstream `enacast-astro` consumer works.

✅ **Match.**

---

## v5.0.0-dev.12 — 2026-04-08 — Per-item ResizeObserver auto-relayout (§ P.1b)

> Tag: `v5.0.0-dev.12` · Improvement: [`012-per-item-resize-observer.md`](./improvements/012-per-item-resize-observer.md) · **Closes upstream**: [`#1147`](https://github.com/desandro/masonry/issues/1147) + 7 duplicates ([`#1185`](https://github.com/desandro/masonry/issues/1185), [`#1158`](https://github.com/desandro/masonry/issues/1158), [`#1152`](https://github.com/desandro/masonry/issues/1152), [`#1108`](https://github.com/desandro/masonry/issues/1108), [`#1165`](https://github.com/desandro/masonry/issues/1165), [`#1189`](https://github.com/desandro/masonry/issues/1189), [`#1199`](https://github.com/desandro/masonry/issues/1199))

### Headline

**Closes 8+ duplicate upstream issues in one shot — the dominant complaint category in the upstream tracker.** When a masonry item contains a lazy-loading `<img>`, masonry measures it at its empty fallback size, packs the layout, then the image loads and the item grows — but masonry doesn't know to relayout. The traditional fix was a separate `imagesLoaded` library; the platform-native fix is `ResizeObserver`, which fires when ANY item resizes for ANY reason (image load, font load, content edit, parent resize, custom element render, etc).

### Added

- **Per-instance `ResizeObserver`** observing every item element. When any item's size changes, schedule a `layout()` via `requestAnimationFrame` coalescing so multiple changes in one frame collapse to a single relayout call.
- **`_itemize` override** so items added after construction (via `appended()`, `prepended()`, `addItems()`) are auto-observed.
- **`remove` override** so removed items are auto-unobserved (prevents a memory leak class).
- **`destroy` override** disconnects the observer entirely.
- **`_observeItemElement` helper** that pre-populates `_resizeLastSizes` synchronously at observe time using `getBoundingClientRect()`. Critical for correctness — see "Calibration lesson" below.
- **`test/visual/pages/resize-observer.html`** discriminating fixture: programmatically resizes item 0 from 30→60 after construction; asserts the relayout fires (item 3 lands at `(60, 30)`, not `(0, 30)`).
- **7th visual fixture in `make test`** (was 6).

### Numbers

| File | Metric | pre-012 | v5.0.0-dev.12 | Δ |
|---|---|---:|---:|---:|
| `dist/masonry.pkgd.js` | raw | 49,493 | 52,126 | +2,633 B (+5.32 %) |
| `dist/masonry.pkgd.js` | gzip | 9,337 | 9,844 | +507 B (+5.43 %) |
| `dist/masonry.pkgd.min.js` | raw | 21,736 | **22,984** | **+1,248 B (+5.74 %)** |
| `dist/masonry.pkgd.min.js` | gzip | 6,957 | **7,322** | **+365 B (+5.25 %)** |
| `dist/masonry.pkgd.min.js` | brotli | 6,267 | 6,586 | +319 B (+5.09 %) |
| Visual regression tests | passing | 6 / 6 | **7 / 7** | +1 |
| SSR + no-jquery gates | passing | ✓ + ✓ | ✓ + ✓ | unchanged |

### vs upstream-frozen v4.2.2

| Metric | v4.2.2 | v5.0.0-dev.12 | Δ |
|---|---:|---:|---:|
| `dist/masonry.pkgd.min.js` raw | 24,103 | **22,984** | **−1,119 B (−4.64 %)** |
| `dist/masonry.pkgd.min.js` gzip | 7,367 | 7,322 | −45 B (−0.61 %) |
| `dist/masonry.pkgd.min.js` brotli | 6,601 | 6,586 | −15 B (−0.23 %) |

The fork is **still smaller than upstream in every minified-bundle metric**, even after adding three new features (#009 pretext, #010 fonts.ready, #012 ResizeObserver). The size lead has shrunk from −9.82 % gz at #010 to −0.61 % gz now — but each feature closes real upstream issues that have been open for years. The remaining size wins from the post-#010 review (items A-F + M-O, ~950-1500 B gz combined) will more than restore the gap when they land.

### Calibration lesson — the first attempt was wrong

**First attempt** used a `WeakSet` to "skip the first observer event per element," based on the assumption that ResizeObserver's first delivery is always the no-op "I'm now observing this" notification. **The bug:** ResizeObserver delivers the first event with the size at *delivery* time, not at *observe* time. If the size changes between `observe()` and the first delivery (which is exactly what the test fixture does — and exactly what real lazy-loaded images do), the first delivered event captures the **new** size. Skipping it silently misses the very kind of change this hook exists to catch.

The discriminating fixture caught it immediately on the first run: item 3 stayed at `(0, 30)` because the resize event for item 0 was treated as a "first event" and skipped. **Build the fixture first, debug against it second.**

**The fix:** pre-populate a `_resizeLastSizes` `WeakMap` synchronously at `observe()` time using `getBoundingClientRect()` (which returns the same fractional `borderBoxSize` the observer delivers — they match exactly in chromium ≥84). Drop the WeakSet entirely. Now every event is a real comparison.

### Predicted vs actual

- `min.js` raw: predicted +700-1200, actual **+1,248** (~48 B over the top of band — within rounding)
- `min.js` gz: predicted +250-400, actual **+365** (middle of band)
- All 7 visual fixtures + SSR + no-jquery gates: ✅
- Discriminating fixture proves the relayout fires: ✅

### Migration notes

- **None for existing users.** The hook is opt-in via the platform: any item that resizes for any reason now triggers an automatic relayout. No API change.
- **You no longer need `imagesLoaded`** for the lazy-image case. Remove it from your dependencies if it was only there for masonry. (You may still want it for other use cases like `imagesLoaded.on('progress')`.)
- **CDN consumers**: regenerate SRI hashes (bundle bytes have changed).

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