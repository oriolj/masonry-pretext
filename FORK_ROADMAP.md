# Fork Roadmap — masonry-pretext

This is a fork of [masonry-layout](https://github.com/desandro/masonry) (last upstream release: v4.2.2, 2018) intended to **modernize the build, shrink the bundle, and reduce layout cost**, primarily by integrating [chenglou/pretext](https://github.com/chenglou/pretext) so text-driven bricks can be measured without DOM reflow.

## Guiding rule

> Every change must produce a **measurable** improvement in **speed**, **bundle size**, or **UX**. No cosmetic refactors, no "modernization for its own sake," no abstractions without a benchmark or before/after number to point at.

Each item below states the expected win and how to verify it. Items without a clear measurable benefit are explicitly listed in [§ Rejected](#rejected-no-measurable-benefit).

---

## 1. Performance

The dominant cost in Masonry on real pages is **layout thrashing** during `_getItemLayoutPosition`: for every item, `item.getSize()` reads `offsetWidth/offsetHeight` and computed styles, which forces the browser to flush pending style + layout. With N items this is O(N) forced reflows. Everything in this section attacks that.

### 1.1 Pretext integration for text bricks  *(headline feature of the fork)*

**What.** When an item opts in (e.g. `<div data-masonry-pretext='{"text":"…","font":"16px/1.4 Inter","maxWidth":280}'>`), compute its height with `pretext.layout()` instead of measuring the DOM. Pretext does the line-breaking arithmetically against cached font metrics — no `getBoundingClientRect`, no reflow.

**Why measurable.**
- Eliminates one forced reflow *per opted-in item*. On a 500-card text grid that is 500 reflows → 0.
- Pretext's `prepare()` is one-time per font; subsequent layouts on resize are pure arithmetic.

**How to verify.** Benchmark `layout()` on a 500-item text grid, Chrome Performance panel, before/after. Track:
- Total scripting time during initial layout
- Number of "Recalculate Style" / "Layout" events
- Time-to-first-paint of the grid

**Open design questions.**
- API surface: per-item attribute vs. a `pretextify(item) => {width,height}` option callback. Probably the callback — keeps Masonry agnostic about how heights are derived.
- Mixed grids (some text, some images). The fast path is per-item: if the user provides a synchronous size, skip `getSize`; otherwise fall back to the current path. No "all or nothing."
- Font loading. Pretext needs the font ready; integrate with `document.fonts.ready` before first layout.

### 1.2 Batch read / batch write (independent of pretext)

**What.** Today the layout loop interleaves reads (`item.getSize()`) and writes (style mutations via Outlayer's positioning). Restructure to: (a) read every item's size into a flat array, (b) run the column-packing arithmetic, (c) apply all positions in one write phase.

**Why measurable.** Even without pretext, this collapses N forced reflows into 1. This is the single biggest win available without changing the public API or asking users to opt in.

**How to verify.** Same benchmark as 1.1. Should show a step-function drop in "Layout" events on initial layout and on `layout()` after content changes.

**Risk.** Outlayer's `Item.getSize()` and position-application are entangled. May require either patching Outlayer or vendoring a slimmed core (see § 2.4).

### 1.3 `transform: translate3d` instead of `top/left`

**What.** Outlayer currently writes `left`/`top` (or `right`/`bottom`) in pixels per item. Switch to `transform: translate3d(x, y, 0)`.

**Why measurable.** `top/left` mutations invalidate layout. `transform` only invalidates the compositor — no layout, no paint of siblings. Big win on transitions and repeated `layout()` calls. Verify with Chrome's Layers panel and the "Layout Shift Regions" overlay.

**Risk.** Subpixel rendering differences; transitions and `originLeft/originTop` semantics need to be preserved. Tests in `test/unit/basic-layout.js` assert exact `left`/`top`/`right`/`bottom` values — they would need to read the transform matrix instead.

### 1.4 `ResizeObserver` instead of `window.resize`

**What.** Replace the window-resize listener with a `ResizeObserver` on the container.

**Why measurable.** Fires only when the container's content-box actually changes. Avoids wasted relayouts on resize events that don't affect the grid (e.g. devtools panel toggle, scrollbar appearance). Also catches container width changes triggered by parent layout, which the current code misses entirely.

**How to verify.** Count `layout()` invocations during a synthetic resize sequence; verify no spurious calls.

### 1.5 CSS containment + `content-visibility`

**What.** Default the container to `contain: layout style` and offer an option to set `content-visibility: auto` on items.

**Why measurable.** `contain: layout` tells the browser the container's layout cannot affect the rest of the page → smaller relayout scope. `content-visibility: auto` skips rendering offscreen items entirely. Both are pure CSS, zero JS cost, and measurable in the Performance panel.

**Risk.** `content-visibility: auto` changes intrinsic sizing and can interact badly with Masonry's own measurement. Needs to be opt-in until validated.

### 1.6 `requestAnimationFrame` coalescing

**What.** Multiple `layout()` / `appended()` / `prepended()` calls in the same tick should collapse into a single rAF-scheduled layout pass.

**Why measurable.** Common pattern: appending 20 items in a loop currently runs the full layout 20 times. Coalescing → 1.

**How to verify.** Microbenchmark: append 100 items in a loop, count layout passes before/after.

### 1.7 Speculative — column packing in a worker

Flagging but **not committing**: for huge grids (10k+ items) with multi-column-span items, `_getTopColGroup` is O(cols) per item. A worker could pre-compute. Almost certainly overkill — the DOM measurement cost dominates the arithmetic by orders of magnitude. Revisit only if profiling proves the packing loop is the bottleneck.

---

## 2. Bundle size & build modernization

### 2.1 Replace Gulp 3 + RequireJS with esbuild

**What.** Delete `gulpfile.js` and the entire gulp toolchain. Replace with a ~30-line esbuild script (or `tsup`) that produces ESM, CJS, and IIFE outputs.

**Why measurable.**
- `package.json` devDeps drop from ~12 to ~2.
- `npm install` time drops by an order of magnitude (gulp 3 pulls hundreds of transitive deps, many with security advisories that won't be patched).
- Build time: gulp 3 + requirejs-optimize takes seconds; esbuild takes milliseconds.
- Gulp 3 cannot run on Node ≥ 16 without legacy openssl flags. The build is *currently broken* on modern Node.

**How to verify.** `du -sh node_modules` before/after; `time npm install`; `time npm run build`.

### 2.2 Ship a real ESM build with `exports` field

**What.** Add to `package.json`:
```json
"exports": {
  ".": {
    "import": "./dist/masonry.mjs",
    "require": "./dist/masonry.cjs",
    "default": "./dist/masonry.js"
  }
},
"sideEffects": false
```

**Why measurable.** Modern bundlers (Vite, Rollup, esbuild, webpack 5) tree-shake ESM imports. Consumers who only use `Masonry` and not `jquery-bridget` get a smaller bundle. `sideEffects: false` unlocks dead-code elimination for Masonry's optional code paths (horizontal-order, fitWidth, RTL).

**How to verify.** Build a sample Vite app importing Masonry, compare `dist/assets/*.js` size before/after.

### 2.3 Drop AMD branch from the UMD wrapper

**What.** The top of `masonry.js` has three module-system branches (AMD, CommonJS, global). AMD is effectively dead in 2026 — RequireJS hasn't seen meaningful work in years. Drop the AMD branch; keep CJS and global.

**Why measurable.** Smaller wrapper, simpler code, removes the dependency on `gulp-requirejs-optimize` which is the only reason gulp is still in the build. Also unblocks § 2.1.

**Risk.** Anyone still consuming Masonry via RequireJS would break. Mitigation: bump major version (v5), document in migration notes.

### 2.4 Vendor a slimmed Outlayer core

**What.** Outlayer is a general-purpose layout-engine base class — it carries an event system, an item lifecycle, transition logic, jquery-bridget integration, fizzy-ui-utils, and ev-emitter. Masonry uses maybe 30% of it. Vendor only what's needed and inline it.

**Why measurable.** `dist/masonry.pkgd.min.js` is currently ~24 KB. Realistic target after slimming: under 10 KB minified, under 4 KB gzipped. Verify with `gzip-size` on the output.

**Risk.** This is the largest change in scope. Touches Item lifecycle, transitions, the public API around `addItems`/`stamp`/`unstamp`. Should be the *last* item done, after benchmarks prove the perf wins from § 1 land. Probably warrants a v5 major.

### 2.5 Remove jQuery entirely

**What.** Drop every trace of jQuery from the fork:

1. **Drop `jquery-bridget` from `devDependencies`** so `npm install masonry-pretext` no longer pulls jQuery into the dep tree (jquery-bridget declares `jquery` as a hard runtime dep, which transitively installs all of jQuery on every consumer's disk even though we never use it at runtime).
2. **Stop bundling `jquery-bridget`** into `dist/masonry.pkgd.{js,min.js}`. The bridget shim is the only reason `$('.grid').masonry()` syntax works for jQuery users; removing it means **anyone using the jQuery selector syntax must migrate to `new Masonry('.grid', { … })`** (the documented vanilla API anyway).
3. **Strip the dead `if (jQuery) { … }` branches** in `outlayer/outlayer.js` and `fizzy-ui-utils/utils.js`. With jquery-bridget gone there's no path that would ever set `window.jQuery` from inside the bundle, and consumers who happen to have jQuery loaded on the page get nothing from these branches. Replace each `var jQuery = window.jQuery;` with `var jQuery = false;` so esbuild's minifier DCE-eliminates the unreachable blocks.
4. **Delete the `jqueryStubPlugin`** from `scripts/build.mjs` — once nothing in the bundle does `require('jquery')`, the stub has nothing to intercept.

**Why measurable.** Removes ~1,200-1,500 B raw / ~400-600 B gzipped of jquery-bridget code, plus another ~200-400 B raw / ~80-150 B gz of dead branches in outlayer + fizzy-ui-utils. Cumulative target: **−1,400 to −1,900 B raw / −480 to −750 B gz** on `dist/masonry.pkgd.min.js`. Vs upstream-frozen v4.2.2 gz, this should put the fork **below** for the first time (currently +262 B over upstream gz; predicted to land at roughly −300 to −500 B under upstream).

**What this is *not*.** This is **not** the "ship two builds (vanilla + jquery shim)" approach the original roadmap described. The maintainer's call is to drop jQuery support entirely — anyone using the bridget shim syntax has to migrate. The breaking change is intentional and documented in the migration notes for the corresponding `5.0.0-dev.N` tag.

**Risk.** This is a **breaking change** for any consumer using `$('.grid').masonry()` syntax or `.masonry('reloadItems')` jQuery method calls. They must migrate to `new Masonry('.grid', { … })` and instance method calls. The vanilla API has always been the documented primary path, so the migration is small. Surface it loudly in the release notes.

### 2.6 Delete `bower.json` and `composer.json`

**What.** Bower has been deprecated since 2017. Composer is for PHP — no reason a JS layout library ships a `composer.json`. Both are noise that confuses package managers and dependency scanners.

**Why measurable.** -2 files, -1 package registry entry to maintain. Verifiable: `ls`.

### 2.7 TypeScript type definitions

**What.** Ship `dist/masonry.d.ts` (handwritten — the surface area is small enough). No need to convert source to TS.

**Why measurable.** DX win for the ~80% of new JS projects that use TS. Zero runtime cost. Verify by importing into a TS sandbox and confirming options autocomplete.

---

## 3. UX & developer experience

### 3.1 `MutationObserver`-driven auto-layout

**What.** When using `data-masonry`, automatically re-layout on child add/remove via `MutationObserver`. Currently the user must call `.masonry('reloadItems')` manually.

**Why measurable.** Removes a footgun (forgotten reload-after-append is the #1 source of "masonry is broken" issues in the upstream tracker). Net code in user-land goes down. Hard to put a number on, but worth doing.

### 3.2 Modern test runner

**What.** Replace QUnit-in-browser with Vitest + happy-dom (or Playwright Component Testing if real layout is needed). Wire up `npm test`. Add CI.

**Why measurable.** Currently `npm test` does nothing — the script just points at `test/index.html`, which has to be opened manually. CI cannot run the suite. Any change to `masonry.js` is currently unverified in PR review. This is a correctness risk, not a perf win, but it gates everything else: the perf work in § 1 *needs* a regression suite that runs on every commit.

### 3.3 Watch item — native CSS `grid-template-rows: masonry`

The CSS WG has a draft for native masonry layout (`grid-template-rows: masonry`). Firefox has shipped it behind a flag; Chrome/WebKit are debating syntax. **When it ships interoperably, this library is obsolete for the common case.** Track the spec; consider a v6 that auto-detects native support and degrades the JS path to a polyfill role.

Not actionable now — flagged so we don't over-invest in the JS path.

---

## Suggested order of operations

1. **§ 3.2** — modern test runner + CI. Nothing else is safe to change without it.
2. **§ 2.1** — esbuild build. Unblocks every other change because the current gulp build is borderline broken.
3. **§ 2.6** — delete bower.json / composer.json. Free win.
4. **§ 1.2** — batch read/write. Largest perf win without API changes; benchmark before/after.
5. **§ 1.1** — pretext integration behind an opt-in callback. Headline feature.
6. **§ 1.3** — `transform` positioning. Update tests to read transform matrix.
7. **§ 1.4, § 1.5, § 1.6** — ResizeObserver, containment, rAF coalescing. Each independently small.
8. **§ 2.2, § 2.3, § 2.5, § 2.7** — ESM exports, drop AMD, split jquery build, types.
9. **§ 2.4** — vendor slimmed Outlayer. Last because it's the riskiest and benefits compound on top of everything above.

Cut a **v5.0.0** at the end of step 8. Save § 2.4 + § 1.7 for v5.1+.

---

## Rejected (no measurable benefit)

These are explicitly *not* on the roadmap because they fail the guiding rule:

- **Convert source to ES classes / TypeScript.** Pure cosmetic; no size, perf, or DX delta versus `Outlayer.create('masonry')` + a `.d.ts` file.
- **Plugin system / hook API.** Speculative future-proofing. Add hooks when a second consumer needs them, not before.
- **Rename methods to camelCase / drop legacy options.** `isFitWidth` → `fitWidth` already works via `compatOptions`. Removing the alias breaks consumers for zero benefit.
- **Refactor `_getTopColGroup` for "readability."** The current implementation is already O(cols × groupCount). Any rewrite needs a benchmark proving it's faster — readability alone is not enough.
- **Switch from `var` to `let`/`const` everywhere.** No runtime benefit. Minified output is identical. Skip unless touching the line for another reason.
- **Add a logo / new docs site / rebrand.** Out of scope for a perf-focused fork.

---

# Deep research findings

This section was added after a thorough audit of the upstream repository and the current packaged bundle. The goal: figure out exactly what is bundled, what is dead in 2026, what modern browser APIs make obsolete, and which upstream pain points the fork should explicitly target.

## Upstream state (desandro/masonry)

- **16,700 stars, 85 open issues, 0 merged PRs since 2017.**
- **Last meaningful commit:** `3b0883c` on **2018-07-04** ("build v4.2.2; use float values for position"). Everything since is dependency bumps and metadata.
- **Open SSR fix PRs** (`#1194`, `#1121`) have sat for 1–2 years with no review. Maintainer is effectively absent.
- The library is **functionally abandoned but still widely used** — exactly the situation where a fork that fixes the long-standing issues has high impact for relatively little code.

The 80+ open issues cluster into a small number of root causes that this fork can attack directly. The most-requested and most-recurring:

| Upstream issue | What it's about | Root cause | Fork fix |
|---|---|---|---|
| **#1006** (53 reactions) | Percentage width + gutter leaves trailing margin | `measureColumns` rounds cols based on px columnWidth + px gutter; doesn't reverse-derive from `%` widths | New § P.1 below |
| **#1182** | Custom font breaks layout on first paint | Layout runs before fonts swap; item heights change after | `document.fonts.ready` gating + Pretext |
| **#1201** | Vite/Rollup build fails (`Could not resolve "./item" from "./item?commonjs-external"`) | UMD wrapper + AMD branch confuses Rollup's commonjs plugin | Pure ESM build with `exports` field |
| **#1194 / #1121** | SSR (`window` undefined) — two open PRs ignored | Outlayer/Item access `document.documentElement.style` *at module load* for vendor-prefix detection | Delete vendor-prefix detection (§ L.2 below) — module load becomes side-effect free |
| **#811** (10 reactions) | Want option to NOT always pick shortest column | Hardcoded `Math.min` strategy | Pluggable column-pick strategy |
| **#1185 / #1158 / #1152 / #1108 / #1165 / #1189 / #1199 / #1147** (8+ duplicates) | **Image overlap on lazy load** — *the dominant complaint* | Layout runs once, then images load and resize, but Masonry doesn't know to relayout | Per-item `ResizeObserver` auto-relayout (§ P.4 below) |
| **#1186** | Safari perf when reinitializing | Forced reflows in `_getItemLayoutPosition` | Batch read/write (existing § 1.2) |
| **#783 / #928** | Browser zoom breaks layout | Subpixel rounding in `getSize` box-sizing detection | Trust modern getBoundingClientRect (§ L.3 below) |
| **#1057** | `right: 0%` quirk on Firefox only | `percentPosition` math | Drop, replace with transform positioning (§ 1.3) |

> **Strategic point:** every fork feature should be tagged in its commit/PR with the upstream issue number it closes. Even though we don't push to upstream, marking the lineage makes the value of each change obvious to anyone evaluating the fork.

## Bundle inventory — what is actually shipping in `dist/masonry.pkgd.min.js`

Current numbers:

| File | Bytes | Gzipped |
|---|---:|---:|
| `masonry.js` (source, masonry-only) | 7,473 | 2,468 |
| `dist/masonry.pkgd.min.js` (everything bundled) | 24,103 | 7,393 |

The packaged file is **9.7×** the source by minified size, **3×** by gzipped. Almost all of that is dependency code that is either obsolete in modern browsers or has a smaller native equivalent.

Module-by-module breakdown of `dist/masonry.pkgd.js`:

| Module | Approx LOC | Purpose | Status in 2026 |
|---|---:|---|---|
| **jquery-bridget v2.0.1** | 150 | jQuery widget shim — `$.fn.masonry()` | Useful only if user has jQuery. Most new projects don't. **Split into separate optional file.** |
| **EvEmitter v1.1.0** | 110 | Tiny custom event system (`on`, `off`, `once`, `emitEvent`) | Replaceable with native `EventTarget`. **Delete entirely.** |
| **getSize v2.0.3** | 170 | Read element width/height + every padding/margin/border into a flat object | Still useful but can be slimmed by ~70% — see § L.3 |
| **matchesSelector v2.0.2** | 50 | Polyfill for `Element.matches`, walks `webkit`/`moz`/`ms`/`o` prefixes | `Element.matches` shipped unprefixed in **Chrome 34, Firefox 34, Safari 7.1 (2014)**. **Pure dead code.** Delete. |
| **fizzy-ui-utils v2.0.7** | 250 | Grab-bag: `extend`, `makeArray`, `removeFrom`, `getParent`, `handleEvent`, `filterFindElements`, `debounceMethod`, `docReady`, `toDashed`, `htmlInit` | Almost every function has a 1-line native replacement. See § L.4 |
| **Outlayer/Item** | 550 | Item lifecycle: positioning, transitions, hide/reveal, stagger, vendor-prefix detection | ~25% of this file is vendor-prefix dead code; transitions can move to WAAPI. See § L.2 + § P.5 |
| **Outlayer** | 750 | Layout engine base: items, stamps, resize binding, events, jQuery dispatch | Half is replaceable by `ResizeObserver` + `MutationObserver` + native events |
| **Masonry** | 250 | The actual cascading-grid math (`measureColumns`, `_getItemLayoutPosition`, `_getTopColGroup`) | This is the only part worth keeping verbatim |

**Total bundled LOC:** ~2,500. Realistic target after the cuts in this section: **<800 LOC**.

## L. Legacy code that can simply be deleted

These are not refactors. They are deletions that work because the browser feature they polyfill is now baseline-everywhere.

### L.1 — `matchesSelector` polyfill (~50 LOC)

The entire `desandro-matches-selector` module exists to walk `webkitMatchesSelector`, `mozMatchesSelector`, `msMatchesSelector`, `oMatchesSelector`. Every browser shipped unprefixed `Element.matches` in 2014. Replace every call site with `elem.matches(selector)` and delete the dependency.

**Win:** −50 LOC, −1 npm dep. The whole `fizzy-ui-utils → desandro-matches-selector` chain collapses.

### L.2 — Vendor-prefix transition/transform detection (~80 LOC across Outlayer/Item)

```js
// dist/masonry.pkgd.js:816–826
var docElemStyle = document.documentElement.style;
var transitionProperty = typeof docElemStyle.transition == 'string' ?
  'transition' : 'WebkitTransition';
var transformProperty = typeof docElemStyle.transform == 'string' ?
  'transform' : 'WebkitTransform';
var transitionEndEvent = {
  WebkitTransition: 'webkitTransitionEnd',
  transition: 'transitionend'
}[ transitionProperty ];
var vendorProperties = { transform: ..., transition: ..., transitionDuration: ..., ... };
var dashedVendorProperties = { '-webkit-transform': 'transform' };
proto.onwebkitTransitionEnd = function( event ) { this.ontransitionend( event ); };
proto.onotransitionend = function( event ) { this.ontransitionend( event ); };
```

`transition` and `transform` shipped unprefixed in Chrome 26 (2013), Firefox 16 (2012), Safari 9 (2015), and never had a prefix in Edge. None of this code does anything useful in 2026.

**Why this is high-value:** the very first line — `document.documentElement.style` — is **the reason Masonry crashes during SSR** (`window`/`document` undefined at module load). Deleting this block fixes upstream issues `#1194` and `#1121` *for free* as a side effect of removing dead code.

**Win:** −80 LOC, −1 module-load DOM access, **closes #1194 + #1121**.

### L.3 — `getSize` box-sizing detection setup (~30 LOC)

```js
// dist/masonry.pkgd.js:361–398
var isSetup = false;
var isBoxSizeOuter;
function setup() {
  if ( isSetup ) return;
  isSetup = true;
  // Chrome & Safari measure the outer-width on style.width on border-box elems
  // IE11 & Firefox<29 measures the inner-width
  var div = document.createElement('div');
  div.style.width = '200px';
  div.style.padding = '1px 2px 3px 4px';
  // ... appendChild → measure → removeChild
}
```

This detects an **IE11 / Firefox <29** quirk by creating, mounting, measuring, and removing a probe div on the very first `getSize()` call. Firefox 29 shipped in 2014. IE11 is dead.

**Side effect:** the probe `appendChild` + measurement + `removeChild` triggers a forced reflow on first call, which always happens during initial Masonry layout. Deleting it removes **one synchronous reflow at startup** in addition to ~30 LOC.

**Win:** −30 LOC, −1 forced reflow at init.

### L.4 — `fizzy-ui-utils` reductions

Inline most of it and delete the rest:

| Util | Replacement | Savings |
|---|---|---|
| `utils.extend(a, b)` | `Object.assign(a, b)` | — |
| `utils.makeArray(obj)` | `Array.from(obj)` (handles single elem with `[obj]` fallback) | — |
| `utils.removeFrom(arr, x)` | `arr.splice(arr.indexOf(x), 1)` inline | — |
| `utils.getQueryElement(s)` | `typeof s === 'string' ? document.querySelector(s) : s` inline | — |
| `utils.handleEvent` | Native `handleEvent` is a built-in `EventListener` interface — pass `this` to `addEventListener` and the browser calls `this.handleEvent(event)` automatically. The util exists only because IE8 didn't honor it. | Replaceable |
| `utils.docReady(cb)` | `document.readyState !== 'loading' ? cb() : document.addEventListener('DOMContentLoaded', cb)` | Inline |
| `utils.debounceMethod(class, method, 100)` | replaced by rAF coalescing — **not** a like-for-like swap; see § P.6 | Better than equivalent |
| `utils.filterFindElements(elems, selector)` | `Array.from(elems).flatMap(el => el.matches(selector) ? [el, ...el.querySelectorAll(selector)] : [...el.querySelectorAll(selector)])` | Inline |

**Win:** delete the entire `fizzy-ui-utils` dependency, ~250 LOC → ~30 LOC inlined where used.

### L.5 — Force-reflow hack inside `transition()` (~3 LOC, hot path)

```js
// dist/masonry.pkgd.js:1074–1077
if ( args.from ) {
  this.css( args.from );
  // force redraw. http://blog.alexmaccaw.com/css-transitions
  var h = this.element.offsetHeight;
  h = null;
}
```

Reading `offsetHeight` is the canonical way to flush styles before a transition starts. **It also causes a forced synchronous reflow on every transition** — which means every call to `hide()`, `reveal()`, or `_transitionTo()` on any item flushes layout.

The Web Animations API (`Element.animate()`) handles the start-state implicitly via the keyframes array — no flush hack needed. See § P.5.

**Win:** −1 forced reflow *per item* on hide/reveal/move animations.

### L.6 — `setTimeout(0)` wrapper around `docReady`

```js
// dist/masonry.pkgd.js:705–710 (in fizzy-ui-utils)
if ( readyState == 'complete' || readyState == 'interactive' ) {
  setTimeout( callback );  // "do async to allow for other scripts to run. metafizzy/flickity#441"
}
```

The 0ms `setTimeout` is a workaround for an ordering bug in **Flickity** (a different library), not Masonry. `queueMicrotask(callback)` is a more precise primitive and has no minimum delay.

**Win:** faster init by ~4ms (the minimum nested-setTimeout clamp).

## P. New browser APIs that replace bundled code with measurable gains

### P.1 — `ResizeObserver` everywhere — **the single biggest unlock**

`ResizeObserver` (Chrome 64 / Firefox 69 / Safari 13.1, all 2018–2020) lets you observe element size changes synchronously after layout, without polling and without forcing a reflow. It eliminates most of what Outlayer's resize handling does today, **and it solves the lazy-load image overlap problem that dominates the upstream issue tracker**.

Three uses:

**P.1a — Container observer replaces window resize listener**

Today:
```js
// dist/masonry.pkgd.js:1947–1985
window.addEventListener( 'resize', this );      // global event
utils.debounceMethod( Outlayer, 'onresize', 100 );  // 100ms setTimeout
proto.needsResizeLayout = function() {
  var size = getSize( this.element );           // forced reflow per resize
  return ... size.innerWidth !== this.size.innerWidth;
};
```

After:
```js
this._ro = new ResizeObserver(entries => {
  const inlineSize = entries[0].contentBoxSize[0].inlineSize;
  if (inlineSize !== this._lastInlineSize) {
    this._lastInlineSize = inlineSize;
    this._scheduleLayout();
  }
});
this._ro.observe(this.element);
```

Wins:
- No more 100ms debounce delay — `ResizeObserver` only fires after layout settles, no debounce needed.
- Catches container width changes from parent layout, not just window resize. Closes a class of bugs where `flex`/`grid` parents resize the masonry container without firing a window event.
- No forced reflow in the size check — `ResizeObserver` provides the new size in the entry.

**P.1b — Per-item observer auto-fixes lazy-loaded images**

This is the headline UX fix for the fork. Today, if an item contains an `<img>` without explicit dimensions, Masonry measures it at height 0 (or placeholder height), positions everything, then the image loads, the item grows, and **everything overlaps**. The user has to either use `imagesLoaded` (a separate library) or call `masonry()` again manually.

With `ResizeObserver`:
```js
this._itemRO = new ResizeObserver(entries => {
  for (const entry of entries) {
    const item = this._itemForElement(entry.target);
    if (item && item.size && entry.contentRect.height !== item.size.height) {
      this._scheduleLayout();
      break;
    }
  }
});
// observe each item element on add
```

Wins:
- **Closes 8+ duplicate upstream issues** (#1185, #1158, #1152, #1108, #1165, #1189, #1147, …) in one feature.
- Eliminates the need for the `imagesLoaded` companion library for the common case.
- Works for **any** content that grows/shrinks after first paint: images, custom fonts, async content, SSR hydration. Not just images.
- Coalesces all per-item changes into one rAF-scheduled relayout (§ P.6).

**Cost:** one `ResizeObserver` per Masonry instance + one `observe` call per item. Browser-side cost is negligible — `ResizeObserver` is implemented natively in C++, batched per layout frame.

**P.1c — Flexible-width detection without `getSize()`**

Currently `needsResizeLayout` runs `getSize(this.element)` which is `getBoundingClientRect` + `getComputedStyle` + 12 paint property reads. The observer entry already has the new content-box width — use it directly, skip the whole getSize call.

### P.2 — `MutationObserver` for auto-relayout on DOM changes

Today, if the user `appendChild`s an item to the grid, Masonry doesn't know. They must call `.masonry('appended', elem)` or `.masonry('reloadItems')`. Forgetting this is the #1 source of "masonry is broken" issues in the upstream tracker.

```js
this._mo = new MutationObserver(mutations => {
  let needsReload = false;
  for (const m of mutations) {
    if (m.addedNodes.length || m.removedNodes.length) { needsReload = true; break; }
  }
  if (needsReload) this._scheduleReload();
});
this._mo.observe(this.element, { childList: true });
```

Wins:
- Removes a footgun.
- Combined with P.1b, the user's loop becomes "append elements to the container, that's it" — Masonry handles everything.
- Opt-in via `option: { autoLayout: true }` to preserve backward compatibility.

`MutationObserver` is universal since 2014.

### P.3 — `EventTarget` instead of EvEmitter

Modern `EventTarget` can be subclassed:

```js
class MasonryItem extends EventTarget { ... }
// usage:
item.addEventListener('layout', e => ...);
item.dispatchEvent(new CustomEvent('layout', { detail: { ... } }));
```

The current EvEmitter is ~110 LOC and 250 bytes minified. `EventTarget` constructor is universal since **Chrome 64 / Firefox 59 / Safari 14**. (Worth noting: Safari 14 is the binding constraint here, not 13.1.)

Wins:
- −110 LOC (entire EvEmitter module deleted)
- Standard event API: `addEventListener`, `removeEventListener`, `dispatchEvent`, `AbortSignal` for one-shot cleanup
- `AbortController` replaces the manual `once()` flag tracking

### P.4 — `document.fonts.ready` for first paint correctness

Closes upstream **#1182** (custom font breaks initial layout):

```js
async layout() {
  if (this._isFirstLayout && document.fonts && document.fonts.status !== 'loaded') {
    await document.fonts.ready;
  }
  this._doLayout();
}
```

Universal since 2018. Combined with `ResizeObserver`, this becomes the belt-and-suspenders solution: wait for fonts on first paint, and let `ResizeObserver` handle any later size changes if a font loads after init.

### P.5 — Web Animations API (`Element.animate()`) for transitions

Replaces the entire transition infrastructure in Outlayer/Item (`enableTransition`, `disableTransition`, `_transitionTo`, `transitionend` listeners, `onwebkitTransitionEnd`, `onotransitionend`, the `_transn` state machine, the force-reflow hack):

```js
// before: ~120 LOC of transition state management
// after:
const anim = item.element.animate(
  [{ transform: `translate(${oldX}px, ${oldY}px)` }, { transform: `translate(${newX}px, ${newY}px)` }],
  { duration: 400, easing: 'ease', fill: 'forwards' }
);
await anim.finished;
```

Wins:
- ~120 LOC deleted from outlayer/item
- No forced reflow before transition (the `offsetHeight` hack — § L.5 — is gone)
- Returns a `Promise` — composable, awaitable, cancelable via `anim.cancel()`
- Compositor-only (since we're already on transforms)
- Stagger becomes a one-line `delay: i * stagger` option

WAAPI is universal since Safari 13.1 (2020).

### P.6 — `requestAnimationFrame` coalescing replaces `setTimeout` debounce

The current `utils.debounceMethod( Outlayer, 'onresize', 100 )` introduces a hard 100ms delay between resize and relayout. Users see the grid lag during window drag.

```js
_scheduleLayout() {
  if (this._layoutScheduled) return;
  this._layoutScheduled = true;
  requestAnimationFrame(() => {
    this._layoutScheduled = false;
    this.layout();
  });
}
```

Wins:
- Layout is applied on the next paint frame instead of after 100ms — perceptually instantaneous.
- Multiple `appended()` / `prepended()` / `addItems()` calls in the same tick collapse into one layout pass (the original concern that motivated the 100ms debounce).
- Pairs naturally with `ResizeObserver`, which already fires on the layout boundary.

### P.7 — `IntersectionObserver` for opt-in virtualization

For very large grids (1000+ items): observe items, only run the full position-application phase for items currently in (or near) the viewport. Items outside the viewport get `visibility: hidden` and stay at last computed position.

```js
const io = new IntersectionObserver(entries => {
  for (const e of entries) e.target.style.visibility = e.isIntersecting ? '' : 'hidden';
}, { rootMargin: '500px' });
```

Combined with CSS `content-visibility: auto` (§ 1.5), this gives near-virtualization performance with zero layout-thrashing.

**Status:** speculative, opt-in, only for grids >500 items. Won't ship in v5.0.

### P.8 — `AbortController` for cleanup

`destroy()` currently has 30 lines of "remove this listener, remove that listener, delete this expando." With `AbortController`:

```js
this._ac = new AbortController();
window.addEventListener('resize', this, { signal: this._ac.signal });
elem.addEventListener('transitionend', this, { signal: this._ac.signal });
// destroy:
this._ac.abort();   // every listener tied to this signal is removed in one call
```

Universal since Chrome 90 / Firefox 86 / Safari 15 (early 2021).

## P.1 (math) — Fix percentage width + gutter (#1006)

Not a browser API, but a math fix. The current `measureColumns()`:

```js
var columnWidth = this.columnWidth += this.gutter;
var containerWidth = this.containerWidth + this.gutter;
var cols = containerWidth / columnWidth;
```

When the user gives `columnWidth: '20%'`, the percent-resolution happens via `_getMeasurement` calling `getSize` on a sizer element — but the percentage is resolved *before* gutter is subtracted. The fix is to detect a percent-derived columnWidth and reverse-derive cols from the percent literal:

```js
// pseudocode
if (this._columnWidthIsPercent) {
  this.cols = Math.round(100 / this._columnWidthPercent);
  this.columnWidth = (this.containerWidth - this.gutter * (this.cols - 1)) / this.cols;
}
```

**Closes #1006 (53 reactions, the highest-reaction open issue in the upstream tracker).**

## Browser support cuts

The fork drops everything below this baseline:

| Browser | Min version | Released |
|---|---|---|
| Chrome / Edge (Chromium) | 84 | 2020-07 |
| Firefox | 86 | 2021-02 |
| Safari | 15 | 2021-09 |

This baseline is set by `AbortController` on `addEventListener` (the latest of the APIs we want to use). Everything else (`ResizeObserver`, `MutationObserver`, `Element.matches`, unprefixed `transform`/`transition`, `EventTarget` constructor, `Element.animate`, `document.fonts.ready`, `Object.assign`, `Array.from`) was already universally available before this baseline.

**What this drops:**
- IE11 (long since unsupported by Microsoft)
- Edge Legacy (replaced by Chromium Edge in 2020)
- Pre-Chromium WebView (Android <85)
- Safari ≤14 (4+ years old at fork date)

**What it gains:**
- ~450 LOC of polyfill / vendor-prefix / feature-detection code deleted
- Pure ESM module load with no DOM side effects → SSR works
- Smaller surface area for testing

> Stating the support baseline explicitly in `README.md` is itself a feature: it lets prospective users decide in 5 seconds whether the fork is appropriate for them.

## Bundle size projection

| Stage | Minified | Gzipped | Notes |
|---|---:|---:|---|
| **Today** | 24,103 B | 7,393 B | `dist/masonry.pkgd.min.js`, measured |
| After § L.1 + L.2 + L.3 + L.6 (delete pure dead code) | ~20,000 B | ~6,200 B | Vendor prefixes, matches polyfill, IE11 box-sizing, setTimeout(0) |
| After § L.4 (inline fizzy-ui-utils) + § L.5 (delete reflow hack) | ~17,000 B | ~5,300 B | |
| After § P.3 (delete EvEmitter) + § P.5 (WAAPI replaces transition machine) | ~12,000 B | ~3,800 B | |
| After § 2.4 (vendor slimmed Outlayer + drop jquery-bridget from default) | **~6,000 B** | **~2,200 B** | v5 target |

**4× smaller minified, 3.4× smaller gzipped, while *adding* the major UX/perf features (P.1b, P.2, P.4, P.5).**

For comparison, the source-only `masonry.js` (no deps bundled) is currently 7,473 B / 2,468 B gzipped. The full v5 target gzipped is roughly the same size as just the *core math* of v4.2.2 — because all the dependency code is gone, replaced by browser primitives.

## Dependency tree projection

**Today** (runtime, after `npm install masonry-layout`):
```
masonry-layout
├── outlayer
│   ├── ev-emitter
│   ├── get-size
│   └── fizzy-ui-utils
│       └── desandro-matches-selector
└── get-size
```
Six packages from the metafizzy ecosystem, all on package versions from 2017–2018.

**v5** (runtime):
```
masonry-pretext
└── (no dependencies)
```
Optionally, when consumer wants pretext-driven sizing:
```
masonry-pretext
└── pretext  (peer dep)
```

Zero runtime dependencies → no transitive supply-chain risk, no version skew, no audit noise.

**Build-time devDeps** today: ~12 packages (gulp, gulp-jshint, gulp-json-lint, gulp-rename, gulp-replace, gulp-requirejs-optimize, gulp-uglify, gulp-util, jshint, requirejs, chalk, minimist, qunitjs).

**v5 devDeps:** ~3 packages (esbuild, vitest + happy-dom, biome or similar).

## Mapping fork features → upstream issues closed

Every feature lands tagged with the issues it resolves. This makes the value of each PR concrete:

| Fork feature | Upstream issues closed | Estimated user impact |
|---|---|---|
| § P.1b — per-item ResizeObserver | #1185, #1158, #1152, #1108, #1165, #1189, #1147, #1199 (image overlap on lazy load) | **Highest** — dominant complaint category |
| § P.4 — `document.fonts.ready` | #1182 (custom font flicker) | High — affects every project with web fonts |
| § L.2 — delete vendor-prefix detection | #1194, #1121 (SSR `window` undefined) | High — every Next.js/Nuxt/SvelteKit user hits this |
| § 2.1 + § 2.2 — pure ESM build | #1201 (vite build fails) | High — modern bundler users |
| § P.1 (math) — percentage width + gutter | #1006 (53 reactions) | Highest by reaction count |
| § P.2 — MutationObserver auto-layout | #1116 ("no such method 'reload'"), #1089 (async/dynamic rendering doesn't work) | Medium — kills the "forgot to call reload" footgun |
| § 1.2 — batch read/write | #1186 (Safari perf on reinit) | Medium — perceptible on large grids |
| § 1.1 — Pretext integration | (no upstream issue, headline fork feature) | High for text-heavy grids |

## Updated suggested order of operations

The original ordering at the top of this file still holds, but with these inserts:

1. § 3.2 — test runner + CI **(unchanged — must be first)**
2. § 2.1 — esbuild build **(unchanged)**
3. § 2.6 — delete bower.json / composer.json **(unchanged — free win)**
4. **NEW: § L.1 + L.2 + L.3 + L.6** — pure deletion sweep. No behavior change. Closes #1194 and #1121 as a side effect of deleting vendor-prefix code. Smallest possible PRs, easy to review, easy to revert.
5. **NEW: § P.1 — ResizeObserver triple play.** This is the biggest UX win in the entire roadmap. Closes 8+ duplicate issues. Should land before pretext because it makes the test bed honest.
6. § 1.2 — batch read/write **(unchanged)**
7. § 1.1 — Pretext integration **(unchanged — headline)**
8. **NEW: § P.4 + § P.2** — fonts.ready and MutationObserver. Small, additive, each closes specific upstream issues.
9. § 1.3 — `transform` positioning **(unchanged)**
10. **NEW: § P.5 + § P.3 + § P.8** — WAAPI, EventTarget, AbortController. Together these delete most of Outlayer/Item.
11. **NEW: § P.1 (math)** — fix #1006 percentage width + gutter.
12. § 2.4 — vendor slimmed Outlayer **(unchanged — last)**
13. § P.7 — IntersectionObserver virtualization **(speculative, post-v5)**

Cut **v5.0.0** at the end of step 11. § 2.4 + § P.7 belong to v5.1+.

---

# Methodology

This section is the contract for how every change in this fork is justified, validated, and recorded. It is intentionally narrow: the fork's whole reason to exist is *measurable* improvement, so the measurement and verification protocol is the spine of the work.

## The change loop

Every change — even a one-line deletion — goes through this loop:

1. **Capture baseline.** Run `scripts/measure.sh` and `npm run test:visual` against the current state. Save the output.
2. **State the hypothesis.** In the commit body or release-notes entry, write what is expected to change and by how much. Example: *"Deleting matchesSelector polyfill should reduce dist/masonry.pkgd.min.js by ~600 bytes raw, ~250 bytes gzipped, with no behavior change."*
3. **Make the change.**
4. **Re-run measurements.** `scripts/measure.sh` again, diff against baseline.
5. **Re-run tests.** Visual + position-assertion tests must pass identically (same screenshot diff thresholds, same position numbers).
6. **Compare to hypothesis.** If the hypothesis was wrong (e.g. "expected smaller, got bigger"), the change does not land — investigate why.
7. **Record actual numbers.** Append to `FORK_RELEASE_NOTES.md` under the active version with both the *predicted* and the *actual* delta. Predictions that miss are themselves data — they expose where the mental model is wrong.

The point of step 6 is that **predicted improvements must be verified, not assumed**. The fork has been bitten before by reasoning like "removing dead code obviously shrinks the bundle" — minifiers can already eliminate unreachable branches, vendor-prefix detection can become inline constants, etc. Until measured, an improvement is a guess.

## Measurement protocol

`scripts/measure.sh` is the single source of truth for "how big / how slow". It prints a stable, parseable table of:

- **Source files:** raw bytes, gzipped, brotli, line count for `masonry.js`, `dist/masonry.pkgd.js`, `dist/masonry.pkgd.min.js`.
- **Repository:** total tracked files, total LOC.
- **Dependencies:** count of `dependencies` and `devDependencies` from `package.json`.
- **Build artifacts:** size of every file in `dist/`.

The script writes its output to stdout and (when invoked with `--save <label>`) appends a row to `metrics/history.tsv` so the trend over time is auditable.

Always run `scripts/measure.sh` from a clean working tree (no `node_modules` build artifacts mixed in) so numbers are reproducible.

### Why these specific metrics

- **Raw bytes** is what the source file is on disk. Useful for sanity-checking edits.
- **Gzipped** is what users actually download. This is the headline metric.
- **Brotli** is what most CDNs serve in 2026. Tracked separately because it can compress differently than gzip — particularly on long repeated patterns.
- **LOC** is for human maintenance burden, not for performance. Never used as a perf claim by itself.
- **Dep count** is supply-chain surface area.

### Don't trust hand-wavy claims

If a roadmap entry says "expected ~30% smaller", it must be backed up by an actual minifier run on a real diff. Minifiers (esbuild, terser, swc) are aggressive — they DCE unreachable code, inline constants, hoist common subexpressions. **Removing source LOC does not always remove minified bytes.** A change that deletes 50 lines of dead branches the minifier was already eliminating produces zero minified-byte savings. We measure to find out.

## Test strategy

Three layers, all live in `test/`:

### Layer 1 — Position assertions (`test/visual/`)

For every layout option Masonry supports (basic, fit-width, gutter, stamp, horizontal-order, RTL, bottom-up, element-sizing, percent-position, etc.), there is a self-contained HTML page in `test/visual/pages/` and a Playwright spec in `test/visual/*.spec.js` that:

1. Loads `dist/masonry.pkgd.min.js` (or the new ESM build, when available).
2. Initializes Masonry with a known fixture.
3. Reads back `getBoundingClientRect()` for every item.
4. Asserts the positions match a hardcoded expected list (the same way the upstream qunit tests do).

These are the **regression suite**. They run on every change and gate every commit. Failures mean the change is wrong, period — no "let's update the expected values to match" without a written justification.

**Why self-contained pages and not the existing `test/index.html`?** Because the upstream test page loads each dependency individually from `bower_components/`, and Bower is deprecated. Our pages load only `dist/masonry.pkgd.min.js` (which bundles everything) so the suite has zero setup beyond `npx playwright install chromium`.

### Layer 2 — Visual snapshots (`test/visual/__screenshots__/`)

For each fixture page, Playwright takes a screenshot at a fixed viewport size and compares against a checked-in baseline. Threshold: small (≤0.1% pixel diff) — Masonry positions are deterministic, so any visual diff is a real regression.

Snapshots catch things position assertions miss: subpixel rendering bugs, transition glitches, container sizing errors, missing items.

To update snapshots intentionally (e.g., after a deliberate transform-positioning change), run with `--update-snapshots` and *commit the new screenshots in the same commit as the source change*, with the rationale in the commit body. Never update snapshots in a "fix tests" commit.

### Layer 3 — Microbenchmarks (`test/bench/`)

For perf claims, a Playwright script that:

1. Builds a programmatic grid of N items (50, 500, 5000) with controllable item sizes.
2. Times `new Masonry(...)` initial layout via `performance.now()`.
3. Calls `.layout()` 100 times in a tight loop, captures average.
4. Reads Chrome's performance buffer (`performance.getEntriesByType('measure')`) for forced-reflow counts.
5. Outputs a JSON record per run.

Bench results go to `metrics/bench.tsv` and are diffed against baseline the same way size metrics are. A perf-targeted change that doesn't show up in the bench delta did not work.

### What we deliberately don't test

- **Cross-browser visual parity.** Chromium only. Firefox/Safari rendering differences are out of scope for the regression suite — if a Safari-specific bug is reported, we add a one-off test for it. Trying to maintain three browser baselines is more cost than benefit at this stage.
- **The original qunit suite (`test/index.html`).** Kept in the repo for reference but not run in CI. Replaced by `test/visual/` which is functionally a superset and doesn't need Bower.

## Workflow expectations

For each work item from the order of operations:

1. Open a feature branch (`feat/L1-delete-matches-polyfill`, `perf/P1b-resize-observer`, etc.) — naming maps to the roadmap section.
2. Run baseline measurements + tests. Capture the `scripts/measure.sh` output.
3. Make the change. Stay focused — one roadmap section per branch.
4. Re-measure, re-test. Iterate until green and the numbers move in the predicted direction.
5. **Bump `package.json` version** to the next `5.0.0-dev.N`.
6. **Update `README.md` § "Key improvements vs upstream"** with a one-liner aimed at *library users* (not contributors). What does this change give them? Skip changes that have no user-visible effect (purely internal refactors, doc edits, etc.).
7. Update `FORK_ROADMAP.md` § Progress to mark the item ✅ with the actual headline delta in the Notes column, and link the per-change file in `improvements/`.
8. Update `FORK_RELEASE_NOTES.md` with the predicted vs actual numbers.
9. Write the per-change record at `improvements/NNN-<slug>.md` using `improvements/TEMPLATE.md`.
10. Commit with a body that includes the before/after metrics inline.
11. **Create an annotated git tag** `v5.0.0-dev.N` on the improvement commit. Tag message: improvement title + headline numbers. Example: `git tag -a v5.0.0-dev.1 -m "001 — foundation cleanup: -97% npm install size, -82% devDeps"`.
12. Open PR (or merge directly if working solo) with the metric diff in the description.

**No batching multiple roadmap sections in one commit.** Even if § L.1 and § L.2 are both pure deletions, they get separate commits so the size delta of each is attributable. The whole point is being able to look at `git log` later and answer "which change saved the most bytes?"

**Why the tag + version bump per improvement.** Each tag corresponds to a stable rollback point and a release-notes entry. If a future change regresses something, `git checkout v5.0.0-dev.N` lets anyone reproduce the exact state where it was last green. The version bump is what makes the tag a real semver release that can later be published to npm if desired.

## Expectations & guard rails

- **Performance claims require benchmark numbers.** "Should be faster" is not enough — the bench output goes in the commit body.
- **Size claims require minifier output.** Predictions about gzipped savings are verified against real `dist/masonry.pkgd.min.js` after a real build, not source LOC math.
- **Behavior claims require a passing test.** Adding a feature without a corresponding fixture page + position assertions is not done.
- **A failed prediction is documented, not hidden.** If a planned 600-byte deletion saves 0 bytes after minification, the release note says so and the roadmap is updated to remove the misleading claim. Truthful negative results are how we calibrate the next prediction.
- **Changes that break the visual snapshot suite are blocked from landing** until either (a) the regression is fixed or (b) the snapshot is updated *with a written rationale*. There is no "tests are flaky, retry" path — Masonry is deterministic.

---

# Post-#010 review (2026-04-08)

After improvement #010 landed, **four** parallel reviews — a self-audit with fresh eyes plus three independent external agents — converged on roughly the same architectural priorities but disagreed on emphasis and surfaced two important *new* findings that none of the prior reviews caught. This section captures the merged findings, the previously-invisible gaps, the headline disagreement that needed source-level clarification, and re-ranks priorities.

The four reviews:

| Reviewer | Focus | Caught | Missed |
|---|---|---|---|
| **Self-audit (post-#010)** | Bundle composition + upstream issue tracker | Tier-A through Tier-F size wins; the `#1006` percentage-width issue (top by reactions); test coverage gaps | The Tier 0 packaging/README/CI/harness gaps; the allocation-per-item-per-layout in `_getColGroupY`; the WeakMap registry opportunity |
| **External agent #1** (packaging-focused) | Packaging metadata, contributor experience, README freshness | All four Tier 0 gaps; verified `npm test` failed on Chromium launch in their sandbox | Specific A-F size wins; allocation/registry opportunities |
| **External agent #2** (high-level architecture) | "Big wins" list | ResizeObserver, transform positioning, EvEmitter→EventTarget, WAAPI, slim Outlayer, math fix — all confirmed | The Tier 0 gaps; **made one factually incorrect claim about batch read/write — see "Disagreements" below**; allocation/registry opportunities |
| **External agent #3** (source-level audit, ignored the roadmap) | Direct source review, ranked by structural payoff | Slim Outlayer (#1) + transition state machine deletion (#2) + **two genuinely new findings** (allocation-free column search, WeakMap-based item registry) + tiered confirmation of items E, T0.1, T0.2; argued for an engine/adapter split (item P below) | Test coverage gaps for the items it proposed deleting |
| **External agent #4** (forward-looking, "what's beyond the roadmap") | 7 speculative wins from modern browser APIs | Two genuinely new ideas worth pursuing (Web Component wrapper, Promise-based API) + a useful sharpening of item O (`offsetWidth` makes box-sizing detection unnecessary regardless of CSS); cleaner alternative for stagger via CSS variables | Half the findings don't survive source verification — see "Review #5 evaluation" below |

The merge of all five is the priority order in the rest of this section.

## Disagreement: is "batch read/write" actually a big win?

The architecture-focused review claimed batch read/write was the "single biggest technical win," asserting that masonry currently "interleaves DOM reads and writes, causing O(N) forced reflows for N items," and that batching would be "orders of magnitude faster on large grids."

**This is incorrect.** Masonry already does batched read/write. Source evidence:

`outlayer.js:_layoutItems` runs the read phase entirely first (calls `_getItemLayoutPosition` for *every* item, building a position queue) before invoking `_processLayoutQueue` which then runs the write phase (calls `_positionItem` for every item, applying styles). The reads and writes are not interleaved.

Inside `_getItemLayoutPosition` (in `masonry.js`), each item's `getSize()` reads `getComputedStyle(element)` and `element.offsetWidth` / `offsetHeight`. The **first** of these forces a synchronous reflow if any pending DOM mutations exist; **subsequent reads in the same batch return cached values** because the layout is now clean. So the cost of `getSize()` across N items is approximately one reflow + N cheap reads, not N reflows.

This is exactly what improvement #009's pretext bench measured. From `improvements/009-pretext-integration.md`:

> Consistently ~20-25% faster initial layout across grid sizes [from skipping the DOM measurement path entirely via `pretextify`]. The savings are smaller than the "5-10×" mental model you might assume from "skip per-item reflows" because **Masonry already does batched read/write**. The first `getSize()` flushes layout, subsequent reads return cached values.

**The empirical ceiling for "skip DOM measurement on large grids" is about 1.2-1.3× faster initial layout, not orders of magnitude.** That ceiling has already been measured and (in the pretext fast path) reached. The remaining 75-80 % of layout time is column-packing arithmetic + DOM writes, neither of which "batch read/write" affects.

**What that means for the roadmap:**

- The original roadmap's § 1.2 ("Batch read/write layout pass") is **mostly already done** by upstream's existing structure. Removing it from the active priority list and noting it as already-implemented.
- The big perf wins still on the table are **structural**, not loop-restructuring:
  - Skipping DOM measurement entirely on opted-in items via `pretextify` (§ 1.1) — **DONE in #009**, measured 1.2-1.3×
  - Eliminating relayout-triggering events via `ResizeObserver` (§ P.1) — pending, the next big UX win
  - Moving positioning to GPU compositor via `transform: translate3d` (§ 1.3) — pending, but only affects transitions during relayout, not initial layout (subpixel rendering on layout thrash) — has to be benchmarked, likely modest
  - Web Animations API replacing the `_transn` state machine (§ P.5) — code-cleanup more than perf

The "single biggest technical win" framing in the architecture review is wrong because the win it's pointing at doesn't exist as a discoverable improvement — it's already done. The actual remaining wins are listed in the size + UX tables below.

After improvement #010 landed, **the original roadmap focused on size/perf/UX of the runtime library and under-weighted packaging, contributor experience, and the most-requested upstream issue**. This section captures the merged findings, the previously-invisible gaps, and re-ranks priorities.

## Foundation gaps (Tier 0 — discovered late, do first)

Four real issues, all small but high-leverage. None of them were on the original roadmap explicitly, or they were ranked too low to land before the deletion sweep.

### Gap T0.1 — Stale README (HIGH urgency, ~30 min effort)

The README's `Install`, `CDN`, `Package managers`, and `Initialize` sections still document the **upstream library**, not the fork:

- `npm install masonry-layout --save` — wrong package name (we renamed to `masonry-pretext` in #001)
- `bower install masonry-layout` — Bower is deprecated AND wrong name
- `https://unpkg.com/masonry-layout@4/...` — wrong package, wrong version, points at upstream's frozen build
- `$('.grid').masonry({...})` — **jQuery removed in #006**, this snippet doesn't work at all in the fork
- "Masonry has been actively maintained for 8 years" — misleading for a fork of a dormant project

**A new user following the README literally cannot install or use masonry-pretext.** Each subsequent improvement that changed user-facing behavior (jQuery removal, pretextify, fonts.ready) should have prompted a README check. None did. **This is the highest-leverage fix on the entire roadmap right now** — zero LOC of source code, ~30 minutes of editing, prevents a class of "how do I use this?" support burden.

### Gap T0.2 — `package.json` packaging metadata (HIGH urgency)

Currently has only `"main": "masonry.js"`. Missing:

- **`"exports"` field** — modern bundlers (Vite, Rollup, esbuild, webpack 5) consult this to find the right entry per consumer style (`import` vs `require` vs `default`)
- **`"module"` field** — fallback for `"exports"`-unaware bundlers
- **`"types"` field** — TypeScript users get no autocomplete

After #002 we have a working esbuild build, but the package metadata doesn't *advertise* the modern artifacts to bundlers. Users still get whatever the bundler's heuristic picks (often the unminified IIFE), even when their bundler could tree-shake an ESM input. This is § 2.2 of the original roadmap which never landed because it was sequenced as "step 8 in the order of operations" — wrong order, should have been Tier 0.

The minimum viable Tier 0 fix is the metadata change pointing at the existing dist files. The full § 2.2 scope (shipping a separate ESM build alongside the IIFE) is a follow-up.

### Gap T0.3 — No CI workflow (HIGH urgency)

`.github/` contains only `contributing.md` + `issue_template.md`. **There is no GitHub Actions workflow.** The "every commit must pass `make test`" rule from § Methodology lives only in the maintainer's local environment. A contributor PR cannot be auto-validated, and there's no proof the gate passes on a fresh clone.

`make test` already exists, has clean exit codes, and is fast (~14 ms build + ~5 s test). The fix is a ~30-line `.github/workflows/test.yml` that runs `make ci` on `push` + `pull_request`. This is § 3.2's CI sub-item which was assumed but never implemented.

### Gap T0.4 — Test harness brittleness (HIGH urgency)

`test/visual/_harness.mjs` launches chromium with `chromium.launch({ headless: true })` — no extra flags. Works in local Linux dev environments but **crashes in many sandboxed/container environments** (verified by the external reviewer whose `npm test` failed on Chromium launch in their sandbox; reproduces in unprivileged docker containers and several CI runners).

Standard hardening flags:

```js
chromium.launch({
  headless: true,
  args: [
    '--no-sandbox',                  // unprivileged containers
    '--disable-dev-shm-usage',       // small /dev/shm in CI containers
    '--disable-gpu',                 // headless doesn't need it
  ],
})
```

Fix is 5 lines in `_harness.mjs`. Without it the test gate is maintainer-machine-specific, which is the maintenance risk § 3.2 was trying to remove. **Must land before T0.3 (CI) or CI will fail on the first run.**

## Newly-discovered findings (review #4)

The fourth review surfaced four items that none of the previous three caught. Two are perf wins, one is an architectural cleanup, one is a refactoring enabler. All verified against the actual source.

### Item M — Allocation-free column-search hot path (NEW perf win)

`masonry.js:_getColGroupY` allocates a fresh array per call via `this.colYs.slice(col, col + colSpan)`, then calls `Math.max.apply(Math, groupColYs)` against it. For a multi-column item, `_getTopColGroup` calls `_getColGroupY` `groupCount = this.cols + 1 - colSpan` times. On a 500-item grid where 20 % of items are multi-column with `colSpan: 2` in a 4-column grid, that's `~100 items × 3 calls = 300 array allocations + 300 spread-Math.max calls per layout`. Real garbage collection pressure on the layout hot path.

The fix is a direct loop:

```js
proto._getColGroupY = function( col, colSpan ) {
  if ( colSpan < 2 ) return this.colYs[ col ];
  var max = this.colYs[ col ];
  for ( var i = 1; i < colSpan; i++ ) {
    if ( this.colYs[ col + i ] > max ) max = this.colYs[ col + i ];
  }
  return max;
};
```

Allocation-free, ~10 LOC, behavior-preserving. **Real micro perf win on grids with multi-column items.** Probably small (a few hundred ns per layout) but it's free, no breaking change, zero size cost (the body is shorter), and it removes a GC-pressure source from a hot path.

**Verification path:** existing 6 visual fixtures cover multi-column items (`fit-width.html`'s `w2`/`w3` classes); they should produce identical positions. Bench gain would need a new microbench (similar shape to `bench-pretext.mjs`) but with multi-column items dominant. Probably worth ~5-10 % on layout time for grids with many multi-column items.

### Item N — WeakMap-keyed item registry (cleanup + small perf)

`Outlayer.prototype.getItem(elem)` linearly scans `this.items[]` to find the `Item` for a given element. `getItems(elems)` calls `getItem` for each input, making it O(N²) in `M × N` where M is the input length. The same pattern is used by `unignore`, `remove`, `unstamp`.

Worse: `Outlayer.data(elem)` looks up the masonry **instance** from an element via the `outlayerGUID` expando + a global `instances[]` registry:

```js
this.element.outlayerGUID = id; // expando — sets a custom property on the DOM node
instances[ id ] = this;          // global registry indexed by GUID
```

The expando is a 2014-era pattern. It pollutes the DOM element with a custom property and creates a memory leak risk if the element is removed without `destroy()` being called (the `instances[id]` keeps the masonry instance alive even if the element is gone). The SSR alive-check added in #005 (`if (self.element.outlayerGUID)`) leans on this pattern too.

**The fix:**

- Per-instance: `WeakMap<Element, Item>` for `getItem`/`getItems`/`unignore`/`unstamp` lookups. O(1) per call. Auto-GC when the element is removed.
- Global: `WeakMap<Element, Outlayer>` replacing the `outlayerGUID` expando + `instances[id]` registry. Same auto-GC behavior. The SSR alive-check becomes `if (instanceMap.has(self.element))`.

Net: deletes ~30 LOC of registry plumbing, eliminates an expando, makes a class of memory leaks impossible, and makes the lookups O(1).

**Verification:** existing fixtures don't exercise `getItem`/`getItems`/`Outlayer.data` directly. Manual verification: SSR smoke test would fail loudly if the alive-check broke. Worth adding a small fixture that calls `msnry.getItem(elem)` and asserts the right Item is returned, before refactoring.

### Item O — Masonry-specific `getSize` (size + perf win)

Even after improvement #007 stripped the IE11/Firefox<29 box-sizing detection from `node_modules/get-size/get-size.js`, the function still reads **12 padding/margin/border properties** per call (`paddingLeft`, `paddingRight`, … through `borderBottomWidth`) plus `getComputedStyle(elem)` plus `offsetWidth`/`offsetHeight`. Used to construct a full box-model size object: `{width, height, innerWidth, innerHeight, outerWidth, outerHeight, paddingLeft, …}`.

Masonry only reads two fields: `outerWidth` and `outerHeight` (verified by grep over `masonry.js` + `node_modules/outlayer/{outlayer,item}.js`). The other 10+ fields are **computed for every measurement and never read.**

A masonry-specific `getSize(elem)` could be:

```js
function getSize( elem ) {
  var style = getComputedStyle( elem );
  if ( !style || style.display === 'none' ) return { outerWidth: 0, outerHeight: 0 };
  var marginX = parseFloat(style.marginLeft) + parseFloat(style.marginRight) || 0;
  var marginY = parseFloat(style.marginTop) + parseFloat(style.marginBottom) || 0;
  return {
    outerWidth: elem.offsetWidth + marginX,
    outerHeight: elem.offsetHeight + marginY,
  };
}
```

~10 LOC vs the current ~80 LOC. **Real bundle size win** (~300-500 B raw / ~100-200 B gz on `dist/masonry.pkgd.min.js`) and **real per-item perf win** (4 style reads vs 14, fewer parseFloat calls). The container size measurement (which IS used for `paddingLeft`/`paddingRight` etc.) would still need a full path — ship two functions, `getItemSize` and `getContainerSize`, with the latter being the legacy form.

This intersects with item E (delete `Outlayer.create` factory) — both want to slim the Outlayer/get-size tree without fully vendoring it. Could land independently or as part of the larger § 2.4.

### Item P — Engine/adapter separation (architectural enabler)

`masonry.js:_getItemLayoutPosition` interleaves three concerns:

1. **DOM measurement input**: `item.getSize()` reads from the DOM (or, in #009, from the `pretextify` callback)
2. **Pure placement math**: `_getTopColPosition` / `_getHorizontalColPosition` compute `{col, y}` from the item size + the `colYs` array
3. **State mutation**: updates `colYs[i]` for the spanned columns

The fourth review proposes splitting these:

- A pure `placeItem(size, colYs, options) → {col, y, newColYs}` function — no DOM, no `this`, fully testable in isolation, SSR-safe, theoretically benchable in pure JS without Playwright.
- A small DOM adapter that calls `placeItem` with measured/pretextified sizes and mutates `colYs`.

**The win is not bytes** — refactoring without removal doesn't shrink bundles much. **The win is enabling future work**:

- Easier benchmarking (the pure function can be timed in Node without chromium)
- Easier testing (no Playwright fixtures needed for layout math correctness)
- Future Web Worker offload (the pure function can run in a worker, only the DOM adapter touches the main thread)
- Cleaner SSR dry runs (the pure function can compute placements server-side from measured heights)

This is a **refactoring** rather than a feature; it should land *before* item L (WAAPI transitions) and #14 (MutationObserver) so those changes can use the cleaner shape.

## Review #5 evaluation (forward-looking ideas)

The fifth review proposed 7 ideas that go "beyond the roadmap." Source-verifying each one against the actual repo state:

| # | Idea | Verdict | Rationale |
|---|---|---|---|
| 5.1 | **Zero-Reflow Worker Architecture** — move the entire layout engine (packing + pretext) to a Web Worker, send item metadata in, receive `(x, y)` positions out | ⏸️ **Defer to v5.1+** | Speculative but real. The packing math is pure JS, and #009's `pretextify` already gives us DOM-free measurement. A worker could compute positions without touching DOM. **But:** main thread overhead is small (~5-15 ms for 500 items per the bench), message-passing cost is comparable (~2-6 ms), so net win is small for typical grids and only meaningful at 1000+ items. Depends on item P (engine/adapter split) landing first. **Track as a v5.1+ exploration.** |
| 5.2 | **Delete `get-size.js` entirely**, replace with a 5-line native measurement utility | ✅ **Promote to high priority — sharpens item O** | Source-verified: `elem.offsetWidth` returns the rendered box width *regardless of CSS `box-sizing`* (the `box-sizing` property only affects how `width: ___` is *interpreted*, not what `offsetWidth` returns). So masonry's `outerWidth = offsetWidth + marginLeft + marginRight` is a complete formula that doesn't need the box-sizing detection branch at all. **Item O becomes simpler than I described in review #4** — the masonry-specific path can be ~5 lines, not ~10, and `get-size` can be removed from runtime dependencies entirely (not just slimmed). Updating item O. |
| 5.3 | **Sub-pixel precision positioning** — remove the `Math.round/floor/ceil` "rounding hacks" from packing arithmetic | ❌ **Reject — based on a misreading of the source** | Source-verified at `masonry.js:103`: the rounding is `var mathMethod = excess && excess < 1 ? 'round' : 'floor'; cols = Math[mathMethod](cols);`. This rounds the **integer column count** (`cols`), not output positions. You cannot span 3.5 columns. The hack fixes float-math errors that cause `cols` to underestimate by 1 when the math should yield exactly N. Output positions (`this.columnWidth * colPosition.col`) are already fractional whenever `columnWidth` is fractional — modern browsers render them correctly already. There's nothing to fix here. (The legitimate concern in this area is item G — fixing the percentage-width + gutter math so columnWidth is a clean fraction in the first place — which is already on the roadmap as the top UX win.) |
| 5.4 | **TypedArray (`Float64Array`) for `colYs`** | ❌ **Reject — negligible perf** | `colYs` length === number of columns, typically 3-12. `Float64Array` vs `Array` makes microsecond differences at this size. The bench measured 2-50 ms for 100-2000 item grids; the `colYs` operations are a tiny fraction of that. Cost: `Float64Array` doesn't fully match `Array` semantics (`slice` returns a `Float64Array` not an `Array`, etc.), requiring downstream API adjustments. Net: ~0 % measurable win, real code complexity. Skip. |
| 5.5 | **CSS Variable staggering** — apply `--index` per item, use `transition-delay: calc(var(--index) * 50ms)` in CSS instead of JS | 🟡 **Conditional alternative to item B** | If we **delete** the stagger machinery (item B), this is moot. If we **keep** stagger as a feature, this is a cleaner implementation: removes the JS stagger machinery (~140-180 B gz) AND retains the feature, AND lets designers control timing in CSS. Net for "keep stagger" path: ~140 B savings + better DX. Net for "delete stagger" path (item B): nothing. **Decision deferred until item B's sequencing is locked in.** Documented as the alternative path. |
| 5.6 | **`<masonry-grid>` Web Component wrapper** — Custom Element with built-in MutationObserver + ResizeObserver | ✅ **Add as new item Q (post-rc)** | Real DX win. Custom Elements are framework-agnostic — work in React/Vue/SvelteKit/vanilla. Implementation: ~50-100 LOC of `class MasonryGrid extends HTMLElement { connectedCallback() {...} }` encapsulating `new Masonry()` + observers + cleanup. Should ship as a **separate file** (`dist/masonry-grid-element.js`) so imperative-API users don't pay the bytes. Adds an opt-in entry to the package; doesn't replace anything. Land after #014 (MutationObserver) and #012 (ResizeObserver) so the observers it wraps already exist. |
| 5.7 | **Promise-based async/await API** — `await msnry.layout()`, `await msnry.appended(...)` | 🟡 **Conditional on item A** | The "useful" form resolves the Promise after **transitions complete**, not just after positions are written. Implementation requires tracking `transitionend` events on every transitioning item and resolving when all done. ~30-50 LOC. **Conflict with item A** (delete the hide/reveal animation system) — if there are no transitions, there's nothing to await. **Decision deferred until item A's sequencing is locked in.** If item A lands and the hide/reveal system is deleted, the only thing `await msnry.layout()` could resolve on is "positions written," which is already known synchronously after the call returns. If item A is deferred and the transition system is kept, this is a real DX win. Document as item R, conditional on item A being skipped. |

### What review #5 added vs what it confirmed

- **Added:** items Q (Web Component wrapper) and R (Promise-based API, conditional). The sharpening of item O (`offsetWidth` independence from `box-sizing`) — this lets us delete `get-size` as a runtime dependency entirely, not just slim it.
- **Reaffirmed:** the worker direction (sketched but not new — § 1.7 in the original deep research already mentioned worker-based packing as speculative).
- **Rejected with rationale (3 of 7):** sub-pixel precision (misread the source), TypedArray (negligible perf), and the implicit batch-read/write framing in #1 (already-implemented per review #2's correction).

### Updated cumulative ceiling

Adding items M+N+O+P to the existing A-F + G-L list (item Q is post-rc, items R/5.5 are conditional):

| Tier | Items | Combined gz savings | Perf delta | Architectural value |
|---|---|---:|---|---|
| **Size only** (deletions A-F, M, O) | A, B, C, D, E, F, M, O | **~1,150-1,500 B** | small (M) | low |
| **UX features** (G, H, K) | percentage-width math, ResizeObserver, MutationObserver | +~150 B (cost) | **closes 8+ upstream issues**, eliminates manual reload | high |
| **Architectural** (N, P, § 2.4) | WeakMap registry, engine/adapter split, slim Outlayer vendor | ~50-100 B + enablement | small | **highest** |

The deletion ceiling alone now puts the bundle around **5,500-5,800 B gz** vs upstream's 7,367 — a **~21-25 % reduction**. With items G/H/K added on top, the size delta shifts to ~22-26 % (the cost of those features is paid once and they're features, not regressions).

## Big size wins still on the table

Cross-checked between the self-audit and the external agent's audit. Together: **~950-1,270 B gz of remaining size wins**, ~14-18 % on top of the current −5.57 % delta vs upstream. Combined this would put the fork at roughly **−18 % to −22 % gzipped vs upstream-frozen v4.2.2**.

Ranked by gz savings, biggest first:

| # | Item | Min gz savings | Risk | Closes upstream |
|---|---|---:|---|---|
| **A** | **Delete the entire hide/reveal animation system** in `outlayer.js` + `Item.js` (`proto.reveal/hide/_emitCompleteOnItems` + `Item`'s `reveal/hide/onRevealTransitionEnd/onHideTransitionEnd/getHideRevealTransitionEndProperty/remove` + `defaults.hiddenStyle/visibleStyle`). `appended()`/`prepended()` keep working but lose their fade-in animation. | **~450-550 B** | **Med (breaking)** — third-party plugins (infinite scroll, isotope-style add-ons) calling `msnry.appended(elem)` and expecting fade-in lose the animation. Layout still correct. | nothing directly |
| **B** | Delete the stagger machinery (`updateStagger`, `_positionItem` stagger arg, `Item.stagger`, `getMilliseconds`, `msUnits`) | ~140-180 B | Low — `options.stagger` never set in any fixture/test | nothing |
| **C** | Replace `Object.create(EvEmitter.prototype)` + `utils.extend(proto, EvEmitter.prototype)` with ES `class extends` for both `Outlayer` and `Item`. Modern minifiers compress `class` syntax meaningfully better than the manual prototype dance. | ~120-200 B | Med — pervasive refactor; touches the entire surface | nothing |
| **D** | Inline EvEmitter, drop `once()` + `allOff()` + `_onceEvents` plumbing. After **A** lands, `once()` has zero callers. `allOff()` already has zero callers. | ~100-140 B | Low (after **A**) | nothing |
| **E** | Delete `Outlayer.create()` factory + `htmlInit` auto-init (the `<div data-masonry='{...}'>` discovery). `Outlayer.create` builds a runtime subclass per namespace + does `subclass(Item)` (Masonry never overrides it — pure waste). | ~80-110 B | Med — removes `data-masonry` auto-init for users relying on it | **closes desandro/masonry#1104** ("Version without auto HTML initialize") |
| **F** | Inline single-call helpers + dedupe poorly-compressing strings. Specifics: `dispatchEvent` (one caller after **A**) → inline; cache `_getOption('originLeft'/'originTop')` once per method instead of 4× in `Item.{getPosition,layoutPosition,getTranslate}`; the `'transitionProperty'`/`'transitionDuration'`/`'transitionDelay'` literals appear ~6× and don't dedupe well in gz. | ~60-90 B | Low — pure refactor | nothing |

**Cumulative ceiling if all six land:** ~950-1,270 B gz savings → bundle gz drops from 6,957 → ~5,700-6,000 B, putting the fork at **−18 % to −22 % gzipped vs upstream**.

Rejected as too small or too risky:

- `Array.prototype.slice.call → Array.from` in `utils.makeArray`: ~15 B min, not worth the diff
- `for (var i...)` → `for...of`: minifier already compresses tightly, ~zero net
- `compatOptions` (legacy `isFitWidth`/`isOrigin*` aliases): **load-bearing**, the upstream qunit tests in `test/unit/` (kept for reference) actively use the legacy names
- `_isLayoutInited` flag and "first layout is instant" logic: visible behavior, removing it breaks the no-animation-on-init contract
- `instances` global registry + `outlayerGUID`: ~30 B but used by the SSR alive-check in `_create` (#005)

## Big UX wins still on the table

| # | Item | Closes upstream | Effort |
|---|---|---|---|
| **G** | **§ P.1 math fix for `#1006`** — top open upstream issue with **53 reactions** (more than the next 5 issues combined). When `columnWidth` is given as a percent and `gutter` is set, the percent resolves against container width *before* gutter is subtracted, leaving a trailing margin. Reverse-derive cols from the percent literal so `cols × columnWidth + (cols-1) × gutter === containerWidth`. | **`desandro/masonry#1006`** "Percentage width does not work well with gutter" | Low — pure math change in `measureColumns()` |
| **H** | **§ P.1b per-item ResizeObserver** for image overlap. Auto-relayout when items resize (e.g., images finish loading). | **`desandro/masonry#1147`** + 7 duplicates (the dominant complaint category in the upstream tracker) | Med — the headline UX fix; needs a new fixture with delayed-loading content |
| **I** | § 811 — column-pick strategy callback (don't always pick shortest column) | `#811` (10 reactions) | Low — same shape as `pretextify` — a `columnPicker` option callback |
| **J** | § 1129 — respect parent max-width with `fitWidth` | `#1129` (3 reactions) | Low — niche but easy |
| **K** | **§ P.2 MutationObserver auto-relayout** — removes the "forgot to call `.reloadItems()`/`.appended()` after appending" footgun, the dominant non-image upstream complaint cluster | none directly but covers a class of "masonry not updating" bugs | Med — needs a new fixture |
| **L** | **§ P.5 WAAPI replacing the transition state machine** in `outlayer/item.js`. Biggest single architectural cleanup (~120 LOC of `_transitionTo`/`enableTransition`/`disableTransition`/`_transn` state). | none directly | Med-High — risky without a non-zero-`transitionDuration` fixture (current fixtures all use `0`) |

## Test coverage gaps (block items A, B, E, L)

Before any of items **A, B, E, L** can ship safely, the existing fixtures need to be augmented or the breakage documented. None of the current 6 visual fixtures cover:

- **Fade-in animation** on `appended()`/`prepended()`/`hide()`/`reveal()` — required to safely delete the hide/reveal system (item **A**).
- **`<div data-masonry>` auto-init** via `htmlInit` — required to safely delete `Outlayer.create` factory (item **E**).
- **`options.stagger` behavior** — required to safely delete the stagger machinery (item **B**).
- **Non-zero `transitionDuration` end state** — required to safely rewrite the transition state machine (§ P.5 / item **L**). All current fixtures use `transitionDuration: 0`.

For each of A/B/E/L, the path is: either **add the fixture before deleting** (preserves the test gate) OR **document the breakage in a v5.0.0-rc release note** and accept the loss as a major-version change.

## Re-ranked sequencing (synthesizes all four reviews)

The recommended order from here:

1. **#011 — README rewrite + Tier 0 packaging fixes (combined commit).** ✅ landed (`v5.0.0-dev.11`)
   - Rewrite README Install / CDN / Package managers / Initialize sections to reflect masonry-pretext (no jQuery, fork URL, vanilla API only)
   - Add `exports` / `module` / `types` to `package.json` (T0.2)
   - Add `.github/workflows/test.yml` running `make ci` on push + PR (T0.3)
   - Harden chromium launch flags in `_harness.mjs` (T0.4) — must precede CI or CI fails on first run
2. **#012 — Item H (§ P.1b per-item ResizeObserver).** ✅ landed (`v5.0.0-dev.12`). Closes the dominant upstream complaint category (8+ duplicate image-overlap issues). +365 B gz.
3. **#013 — Real ESM + CJS bundles (§ 2.2 closeout).** ✅ landed (`v5.0.0-dev.13`). Inserted ahead of item G after the Tier 0 fix in #011 turned out to have only set the `package.json` metadata without the matching dist outputs — the `import` / `require` conditions still resolved to the IIFE, breaking every modern-bundler consumer. Fixed in #013 with parallel `dist/masonry.cjs` + `dist/masonry.mjs` builds. Zero source change, +0 B to existing IIFE bundles.
4. **#014 — Item G (§ P.1 math fix for `#1006`).** ✅ landed (`v5.0.0-dev.14`). Closes the top open upstream issue (53 reactions, more than the next 5 combined). Detection across three layers (literal `'20%'` option, inline style, walked stylesheet rules) + stride-formula math fix. +391 B gz. New `percent-cols` discriminating fixture.
5. **#015 — Item K (§ P.2 MutationObserver auto-relayout).** Removes the "forgot to reload" footgun.
6. **#016 — Items M + N + O (allocation-free column search + WeakMap registry + masonry-specific getSize).** All three are pure cleanups with no breaking change, no API surface change, real-but-small perf wins. ~150-300 B gz savings combined. Land them before the big deletions because they're the lowest-risk improvements still available.
7. **#017 — Items A + B + D + F (delete hide/reveal/stagger + inline EvEmitter + dedupe).** Combined ~750-950 B gz. Breaking change for plugin authors. **Cut v5.0.0-rc.1 immediately after.**
8. **#018 — Items C + E (`class extends` + delete `Outlayer.create`/`htmlInit`).** Architectural cleanup, ~200-310 B gz, breaking change for `data-masonry` users.
9. **#019 — Item P (engine/adapter separation refactoring).** No bytes saved but unlocks easier benchmarking, SSR dry runs, future worker offloading. Enables item L (WAAPI) to land cleanly.
10. **#020+ — TypeScript types**, item L (WAAPI), § 2.4 (slim Outlayer vendor). Post-rc work toward v5.0.0 final.

After #011-018 land, `dist/masonry.pkgd.min.js` should be roughly **5,400-5,700 B gzipped** vs upstream's 7,367 — about **−22 % to −27 % vs upstream**. Enough delta to call v5.0.0-rc.1 and stop the dev tag sequence.

## What the original deep research missed

The "Deep research findings" section above was thorough on the runtime library code but under-weighted four things, all visible only after #010 landed:

1. **Packaging metadata as a Tier 0 item.** § 2.2 (ESM exports) was listed but ranked low ("step 8 in the order of operations"). It should have been Tier 0 because the build pipeline modernization (#002) didn't help users until `package.json` exports field actually pointed at the modern artifacts. The user experience is "I installed masonry-pretext and Vite still gives me the IIFE" — exactly the bundler-friendliness story #002 was supposed to address.
2. **CI as an actual gate.** § 3.2 mentioned CI in passing ("Wire up `npm test`. Add CI.") but the methodology wrote "every commit must pass `make test`" without ever implementing the automation. The local make rule isn't a gate; it's a convention that breaks as soon as a contributor PR comes in.
3. **README freshness.** Wasn't on the roadmap *at all*. The "fork direction" commit (`d2b80d1`) added the "Key improvements vs upstream" table but left the legacy upstream Install / Initialize sections intact. Each subsequent improvement that changed user-facing behavior should have prompted a README check.
4. **Test portability.** The visual gate was added in #001 but always ran on the maintainer's local Linux box. The brittle chromium launch became visible only when an external reviewer tried to run it.

## Methodology updates (effective immediately)

Add to the change loop in § Methodology:

- **Before each improvement**, run a **Tier 0 health check**:
  1. Does the README still match what users will get? Specifically the Install / CDN / Package managers / Initialize sections.
  2. Does `package.json` still match the bundler ergonomics the build produces? (`exports` / `module` / `types` fields point at real files?)
  3. Does CI pass on at least one external clone of the repo? (`gh run view` or equivalent.)
  4. Does `make test` pass on a sandboxed/container chromium with the hardened launch flags? (Periodically test in a fresh docker container.)
- **After each user-facing change**, immediately update README's affected sections **in the same commit**. Don't defer to a later "docs cleanup" pass.
- **Run a Tier 0 audit periodically** — every 5 improvements or so — even when nothing seems wrong. The 4 gaps in this review accumulated silently between #001 and #010 with nothing catching them.

These four checks would have caught every gap this review found.

---

# Progress

Status of every step in the order of operations. Each row links to the per-change record in [`improvements/`](./improvements/) once it lands.

Status legend: ⬜ pending · 🟡 in progress · ✅ landed · ⚠️ partial · ❌ reverted · ⏸️ blocked

| # | Step | Section | Status | Improvement | Notes |
|---|---|---|---|---|---|
| F0 | Capture baseline metrics | — | ✅ | [000-baseline.md](./improvements/000-baseline.md) | `min.js`: 24,103 B raw / 7,367 B gz / 6,601 B br |
| F1 | Document fork direction (README, CLAUDE, ROADMAP, RELEASE_NOTES, improvements/) | — | ✅ `v5.0.0-dev.1` | [001-foundation-cleanup.md](./improvements/001-foundation-cleanup.md) | |
| F2 | Add `scripts/measure.sh` + `metrics/history.tsv` | § Methodology | ✅ `v5.0.0-dev.1` | [001-foundation-cleanup.md](./improvements/001-foundation-cleanup.md) | hermetic byte counts |
| 1 | Modern test runner + CI | § 3.2 | ✅ `v5.0.0-dev.1` | [001-foundation-cleanup.md](./improvements/001-foundation-cleanup.md) | custom Playwright runner; 4 fixtures passing |
| 2 | esbuild build | § 2.1 | ⚠️ `v5.0.0-dev.2` | [002-esbuild-build.md](./improvements/002-esbuild-build.md) | **17 ms build (~500× faster)**; min.js gz +7.1 % (recoverable in L.1–L.4) |
| 3 | Delete `bower.json` + `composer.json` | § 2.6 | ✅ `v5.0.0-dev.1` | [001-foundation-cleanup.md](./improvements/001-foundation-cleanup.md) | + dead gulp/jshint/qunit toolchain |
| 3b | Rename package to `masonry-pretext`, bump to 5.0.0-dev | § 2.6 (extension) | ✅ `v5.0.0-dev.1` | [001-foundation-cleanup.md](./improvements/001-foundation-cleanup.md) | **−97% `npm install` (349 → 10 pkgs)** |
| 4a | Delete `matchesSelector` polyfill | § L.1 | ✅ `v5.0.0-dev.3` | [003-delete-matches-selector-polyfill.md](./improvements/003-delete-matches-selector-polyfill.md) | **−401 B raw / −102 B gz** on min.js; first row where raw < upstream |
| 4b | Delete vendor-prefix detection (size only) | § L.2a | ✅ `v5.0.0-dev.4` | [004-delete-vendor-prefix-detection.md](./improvements/004-delete-vendor-prefix-detection.md) | **−606 B raw / −172 B gz** on min.js; SSR claim disproven, see § L.2b |
| 4b' | SSR fix — wrap UMD call sites with `typeof window` guards | § L.2b | ✅ `v5.0.0-dev.5` | [005-ssr-import-fix.md](./improvements/005-ssr-import-fix.md) | **closes desandro/masonry #1194 / #1121 / #1201**; +13 B gz cost; ssr-smoke now in `make test` |
| 4c | **Remove jQuery entirely** (drop jquery-bridget from devDeps + bundle, delete every `if (jQuery)` branch directly) | § 2.5 | ✅ `v5.0.0-dev.6` | [006-remove-jquery.md](./improvements/006-remove-jquery.md) | **MILESTONE: every min.js metric now below upstream** (raw −2,129 B / −8.83%, gz −295 B / −4%, br −200 B / −3%); zero jquery/bridget strings in bundle (verified by new `no-jquery` gate); **breaking change** for jQuery shim users |
| 4c2 | Delete getSize box-sizing setup | § L.3 | ✅ `v5.0.0-dev.7` | [007-delete-getsize-boxsizing-setup.md](./improvements/007-delete-getsize-boxsizing-setup.md) | **−378 B raw / −148 B gz / −156 B br** on min.js; vs upstream now −2,507 raw / −443 gz / −356 br (−10.4% / −6.0% / −5.4%); +1 forced reflow eliminated |
| 4c3 | Delete unused fizzy-ui-utils methods (modulo, getParent) | § L.4 partial | ✅ `v5.0.0-dev.8` | [008-delete-unused-fizzy-utils.md](./improvements/008-delete-unused-fizzy-utils.md) | **−138 B raw / −53 B gz / −43 B br** on min.js; vs upstream now −2,645 raw / −496 gz / −399 br (−10.97% / −6.73% / −6.04%); the broader L.4 (slim-vendor fizzy-ui-utils) is still future work |
| 4d | Delete setTimeout(0) docReady wrapper | § L.6 | ✅ `v5.0.0-dev.22` | [022-delete-settimeout-docready-wrapper.md](./improvements/022-delete-settimeout-docready-wrapper.md) | flickity-specific workaround; −10 B raw / −1 B gz |
| 5a | ResizeObserver: container resize | § P.1a | ⬜ | | replaces window resize + 100ms debounce |
| 5b | ResizeObserver: per-item auto-relayout | § P.1b | ⬜ | | **closes 8+ image-overlap issues** |
| 5c | ResizeObserver: drop getSize() in needsResizeLayout | § P.1c | ⬜ | | |
| 6 | Batch read/write layout pass | § 1.2 | ⬜ | | biggest perf win without API change |
| 7 | Pretext integration (opt-in callback) | § 1.1 | ✅ `v5.0.0-dev.9` | [009-pretext-integration.md](./improvements/009-pretext-integration.md) | **headline feature**; +22 B gz cost; **measured 1.2-1.3× faster layout (17-24% reduction)** across 100-2000 item grids via new bench-pretext.mjs |
| 8a | `document.fonts.ready` first-paint gate | § P.4 | ✅ `v5.0.0-dev.10` | [010-document-fonts-ready.md](./improvements/010-document-fonts-ready.md) | **closes desandro/masonry#1182**; +63 B gz cost; new fonts-ready discriminating fixture |
| **— TIER 0 — discovered post-#010, all 4 reviews flagged at least one — — — — — — — — — — — — — — — — — — — — — —** |
| **T0.1** | **README rewrite — drop stale upstream Install/Initialize sections** | § Post-#010 | ✅ `v5.0.0-dev.11` | [011-tier0-foundation.md](./improvements/011-tier0-foundation.md) | new Install/Initialize/CDN sections + From source path + pretext example |
| **T0.2** | **`package.json` `exports` / `module` / `types` fields + masonry.d.ts** | § 2.2 (partial — full ESM build still pending) | ✅ `v5.0.0-dev.11` | [011-tier0-foundation.md](./improvements/011-tier0-foundation.md) | full conditional exports + ~210-line stub d.ts; **closeout in T0.2b / #013** |
| **T0.3** | **GitHub Actions CI** running `make ci` on push + PR | § 3.2 (CI sub-item) | ✅ `v5.0.0-dev.11` | [011-tier0-foundation.md](./improvements/011-tier0-foundation.md) | Node 22 / ubuntu-latest / cached chromium download |
| **T0.4** | **Harden chromium launch flags** in `_harness.mjs` (`--no-sandbox`, `--disable-dev-shm-usage`, `--disable-gpu`) | § Post-#010 | ✅ `v5.0.0-dev.11` | [011-tier0-foundation.md](./improvements/011-tier0-foundation.md) | unblocks T0.3 (CI) running in unprivileged containers |
| **T0.2b** | **Real ESM + CJS bundle outputs** — `dist/masonry.cjs` (CJS) + `dist/masonry.mjs` (ESM) built in parallel by the same esbuild script; `package.json` `main`/`module`/`exports` rewired to point at them; new `module-smoke.mjs` gate verifies both load through Node `require()` and dynamic `import()`. IIFE bundles unchanged byte-for-byte. **Closes § 2.2 full scope** (T0.2 was metadata-only; the conditions still resolved to a no-export IIFE). | § 2.2 (full closeout) | ✅ `v5.0.0-dev.13` | [013-esm-cjs-builds.md](./improvements/013-esm-cjs-builds.md) | **fixes `TypeError: Masonry is not a constructor` for every modern-bundler consumer**; verified end-to-end against an Astro/Vite downstream; +49 KB raw `masonry.cjs` + 50 KB raw `masonry.mjs` to the tarball but **zero** to consumer bundles (modern bundlers tree-shake into a single output) |
| **— Big size wins (post-#010 review) — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — —** |
| A | Delete hide/reveal animation system + Item.{hide,reveal,...} + defaults.hiddenStyle/visibleStyle | § Post-#010 | ⬜ | | **~450-550 B gz**; breaking for plugin authors expecting fade-in animation |
| B | Delete stagger machinery (`updateStagger`, `_positionItem` stagger arg, `Item.stagger`, `getMilliseconds`, `msUnits`) | § Post-#010 | ⬜ | | ~140-180 B gz; low risk (`options.stagger` never set) |
| C | `class extends` modernization for Outlayer + Item (replace `Object.create` + `utils.extend(proto, ...)`) | § Post-#010 | ⬜ | | ~120-200 B gz; pervasive refactor |
| D | Inline EvEmitter, drop `once()` + `allOff()` + `_onceEvents` plumbing (after A) | § Post-#010 + § P.3 | ⬜ | | ~100-140 B gz |
| E | Delete `Outlayer.create()` factory + `htmlInit` auto-init | § Post-#010 | ⬜ | | ~80-110 B gz; **closes desandro/masonry#1104**; breaking for `data-masonry` users |
| F | Inline single-call helpers + dedupe poorly-compressing strings | § Post-#010 | ⬜ | | ~60-90 B gz |
| **— Newly discovered (review #4) — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — —** |
| **M** | **Allocation-free `_getColGroupY` hot path** (replace `slice()` + `Math.max.apply` with direct loop) | § Post-#010 (review #4) | ⬜ | | NEW perf win; ~10 LOC, no breaking change, removes per-item GC pressure on multi-col grids |
| **N** | **WeakMap-keyed item registry** (replace `getItem` linear scan + `outlayerGUID` expando + global `instances[]`) | § Post-#010 (review #4) | ⬜ | | NEW; deletes ~30 LOC of registry plumbing, eliminates an expando, eliminates a memory leak class, makes lookups O(1) |
| **O** | **Masonry-specific `getSize` — and delete `get-size` runtime dep entirely** (post-review-#5 sharpening: `offsetWidth` already returns the rendered box width regardless of CSS `box-sizing`, so the box-sizing detection branch is unnecessary; replace 14-property box-model extraction + the entire dep with a 5-line `offsetWidth + margin` formula) | § Post-#010 (review #4 + review #5 sharpening) | ⬜ | | NEW; **~400-700 B raw / ~150-280 B gz savings** (sharper than original review #4 estimate) + per-item perf win + **runtime `dependencies` count drops from 2 → 1** |
| **P** | **Engine/adapter separation refactor** in `_getItemLayoutPosition` (pure-math `placeItem` + DOM adapter) | § Post-#010 (review #4) | ⬜ | | NEW; no bytes saved but enables benchmarking without Playwright, SSR dry runs, future worker offload (review #5 item 5.1 depends on this) |
| **Q** | **`<masonry-grid>` Web Component wrapper** — Custom Element with built-in `MutationObserver` + `ResizeObserver`, encapsulates `new Masonry()` + cleanup, framework-agnostic. Ships as a **separate file** (`dist/masonry-grid-element.js`) so imperative-API users don't pay the bytes. | § Post-#010 (review #5) | ⬜ | | NEW DX win; ~50-100 LOC; works in React/Vue/SvelteKit/vanilla; depends on items H (ResizeObserver) + K (MutationObserver) landing first |
| **R** | **Promise-based async/await API** — `layout()`/`appended()`/`prepended()` return a Promise that resolves after transitions complete | § Post-#010 (review #5) | ⏸️ conditional | | **Conditional on item A**: if hide/reveal animation system is deleted, there's nothing to await. If A is deferred and transitions are kept, this is a real DX win (~30-50 LOC). |
| ↳ alt to B | **CSS Variable staggering** — apply `--index` per item, use `transition-delay: calc(var(--index) * 50ms)` in CSS | § Post-#010 (review #5) | 🟡 alternative | | **Alternative path for item B**: if we KEEP stagger as a feature instead of deleting it, this is a cleaner JS-free implementation (~140 B savings + designer-controllable timing). Decision deferred until item B is sequenced. |
| **— High UX wins (post-#010 review) — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — —** |
| **G** | **Math fix for percentage-width + gutter** | § P.1 (math) | ✅ `v5.0.0-dev.14` | [014-percent-column-width-fix.md](./improvements/014-percent-column-width-fix.md) | **closes desandro/masonry#1006 (53 reactions, top open upstream issue)**; +391 B gz cost; new percent-cols discriminating fixture (3 detection layers: literal `'20%'` option, inline style, walked stylesheet rules) |
| **S** | **`static: true` SSR preset** — single flag that forces `transitionDuration: 0`, skips the #010 `document.fonts.ready` gate, and skips the #012 per-item ResizeObserver construction. For server-rendered grids whose items will not change size after first paint. | § SSR (new, promoted from README candidate list) | ✅ `v5.0.0-dev.15` | [015-static-ssr-preset.md](./improvements/015-static-ssr-preset.md) | +20 B gz cost; new static-mode discriminating fixture (inverse of #012's resize-observer fixture — same operation, opposite expected positions, two fixtures mutually enforce the `static` branch); runtime savings for opt-in users: ~100 fewer `getBoundingClientRect()` calls at construction per 100-item grid + no rAF / promise / CSS-write overhead on subsequent layouts; first-class answer to the SSR ergonomics question enabled by #005's import-safety fix |
| **— PRETEXT + SSR feature line — see [`PRETEXT_SSR_ROADMAP.md`](./PRETEXT_SSR_ROADMAP.md) for the full design — — — — — —** |
| **P** | **Engine/adapter split** — refactor `_getItemLayoutPosition` and supporting helpers into a pure-math `placeItem(size, state)` function plus DOM adapter. Prerequisite for the Node-callable layout helper. | § SSR / `PRETEXT_SSR_ROADMAP` Phase 1 | ✅ `v5.0.0-dev.16` | [016-engine-adapter-split.md](./improvements/016-engine-adapter-split.md) | +164 B gz; 9/9 fixtures pass byte-for-byte against unchanged baselines; subsequent simplify pass extracted `deriveCols` / `applyStamp` / `computeFitContainerWidth` so `proto.*` and `Masonry.computeLayout` share the math structurally |
| **CL** | **`Masonry.computeLayout(opts)` static helper** — pure-Node entry point that takes pre-measured sizes and returns absolute positions. THE killer SSR feature. | § SSR / `PRETEXT_SSR_ROADMAP` Phase 2 | ✅ `v5.0.0-dev.17` | [017-compute-layout-static-helper.md](./improvements/017-compute-layout-static-helper.md) | +393 B gz (later trimmed by simplify); new `compute-layout.mjs` Node-only gate proves byte-for-byte agreement with browser layouts for all 9 fixtures, on the first build; fully typed in `masonry.d.ts` |
| **AD** | **`initLayout: false` SSR adoption verification** — discriminating fixture proving items pre-positioned in arbitrary shapes stay there when masonry constructs with `initLayout: false + static: true`. | § SSR / `PRETEXT_SSR_ROADMAP` Phase 3 | ✅ `v5.0.0-dev.18` | [018-init-layout-false-adoption.md](./improvements/018-init-layout-false-adoption.md) | **0 bundle bytes** (smallest improvement on record); existing infrastructure already worked, fixture locks it in permanently |
| **EX** | **End-to-end Astro SSR example** — runnable demo wiring `pretext.prepare → Masonry.computeLayout → inline positions → client adopts`. CLS = 0.00 measured. | § SSR / `PRETEXT_SSR_ROADMAP` Phase 4 | ✅ `v5.0.0-dev.19` | [019-astro-ssr-pipeline-example.md](./improvements/019-astro-ssr-pipeline-example.md) | `examples/astro/` rewritten end-to-end; documented CLS comparison; Next.js example brought to parity in followup |
| **BH** | **`bench-server-layout.mjs` + `bench-hydration.mjs` + README headline** — the load-bearing measurement step. **MEASURED: CLS 0.7421 → 0.0000 (100% reduction)**, server compute 0.131 ms median for 5000 items. README ⭐️ headline callout in first screen, reproducible by anyone with `make bench`. | § SSR / `PRETEXT_SSR_ROADMAP` Phase 5 (⚠️ non-negotiable) | ✅ `v5.0.0-dev.20` | [020-bench-and-headline.md](./improvements/020-bench-and-headline.md) | The fork's headline number is now in the README; the SSR feature line is COMPLETE |
| **H** | Per-item ResizeObserver for image-overlap | § P.1b | ✅ `v5.0.0-dev.12` | [012-per-item-resize-observer.md](./improvements/012-per-item-resize-observer.md) | **closes desandro/masonry#1147 + 7 duplicates**; +365 B gz cost; new resize-observer discriminating fixture; first attempt's "skip first event" logic was a bug — see calibration lesson |
| K | MutationObserver auto-relayout (opt-in) | § P.2 | ⬜ | | removes the "forgot to call reload" footgun |
| I | Column-pick strategy callback (don't always pick shortest) | § 811 | ⬜ | | closes `#811` (10 reactions) |
| J | Respect parent max-width with `fitWidth` | § 1129 | ⬜ | | closes `#1129` (3 reactions) |
| — | Position via `transform: translate3d` | § 1.3 | ⬜ | | needs benchmarking; modest delta on initial layout, possibly larger on transition smoothness |
| L | WAAPI replaces transition state machine in outlayer/item.js | § P.5 | ⬜ | | needs non-zero-`transitionDuration` fixture; biggest single architectural cleanup |
| — | AbortController for cleanup | § P.8 | ⬜ | | one-call destroy; small follow-on after EvEmitter→EventTarget |
| — | Vendor slimmed Outlayer core | § 2.4 | ⬜ | | last, biggest scope, bundle target ~6 KB min |
| — | TypeScript type definitions | § 2.7 | ⬜ | | DX win; needs `T0.2`'s `types` field to point at it |
| — | IntersectionObserver virtualization | § P.7 | ⬜ | | post-v5, opt-in for 1000+ item grids |
| — | Web Worker layout engine (review #5 item 5.1) | post-v5.1 speculative | ⏸️ deferred | | depends on item P; small win for typical grids, only meaningful at 1000+ items |
| — | ~~Batch read/write layout pass~~ | ~~§ 1.2~~ | ⏸️ already-implemented | | **disproven by #009 bench** — masonry already batches; first reflow flushes, subsequent reads are cached. The pretext fast path's measured 1.2-1.3× speedup is the empirical ceiling. See "Disagreements" in § Post-#010 review. |
| — | ~~Sub-pixel precision (remove rounding hacks)~~ | ~~review #5 item 5.3~~ | ❌ rejected | | **misread the source** — the rounding is for integer col counts, not output positions; you can't span 3.5 columns; output positions are already fractional when columnWidth is. |
| — | ~~TypedArray `Float64Array` for `colYs`~~ | ~~review #5 item 5.4~~ | ❌ rejected | | **negligible perf** — `colYs` length is 3-12; TypedArray vs Array makes microsecond differences at this size; bench shows the colYs operations are a tiny fraction of layout time. |

**v5.0.0-rc.1 ships at the end of step 7 in the new sequencing** (after the size deletions + the breaking changes). v5.0.0 final follows once items P + L + § 2.4 + TS types land.

When updating this table after a change lands: switch the status column, link the improvement file, and add the headline number to the Notes column (e.g. "−1,234 B min.js gz").
