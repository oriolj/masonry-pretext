# 000 — Baseline (v4.2.2 imported as-is)

**Status:** landed
**Roadmap section:** — (foundation)
**Closes upstream issues:** none
**Commit(s):** _baseline commit_ `d2b80d1` (the fork-direction docs commit; no source changes)

## Purpose

Capture the unmodified state of the repository — file sizes, LOC, dependency counts, package metadata — before any fork changes land. Every subsequent improvement is measured as a delta against this row in `metrics/history.tsv` (label `baseline-v4.2.2`).

This file exists so that future maintainers (and future Claude sessions) can answer the question "what did we start with?" without re-running `git checkout` against an old SHA.

## Method

```sh
./scripts/measure.sh --save baseline-v4.2.2
```

The script is documented in `FORK_ROADMAP.md` § Methodology. Run from a clean working tree on the commit listed above.

## Snapshot — `scripts/measure.sh` output

```
== masonry-pretext metrics ==
package           masonry-layout@4.2.2
tracked files     42
total LOC         5678
dependencies      2
devDependencies   14

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                     7473        2455        2108       239
  dist/masonry.pkgd.js                   63316       15752       13742      2504
  dist/masonry.pkgd.min.js               24103        7367        6601         8
```

(Note: `dist/masonry.pkgd.min.js` is one minified line — `wc -l` reports 8 because of trailing newlines from the IIFE wrapper. Treat the raw/gz/br columns as authoritative for size, ignore `lines` for minified files.)

## Headline numbers to beat

| Metric | Baseline | v5 target | Improvement |
|---|---:|---:|---:|
| `dist/masonry.pkgd.min.js` raw | **24,103 B** | ~6,000 B | ~4× smaller |
| `dist/masonry.pkgd.min.js` gzip | **7,367 B** | ~2,200 B | ~3.4× smaller |
| `dist/masonry.pkgd.min.js` brotli | **6,601 B** | ~2,000 B | ~3.3× smaller |
| `dependencies` count | 2 | 0 | full removal |
| `devDependencies` count | 14 | ~3 | gulp toolchain → esbuild |
| Tracked files | 42 | (TBD) | bower.json + composer.json removed; metrics + improvements + tests added |
| Total LOC | 5,678 | (mostly drops) | dependency vendor code deleted, doc files added |

**The targets are predictions, not commitments.** They were derived in `FORK_ROADMAP.md` § "Bundle size projection" from a manual reading of which dependencies are deletable. The actual numbers will differ — sometimes worse, sometimes better — and every step's real delta will be recorded in this folder so we can calibrate future predictions.

## Calibration notes

Prior prediction in `FORK_ROADMAP.md` (pre-baseline) said `dist/masonry.pkgd.min.js` was **7,393 bytes gzipped**. Actual measurement is **7,367 bytes gzipped** — off by 26 bytes (~0.35%).

Cause: the earlier number used `gzip -c` (default level 6), the measure script uses `gzip -9nc` (max compression, no name/timestamp metadata). The `-n` flag is critical for reproducible numbers — without it, gzip embeds the source filename and a Unix timestamp into the header, changing the output bytes between runs of the same file.

**Lesson for the methodology:** byte-counting commands must be hermetic. The script now uses `gzip -9n` and `brotli -q 11` consistently, and these are the canonical numbers for all future deltas in this folder.

## Test status at baseline

Visual / regression tests do **not** exist yet. The original `test/index.html` runs in-browser via QUnit and depends on `bower_components/`, which is deprecated. A self-contained Playwright suite is being added in improvement `001` and will be the gate for everything after that.

For improvement `000` itself (this file), there is nothing to verify beyond the metrics snapshot above.

## Verdict

✅ **Baseline captured.** All subsequent improvements are deltas from these numbers.