/*!
 * masonry-pretext/astro — `<masonry-grid>` integration for Astro View Transitions
 * https://github.com/oriolj/masonry-pretext
 * MIT License
 */

// #049 / D.8 — Astro integration subpath. Side-effect import that
// loads the `<masonry-grid>` Custom Element from #034 AND wires it
// up to Astro's `astro:page-load` event so the element correctly
// re-initializes after a View Transition navigation.
//
// Why this is needed: Astro's View Transitions feature can either
// REPLACE the document (the default) or PERSIST elements across
// navigations (via `transition:persist`). The two cases need
// different handling:
//
//   1. Document replaced: the old `<masonry-grid>` element is gone,
//      a new one is created. `connectedCallback` fires naturally
//      and constructs masonry. No special handling needed.
//
//   2. Element persisted: the same `<masonry-grid>` element survives
//      the navigation. `connectedCallback` does NOT fire (the
//      element was never disconnected). The MASONRY INSTANCE inside
//      it might still be wired to the OLD page's items, which were
//      replaced by the new page's content via Astro's swap logic.
//      We need to re-construct masonry after the swap completes.
//
// Strategy: on `astro:page-load`, walk every `<masonry-grid>`
// element in the document. If it has a stale masonry instance
// (i.e., the items array doesn't match the current children),
// destroy + reconstruct. Otherwise leave it alone.
//
// Usage in an Astro project:
//
//   // src/components/MasonryGrid.astro:
//   ---
//   ---
//   <masonry-grid {...Astro.props}>
//     <slot />
//   </masonry-grid>
//
//   <script>
//     import 'masonry-pretext/astro';
//   </script>
//
// The `import 'masonry-pretext/astro'` is a side-effect import — it
// loads the Custom Element registration AND the page-load listener
// in one shot. Consumers don't need to wire anything else.

( function( window, factory ) {
  if ( typeof define == 'function' && define.amd ) {
    define( [ './masonry-grid-element' ], factory );
  } else if ( typeof module == 'object' && module.exports ) {
    factory( require( './masonry-grid-element' ) );
  } else {
    factory( window.MasonryGridElement );
  }
}( typeof window !== 'undefined' ? window : {}, function factory( MasonryGridElement ) {

'use strict';

// Bail in SSR contexts.
if ( typeof window === 'undefined' || typeof document === 'undefined' ) {
  return;
}

// Check if a masonry-grid element's wired masonry instance is stale
// (its items array doesn't match the element's current children).
// Astro swaps the contents in-place, so the children might be the
// new page's items while the masonry instance still references the
// old page's items.
function isStale( elem ) {
  if ( !elem._masonry ) return true;
  // Compare the count + first/last identity. Cheap heuristic that
  // catches most realistic Astro swaps without iterating every item.
  var items = elem._masonry.items;
  var children = elem.children;
  // Filter children by item selector if present.
  var itemSelector = elem._masonry.options.itemSelector;
  var validChildren = [];
  for ( var i = 0; i < children.length; i++ ) {
    if ( !itemSelector || children[i].matches( itemSelector ) ) {
      validChildren.push( children[i] );
    }
  }
  if ( items.length !== validChildren.length ) return true;
  if ( items.length === 0 ) return false;
  if ( items[0].element !== validChildren[0] ) return true;
  if ( items[ items.length - 1 ].element !== validChildren[ validChildren.length - 1 ] ) return true;
  return false;
}

function reinitMasonryGrids() {
  var grids = document.querySelectorAll( 'masonry-grid' );
  for ( var i = 0; i < grids.length; i++ ) {
    var grid = grids[i];
    if ( isStale( grid ) ) {
      if ( grid._masonry ) {
        grid._masonry.destroy();
        grid._masonry = null;
      }
      // Re-trigger connectedCallback's path to rebuild the instance.
      if ( typeof grid.connectedCallback === 'function' ) {
        grid.connectedCallback();
      }
    }
  }
}

window.addEventListener( 'astro:page-load', reinitMasonryGrids );
// `astro:after-swap` fires after the document swap but BEFORE
// `astro:page-load`. We listen to both because the timing matters
// in some Astro versions.
window.addEventListener( 'astro:after-swap', reinitMasonryGrids );

}));
