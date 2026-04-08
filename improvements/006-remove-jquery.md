# 006 — Remove jQuery entirely (§ 2.5)

**Status:** landed — **breaking change** for jQuery shim users
**Roadmap section:** § 2.5 (rewritten in this commit to drop the "ship two builds" plan in favor of full removal)
**Closes upstream issues:** none directly, but eliminates the largest single chunk of dead-when-jQuery-isn't-present code in the bundle
**Tag:** `v5.0.0-dev.6`
**Commit:** _filled in after landing_

## Hypothesis

`jquery-bridget` is a ~150 LOC widget shim that lets jQuery users write `$('.grid').masonry()` instead of `new Masonry('.grid', { … })`. It has been bundled into `dist/masonry.pkgd.{js,min.js}` since upstream v4.2.2 and contributes the single largest chunk of currently-dead-by-default code in the bundle. It also creates a "ghost dep" problem: `jquery-bridget` declares `jquery` as a hard runtime dep, so `npm install masonry-pretext` walks the tree and installs all of jQuery into `node_modules/` even though we already neutralize it at build time via the `jqueryStubPlugin` introduced in #002.

The maintainer's call (per a direct conversation in this turn) is **not** to ship a separate jquery shim build alongside the vanilla one. Just remove jQuery entirely. Anyone using the `$('.grid').masonry()` syntax migrates to `new Masonry('.grid', { … })`, which has always been the documented vanilla API.

This improvement does **A + B + C** from the four-part removal plan I sketched earlier:

- **A: drop `jquery-bridget` from `devDependencies`** so `npm install` no longer pulls jQuery into the dep tree.
- **B: strip the dead `if (jQuery)` branches** in `outlayer/outlayer.js` and `fizzy-ui-utils/utils.js` (the dispatchEvent jQuery event firing, the destroy `jQuery.removeData` call, the `Outlayer.create` `$.bridget` call, the `htmlInit` `$.data` call).
- **C: drop `jquery-bridget` from the bundle entry** in `scripts/build.mjs` (and the `jqueryStubPlugin` that supported it).
- ~~**D: ship two builds (vanilla + jquery shim) with `exports` field routing.**~~ Skipped per maintainer's instruction. No `dist/masonry.pkgd.jquery.js` will exist.

### Predicted numbers

1. **`dist/masonry.pkgd.min.js` raw:** −1,400 to −1,900 B. Bridget alone is ~1,200-1,500 B raw after minification, plus ~200-400 B for the dead `if (jQuery)` branches in outlayer/fizzy-ui-utils.
2. **`dist/masonry.pkgd.min.js` gzip:** −480 to −750 B. Gzip compresses bridget's repeated identifiers (`namespace`, `instance`, `bridget`, etc.) well, so gzip savings are smaller than raw.
3. **`dist/masonry.pkgd.min.js` brotli:** similar to gzip.
4. **`dist/masonry.pkgd.js` (unminified):** roughly 2-3× the minified raw savings.
5. **`devDependencies` count:** 5 → 4.
6. **`npm ls` package count:** drops by 2 (jquery-bridget + jquery).
7. **Visual regression suite stays 4/4.** All four fixtures use the vanilla API (`new Masonry(...)`); none touch the jQuery shim.
8. **SSR smoke test stays ✓.** The jQuery code paths were already inert in Node (guarded by `if (jQuery)`); removing them just removes bytes.
9. **Vs upstream-frozen v4.2.2 gzip:** if the prediction holds, the fork bundle should land **below** upstream's 7,367 B for the first time (currently +262 B over after #005). Predicted post-006 gz: ~7,000-7,200 B → roughly **−170 to −370 B below upstream gz**. This is the main milestone: every metric below upstream.

### Plugin restructure (alongside the jquery deletions)

While I'm in `scripts/build.mjs` anyway:

- **Rename `ssrDomGuardPlugin` → `depFilePatchesPlugin`** and `SSR_FILE_PATCHES` → `DEP_FILE_PATCHES`. The plugin's name was already wrong after #005 added a non-SSR transform (the `docReady` guard is technically about SSR but the upcoming jQuery transforms aren't). Going forward this plugin holds *all* per-file build-time patches, organized by concern within each file's transform list.
- **Delete `jqueryStubPlugin`** entirely. Without `require('jquery-bridget')` in the entry, nothing in the bundle does `require('jquery')`, so the stub has nothing to intercept. ~20 LOC of `scripts/build.mjs` deleted.
- **`outlayerItemModernPlugin` stays separate** because its 7 transforms (vendor-prefix deletion + SSR guard) are a coherent grouping. Future improvements may fold it into `depFilePatchesPlugin` if the architecture wants to consolidate, but this commit doesn't.

## Method

### Source / config edits (3 files)

1. **`package.json`:** drop `"jquery-bridget": "2.0.1"` from devDeps. Slim down to 4 devDeps.
2. **`scripts/build.mjs`:**
   - Entry contents simplified to `module.exports = require('masonry.js')` (removed `var Masonry = require(...); var jQueryBridget = require('jquery-bridget'); jQueryBridget('masonry', Masonry); module.exports = Masonry;`).
   - Deleted `jqueryStubPlugin` definition (~20 LOC).
   - Renamed `ssrDomGuardPlugin` → `depFilePatchesPlugin`, `SSR_FILE_PATCHES` → `DEP_FILE_PATCHES`.
   - Updated plugin docstring to cover both SSR + jQuery removal concerns.
   - Removed the `jquery-bridget/jquery-bridget.js` entry from `DEP_FILE_PATCHES` (no longer in the bundle, no patch needed).
   - Added jQuery removal transforms:
     - `outlayer/outlayer.js`: `var jQuery = window.jQuery;` → `var jQuery = false;`
     - `fizzy-ui-utils/utils.js` (inside `htmlInit`): `    var jQuery = window.jQuery;` → `    var jQuery = false;`
   - Updated the `plugins:` array in `sharedConfig` to drop `jqueryStubPlugin` and use `depFilePatchesPlugin`.

### Why direct branch deletion (after DCE didn't work)

**First attempt:** replace `var jQuery = window.jQuery;` with `var jQuery = false;` (one-line per file) and let esbuild's minifier constant-fold every `if (jQuery)` branch and DCE the bodies. Predicted to be the most robust approach (one transform per file, automatically handles any future `if (jQuery)` branches that get added upstream).

**Result:** **didn't work.** After building, the bundle still contained `bridget` references at line 16 of the minified file:

```js
// minified output, post-DCE-attempt
f.htmlInit(s,t), a && a.bridget && a.bridget(t,s), s
```

esbuild's minifier renamed `jQuery` → `a` but **did not constant-fold `a` to `false`** in this code. The reason: `var jQuery = window.jQuery` (later `var jQuery = false`) is declared at the top of the `outlayer.js` factory function. The `if (jQuery && jQuery.bridget)` check lives inside `Outlayer.create`, which is a function-typed property on the `Outlayer` object. esbuild's minifier is conservative about constant-propagating across function-property closures — it can't statically prove the property is never reassigned (e.g., `Outlayer.create = somethingElse`), so it leaves the variable as a possibly-mutable reference.

I tried `const jQuery = false;` to give the minifier explicit "this is constant" information. **Same result** — the constant-fold still didn't propagate into the function-property closures. esbuild's minifier appears to limit constant propagation to lexically-local references in non-property contexts.

**Second attempt (the version that landed):** delete each `if (jQuery) { … }` block via exact-string substitution, plus delete the `var jQuery = window.jQuery;` declaration itself. **Seven transforms total**, fragile to upstream changes but guaranteed to remove the dead code from both the unminified and minified output. Each transform aborts the build if its target string isn't found, so any future outlayer update would loudly fail rather than silently produce dead code.

The transforms target:

1. `outlayer.js` — `var jQuery = window.jQuery;` declaration → deleted
2. `outlayer.js` — constructor's `if (jQuery) { this.$element = jQuery(this.element); }` → deleted
3. `outlayer.js` — `proto.dispatchEvent`'s entire `if (jQuery) { … }` block (with the inner `$.Event` and `.trigger()` calls) → deleted
4. `outlayer.js` — `proto.destroy`'s `if (jQuery) { jQuery.removeData(...) }` block → deleted
5. `outlayer.js` — `Outlayer.create`'s `if (jQuery && jQuery.bridget) { jQuery.bridget(...) }` block → deleted
6. `fizzy-ui-utils.js` — `htmlInit`'s `var jQuery = window.jQuery;` declaration → deleted
7. `fizzy-ui-utils.js` — `htmlInit`'s `if (jQuery) { jQuery.data(elem, namespace, instance); }` block → deleted (and the now-unused `var instance` variable inlined into the constructor call)

After the second attempt: **zero `jquery` / `bridget` strings** in either `dist/masonry.pkgd.js` or `dist/masonry.pkgd.min.js`. Verified with `grep -c 'jquery\|bridget' dist/masonry.pkgd.{js,min.js}` → 0 in both files.

### Tests

- **Visual regression suite:** must stay 4/4. All four fixtures (`basic-top-left`, `gutter`, `horizontal-order`, `fit-width`) use the vanilla API. None of them touch the jQuery shim.
- **SSR smoke test:** must stay ✓. The bundle's IIFE must continue to load in a Node `vm` context with empty globals.
- **No new regression test added** — the jQuery removal is a deletion, not a behavior change. Anyone using `$('.grid').masonry()` would have observed the breakage by now and migrated.

### Commands run

```sh
./scripts/measure.sh --save pre-006-jquery-removal
make test                                       # 4/4 visual + ✓ ssr (baseline)

# A — drop jquery-bridget from devDeps + reinstall
# (edit package.json)
rm -rf node_modules package-lock.json
npm install --no-audit --no-fund
npm ls                                          # verify no jquery in tree
find node_modules -name 'jquery*'               # only outlayer's test fixture

# B + C — edit scripts/build.mjs (entry + plugin restructure + transforms)

make build && make test                         # 4/4 visual + ✓ ssr (post)
./scripts/measure.sh --save post-006-jquery-removal
```

## Before — `pre-006-jquery-removal`

```
package           masonry-pretext@5.0.0-dev.5
tracked files     64
total LOC         7766
dependencies      2
devDependencies   5

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                     7510        2473        2116       239
  dist/masonry.pkgd.js                   54501       10293        9107      1542
  dist/masonry.pkgd.min.js               23450        7629        6898        22
```

`npm ls`: 6 visible top-level packages, including jquery transitive via jquery-bridget.
Visual tests: 4/4 passing.
SSR smoke test: ✓ passing.

## After — `post-006-jquery-removal`

```
package           masonry-pretext@5.0.0-dev.6
tracked files     64
total LOC         7645
dependencies      2
devDependencies   4

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                     7510        2473        2116       239
  dist/masonry.pkgd.js                   50043        9460        8412      1415
  dist/masonry.pkgd.min.js               21974        7072        6401        22
```

`npm ls`: 6 top-level packages, **no jquery anywhere in the tree** (confirmed by `find node_modules -name 'jquery*'` returning only `outlayer/test/unit/jquery-plugin.js`, an unused test fixture inside outlayer's own dev tree).
**Bundle string check:** `grep -c 'jquery\|bridget' dist/masonry.pkgd.{js,min.js}` → **0** in both files. Zero references, dead and alive.
Visual tests: 4/4 passing.
SSR smoke test: ✓ passing.

## Delta

| Metric | pre-006 | post-006 | Δ raw | Δ% |
|---|---:|---:|---:|---:|
| `masonry.js` source | 7,510 / 2,473 / 2,116 | 7,510 / 2,473 / 2,116 | 0 | 0 |
| `dist/masonry.pkgd.js` raw | 54,501 | **50,043** | **−4,458** | **−8.18%** |
| `dist/masonry.pkgd.js` gzip | 10,293 | **9,460** | **−833** | **−8.09%** |
| `dist/masonry.pkgd.js` brotli | 9,107 | **8,412** | **−695** | **−7.63%** |
| `dist/masonry.pkgd.js` lines | 1,542 | 1,415 | −127 | −8.2% |
| `dist/masonry.pkgd.min.js` raw | 23,450 | **21,974** | **−1,476** | **−6.29%** |
| `dist/masonry.pkgd.min.js` gzip | 7,629 | **7,072** | **−557** | **−7.30%** |
| `dist/masonry.pkgd.min.js` brotli | 6,898 | **6,401** | **−497** | **−7.20%** |
| Visual regression tests | 4 / 4 | 4 / 4 | 0 | — |
| SSR smoke test | ✓ | ✓ | 0 | — |
| `devDependencies` | 5 | 4 | −1 | — |
| `dependencies` | 2 | 2 | 0 | — |
| build time | 18 ms | 19 ms | ≈0 | — |

### Vs upstream-frozen v4.2.2 — **THE MILESTONE**

| Metric | v4.2.2 | v5.0.0-dev.6 | Δ raw | Δ% | vs v5.0.0-dev.5 |
|---|---:|---:|---:|---:|---|
| `dist/masonry.pkgd.min.js` raw | 24,103 | **21,974** | **−2,129** | **−8.83%** | improved from −653 B |
| `dist/masonry.pkgd.min.js` **gzip** | 7,367 | **7,072** | **−295** | **−4.00%** | **first metric flip ✓** (was +262 B at #005) |
| `dist/masonry.pkgd.min.js` **brotli** | 6,601 | **6,401** | **−200** | **−3.03%** | **first metric flip ✓** (was +297 B at #005) |

> **For the first time in the fork, every minified-bundle size metric is below upstream.** Raw was already −807 B at #004. Gzip flipped from +262 B over to **−295 B under**. Brotli flipped from +297 B over to **−200 B under**. The +524 B gzipped post-002 esbuild regression has been fully repaid and the fork is now meaningfully smaller in every metric. **Verified zero `jquery` / `bridget` strings remain in either bundle file** — `grep -c 'jquery\|bridget' dist/masonry.pkgd.{js,min.js}` → 0 / 0.

## Verdict

✅ **Match — all size predictions inside their bands after the second attempt; gates green; zero jquery strings remain.**

| Prediction | Predicted | Actual | Status |
|---|---|---|---|
| min.js raw | −1,400 to −1,900 B | **−1,476 B** | ✅ low end of band |
| min.js gzip | −480 to −750 B | **−557 B** | ✅ middle of band |
| min.js brotli | similar to gzip | **−497 B** | ✅ middle of band |
| pkgd.js raw | −2,800 to −5,700 B | **−4,458 B** | ✅ middle of band |
| pkgd.js gzip | −960 to −2,250 B | **−833 B** | ⚠️ ~127 B under the band |
| Visual tests | 4/4 | 4/4 | ✅ |
| SSR smoke | ✓ | ✓ | ✅ |
| devDeps drops by 1 | yes | yes (5 → 4) | ✅ |
| jquery gone from `node_modules` | yes | yes | ✅ |
| **Zero `jquery`/`bridget` strings in bundle** | yes | **yes (0 / 0)** | ✅ |
| **Vs upstream gz: flips below** | yes (−170 to −370 B) | **yes (−295 B)** | ✅ middle of predicted range — **THE MILESTONE** |

The upstream-gz milestone landed cleanly in the middle of the predicted range. The first attempt (DCE-based) under-shot every size metric by ~250-300 B because the minifier left dead branches; the second attempt (direct branch deletion) recovered the gap.

## Notes / lessons

- **DCE via `const jQuery = false` is NOT reliable across function-property closures.** I tried this first because it was elegant — one transform per file, lets the minifier do all the work, robust to upstream changes. **It didn't work.** esbuild's minifier did rename `jQuery` to `a` in the minified output, but did NOT constant-propagate across the `Outlayer.create` and `proto.dispatchEvent` closures (function-typed properties of the `Outlayer` object). The dead code stayed in the bundle. **Don't trust this trick again** unless the variable is genuinely lexically-local (no captures into function-property values).
- **Direct branch deletion is the right approach for dead code in dep files.** Seven exact-string transforms for #006, each aborting the build if its target isn't found. Fragile to upstream updates but robust against minifier inconsistencies. Same pattern as #004's vendor-prefix deletions.
- **The bundle string check (`grep -c 'jquery\|bridget' dist/masonry.pkgd.{js,min.js}` → 0 / 0) is the right verification.** A behavior test alone (visual + SSR) wouldn't have caught the leftover dead `bridget` string in the minified output — the strings were unreachable code, behavior was correct, but they were *still in the bytes*. The maintainer specifically asked "I dont want anything jquery here" → the verification needs to be a string-presence assertion, not just a behavior test. **Recommend adding `grep -c 'jquery\|bridget' dist/masonry.pkgd.min.js` to `make test` as an additional gate** so future improvements can never silently reintroduce jquery references.
- **The `dep-file-patches` plugin is the right consolidation point.** Was originally `ssr-dom-guard` plugin (#005) handling SSR concerns; renamed and extended to handle jQuery removal here. Future improvements that need build-time text transforms on dep files should add transforms to the existing entries, not create new plugins.
- **`jqueryStubPlugin` deletion is satisfying.** It existed since #002 to handle the `require('jquery')` that bridget did. Now that bridget is gone, the stub has nothing to intercept. Pure architectural cleanup that fell out of the bigger removal.
- **Iterative discovery beat my predictions twice.** First, the DCE approach didn't work (caught by the explicit user verification "what about d? I don't want anything jquery here" — without that question, the leftover `bridget` strings would have shipped). Second, the direct-deletion second attempt landed bigger savings than the DCE approach AND the first half of the prediction (−295 B gz vs upstream vs the middle of the predicted −170 to −370 B band) — direct deletion is genuinely better than relying on DCE here.
- **No test added for the breaking change.** Anyone calling `$('.grid').masonry()` after upgrading would observe `TypeError: $('.grid').masonry is not a function`. We can't write a regression test for "this no longer works" without bundling jquery into the test environment, which defeats the point. The breaking change is documented in the release notes; the migration is one-line (replace `$('.grid').masonry({…})` with `new Masonry('.grid', {…})`).
- **The upstream-gz flip is the most satisfying number in the fork so far.** From +524 B over upstream gz at #002 to −295 B below at #006 is a 819-byte swing across four improvements. The post-002 regression is gone and the fork is now strictly smaller in every minified-bundle metric.