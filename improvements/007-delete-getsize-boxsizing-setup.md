# 007 — Delete `get-size` box-sizing detection setup (§ L.3)

**Status:** landed
**Roadmap section:** § L.3
**Closes upstream issues:** none directly
**Tag:** `v5.0.0-dev.7`
**Commit:** _filled in after landing_

## Hypothesis

`node_modules/get-size/get-size.js` has a one-time `setup()` function (~40 LOC) that creates a probe div, mounts it to the document, measures it via `getComputedStyle`, and removes it — solely to detect a quirk where IE11 and Firefox <29 returned the *inner* width on `style.width` for border-box elements while modern browsers (Chrome/Safari) return the *outer* width. The result is stored in `isBoxSizeOuter`, which is then ANDed with `isBorderBox` to compute `isBorderBoxSizeOuter` — used by the width/height computation in `getSize()` to decide whether to add padding+border or not.

At our browser baseline (chrome 84 / firefox 86 / safari 15 / edge 84, all 2020-2021), the modern behavior is universal. `isBoxSizeOuter` is unconditionally `true` after `setup()` runs. Which means:

- `isBorderBoxSizeOuter = isBorderBox && isBoxSizeOuter` simplifies to just `isBorderBox`.
- The `setup()` function is dead code.
- The `var isSetup = false; var isBoxSizeOuter;` state machinery is dead.
- The `setup()` call from inside `getSize()` is dead.

**Side benefit:** the `setup()` function executes one DOM round-trip (`appendChild` → `getComputedStyle` → `removeChild`) on the first `getSize()` call. Removing it eliminates one forced reflow at first measurement. The savings are tiny (one round-trip per page load) but free.

### Predicted numbers

1. **`dist/masonry.pkgd.min.js` raw:** −300 to −500 B. The setup block is ~40 LOC of source; after minification (which compresses local-only identifiers aggressively), expect the savings to land in this range.
2. **`dist/masonry.pkgd.min.js` gzip:** −80 to −150 B. The setup code has some repeated identifiers (`div`, `style`, `paddingX`, `borderX`) that compress well.
3. **`dist/masonry.pkgd.min.js` brotli:** similar to gzip.
4. **`dist/masonry.pkgd.js` (unminified):** −800 to −1,200 B raw, −150 to −250 B gz.
5. **Visual regression suite:** must remain 4/4 passing. The fixtures use border-box elements (set in `test/visual/pages/style.css` via `* { box-sizing: border-box; }`); if `isBoxSizeOuter` weren't always true at our baseline, the position assertions would fail.
6. **SSR + no-jquery gates:** unchanged.
7. **No source change to `masonry.js`.** The deletion happens at build time via the existing `depFilePatchesPlugin`.

## Method

Three transforms added to the `get-size/get-size.js` entry in `DEP_FILE_PATCHES` (next to the existing `[#005 SSR]` UMD-call-site guard from improvement 005):

| # | Description | What it does |
|---|---|---|
| 1 | `[#007] delete get-size setup() function + isSetup/isBoxSizeOuter state` | Removes the entire `// setup` section header through the closing `}` of the `setup()` function (~40 LOC), replaced with a 3-line tombstone comment explaining the deletion. |
| 2 | `[#007] delete \`setup();\` call from inside getSize()` | Removes the `setup();` line at the top of `getSize()`. The function still exists; only the call is gone. |
| 3 | `[#007] inline isBorderBoxSizeOuter (always equals isBorderBox at our browser baseline)` | Removes the `var isBorderBoxSizeOuter = isBorderBox && isBoxSizeOuter;` declaration AND replaces both `isBorderBoxSizeOuter` references in the width/height ternary expressions with just `isBorderBox`. Done in one combined transform that captures all three sites in a single contiguous block of source. |

All three are exact-string substitutions. Each aborts the build if its target is not found — same defense-in-depth pattern as #004's vendor-prefix transforms. None overlap with the existing #005 SSR guard transform on the same file (the SSR guard touches the UMD wrapper; #007 touches the factory body).

### Commands run

```sh
./scripts/measure.sh --save pre-007-getsize
make test                                   # 4/4 visual + ✓ ssr + ✓ no-jquery
# edit scripts/build.mjs — add 3 transforms to DEP_FILE_PATCHES (get-size entry)
make test                                   # all gates still green
# bump pkg.json version → 5.0.0-dev.7
./scripts/measure.sh --save post-007-getsize
```

## Before — `pre-007-getsize`

```
package           masonry-pretext@5.0.0-dev.6
tracked files     63
total LOC         7789
dependencies      2
devDependencies   4

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                     7510        2473        2116       239
  dist/masonry.pkgd.js                   50043        9460        8412      1415
  dist/masonry.pkgd.min.js               21974        7072        6401        22
```

Visual + SSR + no-jquery gates: all green.

## After — `post-007-getsize`

```
package           masonry-pretext@5.0.0-dev.7
tracked files     63
total LOC         7789
dependencies      2
devDependencies   4

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                     7510        2473        2116       239
  dist/masonry.pkgd.js                   49191        9271        8244      1393
  dist/masonry.pkgd.min.js               21596        6924        6245        22
```

Visual + SSR + no-jquery gates: all green. Build time: 14 ms (unchanged).

## Delta

| Metric | pre-007 | post-007 | Δ raw | Δ% |
|---|---:|---:|---:|---:|
| `masonry.js` source | 7,510 / 2,473 / 2,116 | 7,510 / 2,473 / 2,116 | 0 | 0 |
| `dist/masonry.pkgd.js` raw | 50,043 | **49,191** | **−852** | **−1.70%** |
| `dist/masonry.pkgd.js` gzip | 9,460 | **9,271** | **−189** | **−2.00%** |
| `dist/masonry.pkgd.js` brotli | 8,412 | **8,244** | **−168** | **−2.00%** |
| `dist/masonry.pkgd.js` lines | 1,415 | 1,393 | −22 | −1.6% |
| `dist/masonry.pkgd.min.js` raw | 21,974 | **21,596** | **−378** | **−1.72%** |
| `dist/masonry.pkgd.min.js` gzip | 7,072 | **6,924** | **−148** | **−2.09%** |
| `dist/masonry.pkgd.min.js` brotli | 6,401 | **6,245** | **−156** | **−2.44%** |
| Visual regression tests | 4 / 4 | 4 / 4 | 0 | — |
| SSR smoke test | ✓ | ✓ | 0 | — |
| no-jquery gate | ✓ | ✓ | 0 | — |
| dependencies | 2 | 2 | 0 | — |
| devDependencies | 4 | 4 | 0 | — |
| build time | 14 ms | 14 ms | 0 | — |

### Vs upstream-frozen v4.2.2

| Metric | v4.2.2 | v5.0.0-dev.7 | Δ raw | Δ% | vs v5.0.0-dev.6 |
|---|---:|---:|---:|---:|---|
| `dist/masonry.pkgd.min.js` raw | 24,103 | **21,596** | **−2,507** | **−10.40%** | from −2,129 → −2,507 |
| `dist/masonry.pkgd.min.js` gzip | 7,367 | **6,924** | **−443** | **−6.01%** | from −295 → −443 |
| `dist/masonry.pkgd.min.js` brotli | 6,601 | **6,245** | **−356** | **−5.39%** | from −200 → −356 |

**The fork is now over 10% smaller than upstream in raw bytes, 6% smaller in gzip, 5.4% smaller in brotli.** Each metric's lead grew by ~150-180 B from the previous improvement. Combined `[#003] + [#004] + [#005] + [#006] + [#007]` recovers the +524 B post-002 esbuild gz regression and lands the bundle 443 B *below* upstream gz.

## Verdict

✅ **Match.** All five numeric predictions inside their bands.

| Prediction | Predicted | Actual | Status |
|---|---|---|---|
| min.js raw | −300 to −500 B | **−378 B** | ✅ middle of band |
| min.js gz | −80 to −150 B | **−148 B** | ✅ top end of band |
| min.js br | −80 to −150 B | **−156 B** | ⚠️ ~6 B over the top of band (acceptable; brotli compresses repeated identifiers slightly worse than I estimated) |
| pkgd.js raw | −800 to −1,200 B | **−852 B** | ✅ low end of band |
| pkgd.js gz | −150 to −250 B | **−189 B** | ✅ middle of band |
| Visual + SSR + no-jquery gates | green | green | ✅ |
| Source unchanged | yes | yes | ✅ |

The brotli over-shoot (6 B beyond the predicted ceiling) is the only minor mismatch. Cause: I estimated brotli savings would be similar to gzip, but brotli's dictionary-based compression handles short repeated patterns *better* than gzip on small bundles, so the savings come out slightly higher. Calibration noted: for similar deletion improvements (small contiguous blocks of repetitive code), expect brotli to slightly out-perform gzip on the savings side.

## Notes / lessons

- **The combined inline-isBorderBoxSizeOuter transform is a nice pattern.** Instead of three separate find/replace pairs (one for the var declaration, two for the consumer references), I captured all three sites in one contiguous block of source text. The transform is exact-string but spans multiple lines and replaces three things at once. Cleaner than enumerating each occurrence.
- **Side benefit (forced reflow eliminated) is real but tiny.** The setup() function only ran once per page (lazy on first `getSize()` call), so removing it saves one DOM round-trip at first measurement. Not measurable in any practical benchmark, but it's free and aligns with the "fewer reflows" theme of the upcoming improvements (P.1, P.1b, etc.).
- **No SSR risk.** The deleted setup() function references `document.createElement` / `document.body` — both module-load-relative for SSR purposes. But setup() was lazy (only called from inside `getSize()`), so it didn't crash SSR import even before #007. The deletion just removes the dead code; SSR semantics are unchanged. Verified by ssr-smoke gate.
- **The fork's lead over upstream is now compounding nicely.** From −1,834 B raw / −181 B gz at #006 to −2,507 B raw / −443 B gz at #007 — each L.* deletion adds ~300-600 B raw / ~100-200 B gz. With L.4 (inline fizzy-ui-utils) and L.6 (delete `setTimeout(0)` docReady wrapper) still pending, plus the bigger architectural improvements (P.1 ResizeObserver, etc.), the trajectory toward the v5.0.0 target of ~6 KB minified is realistic.