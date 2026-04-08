// app/MasonryGrid.tsx — client component that owns the Masonry instance.
//
// The 'use client' directive tells Next.js this component has browser-only
// code. Its HTML is still server-rendered (users see the grid markup before
// any JS runs), but `useEffect` only fires in the browser — which is where
// we construct Masonry.
//
// masonry-pretext is SSR-safe to import (improvement #005), so this file
// does NOT need next/dynamic({ ssr: false }) or any import-time workarounds.

'use client';

import { useEffect, useRef } from 'react';
import Masonry from 'masonry-pretext';

type Item = { id: string; title: string; height: number };

export default function MasonryGrid({ items }: { items: Item[] }) {
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;

    const msnry = new Masonry(el, {
      itemSelector: '.grid-item',
      columnWidth: 240,
      gutter: 16,
      // SSR preset (v5.0.0-dev.15+). One flag flips three runtime
      // behaviors at once: transitionDuration → 0, skips the
      // document.fonts.ready deferred layout, skips per-item
      // ResizeObserver construction. Use for server-rendered grids
      // whose items will not change size after first paint. See main
      // README § "Optimizations for SSR mode — `static: true`".
      static: true,
    });

    // Clean up on unmount / re-render. destroy() disconnects the per-item
    // ResizeObserver (from improvement #012) and removes the absolute
    // positioning that masonry applied.
    return () => {
      msnry.destroy();
    };
  }, [items]);

  return (
    <div
      ref={gridRef}
      className="grid"
      style={{ position: 'relative' }}
    >
      {items.map((item) => (
        <div
          key={item.id}
          className="grid-item"
          style={{
            width: 240,
            height: item.height,
            background: '#f3f4f6',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            padding: 12,
            boxSizing: 'border-box',
          }}
        >
          {item.title}
        </div>
      ))}
    </div>
  );
}
