// app/page.tsx — Next.js App Router server component.
//
// This is the FULL SSR pipeline demo for masonry-pretext, mirroring
// examples/astro/src/pages/index.astro. The four steps:
//
//   1. The Server Component runs in Node. It imports Masonry, builds the
//      item list, calls Masonry.computeLayout in PURE NODE (no DOM, no
//      JSDOM, no chromium) to get back absolute positions.
//
//   2. The component renders each item with inline `style="left: Xpx;
//      top: Ypx;"` so the browser sees the cascading layout BEFORE any
//      client JavaScript runs.
//
//   3. The container reserves `height: var(--grid-height)` from the
//      server-computed total height — without this, the grid would
//      collapse to 0 (all children absolute) and then expand when the
//      script runs, causing a vertical layout shift.
//
//   4. <MasonryGrid> is a 'use client' component that takes the
//      pre-computed positions as a prop. On the client it constructs
//      `new Masonry(grid, { initLayout: false, static: true })` which
//      ADOPTS the existing positions without recomputing them. Result:
//      ZERO HYDRATION FLASH.
//
// In a real app, the item heights would come from `pretext.layout(text,
// font, maxWidth)` instead of being hardcoded — that's a one-diff swap
// in this file. The pattern works with any DOM-free measurement source.

import Masonry from 'masonry-pretext';
import MasonryGrid from './MasonryGrid';

const COL_WIDTH = 240;
const GUTTER = 16;
const COLS = 3;
const CONTAINER_WIDTH = COLS * COL_WIDTH + (COLS - 1) * GUTTER; // 752

type Item = { id: string; title: string; outerHeight: number };

// In a real app these come from a CMS / database / fetch. Heights would
// typically come from pretext.layout(...) over the item text. The demo
// uses deterministic pseudo-random heights so the layout is reproducible.
function getItems(): Item[] {
  return Array.from({ length: 24 }, (_, i) => ({
    id: String(i),
    title: `Item ${i + 1}`,
    outerHeight: 80 + ((i * 37) % 220),
  }));
}

export default function Page() {
  const items = getItems();

  // THE KILLER STEP — server-side layout precomputation in pure Node.
  // Masonry.computeLayout (#017 / Phase 2 of PRETEXT_SSR_ROADMAP.md)
  // takes pre-measured sizes and returns absolute positions, byte-for-byte
  // identical to what the browser would compute on the client.
  const { positions, containerHeight } = Masonry.computeLayout({
    items: items.map((item) => ({
      outerWidth: COL_WIDTH,
      outerHeight: item.outerHeight,
    })),
    containerWidth: CONTAINER_WIDTH,
    columnWidth: COL_WIDTH,
    gutter: GUTTER,
  });

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 900, margin: '0 auto' }}>
      <h1>masonry-pretext + Next.js — zero-flash SSR</h1>
      <p>
        Grid is laid out <strong>entirely on the server</strong> via{' '}
        <code>Masonry.computeLayout</code>. The Server Component computes
        positions in pure Node and passes them as props to a{' '}
        <code>&apos;use client&apos;</code> component, which adopts them
        without relayouting. Users see the final cascading layout on first
        paint — no hydration flash.
      </p>
      <MasonryGrid
        items={items}
        positions={positions}
        containerHeight={containerHeight}
        columnWidth={COL_WIDTH}
        gutter={GUTTER}
      />
    </main>
  );
}
