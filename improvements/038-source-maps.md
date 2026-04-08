# 038 — Source maps in `dist/`

**Status:** landed
**Roadmap section:** § Downstream consumer asks · D.5
**Closes upstream issues:** none (downstream ergonomics)
**Commit(s):** 5.0.0-dev.38

## Hypothesis

Emit external source maps for every esbuild output (`pkgd.js`, `pkgd.min.js`,
`cjs`, `mjs`, plus the three Web-Component bundles) so production error
trackers can resolve minified stack traces back to `masonry.js` line numbers.

- Adds 7 new `dist/*.map` files alongside the existing JS outputs.
- Adds **~45 bytes per JS file** for the `//# sourceMappingURL=...` directive
  (esbuild appends this when `sourcemap: true`).
- **No source code changes** — pure build script change.
- **No behavior change** — all existing test gates must pass byte-for-byte.

## Method

- Files touched:
  - `scripts/build.mjs` — added `sourcemap: true` + `sourcesContent: true` to
    `baseConfig`. Both flags propagate to all 7 builds via the `makeBuildConfig`
    factory automatically.
  - `package.json` — version bump to `5.0.0-dev.38`. The `files` array already
    has `"dist"` (a directory entry) so npm picks up the new `*.map` siblings
    without an explicit glob.
- Commands run:
  - `make build` — verified all 7 `*.map` files exist.
  - `make test` — full gate.
  - `tail -1 dist/masonry.pkgd.min.js` — verified the
    `//# sourceMappingURL=masonry.pkgd.min.js.map` directive at EOF.
- Manual verification: 7 new `.map` files in `dist/`, sizes ~100-112 KB each
  (sources inlined as JSON-encoded strings, raw text — no parsing cost for
  the browser since maps are not loaded by the browser, only by debuggers
  and error trackers).

## Before

```
== masonry-pretext metrics ==
package           masonry-pretext@5.0.0-dev.37
tracked files     135
total LOC         25846
dependencies      1
devDependencies   4

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                    35813       11215        9729       862
  dist/masonry.pkgd.js                   51882       10041        8994      1421
  dist/masonry.pkgd.min.js               23123        7549        6820        18
  dist/masonry.cjs                       48934        9933        8911      1414
  dist/masonry.mjs                       50140       10421        9319      1438
```

Test status: clean (14 visual + ssr-smoke + module-smoke + 9 compute-layout + no-jquery, all green).

## After

```
== masonry-pretext metrics ==
package           masonry-pretext@5.0.0-dev.38
tracked files     142
total LOC         25910
dependencies      1
devDependencies   4

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                    35813       11215        9729       862
  dist/masonry.pkgd.js                   51923       10069        9032      1422
  dist/masonry.pkgd.min.js               23168        7583        6843        19
  dist/masonry.cjs                       48971        9959        8938      1415
  dist/masonry.mjs                       50177       10445        9341      1439
```

Test status: 14 visual + ssr-smoke + module-smoke + 9 compute-layout + no-jquery — all green.
Snapshot diffs: none.

The 7 new tracked files in the `dist/` count are the `*.map` files for each
output (`pkgd.js`, `pkgd.min.js`, `cjs`, `mjs`, `masonry-grid-element.{js,min.js,mjs}`).

## Delta

| Metric | Before | After | Δ | % |
|---|---:|---:|---:|---:|
| dist/masonry.pkgd.js raw      | 51882 | 51923 | **+41**  | +0.08% |
| dist/masonry.pkgd.js gzip     | 10041 | 10069 | **+28**  | +0.28% |
| dist/masonry.pkgd.min.js raw  | 23123 | 23168 | **+45**  | +0.19% |
| dist/masonry.pkgd.min.js gzip |  7549 |  7583 | **+34**  | +0.45% |
| dist/masonry.pkgd.min.js br   |  6820 |  6843 | **+23**  | +0.34% |
| dist/masonry.cjs raw          | 48934 | 48971 | **+37**  | +0.08% |
| dist/masonry.mjs raw          | 50140 | 50177 | **+37**  | +0.07% |

The +37-45 byte cost on each JS file is exactly the
`//# sourceMappingURL=<filename>.map` line plus a trailing newline — text the
browser ignores and the source map consumer reads.

## Verdict

✅ **Match.** Sourcemap generation enabled across all 7 builds with no source
or test changes; cost lands within the predicted band; all test gates green.

## Notes / lessons

- esbuild's `sourcemap: true` defaults to "external" — the map is written to
  a sibling file, not inlined as a `data:` URL. This is the right choice for
  production: keeps the served bundle small (only the directive comment
  ships to the browser) while letting symbol servers fetch the map on demand.
- `sourcesContent: true` inlines the original source files as JSON strings
  inside each `.map`. This is what makes the maps self-contained — the
  consumer doesn't need separate read access to `masonry.js` / the patched
  `node_modules/outlayer/*.js` files.
- `package.json` "files": `["dist", ...]` already covers everything inside
  `dist/`, so the new `*.map` files ship in `npm pack` automatically — no
  glob needed (a `dist/*.map` glob would be redundant and could lead to
  confusion about whether the directory entry covers them).
- The `*.map` files are not part of the test gate (the gate already covers
  the JS bundles' behavioral correctness). Adding a "map exists" assertion
  would be cheap if a future regression silently disabled sourcemap output,
  but that's hypothetical right now — defer until the need is real.
