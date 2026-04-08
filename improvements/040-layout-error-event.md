# 040 — `'layoutError'` event

**Status:** landed
**Roadmap section:** § Downstream consumer asks · D.6
**Closes upstream issues:** none (downstream multi-tenant debugging)
**Commit(s):** 5.0.0-dev.40

## Hypothesis

Add a `'layoutError'` event fired from `_getItemLayoutPosition` when an
item is in a state that the layout pass would otherwise silently swallow.
The library still positions the item — this is informational, for
forwarding to error trackers (Sentry, Datadog, Rollbar) in multi-tenant
frontends that render arbitrary HTML modules from different sources.

Initial reason set, kept narrow by design:

- `'detached'` — `item.element.parentNode === null`
- `'zero-width'` — `item.size.outerWidth === 0`
- `'colspan-overflow'` — computed colSpan > cols (item too wide for the grid)

`'measurement-failed'` is intentionally NOT in the initial set:
`item.getSize()` already swallows missing-style failures by returning a
zero-size object, which the `'zero-width'` reason already covers. Adding a
try/catch around `getSize` would mask real bugs and is not worth the
bytes for a hypothetical future `getSize` that throws.

**Predictions:**

- **Cost:** ~80-150 B gzipped on `dist/masonry.pkgd.min.js`. The check + the
  emit-payload object + the new probe of `Math.ceil(outerWidth/columnWidth)`
  combine to roughly an 8-10 line code block.
- **Hot-path overhead when no listener is registered:** zero reads beyond the
  existing `this._events` lookup. Gated on `listeners && listeners.length`
  so consumers who don't subscribe don't pay for the probe at all.
- **Test gate:** new `layout-error` discriminating fixture; existing
  `pageAssert` mechanism is added to the runner so the discriminator can
  verify event capture (not just item positions).

## Method

- Files touched:
  - `masonry.js` — added the `'layoutError'` block inside
    `proto._getItemLayoutPosition`, between the size resolution and the
    `placeItem` call. Gated on the existing `this._events.layoutError`
    listener array.
  - `masonry.d.ts` — added `MasonryLayoutErrorEvent` interface and a typed
    `on('layoutError', listener)` overload.
  - `test/visual/run.mjs` — added optional `itemSelector` and `pageAssert`
    fields per case. `itemSelector` lets the layout-error fixture exclude
    its hidden item from position assertions; `pageAssert` runs a
    stringified function in the browser context that returns a failure
    reason or null. Used here to verify `window.__LAYOUT_ERRORS` captured
    the right event with the right reason / index / cols / columnWidth.
  - `test/visual/pages/layout-error.html` — new fixture: 3 visible items
    + 1 `display: none` item interleaved at index 2. Wires a
    `layoutError` listener BEFORE `msnry.layout()` (the `initLayout: false`
    construct lets the listener attach before the first layout pass).
  - `test/visual/__screenshots__/layout-error.png` — new baseline.
  - `package.json` — version bump to `5.0.0-dev.40`.
- Commands run:
  - `make build`
  - `node test/visual/run.mjs --filter=layout-error --update` (snapshot capture)
  - `make test` (full gate)
- **Discriminator verification:** temporarily commented out the
  `this.emitEvent('layoutError', ...)` call in `masonry.js`, rebuilt, and
  re-ran the fixture — saw the expected `pageAssert: expected exactly 1
  layoutError, got 0` failure. Restored the code; the test passed again.
  This confirms the new fixture catches the regression class it's meant
  to catch (versus passing accidentally because the fixture is too lax).

## Before

```
package           masonry-pretext@5.0.0-dev.39

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                    36144       11336        9829       866
  dist/masonry.pkgd.js                   51947       10076        9037      1422
  dist/masonry.pkgd.min.js               23190        7588        6863        19
  dist/masonry.cjs                       48995        9966        8938      1415
  dist/masonry.mjs                       50201       10453        9347      1439
```

## After

```
package           masonry-pretext@5.0.0-dev.40

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                    38176       12005       10399       909
  dist/masonry.pkgd.js                   52767       10249        9186      1444
  dist/masonry.pkgd.min.js               23564        7724        6966        19
  dist/masonry.cjs                       49771       10136        9084      1437
  dist/masonry.mjs                       50977       10622        9489      1461
```

Test status: 15 visual + ssr + module + 9 compute-layout + no-jquery — all green.
Snapshot diffs: new `layout-error.png` baseline created.

## Delta

| Metric | Before | After | Δ | % |
|---|---:|---:|---:|---:|
| dist/masonry.pkgd.min.js raw  | 23190 | 23564 | **+374** | +1.61% |
| dist/masonry.pkgd.min.js gzip |  7588 |  7724 | **+136** | +1.79% |
| dist/masonry.pkgd.min.js br   |  6863 |  6966 | **+103** | +1.50% |

Slightly above the predicted band (predicted 80-150 gz, actual 136 gz),
which is OK — within the upper end. The extra cost is the four-field
event payload object (`item`, `reason`, `columnWidth`, `cols`) plus the
emitEvent call site.

## Verdict

✅ **Match.** Lands at the upper end of the predicted band; all test
gates green; new discriminating fixture verified to catch the regression
class (manually disabled the emit and saw the assertion fail).

## Notes / lessons

- **Discriminator design.** The fixture has 3 visible items + 1
  `display: none` item interleaved at index 2. The runner's existing
  position-assertion mechanism only knew about visible items via the
  default `.item` selector — adding an `itemSelector` override let me
  filter out the hidden one without changing existing fixtures. The
  new `pageAssert` runner extension is the structural way to verify
  discriminating state that isn't expressible as item positions
  (event captures, console output, etc.). It will be useful for
  future fixtures that need similar non-positional discriminators.
- **Hot-path branchlessness.** The `listeners && listeners.length`
  gate means grids that don't subscribe to `'layoutError'` pay
  exactly one property read per item per layout pass: the
  `this._events && this._events.layoutError` lookup. The probe
  branches and the payload object are inside that gate.
- **Why not also fire when `placeItem` returns a clearly-wrong
  position?** Considered. Decided against because (a) the placement
  math has no notion of "wrong" — it produces a position for any
  inputs, including the zero-size case where every item lands at
  (0, 0); (b) the existing 'zero-width' case already catches the
  most common silent failure that 'wrong placement' would catch;
  (c) the bytes saved by the narrow definition keep this improvement
  squarely in the "small ergonomics" tier.
- **Future-proofing:** the reason field is typed as a union of three
  string literals in `masonry.d.ts`. Adding new reasons later is
  source-compatible (consumers using a switch with a default branch
  keep working) but requires a minor type bump. Document the addition
  in the union when it happens.
