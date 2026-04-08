// app/page.tsx — Next.js App Router server component.
//
// This file runs in Node during SSR. It imports a client component
// (MasonryGrid.tsx) that owns the Masonry instance.
//
// This example uses the simpler "client-only Masonry construction"
// pattern. For the FULL SSR pipeline (server-side `Masonry.computeLayout`
// + inline absolute positions + client `initLayout: false` adoption →
// CLS = 0.00 hydration), see `examples/astro/src/pages/index.astro`.
// Bringing this Next.js example up to parity is straightforward — same
// idea, server-component math, client-component adoption — and is a
// PR-welcome follow-up.

import MasonryGrid from './MasonryGrid';

type Item = { id: string; title: string; height: number };

// In a real app this would come from a database, a CMS, a fetch, etc.
// Heights are only used to give each card a distinctive size in the demo.
function getItems(): Item[] {
  return Array.from({ length: 24 }, (_, i) => ({
    id: String(i),
    title: `Item ${i + 1}`,
    height: 80 + ((i * 37) % 220),
  }));
}

export default function Page() {
  const items = getItems();

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>masonry-pretext + Next.js App Router</h1>
      <p>
        Grid markup is server-rendered. Masonry is constructed on the client
        via a <code>&apos;use client&apos;</code> boundary.
      </p>
      <MasonryGrid items={items} />
    </main>
  );
}
