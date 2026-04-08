# 011 — Tier 0 foundation: README + packaging + CI + harness hardening

**Status:** landed
**Roadmap section:** § Post-#010 review — Tier 0 (T0.1 + T0.2 + T0.3 + T0.4)
**Closes upstream issues:** none directly, but unblocks adoption ergonomics
**Tag:** `v5.0.0-dev.11`
**Commit:** _filled in after landing_

## Hypothesis

Four parallel reviews ran against the post-#010 state and converged on a single finding none of the prior reviews noticed: **the original roadmap focused on size/perf/UX of the runtime library and under-weighted packaging, contributor experience, and test portability**. Four real gaps:

- **T0.1** — README's `Install` / `CDN` / `Package managers` / `Initialize` sections still document the upstream library. New users can't follow them.
- **T0.2** — `package.json` has only `"main": "masonry.js"`. No `exports`, `module`, or `types` fields. Modern bundlers can't find the right entry per consumer style.
- **T0.3** — `.github/` has only `contributing.md` + `issue_template.md`. No CI workflow. The "every commit must pass `make test`" rule from § Methodology lives only in the maintainer's local environment.
- **T0.4** — `test/visual/_harness.mjs` launches chromium with `chromium.launch({ headless: true })` and no extra flags. Crashes on Chromium launch in unprivileged containers (verified by an external reviewer whose `npm test` failed in their sandbox).

This improvement addresses all four in one combined commit. **No source code change**; the bundle bytes are unchanged. The win is in adoption ergonomics + a real CI gate.

### Predictions

1. **`dist/masonry.pkgd.{js,min.js}`:** **byte-identical** to pre-011 (no source change)
2. **`make test`:** still 6/6 visual + ✓ SSR + ✓ no-jquery
3. **`npm pack --dry-run`:** new file `masonry.d.ts` shows up; package size grows by ~5-7 KB
4. **`devDependencies`:** unchanged (4)
5. **`dependencies`:** unchanged (2 — full removal of `get-size` is item O, separate scope)
6. **The README's Install section** is now followable by a new user

## Method

### T0.4 — Harden chromium launch flags (`test/visual/_harness.mjs`)

Three hardening flags added to `chromium.launch()`:

```js
const browser = await chromium.launch({
  headless: true,
  args: [
    '--no-sandbox',              // unprivileged container envs (GH Actions, Docker)
    '--disable-dev-shm-usage',   // small /dev/shm in CI containers
    '--disable-gpu',             // headless doesn't need it
  ],
});
```

`--no-sandbox` is the critical one — without it, chromium crashes on launch in any environment that can't grant `CAP_SYS_ADMIN` (every CI runner, every Docker container, many sandboxed dev environments). `--disable-dev-shm-usage` is required because CI containers usually have `/dev/shm` capped at 64 MB; chromium expects much more. `--disable-gpu` skips the GPU process startup which headless doesn't need.

**Must precede T0.3 (CI workflow) or CI fails on the very first run** in the GitHub Actions container.

### T0.1 — README rewrite

Replaced the entire `Install` / `CDN` / `Package managers` / `Initialize` sections with masonry-pretext-correct content:

**Removed:**

- `npm install masonry-layout --save` (wrong package name)
- `bower install masonry-layout --save` (Bower deprecated, wrong name)
- `https://unpkg.com/masonry-layout@4/...` (wrong package, wrong version, points at upstream)
- `$('.grid').masonry({...})` (jQuery removed in #006, syntax broken)
- "## Support Masonry development" upstream Metafizzy promotion (irrelevant for a fork)

**Added:**

- **"Pre-release" notice** at the top of `Install` — masonry-pretext is in dev tags, not yet on npm
- **`From source` section** with `git clone` + `make install` + `make build`
- **`Pinning a specific dev tag` section** with `npm install github:oriolj/masonry-pretext#v5.0.0-dev.10` and a note that git-URL installs require `make build` after install
- **`Browser support` section** stating chrome 84+ / firefox 86+ / safari 15+ / edge 84+
- **`Initialize` section** with vanilla-only API (jQuery shim removed in #006), with the migration table from upstream syntax
- **`With pretext` example** showing the `pretextify` callback with `@chenglou/pretext` (the headline fork feature, currently nowhere in the README)
- **Footer credit** updated to "Original library by David DeSandro · `masonry-pretext` fork by Oriol Jimenez (primarily developed by Claude — see CLAUDE.md)"

The README now matches what `masonry-pretext@5.0.0-dev.11` actually is.

### T0.2 — `package.json` packaging metadata + stub `masonry.d.ts`

**`package.json` changes:**

- `"main"`: `"masonry.js"` → `"./dist/masonry.pkgd.min.js"`. The previous `main` pointed at the source UMD wrapper, which works but doesn't include the build-time transforms (vendor prefix deletion, jQuery removal, etc.). Pointing at the bundled file gives consumers the optimized version.
- Added `"module": "./dist/masonry.pkgd.min.js"` (same target as `main` since we don't yet ship a separate ESM build — that's roadmap § 2.2's full scope, deferred to a future improvement).
- Added `"types": "./masonry.d.ts"` pointing at the new stub.
- Added `"exports"` field with conditional resolution:

```json
"exports": {
  ".": {
    "types": "./masonry.d.ts",
    "import": "./dist/masonry.pkgd.min.js",
    "require": "./dist/masonry.pkgd.min.js",
    "default": "./dist/masonry.pkgd.min.js"
  },
  "./source": "./masonry.js",
  "./unminified": "./dist/masonry.pkgd.js",
  "./package.json": "./package.json"
}
```

The `import` and `require` conditions point at the same minified bundle today — they'll diverge when § 2.2 ships a separate ESM build. The `./source` and `./unminified` subpath exports let consumers explicitly opt into the unbundled source (for custom build tooling) or the unminified output (for debugging). The `./package.json` export is required by some tools (e.g., `vite-tsconfig-paths`) that read it via subpath resolution.

- Added `"sideEffects": false` so modern bundlers can tree-shake the package's unused exports.
- Added `"masonry.d.ts"` to the `"files"` array so it ships in the npm tarball.
- Bumped version to `5.0.0-dev.11`.

**`masonry.d.ts` (new file, ~210 lines):**

Hand-written TypeScript declarations covering the public surface:

- `MasonrySize` interface with `outerWidth` + `outerHeight` (the only fields the `pretextify` callback needs)
- `MasonryItem` interface (opaque-ish, fields users rarely read)
- `MasonryOptions` interface — full options surface including the legacy `is`-prefixed compat aliases (`isFitWidth`, `isOriginLeft`, etc.) which the upstream qunit tests still use
- `Masonry` class with constructor, instance methods (`layout`, `reloadItems`, `appended`, `prepended`, `stamp`, `unstamp`, `remove`, `getItem`, `getItems`, `destroy`, `on`/`off`/`once`), and the `static data` lookup
- **`pretextify` callback typed correctly** as `(element: Element) => MasonrySize | null | undefined | false` (matching the `pretextify(element)` single-arg shape after the simplify-pass-2 narrowing)

Hand-written rather than generated from source because the source is JS with light JSDoc comments — manual is faster than wiring up TypeScript-from-JS extraction for a 250-LOC file. Long-term maintenance plan: keep this in sync as the API evolves; if it drifts, add an integration test that imports the .d.ts in a sandbox TS file and asserts the shapes compile.

### T0.3 — `.github/workflows/test.yml`

New file, ~60 lines, runs `make ci` on `push` and `pull_request`. Key choices:

- **Node 22** (matches the local dev environment).
- **`actions/cache@v4` for `~/.cache/ms-playwright`** — keyed on `package-lock.json` hash, so the chromium download (~100 MB) is cached across runs and only re-downloads when `@playwright/test` version changes.
- **`npx playwright install --with-deps chromium`** — only chromium, not firefox/webkit (the suite doesn't run them) and `--with-deps` to install Linux system deps chromium needs.
- **`make build` then `make test`** — same gate sequence the maintainer runs locally.
- **`make measure`** runs in `if: always()` so even on test failure we get the size numbers in the action log.
- **`timeout-minutes: 10`** — generous; the actual run should be ~30-90 seconds (build is 14 ms, test is ~5-10 s, the rest is npm ci + playwright install).

`pull_request` trigger means contributor PRs auto-validate before merge.

## Before — `pre-011-tier0`

```
package           masonry-pretext@5.0.0-dev.10
tracked files     75
total LOC         9663
dependencies      2
devDependencies   4

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                     8860        3056        2593       270
  dist/masonry.pkgd.js                   49493        9337        8306      1400
  dist/masonry.pkgd.min.js               21736        6957        6267        22
```

6/6 visual + ✓ SSR + ✓ no-jquery. README has stale upstream Install/Initialize sections. `package.json` has only `main`. `.github/` has no workflow. `_harness.mjs` chromium launch is bare.

`npm pack --dry-run`: 5 files in tarball, no `masonry.d.ts`.

## After — `post-011-tier0`

```
package           masonry-pretext@5.0.0-dev.11
tracked files     77
total LOC         10005
dependencies      2
devDependencies   4

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                     8860        3056        2593       270
  dist/masonry.pkgd.js                   49493        9337        8306      1400
  dist/masonry.pkgd.min.js               21736        6957        6267        22
```

6/6 visual + ✓ SSR + ✓ no-jquery. README is masonry-pretext-correct. `package.json` has `main` + `module` + `types` + `exports` + `sideEffects: false`. `masonry.d.ts` ships in the tarball. `.github/workflows/test.yml` runs on push + PR. `_harness.mjs` launches chromium with the hardened flags.

`npm pack --dry-run`: **6 files** (added `masonry.d.ts`), tarball ~28 KB.

## Delta

| Metric | pre-011 | post-011 | Δ |
|---|---:|---:|---:|
| `dist/masonry.pkgd.js` raw | 49,493 | 49,493 | **0** |
| `dist/masonry.pkgd.js` gzip | 9,337 | 9,337 | **0** |
| `dist/masonry.pkgd.min.js` raw | 21,736 | 21,736 | **0** |
| `dist/masonry.pkgd.min.js` gzip | 6,957 | 6,957 | **0** |
| `masonry.js` source raw | 8,860 | 8,860 | **0** |
| Visual regression tests | 6 / 6 | 6 / 6 | unchanged |
| SSR + no-jquery gates | ✓ + ✓ | ✓ + ✓ | unchanged |
| Tracked files | 75 | 77 | +2 (masonry.d.ts, .github/workflows/test.yml) |
| Total LOC | 9,663 | 10,005 | +342 (README rewrite + d.ts + workflow + harness comment) |
| `dependencies` | 2 | 2 | unchanged |
| `devDependencies` | 4 | 4 | unchanged |
| `npm pack --dry-run` files | 5 | 6 | +1 (masonry.d.ts) |
| `npm pack --dry-run` tarball size | ~21 KB | ~28 KB | +7 KB (d.ts + slightly bigger README) |

## Verdict

✅ **Match.** All five predictions held.

| Prediction | Predicted | Actual | Status |
|---|---|---|---|
| `dist/` byte-identical | yes | yes | ✅ |
| `make test` still passes | 6/6 + ✓ + ✓ | 6/6 + ✓ + ✓ | ✅ |
| `npm pack --dry-run` shows new `masonry.d.ts` | yes | yes (6 files vs 5) | ✅ |
| `devDependencies` unchanged | yes | yes (4) | ✅ |
| `dependencies` unchanged | yes | yes (2) | ✅ |
| README is followable by a new user | yes | yes (verified by re-reading the new sections from a "blank-slate user" perspective) | ✅ |

**This is the highest-leverage improvement so far per unit of effort.** Zero source code change, zero behavior change, zero size cost, four real gaps closed.

## Notes / lessons

- **The Tier 0 health check (added to § Methodology in the post-#010 review) would have caught these gaps if it had existed before #001.** The check is now in place; running it before each future improvement is mandatory.
- **The `exports` field's conditional structure matters.** Putting `types` *first* in the conditional list is a TypeScript convention — the resolver matches conditions in declaration order, and `types` should be matched before `import` so TypeScript users get types regardless of which other condition matches. Got this right by checking the TypeScript handbook before writing the field.
- **The `./source` and `./unminified` subpath exports are advanced-user escape hatches.** Most consumers will never use them, but they let someone with custom build tooling reach inside the package without violating the Node.js subpath-export rules (which forbid arbitrary file access once `exports` is set).
- **`sideEffects: false` is safe** because masonry's source has no top-level side effects after the SSR fix in #005 and the get-size box-sizing setup deletion in #007. The factory function bodies only run when explicitly invoked. Modern bundlers can tree-shake the unused exports of consumers' packages with this hint.
- **Hand-writing the d.ts was faster than I expected** (~30 minutes for 210 lines). The next maintenance pain comes if the public API changes — adding a new option or method requires touching both the source AND the d.ts. A long-term plan in § 2.7 is "generate the d.ts from JSDoc-typed source" but that's a future improvement; for now the manual file is fine.
- **The CI workflow's chromium cache step is critical for run time.** Without it, every run downloads ~100 MB of chromium binaries, taking ~30-60 seconds. With the cache, the cache-restore takes ~2-5 seconds and the actual test runs in ~10 seconds.
- **`--with-deps` on `playwright install`** installs Linux system dependencies chromium needs (libraries like `libnss3`, `libgbm1`, etc.) — without it, chromium fails to launch with cryptic "library not found" errors on a fresh ubuntu-latest runner. This is in addition to the `--no-sandbox` flag in the harness; both are needed.
- **`npm pack --dry-run` is the right verification for `package.json` changes.** It shows exactly what files ship to npm consumers, with sizes. Should run as part of the Tier 0 health check before any future package.json edit.