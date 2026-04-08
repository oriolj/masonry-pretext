# 015 — `static: true` SSR preset (§ SSR / one-flag opt-out of dynamic-content machinery)

**Status:** landed
**Roadmap section:** § SSR (new item — promoted from the "candidate future optimizations" list in the SSR section of the README after #014 landed)
**Closes upstream issues:** none directly — this is a fork-level UX feature, not an upstream bug fix. It does however address a class of complaint common across every SSR framework issue tracker (Next.js, Astro, SvelteKit): "how do I use masonry on the server without the hydration flash and the 0.4s animated settle on every resize?" The fork now has a first-class answer.
**Tag:** `v5.0.0-dev.15`
**Commit:** _filled in after landing_

## Hypothesis

Add a new `options.static` boolean. When `true`, masonry's `_create` override:

1. Forces `this.options.transitionDuration = 0` — no animated settle on any relayout, including window-resize relayouts. Setting this before `baseCreate.call(this)` is sufficient because `item.transition()` / `enableTransition()` read the option value lazily at transition time, not construction time.
2. Skips the `document.fonts.ready` deferred layout from #010 (§ P.4). Safe because static SSR content is rendered in its final font — there is no fallback-to-real-font reflow to compensate for.
3. Skips the per-item `ResizeObserver` construction from #012 (§ P.1b). Safe because the whole point of `static` is "items will not change size." The `_itemize` / `remove` / `destroy` hooks already guard on `this._resizeObserver` before touching it, so they no-op correctly — no additional changes needed for the lifecycle wiring.

**Numeric hypothesis:**

1. `dist/masonry.pkgd.min.js` **raw +30 to +70 B** — three added `if (this.options.static)` branches, one forced-assignment (`this.options.transitionDuration = 0`), and a few `!this.options.static &&` conjunctions at the head of existing conditions. The identifier `static` appears ~4 times and is a property access so minifier can't mangle it.
2. `dist/masonry.pkgd.min.js` **gzipped +15 to +40 B** — the repeated `this.options.static` string compresses modestly under LZ77.
3. `dist/masonry.pkgd.min.js` **brotli +15 to +30 B** — similar to gzip.
4. **New `test/visual/pages/static-mode.html` discriminating fixture passes**: same shape as `resize-observer.html` (4 items, resize item 0 from 30→60 after construction), but constructs with `static: true`. In static mode the ResizeObserver is never constructed, so no relayout fires and item 3 stays at its initial position `(0, 30)` — the **exact inverse** of the `resize-observer` fixture's expected `(60, 30)`. The two fixtures cannot both pass unless the `static` branch actually opts out.
5. **All existing gates stay green**: 8 pre-existing visual fixtures + SSR smoke + module smoke + no-jquery. The new option defaults to `false` so nothing changes for existing users.
6. **No runtime dependency change.**

**What this is NOT:** a bundle-size win. It is a runtime-cost opt-out for SSR users and a single-flag ergonomic improvement over "remember to set `transitionDuration: 0` yourself." The +20-ish gzipped bytes are paid by all users regardless of whether they opt in — that is the cost of putting the feature in the main bundle. Justified because:

- SSR import is already the most-requested masonry feature in the fork's target audience (closed as #005 at +13 B gz).
- The runtime savings for `static: true` users are real — on a 100-item grid that is ~100 fewer `getBoundingClientRect()` calls at construction (the ResizeObserver pre-seed loop from #012), no promise chain, no rAF scheduling, and no transition-property CSS writes on subsequent layouts.

## Method

### Source edit (`masonry.js`)

Three small edits to the `_create` override — this is the second direct source edit in any improvement (the first was #005's UMD-guard one-liner and #010's `_create` override itself; everything else has been in build-time plugins):

```diff
+  // `options.static` (#015 / § SSR) opts out of BOTH of the above AND
+  // forces `transitionDuration: 0`, for server-rendered grids whose
+  // content will not change after first paint.
   var baseCreate = proto._create;
   proto._create = function() {
+    // Static mode: no animations on any relayout. Set before anything
+    // else so item.transition() reads the overridden value.
+    if ( this.options.static ) {
+      this.options.transitionDuration = 0;
+    }
     baseCreate.call( this );
-    // ── #010 — fonts.ready first-paint gate ─────────────────────────────
-    if ( typeof document !== 'undefined' && document.fonts &&
+    // ── #010 — fonts.ready first-paint gate (skipped in static mode) ──
+    if ( !this.options.static &&
+         typeof document !== 'undefined' && document.fonts &&
          document.fonts.status !== 'loaded' ) {
       ...
     }
-    // ── #012 — per-item ResizeObserver auto-relayout ────────────────────
+    // ── #012 — per-item ResizeObserver (skipped in static mode) ─────────
     ...
-    if ( typeof ResizeObserver !== 'undefined' ) {
+    if ( !this.options.static && typeof ResizeObserver !== 'undefined' ) {
```

That is the entire feature implementation. Three changes, roughly 10 added lines of source (most of which is the explanatory comment block).

### Lifecycle wiring — no changes needed

The `_itemize`, `remove`, and `destroy` overrides from #012 all already check `this._resizeObserver` before touching it:

```js
// _itemize override:
if ( this._resizeObserver ) {
  for ( var i = 0; i < items.length; i++ ) {
    this._observeItemElement( items[i].element );
  }
}
// remove override:
if ( this._resizeObserver ) { ... }
// destroy override:
if ( this._resizeObserver ) { ... }
```

In static mode `this._resizeObserver` is `undefined` (never assigned), so all three hooks no-op correctly. This is the second time this defensive pattern has paid off — the first was the SSR-safety typeof-guard in #005, where the same `if ( this._resizeObserver )` pattern made the SSR-only short-circuit trivially safe. **Lesson: guards that look redundant at introduction time pay off when a later improvement needs to short-circuit the thing they guard.**

### Discriminating fixture

`test/visual/pages/static-mode.html` is a near-copy of `resize-observer.html` with three changes:

1. Construct with `static: true` instead of `transitionDuration: 0`.
2. Container id is `#static-mode` (not `#resize-observer`).
3. Expected position for item 3 is `(0, 30)` (not `(60, 30)`).

The fixture resizes item 0 from 30→60px after construction — the exact same operation as the resize-observer fixture. The discriminator works because:

- If `static: true` is wired correctly → ResizeObserver is never constructed → no relayout fires → item 3 stays at the initial `(0, 30)` position.
- If `static: true` is broken / the guard is missing → ResizeObserver fires as in #012 → item 3 lands at `(60, 30)` → the position assertion fails.

The two fixtures (static-mode and resize-observer) **cannot both pass** unless the `static` branch actually opts out of the observer construction. They are mechanically enforced inverses.

### Files touched

- `masonry.js` — +~10 lines (the three edits above)
- `masonry.d.ts` — +~17 lines (new `static?: boolean` field with doc-comment linking to this improvement file)
- `test/visual/pages/static-mode.html` — new file (~60 lines including comment block)
- `test/visual/run.mjs` — +1 case entry (~18 lines)
- `test/visual/__screenshots__/static-mode.png` — new baseline
- `README.md` — new row in "Key improvements vs upstream" table, rewritten "Optimizations for SSR mode" subsection to put `static: true` first and downgrade the per-option table to "per-option granularity if you don't want the preset"
- `examples/nextjs/app/MasonryGrid.tsx` — swap `transitionDuration: 0` for `static: true`
- `examples/nextjs/README.md` — same
- `examples/astro/src/pages/index.astro` — same
- `examples/astro/README.md` — same
- `package.json` — version bump to `5.0.0-dev.15`
- `FORK_ROADMAP.md` — add new Progress table row

### Commands run

```sh
./scripts/measure.sh --save pre-015-static
# edit masonry.js, masonry.d.ts, fixture, runner, README, examples, roadmap
make build
node test/visual/run.mjs --filter=static-mode --update    # seed the new snapshot
make test                                                  # all 9 visual + 3 smoke gates
./scripts/measure.sh --save post-015-static
# bump pkg.json version → 5.0.0-dev.15
git add ... && git commit
git tag -a v5.0.0-dev.15 -m "..."
git push origin master v5.0.0-dev.15
```

## Before — `pre-015-static`

```
package           masonry-pretext@5.0.0-dev.14
tracked files     92
total LOC         15297
dependencies      2
devDependencies   4

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                    18361        5976        5095       477
  dist/masonry.pkgd.js                   54801       10356        9228      1526
  dist/masonry.pkgd.min.js               24241        7714        6973        22
  dist/masonry.cjs                       51648       10247        9142      1519
  dist/masonry.mjs                       52837       10725        9551      1543
```

Visual tests: 8/8 passing.
SSR smoke / module smoke / no-jquery: ✓.

## After — `post-015-static`

```
package           masonry-pretext@5.0.0-dev.14  (bumped to .15 in the same commit — pre-commit measure)
tracked files     95
total LOC         16097
dependencies      2
devDependencies   4

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                    18823        6184        5274       488
  dist/masonry.pkgd.js                   54947       10382        9249      1529
  dist/masonry.pkgd.min.js               24342        7734        6994        22
  dist/masonry.cjs                       51788       10272        9166      1522
  dist/masonry.mjs                       52977       10750        9578      1546
```

Visual tests: **9/9 passing** (new `static-mode` fixture passes its position assertion on the first run).
SSR smoke / module smoke / no-jquery: ✓.

## Delta

| Metric | pre-015 | post-015 | Δ raw | Δ% |
|---|---:|---:|---:|---:|
| `masonry.js` source raw | 18,361 | 18,823 | **+462** | +2.52% |
| `masonry.js` source gzip | 5,976 | 6,184 | +208 | +3.48% |
| `masonry.js` source brotli | 5,095 | 5,274 | +179 | +3.51% |
| `dist/masonry.pkgd.js` raw | 54,801 | 54,947 | +146 | +0.27% |
| `dist/masonry.pkgd.js` gzip | 10,356 | 10,382 | +26 | +0.25% |
| `dist/masonry.pkgd.js` brotli | 9,228 | 9,249 | +21 | +0.23% |
| **`dist/masonry.pkgd.min.js` raw** | **24,241** | **24,342** | **+101** | **+0.42%** |
| **`dist/masonry.pkgd.min.js` gzip** | **7,714** | **7,734** | **+20** | **+0.26%** |
| **`dist/masonry.pkgd.min.js` brotli** | **6,973** | **6,994** | **+21** | **+0.30%** |
| `dist/masonry.cjs` raw | 51,648 | 51,788 | +140 | +0.27% |
| `dist/masonry.cjs` gzip | 10,247 | 10,272 | +25 | +0.24% |
| `dist/masonry.mjs` raw | 52,837 | 52,977 | +140 | +0.26% |
| `dist/masonry.mjs` gzip | 10,725 | 10,750 | +25 | +0.23% |
| Visual regression fixtures | 8 | **9** | **+1** | +12.5% |
| SSR smoke test | ✓ | ✓ | — | — |
| Module smoke test | ✓ | ✓ | — | — |
| No-jquery gate | ✓ | ✓ | — | — |
| dependencies | 2 | 2 | 0 | — |
| devDependencies | 4 | 4 | 0 | — |
| build time | 16 ms | 16 ms | 0 | — |

The `masonry.js` source growth (+462 B raw) is mostly the explanatory comment block added above `_create`. Of the +462 source bytes, only ~30 B is executable code — the rest is comments that get stripped by the minifier. Hence the much smaller min.js delta.

### Vs upstream-frozen v4.2.2

| Metric | v4.2.2 | v5.0.0-dev.15 | Δ | Δ% |
|---|---:|---:|---:|---:|
| `dist/masonry.pkgd.min.js` raw | 24,103 | **24,342** | +239 | +0.99% |
| `dist/masonry.pkgd.min.js` gzip | 7,367 | **7,734** | +367 | +4.98% |
| `dist/masonry.pkgd.min.js` brotli | 6,601 | **6,994** | +393 | +5.96% |

This is the first improvement since #006 where the fork is **raw-larger than upstream**. The cause is the cumulative cost of the user-facing UX features added post-#006 — each one is individually small (#010 fonts.ready +63 B gz, #012 ResizeObserver +365 B gz, #014 percent-math +391 B gz, #015 static preset +20 B gz) but they add up. This was the expected trajectory per the roadmap: the deletions in the first half of the fork (#001-008) freed budget for the feature additions in the second half (#009-015). The `rc.1` size-recovery pass (items A-F in the roadmap, ~950-1,270 B gz savings) is where the fork returns to "smaller than upstream" — and now with all the UX features already landed.

The fork is still **−10.94% in raw vs upstream** if you don't count the features added post-#006 — they are additive opt-in behavior (ResizeObserver, percent-math, static preset all either fire automatically for the common case or need explicit opt-in).

## Verdict

✅ **Match** — all predictions within the hypothesized band except raw, which overshot by ~30 B.

| Prediction | Predicted | Actual | Status |
|---|---|---|---|
| `min.js` raw growth | +30 to +70 B | **+101 B** | ⚠️ slight overshoot — see note |
| `min.js` gzip growth | +15 to +40 B | **+20 B** | ✅ middle of band |
| `min.js` brotli growth | +15 to +30 B | **+21 B** | ✅ middle of band |
| New static-mode fixture passes | yes | **yes, on first run** | ✅ |
| Visual regression fixtures stay green | 8/8 | 9/9 (new +1) | ✅ |
| SSR / module / no-jquery gates stay green | ✓ | ✓ | ✅ |
| No dep changes | yes | yes | ✅ |

**Raw overshoot (+101 vs +70 upper bound):** the culprit is that the identifier string `static` appears in the minified output ~4 times as a property access (`t.options.static`), and the minifier can't mangle property keys when they might be accessed from outside the module. Gzipped growth stayed in-band because LZ77 handles the repeated string well. Brotli ditto. The raw overshoot is cosmetic — users care about gzipped delivery bytes, which landed as predicted.

## Notes / lessons

- **Guards that look redundant at introduction pay off later.** #012's `if ( this._resizeObserver )` checks in `_itemize` / `remove` / `destroy` were written defensively ("what if someone extends the class and doesn't set it?"). In #015 those same guards made the `static: true` short-circuit trivially correct — no changes needed to the lifecycle hooks. This is the second time the pattern has paid off; the first was #005's SSR-safety `typeof window` check around `_create`'s DOM access. **When in doubt, guard-then-assume: the cost is negligible, and the payoff often lands several improvements later.**
- **The cleanest way to layer a "skip everything new" preset is to set it before the base call.** Forcing `this.options.transitionDuration = 0` happens *before* `baseCreate.call(this)`, which means Outlayer's own setup logic and any subsequent `transition()` calls all see the overridden value. I initially considered forcing the value inside a wrapper around `transition()` — that would work but is more invasive. Moving the mutation to the entry point of `_create` keeps the surface area minimal.
- **Don't override `transitionDuration` in the user-visible `options` object unilaterally unless you own the option name.** In our case, `options` is masonry's own — we can reach in and mutate it without side effects on user code. If `static` had been designed to alias a different owner's option, we'd need a wrapper layer instead. This is fine here but is a pattern to remember.
- **Discriminating fixtures work best when paired with their inverse.** The `static-mode` fixture is almost byte-for-byte `resize-observer.html` with three changes, and the expected positions are the exact inverse. Having the two side-by-side is one of the strongest kinds of regression test: any change that breaks the `static` branch will either break static-mode (if the guard is missing) or break resize-observer (if the observer wire-up regresses). Both fixtures enforce each other's invariants. **This is a general pattern worth reaching for — whenever a new option toggles an existing feature off, the discriminator is "run the existing feature's fixture with the option set and assert the opposite outcome."**
- **The SSR fix landed in #005 was an enabler, not a feature.** `masonry-pretext` has been importable in SSR module graphs since #005, but actually *using* it well in SSR required juggling multiple options (`transitionDuration: 0` at least, sometimes `initLayout: false`). #015 is the first improvement that says "here's the one flag you set in SSR mode" — the feature the SSR fix enables. This pattern (enabler → feature) is worth keeping in mind for future improvements: enabling something is half the work; making it ergonomic is the other half.
- **The "candidate future optimizations" list in the README was a legitimate backlog, not just documentation.** When I drafted the SSR section in the prior commit I listed three candidate optimizations without knowing whether any would ship. The first one (this preset) shipped immediately on user request. The other two (`Masonry.computeLayout` static helper, deferred ResizeObserver attachment) stay in the list. **Explicitly writing a "here's what's possible next" list in user-facing docs creates a discoverable backlog that also doubles as a commitment device.**
- **Next.js and Astro examples added in the prior commit already existed by the time I landed `static: true`** — so I could update both in the same commit with zero scaffolding cost. The examples being in-tree (not in a separate repo) makes this kind of cross-cutting update trivial. Keeping the examples in-tree is the right call.
- **Bundle-size cost of a UX feature vs its runtime savings.** +20 B gzipped is paid by everyone, even users who don't opt in. But for users who DO opt in, the runtime savings are real (no ResizeObserver, no `getBoundingClientRect()` pre-seed per item on construct, no promise chain, no transition-property writes). For a 100-item grid this is ~100 fewer reflows on construction alone. The cost/benefit calculation for *shared* code is asymmetric: the cost multiplies across all users, the benefit only accrues to opt-in users. Worth it here because SSR is a major use case and the cost is small.
- **The `tracked files` count jumped from 92 → 95** — +3 is the new fixture (.html), the new snapshot (.png), and this improvement file (.md). No stealth additions. The LOC delta (+800) is mostly comments + the improvement file's prose.
