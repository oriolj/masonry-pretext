# masonry-pretext + Next.js (App Router)

Minimal example showing how to use `masonry-pretext` in a Next.js App Router project. The grid markup is **server-rendered**; Masonry is constructed in a **client component** after hydration.

## Files

- [`app/page.tsx`](./app/page.tsx) — server component. Fetches/maps items and renders the grid container. No client JS on this file.
- [`app/MasonryGrid.tsx`](./app/MasonryGrid.tsx) — `'use client'` component. Mounts Masonry in a `useEffect` and tears it down on unmount.

## How it works

1. The server component (`app/page.tsx`) runs in Node. It imports the `MasonryGrid` client component and passes the items as props.
2. `MasonryGrid.tsx` has `'use client'` at the top. Next.js SSRs its HTML (so the user sees items in flow layout immediately, before any JS), and then hydrates it in the browser.
3. The `useEffect` runs only in the browser. It constructs `new Masonry(...)` against the DOM element referenced by `useRef`, then returns a cleanup function that calls `msnry.destroy()`.

Because `masonry-pretext` is SSR-safe to import (see [improvement #005](../../improvements/005-ssr-import-fix.md)), you can also put `import Masonry from 'masonry-pretext'` at the top of a pure server file — for example, if you want to call a (future) static helper to pre-compute positions. It will not crash the server render.

## Copying this into a project

Drop the two files under your own `app/` directory. Install the library from the fork repo (not yet on npm — see the main README):

```sh
npm install github:oriolj/masonry-pretext
```

Then run `npm run build` inside `node_modules/masonry-pretext/` once (the current pre-release does not ship pre-built `dist/` over git-install).

## Recommended option set for SSR content

```tsx
new Masonry(ref.current, {
  itemSelector: '.grid-item',
  columnWidth: 240,
  gutter: 16,
  transitionDuration: 0, // no animated settle on relayout — biggest SSR win
});
```

See the [main README § "Optimizations for SSR mode"](../../README.md#optimizations-for-ssr-mode) for the reasoning.

## Notes

- **Do not** put `new Masonry(...)` at module scope in a server component. It will try to touch `document` during the render pass.
- **Do not** import Masonry dynamically with `next/dynamic({ ssr: false })` just to avoid import errors — that was a workaround for upstream masonry. This fork imports cleanly without it. Use a normal `'use client'` boundary instead.
- The `useEffect` dependency is `[items]` so that changing the item list tears down the old instance and builds a new one. If you want Masonry to react incrementally to item changes, call `msnry.reloadItems()` + `msnry.layout()` inside an effect keyed on the specific add/remove, instead of re-constructing.
