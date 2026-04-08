# 047 — `pause()` / `resume()` for View Transitions

**Status:** landed
**Roadmap section:** § Downstream consumer asks · D.10
**Closes upstream issues:** none (downstream View Transitions ergonomics)
**Commit(s):** 5.0.0-dev.47

## Hypothesis

Add `pause()` and `resume()` methods that suspend the per-item
ResizeObserver and MutationObserver callbacks. Useful during View
Transitions: the document is in a half-swapped state, observers
might fire on items about to be removed (because the transition's
exit animation changes their visual size), and the consumer wants
to suppress those events without disconnecting the observers.

The observers themselves stay connected — only the rAF coalescing
+ relayout path is gated. Events that arrive while paused are
collapsed into a single catch-up `layout()` call when `resume()`
is invoked.

**Predictions:**

- **Cost:** ~30-80 B gzipped on `dist/masonry.pkgd.min.js`. Two
  methods (5 LOC each) + two flag checks (one per observer
  callback). Tier 3 — speculative ergonomics.
- **Test gate:** new `pause-resume.html` discriminating fixture.
  After construction, calls `msnry.pause()`, mutates an item's
  height (would normally trigger a relayout), waits, calls
  `msnry.resume()`, verifies the catch-up layout fired.

## Method

- Files touched:
  - `masonry.js` —
    1. Added `proto.pause` and `proto.resume` methods.
    2. Added `if (self._paused) return;` check at the top of the
       ResizeObserver callback in `_buildResizeObserver`.
    3. Added the same check at the top of the MutationObserver
       callback in `_create`.
    4. Both callbacks ALSO check `_paused` inside the rAF callback,
       in case `pause()` is called between event delivery and the
       coalesced rAF firing.
  - `masonry.d.ts` — added `pause()` and `resume()` method
    declarations on the `Masonry` class with a JSDoc block
    explaining the View Transitions use case.
  - `test/visual/pages/pause-resume.html` — new fixture. After
    construction it pauses, mutates item 0's height, captures the
    layout count (should still be 1 — pause suppressed the
    observer's relayout), resumes, and captures the new layout
    count (should be 2 — the catch-up layout from `resume()`).
  - `test/visual/run.mjs` — added `pause-resume` case with both
    position assertions and a `pageAssert` that verifies the
    layout-count delta across the pause boundary.
  - `test/visual/__screenshots__/pause-resume.png` — new baseline.
  - `package.json` — version bump to `5.0.0-dev.47`.

## Before

```
package           masonry-pretext@5.0.0-dev.46

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                    51638       15958       13853      1160
  dist/masonry.pkgd.js                   56813       10968        9841      1543
  dist/masonry.pkgd.min.js               25640        8309        7500        19
  dist/masonry.cjs                       53619       10850        9737      1536
  dist/masonry.mjs                       54827       11340       10153      1560
```

## After

```
package           masonry-pretext@5.0.0-dev.47

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                    53296       16447       14264      1192
  dist/masonry.pkgd.js                   57166       11021        9889      1553
  dist/masonry.pkgd.min.js               25813        8360        7553        19
  dist/masonry.cjs                       53952       10902        9796      1546
  dist/masonry.mjs                       55160       11391       10197      1570
```

Test status: 21 visual + ssr + module + 11 compute-layout + 4 compute-layouts + no-jquery — all green.

## Delta

| Metric | Before | After | Δ | % |
|---|---:|---:|---:|---:|
| dist/masonry.pkgd.min.js raw  | 25640 | 25813 | **+173** | +0.67% |
| dist/masonry.pkgd.min.js gzip |  8309 |  8360 |  **+51** | +0.61% |
| dist/masonry.pkgd.min.js br   |  7500 |  7553 |  **+53** | +0.71% |

Within the predicted 30-80 B gz band.

## Verdict

✅ **Match.** Cost lands at 51 B gz (predicted 30-80). All test
gates green; new fixture verifies that pause genuinely suppresses
relayouts and resume triggers the catch-up.

## Notes / lessons

- **Tier 3 / speculative.** The consumer flagged this as "unproven
  win" — they haven't measured a real flicker that pause would
  fix. Shipped because the implementation is small and the test is
  load-bearing for the next time someone builds a fixture-driven
  rationale for it.
- **Two checkpoints in each callback.** Each observer callback
  checks `_paused` twice — once at entry (to skip the work entirely)
  and once inside the rAF callback (to handle the case where
  `pause()` is called BETWEEN event delivery and the coalesced rAF
  firing). The double-check costs ~5 bytes and prevents a class of
  race conditions.
- **`resume()` schedules a catch-up layout** even if no events
  fired during pause. This is intentional: it's the simpler
  contract, and the catch-up is cheap (the layout pass already
  reads sizes via `getSize` regardless). A more sophisticated
  version would track whether anything changed during pause and
  skip the catch-up when nothing did, at the cost of more bytes
  and more state. Worth revisiting if this matters in practice.
- **No event firing.** I considered emitting `'pause'` and
  `'resume'` events but couldn't think of a use case the consumer
  would actually want. The API can grow these later if needed.
