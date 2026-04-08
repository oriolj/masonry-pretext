# 045 — `static: 'until-resize'` hybrid mode

**Status:** landed
**Roadmap section:** § Downstream consumer asks · D.2
**Closes upstream issues:** none (downstream wrong-server-width fallback)
**Commit(s):** 5.0.0-dev.45

## Hypothesis

Add a string variant of the existing `static` option that behaves like
`static: true` on construction but flips back to dynamic-content
behavior on the first window-resize-driven relayout. The first user
resize is a strong signal that the server's container-width guess was
wrong; from that point forward the grid should behave like a normal
dynamic grid (transitions, per-item ResizeObserver, etc.).

The handoff:

1. On construction: `transitionDuration: 0`, no fonts.ready hook,
   no per-item ResizeObserver, hybrid arm flag set.
2. On first `resize()` call where `needsResizeLayout()` returns true:
   restore the original `transitionDuration`, set `static = false`,
   construct the per-item ResizeObserver retroactively, observe all
   currently-known items.
3. From that point onward, the instance behaves like a non-static one.

**Predictions:**

- **Cost:** ~80-150 B gzipped on `dist/masonry.pkgd.min.js`. The new
  `_buildResizeObserver` helper extraction (refactor — should be a
  small savings from reduced duplication in `_create`), plus the
  `proto.resize` override (the larger cost — full handoff bookkeeping).
- **Test gate:** new `static-until-resize.html` discriminating fixture
  + `pageAssert` mechanism to verify the hybrid state flags reset
  correctly across the resize boundary.
- **Risk:** the existing `proto.resize` override has to inline
  Outlayer's base resize logic instead of calling it, because masonry's
  `needsResizeLayout` mutates `this.containerWidth` as a side effect
  of the previous-vs-current comparison. Calling base.call(this) AFTER
  our wrapper has already called `needsResizeLayout` would compare the
  new width against itself and return false, skipping the layout pass.
  (Discovered during fixture debugging.)

## Method

- Files touched:
  - `masonry.js` —
    1. Extracted the per-item ResizeObserver construction from `_create`
       into a new `proto._buildResizeObserver` helper. The original
       construction site now calls the helper after the existing
       `(!static || dynamicItems)` gate.
    2. Added the `_isHybridArmed` + `_origTransitionDuration` flags
       to `_create`'s static branch.
    3. Replaced `proto.resize` with a wrapper that handles the hybrid
       handoff and inlines the base proto.resize logic (because
       calling base after our `needsResizeLayout` would short-circuit
       — see Risk above).
  - `masonry.d.ts` — widened `static?: boolean` to
    `static?: boolean | 'until-resize'` and added a JSDoc block
    explaining the hybrid mode + the trigger condition.
  - `test/visual/pages/static-until-resize.html` — new fixture.
    Constructs with `static: 'until-resize'` + `transitionDuration: '0.4s'`,
    captures pre-resize state, narrows the container to 120px, calls
    `msnry.resize()` manually (bypasses the 100ms debounce), captures
    post-resize state. Waits 600ms for the post-resize transitions to
    commit to `style.left/top` (vs the transient `transform` that the
    transition uses while animating).
  - `test/visual/run.mjs` — added the `static-until-resize` case with
    a `pageAssert` that verifies all five hybrid state flags reset
    correctly: `_isHybridArmed`, `transitionDuration`, `_resizeObserver`,
    `options.static`. Position assertions verify the post-resize 2-col
    layout.
  - `test/visual/__screenshots__/static-until-resize.png` — new baseline.
  - `package.json` — version bump to `5.0.0-dev.45`.
- Commands run:
  - `make build`
  - `node test/visual/run.mjs --filter=static-until-resize --update`
  - `make test` (full gate)
- **Discriminator verification:** temporarily wrapped the hybrid
  handoff branch in `if ( false && this._isHybridArmed )`, rebuilt,
  and saw the expected `pageAssert: post _isHybridArmed expected
  false, got true` failure. Restored the code; the test passed again.

## Before

```
package           masonry-pretext@5.0.0-dev.44

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                    46289       14368       12467      1059
  dist/masonry.pkgd.js                   55400       10785        9691      1506
  dist/masonry.pkgd.min.js               24812        8136        7357        19
  dist/masonry.cjs                       52280       10677        9590      1499
  dist/masonry.mjs                       53488       11161        9989      1523
```

## After

```
package           masonry-pretext@5.0.0-dev.45

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                    49734       15404       13375      1121
  dist/masonry.pkgd.js                   56231       10892        9768      1525
  dist/masonry.pkgd.min.js               25392        8250        7445        19
  dist/masonry.cjs                       53073       10782        9659      1518
  dist/masonry.mjs                       54281       11267       10079      1542
```

Test status: 19 visual + ssr + module + 11 compute-layout + 4 compute-layouts + no-jquery — all green.

## Delta

| Metric | Before | After | Δ | % |
|---|---:|---:|---:|---:|
| dist/masonry.pkgd.min.js raw  | 24812 | 25392 | **+580** | +2.34% |
| dist/masonry.pkgd.min.js gzip |  8136 |  8250 | **+114** | +1.40% |
| dist/masonry.pkgd.min.js br   |  7357 |  7445 |  **+88** | +1.20% |

Lands within the predicted 80-150 B gz band.

## Verdict

✅ **Match.** Cost lands at 114 B gz (predicted 80-150). The
`_buildResizeObserver` extraction was a wash on bytes (the helper
function callsite + the base function header roughly cancel the
inline duplication savings) but it sets up the hybrid handoff cleanly.
Discriminator verified to catch the regression.

## Notes / lessons

- **Calling base.call(this) after a stateful wrapper is dangerous.**
  My first attempt wrapped `proto.resize` to do the hybrid handoff
  bookkeeping THEN call the base. But masonry's `needsResizeLayout`
  mutates `this.containerWidth` (it's the only way to know if the
  container changed without keeping a separate cache), so calling
  `needsResizeLayout` twice in the same `resize()` returned false the
  second time — and the actual `layout()` call was skipped. The fix
  was to inline the small base proto.resize logic. Worth remembering
  for future wrapper-based extensions: read the base function's body,
  not just its name.
- **The discriminating fixture had to wait for transitions.** The
  hybrid mode's whole point is "transitions come back after first
  resize". Items that move during the post-resize layout animate via
  `translate3d` (the Outlayer transition system) and only commit to
  `style.left/top` on `transitionend`. The fixture's `__READY` flag
  has to fire AFTER the commit, so the runner reads the final
  positions instead of the in-flight `transform`. A 600ms timeout
  covers the 400ms transition + slack.
- **Setting `options.static = false` after the handoff** is necessary
  so `_observeItemElement` doesn't apply the `dynamicItems` selector
  filter (which only triggers on `static + dynamicItems`). Without
  the reset, items added post-handoff via `appended` / `prepended`
  would not be observed.
- **The hybrid mode is a one-shot.** After the first handoff, the
  `_isHybridArmed` flag is cleared and subsequent resizes go through
  the normal dynamic path. There's no "re-arm" — once the client has
  proven the server was wrong, it's wrong forever.
- **Tier 1 closeout.** With D.2 landed, all four Tier 1 items
  (D.1 / D.2 / D.3 / D.4) from the `enacast-astro` consumer audit
  are now shipped. The consumer can begin migrating wrong-breakpoint-
  prone pages onto the SSR pipeline.
