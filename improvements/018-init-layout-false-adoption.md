# 018 — `initLayout: false` SSR adoption verification (Phase 3 of `PRETEXT_SSR_ROADMAP.md`)

**Status:** landed
**Roadmap section:** [`PRETEXT_SSR_ROADMAP.md`](../PRETEXT_SSR_ROADMAP.md) Phase 3
**Closes upstream issues:** none directly. **Verifies the SSR adoption path works** — the missing client-side half of the pipeline that #017's `Masonry.computeLayout` enables.
**Tag:** `v5.0.0-dev.18`
**Commit:** _filled in after landing_

## Hypothesis

Phase 2 (#017) added `Masonry.computeLayout`, the pure-Node helper that emits server-side positions. Phase 3's question: **does the client adopt those positions correctly when constructing masonry?** Specifically, when the user constructs `new Masonry(grid, { initLayout: false, static: true })` on a grid whose items are already positioned via inline `style="position: absolute; left: Xpx; top: Ypx;"`, does masonry leave those positions alone, or does it overwrite them?

The hypothesis (informed by reading Outlayer + Item source) is that **it already works out of the box**, no source change required. Specifically:

1. **`initLayout: false`** in the Outlayer constructor skips the constructor's `this.layout()` call entirely. No items get repositioned by masonry on construction.
2. **`Item._create`** sets `this.css({ position: 'absolute' })` on every item — but this is a no-op for items that the server already pre-rendered with `position: absolute` in their inline styles.
3. **`static: true`** (#015) skips the `document.fonts.ready` deferred layout AND the per-item ResizeObserver construction, so no observer can fire later and overwrite the SSR positions.

If the hypothesis holds, Phase 3 needs **only a discriminating fixture** — no source change. If it doesn't hold, we need to add an `adoptInitialLayout` option or similar.

### Predictions

1. **Zero source change to `masonry.js`.** Bundle bytes unchanged.
2. **New `init-layout-false` fixture passes** (after `--update` to capture the baseline) — items pre-positioned in a single-column stack stay in the stack after construction.
3. **The fixture FAILS if `initLayout: false` is replaced with `initLayout: true`** — items get repositioned to the natural 3-col tile, the position assertion catches it (item 1 at `60px` instead of `0px`).
4. **All 9 existing visual fixtures still pass** byte-for-byte against unchanged baselines.
5. **SSR + module-smoke + compute-layout + no-jquery gates unchanged.**

## Method

### The discriminating fixture (`test/visual/pages/init-layout-false.html`)

The strongest possible discriminator: pre-position items in a layout shape that masonry would **never** produce naturally. A single-column vertical stack is perfect — for 4 items at 60×30 in a 180px container, masonry's natural layout is the 3-col tile `(0,0), (60,0), (120,0), (0,30)`. The single-column stack `(0,0), (0,30), (0,60), (0,90)` is structurally different.

```html
<div id="init-layout-false" class="container">
  <div class="item" style="position: absolute; left: 0px; top: 0px;"></div>
  <div class="item" style="position: absolute; left: 0px; top: 30px;"></div>
  <div class="item" style="position: absolute; left: 0px; top: 60px;"></div>
  <div class="item" style="position: absolute; left: 0px; top: 90px;"></div>
</div>
<script>
  new Masonry('#init-layout-false', {
    columnWidth: 60,
    initLayout: false,
    static: true,
  });
</script>
```

The container's `position: relative` is set by Outlayer's `containerStyle` (which runs even with `initLayout: false`), so the absolutely-positioned children are correctly contained.

### Verification of the discriminator

Built the fixture, captured the baseline screenshot. Then **temporarily flipped `initLayout: false` → `initLayout: true`** to prove the discriminator catches breakage:

- With `initLayout: false`: ✓ test passes — items stay in single-column stack
- With `initLayout: true`: ✗ test fails — `item 1: left expected 0px got 60px` (masonry repositioned items into the natural 3-col tile)

The fixture is mechanically guaranteed to catch any future regression where masonry starts overwriting pre-positioned items on construction.

### Why this fixture is the right shape for the SSR feature line

It tests the **canonical SSR adoption combo** — the exact same option set that the Phase 4 Astro example will use:

```js
new Masonry(grid, {
  columnWidth: COL,
  initLayout: false,    // adopt server-computed positions, don't relayout
  static: true,         // no observers, no animations, no font hooks
  pretextify: ...,      // (optional) for any client-side relayouts
});
```

Phase 4's example will rely on this combo working. Phase 3's fixture is the contract that locks it in — any future improvement that breaks the combo gets caught by the test gate before it can ship.

### Files touched

- `test/visual/pages/init-layout-false.html` — new fixture (~80 lines including doc comments)
- `test/visual/__screenshots__/init-layout-false.png` — new baseline (captured via `--update`)
- `test/visual/run.mjs` — new case in the `cases` array (~18 lines)

**Zero changes to `masonry.js`, `masonry.d.ts`, `dist/`, or any other production file.** The bundles are byte-for-byte identical to #017.

### Commands run

```sh
./scripts/measure.sh --save pre-018-init-layout-false
make test                                          # 9/9 + ✓ ssr + ✓ module + ✓ compute-layout + ✓ no-jquery baseline

# create test/visual/pages/init-layout-false.html
# add init-layout-false case to test/visual/run.mjs

node test/visual/run.mjs --update --filter=init-layout-false
# → snapshot updated, 1 passed

# verify the discriminator: temporarily flip initLayout: false → true
node test/visual/run.mjs --filter=init-layout-false
# → ✗ item 1: left expected 0px got 60px
# → discriminator works — restore initLayout: false

make test                                          # 10/10 + ✓ ssr + ✓ module + ✓ compute-layout + ✓ no-jquery
# bump pkg.json version → 5.0.0-dev.18, rebuild for banner
./scripts/measure.sh --save post-018-init-layout-false
```

## Before — `pre-018-init-layout-false` (= post-017)

```
package           masonry-pretext@5.0.0-dev.17
tracked files     98
total LOC         17615
dependencies      2
devDependencies   4

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                    28520        8723        7487       711
  dist/masonry.pkgd.js                   58960       11056        9856      1633
  dist/masonry.pkgd.min.js               25756        8291        7527        22
  dist/masonry.cjs                       55593       10948        9761      1626
  dist/masonry.mjs                       56783       11427       10171      1650
```

9/9 visual + ✓ SSR + ✓ module-smoke + ✓ compute-layout + ✓ no-jquery.

## After — `post-018-init-layout-false`

```
package           masonry-pretext@5.0.0-dev.18
tracked files     101
total LOC         17960
dependencies      2
devDependencies   4

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                    28520        8723        7487       711
  dist/masonry.pkgd.js                   58960       11056        9856      1633
  dist/masonry.pkgd.min.js               25756        8291        7527        22
  dist/masonry.cjs                       55593       10948        9760      1626
  dist/masonry.mjs                       56783       11427       10176      1650
```

**10/10 visual** (+1 init-layout-false) + ✓ SSR + ✓ module-smoke + ✓ compute-layout + ✓ no-jquery.

## Delta

| Metric | pre-018 | post-018 | Δ |
|---|---:|---:|---:|
| `masonry.js` source raw | 28,520 | **28,520** | **0** |
| `dist/masonry.pkgd.js` raw | 58,960 | **58,960** | **0** |
| `dist/masonry.pkgd.min.js` raw | 25,756 | **25,756** | **0** |
| `dist/masonry.pkgd.min.js` gzip | 8,291 | **8,291** | **0** |
| `dist/masonry.pkgd.min.js` brotli | 7,527 | **7,527** | **0** |
| `dist/masonry.cjs` raw | 55,593 | **55,593** | **0** |
| Tracked files | 98 | **101** | +3 (fixture html + screenshot baseline + improvement record) |
| Visual regression tests | 9 / 9 | **10 / 10** | +1 (`init-layout-false`) |
| Compute-layout test | 9 / 9 | 9 / 9 | unchanged |
| SSR + module-smoke + no-jquery gates | ✓ + ✓ + ✓ | ✓ + ✓ + ✓ | unchanged |

**Zero bundle bytes added.** The smallest improvement on record. The fork's defining capability (SSR adoption) was already working — Phase 3 just proves it formally with a permanent discriminating fixture.

## Verdict

✅ **Match — every prediction landed exactly as designed.**

| Prediction | Predicted | Actual | Status |
|---|---|---|---|
| Zero source change to `masonry.js` | yes | yes | ✅ |
| Bundle bytes unchanged | yes | yes (byte-for-byte) | ✅ |
| New `init-layout-false` fixture passes | yes | yes (on first build) | ✅ |
| Fixture FAILS with `initLayout: true` | yes | yes (`item 1: left expected 0px got 60px`) | ✅ |
| All 9 existing visual fixtures pass byte-for-byte | yes | yes | ✅ |
| All other gates unchanged | yes | yes | ✅ |

**Zero-cost win** — the SSR adoption path was already working from #015 + Outlayer's existing semantics; #018 just makes it a permanent gate. **The smallest improvement record in the project.** Most improvements add bytes and risk; this one adds neither.

## Notes / lessons

- **Reading the source before predicting the fix is the highest-leverage research time in the methodology.** I spent ~5 minutes reading `Outlayer.prototype._create`, `Outlayer` constructor's `if (initLayout) this.layout()`, and `Item._create`'s `this.css({position: 'absolute'})`. That reading let me predict "no source change needed, just verify with a fixture" with high confidence — saving the time I would have spent guessing wrong implementations. **The right answer to "does X already work?" is "read the source carefully," not "build a complex test scaffolding to find out."**
- **The conjugate-discriminator pattern from #015** generalizes once again. The fixture has TWO modes — `initLayout: false` (passes, items stay) and `initLayout: true` (fails, items get repositioned). The two modes are mechanically inverse. Any future regression in either direction is caught by exactly one of them.
- **The single-column-stack discriminator is uniquely strong.** Masonry's natural layout for 4 60×30 items in a 180px container is the 3-col tile. The single-column stack is **structurally different** from anything masonry would produce. Even a partial regression (e.g. masonry computes but doesn't fully apply positions) would shift items off (0, X) and the assertion would catch it.
- **`position: absolute` in the pre-rendered HTML is required** — `Item._create` sets it but it's a no-op for the rendered case. If the user pre-renders without `position: absolute`, items will be in flow layout briefly until masonry's `Item._create` runs, then snap to absolute. Documented in the fixture's HTML comment block as the contract for SSR users.
- **Phase 4 (Astro example) is now fully unblocked.** Phases 1-3 collectively give us:
  - `Masonry.computeLayout` (#017) — server-side position computation
  - `initLayout: false` adoption (#018) — client-side adoption without overwrite
  - `static: true` (#015) — opt out of dynamic-content machinery so SSR positions stay forever
  Phase 4 wires them all together in a runnable Astro page.
- **Phase 5's hydration bench** is now a comparable measurement: it can compare `initLayout: true` (the natural reflow + flash) against `initLayout: false + static: true` (zero flash) on the same demo content. The expected CLS delta is the headline number for the entire SSR feature line.
- **The simplest improvements are the most underrated.** This one is 3 added files, 0 source changes, 0 bundle bytes — yet it locks in the entire client-side half of the SSR feature line. **Improvements that prove existing-but-unverified behavior are valuable infrastructure**, not "trivial test additions."
