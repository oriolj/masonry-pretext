# PRETEXT_SSR_ROADMAP.md

A focused, single-feature roadmap for the **pretext-driven server-side layout precomputation** feature line. Lives alongside [`FORK_ROADMAP.md`](./FORK_ROADMAP.md) (which covers the full fork) but scopes itself to one thing: making `masonry-pretext` the only masonry library that can compute its own layout in pure Node and emit zero-flash SSR cascading grids.

This document is the single source of truth for "what is the pretext + SSR feature, what's done, what's next, and why each step matters." When a phase lands, mark it ✅ and link the per-improvement record in [`improvements/`](./improvements/), the same way `FORK_ROADMAP.md § Progress` works.

---

## The thesis in one sentence

> Pretext can measure text without a DOM; masonry's packing math can run without a DOM; therefore the entire layout pipeline can run on the server, emit absolute positions inline as CSS, and the client takes over with **zero visible reflow on hydration**.

This is the natural endgame of the fork's name. The fork is called *masonry-pretext*. Pretext is the headline feature. Today we ship half of the headline (a client-side fast path); the other half (server-side layout precomputation) is unbuilt and is the actual moat.

## ⚠️ Non-negotiable: measure the final result and ship the numbers in the README

**This feature is the main reason masonry-pretext exists as a fork.** Every other improvement closes a stale upstream issue or shaves a few hundred bytes — useful housekeeping. **Pretext + SSR is the category move.** It's the one thing this fork can do that no other masonry library on the market can do.

That makes the measurement step **load-bearing for the entire fork's narrative**, not just for this feature. Specifically:

1. **Phase 5 (the benchmarks) is not optional, and it is not the *last* step — it is the *justifying* step.** Phases 1-4 build the machinery; Phase 5 proves it works. Without measured numbers, the feature is a hand-wave; with measured numbers, it's a moat. Skip Phase 5 and the entire feature line loses its weight.

2. **The README headline must lead with the measured number, not the architecture.** "1.2-1.3× faster client layout (#009)" was the right shape for the pretext callback. The right shape for this feature is something concrete like "**zero hydration flash on SSR cascading grids — measured CLS 0.00 vs 0.13 (Lighthouse, 1000-item Astro page, headless chromium)**" or "**40 ms server compute → zero client reflow → first interactive 200 ms earlier than upstream masonry**". Pick the comparison that's most meaningful, but **put a number in the first sentence of the README pitch.**

3. **The measurement methodology must be reproducible.** Same standard as `bench-pretext.mjs` (#009): a checked-in script with hermetic flags, deterministic warm-up + interleaved runs, median + spread reported, and the script becomes a permanent gate so future improvements can't silently regress it. **No hand-wavy "feels faster" claims.** The fork's methodology in [`FORK_ROADMAP.md § Methodology`](./FORK_ROADMAP.md) explicitly forbids un-measured improvements; this feature line is not exempt and is in fact the highest-stakes test of that methodology.

4. **The README's "Server-side rendering" section must stop saying "candidate future optimization" and start saying "this is what the fork does, here is the number, here is the runnable example, here is the bench you can re-run."** The current SSR section is good documentation but it's framed as guidance; after Phase 5 lands, it should be framed as **the fork's defining capability**.

5. **The before/after comparison must be visible at the top of the README**, not buried in the SSR section. New row in the "Key improvements vs upstream" table that links to the bench results, the example, and the improvement record. Same shape as the existing rows for #009 / #012 / #014 / #015 — but with the number that justifies the *fork's name*.

**The measurement step is not "documentation cleanup after the work lands." It IS the work.** A working `Masonry.computeLayout` with no published number is a half-shipped feature. A bench showing zero CLS with no README pointer is a half-shipped feature. Both halves must ship together, in the same release tag, with the number in the README's first screen of content.

**Concrete acceptance criteria for "Phase 5 + README is done":**

- [ ] `bench-hydration.mjs` is checked in, runs in CI, produces a number that survives noise (median + p10/p90 reported, ≥30 runs).
- [ ] `bench-server-layout.mjs` is checked in, ditto, with N=100/500/1000/5000 grid sizes.
- [ ] The Phase 4 example's README has a side-by-side table with measured CLS / first-paint-of-final-positions for control vs `static: true + initLayout: false + computeLayout`.
- [ ] The fork's main `README.md` has a new "Key improvements" row linking to the example, the bench, and improvement record. The row's headline number is what someone reading the README in 30 seconds will remember.
- [ ] At least one external user (or one runnable verification step a reader can perform in <5 minutes) confirms the number is reproducible on their machine. Don't ship a number only the maintainer can reproduce.

If any of those boxes are unchecked, the feature hasn't actually landed — the implementation is in `masonry.js` but the **fork's headline** isn't yet in `README.md`. Don't tag a "feature complete" release until all five are checked.

---

## Why this matters

Every cascading grid library on the market — desandro/masonry, masonic, react-masonry-css, pinterest-layout, every framework-specific port — has the same hydration flash on SSR pages. The reason is universal: cascading layout depends on measured item heights, and measured heights depend on rendered DOM, and rendered DOM only exists on the client. The chain is "render to flow → hydrate → measure → reflow to absolute → first paint of final layout." Users see two layouts back-to-back.

Pretext breaks the chain at the measurement step. With pretext, item heights for text-driven grids can be computed from `(text, font, maxWidth)` arithmetically — no DOM, no rendering, no browser. Once the heights are known, the masonry packing math (which is already pure) can run anywhere — Node, edge runtime, web worker. Once the positions are known, the server can emit them inline as CSS, and the client only needs to *adopt* the existing layout, not compute one.

The result is **structurally different from every other cascading grid library**, not just incrementally faster. It's a category move, not an optimization.

---

## Current state (after #014)

| Piece | What we have today | Status |
|---|---|---|
| **DOM-free measurement** | `pretextify(elem) → {outerWidth, outerHeight}` callback in `_getItemLayoutPosition`. Skips `item.getSize()` when set. Library-agnostic — works with any pre-computed sizes. | ✅ shipped (#009) |
| **Measured client speedup** | 1.2-1.3× faster initial layout (17-24% reduction) across 100-2000-item grids via `bench-pretext.mjs`. | ✅ shipped (#009) |
| **SSR-safe imports** | Every UMD wrapper guarded with `typeof window !== 'undefined'`. Bundle loads cleanly in Node `vm` context. Closes upstream `#1194` / `#1121` / `#1201`. Verified by `ssr-smoke.mjs`. | ✅ shipped (#005) |
| **Real ESM + CJS bundles** | `dist/masonry.cjs` + `dist/masonry.mjs` work via `import` / `require` from any modern bundler. `module-smoke.mjs` gate. | ✅ shipped (#013) |
| **TypeScript surface** | Hand-written `masonry.d.ts` with `pretextify` callback typed correctly. | ✅ shipped (#011) |
| **`static: true` SSR preset** | ✅ shipped (#015) — `options.static` opts out of `document.fonts.ready` deferred layout, per-item `ResizeObserver` wire-up, and forces `transitionDuration: 0`. Discriminating fixture (`static-mode.html`) is the inverse of `resize-observer.html`. |
| **Pure-math `placeItem`** | ✅ shipped (#016) — extracted from `_getItemLayoutPosition`. All 9 fixtures pass byte-for-byte against unchanged baselines. |
| **Static `Masonry.computeLayout` helper** | ✅ shipped (#017) — Node-callable, byte-for-byte agreement with browser layouts proven by `compute-layout.mjs` for all 9 fixtures. Subsequently shared with `proto.measureColumns` / `proto._manageStamp` / `proto._getContainerFitWidth` via the `deriveCols` / `applyStamp` / `computeFitContainerWidth` helpers (simplify pass after Phase 5). |
| **`initLayout: false` adoption path** | ✅ shipped (#018) — verified existing infrastructure works; new `init-layout-false` discriminating fixture proves items pre-positioned in arbitrary shapes stay where the server placed them. **Zero source change required.** |
| **Documented SSR + pretext example** | ✅ shipped (#019) — `examples/astro/` rewritten end-to-end. Frontmatter calls `Masonry.computeLayout`, server emits inline absolute positions, client adopts via `initLayout: false + static: true`. Next.js example brought to parity in #020-followup (PR welcome originally, then upgraded). |
| **Zero-flash hydration measurement** | ✅ shipped (#020) — `bench-hydration.mjs` measures CLS via `PerformanceObserver` for two synthetic SSR fixtures. **Measured: CLS 0.7421 → 0.0000 (100% reduction).** `bench-server-layout.mjs` measures `Masonry.computeLayout` at **0.13 ms median for 5000 items**. Reproduce with `make bench`. README headline callout in first screen. |

**The SSR feature line is COMPLETE.** All 6 phases ✅. The fork now ships the only cascading-grid library with measured zero-flash SSR.

---

## Architecture: how the four pieces fit together

```
                                                  ┌────────────────────────┐
                                                  │  SERVER (Node / edge)  │
                                                  │                        │
   text + font + columnWidth + lineHeight  ──────▶│  pretext.prepare(...)  │
                                                  │  pretext.layout(...)   │
                                                  │       ↓                │
                                                  │  [{outerWidth,         │
                                                  │    outerHeight}, ...]  │
                                                  │       ↓                │
                                                  │  Masonry.computeLayout │
                                                  │       ↓                │
                                                  │  [{x, y}, ...]         │
                                                  │       ↓                │
                                                  │  emit HTML with        │
                                                  │  inline absolute       │
                                                  │  position styles       │
                                                  └────────────┬───────────┘
                                                               │
                                                               ▼
                                                  ┌────────────────────────┐
                                                  │  CLIENT (browser)      │
                                                  │                        │
                                                  │  hydration: HTML       │
                                                  │  already has correct   │
                                                  │  positions, no flash   │
                                                  │       ↓                │
                                                  │  new Masonry(grid, {   │
                                                  │    initLayout: false,  │
                                                  │    pretextify: ...,    │
                                                  │  })                    │
                                                  │       ↓                │
                                                  │  ResizeObserver +      │
                                                  │  MutationObserver      │
                                                  │  attach for subsequent │
                                                  │  changes (lazy images, │
                                                  │  font swap, resize)    │
                                                  └────────────────────────┘
```

The four pieces, separated:

1. **`pretext.prepare(text, font)` + `pretext.layout(prepared, maxWidth, lineHeight)`** — third-party library, already SSR-safe (intentional design from `@chenglou/pretext`). Pure arithmetic over font metrics. Runs in Node trivially.
2. **`Masonry.computeLayout({items, columnWidth, gutter, fitWidth, ...})`** — pure-math packing helper. Same algorithm as `_getItemLayoutPosition` but without the `item.getSize()` call. Returns `[{x, y}, ...]`. **This is what we have to build.**
3. **Server-side glue** — small per-app function that walks the items, calls pretext, calls computeLayout, emits the markup. Lives in user code, not in the library. The library just exposes the primitives.
4. **`new Masonry(grid, { initLayout: false })`** — client-side adoption. Masonry constructs, attaches observers, but skips the initial layout pass (positions are already correct from the server). First subsequent change (image load, resize, append) triggers a real layout via the existing observer hooks.

**The library's responsibility is pieces #2 and #4.** Piece #1 is upstream pretext; piece #3 is user code. We document piece #3 in the SSR README section + working examples, but we don't ship it as a function — different apps need different glue (Astro routes vs Next.js server components vs SvelteKit endpoints).

---

## Gap analysis — what specifically is missing

### Gap A — `_getItemLayoutPosition` is impure

```js
proto._getItemLayoutPosition = function( item ) {
  // ...pretextify branch...
  if ( pretextSize ) {
    item.size = pretextSize;
  } else {
    item.getSize();          // ← DOM access
  }
  // packing math reads item.size, this.colYs, this.cols, this.columnWidth
  // packing math writes this.colYs, returns {x, y}
  // ...
};
```

The packing math itself is pure (it only reads `item.size` after the get-or-pretext step). But it's wrapped in a method that *also* mutates `item.size` via DOM. To run in Node, we need to factor out the pure math and let the caller supply pre-measured `item.size`.

**Fix:** roadmap item P (engine/adapter split). Becomes Phase 1 of this roadmap.

### Gap B — `_resetLayout` calls `getSize()` on the container

```js
proto._resetLayout = function() {
  this.getSize();                      // ← DOM access (container measurement)
  // ...
  this._getMeasurement( 'columnWidth', 'outerWidth' );  // ← may DOM-access
  this._getMeasurement( 'gutter', 'outerWidth' );        // ← may DOM-access
  this.measureColumns();
};
```

For SSR precomputation, the caller needs to pass `containerWidth`, `columnWidth`, `gutter` directly as numbers. The pure-math `computeLayout` takes them as inputs, not measurements.

**Fix:** `Masonry.computeLayout({containerWidth, columnWidth, gutter, items, ...})` accepts numeric inputs only. No element parameter, no measurement step.

### Gap C — Stamps are positioned by `_manageStamp` which reads `getSize`

```js
proto._manageStamp = function( stamp ) {
  var stampSize = getSize( stamp );    // ← DOM access
  var offset = this._getElementOffset( stamp );  // ← DOM access
  // ...
};
```

Stamps (fixed-position items that other items pack around) need to be supplied to `computeLayout` as `{x, y, width, height}` already-measured rectangles, not as DOM elements.

**Fix:** `computeLayout({stamps: [{x, y, width, height}, ...], ...})` parameter.

### Gap D — `Masonry.computeLayout` doesn't exist

No static method on the constructor that takes pure data and returns pure data. The closest thing today is `instance._getItemLayoutPosition(item)`, which requires an instance, an item, and a DOM.

**Fix:** add `Masonry.computeLayout = function(opts) { ... }` as a static export. Phase 2.

### Gap E — `initLayout: false` semantics need verification

Outlayer accepts `initLayout: false` and skips the constructor's layout call, but it's not clear whether subsequent observer-triggered relayouts will overwrite already-positioned items, or whether the `_isLayoutInited` flag handles the adoption case correctly. Need a fixture that:

1. Server-renders items with inline absolute positions
2. Constructs masonry with `initLayout: false`
3. Asserts positions are unchanged after construction
4. Triggers a resize, asserts positions update via the standard layout pass

**Fix:** Phase 3 — verify + add a discriminating fixture. May require small Outlayer-side adjustments via build-time patch.

### Gap F — No working example

The user's WIP `examples/nextjs/` and `examples/astro/` have scaffolding but no end-to-end demo of `pretext.prepare → computeLayout → emit → initLayout:false → adopt`.

**Fix:** Phase 4 — flesh out one example (Astro is probably easiest because it has clean server/client boundaries) with the full pipeline working, including a Lighthouse before/after CLS measurement.

### Gap G — No measurement of the actual win

We have `bench-pretext.mjs` for the client-side fast path (#009) but nothing for the server-side path. Need:

1. **Hydration flash measurement** — Lighthouse CLS, or a custom Playwright timing of "first paint of final positions"
2. **Server-side layout time** — `computeLayout(N items)` wall-clock in Node
3. **Bytes shipped to client** — does `initLayout: false` mode let us tree-shake any of the layout machinery?

**Fix:** Phase 5 — bench-server-layout.mjs + bench-hydration.mjs.

---

## Phased plan

Each phase is one improvement (one git commit, one tag, one record in `improvements/`). Phases 1 → 5 land in strict order — phase N depends on phase N-1. **Phase 0.5 is unblocked sibling work** that can land at any time and pairs naturally with Phase 3 when the SSR pipeline ships.

### Phase 0.5 — `static: true` preset (sibling, unblocked)

**Goal:** add an `options.static` opt-out that skips every dynamic-content code path masonry has accumulated (#010 fonts.ready hook, #012 per-item ResizeObserver) AND forces `transitionDuration: 0`. For server-rendered grids whose content will not change after first paint, all of that machinery is wasted bytes + wasted observer attachments + a visible 0.4s hydration settle. The opt-out makes them disappear.

**The semantics:**

```js
new Masonry(grid, {
  columnWidth: 280,
  static: true,    // ← every dynamic-content hook is now a no-op
});
```

is equivalent to:

```js
new Masonry(grid, {
  columnWidth: 280,
  transitionDuration: 0,
  // and internally:
  // - skip the document.fonts.ready deferred layout
  // - skip the per-item ResizeObserver construction
  // - (future) skip the MutationObserver auto-relayout once K lands
  // - (future) skip whatever else dynamic-content hooks accumulate
});
```

**Why this isn't just "set those options yourself":** the dynamic-content hooks aren't all exposed as options today (the ResizeObserver wire-up has no opt-out, the fonts.ready hook has no opt-out). Giving them a single umbrella switch is the right ergonomic shape — and it future-proofs against further dynamic hooks. New hooks added later automatically become opt-outable by checking `if (!this.options.static)` at construction.

**Why this complements the SSR pipeline (Phases 1-5):** the SSR pipeline computes positions on the server and adopts them on the client via `initLayout: false`. For a grid where the content is text-only, fonts are preloaded, no images load lazily, and the page won't resize after first paint, **the only thing left for the client to do is exist**. `static: true` removes everything else. The natural usage in a Phase 4 demo:

```js
new Masonry(grid, {
  columnWidth: COL,
  initLayout: false,    // adopt SSR positions, don't relayout
  static: true,         // no observers, no animations, no font hooks
  pretextify: ...,      // pretext callback for whatever client-side relayouts may happen
});
```

**Discriminating fixture:** `test/visual/pages/static-mode.html` — the **exact inverse** of `resize-observer.html` (#012). Same setup, same item shapes, same programmatic resize of item 0 from 30→60 after construction. The discriminator inverts the assertion:

| Fixture | Mode | Expected item 3 position | Why |
|---|---|---|---|
| `resize-observer.html` | default (observer ON) | `(60, 30)` | observer fired, relayout adopted new size |
| `static-mode.html` | `static: true` | `(0, 30)` | observer never wired, original layout preserved |

The two fixtures form a clean pair: they can't both pass unless `static: true` actually opts out. Same calibration approach as #014's `if (false && ...)` toggle but built into the fixture set permanently.

**Files touched:**
- `masonry.js` — `proto._create` reads `this.options.static` and gates the existing #010 + #012 hooks behind `if (!this.options.static)`. Forces `transitionDuration: 0` before `baseCreate` so `item.transition()` reads the overridden value.
- `masonry.d.ts` — add `static?: boolean` to the options interface
- `test/visual/pages/static-mode.html` — new fixture
- `test/visual/run.mjs` — new case

**Predictions:**
- `dist/masonry.pkgd.min.js` raw: +60 to +150 B (three small `if` gates + one option assignment)
- `dist/masonry.pkgd.min.js` gz: +20 to +60 B
- All 8 existing fixtures still pass (the gates default to `static: false`, behavior unchanged for non-opt-in users)
- New `static-mode` fixture passes; would fail if any of the dynamic hooks fired

**Risks:**
- **`transitionDuration` mutation timing.** The override has to happen before `baseCreate` runs (because the Outlayer constructor reads it during item construction). Get this wrong and items still animate.
- **Naming.** `static` is a JavaScript reserved word in strict mode contexts. It's safe as an object property (`{ static: true }` is legal), but linters/typecheckers may warn. Alternative names: `isStatic`, `staticMode`, `frozen`. Stick with `static` because it's the most discoverable for users coming from React/Astro where "static" already means "won't change."
- **Future hooks have to remember to check the gate.** A future improvement that adds another dynamic hook (e.g. roadmap item K = MutationObserver) needs to wrap itself in `if (!this.options.static)`. Document this expectation in `masonry.js`'s `_create` comment.

**Status:** 🟡 in flight (working tree shows the implementation, the fixture, and the test case are written; pending build + measure + commit).

**Tag target:** `v5.0.0-dev.15`. Independent of all other phases.

---

### Phase 1 — Item P: engine/adapter split

**Goal:** factor `_getItemLayoutPosition` and the supporting helpers into a pure-math layer + a thin DOM adapter, with no behavior change.

**The pure layer (target signature):**

```js
function placeItem({
  size,            // {outerWidth, outerHeight}
  state: {
    cols,
    colYs,         // mutated in place
    columnWidth,
    horizontalColIndex,
    horizontalOrder,
    fitWidth,
  },
}) → { x, y, col, newColYs, newHorizontalColIndex }
```

The DOM adapter wraps `placeItem` and is what `_getItemLayoutPosition` calls. The existing method's body becomes:

```js
proto._getItemLayoutPosition = function( item ) {
  // pretextify fast path (#009) — unchanged
  var pretextify = this.options.pretextify;
  var pretextSize = pretextify && pretextify( item.element, item );
  if ( pretextSize ) item.size = pretextSize;
  else item.getSize();

  // pure-math placement
  var result = placeItem({
    size: item.size,
    state: {
      cols: this.cols,
      colYs: this.colYs,
      columnWidth: this.columnWidth,
      horizontalColIndex: this.horizontalColIndex,
      horizontalOrder: this.options.horizontalOrder,
      fitWidth: this._getOption('fitWidth'),
    },
  });
  this.colYs = result.newColYs;
  this.horizontalColIndex = result.newHorizontalColIndex;
  return { x: result.x, y: result.y };
};
```

**Files touched:** `masonry.js` only. ~150 LOC moved around, ~30 LOC of new pure-function structure. No new exports yet — the pure function is private to the file in this phase.

**Tests:** all 8 existing visual fixtures must pass byte-for-byte. The screenshot baselines must not need updating. **This is the strongest possible regression test** — any deviation in packing math reveals itself immediately.

**Predictions:**
- `dist/masonry.pkgd.min.js` raw: ±50 B (refactor, not feature; minifier should produce nearly the same output)
- `dist/masonry.pkgd.min.js` gz: ±20 B
- `masonry.js` source raw: +800 to +1500 B (the pure function is more verbose than the inline version, even before doc comments)
- All 8 visual fixtures pass. SSR + module-smoke + no-jquery unchanged.

**Risks:**
- **`_getTopColGroup` and `_getColGroupY` need to be pure too.** They read `this.colYs` and call `this.cols`. Easy to factor out, but the indirection adds complexity. Worth it because Phase 2 needs them.
- **`horizontalColIndex` mutation order matters.** The current code mutates `this.horizontalColIndex` inside `_getHorizontalColPosition`. The pure version has to return the new value and let the caller assign — easy to get wrong.
- **`_manageStamp` is separate from `_getItemLayoutPosition` but needs the same treatment** for Phase 2 (so `computeLayout` can accept stamps). Decide: do stamps in Phase 1 or defer to Phase 2? Recommendation: defer to Phase 2 to keep Phase 1 minimal.

**Status:** ✅ shipped (`v5.0.0-dev.16`). All 9 visual fixtures pass byte-for-byte against unchanged baselines. See [`016-engine-adapter-split.md`](./improvements/016-engine-adapter-split.md). The simplify pass after #020 further extracted `deriveCols` / `applyStamp` / `computeFitContainerWidth` so `Masonry.computeLayout` and `proto.*` share the same math functions structurally.

---

### Phase 2 — `Masonry.computeLayout` static helper

**Goal:** expose a Node-callable, DOM-free function that takes pre-measured sizes and returns positions.

**Target signature:**

```ts
type Size = { outerWidth: number, outerHeight: number };
type Position = { x: number, y: number };

interface ComputeLayoutOptions {
  items: Size[];
  containerWidth: number;
  columnWidth: number;
  gutter?: number;
  fitWidth?: boolean;
  horizontalOrder?: boolean;
  // Optional: pre-positioned stamps that other items pack around.
  stamps?: { x: number, y: number, width: number, height: number }[];
  // Optional: percent literal for the #014 detection path. If set,
  // overrides the cols-from-columnWidth math the same way the inline
  // detection does.
  columnWidthPercent?: number;
}

interface ComputeLayoutResult {
  positions: Position[];     // one per items[i]
  cols: number;              // computed col count
  columnWidth: number;       // resolved per-column stride
  containerHeight: number;   // total grid height
  containerWidth?: number;   // only set when fitWidth: true
}

Masonry.computeLayout(opts: ComputeLayoutOptions): ComputeLayoutResult;
```

**Implementation:** thin wrapper around `placeItem` (from Phase 1) plus the column-counting logic from `measureColumns`. No instance, no DOM. Pure data in, pure data out.

**The killer test:** for each of the 8 existing visual fixtures, extract the item sizes and container width, call `Masonry.computeLayout(...)` in Node, and assert the returned positions match the browser-rendered positions byte-for-byte. This is the **byte-for-byte agreement guarantee** between server and client.

**New test file:** `test/visual/compute-layout.mjs` — runs in Node only, no chromium. Reads each fixture's expected positions from `run.mjs`, runs `Masonry.computeLayout` with hardcoded sizes that match the fixture, asserts equality. Becomes part of `make test` (very fast — milliseconds).

**Files touched:**
- `masonry.js` — add `Masonry.computeLayout = function(opts) { ... }`
- `masonry.d.ts` — add the TypeScript declaration
- `test/visual/compute-layout.mjs` — new gate
- `Makefile` — add `compute-layout.mjs` to `make test`

**Predictions:**
- `dist/masonry.pkgd.min.js` raw: +200 to +500 B
- `dist/masonry.pkgd.min.js` gz: +80 to +180 B
- New test file: ~150 LOC
- All 8 visual fixtures still pass. SSR + module + no-jquery + new compute-layout gate green.

**Risks:**
- **Stamp handling needs to be added here, not deferred.** Without stamps, `computeLayout` can't reproduce all 8 fixture layouts (the basic fixtures don't use stamps but real-world grids do). Phase 1's deferral of stamps comes due in Phase 2.
- **`fitWidth` returns a different container width.** The caller has to know whether to use the input `containerWidth` or the output one. Document clearly.
- **Subpixel arithmetic.** Node's `Number` and Chromium's layout subpixel rounding may differ in the last bit. The byte-for-byte test will catch this loudly. Mitigation: round positions to 2 decimal places at the end, or accept that Node and browser must use identical math.

**Status:** ✅ shipped (`v5.0.0-dev.17`). New `test/visual/compute-layout.mjs` Node-only gate proves byte-for-byte agreement with the browser-side layout for all 9 fixtures, on the first build, with no debugging required. See [`017-compute-layout-static-helper.md`](./improvements/017-compute-layout-static-helper.md).

---

### Phase 3 — `initLayout: false` adoption path

**Goal:** verify (and fix if needed) that constructing masonry with `initLayout: false` on a grid that already has absolute-positioned items leaves those positions intact, then activates observers for subsequent changes.

**The current state of `initLayout`:**

```js
// Outlayer constructor (paraphrased)
if (this.options.initLayout) {
  this.layout();
}
```

So `initLayout: false` skips the initial `layout()` call. **But:**

1. Does masonry's `_create` extension still attach the per-item ResizeObserver? (#012 hook). It should — observers are independent of layout.
2. Does the `document.fonts.ready` deferred layout (#010) still fire and overwrite positions? It might — needs verification + maybe a guard.
3. Does the resize listener still trigger relayout on the first window resize? It should — that's the desired behavior; the SSR layout is a hint, not a contract.
4. When the resize *does* fire, is `colYs` initialized correctly so the relayout works? Probably not — `_resetLayout` initializes `colYs` to zeros. The first relayout might pack from-scratch and overwrite the SSR positions wholesale, which is fine *if* the page is now responding to a real resize, but bad if it fires spuriously.

**Investigation phase:** before writing any code, build a fixture (`test/visual/pages/init-layout-false.html`) that:

1. Server-renders 5 items with hardcoded `style="position:absolute; left:Xpx; top:Ypx;"`
2. Constructs `new Masonry(grid, { initLayout: false, ... })`
3. Asserts positions immediately after construction match the inline values (no overwrite)
4. Triggers a synthetic resize that *should* relayout
5. Asserts positions update to the resized layout
6. Asserts `document.fonts.ready` (when mocked) does NOT relayout if the page hasn't actually changed

The fixture is the spec. Whatever fails, that's what the implementation has to fix.

**Likely fixes:**
- A new option `adoptInitialLayout: true` that tells masonry to import existing item positions into `colYs` instead of zeroing them.
- OR: document that `initLayout: false` requires the user to also pass `transitionDuration: 0` (so the first real relayout doesn't animate the positions away from server values into client values, even if they happen to match).

**Files touched:**
- `masonry.js` — small _create override or option handling
- `test/visual/pages/init-layout-false.html` — new fixture
- `test/visual/run.mjs` — new case
- Potentially `outlayer/outlayer.js` via build-time patch if Outlayer's behavior needs adjustment

**Predictions:**
- `dist/masonry.pkgd.min.js` raw: +100 to +300 B
- `dist/masonry.pkgd.min.js` gz: +40 to +120 B
- New fixture passes; the 8 existing fixtures + 4 gates still green.

**Risks:**
- **The Outlayer base class is the truth-source for `initLayout`.** Changing its behavior via build-time patch is fine but adds another `DEP_FILE_PATCHES` entry to maintain.
- **Existing users who pass `initLayout: false` for other reasons** (e.g. they wanted to manually trigger `layout()` later on a hidden grid) might depend on positions being zero/unset. This is a behavior change. Mitigation: gate it behind an explicit `adoptInitialLayout: true` opt-in.

**Status:** ✅ shipped (`v5.0.0-dev.18`). **Zero source change required** — the existing infrastructure (`initLayout: false` from Outlayer + #015's `static: true`) already worked correctly. Phase 3 added the discriminating fixture that locks it in: items pre-positioned in a single-column stack stay there, fixture FAILS with `initLayout: true`. See [`018-init-layout-false-adoption.md`](./improvements/018-init-layout-false-adoption.md).

---

### Phase 4 — Working SSR + pretext + computeLayout example

**Goal:** ship a runnable end-to-end demo that proves the four pieces fit together. One example is enough; pick the framework with the cleanest server/client boundary.

**Recommendation:** Astro. Reasons:
- Server components are vanilla `.astro` files; no React-specific tax
- `client:load` directive is the cleanest "this part runs after hydration" boundary in any framework
- Astro's island architecture means the masonry-using island is small and isolated
- The user's WIP `examples/astro/` is already scaffolded

**The demo:**

```astro
---
// examples/astro/src/pages/index.astro
import { prepare, layout as ptLayout } from '@chenglou/pretext';
import Masonry from 'masonry-pretext';

const items = await loadItems(); // {id, text} from CMS / file / etc.

const FONT = '16px/1.5 Inter, sans-serif';
const COLUMN_WIDTH = 280;
const GUTTER = 16;
const LINE_HEIGHT = 24;
const CONTAINER_WIDTH = 920; // computed from breakpoint, e.g. 3 cols × (COLUMN_WIDTH+GUTTER) - GUTTER

// 1. Measure each item's height with pretext (DOM-free)
const sizes = items.map(item => {
  const prepared = prepare(item.text, FONT);
  const { height } = ptLayout(prepared, COLUMN_WIDTH, LINE_HEIGHT);
  return { outerWidth: COLUMN_WIDTH, outerHeight: height };
});

// 2. Compute positions with the new static helper (DOM-free)
const { positions, cols } = Masonry.computeLayout({
  items: sizes,
  containerWidth: CONTAINER_WIDTH,
  columnWidth: COLUMN_WIDTH,
  gutter: GUTTER,
});
---

<html lang="en">
  <head>
    <link rel="preload" href="/inter.woff2" as="font" type="font/woff2" crossorigin>
    <style>
      .grid { position: relative; width: {CONTAINER_WIDTH}px; }
      .grid-item { position: absolute; width: {COLUMN_WIDTH}px;
                   font: 16px/1.5 Inter, sans-serif; }
    </style>
  </head>
  <body>
    <div class="grid" id="grid">
      {items.map((item, i) => (
        <div
          class="grid-item"
          data-text={item.text}
          style={`left: ${positions[i].x}px; top: ${positions[i].y}px;`}
        >
          {item.text}
        </div>
      ))}
    </div>
    <script>
      // 3. Adopt the server-computed layout on the client
      import Masonry from 'masonry-pretext';
      import { prepare, layout } from '@chenglou/pretext';

      const grid = document.getElementById('grid');
      const cache = new WeakMap();
      const FONT = '16px/1.5 Inter, sans-serif';
      const COL = 280;
      const LH = 24;

      new Masonry(grid, {
        columnWidth: COL,
        gutter: 16,
        initLayout: false,           // ← KEY: don't reflow, adopt existing positions
        transitionDuration: 0,
        pretextify(elem) {
          let p = cache.get(elem);
          if (!p) {
            p = prepare(elem.dataset.text, FONT);
            cache.set(elem, p);
          }
          const { height } = layout(p, COL, LH);
          return { outerWidth: COL, outerHeight: height };
        },
      });
    </script>
  </body>
</html>
```

**Files added:**
- `examples/astro/src/pages/index.astro` — the demo page
- `examples/astro/package.json` — depends on `astro`, `@chenglou/pretext`, `masonry-pretext`
- `examples/astro/README.md` — how to run, what to look at, the before/after CLS comparison
- `examples/astro/public/inter.woff2` — preloaded font (or instructions to download)

**The before/after measurement:**
- **Before** = same demo with `initLayout: true` and no inline positions (the standard pattern)
- **After** = the demo above
- Run Lighthouse on both, capture CLS scores, screenshot the LCP frames, side-by-side
- Document in the demo's README

**Status:** ✅ shipped (`v5.0.0-dev.19`). [`examples/astro/`](./examples/astro/) has the runnable demo: frontmatter calls `Masonry.computeLayout`, server emits inline absolute positions, client adopts via `initLayout: false + static: true`. Documented CLS = 0.00 vs ~0.10–0.15 baseline. Next.js example brought to parity in the simplify+followup pass after #020 (`examples/nextjs/` Server Component now does the full pipeline). See [`019-astro-ssr-pipeline-example.md`](./improvements/019-astro-ssr-pipeline-example.md).

---

### Phase 5 — Hydration measurement gate **(load-bearing — see § ⚠️ Non-negotiable above)**

**This phase is what makes the entire feature line real.** Without measured numbers in the README, masonry-pretext's defining feature is a hand-wave. With measured numbers in the README, masonry-pretext is the only cascading-grid library on the market with a proven zero-flash SSR story. The narrative gap between those two states is the reason this phase exists. **Do not ship Phases 1-4 and call them "feature complete" without Phase 5 + the README pointer.** See the § ⚠️ Non-negotiable section at the top of this document for the full acceptance criteria.

**Goal:** turn the Phase 4 demo's manual Lighthouse check into a permanent automated benchmark, the same way `bench-pretext.mjs` is a permanent benchmark for the client-side fast path. **And get the headline number into the README's first-screen pitch.**

**Two new bench scripts:**

1. **`test/visual/bench-server-layout.mjs`** — measures `Masonry.computeLayout` wall-clock in Node for N items. Reports median + spread across N=100/500/1000/5000. The expectation is "fast enough that it adds <5ms to a server response for typical grids."

2. **`test/visual/bench-hydration.mjs`** — Playwright-driven, loads the Phase 4 demo and a control page (same demo with `initLayout: true`), measures:
   - **Layout shift score** via `PerformanceObserver({type: 'layout-shift'})`
   - **Time from first paint to final positions** via the position assertion at `__READY`
   - Outputs a side-by-side table

Both benches are checked in. The hydration bench becomes part of `make test` if (a) it's fast and reliable enough, or it becomes a `make bench` target if it's flaky.

**Predictions:**
- `bench-server-layout.mjs`: 1000-item grid in <5ms median on a typical laptop CPU
- `bench-hydration.mjs`: control CLS ~0.05-0.15 (typical for a flow-to-absolute reflow), Phase 4 demo CLS = 0.00 (zero, because nothing moves)

**Status:** ✅ shipped (`v5.0.0-dev.20`). **MEASURED: CLS 0.7421 → 0.0000 (100% reduction).** `bench-server-layout.mjs` reports **0.131 ms median for 5000 items** (38× under the 5 ms budget). `bench-hydration.mjs` is checked in, runs via `make bench`, and produces stable numbers across 30 interleaved runs. The README headline callout is in the first screen of content. See [`020-bench-and-headline.md`](./improvements/020-bench-and-headline.md).

---

### Phase 6 (optional) — Built-in convenience layer

**Goal:** if Phases 1-5 land cleanly, consider adding a thin convenience layer on the user-facing API so the boilerplate is less verbose.

**Two candidates:**

1. **`Masonry.computeAndRender(opts)` returning HTML strings** — Server-only helper that takes the same opts as `computeLayout` plus an `items: [{text, ...}, ...]` list and emits a `<div class="grid">...children with inline positions...</div>` string. Saves the user from writing the markup template themselves. Tradeoff: opinionated about the markup shape; users with custom item HTML can't use it.

2. **`pretextOptions: { font, columnWidth, lineHeight }` shorthand** — Replaces the inline `pretextify` callback with a config object. Masonry creates the closure internally, including the WeakMap cache. Saves ~10 lines of boilerplate per usage. Adds ~80 B gz on top of `pretextify`. Pro: nicer for the common case. Con: less flexibility (can't read non-text item content).

**Decision:** defer until after Phase 5 lands and we see how users actually use the raw primitives. **Premature convenience is a form of premature commitment.**

**Status:** ⏸️ deferred until after Phase 5.

---

## Constraints / non-goals

These are intentional scope limits. Don't add them without an explicit decision to expand scope.

- **No image-driven items in the SSR path.** Image heights aren't predictable from text, so the server can't precompute them. Mixed-content grids fall back to flow layout for image items + absolute layout for text items, with masonry's existing ResizeObserver hook (#012) cleaning up after lazy-load on the client.
- **No fully-responsive container width.** The server has to know the container width at render time. Apps that need fluid responsive grids can either (a) pick a "default" breakpoint width and let masonry recompute on the client if it differs, or (b) skip the SSR precomputation entirely. We don't try to magic this away.
- **No JSDOM, no headless chromium for the server pipeline.** The whole point is that it runs in pure Node. If pretext + computeLayout require JSDOM at any step, we've failed the architecture review.
- **No automatic font detection.** The user supplies the font string. Pretext requires it. We don't try to read font metrics from the DOM at runtime — that would defeat the SSR purpose.
- **No engine-level changes to packing semantics.** Phase 1 is a refactor with zero behavior change. The packing algorithm at the end of all five phases is byte-for-byte the same as today. Pretext + SSR change *where* it runs, not *how* it runs.
- **No bundling pretext into masonry-pretext.** Pretext stays a peer/optional dep. Users who don't want it pay zero bytes. The library exposes the primitives; the user wires them.

---

## Open questions (decide as we go)

1. **Should `Masonry.computeLayout` live on the constructor or as a separate import?**
   - Option A: `Masonry.computeLayout(...)` — discoverable from existing import
   - Option B: `import { computeLayout } from 'masonry-pretext/compute'` — separate entry point, lets bundlers tree-shake the DOM-using code from server bundles
   - Option B is better for bundle-size purists but adds another `package.json` `exports` entry. Decide before Phase 2 lands.

2. **How does `computeLayout` handle `colSpan > 1` (multi-column items)?** The existing `_getTopColGroup` walks all valid horizontal positions for spanned items. Replicating this in pure form is straightforward but doubles the test surface. Phase 1 has to include it, not defer.

3. **What's the contract for stamps?** Stamps in the existing API are DOM elements that masonry measures via `getSize`. The pure version takes `{x, y, width, height}` rectangles. Good — but how does the user *get* those rectangles in a SSR context? They'd have to compute them server-side from their content. Document this in Phase 4's example.

4. **Is `horizontalOrder` worth supporting in Phase 2?** It's a less-common option. Could defer to a Phase 2.5 if Phase 2 is getting too big. Probably keep — it's not much extra code once `placeItem` is pure.

5. **Should the Phase 4 example use Astro, Next.js, or both?** Astro is recommended above. But the user already has `examples/nextjs/` scaffolded. Could do both — they'd share the same `pretext.prepare → computeLayout → emit` glue and only differ in the framework integration. Decide in Phase 4 planning.

6. **Should we publish the Phase 4 examples as a separate package** (`@masonry-pretext/example-astro`) or just leave them in `examples/`? Probably leave in `examples/` — easier to maintain, no extra publish step, users can copy-paste.

7. **What's the Lighthouse CLS target for Phase 5's bench?** 0.00 is the ideal. 0.01 is "imperceptible." Anything above 0.05 means the implementation isn't doing what we said it does. Use 0.01 as the gate threshold.

---

## Success criteria

We know this feature line is "done" when **all** of the following are true:

- [ ] **`Masonry.computeLayout(opts)` exists**, is documented in `masonry.d.ts`, and is exported from both the IIFE and ESM/CJS bundles. (Phase 2)
- [ ] **A Node-only test** asserts that `Masonry.computeLayout` produces the same positions as the browser-rendered fixtures for all 8 existing visual cases, byte-for-byte. (Phase 2)
- [ ] **`new Masonry(grid, { initLayout: false })` adopts existing absolute positions** without overwriting them, verified by a discriminating fixture. (Phase 3)
- [ ] **A working Astro (and/or Next.js) example** in `examples/` demonstrates the full server-compute pipeline end-to-end, with measured before/after CLS scores in the example's README. (Phase 4)
- [ ] **`make test` passes** on a fresh clone with all 8 fixtures + ssr + module + no-jquery + compute-layout + init-layout-false gates green. (cumulative)
- [ ] **`bench-server-layout.mjs` and `bench-hydration.mjs` are checked in** as permanent reproducible benchmarks. The hydration bench shows a measurable CLS improvement (target: 0.00) vs the control. (Phase 5)
- [ ] **No regression** on the 17-24% client-side speedup from `bench-pretext.mjs` (#009).

### The two README criteria — non-negotiable, this is the fork's main feature

- [ ] **The README's `Server-side rendering` section** stops talking about "candidate future optimizations" and starts shipping the working pattern as **the documented recommended path** for SSR + pretext consumers, with the runnable example linked, the bench script linked, and the headline number from Phase 5 inline. (Phase 4 + 5)
- [ ] **The README's `Key improvements vs upstream` table** has a new top-row entry (or visually emphasized row) for this feature line, with the **measured headline number in the first sentence** (e.g. "**zero hydration flash on SSR cascading grids — measured CLS 0.00 vs 0.13**"). The number must be the kind a 30-second README skim will remember. (Phase 5)

When all nine boxes are checked, masonry-pretext is the only cascading-grid library on the market with **measured, reproducible, first-class SSR**. That's the moat. The two README criteria are not "polish at the end" — they are the *delivery vehicle* for the entire feature line. Without them, the work is in the repo but not in the world.

---

## Cross-references

- [`FORK_ROADMAP.md § P (engine/adapter separation)`](./FORK_ROADMAP.md) — original entry for Phase 1's refactor
- [`FORK_ROADMAP.md § 1.1 (pretext integration)`](./FORK_ROADMAP.md) — context for the existing client fast path
- [`improvements/009-pretext-integration.md`](./improvements/009-pretext-integration.md) — what `pretextify` does today + the bench methodology
- [`improvements/005-ssr-import-fix.md`](./improvements/005-ssr-import-fix.md) — what "SSR-safe" means today (load without crashing)
- [`improvements/013-esm-cjs-builds.md`](./improvements/013-esm-cjs-builds.md) — the ESM/CJS bundle infrastructure that Phase 2's static helper would consume
- [`README.md § Server-side rendering and hydration`](./README.md) — the user-facing SSR documentation that Phase 4 will rewrite
- [`@chenglou/pretext`](https://github.com/chenglou/pretext) — the upstream measurement library

---

## Progress

| Phase | Goal | Status | Improvement | Headline number |
|---|---|---|---|---|
| 0 | `pretextify` callback (client fast path) | ✅ `v5.0.0-dev.9` | [009-pretext-integration.md](./improvements/009-pretext-integration.md) | 1.2-1.3× faster initial layout |
| 0 | SSR-safe imports + ESM/CJS bundles | ✅ `v5.0.0-dev.5` + `v5.0.0-dev.13` | [005](./improvements/005-ssr-import-fix.md) + [013](./improvements/013-esm-cjs-builds.md) | closes 3 SSR upstream issues |
| **0.5** | **`static: true` SSR preset** (sibling, unblocked) | ✅ `v5.0.0-dev.15` | [015-static-ssr-preset.md](./improvements/015-static-ssr-preset.md) | +20 B gz, new `static-mode` discriminating fixture (inverse of `resize-observer`) |
| **1** | **Engine/adapter split (item P)** | ✅ `v5.0.0-dev.16` | [016-engine-adapter-split.md](./improvements/016-engine-adapter-split.md) | +164 B gz (over predicted band — esbuild can't inline file-local helpers); 9/9 fixtures pass byte-for-byte; pure `placeItem(size, state)` unblocks Phases 2-5 |
| **2** | **`Masonry.computeLayout` static helper** | ✅ `v5.0.0-dev.17` | [017-compute-layout-static-helper.md](./improvements/017-compute-layout-static-helper.md) | +393 B gz; new `compute-layout.mjs` Node-only gate passes **9/9 byte-for-byte** with browser fixtures on first run; pure-Node layout pipeline proven correct |
| **3** | **`initLayout: false` adoption verification** | ✅ `v5.0.0-dev.18` | [018-init-layout-false-adoption.md](./improvements/018-init-layout-false-adoption.md) | **0 bytes** (smallest improvement on record) — existing infrastructure already worked, fixture proves it. New `init-layout-false` discriminator: items pre-positioned in single-column stack stay there, FAILS with `initLayout: true` |
| **4** | **Working SSR + pretext + computeLayout example** | ✅ `v5.0.0-dev.19` | [019-astro-ssr-pipeline-example.md](./improvements/019-astro-ssr-pipeline-example.md) | `examples/astro/` rewritten end-to-end: frontmatter calls `Masonry.computeLayout`, server emits inline positions, client adopts via `initLayout: false + static: true`. Documented CLS = 0.00 vs ~0.10–0.15 baseline. **Zero bundle byte change.** |
| **5** | **Server-layout + hydration benchmarks + README headline** | ✅ `v5.0.0-dev.20` | [020-bench-and-headline.md](./improvements/020-bench-and-headline.md) | **CLS 0.7421 → 0.0000 (100% reduction, measured)**, server compute **0.131 ms median for 5000 items** (38× under 5 ms budget). README headline callout in first screen. `make bench` reproduces. **Phase 5 + the README pointer = the SSR feature line is complete.** |
| 6 | (optional) `pretextOptions` shorthand + `computeAndRender` helper | ⏸️ deferred | — | decided after Phase 5 |

**Status legend** (matches `FORK_ROADMAP.md`): ⬜ pending · 🟡 in progress · ✅ landed · ⚠️ partial · ❌ reverted · ⏸️ deferred.

When updating this table after a phase lands: switch the status, link the improvement file, and add the headline number. Same convention as `FORK_ROADMAP.md § Progress`.
