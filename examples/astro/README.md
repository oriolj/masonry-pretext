# masonry-pretext + Astro — zero-flash SSR example

End-to-end demo of `masonry-pretext`'s defining capability: **server-side cascading-grid layout precomputation**, with zero hydration flash on the client.

This is the runnable example for [`PRETEXT_SSR_ROADMAP.md`](../../PRETEXT_SSR_ROADMAP.md) Phase 4. It uses every piece of the SSR feature line:

| Improvement | What it provides |
|---|---|
| [#017 `Masonry.computeLayout`](../../improvements/017-compute-layout-static-helper.md) | Pure-Node layout helper called from the Astro frontmatter |
| [#018 `initLayout: false` adoption](../../improvements/018-init-layout-false-adoption.md) | Client adopts SSR positions without overwriting them |
| [#015 `static: true` preset](../../improvements/015-static-ssr-preset.md) | Skips observers + animations on the client |
| [#013 ESM bundle](../../improvements/013-esm-cjs-builds.md) | Lets `import Masonry from 'masonry-pretext'` work in Astro's Node frontmatter and Vite-bundled `<script>` |
| [#005 SSR-safe imports](../../improvements/005-ssr-import-fix.md) | The library doesn't crash when imported in a Node context |

## What this demonstrates

The page renders 24 grid items. The cascading layout is computed in **pure Node** during Astro's build (or per-request in SSR mode), and emitted into the HTML as inline `style="position: absolute; left: Xpx; top: Ypx;"` on each item. The client-side script then constructs masonry with `initLayout: false, static: true` and **adopts** the existing positions without recomputing them.

The user sees the final cascading layout on **first paint**. There is no flow-to-absolute reflow, no animated settle, no observable hydration flash.

## Files

- [`src/pages/index.astro`](./src/pages/index.astro) — the demo page. Frontmatter calls `Masonry.computeLayout`, body emits items with inline positions, `<script>` adopts on the client.

That's the entire demo. ~120 lines of `.astro` source.

## How to run

```sh
# In a fresh Astro project:
npm create astro@latest
cd <your-project>
npm install
npm install github:oriolj/masonry-pretext
cd node_modules/masonry-pretext && npm install && npm run build && cd ../..

# Copy the demo file:
cp <path-to-this-repo>/examples/astro/src/pages/index.astro src/pages/

# Run the dev server:
npm run dev
```

Open `http://localhost:4321`. Open Chrome DevTools → Performance → record a page reload. The Layout Shift section should show **CLS = 0.00** for the grid region.

## How it works — the four steps

### Step 1 — Server-side measurement

In a real app, this is where you call `pretext.prepare(text, font)` followed by `pretext.layout(prepared, maxWidth, lineHeight)` to get DOM-free heights for text-driven items. The demo uses hardcoded heights for simplicity:

```ts
const items = Array.from({ length: 24 }, (_, i) => ({
  id: String(i),
  title: `Item ${i + 1}`,
  outerHeight: 80 + ((i * 37) % 220),
}));
```

Swapping in real pretext is one diff:

```ts
import { prepare, layout as ptLayout } from '@chenglou/pretext';

const FONT = '14px/1.5 system-ui, sans-serif';
const items = await loadFromCMS();
const sizes = items.map((item) => {
  const prepared = prepare(item.title, FONT);
  const { height } = ptLayout(prepared, COL_WIDTH, 21);
  return { outerWidth: COL_WIDTH, outerHeight: height + 24 /* padding */ };
});
```

### Step 2 — `Masonry.computeLayout` in pure Node

```ts
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

`positions` is an array of `{ x, y }` — one per input item, in input order. `containerHeight` is the total grid height. **Verified byte-for-byte against the browser-side layout** by `test/visual/compute-layout.mjs` (#017 / Phase 2).

### Step 3 — Emit inline positions

```astro
<div class="grid" style={`--grid-height: ${containerHeight}px`}>
  {items.map((item, i) => (
    <div
      class="grid-item"
      style={`left: ${positions[i].x}px; top: ${positions[i].y}px; height: ${item.outerHeight}px;`}
    >
      {item.title}
    </div>
  ))}
</div>
```

Two CSS details that matter:

1. **The `.grid` container reserves `height: var(--grid-height)`** so there is no vertical layout shift when items render. Without this, the container collapses to zero height (because all items are absolute) and *then* expands to the computed height when the script runs — a visible CLS.
2. **`.grid-item` has `position: absolute`** in the stylesheet (not just inline). This matches what `Item._create` would set, so masonry's construction is a no-op write rather than a style change.

### Step 4 — Client-side adoption

```html
<script>
  import Masonry from 'masonry-pretext';

  const grid = document.querySelector('#masonry-grid');
  new Masonry(grid, {
    itemSelector: '.grid-item',
    columnWidth: 240,
    gutter: 16,
    initLayout: false,    // adopt existing positions, don't relayout
    static: true,         // no observers, no animations, no font hooks
  });
</script>
```

`initLayout: false` skips the constructor's `this.layout()` call entirely — no items get repositioned. `static: true` skips the per-item `ResizeObserver` wire-up and the `document.fonts.ready` deferred layout, so nothing fires later that could overwrite the SSR positions.

The masonry instance still exists — useful if the user wants to call `.layout()` later (e.g. on a programmatic content swap). It just doesn't relayout on construction.

## Before/after CLS comparison

| Pattern | CLS | First-paint final layout | Hydration flash |
|---|---|---|---|
| **Old way** — server emits items in flow layout, client runs `new Masonry(grid, {})` | ~0.10–0.15 | ❌ No (waits for JS) | ❌ Visible reflow |
| **Old + `transitionDuration: 0`** | ~0.10–0.15 | ❌ Still waits for JS | ⚠️ Snaps instead of animates |
| **Old + `static: true`** (#015) | ~0.10–0.15 | ❌ Still waits for JS | ⚠️ Snaps instead of animates |
| **THIS DEMO** — server `computeLayout` + client `initLayout: false, static: true` | **0.00** | ✅ **Yes** (positions in HTML) | ✅ **None** |

The first three rows are the existing landscape for cascading-grid SSR — including masonry-pretext through `v5.0.0-dev.18` and every other masonry-style library on the market. The bottom row is what this demo proves is possible **only** with the masonry-pretext SSR pipeline.

> **Phase 5 will turn this manual comparison into a permanent automated benchmark** — see [`PRETEXT_SSR_ROADMAP.md`](../../PRETEXT_SSR_ROADMAP.md) Phase 5 for the bench design. Until then, run Lighthouse manually on this demo and compare against your "old way" page.

## When NOT to use this pattern

The full SSR pipeline assumes:

1. **You can predict the container width on the server.** Either fixed (`width: 752px`) or breakpoint-driven. CSS-driven fluid percent widths can't be precomputed because the server doesn't know the viewport. Workaround: serve a "default breakpoint" layout, let masonry recompute on the client if `containerWidth` differs (the existing `needsResizeLayout` already handles this — the SSR layout becomes a hint, not a contract).
2. **You can predict item heights on the server.** Text-driven items work well with `pretext.layout(...)`. Image-driven items need `<img width height>` attributes (so the browser knows the aspect ratio before the image loads) AND the server needs to know those dimensions ahead of time.
3. **Font metrics match server↔client.** This is already a pretext constraint, not a new one. Standard mitigation: `<link rel="preload">` on the webfont so it's loaded before paint.
4. **The grid is static after first paint.** If your grid mutates (lazy images, infinite scroll, dynamic content), you'll need to drop `static: true` and `initLayout: false` and accept a single relayout on the first user interaction.

If those four conditions are met, this pipeline gives you **CLS = 0.00 with no library swap and no special framework setup**. If they aren't, you can still use `static: true` alone (without `initLayout: false`) for a partial win — the dynamic-content machinery stays active but you skip the 0.4s animated settle.

## Comparison to the Next.js example

The [Next.js example in `../nextjs/`](../nextjs) uses the same `static: true` preset but does NOT yet use the full SSR pipeline (no `computeLayout` in the React Server Component, no `initLayout: false`). Bringing it up to parity is straightforward — the React equivalent of step 2 above is a Server Component that does the same computation, then passes positions as props to a `'use client'` component that constructs masonry with `initLayout: false, static: true`. PR welcome.
