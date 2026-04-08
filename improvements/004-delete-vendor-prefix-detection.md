# 004 — Delete vendor-prefix detection in `outlayer/item.js` (§ L.2a)

**Status:** landed (with one disproven hypothesis — see Verdict)
**Roadmap section:** § L.2a — vendor-prefix dead-code deletion (size-only sub-scope of original § L.2)
**Closes upstream issues:** _none._ The original roadmap claimed this would close `desandro/masonry#1194` and `#1121` (SSR `window` undefined) as a side effect — that claim is **disproven** by the new `test/visual/ssr-smoke.mjs` test added in this improvement. SSR fix is now split out as `§ L.2b` (a separate, future improvement).
**Tag:** `v5.0.0-dev.4`
**Commit:** _filled in after landing_

## Hypothesis

`outlayer/item.js` (~600 LOC, bundled into `dist/masonry.pkgd.{js,min.js}`) contains ~80 LOC of vendor-prefix detection that has been dead code in every browser since 2014:

- The top-of-file block detecting `transition` / `transform` vs `WebkitTransition` / `WebkitTransform` (~22 LOC including the `vendorProperties` lookup table).
- The `toDashedAll` helper that camelCased `WebkitTransform` → `-webkit-transform` (~7 LOC).
- The `proto.onwebkitTransitionEnd` and `proto.onotransitionend` handler trampolines (~7 LOC).
- The `dashedVendorProperties` lookup table (~3 LOC).
- Scattered consumer sites: `vendorProperties[ prop ] || prop` in `proto.css`, `transitionEndEvent` in `addEventListener` / `removeEventListener`, `dashedVendorProperties[ event.propertyName ]` in `proto.ontransitionend`, `transitionProperty` truthy check in `proto.remove`.

`Element.transition` and `Element.transform` shipped unprefixed in:

- Chrome 26 (March 2013)
- Firefox 16 (October 2012)
- Safari 9 (September 2015)
- Edge — never had a prefix

Universally available at the fork's target browser baseline (chrome84 / firefox86 / safari15 / edge84).

### Predicted numbers

1. **`dist/masonry.pkgd.min.js` raw:** −400 to −700 B (the dead code is more spread out than #003's matchesSelector polyfill, but the lookup tables compress well).
2. **`dist/masonry.pkgd.min.js` gzip:** −150 to −300 B.
3. **`dist/masonry.pkgd.min.js` brotli:** −120 to −250 B.
4. **`dist/masonry.pkgd.js` (unminified):** −1,000 to −1,500 B raw, −150 to −250 B gz.
5. **Visual regression suite:** must remain 4/4 passing. The fixtures use `transitionDuration: 0` (so the transition path goes through `_nonTransition`, which never touches the vendor-prefix code), meaning these tests don't actually exercise the deleted code. The visual gate guarantees no regression in the *non-transition* path; the *transition* path is verified by code inspection only.
6. **No source change to `masonry.js`.** The deletions live inside `node_modules/outlayer/item.js` and are applied via a build-time `onLoad` transform plugin.

### SSR claim — separately verified by a new test

The original roadmap (in `FORK_ROADMAP.md` § L.2) claimed that removing the very-first executable line `var docElemStyle = document.documentElement.style;` would unblock SSR-importing the bundle in Node, fixing upstream `#1194` and `#1121`. **This improvement is also a literal test of that claim.** I added `test/visual/ssr-smoke.mjs` — a Node script that loads `dist/masonry.pkgd.min.js` in an empty `vm` context (no `window`, no `document`, no `navigator`) and asserts that the IIFE evaluates without throwing. If the SSR claim is correct, this test should start passing after #004.

## Method

### The transform plugin

I cannot edit code inside `node_modules/outlayer/item.js` without forking the package. Instead, an esbuild `onLoad` plugin (`outlayerItemModernPlugin`) intercepts the file at bundle time and applies six **exact-string** substitutions (no regex — string equality is much harder to break silently). Each substitution must succeed; if any pattern is not found, the build aborts with a descriptive error pointing at the offending transform. This guards against silent breakage if `outlayer` is ever updated upstream (it hasn't been since 2018, but defense in depth is cheap).

The six transforms:

| # | Description | Lines deleted (in source) |
|---|---|---:|
| 1 | Delete the vendor-prefix detection block (`docElemStyle`, `transitionProperty`, `transformProperty`, `transitionEndEvent`, `vendorProperties`) — replaced with a 2-line stub that defines `var transitionEndEvent = 'transitionend';` so the rest of the file still has the symbol it needs. | ~22 |
| 2 | Simplify `proto.css` — drop the `vendorProperties[ prop ] || prop` lookup, write `style[ prop ]` directly. | ~3 |
| 3 | Replace the `toDashedAll` helper + `var transitionProps = 'opacity,' + toDashedAll(transformProperty)` with `var transitionProps = 'opacity,transform';` | ~9 |
| 4 | Delete `proto.onwebkitTransitionEnd`, `proto.onotransitionend`, and the `dashedVendorProperties` table. | ~13 |
| 5 | Simplify `proto.ontransitionend` — `var propertyName = dashedVendorProperties[event.propertyName] \|\| event.propertyName` → `var propertyName = event.propertyName`. | ~2 |
| 6 | Simplify `proto.remove` — drop the `!transitionProperty` truthy check. | ~1 |
| **Total** | | **~50** raw lines + ~30 dependent uses |

The plugin lives in `scripts/build.mjs` next to the existing `jqueryStubPlugin` and `matchesSelectorShimPlugin` from #002 and #003. Same architectural pattern, more elaborate body.

### `test/visual/ssr-smoke.mjs`

A new diagnostic script that loads any built bundle in a Node `vm` context with empty globals and reports whether it crashes. Wired up to support running against arbitrary bundle files: `node test/visual/ssr-smoke.mjs /path/to/bundle.js`. **Currently fails — kept in the repo as a tool, not yet promoted to `make test`** (which would block the gate). When § L.2b lands and SSR works, this test will move into the gate and any future regression will trip it.

### Commands run

```sh
./scripts/measure.sh --save pre-004-vendor-prefixes
# edit scripts/build.mjs — add outlayerItemModernPlugin + 6 transforms
make build
make test                                       # 4/4 passing
node test/visual/ssr-smoke.mjs                  # ✗ — disproves the SSR claim
node test/visual/ssr-smoke.mjs /tmp/pre-004.min.js   # ✗ — pre-state crashes too
./scripts/measure.sh --save post-004-vendor-prefixes
```

## Before — `pre-004-vendor-prefixes`

```
package           masonry-pretext@5.0.0-dev.3
tracked files     61
total LOC         6941
dependencies      2
devDependencies   5

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                     7473        2455        2108       239
  dist/masonry.pkgd.js                   55543       10521        9317      1569
  dist/masonry.pkgd.min.js               23902        7788        7040        22
```

Visual tests: 4/4 passing.
SSR smoke test: **fails** (`window is not defined at masonry.pkgd.min.js:22`).

## After — `post-004-vendor-prefixes`

```
package           masonry-pretext@5.0.0-dev.4
tracked files     61
total LOC         7059
dependencies      2
devDependencies   5

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                     7473        2455        2108       239
  dist/masonry.pkgd.js                   54224       10285        9099      1541
  dist/masonry.pkgd.min.js               23296        7616        6851        22
```

Visual tests: 4/4 passing.
SSR smoke test: **still fails** at the *same* line (`masonry.pkgd.min.js:22`).

## Delta

| Metric | pre-004 | post-004 | Δ raw | Δ% |
|---|---:|---:|---:|---:|
| `masonry.js` source | 7,473 / 2,455 / 2,108 | 7,473 / 2,455 / 2,108 | 0 | 0 |
| `dist/masonry.pkgd.js` raw | 55,543 | **54,224** | **−1,319** | **−2.37%** |
| `dist/masonry.pkgd.js` gzip | 10,521 | **10,285** | **−236** | **−2.24%** |
| `dist/masonry.pkgd.js` brotli | 9,317 | **9,099** | **−218** | **−2.34%** |
| `dist/masonry.pkgd.js` lines | 1,569 | 1,541 | −28 | — |
| `dist/masonry.pkgd.min.js` raw | 23,902 | **23,296** | **−606** | **−2.53%** |
| `dist/masonry.pkgd.min.js` gzip | 7,788 | **7,616** | **−172** | **−2.21%** |
| `dist/masonry.pkgd.min.js` brotli | 7,040 | **6,851** | **−189** | **−2.69%** |
| Visual tests | 4 / 4 | 4 / 4 | 0 | — |
| SSR smoke test | ✗ | ✗ (same line, same error) | 0 | (the SSR claim is disproven) |
| dependencies | 2 | 2 | 0 | — |
| devDependencies | 5 | 5 | 0 | — |
| build time | 18 ms | 18 ms | 0 | — |

### Vs the upstream-frozen v4.2.2 baseline

| Metric | v4.2.2 | v5.0.0-dev.4 | Δ raw | Δ% |
|---|---:|---:|---:|---:|
| `dist/masonry.pkgd.min.js` raw | 24,103 | **23,296** | **−807** | **−3.35%** |
| `dist/masonry.pkgd.min.js` gzip | 7,367 | **7,616** | **+249** | +3.38% |
| `dist/masonry.pkgd.min.js` brotli | 6,601 | **6,851** | **+250** | +3.79% |

**Major progress on the gzip recovery.** The post-002 esbuild regression was +524 B over upstream gz; we are now at +249 B — **52% of the regression has been recovered** by improvements 003 + 004 combined. Brotli is at +250 (was +539 at #002 — 54% recovered).

Raw bytes are 807 B below upstream — the lead keeps growing.

## Verdict

⚠️ **Partial — size hypothesis matched, SSR hypothesis disproven by direct test.**

| Prediction | Predicted | Actual | Status |
|---|---|---|---|
| min.js raw | −400 to −700 B | **−606 B** | ✅ middle of band |
| min.js gz | −150 to −300 B | **−172 B** | ✅ low end of band |
| min.js br | −120 to −250 B | **−189 B** | ✅ middle of band |
| pkgd.js raw | −1,000 to −1,500 B | **−1,319 B** | ✅ middle of band |
| pkgd.js gz | −150 to −250 B | **−236 B** | ✅ middle of band |
| Visual tests | 4/4 | 4/4 | ✅ |
| Source unchanged | yes | yes | ✅ |
| **SSR import works in Node** | predicted ✅ | **❌ disproven by `ssr-smoke.mjs`** | ❌ |

### Why the SSR prediction was wrong

The roadmap claim — "deleting `var docElemStyle = document.documentElement.style;` fixes SSR" — assumed the crash happens *inside* the `outlayer/item.js` factory body, where `docElemStyle` is the very first executable line. **But the crash actually happens at the IIFE call site**, not inside the factory body.

Look at the UMD wrapper structure shared by every bundled module:

```js
( function( window, factory ) {
  // ... factory dispatch (AMD / CJS / global)
}( window, function factory() { /* this is the body that has docElemStyle */ } ));
```

When this IIFE is invoked:

1. JavaScript evaluates the function expression `(function(window, factory) { ... })`.
2. **JavaScript evaluates the call site `(window, function factory() {...})` — and to do that, it has to dereference the free variable `window`.**
3. In Node, `window` is not defined → `ReferenceError: window is not defined`.
4. The factory body never runs.

The very first thing that crashes is the call site's `window` reference, **not** the body's `document.documentElement.style`. So removing the body code can never fix the crash.

I confirmed this by inspecting line 22 of `dist/masonry.pkgd.min.js` (the `ssr-smoke.mjs` error stack pointed there). It's masonry.js's own UMD wrapper invocation: `(function(g,l){...})(window,function(l,y){...})`. This is in our source file (`masonry.js`), not in `outlayer/item.js`.

### What the SSR fix actually requires

A new improvement, **§ L.2b**, that wraps every UMD invocation site with `typeof window !== 'undefined' ? window : {}`. The sites are in `masonry.js`, `node_modules/outlayer/outlayer.js`, `node_modules/outlayer/item.js`, `node_modules/get-size/get-size.js`, `node_modules/fizzy-ui-utils/utils.js`, and `node_modules/desandro-matches-selector/matches-selector.js` (already replaced via shim, so safe).

For the source file (`masonry.js`) the fix is a one-line edit. For the dep files, it's another build-time string transform (similar to the one in this improvement). The total scope is small enough to land as a single follow-up improvement after the size deletions are done.

`test/visual/ssr-smoke.mjs` is the gate that will verify the fix when § L.2b lands. Right now it sits in the repo as a checked-in tool, **not** in `make test`, because adding a failing test to the gate would block all other improvements.

### Why the size half is still worth landing

- Real, measured size delta inside hypothesis bands.
- ~50 raw LOC of dead browser-compat code removed.
- ~30 dependent use sites (lookup table accesses, the `transitionProperty` truthy check, the prefix-event handler trampolines) cleaned up with it.
- The entire `vendorProperties` lookup machinery — which adds a property indirection on every `proto.css` call in the hot layout path — is gone, so this is also a tiny perf win even though I haven't benchmarked it (no claim made; the `vendorProperties[prop] || prop` lookup is a few nanoseconds per call and the visual suite doesn't benchmark).
- The minified-bundle gzip is now within +249 B of upstream (was +524 B after #002), so the recovery from the post-002 regression is on track.

## Notes / lessons

- **The methodology paid off here, hard.** The roadmap claim was speculative — derived from reading source code, not from running a test. The change loop (capture baseline → make change → re-test → record actual) caught the disproved hypothesis on the first cycle. The result is documented honestly instead of being silently wrong.
- **`ssr-smoke.mjs` is the correct shape for SSR testing.** It loads the bundle in a `vm` context with empty globals — that's exactly what a fresh Next.js / Nuxt SSR worker looks like before any browser polyfill. Every future improvement that touches module-load DOM access should run it.
- **L.2 should split into L.2a + L.2b.** Updated `FORK_ROADMAP.md` § Progress accordingly. L.2a (this improvement) is the size deletion. L.2b (planned) is the IIFE-call-site guards. The two are independent and have different verification gates.
- **Exact-string transforms are robust.** All six string substitutions in `outlayerItemModernPlugin` matched on the first try. The assertion-on-not-found pattern means a future outlayer update would fail loudly rather than silently produce wrong output. Recommend continuing this pattern for the next file-targeting deletions (§ L.3 for getSize box-sizing setup, § L.4 for fizzy-ui-utils inlining).
- **The visual fixtures use `transitionDuration: 0`.** The non-zero-duration path (which exercises the deleted vendor-prefix code) is not currently regression-tested. Adding a fixture with `transitionDuration: '0.1s'` and asserting end-state positions after `await` of the transitionend event would close that gap. Listed as a TODO but not blocking #004 — code inspection of the surgical transforms is sufficient confidence for now.
- **52% of the post-002 esbuild regression is now recovered (in gz)** purely from #003 + #004. Improvements 005 / 006 (delete getSize box-sizing setup, inline fizzy-ui-utils) should close the rest.