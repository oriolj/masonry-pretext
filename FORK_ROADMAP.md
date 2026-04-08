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

### 2.5 Drop jQuery from the default packaged build

**What.** Stop bundling `jquery-bridget` into `dist/masonry.pkgd.js`. Ship two builds:
- `dist/masonry.js` — vanilla, no jQuery
- `dist/masonry.jquery.js` — with bridget, for legacy consumers

**Why measurable.** Removes jquery-bridget from the default download. Most new projects in 2026 don't use jQuery; making them pay for it by default is wrong.

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
| 4b | Delete vendor-prefix detection | § L.2 | ⬜ | | closes desandro/masonry#1194, #1121 (SSR) |
| 4c | Delete getSize box-sizing setup | § L.3 | ⬜ | | IE11 / Firefox <29 quirk, dead in 2026 |
| 4d | Delete setTimeout(0) docReady wrapper | § L.6 | ⬜ | | flickity-specific workaround |
| 5a | ResizeObserver: container resize | § P.1a | ⬜ | | replaces window resize + 100ms debounce |
| 5b | ResizeObserver: per-item auto-relayout | § P.1b | ⬜ | | **closes 8+ image-overlap issues** |
| 5c | ResizeObserver: drop getSize() in needsResizeLayout | § P.1c | ⬜ | | |
| 6 | Batch read/write layout pass | § 1.2 | ⬜ | | biggest perf win without API change |
| 7 | Pretext integration (opt-in callback) | § 1.1 | ⬜ | | headline fork feature |
| 8a | `document.fonts.ready` first-paint gate | § P.4 | ⬜ | | closes desandro/masonry#1182 |
| 8b | MutationObserver auto-layout (opt-in) | § P.2 | ⬜ | | kills the "forgot to call reload" footgun |
| 9 | Position via `transform: translate3d` | § 1.3 | ⬜ | | compositor-only, no layout invalidation |
| 10a | WAAPI replaces transition state machine | § P.5 | ⬜ | | deletes ~120 LOC of Outlayer/Item |
| 10b | EventTarget replaces EvEmitter | § P.3 | ⬜ | | deletes EvEmitter dep entirely |
| 10c | AbortController for cleanup | § P.8 | ⬜ | | one-call destroy |
| 11 | Fix percentage width + gutter math | § P.1 (math) | ⬜ | | **closes desandro/masonry#1006 (53 reactions)** |
| 12 | Vendor slimmed Outlayer core | § 2.4 | ⬜ | | last, biggest scope, bundle target ~6 KB min |
| — | IntersectionObserver virtualization | § P.7 | ⬜ | | post-v5, opt-in for 1000+ item grids |

**v5.0.0 ships at the end of step 11.** Step 12 + § P.7 are v5.1+.

When updating this table after a change lands: switch the status column, link the improvement file, and add the headline number to the Notes column (e.g. "−1,234 B min.js gz").
