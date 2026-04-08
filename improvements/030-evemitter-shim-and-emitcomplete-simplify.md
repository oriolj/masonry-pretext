# 030 — EvEmitter shim + simplify `_emitCompleteOnItems` (item D)

**Status:** landed
**Roadmap section:** § Post-#010 + § P.3 / FORK_ROADMAP.md item D
**Tag:** `v5.0.0-dev.30`

## Hypothesis

Two related deletions made possible by item A (#028):

1. **EvEmitter `once()` + `allOff()` + `_onceEvents`** are now unused. After #024 deleted stagger and #028 deleted hide/reveal, the only `item.once('transitionEnd', ...)` caller (in `Item.remove`'s transition path) is gone. The remaining `item.once('layout', tick)` aggregation in `_emitCompleteOnItems` is removable too — items emit their per-item `'layout'` event SYNCHRONOUSLY during `_processLayoutQueue`, so the aggregation is just complicated synchronous counting.

2. **`_emitCompleteOnItems` is then trivially reducible** to a single `dispatchEvent(eventName + 'Complete', null, [items])` call.

Replace the bundled `desandro/ev-emitter` package with a ~30 LOC inlined shim that drops `once`/`allOff`/`_onceEvents` and the matching cleanup branches inside `emitEvent`. Same shape as the get-size shim from #027.

Predicted savings: **~100-140 B gz**.

## Method

### `evEmitterShimPlugin` (new)

A new esbuild plugin (mirroring the matchesSelectorShimPlugin and getSizeShimPlugin patterns) intercepts `import 'ev-emitter'` and substitutes a 30 LOC inlined version with `on` / `off` / `emitEvent` only:

```js
function EvEmitter() {}
var proto = EvEmitter.prototype;
proto.on = function( eventName, listener ) {
  if ( !eventName || !listener ) return;
  var events = this._events = this._events || {};
  var listeners = events[ eventName ] = events[ eventName ] || [];
  if ( listeners.indexOf( listener ) == -1 ) listeners.push( listener );
  return this;
};
proto.off = function( eventName, listener ) {
  var listeners = this._events && this._events[ eventName ];
  if ( !listeners || !listeners.length ) return;
  var index = listeners.indexOf( listener );
  if ( index != -1 ) listeners.splice( index, 1 );
  return this;
};
proto.emitEvent = function( eventName, args ) {
  var listeners = this._events && this._events[ eventName ];
  if ( !listeners || !listeners.length ) return;
  listeners = listeners.slice( 0 );
  args = args || [];
  for ( var i = 0; i < listeners.length; i++ ) {
    listeners[ i ].apply( this, args );
  }
  return this;
};
module.exports = EvEmitter;
```

### `outlayer.js` build-time patch

Replace `_emitCompleteOnItems` with a single-line direct dispatch:

```js
proto._emitCompleteOnItems = function( eventName, items ) {
  this.dispatchEvent( eventName + 'Complete', null, [ items ] );
};
```

The previous body had ~22 lines including the per-item once-listener, the count tracker, the closure-over-`_this`, the `onComplete` inner function, and the empty-items branch. All replaced by one line.

## Numbers

| Metric | pre-030 | post-030 | Δ |
|---|---:|---:|---:|
| `dist/masonry.pkgd.js` raw | 50,039 | 48,197 | **−1,842** |
| `dist/masonry.pkgd.js` gz | 9,544 | 9,307 | **−237** |
| `dist/masonry.pkgd.min.js` raw | 21,985 | **21,412** | **−573** |
| `dist/masonry.pkgd.min.js` gz | 7,211 | **7,038** | **−173** |
| `dist/masonry.pkgd.min.js` brotli | 6,562 | **6,372** | **−190** |
| `dist/masonry.cjs` raw | 47,154 | 45,427 | −1,727 |
| `dist/masonry.mjs` raw | 48,354 | 46,630 | −1,724 |
| Visual + ssr + module + compute-layout + no-jquery | all green | all green | unchanged |

### Vs upstream-frozen v4.2.2

| Metric | v4.2.2 | v5.0.0-dev.30 | Δ |
|---|---:|---:|---:|
| `dist/masonry.pkgd.min.js` raw | 24,103 | **21,412** | **−2,691 (−11.16 %)** |
| `dist/masonry.pkgd.min.js` gz | 7,367 | **7,038** | **−329 (−4.47 %)** |
| `dist/masonry.pkgd.min.js` brotli | 6,601 | **6,372** | **−229 (−3.47 %)** |

The fork is now **11.16% smaller raw / 4.47% smaller gz / 3.47% smaller brotli** than upstream — comfortably below in all three metrics. Cumulative recovery from SSR feature line: **~1,208 B gz** across #023 + #024 + #026 + #027 + #028 + #029 + #030.

## Verdict

✅ **Match — landed at the upper end of the predicted +100-140 B gz band (173 B actual)**, with the under-prediction coming from the surprise `_emitCompleteOnItems` simplification (which the roadmap item D didn't explicitly call out).

The semantic change in `*Complete` event timing — `layoutComplete` now fires synchronously after `_processLayoutQueue` returns instead of after the per-item `'layout'` events have all arrived — is **invisible** because items emit their `'layout'` event synchronously during the queue processing. With or without transitions, the order is identical.

## Notes / lessons

- **`once()` is dead in masonry-pretext** because the only consumers were the hide/reveal transition machinery (deleted in #028) and the per-item event aggregator in `_emitCompleteOnItems` (now deleted). If a future plugin author needs once-semantics they can implement it themselves with a wrapper function that calls `off()` from inside the listener.
- **The `_emitCompleteOnItems` simplification is the big calibration win.** I expected the predicted 100-140 B gz from the EvEmitter shim alone; the additional 33 B came from collapsing the 22-line aggregator into a 1-liner. Updated calibration: when shimming an upstream lib, also audit the call sites that become trivial after the API shrinks.
- **Item C (class extends modernization)** is the only Wave 2 item still pending. After C, the Wave 2 deletions are all complete and the bundle should be even smaller.
- **`Object.assign({}, …)` shows up twice in masonry.js's inlined subclass** (#029) and once each in EvEmitter alternatives. Could replace with spread (`{...Outlayer.defaults}`) for a minor savings — left for a future micro-optimization pass.
