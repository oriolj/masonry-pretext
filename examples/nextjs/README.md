# masonry-pretext + Next.js — zero-flash SSR example

End-to-end demo of `masonry-pretext`'s defining capability: **server-side cascading-grid layout precomputation**, with zero hydration flash on the client. React Server Component edition of [`examples/astro/`](../astro/).

This is the Next.js parity of [`PRETEXT_SSR_ROADMAP.md`](../../PRETEXT_SSR_ROADMAP.md) Phase 4. It uses every piece of the SSR feature line:

| Improvement | What it provides |
|---|---|
| [#017 `Masonry.computeLayout`](../../improvements/017-compute-layout-static-helper.md) | Pure-Node layout helper called from the React Server Component |
| [#018 `initLayout: false` adoption](../../improvements/018-init-layout-false-adoption.md) | Client adopts SSR positions without overwriting them |
| [#015 `static: true` preset](../../improvements/015-static-ssr-preset.md) | Skips observers + animations on the client |
| [#013 ESM bundle](../../improvements/013-esm-cjs-builds.md) | Lets `import Masonry from 'masonry-pretext'` work in both the Server Component and the `'use client'` component |
| [#005 SSR-safe imports](../../improvements/005-ssr-import-fix.md) | The library doesn't crash when imported in a Node context |

## What this demonstrates

The page renders 24 grid items. The cascading layout is computed in **pure Node** during Next.js server rendering (RSC), the positions are passed as props to a `'use client'` component, and the client constructs masonry with `initLayout: false, static: true` to **adopt** the existing positions without recomputing them.

The user sees the final cascading layout on **first paint**. There is no flow-to-absolute reflow, no animated settle, no observable hydration flash.

## Files

- [`app/page.tsx`](./app/page.tsx) — React Server Component. Imports `Masonry`, builds the item list, calls `Masonry.computeLayout` in pure Node, passes positions as props to `<MasonryGrid>`.
- [`app/MasonryGrid.tsx`](./app/MasonryGrid.tsx) — `'use client'` component. Renders items with inline absolute positions, constructs masonry with `initLayout: false + static: true`.

That's the entire demo. ~120 lines of TSX across the two files.

## How to run

```sh
# In a fresh Next.js project (App Router):
npx create-next-app@latest --app
cd <your-project>
npm install github:oriolj/masonry-pretext
cd node_modules/masonry-pretext && npm install && npm run build && cd ../..

# Copy the demo files:
cp -r <path-to-this-repo>/examples/nextjs/app/* app/

# Run the dev server:
npm run dev
```

Open `http://localhost:3000`. Open Chrome DevTools → Performance → record a page reload. The Layout Shift section should show **CLS = 0.00** for the grid region.

## How it works — the four steps

### Step 1 — Server-side measurement (RSC, Node)

In a real app, this is where you call `pretext.prepare(text, font)` followed by `pretext.layout(prepared, maxWidth, lineHeight)` to get DOM-free heights. The demo uses hardcoded heights for simplicity:

```tsx
function getItems(): Item[] {
  return Array.from({ length: 24 }, (_, i) => ({
    id: String(i),
    title: `Item ${i + 1}`,
    outerHeight: 80 + ((i * 37) % 220),
  }));
}
```

Swapping in real pretext is one diff:

```tsx
import { prepare, layout as ptLayout } from '@chenglou/pretext';

const FONT = '14px/1.5 system-ui, sans-serif';
const items = await loadFromCMS();
const sizes = items.map((item) => {
  const prepared = prepare(item.title, FONT);
  const { height } = ptLayout(prepared, COL_WIDTH, 21);
  return { outerWidth: COL_WIDTH, outerHeight: height + 24 };
});
```

### Step 2 — `Masonry.computeLayout` in pure Node (RSC)

```tsx
import Masonry from 'masonry-pretext';

const { positions, containerHeight } = Masonry.computeLayout({
  items: items.map((item) => ({
    outerWidth: COL_WIDTH,
    outerHeight: item.outerHeight,
  })),
  containerWidth: 752,
  columnWidth: 240,
  gutter: 16,
});
```

`positions` is an array of `{ x, y }` — one per input item, in input order. **Verified byte-for-byte against the browser-side layout** by `test/visual/compute-layout.mjs` (#017).

### Step 3 — Pass positions as props to the client component

```tsx
return (
  <main>
    <MasonryGrid
      items={items}
      positions={positions}
      containerHeight={containerHeight}
      columnWidth={COL_WIDTH}
      gutter={GUTTER}
    />
  </main>
);
```

React serializes the props array into the SSR payload; the client component receives the same `positions` that the server computed.

### Step 4 — Client-side adoption (`'use client'`)

```tsx
'use client';
import { useEffect, useRef } from 'react';
import Masonry from 'masonry-pretext';

export default function MasonryGrid({ items, positions, containerHeight, ... }) {
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const msnry = new Masonry(gridRef.current, {
      itemSelector: '.grid-item',
      columnWidth,
      gutter,
      initLayout: false,    // adopt existing positions
      static: true,         // no observers, no animations
    });
    return () => msnry.destroy();
  }, [items, columnWidth, gutter]);

  return (
    <div ref={gridRef} className="grid" style={{ position: 'relative', height: containerHeight }}>
      {items.map((item, i) => (
        <div
          key={item.id}
          className="grid-item"
          style={{
            position: 'absolute',
            left: positions[i].x,
            top: positions[i].y,
            width: columnWidth,
            height: item.outerHeight,
            // ... visual styles
          }}
        >
          {item.title}
        </div>
      ))}
    </div>
  );
}
```

`initLayout: false` skips the constructor's `this.layout()` call entirely. `static: true` skips the per-item `ResizeObserver` wire-up and the `document.fonts.ready` deferred layout, so nothing fires later that could overwrite the SSR positions.

## The two CSS details that matter

1. **The `.grid` container reserves `height: containerHeight`** from the server-computed total. Without this, the grid container collapses to zero height (because all items are absolute) and *then* expands to the computed height when the script runs — a visible CLS.
2. **`.grid-item` has `position: absolute` AT RENDER TIME** (in the inline `style` prop, not just after script construction). This matches what `Item._create` would set, so masonry's construction is a no-op write.

## Before/after CLS comparison

| Pattern | CLS | First-paint final layout | Hydration flash |
|---|---|---|---|
| **Old way** — server emits items in flow, client runs `new Masonry(grid, {})` | ~0.10–0.15 | ❌ No (waits for JS) | ❌ Visible reflow |
| **Old + `transitionDuration: 0`** | ~0.10–0.15 | ❌ Still waits for JS | ⚠️ Snaps instead of animates |
| **Old + `static: true`** ([#015](../../improvements/015-static-ssr-preset.md)) | ~0.10–0.15 | ❌ Still waits for JS | ⚠️ Snaps instead of animates |
| **THIS DEMO** — RSC `computeLayout` + client `initLayout: false, static: true` | **0.00** | ✅ **Yes** (positions in HTML) | ✅ **None** |

The first three rows are the existing landscape for cascading-grid SSR — including `masonry-pretext` through `v5.0.0-dev.18` and every other masonry-style library on the market. The bottom row is what this demo proves is possible **only** with the masonry-pretext SSR pipeline. Reproduce the headline measurement with `make bench` from the repo root.

## When NOT to use this pattern

The full SSR pipeline assumes:

1. **You can predict the container width on the server.** Either fixed (`width: 752px`) or breakpoint-driven via Next.js cookies/headers. CSS-driven fluid percent widths can't be precomputed because the server doesn't know the viewport.
2. **You can predict item heights on the server.** Text-driven items work well with `pretext.layout(...)`. Image-driven items need `<img width height>` attributes (so the browser knows the aspect ratio before the image loads) AND the server needs to know those dimensions ahead of time.
3. **Font metrics match server↔client.** Use `next/font` (which inlines the font subset and stabilizes the CLS) or `<link rel="preload">` on a self-hosted webfont so it's loaded before paint.
4. **The grid is static after first paint.** If your grid mutates (lazy images, infinite scroll, dynamic content), drop `static: true` and `initLayout: false` and accept a single relayout on the first user interaction.

If those four conditions are met, this pipeline gives you **CLS = 0.00 with no library swap and no special framework setup**. If they aren't, you can still use `static: true` alone (without `initLayout: false`) for a partial win.

## Comparison to the Astro example

The [Astro example](../astro/) does the exact same thing with Astro frontmatter instead of an RSC. Same `Masonry.computeLayout` call, same client-side `initLayout: false + static: true` adoption, same headline result. Pick whichever framework you're already using.

## Notes

- **Do not** put `new Masonry(...)` at module scope in a server file. It will try to touch `document` during the render pass.
- **`'use client'` boundaries serialize props as JSON.** The `positions` array is plain `{x, y}` numbers, which serializes cleanly. Avoid passing functions, class instances, or DOM references across the boundary.
- **`useEffect` dependency** is `[items, columnWidth, gutter]` so that changing the item list or grid dimensions tears down the old instance and builds a new one. If you want masonry to react incrementally to item changes, call `msnry.appended()` / `msnry.prepended()` inside an effect keyed on the specific add/remove instead of re-constructing.
- **Server-only pretext import**: if you `import { prepare, layout } from '@chenglou/pretext'` from `app/page.tsx` (an RSC), the import is server-only and never bundled into the client. The client component just receives the resulting numbers — pretext itself never ships to the browser. Same pattern as the Astro demo.
