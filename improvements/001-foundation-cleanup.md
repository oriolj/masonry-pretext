# 001 — Foundation cleanup: delete dead toolchain, claim fork identity

**Status:** landed
**Roadmap section:** § 2.6 + § 2.6 (extension) — package metadata + dead-tree removal
**Closes upstream issues:** none directly (but unblocks every later improvement)
**Tag:** `v5.0.0-dev.1`
**Commit:** _filled in after landing_

## Hypothesis

The unmodified v4.2.2 import contains a build pipeline that has been broken since 2018:

- `gulpfile.js` references `bower_components/` which never existed in this checkout.
- `package.json` lists 14 devDependencies built around Gulp 3, JSHint, RequireJS, and QUnit — gulp 3 alone pulls hundreds of transitive packages, several with open security advisories that won't be patched.
- `bower.json` declares Bower dependencies; Bower itself was deprecated in 2017.
- `composer.json` declares the package to PHP's Composer, which makes no sense for a JavaScript layout library.

Hypothesis:

1. **Deleting all of the above changes nothing about the runtime library.** `dist/masonry.pkgd.min.js` should be byte-identical before and after — no source touched, no build re-run.
2. **`npm install` should drop from ~349 packages to ~10 packages.** This was already implicitly verified earlier when `@playwright/test` was installed alongside the original devDeps and pulled in 349 packages total.
3. **`devDependencies` count should drop from 14 to 3** (`@playwright/test`, `pixelmatch`, `pngjs` — the three packages the new visual test runner needs).
4. **`tracked files` count nets out to roughly +14**: −6 deleted (`bower.json`, `composer.json`, `gulpfile.js`, `.jshintrc`, `test/index.html`, `test/.jshintrc`) plus the foundation files added concurrently (`scripts/`, `metrics/`, `improvements/`, `test/visual/`, `playwright.config.js`, `FORK_RELEASE_NOTES.md`).
5. **Visual regression suite passes byte-for-byte against the same screenshots before and after** — because no library code changed.
6. **Total LOC will go up, not down**, despite deleting ~370 lines of dead build/test code, because the methodology + test scaffolding adds substantially more lines than it removes. This is fine — LOC is for maintenance burden, not perf.

Renaming the package to `masonry-pretext` and bumping the version to `5.0.0-dev.1` claims the fork identity on npm and signals to any consumer that this is *not* a drop-in replacement for `masonry-layout@4.2.2`.

## Method

### Files deleted

| File | Reason |
|---|---|
| `bower.json` | Bower deprecated 2017 |
| `composer.json` | Composer is a PHP package manager; never made sense for a JS layout lib |
| `gulpfile.js` | Gulp 3 won't run on Node ≥ 16; references `bower_components/` |
| `.jshintrc` | jshint devDep removed; modern lints run via biome / eslint when set up |
| `test/.jshintrc` | same |
| `test/index.html` | QUnit-in-browser harness; depends on `bower_components/` and `qunitjs` devDep |

`test/unit/*.js` and `test/helpers.js` are **kept** as reference for the expected layout positions when porting more cases to the visual suite.

### `package.json` changes

- `name`: `masonry-layout` → `masonry-pretext`
- `version`: `4.2.2` → `5.0.0-dev.1`
- `description`: updated to mention fork + pretext goal
- `type`: added `"module"` (the test runner uses ESM)
- `devDependencies`: `14` → `3` (kept only `@playwright/test`, `pixelmatch`, `pngjs`; pinned to exact versions for reproducibility)
- `scripts`: replaced `test: "test/index.html"` with `test: "node test/visual/run.mjs"`; added `test:visual`, `test:visual:update`, `measure`
- `repository`, `bugs`, `homepage`: pointed at `oriolj/masonry-pretext`
- `keywords`: added `masonry`, `pretext`
- `author`: noted fork author + original

### Foundation files added (concurrent with the cleanup)

These are the files needed to satisfy the methodology going forward. They are not "improvements" themselves; they are the scaffolding every later improvement depends on.

| Path | Purpose |
|---|---|
| `scripts/measure.sh` | Hermetic size/LOC/dep metrics; supports `--save <label>` for `metrics/history.tsv` |
| `metrics/history.tsv` | Append-only log of every measurement run |
| `playwright.config.js` | Playwright test runner config (currently unused — see "deviation" below) |
| `test/visual/pages/*.html` | Self-contained fixtures loading only `dist/masonry.pkgd.min.js` |
| `test/visual/pages/style.css` | Shared styles ported from `test/tests.css` |
| `test/visual/run.mjs` | Custom node-based runner; position assertions + screenshot diffs |
| `test/visual/smoke.mjs` | One-shot debugging script |
| `test/visual/__screenshots__/*.png` | Baseline screenshots for diff comparison |
| `improvements/{README,TEMPLATE,000-baseline,001-foundation-cleanup}.md` | Per-improvement records |
| `FORK_RELEASE_NOTES.md` | User-facing changelog |

### Deviation from the planned approach

`playwright test` (the official runner) hangs in this environment with no output. The chromium API itself works fine — verified via `test/visual/smoke.mjs`. The visual suite uses a custom runner (`test/visual/run.mjs`) that drives chromium directly via the `@playwright/test` package's exported `chromium` import. End result is identical (position assertions + screenshot diffs); the abstraction layer is just thinner. `playwright.config.js` is kept for the day the upstream runner is re-enabled. Documented in `CLAUDE.md` § Build, Lint, Test.

### Commands run

```sh
\rm -f bower.json composer.json gulpfile.js .jshintrc test/index.html test/.jshintrc
# package.json edited via Edit tool
\rm -rf node_modules package-lock.json
npm install --no-audit --no-fund
node test/visual/run.mjs
./scripts/measure.sh --save post-001-foundation-cleanup
```

## Before — `baseline-v4.2.2`

```
== masonry-pretext metrics ==
package           masonry-layout@4.2.2
tracked files     42       (old measure.sh: committed-only)
total LOC         5678     (old counting)
dependencies      2
devDependencies   14

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                     7473        2455        2108       239
  dist/masonry.pkgd.js                   63316       15752       13742      2504
  dist/masonry.pkgd.min.js               24103        7367        6601         8
```

`npm install` of the original devDep set: **349 packages** (measured during the `@playwright/test` install when the original devDeps were still listed).

Visual test status: n/a — the visual suite did not exist yet. This improvement *introduces* it.

## After — `post-001-foundation-cleanup`

```
== masonry-pretext metrics ==
package           masonry-pretext@5.0.0-dev.1
tracked files     56       (new measure.sh: tracked + staged + untracked-not-ignored)
total LOC         6470
dependencies      2
devDependencies   3

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                     7473        2455        2108       239
  dist/masonry.pkgd.js                   63316       15752       13742      2504
  dist/masonry.pkgd.min.js               24103        7367        6601         8
```

`npm install` of the slimmed devDep set: **10 packages**, ~13 MB `node_modules/`.

Visual test status: **4 passed, 0 failed (4 total)** on first invocation, and stable across repeated runs. Snapshots committed at `test/visual/__screenshots__/{basic-top-left,gutter,horizontal-order,fit-width}.png`.

## Delta

| Metric | Before | After | Δ | % |
|---|---:|---:|---:|---:|
| `npm install` package count | 349 | **10** | −339 | **−97.1%** |
| `devDependencies` listed in `package.json` | 14 | **3** | −11 | **−78.6%** |
| Runtime `dependencies` | 2 | 2 | 0 | 0 |
| Tracked + staged files | 42 | 56 | +14 | +33% (foundation files added) |
| Total LOC | 5,678 | 6,470 | +792 | +14% (docs + tests scaffold) |
| `masonry.js` raw bytes | 7,473 | 7,473 | 0 | 0 |
| `dist/masonry.pkgd.js` raw bytes | 63,316 | 63,316 | 0 | 0 |
| `dist/masonry.pkgd.min.js` raw bytes | 24,103 | 24,103 | 0 | 0 |
| `dist/masonry.pkgd.min.js` gzip | 7,367 | 7,367 | 0 | 0 |
| `dist/masonry.pkgd.min.js` brotli | 6,601 | 6,601 | 0 | 0 |
| Visual tests | (none) | 4 passing | +4 | — |

## Verdict

✅ **Match.** Predictions all confirmed:

1. ✅ **Library bytes unchanged.** No `dist/` byte moved. The change was strictly to package metadata, build tooling, and the foundation scaffold — never touched runtime source.
2. ✅ **`npm install` package count: 349 → 10** (predicted ~10, actual 10). −97.1%, the headline win for this improvement.
3. ✅ **devDeps: 14 → 3.**
4. ✅ **Tracked files net +14.**
5. ✅ **Visual suite passes** with the same dist file driving it.
6. ✅ **LOC went up,** not down (predicted; this is the expected cost of getting tests + methodology in place).

## Notes / lessons

- **`gzip -9n` is critical for reproducible byte counts.** Earlier rough numbers in `FORK_ROADMAP.md` used the default `gzip -c` (level 6, with name + timestamp metadata in the header) and were off by ~26 bytes. The `-n` flag strips the header metadata. The measurement script now hardcodes `-9n` everywhere.
- **`rm` is aliased to `rm -i` in this shell.** First attempts at deletion silently failed because the prompts had no input and the files were left in place. Use `\rm -f` (the leading backslash bypasses the alias) inside Bash tool calls.
- **`playwright test` (the official runner) hangs in this sandbox** for unknown reasons; running `node test/visual/run.mjs` with chromium driven directly via `@playwright/test`'s exported `chromium` import works perfectly. The custom runner is documented and supported; the upstream runner is parked behind `playwright.config.js` for if/when it ever gets diagnosed.
- **`git ls-files` only counts the committed index.** The first version of `measure.sh` reported `tracked files: 42` even after I'd added a dozen new files, because they weren't staged. Fixed by switching to `git ls-files -co --exclude-standard --deduplicate` plus a worktree-existence check inside the wc loop. This now reports "what would be in the next commit if I `git add` everything", which is what I want for iterative measurement.
- **The "improvement #001 cleanup" includes the entire methodology bring-up** (test runner, measure script, improvements/ scaffold). Future improvements can be much more focused — they only have to make their own targeted change and run the existing tests/measure script. The expensive infrastructure work is amortized into this one commit.
- **Predicted-vs-actual diary worked.** Every claim in the hypothesis section was checkable against the measure.sh output. This is the loop that has to be repeated, item by item, for the rest of the roadmap.