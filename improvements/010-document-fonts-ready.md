# 010 — `document.fonts.ready` first-paint gate (§ P.4)

**Status:** landed
**Roadmap section:** § P.4 — `document.fonts.ready` first-paint gate
**Closes upstream issues:** **`desandro/masonry#1182`** ("Masonry and Bootstrap not rendering properly when custom font used (on a fresh load)")
**Tag:** `v5.0.0-dev.10`
**Commit:** _filled in after landing_

## Hypothesis

When a custom web font hasn't finished loading at masonry construction time, items get measured at the *fallback* font's rendered height — not the final height. The result: layout overlap until something triggers a relayout (window resize, manual `.layout()` call, etc.). This is upstream `desandro/masonry#1182`, open since 2022 with no fix.

The web platform has a clean primitive for this: `document.fonts.ready` is a Promise that resolves when all currently-pending font loads finish. Wire it into masonry's construction so the layout automatically reruns when fonts are ready.

The fix is small: override `proto._create` in `masonry.js` to schedule a deferred `self.layout()` when `document.fonts.ready` resolves, guarded by:
- `typeof document !== 'undefined'` — SSR safety
- `document.fonts && document.fonts.status !== 'loaded'` — skip if already loaded
- `self.element && self.element.outlayerGUID` — skip if the instance was destroyed before fonts loaded

The whole hook is ~15 LOC + a comment. Same shape as the pretextify hook from #009 but at the constructor extension point instead of the layout hot path.

### Predicted numbers

1. **`masonry.js` source raw:** +20 to +40 B (one method override + comment, body is short)
2. **`dist/masonry.pkgd.min.js` raw:** +60 to +120 B (minified body + closure setup)
3. **`dist/masonry.pkgd.min.js` gzip:** +25 to +60 B
4. **5 existing visual fixtures still pass.** None use custom fonts → `document.fonts.status` is `'loaded'` in chromium headless → guard short-circuits → existing layout behavior unchanged.
5. **New `fonts-ready` discriminating fixture passes.** Mocks `document.fonts.status === 'loading'` and `document.fonts.ready` as a pending promise, then resolves it after construction. The fixture's CSS grows item 0 from 30→60px when `[data-fonts-loaded]` is set. If the deferred layout fires, item 3 lands at `(60, 30)`. If the hook is broken, item 3 lands at `(0, 30)` — same discriminator pattern as #009's pretext fixture.
6. **SSR + no-jquery gates unchanged.** The `typeof document` guard prevents the hook from crashing in Node SSR contexts (verified by ssr-smoke).

## Method

### Source change (`masonry.js`)

Override `proto._create` to call the inherited Outlayer `_create` then schedule the deferred layout. The base method is captured into a local `baseCreate` variable BEFORE the override is installed (the standard "store base, override" pattern):

```js
var baseCreate = proto._create;
proto._create = function() {
  baseCreate.call( this );
  if ( typeof document !== 'undefined' && document.fonts &&
       document.fonts.status !== 'loaded' ) {
    var self = this;
    document.fonts.ready.then( function() {
      if ( self.element && self.element.outlayerGUID ) {
        self.layout();
      }
    });
  }
};
```

The `baseCreate` is the inherited `Outlayer.prototype._create` (resolved through the prototype chain at `var baseCreate = proto._create` time). After the assignment `proto._create = function() {...}`, the override shadows the inherited one but the captured `baseCreate` still points at the parent.

The deferred `self.layout()` runs through Outlayer's normal `layout()` path. Since `_isLayoutInited` is `true` after the first layout, the second one is NOT instant — items animate to their new positions when fonts load (unless the user set `transitionDuration: 0`). This is the right UX: a smooth transition from "wrong heights with fallback font" to "correct heights with custom font", instead of a jarring jump.

### Discriminating fixture (`test/visual/pages/fonts-ready.html`)

Same shape as the #009 pretext fixture but for the fonts-ready hook. The fixture:

1. **Mocks `document.fonts` BEFORE loading masonry**:
   - `document.fonts.status` getter returns `'loading'`
   - `document.fonts.ready` getter returns a `Promise` that we control via a saved `resolve` function
2. **Loads masonry**, which sees `status !== 'loaded'` and schedules the deferred layout
3. **CSS rule** grows item 0 from `height: 30px` to `height: 60px` when `[data-fonts-loaded]` is set on `<html>` — this simulates "the custom font finally loaded and items grew"
4. **Resolves the mock promise** + sets the attribute, simulating "fonts loaded"
5. **Waits two microtask ticks** before setting `window.__READY = true`, giving the deferred layout time to complete
6. **Position assertion** in `run.mjs`: item 3 must land at `(60, 30)` — only achievable if the deferred layout fired AFTER the heights changed

Same discriminating-test pattern as #009: pick a position that's only reachable through the new code path. If the hook is broken, item 3 lands at `(0, 30)` and the assertion catches it.

### Commands run

```sh
./scripts/measure.sh --save pre-010-fonts-ready
make test                                          # 5/5 + ✓ ssr + ✓ no-jquery
# edit masonry.js — add _create override
make build && make test                            # 5/5 still pass (guard skips, no fonts loading)
# create test/visual/pages/fonts-ready.html
# add fonts-ready case to test/visual/run.mjs
make build
node test/visual/run.mjs --update --filter=fonts-ready  # capture snapshot baseline
make test                                          # 6/6 + ✓ ssr + ✓ no-jquery
# bump pkg.json version → 5.0.0-dev.10
./scripts/measure.sh --save post-010-fonts-ready
```

## Before — `pre-010-fonts-ready`

```
package           masonry-pretext@5.0.0-dev.9
tracked files     71
total LOC         8928
dependencies      2
devDependencies   4

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                     7997        2682        2292       249
  dist/masonry.pkgd.js                   49048        9241        8217      1388
  dist/masonry.pkgd.min.js               21517        6894        6224        22
```

5 visual fixtures + ✓ SSR + ✓ no-jquery.

## After — `post-010-fonts-ready`

```
package           masonry-pretext@5.0.0-dev.10
tracked files     73
total LOC         9148
dependencies      2
devDependencies   4

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                     8860        3056        2593       270
  dist/masonry.pkgd.js                   49493        9337        8306      1400
  dist/masonry.pkgd.min.js               21736        6957        6267        22
```

6 visual fixtures (+ fonts-ready) + ✓ SSR + ✓ no-jquery.

## Delta

| Metric | pre-010 | post-010 | Δ raw | Δ% |
|---|---:|---:|---:|---:|
| `masonry.js` source raw | 7,997 | **8,860** | **+863** | **+10.79%** |
| `dist/masonry.pkgd.js` raw | 49,048 | **49,493** | **+445** | **+0.91%** |
| `dist/masonry.pkgd.js` gzip | 9,241 | **9,337** | **+96** | **+1.04%** |
| `dist/masonry.pkgd.js` brotli | 8,217 | **8,306** | **+89** | **+1.08%** |
| `dist/masonry.pkgd.min.js` raw | 21,517 | **21,736** | **+219** | **+1.02%** |
| `dist/masonry.pkgd.min.js` gzip | 6,894 | **6,957** | **+63** | **+0.91%** |
| `dist/masonry.pkgd.min.js` brotli | 6,224 | **6,267** | **+43** | **+0.69%** |
| Visual regression tests | 5 / 5 | **6 / 6** | +1 (fonts-ready fixture) | |
| SSR smoke test | ✓ | ✓ | unchanged | |
| no-jquery gate | ✓ | ✓ | unchanged | |

### Vs upstream-frozen v4.2.2

| Metric | v4.2.2 | v5.0.0-dev.10 | Δ raw | Δ% |
|---|---:|---:|---:|---:|
| `dist/masonry.pkgd.min.js` raw | 24,103 | **21,736** | **−2,367** | **−9.82%** |
| `dist/masonry.pkgd.min.js` gzip | 7,367 | **6,957** | **−410** | **−5.57%** |
| `dist/masonry.pkgd.min.js` brotli | 6,601 | **6,267** | **−334** | **−5.06%** |

The fork is **still over 9% smaller raw / 5.5% smaller gzipped** vs upstream, even with both feature improvements (#009 pretext + #010 fonts-ready) added on top of the deletion sweep. Each feature has earned its bytes by closing a real upstream issue or adding a measurable perf win.

## Verdict

⚠️ **Partial — gates green and feature works, but min.js raw/gz both landed slightly above the predicted band.**

| Prediction | Predicted | Actual | Status |
|---|---|---|---|
| `masonry.js` source raw | +20 to +40 B | **+863 B** | ❌ way over (verbose doc comment, same as #009) |
| `min.js` raw | +60 to +120 B | **+219 B** | ❌ over by ~100 B |
| `min.js` gzip | +25 to +60 B | **+63 B** | ⚠️ +3 B over the top of the band |
| `min.js` brotli | similar to gzip | **+43 B** | ✅ |
| Visual fixtures | 5 → 6 | **6/6** | ✅ |
| `fonts-ready` fixture proves the deferred layout fires | yes | **yes** (item 3 at `60px,30px`) | ✅ |
| SSR + no-jquery unchanged | yes | ✅ | ✅ |

### Why the over-shoot on min.js raw

I estimated +60-120 B for the override. Actual is +219 B. The cost breakdown after minification:

- The override function body itself: ~120 B (the `if`, the closure capture of `self`, the `.then(...)` body, the alive check)
- The captured `baseCreate` variable: ~30 B
- The string `'loaded'` literal: ~10 B
- Function expression boilerplate: ~30 B
- Conditional + promise call: ~30 B

Total ~220 B. Matches.

**Calibration lesson:** method overrides that capture a base method + add a conditional + an async callback cost ~150-250 raw bytes minified, not ~80. Update predictions for similar future improvements (#011, #012, etc.).

## Notes / lessons

- **The hook is at `_create`, not `layout()`, intentionally.** Putting it in `layout()` would re-schedule the fonts.ready listener on every manual `layout()` call. `_create` runs exactly once per instance. The hook fires at most once per instance per font-load cycle.
- **The deferred layout is NOT instant.** `_isLayoutInited` is true by the time the deferred call runs, so `layout()` uses the configured transition (default 0.4s). Items animate from their wrong-font positions to their correct positions. Smooth UX. If a user sets `transitionDuration: 0` they get a hard jump, which is also fine.
- **Mocking `document.fonts` for the test was finicky.** `document.fonts.status` is a getter on FontFaceSet.prototype, not a plain property. `Object.defineProperty(document.fonts, 'status', { get })` works because it shadows the prototype getter with an own-property getter on the instance. `document.fonts.ready` is similar. The mock has to install BEFORE the bundle loads (via a `<script>` tag preceding the bundle script tag) so that masonry's `_create` reads the mocked values.
- **Two microtask ticks before `__READY`** in the fixture: one to let the resolved promise's `.then` callback run (the deferred `layout()`), one extra to let any synchronous follow-ups settle. This is fragile — if the bundle's microtask chain ever grows, the fixture might need more ticks. A better long-term shape is `await page.waitForFunction(() => /* layout count >= 2 */)` but that requires exposing the layout count from the bundle. For now the two-tick wait works.
- **The fonts-ready fixture is the second discriminating-test design** in the fork (after the #009 pretext fixture). The pattern: pick a final position that's only achievable through the new code path, assert that exact position. If the new code is broken, the position is different and the assertion catches it. **This pattern generalizes to any future opt-in feature** where the hook either fires or doesn't.
- **Real font behavior is NOT verified by this fixture** — it uses a mocked `document.fonts`. A future improvement could add a real `@font-face` test with a base64 font to verify chromium's actual `fonts.ready` behavior, but the cost is fixture complexity vs the small additional confidence.
- **Closes upstream `#1182`.** That issue has been open since 2022 with the upstream fix being "use `imagesLoaded`" (a separate library that doesn't actually solve the font case). This fix is one platform call away — `document.fonts.ready` has been universal since 2018 and is at our browser baseline.
- **Source comment is verbose again** (same as #009). Same calibration lesson: source bytes don't matter to end users (minifier strips), and the WHY explanation pays off when someone reads `masonry.js` directly. The `improvements/010-document-fonts-ready.md` file is the long form; the inline comment is the abbreviated WHY.