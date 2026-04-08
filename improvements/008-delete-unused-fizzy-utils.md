# 008 — Delete unused `fizzy-ui-utils` methods (§ L.4 partial)

**Status:** landed
**Roadmap section:** § L.4 — first slice (just the unused-method deletions; the broader "inline fizzy-ui-utils into a slimmed module" is still future work)
**Closes upstream issues:** none directly
**Tag:** `v5.0.0-dev.8`
**Commit:** _filled in after landing_

## Hypothesis

`fizzy-ui-utils` exposes 12 methods on a `utils` object. Audit by grepping `masonry.js` + `node_modules/outlayer/{outlayer,item}.js`:

| Method | Used by masonry/outlayer? |
|---|---|
| `utils.extend` | ✓ (5 sites in outlayer.js) |
| `utils.modulo` | **✗ NEVER CALLED** |
| `utils.makeArray` | ✓ (2 sites) |
| `utils.removeFrom` | ✓ (2 sites) |
| `utils.getParent` | **✗ NEVER CALLED** |
| `utils.getQueryElement` | ✓ (2 sites) |
| `utils.handleEvent` | ✓ (assigned to `proto.handleEvent`) |
| `utils.filterFindElements` | ✓ |
| `utils.debounceMethod` | ✓ |
| `utils.docReady` | ✓ (called by `htmlInit`) |
| `utils.toDashed` | ✓ (called by `htmlInit`) |
| `utils.htmlInit` | ✓ |

**Two methods are dead in the bundle:** `utils.modulo` and `utils.getParent`. They live as object properties on `utils`, so esbuild can't tree-shake them — the whole `utils` object is reachable, all properties stay. Delete them explicitly via build-time transforms.

### Predicted numbers

The deleted methods are tiny (5 LOC + 10 LOC plus their section markers). Predicted:

1. **`dist/masonry.pkgd.min.js` raw:** −100 to −250 B
2. **`dist/masonry.pkgd.min.js` gzip:** −40 to −100 B
3. **`dist/masonry.pkgd.min.js` brotli:** similar to gzip
4. **`dist/masonry.pkgd.js` raw:** −250 to −500 B
5. **Visual + SSR + no-jquery gates:** all green (these methods were never called from the masonry consumption path)
6. **No source change to `masonry.js`.**

This is the smallest L.* deletion so far because there's only ~15 LOC of dead source. Each subsequent L.* improvement will yield smaller raw savings until the bigger architectural improvements (P.1 ResizeObserver, etc.) land.

## Method

Two transforms added to the `fizzy-ui-utils/utils.js` entry in `DEP_FILE_PATCHES`:

1. **`[#008] delete unused utils.modulo`** — exact-string substitution removing the `// ----- modulo ----- //` section header through the closing `};`, plus the trailing blank line.
2. **`[#008] delete unused utils.getParent`** — same shape, removes the `getParent` section.

Both abort the build if their target string isn't found (same defense-in-depth as the existing transforms).

### Why this is "§ L.4 partial"

The roadmap's § L.4 was "inline fizzy-ui-utils" — convert from `utils.foo()` style to direct named imports + slimmed-down vendoring. The full L.4 would replace `require('fizzy-ui-utils')` with a vendored copy and rewrite the consumer call sites. That's a larger refactor.

This improvement does the easier first slice: delete only the methods that are *already* never called. No consumer changes needed. The remaining L.4 work (slim vendoring) is still on the roadmap as a separate future improvement.

### Commands run

```sh
./scripts/measure.sh --save pre-008-fizzy-utils
make test                                      # 4/4 + ✓ ssr + ✓ no-jquery
# grep masonry.js + outlayer to identify unused methods
# edit scripts/build.mjs — add 2 transforms
make test                                      # all gates still green
# bump pkg.json version → 5.0.0-dev.8
./scripts/measure.sh --save post-008-fizzy-utils
```

## Before — `pre-008-fizzy-utils`

```
package           masonry-pretext@5.0.0-dev.7
tracked files     64
total LOC         8063
dependencies      2
devDependencies   4

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                     7510        2473        2116       239
  dist/masonry.pkgd.js                   49191        9271        8244      1393
  dist/masonry.pkgd.min.js               21596        6924        6245        22
```

## After — `post-008-fizzy-utils`

```
package           masonry-pretext@5.0.0-dev.8
tracked files     64
total LOC         8063
dependencies      2
devDependencies   4

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                     7510        2473        2116       239
  dist/masonry.pkgd.js                   48829        9200        8181      1382
  dist/masonry.pkgd.min.js               21458        6871        6202        22
```

All three gates green.

## Delta

| Metric | pre-008 | post-008 | Δ raw | Δ% |
|---|---:|---:|---:|---:|
| `dist/masonry.pkgd.js` raw | 49,191 | **48,829** | **−362** | **−0.74%** |
| `dist/masonry.pkgd.js` gzip | 9,271 | **9,200** | **−71** | **−0.77%** |
| `dist/masonry.pkgd.js` brotli | 8,244 | **8,181** | **−63** | **−0.76%** |
| `dist/masonry.pkgd.min.js` raw | 21,596 | **21,458** | **−138** | **−0.64%** |
| `dist/masonry.pkgd.min.js` gzip | 6,924 | **6,871** | **−53** | **−0.77%** |
| `dist/masonry.pkgd.min.js` brotli | 6,245 | **6,202** | **−43** | **−0.69%** |

### Vs upstream-frozen v4.2.2

| Metric | v4.2.2 | v5.0.0-dev.8 | Δ raw | Δ% |
|---|---:|---:|---:|---:|
| `dist/masonry.pkgd.min.js` raw | 24,103 | **21,458** | **−2,645** | **−10.97%** |
| `dist/masonry.pkgd.min.js` gzip | 7,367 | **6,871** | **−496** | **−6.73%** |
| `dist/masonry.pkgd.min.js` brotli | 6,601 | **6,202** | **−399** | **−6.04%** |

## Verdict

✅ **Match.** All three numeric predictions inside their bands.

| Prediction | Predicted | Actual | Status |
|---|---|---|---|
| min.js raw | −100 to −250 B | **−138 B** | ✅ low end |
| min.js gzip | −40 to −100 B | **−53 B** | ✅ low end |
| min.js brotli | ~similar to gzip | **−43 B** | ✅ |
| pkgd.js raw | −250 to −500 B | **−362 B** | ✅ middle |
| Visual + SSR + no-jquery gates | green | green | ✅ |
| Source unchanged | yes | yes | ✅ |

The savings landed at the **low end** of each band — expected for a deletion this small.

## Notes / lessons

- **The pure-deletion sweep is approaching diminishing returns.** From #003 (−401 raw) → #004 (−606 raw) → #006 (−1,476 raw) → #007 (−378 raw) → #008 (−138 raw). The remaining L.* items (the `setTimeout(0)` docReady wrapper, etc.) are similarly small. **The next big size win will come from architectural improvements** (delete ev-emitter in favor of EventTarget, vendor a slimmed Outlayer, etc.) — those are 100s to 1000s of bytes each but require source-level rewrites, not exact-string deletions.
- **`esbuild can't tree-shake object properties.`** This is the structural reason fizzy-ui-utils carries dead methods. The fix is either build-time deletion (this improvement) or rewriting the dep to expose named exports (the full L.4). For now, build-time deletion is cheaper. If the roadmap eventually wants to fully inline fizzy-ui-utils, the named-export rewrite is the right shape.
- **The audit-by-grep approach is reliable.** Searching `utils\.\w+` against `masonry.js` + `node_modules/outlayer/*.js` produced an exhaustive list of consumed methods. Every method NOT in that list is provably dead because masonry has a closed dep graph (no plugins, no extension points that would dynamically reference utils methods).
- **`utils.handleEvent` is called via the EventListener interface, not via direct `obj.handleEvent(event)` calls.** I almost flagged it as unused because `utils.handleEvent` doesn't appear at any call site that looks like `utils.handleEvent(...)`. But it's assigned to `proto.handleEvent = utils.handleEvent;` so when an Outlayer instance is passed to `addEventListener` (e.g., `window.addEventListener('resize', this)` in `bindResize`), the browser calls `instance.handleEvent(event)` per the EventListener interface contract. **Lesson: when auditing usage, check both direct calls AND prototype assignments.**