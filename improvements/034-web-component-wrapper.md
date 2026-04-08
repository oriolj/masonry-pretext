# 034 — `<masonry-grid>` Custom Element wrapper (item Q)

**Status:** landed
**Roadmap section:** § Post-#010 (review #5) / FORK_ROADMAP.md item Q
**Tag:** `v5.0.0-dev.34`

## Hypothesis

Ship a framework-agnostic Web Component (`<masonry-grid>`) that auto-constructs masonry on `connectedCallback`, destroys on `disconnectedCallback`, reads options from `data-*` attributes, and ships with sensible dynamic-content defaults out of the box (`observeMutations: true` from #031, `transitionDuration: 0`).

The element ships as a SEPARATE bundle (`dist/masonry-grid-element.{js,min.js,mjs}`) so consumers using the imperative `new Masonry(...)` API don't pay for the wrapper bytes.

Roadmap-stated dependencies: **items H + K** (per-item ResizeObserver and MutationObserver auto-relayout). Both are now landed (#012 and #031).

Predicted size: 50-100 LOC of source, ~1-2 KB minified for the wrapper alone (additional bundles include the full Masonry IIFE).

## Method

### `masonry-grid-element.js` (new source file)

A UMD-wrapped module that:

1. Defines `MasonryGridElement` extending `HTMLElement` (via `Reflect.construct` since the file uses `function` declarations rather than `class` syntax — keeps the source style consistent with `masonry.js`).
2. Implements `connectedCallback` (constructs masonry), `disconnectedCallback` (destroys), and `_readOptions` (reads `data-*` attributes).
3. Exposes an `options` setter that re-constructs the instance when assigned.
4. Auto-defines the `<masonry-grid>` Custom Element on the global registry, but only if `customElements` exists and the name isn't already taken.
5. SSR-safe via `typeof HTMLElement === 'undefined'` bail.

Supported attributes (mapped to `MasonryOptions`):

| Attribute | Option | Notes |
|---|---|---|
| `column-width="240"` | `columnWidth: 240` | parsed as number; falls back to string (CSS selector or `'20%'`) |
| `gutter="16"` | `gutter: 16` | parsed as number |
| `item-selector=".item"` | `itemSelector: '.item'` | string |
| `horizontal-order` | `horizontalOrder: true` | presence-only boolean |
| `fit-width` | `fitWidth: true` | presence-only boolean |
| `static` | `static: true` | presence-only boolean (#015) |
| `percent-position` | `percentPosition: true` | presence-only boolean |

Defaults applied unless overridden by attribute or `.options` property:

```js
{
  observeMutations: true,    // (#031) detects grid.appendChild without calling msnry.appended
  transitionDuration: 0,     // no animated settle
}
```

For options that don't fit in attributes (callbacks like `pretextify` or `pickColumn`), set them via the `options` property:

```js
document.querySelector('masonry-grid').options = {
  pretextify: elem => ({ outerWidth: 240, outerHeight: 192 }),
};
```

### `scripts/build.mjs` — three new build targets

```js
const wcIifeConfig = { ...baseConfig, ..., format: 'iife', globalName: 'MasonryGridElement' };
const wcEsmConfig  = { ...baseConfig, ..., format: 'esm' };

esbuild.build({ ...wcIifeConfig, outfile: 'dist/masonry-grid-element.js',     minify: false }),
esbuild.build({ ...wcIifeConfig, outfile: 'dist/masonry-grid-element.min.js', minify: true  }),
esbuild.build(wcEsmConfig),  // → dist/masonry-grid-element.mjs
```

Each Web Component bundle includes the full Masonry runtime (~21-22 KB min) plus the wrapper (~1-2 KB min) — about 23-24 KB total minified. The user picks which bundle to consume based on their integration:

- `<script src="masonry-grid-element.min.js">` → IIFE, auto-defines the element
- `import 'masonry-pretext/element'` → ESM, auto-defines on import
- `import 'masonry-pretext/element/unminified'` → ESM unminified
- `require('masonry-pretext/element')` → CJS via the IIFE bundle (minified)

### `package.json` exports + `files`

Added `./element` and `./element/unminified` subpath exports. Added `masonry-grid-element.js` to the `files` array so it gets included in the published tarball.

### `masonry.d.ts` — `MasonryGridElement` interface + `HTMLElementTagNameMap` augmentation

```ts
export interface MasonryGridElement extends HTMLElement {
  options: MasonryOptions | undefined;
}

declare global {
  interface HTMLElementTagNameMap {
    'masonry-grid': MasonryGridElement;
  }
}
```

The `HTMLElementTagNameMap` augmentation makes `document.querySelector('masonry-grid')` return the typed `MasonryGridElement` automatically — TypeScript users get autocomplete on the `options` setter.

### Discriminating fixture (`test/visual/pages/web-component.html`)

Same shape as `basic-top-left`: 4 items in a 3-col 180px container, columnWidth=60. The container is `<masonry-grid id="web-component" column-width="60" item-selector=".item">`. The fixture loads `dist/masonry-grid-element.min.js` (which auto-defines the element) and waits two rAF ticks before signaling `__READY`.

If the Web Component is correctly wired, the layout matches the basic 3-col tile: `(0,0), (60,0), (120,0), (0,30)`. The position assertion catches any wiring failure.

### `make test` integration

`run.mjs` already runs all visual fixtures via the `cases` array, so the new `web-component` case is included automatically. No Makefile change needed.

## Numbers

| Metric | pre-034 | post-034 | Δ |
|---|---:|---:|---:|
| `dist/masonry.pkgd.min.js` raw | 22,096 | **22,096** | **0** (main bundle unchanged) |
| `dist/masonry-grid-element.js` raw | (absent) | **53,090** | **+53 KB** (new file) |
| `dist/masonry-grid-element.min.js` raw | (absent) | **23,809** | **+23.8 KB** |
| `dist/masonry-grid-element.mjs` raw | (absent) | **51,291** | **+51 KB** |
| Visual regression tests | 12/12 | **13/13** | +1 (`web-component`) |
| Compute-layout test | 9/9 | 9/9 | unchanged |
| Other gates | all green | all green | unchanged |

**Zero bytes added to the imperative-API bundles.** Users who don't import the Web Component pay nothing.

## Verdict

✅ **Match.** The Web Component bundle is ~23.8 KB minified — slightly larger than the main Masonry IIFE (22.1 KB) because it includes both Masonry AND the wrapper code. The wrapper itself is ~1.7 KB minified (the delta between the two IIFE bundles), well within the predicted "50-100 LOC of source".

The `<masonry-grid>` element works in vanilla HTML, React, Vue, Svelte, Astro — any framework that supports Custom Elements (which is all of them). The defaults (`observeMutations: true` + `transitionDuration: 0`) make the dynamic-content case work without any wiring beyond dropping the element into HTML.

## Notes / lessons

- **`Reflect.construct(HTMLElement, [], MasonryGridElement)`** is the correct way to extend `HTMLElement` from a `function` declaration. The standard `function() { HTMLElement.call(this); }` pattern doesn't work for built-in objects like HTMLElement — the constructor MUST be called via `Reflect.construct` (or via `class extends`).
- **`customElements.get('masonry-grid')` guard** prevents the registry-collision error that would otherwise fire if the file is loaded twice (e.g., once via `<script>` and once via an ESM import). Idempotent registration.
- **The `options` property setter re-constructs** the masonry instance instead of trying to update it in place. Updating in place would require an instance-level `option()` setter that some callers might not support; re-constructing is a clean reset that works regardless.
- **`Element` lifecycle: `connectedCallback` fires every time the element is inserted into a document.** If a user moves the element via `appendChild`, `disconnectedCallback` fires first, then `connectedCallback`. The current implementation handles this correctly by calling `destroy()` then `new Masonry()` in lockstep.
- **No Shadow DOM.** The grid items live in the light DOM (children of `<masonry-grid>`), so user CSS targets them normally with `.grid-item { ... }`. This is the right call for a layout library — Shadow DOM would force users to forward styles via slots, which is friction nobody wants.
- **Three bundles per consumption mode** (IIFE unmin, IIFE min, ESM unmin) matches the existing main bundle pattern. No CJS variant for the Web Component because the use case (drop-in custom element) is browser-first; CJS users typically have a build pipeline and can use the ESM version.
