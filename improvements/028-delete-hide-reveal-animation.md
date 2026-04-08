# 028 — Delete hide/reveal animation system (item A)

**Status:** landed
**Roadmap section:** § Post-#010 / FORK_ROADMAP.md item A
**Tag:** `v5.0.0-dev.28`
**Breaking change:** plugin authors expecting fade-in / scale-up animation on `appended()`/`prepended()` will see items appear instantly instead.

## Hypothesis

The fade-in/scale-up animation system inherited from upstream's defaults (`hiddenStyle: { opacity: 0, transform: 'scale(0.001)' }`, `visibleStyle: { opacity: 1, transform: 'scale(1)' }`) is dead weight in masonry-pretext:

- It relies on transitions, which the SSR preset (#015) forces to `transitionDuration: 0`
- It relies on stagger, which #024 already deleted
- The `proto.appended` / `proto.prepended` calls into `proto.reveal` are the only callers
- `Item.hide()` is also called by `Item.remove()`'s transition path, which is itself dead after the deletion
- No fixture in the test suite uses or depends on the animation

Predicted savings: **~450-550 B gz**.

## Method

### `outlayer.js` build-time patches (5 transforms)

1. Delete `defaults.hiddenStyle` and `defaults.visibleStyle` from the `Outlayer.defaults` object
2. Drop `this.reveal(items)` from `proto.appended`
3. Drop `this.reveal(items)` from `proto.prepended`
4. Delete `proto.reveal`, `proto.hide`, `proto.revealItemElements`, `proto.hideItemElements`

### `item.js` build-time patches (2 transforms)

1. Simplify `proto.remove` to just call `removeElem()` (drops the transition + `this.hide()` path)
2. Delete `proto.reveal`, `proto.hide`, `proto.onRevealTransitionEnd`, `proto.onHideTransitionEnd`, `proto.getHideRevealTransitionEndProperty`, and the `isHidden` flag

The `_emitCompleteOnItems` helper is kept (it's still used for `'layout'` and `'remove'` events).

## Numbers

| Metric | pre-028 | post-028 | Δ |
|---|---:|---:|---:|
| `dist/masonry.pkgd.js` raw | 54,495 | 51,462 | **−3,033** |
| `dist/masonry.pkgd.js` gz | 10,295 | 9,911 | **−384** |
| `dist/masonry.pkgd.min.js` raw | 23,967 | **22,500** | **−1,467** |
| `dist/masonry.pkgd.min.js` gz | 7,733 | **7,445** | **−288** |
| `dist/masonry.pkgd.min.js` brotli | 7,017 | **6,745** | **−272** |
| `dist/masonry.cjs` raw | 51,358 | 48,509 | −2,849 |
| `dist/masonry.mjs` raw | 52,550 | 49,701 | −2,849 |
| Visual + ssr + module + compute-layout + no-jquery | all green | all green | unchanged |

### Vs upstream-frozen v4.2.2

| Metric | v4.2.2 | v5.0.0-dev.28 | Δ |
|---|---:|---:|---:|
| `dist/masonry.pkgd.min.js` raw | 24,103 | **22,500** | **−1,603 (−6.65 %)** |
| `dist/masonry.pkgd.min.js` gz | 7,367 | 7,445 | **+78 (+1.06 %)** |
| `dist/masonry.pkgd.min.js` brotli | 6,601 | 6,745 | +144 (+2.18 %) |

The fork is **6.65 % smaller raw** than upstream and **only 1.06 % above upstream gzipped**. With items C, D, E still pending, the gzipped gap should close completely (and reverse) before v5.0.0-rc.1.

## Verdict

⚠️ **Partial — landed at the lower end of the predicted +450-550 B gz band (288 B actual).**

The over-prediction came from counting raw bytes instead of gzipped bytes. The hide/reveal system contains a lot of repeated property names (`hiddenStyle`, `visibleStyle`, `transitionEnd`, etc.) that gzip handles efficiently — the raw delta is huge (−1,467 B) but the gz delta is "only" −288 B.

Cumulative recovery from SSR feature line: **~801 B gz** across #023 + #024 + #026 + #027 + #028 — over 100% of the −576 B gz that #015-#020 added.

## Notes / lessons

- **Breaking change for plugin authors expecting fade-in animation.** Migration: drop `options.hiddenStyle` / `options.visibleStyle` references; if you need a custom enter animation, do it via CSS transitions on the `.grid-item` class (using `opacity` + `transform`) rather than via masonry's API.
- **`Item.hide()` was the only consumer of the `isHidden` flag.** With both deleted, items are always visually present once positioned. Removed items go straight through `removeElem()`.
- **`proto.remove` is now a one-liner.** Could be inlined into the call site (`Outlayer.prototype.remove` calls `item.remove()` which calls `item.removeElem()`) — left as-is for plugin author API compatibility.
- **Upstream raw delta vs gz delta** is the most surprising calibration result of the session. A 6× ratio (1,467 raw → 288 gz) means the deleted code was very compression-friendly. Future predictions for "delete a feature with lots of repeated string identifiers" should expect a smaller-than-naive gz win.
- **Item D (inline EvEmitter, drop `once()` + `allOff()` + `_onceEvents`)** is now unblocked. With the `Item.remove()` transition path gone, the only `once('transitionEnd', ...)` caller is dead. The `once()` method itself might still be used elsewhere — to be checked when item D lands.
