// app/MasonryGrid.tsx — client component that ADOPTS server-computed
// positions instead of recomputing them.
//
// The Server Component (app/page.tsx) calls Masonry.computeLayout in
// Node and passes the resulting `positions` array as a prop. This client
// component renders each item with the inline absolute position the
// server computed, then constructs masonry with `initLayout: false +
// static: true` so the existing positions stay put.
//
// THE TWO CSS DETAILS that matter:
//
//   1. The grid container reserves `height: var(--grid-height)` from
//      the server-computed total — without this, the grid collapses to
//      0 (all children absolute) and then expands when the script runs,
//      causing a vertical layout shift on hydration.
//
//   2. Each .grid-item has `position: absolute` AT RENDER TIME, not just
//      after script construction. masonry's `Item._create` would set this
//      anyway, but pre-rendering it avoids a brief flow-layout flash.
//
// masonry-pretext is SSR-safe to import (improvement #005), so this file
// does NOT need next/dynamic({ ssr: false }) or any import-time workarounds.

'use client';

import { useEffect, useRef } from 'react';
import Masonry from 'masonry-pretext';

type Item = { id: string; title: string; outerHeight: number };
type Position = { x: number; y: number };

interface MasonryGridProps {
  items: Item[];
  positions: Position[];
  containerHeight: number;
  columnWidth: number;
  gutter: number;
}

export default function MasonryGrid({
  items,
  positions,
  containerHeight,
  columnWidth,
  gutter,
}: MasonryGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;

    // THE KEY COMBO for the SSR adoption path:
    //
    //   initLayout: false  → don't run the constructor's layout() pass;
    //                        adopt existing positions instead
    //   static: true       → no observers, no animations, no font hooks;
    //                        the SSR positions are final
    //
    // Verified by the init-layout-false discriminating fixture (#018) and
    // the static-mode discriminating fixture (#015). Together they form
    // the conjugate pair that locks in the SSR adoption contract.
    const msnry = new Masonry(el, {
      itemSelector: '.grid-item',
      columnWidth,
      gutter,
      initLayout: false,
      static: true,
    });

    return () => {
      msnry.destroy();
    };
  }, [items, columnWidth, gutter]);

  return (
    <div
      ref={gridRef}
      className="grid"
      style={{
        position: 'relative',
        // Reserve the full server-computed height — the secret to CLS = 0.00.
        // Without this, .grid collapses to 0 (all children absolute) and
        // then expands when the script runs, causing a vertical shift.
        height: containerHeight,
      }}
    >
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
            background: '#f3f4f6',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            padding: 12,
            boxSizing: 'border-box',
            fontSize: 14,
          }}
        >
          {item.title}
        </div>
      ))}
    </div>
  );
}
