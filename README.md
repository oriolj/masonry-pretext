# Masonry (masonry-pretext fork)

_Cascading grid layout library_

> This is a **fork of [desandro/masonry](https://github.com/desandro/masonry)** whose upstream has been effectively dormant since 2018. The original library still works and is the canonical reference — for stable, plain Masonry use that.

Masonry works by placing elements in optimal position based on available vertical space, sort of like a mason fitting stones in a wall. You’ve probably seen it in use all over the Internet.

See [masonry.desandro.com](https://masonry.desandro.com) for complete docs and demos of the original library.

## About this fork

The goals of this fork are narrow and concrete:

1. **Fix the long-standing pain points** that dominate the upstream issue tracker — image overlap when content lazy-loads, custom-font flicker on first paint, SSR (`window` undefined), modern bundler (Vite/Rollup) compatibility, percentage width + gutter math.
2. **Modernize the build and runtime** — drop IE/legacy code paths, replace bundled polyfills with native browser APIs (`ResizeObserver`, `MutationObserver`, `Element.matches`, Web Animations API, `EventTarget`, `AbortController`, `document.fonts.ready`), ship a real ESM build, and shrink the bundle from ~7.4 KB gzipped toward ~2 KB gzipped.
3. **Integrate [chenglou/pretext](https://github.com/chenglou/pretext)** so text-driven bricks can be measured arithmetically without forcing DOM reflow.

Every change in this fork has to produce a **measurable** improvement in speed, bundle size, or UX. Cosmetic refactors and abstractions without a benchmark or before/after number are explicitly out of scope. The full design notes, dependency audit, and prioritized work list live in [`FORK_ROADMAP.md`](./FORK_ROADMAP.md).

### Key improvements vs upstream

User-visible wins that have already landed in the fork. Each entry links to the per-change record in `improvements/` and the git tag where the change first shipped.

> Until v5.0.0 ships, every line below is from a `5.0.0-dev.N` pre-release tag. The runtime library (`dist/masonry.pkgd.min.js`) is **byte-identical to upstream v4.2.2** at this stage — the bundle-shrinking work begins in improvement `004`. The wins so far are about toolchain health, not runtime size.

| Tag | What you get | Number |
|---|---|---|
| `v5.0.0-dev.1` | **97% smaller `npm install`.** Dropped the broken Gulp 3 + JSHint + RequireJS + QUnit + Bower toolchain. `npm install` goes from **349 → 10 packages** (the original devDeps had multiple unmaintained packages with open security advisories that will never be patched). See [`improvements/001-foundation-cleanup.md`](./improvements/001-foundation-cleanup.md). |
| `v5.0.0-dev.2` | **The build actually runs again.** The upstream Gulp 3 build has been broken on Node ≥ 17 since ~2020. Replaced with a single ~120-line esbuild script that produces the same `dist/masonry.pkgd.js` + `dist/masonry.pkgd.min.js` artifacts in **17 ms** (vs gulp's previously-multi-second build, ~500× faster). Source unchanged, behavior verified by 4/4 visual regression tests. **Trade-off:** the minified bundle is +0.83 % raw / +7.1 % gzipped vs the upstream frozen file because of esbuild's CommonJS runtime helper — that cost is recoverable as later improvements delete dead code. Full numbers + the surprise that jquery-bridget secretly bundles all of jQuery in [`improvements/002-esbuild-build.md`](./improvements/002-esbuild-build.md). |
| `v5.0.0-dev.3` | **First slice of dead-code deletion.** Removed the `desandro-matches-selector` polyfill (a 50-LOC vendor-prefix walker for `Element.matchesSelector`) — `Element.matches` has been unprefixed in every browser since 2014 and is universally available at the fork's target baseline. `dist/masonry.pkgd.min.js` drops by **−401 B raw / −102 B gzipped / −96 B brotli**. The minified raw is now **smaller than the upstream-frozen v4.2.2 file for the first time** (−201 B raw vs upstream). Behavior unchanged, 4/4 visual tests still pass. See [`improvements/003-delete-matches-selector-polyfill.md`](./improvements/003-delete-matches-selector-polyfill.md). |
| `v5.0.0-dev.4` | **Second slice of dead-code deletion.** Removed the `transition` / `transform` vendor-prefix detection in `outlayer/item.js` (`WebkitTransition`, `WebkitTransform`, `webkitTransitionEnd`, `dashedVendorProperties`, `toDashedAll` helper, `vendorProperties` lookup table, scattered consumer sites — ~50 LOC of dead browser-compat). `dist/masonry.pkgd.min.js` drops by **−606 B raw / −172 B gzipped / −189 B brotli**. Vs upstream v4.2.2: **−807 B raw**, gzip is now within +249 B (was +524 B after the esbuild build replacement — 52 % of that regression is now recovered). Behavior unchanged, 4/4 visual tests still pass. **What this is *not*:** the original roadmap claimed this would close upstream `#1194` / `#1121` (SSR `window` undefined) as a side effect of removing the module-load `document.documentElement.style` access. A new `test/visual/ssr-smoke.mjs` test in this improvement disproves that — the actual crash is at the UMD-wrapper IIFE call site (one frame earlier), not inside the deleted block. SSR fix has been split out as a separate planned improvement. Full record + the negative-result analysis in [`improvements/004-delete-vendor-prefix-detection.md`](./improvements/004-delete-vendor-prefix-detection.md). |

### Maintenance & contributions

- **The fork is primarily developed by Claude** (Anthropic's AI coding assistant) under the direction of the maintainer.
- **The maintainer is a working developer, not a Masonry expert.** They don't know the original library's internals deeply, don't have time to learn its history in detail, and rely on Claude to do the heavy reading and reasoning.
- **Contributions are very welcome** — especially from people who know the original codebase, who have hit one of the upstream issues this fork targets, or who can write tests / benchmarks. Open an issue or PR; expect a friendly but slow review cadence. The roadmap document is the best place to see what's planned and where help is most useful.
- If you need a guaranteed long-term-maintained, human-reviewed Masonry, the original [desandro/masonry](https://github.com/desandro/masonry) (or a Metafizzy commercial library) is still the right choice.

## Install

### Download

+ [masonry.pkgd.js](https://unpkg.com/masonry-layout@4/dist/masonry.pkgd.js) un-minified, or
+ [masonry.pkgd.min.js](https://unpkg.com/masonry-layout@4/dist/masonry.pkgd.min.js) minified

### CDN

Link directly to Masonry files on [unpkg](https://unpkg.com/).

``` html
<script src="https://unpkg.com/masonry-layout@4/dist/masonry.pkgd.js"></script>
<!-- or -->
<script src="https://unpkg.com/masonry-layout@4/dist/masonry.pkgd.min.js"></script>
```

### Package managers

[npm](https://www.npmjs.com/package/masonry-layout): `npm install masonry-layout --save`

Bower: `bower install masonry-layout --save`

## Support Masonry development

Masonry has been actively maintained and improved upon for 8 years, with 900 GitHub issues closed. Please consider supporting its development by [purchasing a license for one of Metafizzy's commercial libraries](https://metafizzy.co).

## Initialize

With jQuery

``` js
$('.grid').masonry({
  // options...
  itemSelector: '.grid-item',
  columnWidth: 200
});
```

With vanilla JavaScript

``` js
// vanilla JS
// init with element
var grid = document.querySelector('.grid');
var msnry = new Masonry( grid, {
  // options...
  itemSelector: '.grid-item',
  columnWidth: 200
});

// init with selector
var msnry = new Masonry( '.grid', {
  // options...
});
```

With HTML

Add a `data-masonry` attribute to your element. Options can be set in JSON in the value.

``` html
<div class="grid" data-masonry='{ "itemSelector": ".grid-item", "columnWidth": 200 }'>
  <div class="grid-item"></div>
  <div class="grid-item"></div>
  ...
</div>
```

## License

Masonry is released under the [MIT license](http://desandro.mit-license.org). Have at it.

* * *

Made by David DeSandro
