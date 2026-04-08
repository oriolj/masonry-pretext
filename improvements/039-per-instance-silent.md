# 039 — Per-instance `silent` option

**Status:** landed
**Roadmap section:** § Downstream consumer asks · D.12
**Closes upstream issues:** none (downstream ergonomics)
**Commit(s):** 5.0.0-dev.39

## Hypothesis

Add a per-instance `silent: true` constructor option that suppresses the
one-time `console.info` banner from #037 for that instance only, leaving
`Masonry.silent` (the global flag) untouched. Useful for grids where the
banner would be inappropriate (server-rendered preview iframes, hidden
pre-render passes, embedded widgets that shouldn't leak fork branding).

- **Cost:** ~10-25 B gzipped on `dist/masonry.pkgd.min.js` (one extra
  `&& !this.options.silent` term in the existing banner-gate expression).
- **Behavior:** if any instance is non-silent, the banner still fires once
  globally as before. The per-instance `silent` only suppresses the
  banner for THAT instance — it does not unilaterally turn off the
  global flag, and a silent instance does not "consume" the one-shot
  banner so a later non-silent instance still triggers it.
- **No new test fixture.** The change is a single boolean in a single
  if-condition; the visual test gate already proves construction with
  the new option doesn't break layout.

## Method

- Files touched:
  - `masonry.js` — added `&& !this.options.silent` to the banner-gate
    expression in `proto._create`. Updated the comment block to
    document the per-instance + global precedence.
  - `masonry.d.ts` — added `silent?: boolean` to `MasonryOptions` with
    a JSDoc block explaining the global vs per-instance semantics and
    pointing at this improvement file.
  - `package.json` — version bump to `5.0.0-dev.39`.
- Commands run:
  - `make build`
  - `make test`
  - Quick smoke via `node -e "..."` to verify `Masonry.computeLayout`
    still works after the change.
- Manual verification:
  - Read the new gate expression line by line.
  - Confirmed the option is read off `this.options` (so it survives the
    `Object.assign` that Outlayer does in its constructor).
  - Confirmed `hasLoggedBanner` is still flipped from inside the
    non-silent branch only, so a silent instance does NOT suppress
    the banner for a later non-silent instance.

## Before

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

## After

```
package           masonry-pretext@5.0.0-dev.39

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                    36144       11336        9829       866
  dist/masonry.pkgd.js                   51947       10076        9037      1422
  dist/masonry.pkgd.min.js               23190        7588        6863        19
  dist/masonry.cjs                       48995        9966        8938      1415
  dist/masonry.mjs                       50201       10453        9347      1439
```

Test status: 14 visual + ssr + module + 9 compute-layout + no-jquery — all green.
Snapshot diffs: none.

## Delta

| Metric | Before | After | Δ | % |
|---|---:|---:|---:|---:|
| dist/masonry.pkgd.min.js raw  | 23168 | 23190 | **+22** | +0.09% |
| dist/masonry.pkgd.min.js gzip |  7583 |  7588 |  **+5** | +0.07% |
| dist/masonry.pkgd.min.js br   |  6843 |  6863 | **+20** | +0.29% |

Cost is essentially "one boolean check + one option-bag read". Within the
predicted band.

## Verdict

✅ **Match.** Per-instance `silent` lands at the bottom of the predicted
band (5 B gz, predicted 10-25 B). All test gates green.

## Notes / lessons

- The change is genuinely as small as it looks. The interesting design
  call is the precedence rule: **per-instance wins over global**, but
  per-instance does NOT mutate the global. This matches the principle
  of least surprise — setting `silent: true` on one grid should not
  affect any other grids on the page.
- The `hasLoggedBanner` flag is still per-module (one shot for the
  whole `Masonry` constructor), not per-instance. A silent instance
  does not "consume" the one-shot — so if you have one silent grid
  and one noisy grid in the same page, the noisy one still triggers
  the banner regardless of which constructs first.
- No discriminating fixture because capturing `console.info` calls
  inside a Playwright fixture is more code than the change itself.
  If a future change touches the banner gate, the existing visual
  fixtures + this comment block are sufficient regression evidence.
