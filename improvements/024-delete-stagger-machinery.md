# 024 — Delete stagger machinery (item B)

**Status:** landed
**Roadmap section:** § Post-#010 / FORK_ROADMAP.md item B
**Tag:** `v5.0.0-dev.24`

## Hypothesis

Delete every reference to `options.stagger` and the supporting machinery:

- `proto.updateStagger` (option-to-ms reader, in outlayer.js)
- The `updateStagger()` call + `i` arg in `proto._processLayoutQueue`
- The stagger calls in `proto._positionItem`, `proto.reveal`, and `proto.hide`
- `msUnits` constant and `getMilliseconds` helper (only used by `updateStagger`)
- `proto.stagger` and the `staggerDelay` field on `Item`
- The `transitionDelay: this.staggerDelay || 0` line in `Item`'s `css()` call

`options.stagger` is unused in masonry-pretext: it's never set by any of the visual fixtures, the Astro/Next.js examples, or any consumer. The hide/reveal animation system that stagger feeds into is itself slated for deletion in item A. **Predicted savings: ~140-180 B gz.**

## Method

Build-time patches in `scripts/build.mjs` add 8 transforms across `outlayer.js` and `item.js`:

1. Delete `proto.updateStagger`
2. Drop `updateStagger()` call + `i` arg from `_processLayoutQueue`
3. Drop `i` parameter + stagger call from `_positionItem` definition
4. Drop stagger from `proto.reveal`
5. Drop stagger from `proto.hide`
6. Delete `msUnits` + `getMilliseconds` (only used by deleted `updateStagger`)
7. Drop `transitionDelay: staggerDelay || 0` from `Item.css()` call
8. Delete `proto.stagger` from `Item`

### Calibration: a missed call site

First attempt deleted `proto.updateStagger` but left an `this.updateStagger()` call in `_processLayoutQueue` standing — the visual tests caught it loudly with a `page.waitForFunction` timeout (`__READY` never became true). The chromium console error was `this.updateStagger is not a function`. Fixed by adding the missing `_processLayoutQueue` patch before re-running.

**Lesson:** when deleting a method, grep the bundle for ALL call sites first, not just the obvious ones from the source listing. The roadmap mentioned `_positionItem` stagger arg + `updateStagger` deletion but didn't enumerate the `_processLayoutQueue` call site explicitly.

## Numbers

| Metric | pre-024 | post-024 | Δ |
|---|---:|---:|---:|
| `dist/masonry.pkgd.js` raw | 58,479 | 57,216 | **−1,263** |
| `dist/masonry.pkgd.js` gz | 11,034 | 10,761 | **−273** |
| `dist/masonry.pkgd.min.js` raw | 25,415 | **24,855** | **−560** |
| `dist/masonry.pkgd.min.js` gz | 8,214 | **8,026** | **−188** |
| `dist/masonry.pkgd.min.js` brotli | 7,465 | **7,281** | **−184** |
| Visual + ssr + module + compute-layout + no-jquery | all green | all green | unchanged |

## Verdict

✅ **Match — landed at the upper end of the predicted +140-180 B gz band (actually +188 B gz).** All gates green. The deletion exposed one missed call site (`_processLayoutQueue`'s `this.updateStagger()`) that the visual fixtures caught immediately.

The fork's bundle is now back inside −1.5% of upstream gzipped (was +12.5% above after #017). Cumulative recovery of ~50% of the SSR feature line's byte cost from this single deletion.
