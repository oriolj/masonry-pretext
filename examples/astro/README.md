# masonry-pretext + Astro

Minimal example showing how to use `masonry-pretext` in an Astro project. The grid is **server-rendered as static HTML by Astro**, and a tiny **client-side script** constructs the Masonry instance after hydration.

## Files

- [`src/pages/index.astro`](./src/pages/index.astro) — server page. Renders the grid markup at build/request time and includes a `<script>` block that initializes Masonry on the client.

That is the entire demo. Astro's islands architecture means you do not need a framework (React, Svelte, Vue) to initialize a tiny DOM library like Masonry — a plain `<script>` block is enough, and Astro will hoist + bundle it.

## How it works

1. The `.astro` file runs in Node during build (SSG) or on each request (SSR). Its HTML body — including the grid markup — is server-rendered. Users see items in flow layout before any JS runs.
2. The `<script>` tag at the bottom is **client-only**. Astro bundles and ships it to the browser.
3. When the browser parses the script, it imports `masonry-pretext` (as of improvement #005 the import is safe in any bundler pass, including Astro's Vite-backed SSR build, which also evaluates the module graph in Node) and constructs the Masonry instance against the grid element.

## Copying this into a project

Drop `src/pages/index.astro` into your project's `src/pages/` directory. Install the library from the fork repo (not yet on npm — see the main README):

```sh
npm install github:oriolj/masonry-pretext
```

Then run `npm run build` inside `node_modules/masonry-pretext/` once (the current pre-release does not ship pre-built `dist/` over git-install).

## When to reach for a framework island instead

The `<script>` pattern is the simplest path and works for most cases. Use an Astro framework island (`client:load` with React/Svelte/Vue) only if you already have a framework component system in your app and want to co-locate Masonry with other state. The React equivalent is identical to the Next.js example in [`../nextjs/`](../nextjs).

## Recommended option set for SSR content

```js
new Masonry(grid, {
  itemSelector: '.grid-item',
  columnWidth: 240,
  gutter: 16,
  transitionDuration: 0, // no animated settle on hydration — biggest SSR win
});
```

See the [main README § "Optimizations for SSR mode"](../../README.md#optimizations-for-ssr-mode) for the reasoning.
