# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read this first — fork direction

This repository is the **masonry-pretext** fork of `desandro/masonry`. Before doing any work, read [`FORK_ROADMAP.md`](./FORK_ROADMAP.md) end-to-end — it contains the goals, the dependency audit, the modernization plan, the per-step order of operations, the **measurement methodology**, and the rejected non-improvements list. **Every change in this fork must follow the change loop in `FORK_ROADMAP.md` § Methodology**: capture baseline → state numeric hypothesis → make change → re-measure → re-run tests → record predicted vs actual.

Per-improvement records live in [`improvements/`](./improvements/) (one file per change, using [`improvements/TEMPLATE.md`](./improvements/TEMPLATE.md)). User-facing changes are summarized in [`FORK_RELEASE_NOTES.md`](./FORK_RELEASE_NOTES.md). The roadmap's Progress section tracks landed work at a glance.

Practical implications:
- **Never make a behavior or size claim without running `scripts/measure.sh` and the visual test suite first.** Predicted improvements that don't show up in real numbers do not land.
- **One roadmap section per commit.** No batching pure deletions with refactors — atomic deltas are how the history stays auditable.
- **After every improvement lands, do all four:**
  1. Bump `package.json` version (next `5.0.0-dev.N`).
  2. Update `README.md` § "Key improvements vs upstream" with a one-liner aimed at *library users* (not maintainers) — what they actually get out of this change. Skip changes that have no user-visible effect.
  3. Create an annotated git tag `v5.0.0-dev.N` pointing at the improvement commit, with the improvement title + headline numbers in the tag message.
  4. Mark the row in `FORK_ROADMAP.md` § Progress as ✅ and link the improvement file.
- **Don't touch `dist/`.** It's generated. The build pipeline is being replaced (see roadmap § 2.1) — until then, treat `dist/` as read-only.
- **Don't reintroduce dead browser-compat code.** The fork's whole point is to delete it (vendor prefixes, IE polyfills, matches-selector shim, etc.). If a deletion breaks something, the right fix is usually a modern API, not restoring the polyfill.

## Project

Masonry (masonry-pretext) — a fork of David DeSandro / Metafizzy's cascading grid layout library, modernizing the runtime, fixing dormant upstream pain points, and integrating [chenglou/pretext](https://github.com/chenglou/pretext) for reflow-free text measurement. Source of truth is the single file `masonry.js` at the repo root. Everything in `dist/` is generated.

## Build, Lint, Test

```sh
npm install                       # 10 packages, ~13 MB node_modules
npx playwright install chromium   # ~100 MB browser binary, one-time
npm test                          # runs the visual regression suite
npm run measure                   # prints size/LOC/dep metrics
```

The historical Gulp 3 / Bower / QUnit toolchain was deleted in improvement #001 (see [`improvements/001-foundation-cleanup.md`](./improvements/001-foundation-cleanup.md)) — it had been broken on modern Node since 2020 and depended on `bower_components/` which never existed in this fork. The replacement esbuild build is roadmap § 2.1, not yet landed; **`dist/` is currently the unmodified v4.2.2 packaged build inherited from upstream**, and any new build artifact must be regenerated with the future esbuild script.

### Visual test suite (`test/visual/`)

`node test/visual/run.mjs` (= `npm test`) is a custom Playwright runner — it does not use `playwright test` (the CLI runner hangs in this environment for unknown reasons; the chromium API works fine). It loads each fixture in `test/visual/pages/`, asserts hardcoded item positions against the expected values from upstream qunit tests, and screenshot-diffs against checked-in baselines in `test/visual/__screenshots__/`.

- `node test/visual/run.mjs` — run all fixtures, fail on any diff
- `node test/visual/run.mjs --update` — refresh screenshot baselines (commit them in the same PR as the source change, with rationale)
- `node test/visual/run.mjs --filter=basic` — run a subset

To add a new fixture: drop a self-contained HTML in `test/visual/pages/` that loads `../../../dist/masonry.pkgd.min.js` (no other deps, no bower) and sets `window.__READY = true` after init. Then add a case object to the `cases` array in `run.mjs` with the expected positions.

### Measurement script (`scripts/measure.sh`)

Single source of truth for size, LOC, and dependency-count metrics. Hermetic flags (`gzip -9n`, `brotli -q 11`) so byte numbers are reproducible. Counts tracked + staged + untracked-not-ignored files (i.e., what the next commit would contain). Always run on a clean tree.

```sh
./scripts/measure.sh                            # print to stdout
./scripts/measure.sh --save <label>             # also append a row to metrics/history.tsv
```

## Architecture

Masonry is a thin layout subclass on top of [Outlayer](https://outlayer.metafizzy.co), which provides item lifecycle, events, jQuery bridget, and the public API. `masonry.js` only implements the column-based positioning algorithm by overriding a handful of Outlayer prototype methods:

- `_resetLayout` — measures `columnWidth`, `gutter`, computes `cols`, zeros `colYs` (the per-column running Y).
- `measureColumns` — derives `cols` from container width / `columnWidth`, with sub-pixel rounding tolerance.
- `_getItemLayoutPosition(item)` — for each item: computes `colSpan`, then dispatches to either `_getTopColPosition` (default) or `_getHorizontalColPosition` (when `horizontalOrder: true`), then advances `colYs` for the spanned columns.
- `_getTopColGroup` / `_getColGroupY` — for multi-column items, walks all valid horizontal positions and picks the one whose tallest spanned column is shortest.
- `_getHorizontalColPosition` — left-to-right placement using `horizontalColIndex`, wrapping rows when an item won't fit. Added in #873.
- `_manageStamp` — for stamped (fixed-position) elements: computes which columns the stamp covers and pushes those `colYs` down past the stamp.
- `_getContainerSize` / `_getContainerFitWidth` — reports container height (and width when `fitWidth` is on) back to Outlayer.
- `needsResizeLayout` — only relayout on resize when the container width actually changed.

UMD wrapper at the top of `masonry.js` supports AMD (`define`), CommonJS (`module.exports`), and browser globals (`window.Masonry`). The AMD branch is slated for deletion in roadmap § 2.3 — until then, keep it intact. Also: `Masonry.compatOptions.fitWidth = 'isFitWidth'` keeps the legacy `isFitWidth` option name working alongside `fitWidth`; use `this._getOption('fitWidth')` rather than reading the option directly.

`dist/masonry.pkgd.js` is the **packaged** build that inlines `outlayer`, `get-size`, `ev-emitter`, `fizzy-ui-utils`, `desandro-matches-selector`, and `jquery-bridget`. Never edit it by hand — it will be regenerated by the future esbuild build (roadmap § 2.1).

`sandbox/` contains standalone HTML demos that reference `../bower_components/...` paths. These have been broken since the initial fork checkout (Bower deps were never installed in this repo). They're kept as reference for the layouts the library supports — porting them to load `dist/masonry.pkgd.min.js` directly is a candidate follow-up but not on the critical path.

## Conventions

- 2-space indentation, single quotes, spaces inside parens (`Math.max( a, b )`) — match the surrounding style.
- Issue numbers are referenced inline as `#873`-style comments next to the code that fixed them. Preserve those when refactoring.
- Bug reports require a reduced test case — see `.github/contributing.md`. Use the CodePen demos linked there as a starting point.
