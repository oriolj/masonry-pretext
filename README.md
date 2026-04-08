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
