# Release notes — masonry-pretext

User-visible changes in the fork. The format roughly follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) but with two extras specific to this fork:

- An **upstream-issue** column for changes that close a known issue in `desandro/masonry`.
- A **predicted vs actual** line for any change that targeted a numeric improvement (size, perf), per the methodology in `FORK_ROADMAP.md` § Methodology.

The full per-change records — hypothesis, before/after measurements, test status, verdict — live in [`improvements/`](./improvements/). This file is the user-facing summary; `improvements/` is the engineering audit trail.

> **Heads up:** masonry-pretext is a fork. It is not a drop-in replacement for `masonry-layout` v4.2.2. Versions are pre-release until v5.0.0 ships. Check the changes below carefully if you are migrating an existing project.

---

## Unreleased — v5.0.0-dev

Work in progress toward v5.0.0. See [`FORK_ROADMAP.md`](./FORK_ROADMAP.md) for the full plan and [`improvements/`](./improvements/) for per-change details.

---

## v5.0.0-dev.1 — 2026-04-08 — Foundation cleanup

> Tag: `v5.0.0-dev.1` · Improvement: [`001-foundation-cleanup.md`](./improvements/001-foundation-cleanup.md) · Closes upstream: _none directly, but unblocks every later improvement_

The first landed change in the fork. **Library bytes are unchanged** — `dist/masonry.pkgd.min.js` is byte-identical to upstream v4.2.2 (24,103 B / 7,367 B gz / 6,601 B br). What changed is everything around it: the build pipeline, the dev dependencies, the test runner, and the package metadata.

### Removed

- **`bower.json`** — Bower has been deprecated since 2017.
- **`composer.json`** — Composer is a PHP package manager and never made sense for a JavaScript layout library.
- **`gulpfile.js`** — Gulp 3 won't run on Node ≥ 16; the build references `bower_components/` which never existed in this checkout.
- **`.jshintrc`, `test/.jshintrc`** — JSHint dev dependency removed.
- **`test/index.html`** — QUnit-in-browser harness; depends on `bower_components/` and the `qunitjs` dev dependency.
- **11 dev dependencies**: `chalk`, `gulp`, `gulp-jshint`, `gulp-json-lint`, `gulp-rename`, `gulp-replace`, `gulp-requirejs-optimize`, `gulp-uglify`, `gulp-util`, `jquery`, `jquery-bridget`, `jshint`, `minimist`, `qunitjs`. The whole tree had multiple unmaintained packages with open security advisories.

### Added

- **`test/visual/`** — self-contained Playwright-based visual regression suite. Position assertions + screenshot diffs against checked-in baselines. Loads only `dist/masonry.pkgd.min.js`, no Bower required. Run via `npm test`.
- **`scripts/measure.sh`** — hermetic size/LOC/dep metrics. Run via `npm run measure`.
- **`metrics/history.tsv`** — append-only measurement log so every change's delta is auditable.
- **`improvements/`** — one file per landed change. Standard template; full hypothesis → method → before → after → verdict.

### Changed

- **Package renamed `masonry-layout` → `masonry-pretext`** to avoid npm conflict with upstream.
- **Version bumped `4.2.2` → `5.0.0-dev.1`** to signal this is pre-release fork work, not a drop-in upstream replacement.
- **`type: "module"`** added to `package.json`. The visual test runner is ESM.
- **`scripts.test`**: was `test/index.html` (a no-op string pointing at the QUnit page), now `node test/visual/run.mjs`.
- **`repository`, `bugs`, `homepage`** repointed at `oriolj/masonry-pretext`.

### Foundation (per-improvement, no library effect)

- Established measurement methodology and baseline. See [`improvements/000-baseline.md`](./improvements/000-baseline.md).
- Documented fork direction in `README.md`, `CLAUDE.md`, `FORK_ROADMAP.md`.
- Added per-improvement record format ([`improvements/TEMPLATE.md`](./improvements/TEMPLATE.md)).

### Numbers

| Metric | v4.2.2 baseline | v5.0.0-dev.1 | Δ |
|---|---:|---:|---:|
| `npm install` package count | **349** | **10** | **−97.1%** |
| `devDependencies` listed | 14 | 3 | −78.6% |
| Runtime `dependencies` | 2 | 2 | 0 |
| `dist/masonry.pkgd.min.js` raw | 24,103 B | 24,103 B | 0 |
| `dist/masonry.pkgd.min.js` gzip | 7,367 B | 7,367 B | 0 |
| `dist/masonry.pkgd.min.js` brotli | 6,601 B | 6,601 B | 0 |
| Visual regression tests | 0 | 4 (passing) | +4 |

**Predicted vs actual:** all six predictions in the hypothesis section of `improvements/001-foundation-cleanup.md` matched within rounding. Predicted ~10 npm packages → actual 10. Predicted devDeps 14 → 3 → matched. Predicted dist bytes unchanged → matched. The change loop worked end-to-end.

### Migration notes

- **Not a drop-in upgrade.** If you currently `npm install masonry-layout@4.2.2`, do not blindly switch to `masonry-pretext@5.0.0-dev.1` — it's a pre-release. Wait for v5.0.0.
- **CDN consumers are unaffected.** `dist/masonry.pkgd.min.js` is byte-identical to upstream.
- **If you forked the build pipeline,** your fork is still based on the broken Gulp 3 toolchain. The replacement esbuild build is roadmap § 2.1 (improvement 002).

---

## Unreleased changes

### Added

_(none yet)_

### Changed

_(none yet)_

### Removed

_(none yet)_

### Fixed

_(none yet)_

### Performance

_(none yet — perf changes require benchmark numbers per `FORK_ROADMAP.md` § Methodology)_

---

## How to read entries below this line (template)

Once real changes start landing, each entry in this file follows this shape:

```
### Removed
- **Deleted `desandro-matches-selector` polyfill.** `Element.matches` is unprefixed since 2014 — the polyfill was dead code in every supported browser.
  - Closes upstream `desandro/masonry#____`
  - Predicted: −600 B raw, −250 B gzipped on `dist/masonry.pkgd.min.js`
  - Actual: _filled in from improvements/NNN-*.md after the change lands_
  - Full record: [`improvements/NNN-delete-matches-polyfill.md`](./improvements/NNN-delete-matches-polyfill.md)
```

The "predicted vs actual" line is non-negotiable for any change targeting a numeric improvement. If actual ≠ predicted, both numbers stay in this file as a calibration record — that gap is how future predictions get sharper.