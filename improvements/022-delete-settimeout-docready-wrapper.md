# 022 — Delete `setTimeout(0)` docReady wrapper (§ L.6)

**Status:** landed
**Roadmap section:** § L.6 / FORK_ROADMAP.md item 4d
**Closes upstream issues:** none — this is dead-code deletion
**Tag:** `v5.0.0-dev.22`

## Hypothesis

`fizzy-ui-utils.docReady` wraps its synchronous-callback path in `setTimeout(callback)` when the document is already ready. The wrapper exists as a flickity-specific workaround (`metafizzy/flickity#441`) to defer auto-init by one task so other widgets can register first. masonry-pretext does not bundle flickity and the only `docReady` caller is `htmlInit` (which is itself slated for deletion in item E). The setTimeout wraps a synchronous callback in async noise that swallows exceptions and adds one tick of latency. **Delete it.**

Predictions:
- `dist/masonry.pkgd.min.js`: −10 to −20 B raw, −1 to −5 B gz
- All gates green
- No test changes (no fixture exercises `htmlInit`)

## Method

Build-time patch in `scripts/build.mjs` `DEP_FILE_PATCHES`:

```js
{
  description: '[#022] fizzy-ui-utils.js docReady — drop the setTimeout(0) wrapper',
  find: `  if ( readyState == 'complete' || readyState == 'interactive' ) {
    // do async to allow for other scripts to run. metafizzy/flickity#441
    setTimeout( callback );
  } else {
    document.addEventListener( 'DOMContentLoaded', callback );
  }`,
  replace: `  if ( readyState == 'complete' || readyState == 'interactive' ) {
    callback();
  } else {
    document.addEventListener( 'DOMContentLoaded', callback );
  }`,
},
```

## Numbers

| Metric | pre-022 | post-022 | Δ |
|---|---:|---:|---:|
| `dist/masonry.pkgd.js` raw | 58,725 | 58,715 | −10 |
| `dist/masonry.pkgd.js` gz | 11,061 | 11,060 | −1 |
| `dist/masonry.pkgd.min.js` raw | 25,571 | 25,561 | **−10** |
| `dist/masonry.pkgd.min.js` gz | 8,242 | 8,241 | **−1** |
| `dist/masonry.pkgd.min.js` brotli | 7,485 | 7,481 | **−4** |
| Visual + ssr + module + compute-layout + no-jquery | all green | all green | unchanged |

## Verdict

✅ **Match.** Tiny but real. The deletion removes one tick of latency from `htmlInit` auto-init AND lets exceptions from `data-masonry` user code propagate instead of being swallowed by the timer. Item E (delete `htmlInit` entirely) will subsequently make `docReady` a no-op call site, at which point the whole thing can be tree-shaken if `Outlayer.create()` is removed too.
