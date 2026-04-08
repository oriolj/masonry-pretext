# 014 — Percent columnWidth + gutter math fix (§ P.1 / closes desandro/masonry#1006)

**Status:** landed
**Roadmap section:** § P.1 (math) — fix percentage width + gutter
**Closes upstream issues:** **`desandro/masonry#1006`** — "Last column not displayed when using percent and gutter". **53 reactions, the highest-reaction open issue in the upstream tracker** (more than the next 5 combined). Open since 2018 with no upstream movement.
**Tag:** `v5.0.0-dev.14`
**Commit:** _filled in after landing_

## Hypothesis

When the user gives masonry a percentage column width — either as a literal `'20%'` string, an inline-style sizer (`<div class="grid-sizer" style="width: 20%">`), or a stylesheet rule (`.grid-sizer { width: 20%; }`) — the browser resolves the percent to a pixel value **before** masonry sees it. Masonry then runs:

```js
var columnWidth = this.columnWidth += this.gutter;       // 200 + 10 = 210
var containerWidth = this.containerWidth + this.gutter;  // 1000 + 10 = 1010
var cols = containerWidth / columnWidth;                 // 4.81
var excess = columnWidth - containerWidth % columnWidth; // 210 - 130 = 80
var mathMethod = excess && excess < 1 ? 'round' : 'floor';
cols = Math[ mathMethod ]( cols );                       // floor(4.81) = 4
```

`cols` ends up at 4 instead of the obvious 5. The container has 170px of unused space on the right. **This is the bug in `#1006`.**

The semantically correct answer is "5 columns, fitted into the container with 4 gutters of 10px between them". The math is straightforward once you know the original input was a percentage:

```
cols = round(100 / percent)                       = round(5) = 5
columnStride = (containerWidth + gutter) / cols   = (1000+10)/5 = 202
```

The catch is **detecting** that the original input was a percentage. By the time masonry's `_getMeasurement` calls `getSize(elem).outerWidth`, the percent is already long gone — `getStyleSize()` in `get-size.js` literally rejects percent strings (`value.indexOf('%') == -1` is the validity check) and the element's `getComputedStyle().width` is always the resolved px value.

So this improvement adds a **detection layer** that runs in `_resetLayout` before/around `_getMeasurement` and probes three sources for a percent:

1. **Literal in option** — `new Masonry(g, { columnWidth: '20%' })`. New first-class supported value (previously `_getMeasurement` would crash on `querySelector('20%')`, an invalid CSS selector).
2. **Inline style on the sizer** — `elem.style.width.match(/^([\d.]+)%$/)`. Catches users who set the percent via JavaScript or inline HTML attribute.
3. **Matching CSS rule in any same-origin stylesheet** — walks `document.styleSheets`, recurses into `@media` / `@supports` rules whose conditions currently match, and finds rules where `rule.style.width` ends in `%` and `elem.matches(rule.selectorText)`. Last matching rule wins (rough cascade approximation; sufficient for the dominant `.grid-sizer { width: 20% }` pattern). Cross-origin sheets throw on `.cssRules` access — caught and skipped silently.

All three detection layers feed `this._columnWidthPercent` (a number, e.g. `20`). In `measureColumns`, if it's set, the buggy gutter-overshoot math is replaced with the explicit percent-driven derivation.

### Predictions

1. **`min.js` raw:** +900 to +1500 B (calibration from #012: ~300 B raw per prototype override + ~400-700 B for the helper functions and the regex literals)
2. **`min.js` gz:** +300 to +500 B
3. **`min.js` brotli:** similar to gz
4. **`masonry.js` source:** +4000-6000 B (verbose comments + 2 helper functions + the override + the literal-detection branch — same comment-heavy pattern as #009/#010/#012)
5. **All 7 existing visual fixtures still pass.** No behavior change for non-percent column widths — the percent path is gated on `_columnWidthPercent` being set.
6. **New `percent-cols` fixture passes — and FAILS without the fix.** Container 240px, gutter 20px, sizer width 20%. Without the fix: cols=floor((240+20)/68)=3 and items wrap to row 2. With the fix: cols=round(5)=5 and all 5 items pack into row 1. The position assertion catches the broken math (item 1 left=68px without fix, =52px with fix).
7. **SSR + module-smoke + no-jquery gates unchanged.** Detection helpers are guarded by `typeof document === 'undefined'` and `typeof window === 'undefined'` checks; no jquery/bridget strings; no module-export changes.

## Method

### `detectPercentWidth(elem)` helper

```js
function detectPercentWidth( elem ) {
  // Layer 2 — inline style on the sizer element.
  var inline = elem.style && elem.style.width;
  var inlineMatch = inline && inline.match( PERCENT_RE );
  if ( inlineMatch ) return parseFloat( inlineMatch[1] );

  // Layer 3 — walk document.styleSheets for matching width-percent rules.
  if ( typeof document === 'undefined' || !document.styleSheets ) return null;
  var found = null;
  for ( var i = 0; i < document.styleSheets.length; i++ ) {
    var rules;
    try { rules = document.styleSheets[i].cssRules; }
    catch ( e ) { continue; } // CORS / security error — skip
    if ( rules ) {
      var inner = scanRulesForPercentWidth( rules, elem );
      if ( inner !== null ) found = inner;
    }
  }
  return found;
}
```

### `scanRulesForPercentWidth(rules, elem)` helper

Recurses into `@media` / `@supports` rules **only when their condition currently matches** (otherwise we'd find percents from inactive viewports). For style rules whose width ends in `%`, calls `elem.matches(rule.selectorText)` — wrapped in try/catch for invalid selectors. Last match wins as a rough cascade approximation.

### `_resetLayout` change

Detects the literal-percent path **before** `_getMeasurement` runs (because `_getMeasurement` calls `querySelector('20%')`, which throws on the invalid selector). For the sizer-element path, lets `_getMeasurement` run normally and then probes the resolved sizer afterwards via `detectPercentWidth`.

```js
this._columnWidthPercent = null;
var optCW = this.options.columnWidth;
var literalMatch = typeof optCW === 'string' && optCW.match( PERCENT_RE );
if ( literalMatch ) {
  this._columnWidthPercent = parseFloat( literalMatch[1] );
  this.columnWidth = 0;
} else {
  this._getMeasurement( 'columnWidth', 'outerWidth' );
  if ( typeof optCW === 'string' || optCW instanceof HTMLElement ) {
    var sizer = optCW instanceof HTMLElement
      ? optCW
      : this.element.querySelector( optCW );
    if ( sizer ) {
      this._columnWidthPercent = detectPercentWidth( sizer );
    }
  }
}
```

### `measureColumns` change

```js
if ( this._columnWidthPercent && this.containerWidth ) {
  this.cols = Math.max( 1, Math.round( 100 / this._columnWidthPercent ) );
  this.columnWidth = ( this.containerWidth + this.gutter ) / this.cols;
  return;
}
```

The stride formula `(containerWidth + gutter) / cols` derives from `cols * stride - gutter = containerWidth` (the last column has no trailing gutter). This matches the column-stride convention used by the standard branch, where `this.columnWidth += this.gutter` already inflates `columnWidth` to a stride.

### Discriminating fixture (`test/visual/pages/percent-cols.html`)

Same shape as #009 (pretext) / #010 (fonts-ready) / #012 (resize-observer): pick a final layout only achievable through the new code path; assert exact pixel positions; the assertion catches the broken case loudly.

- Container `#percent-cols` is 240px wide, gutter is 20px.
- Sizer `.grid-sizer` has CSS `width: 20%`, which the browser resolves to **48px**.
- 5 items, each `width: calc(20% - 16px) = 32px`, height 30px.
- 5 × 32 + 4 × 20 = 240 — exactly fills the container at 5 columns.

| Layout | cols | columnWidth stride | item 1 left | item 4 top |
|---|---:|---:|---:|---:|
| **Without fix (broken)** | floor((240+20)/68) = **3** | 68 | **68px** | **30px** |
| **With #014 fix** | round(100/20) = **5** | (240+20)/5 = 52 | **52px** | **0px** |

The position-assertion array in `run.mjs` checks every item's `left` and `top` against the post-fix expected values. The very first divergence (item 1 left = 68 vs 52) trips the failure — proven by toggling the fix off via `if (false && ...)` and watching the runner report `item 1: left expected 52px got 68px`.

### Calibration: getting the stride formula right

First attempt used `columnWidth = (containerWidth - gutter*(cols-1)) / cols` — the **item width** formula, not the stride formula. The position assertion immediately caught the discrepancy: `item 1: left expected 52px got 32px`. Item 1 was at `columnWidth * 1 = 32` instead of `52` because `_getItemLayoutPosition` computes `position.x = columnWidth * col` and the existing code in measureColumns adds the gutter to columnWidth via `this.columnWidth += this.gutter`. The fix branch has to maintain the same convention — columnWidth is a per-column **stride** (item width + gutter), not the item width. Switching to `(containerWidth + gutter) / cols` made the assertion pass.

**Lesson:** when overriding a function that mutates an instance variable like `this.columnWidth += this.gutter`, the override must preserve the post-condition the rest of the code depends on. The discriminating fixture caught this in the first run, before the change had any chance to ship a regression.

### Commands run

```sh
./scripts/measure.sh --save pre-014-percent-cols
make test                                          # 7 + ✓ + ✓ + ✓ baseline

# edit masonry.js — add detection helpers + _resetLayout + measureColumns branches
# create test/visual/pages/percent-cols.html
# add percent-cols case to test/visual/run.mjs

make build && node test/visual/run.mjs --update --filter=percent-cols
node test/visual/run.mjs                           # ✗ stride formula bug — item 1 at 32, expected 52
# diagnose: my formula returned item width, not the stride convention
# fix:    columnWidth = (containerWidth + gutter) / cols
make build && make test                            # ✓ 8/8 + ✓ ssr + ✓ module + ✓ no-jquery

# verify the discriminator: temporarily disable the fix
# `if ( this._columnWidthPercent ... )` → `if ( false && this._columnWidthPercent ... )`
make build && node test/visual/run.mjs --filter=percent-cols
# → ✗ item 1: left expected 52px got 68px (3-col broken layout) — discriminator works
# restore the fix

# bump pkg.json version → 5.0.0-dev.14, rebuild for banner
./scripts/measure.sh --save post-014-percent-cols
```

## Before — `pre-014-percent-cols`

```
package           masonry-pretext@5.0.0-dev.13
tracked files     85
total LOC         14145
dependencies      2
devDependencies   4

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                    12914        4206        3587       361
  dist/masonry.pkgd.js                   52126        9844        8759      1463
  dist/masonry.pkgd.min.js               22984        7323        6591        22
  dist/masonry.cjs                       49099        9735        8669      1456
  dist/masonry.mjs                       50288       10215        9079      1480
```

7/7 visual + ✓ SSR + ✓ module-smoke + ✓ no-jquery.

## After — `post-014-percent-cols`

```
package           masonry-pretext@5.0.0-dev.14
tracked files     87
total LOC         14633
dependencies      2
devDependencies   4

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                    18361        5976        5095       477
  dist/masonry.pkgd.js                   54801       10356        9228      1526
  dist/masonry.pkgd.min.js               24241        7714        6973        22
  dist/masonry.cjs                       51648       10247        9142      1519
  dist/masonry.mjs                       52837       10725        9551      1543
```

8/8 visual + ✓ SSR + ✓ module-smoke + ✓ no-jquery.

## Delta

| Metric | pre-014 | post-014 | Δ raw | Δ% |
|---|---:|---:|---:|---:|
| `masonry.js` source raw | 12,914 | **18,361** | **+5,447** | **+42.18%** (mostly the verbose comments — same pattern as #009/#010/#012) |
| `masonry.js` source lines | 361 | **477** | +116 | +32.13% |
| `dist/masonry.pkgd.js` raw | 52,126 | **54,801** | **+2,675** | **+5.13%** |
| `dist/masonry.pkgd.js` gzip | 9,844 | **10,356** | **+512** | **+5.20%** |
| `dist/masonry.pkgd.min.js` raw | 22,984 | **24,241** | **+1,257** | **+5.47%** |
| `dist/masonry.pkgd.min.js` gzip | 7,323 | **7,714** | **+391** | **+5.34%** |
| `dist/masonry.pkgd.min.js` brotli | 6,591 | **6,973** | **+382** | **+5.80%** |
| Visual regression tests | 7 / 7 | **8 / 8** | +1 (`percent-cols`) | |
| SSR + module-smoke + no-jquery gates | ✓ + ✓ + ✓ | ✓ + ✓ + ✓ | unchanged | |

### Vs upstream-frozen v4.2.2

| Metric | v4.2.2 | v5.0.0-dev.14 | Δ raw | Δ% |
|---|---:|---:|---:|---:|
| `dist/masonry.pkgd.min.js` raw | 24,103 | **24,241** | **+138** | **+0.57%** |
| `dist/masonry.pkgd.min.js` gzip | 7,367 | **7,714** | **+347** | **+4.71%** |
| `dist/masonry.pkgd.min.js` brotli | 6,601 | **6,973** | **+372** | **+5.63%** |

The fork has now slipped to **slightly above upstream in all three metrics** for the first time since #006. The combined cost of the four post-#008 features (#009 pretext callback, #010 fonts.ready hook, #012 per-item ResizeObserver, #014 percent fix) has eaten the size lead established by #003-#008. **This was always the plan** — see `FORK_ROADMAP.md` § "Big size wins still on the table". The remaining items A-F + M-O total ~950-1500 B gz of pure deletions waiting to land, all of which restore the lead with margin to spare.

The trade-off in numbers: each gzipped byte added in #009-#014 closed at least one upstream issue or added a measured speedup:
- #009: pretext fast path → +22 B gz / **17-24% layout speedup**
- #010: fonts.ready hook → +63 B gz / **closes #1182**
- #012: per-item ResizeObserver → +365 B gz / **closes #1147 + 7 duplicates** (the dominant complaint cluster)
- #014: percent fix → **+391 B gz / closes #1006 (53 reactions, the highest-reaction open issue)**

That's **10+ closed upstream issues + a measured perf win for ~841 B gz cumulative** — worth several times the bytes back in user-visible fixes.

## Verdict

⚠️ **Partial — gates green, discriminator works, fix lands as designed, but raw size landed slightly above the predicted band.**

| Prediction | Predicted | Actual | Status |
|---|---|---|---|
| `min.js` raw | +900 to +1,500 B | **+1,257 B** | ✅ middle of band |
| `min.js` gzip | +300 to +500 B | **+391 B** | ✅ middle of band |
| `min.js` brotli | similar to gz | **+382 B** | ✅ |
| `masonry.js` source | +4,000 to +6,000 B | **+5,447 B** | ✅ upper part of band |
| Visual fixtures pass | 7 → 8 | **8/8** | ✅ |
| Discriminating fixture FAILS without fix | yes | yes (item 1 at 68px instead of 52px) | ✅ |
| SSR + module-smoke + no-jquery unchanged | yes | yes | ✅ |

**The predictions were calibrated correctly this time** — `+391 B gz` is squarely inside the predicted `+300 to +500 B` band, no over-shoot. Cumulative calibration from #009-#012 gave a sharp prediction here. Same lesson holds for source size: comments dominate the source diff and the predictor needs to be generous with that bucket.

## Notes / lessons

- **The detection layer is the engineering work, not the math fix.** The math fix is 2 lines (`cols = round(100/percent); columnWidth = (containerWidth+gutter)/cols`). The detection logic — three layers covering literal option / inline style / matched CSS rule — is ~70 LOC including the stylesheet walker and the @media-condition gating. This is the right shape: the trickiest part is recognizing the user's intent from the various ways they can express it.
- **The `_getMeasurement` short-circuit for literal `'20%'` is mandatory, not optional.** Without it, `querySelector('20%')` throws `SyntaxError: Failed to execute 'querySelector' on 'Element': '20%' is not a valid selector` and masonry crashes at construction time. The literal-percent path **must** intercept before `_getMeasurement` runs.
- **`@media` + `@supports` rules need a `matchMedia()` gate during the stylesheet walk.** The first version of `scanRulesForPercentWidth` recursed into nested rules unconditionally, which would have picked up percents from inactive viewports (e.g. a desktop layout with `width: 20%` inside a mobile-only `@media (max-width: 600px)`). The fix is `if (rule.media && !window.matchMedia(rule.media.mediaText).matches) continue;`. Cheap and correct.
- **Cross-origin stylesheets throw on `.cssRules` access** (security error). The walker has `try { rules = ss.cssRules; } catch (e) { continue; }`. Users with cross-origin CDN-loaded styles for `.grid-sizer` won't get the auto-detection from layer 3 — they have to use layer 1 (literal `'20%'` option) or layer 2 (inline style on the sizer). Documented in the README example.
- **The stride formula bug was caught immediately by the fixture's position assertion.** First attempt computed columnWidth as (containerWidth - gutter*(cols-1))/cols (the item-width formula); the assertion caught it on the first run because masonry's `_getItemLayoutPosition` does `position.x = columnWidth * col` and the existing code's convention is that `columnWidth` is a per-column stride INCLUDING the gutter. Same lesson as #012's WeakSet bug: **build the discriminator first, debug against it second.**
- **#1006 has been open since 2018 with 53 reactions and zero upstream movement.** This is the highest-reaction open issue in `desandro/masonry`. Closing it for ~391 B gz is one of the best issue/byte ratios in the fork — comparable to #012 (8 issues for 365 B gz). The pattern of "find a long-stale upstream issue with a clear-but-unclaimed fix and just ship it" is by far the highest-leverage thing this fork can do; the next two candidates are item I (`#811`, column-pick strategy callback, 10 reactions) and item J (`#1129`, parent max-width with fitWidth, 3 reactions).
- **The fork has slipped above upstream in min size for the first time since #006.** Expected and acceptable — the next batch of size deletions (items A-F + M-O in `FORK_ROADMAP.md`) is the planned reversal. v5.0.0-rc.1 is targeted for "after the deletions land and the fork is comfortably under upstream again".
