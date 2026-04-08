// app/page.tsx — Next.js App Router server component.
//
// This file runs in Node during SSR. It imports a client component
// (MasonryGrid.tsx) that owns the Masonry instance. Nothing on this page
// touches the DOM — Masonry is never constructed on the server.
//
// Note: `import Masonry from 'masonry-pretext'` would be safe to add here
// too (as of improvement #005 the import no longer crashes in Node), but
// you'd have nothing to do with it server-side today. Once roadmap item P
// lands, a future `Masonry.computeLayout(...)` static helper would let you
// pre-compute positions here and emit them inline.

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
