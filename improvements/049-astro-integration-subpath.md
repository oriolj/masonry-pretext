# 049 — `masonry-pretext/astro` integration subpath

**Status:** landed
**Roadmap section:** § Downstream consumer asks · D.8
**Closes upstream issues:** none (downstream Astro View Transitions integration)
**Commit(s):** 5.0.0-dev.49

## Hypothesis

Add a `masonry-pretext/astro` subpath export that loads the
`<masonry-grid>` Custom Element (#034) AND wires up an
`astro:page-load` listener so the element correctly reinitializes
after a View Transitions navigation.

The motivation is the gap in #034: a persisted `<masonry-grid>` element
(via `transition:persist`) survives a View Transitions navigation but
its `connectedCallback` does NOT fire — Astro swaps the contents
in-place, so the masonry instance ends up wired to the new page's items
but with the old items array. The result is a stale layout until the
user manually relayouts.

The fix is a side-effect bundle that listens to `astro:page-load` /
`astro:after-swap` and walks every `<masonry-grid>` in the document.
For each, it checks whether the wired masonry instance is stale (item
count or first/last identity differs from the current children). If
stale, it destroys the old instance and reconstructs.

**Predictions:**

- **Cost:** 0 bytes on imperative-API bundles (`dist/masonry.pkgd.min.js`,
  `dist/masonry.cjs`, `dist/masonry.mjs`). The integration ships as
  TWO new separate bundles (`dist/masonry-astro.js`, `dist/masonry-astro.mjs`)
  that consumers opt into via the new `./astro` package export.
- **Test gate:** new `module-smoke.mjs` case verifying the
  `dist/masonry-astro.mjs` bundle imports cleanly in Node SSR (where
  the Custom Element factory bails because `customElements` is
  undefined, returning null — that's the SSR-safety contract).
- **Documentation update:** the existing `examples/astro/README.md`
  gets a new section showing the `import 'masonry-pretext/astro'`
  pattern alongside the existing SSR pipeline.

## Method

- Files touched:
  - `masonry-grid-element-astro.js` — new file. Side-effect IIFE
    that loads the `<masonry-grid>` Custom Element AND adds two
    `window.addEventListener` calls (`astro:page-load` and
    `astro:after-swap`) bound to a `reinitMasonryGrids` function
    that walks every `<masonry-grid>` and reconstructs the stale
    ones.
  - `scripts/build.mjs` — added two new build entries:
    `dist/masonry-astro.js` (IIFE, minified) and
    `dist/masonry-astro.mjs` (ESM, unminified for bundlers). Both
    use a re-export trick (`export default MasonryGridElement`) so
    esbuild doesn't tree-shake the side-effect imports under the
    package's `sideEffects: false` flag.
  - `package.json` — added `./astro` to the `exports` map pointing
    at the new bundles. Added `masonry-grid-element-astro.js` to
    the `files` array so the source ships in the npm tarball.
    Version bump to `5.0.0-dev.49`.
  - `test/visual/module-smoke.mjs` — added a new case that imports
    `dist/masonry-astro.mjs` and asserts it loads without throwing
    in the Node SSR context.
  - `examples/astro/README.md` — new section "Astro integration
    subpath (#049 / D.8)" documenting the `import 'masonry-pretext/astro'`
    pattern alongside the existing SSR pipeline docs.
- Commands run:
  - `make build`
  - `node test/visual/module-smoke.mjs`
  - `make test` (full gate)

## Before

```
package           masonry-pretext@5.0.0-dev.48

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                    56149       17247       14933      1260
  dist/masonry.pkgd.js                   59257       11420       10235      1600
  dist/masonry.pkgd.min.js               26998        8679        7841        19
  dist/masonry.cjs                       55949       11310       10141      1593
  dist/masonry.mjs                       57157       11798       10560      1617
```

(No `dist/masonry-astro.{js,mjs}` files yet.)

## After

```
package           masonry-pretext@5.0.0-dev.49

  file                                     raw        gzip      brotli     lines
  ----                                     ---        ----      ------     -----
  masonry.js (source)                    56149       17247       14933      1260
  dist/masonry.pkgd.js                   59257       11419       10235      1600
  dist/masonry.pkgd.min.js               26998        8678        7841        19
  dist/masonry.cjs                       55949       11310       10141      1593
  dist/masonry.mjs                       57157       11797       10559      1617
```

Plus two new files (not in the measure script's tracked list):

| File | raw | notes |
|---|---:|---|
| dist/masonry-astro.js  | 29844 B | IIFE, minified, side-effect bundle |
| dist/masonry-astro.mjs | 60584 B | ESM, unminified for bundlers |

Test status: 22 visual + ssr + module + 11 compute-layout + 4 compute-layouts + no-jquery — all green. New module-smoke case for the astro bundle: pass.

## Delta

| Metric | Before | After | Δ | % |
|---|---:|---:|---:|---:|
| dist/masonry.pkgd.min.js raw  | 26998 | 26998 | **0** | 0% |
| dist/masonry.pkgd.min.js gzip |  8679 |  8678 | **−1** | −0.01% |
| dist/masonry.pkgd.min.js br   |  7841 |  7841 | **0** | 0% |

**Zero bytes added to imperative-API consumers.** The 1-byte gz drop
is rebuild noise. The new astro bundles ship as separate files that
only consumers opting into `import 'masonry-pretext/astro'` pay for.

## Verdict

✅ **Match.** Zero-byte cost on the main bundles (the design goal).
The new bundles ship via the `./astro` package export and the new
`module-smoke.mjs` case verifies they load cleanly in Node SSR.

## Notes / lessons

- **`sideEffects: false` plus side-effect imports = tree-shaking
  trap.** My first attempt used bare `import './masonry-grid-element.js'`
  + `import './masonry-grid-element-astro.js'` in the entry. Esbuild
  honored the package-level `sideEffects: false` flag and DCE'd
  both imports, producing an empty 199-byte bundle. The fix was
  to give the entry a real export (`export default MasonryGridElement`),
  which forced esbuild to keep the imports because the export
  tree-shaking visible code path uses them.
- **The astro listener uses a cheap heuristic for staleness.** It
  compares `items.length` and the first/last item identity, not
  every item. This is fast (O(1)) and catches the realistic Astro
  swap pattern where the new page replaces the entire children list.
  More expensive checks (e.g., a full identity walk) would handle
  edge cases at the cost of bytes; not worth it for the tier 2
  ergonomics use case.
- **`astro:after-swap` AND `astro:page-load`** — both are listened
  to because the timing differs across Astro versions. After-swap
  fires immediately after the document swap; page-load fires after
  the new page's scripts run. Listening to both is cheap and ensures
  the reinit happens at the earliest valid moment.
- **The integration is purely additive.** Consumers who use the SSR
  pipeline (`Masonry.computeLayout` + `initLayout: false + static: true`)
  for CLS = 0.00 don't need this. The integration only matters for
  dynamic-content `<masonry-grid>` elements inside Astro pages with
  View Transitions enabled.
- **Tier 3 closeout (and consumer-asks closeout).** D.8 is the
  last of the 12 downstream consumer asks (D.1–D.12). All 12 are
  now landed: 4 Tier 1, 4 Tier 2, 4 Tier 3.
