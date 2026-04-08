# 005 — SSR import fix: wrap UMD call sites + guard `docReady` (§ L.2b)

**Status:** landed
**Roadmap section:** § L.2b — SSR safety (the half of original § L.2 that #004 disproved as a "free side effect")
**Closes upstream issues:** **`desandro/masonry#1194` and `#1121`** ("`window` undefined" / SSR fix), **`#1201`** ("vite build fails" — same root cause: bundle crashes during SSR build pass)
**Tag:** `v5.0.0-dev.5`
**Commit:** _filled in after landing_

## Hypothesis

Improvement #004 disproved the original roadmap claim that "deleting the `var docElemStyle = document.documentElement.style;` line in `outlayer/item.js` fixes SSR." The new `test/visual/ssr-smoke.mjs` (added in #004) showed the actual crash is **one stack frame earlier**, at the UMD wrapper IIFE call site:

```js
( function( window, factory ) { ... }( window, function factory(...) { ... } ));
//                                       ^^^^^^
//                                       bare `window` — throws ReferenceError in Node
```

This improvement is the actual SSR fix. Wrap every UMD wrapper's call site with `typeof window !== 'undefined' ? window : {}`. In a browser the guard evaluates to the real `window`. In Node it evaluates to `{}`, which means subsequent reads inside the factory body (`window.console`, `window.jQuery`, …) become `undefined` instead of throwing — and the existing falsy checks already handle that.

### Predicted numbers

1. **`test/visual/ssr-smoke.mjs` flips from ✗ → ✓.** This is the gate.
2. **Visual regression suite stays 4/4.** Browser behavior is identical because the guard always evaluates to the real `window`.
3. **`dist/masonry.pkgd.min.js` raw: +50 to +200 B.** The guard expression `typeof window !== 'undefined' ? window : {}` is ~40 chars, applied to 6 call sites (5 deps + 1 source file). After minification each occurrence compresses to ~25 chars. Predicted total: ~150 B raw, ~30 B gzipped (the repeated string compresses well).
4. **`masonry.js` source: +30 to +50 B raw.** One direct edit on line 33.
5. **No change to runtime dependencies.** Pure source/build patches.

I expected the SSR fix to take **one** UMD-call-site patch per file. The actual investigation surfaced **two more** patches I hadn't planned for, both caught by iterative `ssr-smoke.mjs` runs:

- `jquery-bridget`'s UMD wrapper (I forgot it gets bundled via the entry file).
- `fizzy-ui-utils.docReady` — called transitively from `Outlayer.create('masonry')` at module load, dereferences `document.readyState`.

Each iteration of build → ssr-smoke → fix → rebuild surfaced a new crash one frame deeper. The methodology made each "still broken" cycle a 30-second iteration, not a half-day debugging session.

## Method

### Source edit (`masonry.js`)

One-line change. **This is the only direct source edit in any improvement so far** — every other patch went through a build-time esbuild plugin because it lived inside `node_modules/`. `masonry.js` is our file, so we just edit it.

```diff
-}( window, function factory( Outlayer, getSize ) {
+}( typeof window !== 'undefined' ? window : {}, function factory( Outlayer, getSize ) {
```

This benefits **both** `dist/` consumers (via the bundled output) and anyone who imports `masonry.js` directly via `require('masonry-pretext')` (the package's `main` entry).

### Build-time patches (`scripts/build.mjs`)

The vendor-prefix plugin from #004 (`outlayerItemModernPlugin`) gains a 7th transform that wraps `outlayer/item.js`'s UMD call site. The new `ssrDomGuardPlugin` handles four other dep files via a restructured `SSR_FILE_PATCHES` array (one entry per file, each with multiple transforms). Restructure was needed because esbuild only allows one `onLoad` handler per `(filter, namespace)` pair — chaining transforms in one handler is the only way to give a single file multiple patches without plugin conflict.

Transforms applied by `ssrDomGuardPlugin`:

| File | Transform | Purpose |
|---|---|---|
| `node_modules/outlayer/outlayer.js` | wrap UMD call site | guard module-load `window` access |
| `node_modules/jquery-bridget/jquery-bridget.js` | wrap UMD call site | (forgot this one initially — caught by `ssr-smoke.mjs` iteration #2) |
| `node_modules/get-size/get-size.js` | wrap UMD call site | guard module-load `window` access |
| `node_modules/fizzy-ui-utils/utils.js` | wrap UMD call site | guard module-load `window` access |
| `node_modules/fizzy-ui-utils/utils.js` | inject `typeof document` guard at top of `docReady` | (forgot this too — caught by `ssr-smoke.mjs` iteration #3) `Outlayer.create('masonry')` runs at module load and transitively calls `docReady` which dereferences `document.readyState` |

Plus the existing `outlayerItemPatchPlugin` gets a 7th transform for `outlayer/item.js`'s UMD call site (in the same plugin because esbuild's onLoad-per-file uniqueness rule).

`ev-emitter`'s UMD wrapper is **already** SSR-safe — its source uses `typeof window != 'undefined' ? window : this`. No patch needed.

### `ssr-smoke.mjs` promoted to the gate

`make test` (and `npm test`) now runs both the visual regression suite **and** the SSR smoke test. The methodology rule "no improvement lands with a failing test" now applies to SSR import compatibility, not just visual layout. Future improvements that touch module-load DOM access will be blocked at the gate if they introduce a regression.

Also added explicit npm scripts:
- `npm run test` — visual + ssr (the gate)
- `npm run test:visual` — visual only
- `npm run test:ssr` — ssr only

### Iteration log (the actual debugging journey)

1. **Iteration 1.** Patch masonry.js + outlayer.js + outlayer/item.js + get-size.js + fizzy-ui-utils.js. Build. Run ssr-smoke.
   - `✗ document is not defined at masonry.pkgd.min.js:12` (different error than the pre-005 `window is not defined` — progress).
2. Inspect the line. It's inside `fizzy-ui-utils.docReady` reading `document.readyState`. Stack shows `Outlayer.create` → `htmlInit` → `docReady` chain.
3. **Iteration 2.** Add the `docReady` guard. Build. Run ssr-smoke.
   - `✗ window is not defined at masonry.pkgd.min.js:22`. Different line — progress.
4. Inspect the line. It's `jquery-bridget`'s UMD wrapper, which I had forgotten is in the bundle (it's added via the entry file's `require('jquery-bridget')`).
5. **Iteration 3.** Add the jquery-bridget UMD guard. Build. Run ssr-smoke.
   - `✓ masonry.pkgd.min.js loads in DOM-less context` ✅

Three iterations, ~5 minutes each. The `ssr-smoke.mjs` test surfaced each missing patch as the previous one was fixed. Without the test the same fix would have taken hours of guess-and-check.

### Commands run (final)

```sh
./scripts/measure.sh --save pre-005-ssr
# edit masonry.js — line 33 UMD guard
# edit scripts/build.mjs — add transform #7 to outlayerItemPatchPlugin
# edit scripts/build.mjs — add ssrDomGuardPlugin with 4 file targets
make build && make test           # 4/4 visual + ✓ ssr
# bump pkg.json version → 5.0.0-dev.5
./scripts/measure.sh --save post-005-ssr
```

## Before — `pre-005-ssr`

```
package           masonry-pretext@5.0.0-dev.4
tracked files     63
total LOC         7389
dependencies      2
devDependencies   5

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                     7473        2455        2108       239
  dist/masonry.pkgd.js                   54224       10285        9099      1541
  dist/masonry.pkgd.min.js               23296        7616        6851        22
```

Visual tests: 4/4 passing.
SSR smoke test: **✗ fails** (`window is not defined at masonry.pkgd.min.js:22`).

## After — `post-005-ssr`

```
package           masonry-pretext@5.0.0-dev.5
tracked files     63
total LOC         7531
dependencies      2
devDependencies   5

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                     7510        2473        2116       239
  dist/masonry.pkgd.js                   54501       10293        9107      1542
  dist/masonry.pkgd.min.js               23450        7629        6898        22
```

Visual tests: 4/4 passing.
SSR smoke test: **✓ passes** (`Masonry export type: function`).

## Delta

| Metric | pre-005 | post-005 | Δ raw | Δ% |
|---|---:|---:|---:|---:|
| `masonry.js` source raw | 7,473 | 7,510 | **+37** | +0.50% |
| `masonry.js` source gzip | 2,455 | 2,473 | +18 | +0.73% |
| `dist/masonry.pkgd.js` raw | 54,224 | 54,501 | **+277** | +0.51% |
| `dist/masonry.pkgd.js` gzip | 10,285 | 10,293 | +8 | +0.08% |
| `dist/masonry.pkgd.js` brotli | 9,099 | 9,107 | +8 | +0.09% |
| `dist/masonry.pkgd.min.js` raw | 23,296 | **23,450** | **+154** | **+0.66%** |
| `dist/masonry.pkgd.min.js` gzip | 7,616 | **7,629** | **+13** | **+0.17%** |
| `dist/masonry.pkgd.min.js` brotli | 6,851 | **6,898** | **+47** | **+0.69%** |
| Visual regression tests | 4 / 4 | 4 / 4 | 0 | — |
| **SSR smoke test** | **✗** | **✓** | — | **first pass** |
| dependencies | 2 | 2 | 0 | — |
| devDependencies | 5 | 5 | 0 | — |
| build time | 18 ms | 18 ms | 0 | — |

### Vs upstream-frozen v4.2.2

| Metric | v4.2.2 | v5.0.0-dev.5 | Δ |
|---|---:|---:|---:|
| `dist/masonry.pkgd.min.js` raw | 24,103 | **23,450** | **−653 B (−2.71%)** |
| `dist/masonry.pkgd.min.js` gzip | 7,367 | 7,629 | +262 B |
| `dist/masonry.pkgd.min.js` brotli | 6,601 | 6,898 | +297 B |
| **SSR import works** | ✗ | **✓** | first time |

Raw bytes are still 653 B below upstream after the +154 B SSR cost. Gzip recovery is now at +262 B (was +249 B at #004 — the +13 B SSR cost is the entirety of the regression). Brotli grew slightly more (+47 B) because the guard string repeats and brotli's dictionary handles it less efficiently than gzip.

## Verdict

✅ **Match.** The size cost was very small and the SSR gate flipped to ✓.

| Prediction | Predicted | Actual | Status |
|---|---|---|---|
| ssr-smoke flips ✗ → ✓ | yes | **yes** | ✅ first pass after 3 iterations |
| Visual tests stay 4/4 | yes | yes | ✅ |
| `min.js` raw growth | +50 to +200 B | **+154 B** | ✅ middle of band |
| `min.js` gzip growth | ~+30 B | **+13 B** | ✅ better than predicted |
| `masonry.js` source raw | +30 to +50 B | **+37 B** | ✅ middle of band |
| Runtime deps unchanged | yes | yes | ✅ |

The under-prediction on iteration count (planned 1 round of patches; actually needed 3) is itself a methodology win — `ssr-smoke.mjs` surfaced each missing patch in <30 seconds and the fix loop converged in minutes.

## Notes / lessons

- **Per-improvement gates compound.** `ssr-smoke.mjs` was added in #004 as a diagnostic tool that didn't yet pass. In #005 it became the verification mechanism that drove the fix to convergence. Going forward it's part of `make test`, so any future improvement that touches module-load DOM access is blocked by the gate. **This is the methodology working at its best**: a test added to document a bug becomes the gate that prevents the bug from coming back.
- **Bundles have hidden module-load DOM accesses.** Even after thinking I had identified all the call sites by reading source, I missed two:
  1. **jquery-bridget** because I'd been thinking of it as "an optional shim that no-ops in Node"; in reality it has its own UMD wrapper that crashes at the call site before its body has a chance to no-op.
  2. **`fizzy-ui-utils.docReady`** because I hadn't realized `Outlayer.create('masonry')` runs at module load (in `masonry.js`'s factory body) and transitively reaches `htmlInit` → `docReady`. Reading source for "what runs at module load" is harder than running the bundle in a `vm` context and watching it crash.
- **Reading source to predict crashes is unreliable.** Running the bundle in a Node `vm` context with empty globals is the only way to be sure. Cost of one iteration: ~30 seconds. Recommend running ssr-smoke before *and* after every improvement that touches dep code.
- **The +13 B gzip cost is essentially free.** SSR support is a major UX feature (closes upstream `#1194`, `#1121`, `#1201` — all dormant for 1-2 years with no upstream movement). Trading 13 gzipped bytes for it is a great ratio.
- **Brotli is more sensitive to repeated string patterns than gzip here.** The same guard literal `typeof window !== 'undefined' ? window : {}` appears 6 times. Gzip's LZ77-based deduplication compresses this almost to nothing (+13 B); Brotli's dictionary-based scheme handles it less efficiently (+47 B). Both metrics matter — track them separately.
- **The improvement file count (`tracked files`) didn't change.** I added the new `improvement-005` doc but the methodology files balance out — no foundation files added, no infrastructure created. This is the first improvement that touches *only* the change loop's payload (source + build script) without any scaffolding.
- **`masonry.js` source is now 7,510 B vs 7,473 B before.** The +37 B is one direct line edit that adds the typeof guard to the UMD call site. This is the *first* source edit in the fork — every previous improvement went through a build-time plugin. The cost is paid by both `dist/` consumers AND anyone who imports `masonry.js` directly via `require('masonry-pretext')`.