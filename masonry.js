/*!
 * Masonry v4.2.2
 * Cascading grid layout library
 * https://masonry.desandro.com
 * MIT License
 * by David DeSandro
 */

( function( window, factory ) {
  // universal module definition
  /* jshint strict: false */ /*globals define, module, require */
  if ( typeof define == 'function' && define.amd ) {
    // AMD
    define( [
        'outlayer/outlayer',
        'get-size/get-size'
      ],
      factory );
  } else if ( typeof module == 'object' && module.exports ) {
    // CommonJS
    module.exports = factory(
      require('outlayer'),
      require('get-size')
    );
  } else {
    // browser global
    window.Masonry = factory(
      window.Outlayer,
      window.getSize
    );
  }

}( typeof window !== 'undefined' ? window : {}, function factory( Outlayer, getSize ) {

'use strict';

// -------------------------- masonryDefinition -------------------------- //

  // Inline Outlayer subclass (#029 / item E). Replaces
  // `var Masonry = Outlayer.create('masonry')` so the deleted-from-Outlayer
  // `Outlayer.create` factory + `htmlInit` + `subclass` helper aren't needed.
  function Masonry( element, options ) { Outlayer.call( this, element, options ); }
  Masonry.prototype = Object.create( Outlayer.prototype );
  Masonry.prototype.constructor = Masonry;
  Masonry.namespace = 'masonry';
  Masonry.defaults = Object.assign( {}, Outlayer.defaults );
  Masonry.compatOptions = Object.assign( {}, Outlayer.compatOptions );
  Masonry.data = Outlayer.data;
  function MasonryItem() { Outlayer.Item.apply( this, arguments ); }
  MasonryItem.prototype = Object.create( Outlayer.Item.prototype );
  MasonryItem.prototype.constructor = MasonryItem;
  Masonry.Item = MasonryItem;

  // isFitWidth -> fitWidth
  Masonry.compatOptions.fitWidth = 'isFitWidth';

  var proto = Masonry.prototype;

  // ── #014 — percentage columnWidth detection (§ P.1 / closes
  // desandro/masonry#1006, the highest-reaction open upstream issue at
  // 53 reactions). When the user specifies a percentage column width, the
  // browser resolves the percent to pixels BEFORE masonry sees it, so the
  // gutter-overshoot math in measureColumns ends up dropping a column —
  // e.g. width=20% in a 1000px container with gutter=10 yields cols =
  // floor((1000+10)/(200+10)) = 4 instead of the obvious 5. The fix is to
  // detect that columnWidth came from a percent literal and snap cols to
  // round(100/percent), then recompute columnWidth as
  // (containerWidth - gutter*(cols-1))/cols so the gutters fit inside the
  // container width — see proto.measureColumns below.
  //
  // Detection has three layers, all feeding `_columnWidthPercent`:
  //   1. Literal in option:  new Masonry(g, { columnWidth: '20%' })
  //   2. Inline style on the resolved sizer element
  //   3. Matching CSS rule in any same-origin stylesheet
  //
  // Layer 3 walks `document.styleSheets`. Cross-origin sheets throw on
  // `.cssRules` access — caught and skipped silently. `@media` and other
  // grouping rules are recursed into ONLY when their condition currently
  // matches (otherwise we'd find percent rules in inactive media queries).
  // Last matching rule wins (rough cascade approximation, sufficient for
  // the common `.grid-sizer { width: 20% }` pattern).
  var PERCENT_RE = /^\s*(\d*\.?\d+)\s*%\s*$/;

  function detectPercentWidth( elem ) {
    // Layer 2 — inline style on the sizer element.
    var inline = elem.style && elem.style.width;
    var inlineMatch = inline && inline.match( PERCENT_RE );
    if ( inlineMatch ) return parseFloat( inlineMatch[1] );

    // Layer 3 — walk document.styleSheets for matching width-percent rules.
    if ( typeof document === 'undefined' || !document.styleSheets ) return null;
    var found = null;
    for ( var i = 0; i < document.styleSheets.length; i++ ) {
      var rules;
      try { rules = document.styleSheets[i].cssRules; }
      catch ( e ) { continue; } // CORS / security error — skip
      if ( rules ) {
        var inner = scanRulesForPercentWidth( rules, elem );
        if ( inner !== null ) found = inner;
      }
    }
    return found;
  }

  // Resolve `options.columnWidth` to a percent value (number 0-100) or
  // null if not a percent. Encapsulates all three detection layers so the
  // result is cacheable behind a single key (the option value reference).
  // See `_resetLayout` for the cache plumbing.
  function detectPercentForOption( optCW, container ) {
    if ( typeof optCW === 'string' ) {
      // Layer 1 — literal '20%' option string.
      var literalMatch = optCW.match( PERCENT_RE );
      if ( literalMatch ) return parseFloat( literalMatch[1] );
      // String selector — resolve sizer, fall through to Layer 2/3.
      var sizer = container && container.querySelector( optCW );
      return sizer ? detectPercentWidth( sizer ) : null;
    }
    if ( optCW instanceof HTMLElement ) {
      // HTMLElement option — probe directly.
      return detectPercentWidth( optCW );
    }
    return null;
  }

  function scanRulesForPercentWidth( rules, elem ) {
    var found = null;
    for ( var i = 0; i < rules.length; i++ ) {
      var rule = rules[i];
      // Skip @media / @supports rules whose condition doesn't currently
      // match — otherwise we'd pick up percents from inactive viewports.
      if ( rule.media && rule.media.mediaText && typeof window !== 'undefined' &&
           window.matchMedia && !window.matchMedia( rule.media.mediaText ).matches ) {
        continue;
      }
      if ( rule.style && rule.selectorText && rule.style.width &&
           /%\s*$/.test( rule.style.width ) ) {
        try {
          if ( elem.matches( rule.selectorText ) ) {
            var m = rule.style.width.match( /(\d*\.?\d+)\s*%/ );
            if ( m ) found = parseFloat( m[1] ); // last match wins
          }
        } catch ( e ) { /* invalid selector */ }
      }
      if ( rule.cssRules ) {
        var inner = scanRulesForPercentWidth( rule.cssRules, elem );
        if ( inner !== null ) found = inner;
      }
    }
    return found;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Pure-math placement layer (#016 / § engine-adapter split / Phase 1
  // of PRETEXT_SSR_ROADMAP.md). These functions take pre-measured sizes
  // and numeric state, and return placement decisions — NO `this`, NO
  // DOM, NO option lookups. They are called from the DOM-using
  // `proto._getItemLayoutPosition` adapter, AND will be called from
  // `Masonry.computeLayout` in Phase 2 for pure-Node SSR pre-computation.
  //
  // The design rule: any state the placement decision needs is passed in
  // as a function argument. `placeItem` mutates `state.colYs` in place
  // (matches the existing in-place semantics) and writes back the new
  // `horizontalColIndex` to `state.horizontalColIndex` so the caller
  // re-reads it after the call. The caller chooses whether `state` is
  // a wrapper around a Masonry instance (DOM adapter) or a fresh object
  // built from server-side data (Phase 2 `computeLayout`).
  //
  // Behavior is byte-for-byte identical to the inline implementation
  // these functions replaced — verified by all 9 existing visual
  // fixtures still passing against their unchanged screenshot baselines.
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Compute placement for one item given its size and the current
   * column state. Pure — no `this`, no DOM, no option lookups.
   * Mutates `state.colYs` and `state.horizontalColIndex` in place
   * (same semantics as the proto methods this replaces).
   *
   * @param {{outerWidth: number, outerHeight: number}} size
   * @param {{
   *   cols: number,
   *   colYs: number[],
   *   columnWidth: number,
   *   horizontalColIndex: number,
   *   horizontalOrder: boolean,
   * }} state
   * @returns {{x: number, y: number, col: number, colSpan: number}}
   */
  function placeItem( size, state ) {
    var columnWidth = state.columnWidth;
    var cols = state.cols;
    var colYs = state.colYs;

    // how many columns does this brick span
    var remainder = size.outerWidth % columnWidth;
    var mathMethod = remainder && remainder < 1 ? 'round' : 'ceil';
    var colSpan = Math[ mathMethod ]( size.outerWidth / columnWidth );
    colSpan = Math.min( colSpan, cols );

    // pick column position — top (default) or horizontal-order
    var pos;
    if ( state.horizontalOrder ) {
      pos = getHorizontalColPosition( colSpan, size, state );
      // mutate caller's state for the next item
      state.horizontalColIndex = pos.newHorizontalColIndex;
    } else {
      pos = getTopColPosition( colSpan, colYs, cols, state.pickColumn );
    }

    // compute absolute (x, y)
    var x = columnWidth * pos.col;
    var y = pos.y;

    // mutate colYs in place — set spanned columns to bottom of this item
    var setHeight = y + size.outerHeight;
    var setMax = colSpan + pos.col;
    for ( var i = pos.col; i < setMax; i++ ) {
      colYs[i] = setHeight;
    }

    return { x: x, y: y, col: pos.col, colSpan: colSpan };
  }

  function getTopColPosition( colSpan, colYs, cols, pickColumn ) {
    var colGroup = getTopColGroup( colSpan, colYs, cols );
    // #032 / item I — user-supplied column picker (closes desandro/masonry#811).
    // Default behavior: leftmost shortest column. If `options.pickColumn` is
    // set, the user gets the colGroup array (Y values for each valid
    // horizontal position) and returns which index to use — enabling
    // round-robin, rightmost-shortest, content-aware, etc. strategies.
    var col = pickColumn ? pickColumn( colGroup ) : indexOfMin( colGroup );
    return {
      col: col,
      y: colGroup[ col ],
    };
  }

  function indexOfMin( arr ) {
    var min = arr[0];
    var idx = 0;
    for ( var i = 1; i < arr.length; i++ ) {
      if ( arr[i] < min ) { min = arr[i]; idx = i; }
    }
    return idx;
  }

  function getTopColGroup( colSpan, colYs, cols ) {
    if ( colSpan < 2 ) {
      // if brick spans only one column, use all the column Ys
      return colYs;
    }
    var colGroup = [];
    // how many different places could this brick fit horizontally
    var groupCount = cols + 1 - colSpan;
    // for each group potential horizontal position
    for ( var i = 0; i < groupCount; i++ ) {
      colGroup[i] = getColGroupY( i, colSpan, colYs );
    }
    return colGroup;
  }

  function getColGroupY( col, colSpan, colYs ) {
    // Direct max-loop instead of slice() + Math.max.apply (#025 / item M).
    // For a 1000-item multi-col grid this saves 1000 array allocations
    // per layout (one slice() per call) plus the Math.max.apply
    // arguments-array allocation. Handles colSpan=1 correctly because
    // the loop body never executes.
    var max = colYs[ col ];
    var end = col + colSpan;
    for ( var i = col + 1; i < end; i++ ) {
      if ( colYs[i] > max ) max = colYs[i];
    }
    return max;
  }

  // get column position based on horizontal index. #873
  function getHorizontalColPosition( colSpan, size, state ) {
    var col = state.horizontalColIndex % state.cols;
    var isOver = colSpan > 1 && col + colSpan > state.cols;
    // shift to next row if item can't fit on current row
    col = isOver ? 0 : col;
    // don't let zero-size items take up space
    var hasSize = size.outerWidth && size.outerHeight;
    var newHorizontalColIndex = hasSize ? col + colSpan : state.horizontalColIndex;
    return {
      col: col,
      y: getColGroupY( col, colSpan, state.colYs ),
      newHorizontalColIndex: newHorizontalColIndex,
    };
  }

  // Shared math helpers used by BOTH `proto.*` (instance layout) AND
  // `Masonry.computeLayout` (Phase 2 / SSR pre-computation). These were
  // duplicated across the two call sites in #017 — extracting them here
  // makes drift between server and client mathematically impossible.
  // The byte-for-byte gate (`test/visual/compute-layout.mjs`) becomes
  // tautologically true rather than empirically verified.

  /**
   * Derive `cols` and per-column stride from raw inputs. Mirrors the
   * branch in `proto.measureColumns` exactly.
   */
  function deriveCols( containerWidth, columnWidth, gutter, columnWidthPercent ) {
    if ( columnWidthPercent ) {
      var cols = Math.max( 1, Math.round( 100 / columnWidthPercent ) );
      return { cols: cols, stride: ( containerWidth + gutter ) / cols };
    }
    var stride = columnWidth + gutter;
    var paddedWidth = containerWidth + gutter;
    var rawCols = paddedWidth / stride;
    // fix rounding errors, typically with gutters
    var excess = stride - paddedWidth % stride;
    // if overshoot is less than a pixel, round up, otherwise floor it
    var mathMethod = excess && excess < 1 ? 'round' : 'floor';
    return {
      cols: Math.max( 1, Math[ mathMethod ]( rawCols ) ),
      stride: stride,
    };
  }

  /**
   * Push the spanned colYs down past a stamp. Mirrors the colYs-update
   * loop in `proto._manageStamp`, including the #425 off-by-one fix
   * for stamps that end exactly on a column boundary.
   */
  function applyStamp( colYs, cols, stride, firstX, lastX, stampMaxY ) {
    var firstCol = Math.max( 0, Math.floor( firstX / stride ) );
    var lastCol = Math.floor( lastX / stride );
    // lastCol should not go over if multiple of stride #425
    lastCol -= ( lastX % stride ) ? 0 : 1;
    lastCol = Math.min( cols - 1, lastCol );
    for ( var i = firstCol; i <= lastCol; i++ ) {
      colYs[i] = Math.max( stampMaxY, colYs[i] );
    }
  }

  /**
   * Snap container width to the number of columns actually used,
   * counting unused trailing columns from the right. Mirrors
   * `proto._getContainerFitWidth`.
   */
  function computeFitContainerWidth( cols, colYs, stride, gutter ) {
    var unusedCols = 0;
    var i = cols;
    while ( --i ) {
      if ( colYs[i] !== 0 ) break;
      unusedCols++;
    }
    return ( cols - unusedCols ) * stride - gutter;
  }

  // document.fonts.ready first-paint gate (#010 / § P.4 — closes
  // desandro/masonry#1182) AND per-item ResizeObserver auto-relayout
  // (#012 / § P.1b — closes desandro/masonry#1147 + 7 image-overlap
  // duplicates). Both run in the constructor extension point.
  //
  // `options.static` (#015 / § SSR) opts out of BOTH of the above AND
  // forces `transitionDuration: 0`, for server-rendered grids whose
  // content will not change after first paint. See the README SSR
  // section and improvements/015-static-ssr-preset.md.
  var baseCreate = proto._create;
  proto._create = function() {
    // Static mode: no animations on any relayout. Set before anything
    // else so item.transition() reads the overridden value.
    if ( this.options.static ) {
      this.options.transitionDuration = 0;
    }
    baseCreate.call( this );
    // ── #010 — fonts.ready first-paint gate (skipped in static mode) ──
    if ( !this.options.static &&
         typeof document !== 'undefined' && document.fonts &&
         document.fonts.status !== 'loaded' ) {
      var self1 = this;
      document.fonts.ready.then( function() {
        if ( !self1._destroyed ) {
          self1.layout();
        }
      });
    }
    // ── #012 — per-item ResizeObserver (skipped in static mode) ─────────
    // Observe every item element. When any item's size changes (image
    // loads, font swaps, content edits, parent resizes — anything),
    // schedule a relayout via rAF coalescing so multiple changes in one
    // frame collapse to a single layout() call. Comparison is against a
    // pre-populated `_resizeLastSizes` WeakMap to handle the
    // "size changes between observe() and first delivery" race correctly:
    // ResizeObserver delivers the first event with the size at delivery
    // time, not observe time, so a naïve "skip first event" approach
    // would silently miss the very kind of change this hook exists to
    // catch. Pre-populating with getBoundingClientRect (which matches
    // the borderBoxSize the observer delivers) makes every event a
    // legitimate comparison. SSR-safe via the typeof guard.
    if ( !this.options.static && typeof ResizeObserver !== 'undefined' ) {
      var self2 = this;
      this._resizeLastSizes = new WeakMap();
      var pendingRaf = null;
      this._resizeObserver = new ResizeObserver( function( entries ) {
        var changed = false;
        for ( var i = 0; i < entries.length; i++ ) {
          var entry = entries[i];
          var box = entry.borderBoxSize && entry.borderBoxSize[0];
          var w = box ? box.inlineSize : entry.contentRect.width;
          var h = box ? box.blockSize : entry.contentRect.height;
          var prev = self2._resizeLastSizes.get( entry.target );
          if ( prev && ( prev.width !== w || prev.height !== h ) ) {
            changed = true;
          }
          self2._resizeLastSizes.set( entry.target, { width: w, height: h });
        }
        if ( changed && pendingRaf === null ) {
          pendingRaf = requestAnimationFrame( function() {
            pendingRaf = null;
            if ( !self2._destroyed ) {
              self2.layout();
            }
          });
        }
      });
      // Observe items added during the initial _create (via reloadItems).
      // Items added later (via _itemize through appended/prepended/addItems)
      // are observed by the proto._itemize override below.
      for ( var i = 0; i < this.items.length; i++ ) {
        this._observeItemElement( this.items[i].element );
      }
    }
    // ── #031 — MutationObserver auto-relayout (§ P.2 / item K) ──────────
    // Opt-in via `options.observeMutations: true`. When children are added
    // to or removed from the grid container via DIRECT DOM MANIPULATION
    // (not via masonry.appended/prepended/remove), masonry detects the
    // change and reloads + relayouts automatically. Closes the dominant
    // non-image upstream complaint cluster — "I called grid.appendChild
    // and the new item didn't show up." Coalesces via requestAnimationFrame
    // so multiple appends in the same task collapse to a single layout call.
    // SSR-safe via typeof guard. Skipped in static mode.
    if ( !this.options.static && this.options.observeMutations &&
         typeof MutationObserver !== 'undefined' ) {
      var self3 = this;
      var pendingMutationRaf = null;
      this._mutationObserver = new MutationObserver( function() {
        if ( pendingMutationRaf !== null ) return;
        pendingMutationRaf = requestAnimationFrame( function() {
          pendingMutationRaf = null;
          if ( self3._destroyed ) return;
          self3.reloadItems();
          self3.layout();
        });
      });
      this._mutationObserver.observe( this.element, { childList: true });
    }
  };

  // Helper used by both _create's initial loop and the _itemize override.
  // Pre-populates _resizeLastSizes with getBoundingClientRect (which
  // matches the borderBoxSize the observer delivers) before observing,
  // so the first observer event has a real comparison baseline.
  proto._observeItemElement = function( elem ) {
    var rect = elem.getBoundingClientRect();
    this._resizeLastSizes.set( elem, { width: rect.width, height: rect.height });
    this._resizeObserver.observe( elem );
  };

  // Hook _itemize so items added after construction (via appended,
  // prepended, addItems — all of which call _itemize) get observed by
  // the per-instance ResizeObserver from above.
  var baseItemize = proto._itemize;
  proto._itemize = function( elems ) {
    var items = baseItemize.call( this, elems );
    if ( this._resizeObserver ) {
      for ( var i = 0; i < items.length; i++ ) {
        this._observeItemElement( items[i].element );
      }
    }
    return items;
  };

  // Unobserve removed items so the ResizeObserver doesn't keep their
  // elements alive after they're detached from the DOM.
  var baseRemove = proto.remove;
  proto.remove = function( elems ) {
    if ( this._resizeObserver ) {
      var removeItems = this.getItems( elems );
      for ( var i = 0; i < removeItems.length; i++ ) {
        this._resizeObserver.unobserve( removeItems[i].element );
      }
    }
    return baseRemove.call( this, elems );
  };

  // Disconnect ResizeObserver (#012) and MutationObserver (#031) on destroy.
  var baseDestroy = proto.destroy;
  proto.destroy = function() {
    if ( this._resizeObserver ) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if ( this._mutationObserver ) {
      this._mutationObserver.disconnect();
      this._mutationObserver = null;
    }
    return baseDestroy.call( this );
  };

  proto._resetLayout = function() {
    this.getSize();

    // ── #014 — detect percentage columnWidth.
    //
    // For the literal 'NN%' option path we short-circuit `_getMeasurement`
    // entirely — it would call `querySelector('20%')` and throw on the
    // invalid selector. For the sizer-element path we let `_getMeasurement`
    // run normally and probe the resolved sizer afterwards.
    //
    // Detection is cached against `options.columnWidth` (the input
    // reference). The stylesheet walk in `detectPercentWidth` is expensive
    // — on a Tailwind/DaisyUI page with thousands of CSSRules it's
    // multi-millisecond per call. ResizeObserver-driven relayouts (#012)
    // call `_resetLayout` 60+ times per second during a window-resize
    // drag, so the walk has to be cached or it dominates the layout cost.
    // Cache invalidation is reference equality on `options.columnWidth` —
    // the only way the detection result can change is if the user calls
    // `instance.option({columnWidth: ...})` with a new value.
    var optCW = this.options.columnWidth;
    if ( this._percentCacheKey !== optCW ) {
      this._percentCacheKey = optCW;
      this._percentCacheValue = detectPercentForOption( optCW, this.element );
    }
    this._columnWidthPercent = this._percentCacheValue;

    if ( this._columnWidthPercent !== null && typeof optCW === 'string' &&
         PERCENT_RE.test( optCW ) ) {
      // Literal '20%' path: skip _getMeasurement so querySelector doesn't choke.
      this.columnWidth = 0;
    } else {
      this._getMeasurement( 'columnWidth', 'outerWidth' );
    }

    this._getMeasurement( 'gutter', 'outerWidth' );
    this.measureColumns();

    // reset column Y
    this.colYs = [];
    for ( var i=0; i < this.cols; i++ ) {
      this.colYs.push( 0 );
    }

    this.maxY = 0;
    this.horizontalColIndex = 0;
  };

  proto.measureColumns = function() {
    this.getContainerWidth();

    // #014 — fall back to first item's outerWidth when columnWidth is
    // unset and no percent override is in effect. Has to happen before
    // deriveCols because the helper takes columnWidth as input. Cannot
    // live in deriveCols itself because the fallback requires DOM access.
    if ( !this.columnWidth && !this._columnWidthPercent ) {
      var firstItem = this.items[0];
      var firstItemElem = firstItem && firstItem.element;
      // if first elem has no width, default to size of container
      this.columnWidth = firstItemElem && getSize( firstItemElem ).outerWidth ||
        this.containerWidth;
    }

    // Derive cols + stride via the shared helper. The standard branch's
    // gutter-overshoot rounding and the #014 percent path both live here.
    var derived = deriveCols(
      this.containerWidth,
      this.columnWidth,
      this.gutter,
      this._columnWidthPercent
    );
    this.cols = derived.cols;
    this.columnWidth = derived.stride;
  };

  proto.getContainerWidth = function() {
    // container is parent if fit width
    var isFitWidth = this._getOption('fitWidth');
    var container = isFitWidth ? this.element.parentNode : this.element;
    // check that this.size and size are there
    // IE8 triggers resize on body size change, so they might not be
    var size = getSize( container );
    this.containerWidth = size && size.innerWidth;
  };

  // The DOM adapter (#016 / Phase 1). Resolves item size via pretextify
  // (#009) or `item.getSize()` (DOM reflow), then delegates the actual
  // packing math to the pure-math `placeItem` helper above. Mutations
  // to `colYs` and `horizontalColIndex` happen inside `placeItem`; the
  // wrapper `state` object is constructed once per call so the pure
  // function can mutate primitives in place via the shared reference.
  // The colYs array reference is the same one that lives on `this`,
  // so the in-place mutation is visible to subsequent calls without
  // an explicit copy-back.
  proto._getItemLayoutPosition = function( item ) {
    // Pretext fast path (#009): if `options.pretextify(element)` returns a
    // size, use it as `item.size` and skip `item.getSize()` — which forces a
    // DOM reflow. Library-agnostic; works with @chenglou/pretext or any
    // precomputed sizes. See improvements/009-pretext-integration.md.
    var pretextify = this.options.pretextify;
    var pretextSize = pretextify && pretextify( item.element );
    if ( pretextSize ) {
      item.size = pretextSize;
    } else {
      item.getSize();
    }

    // Pure-math placement. The state object is the bridge between the
    // masonry instance and the pure layer — same field names, flat
    // shape, no `this`. `placeItem` mutates state.colYs in place
    // (shared reference with this.colYs) and state.horizontalColIndex
    // for primitive write-back.
    var state = {
      cols: this.cols,
      colYs: this.colYs,
      columnWidth: this.columnWidth,
      horizontalColIndex: this.horizontalColIndex,
      horizontalOrder: this.options.horizontalOrder,
      pickColumn: this.options.pickColumn,
    };
    var result = placeItem( item.size, state );
    this.horizontalColIndex = state.horizontalColIndex;

    return { x: result.x, y: result.y };
  };

  // Backward-compatible prototype wrappers (#016 / Phase 1). Plugin
  // authors who reach into masonry's internals via `proto._getX` would
  // break if these were deleted, so they're kept as thin shims that
  // delegate to the pure helpers above. They still mutate `this`
  // identically to the pre-refactor versions.

  proto._getTopColPosition = function( colSpan ) {
    return getTopColPosition( colSpan, this.colYs, this.cols, this.options.pickColumn );
  };

  /**
   * @param {Number} colSpan - number of columns the element spans
   * @returns {Array} colGroup
   */
  proto._getTopColGroup = function( colSpan ) {
    return getTopColGroup( colSpan, this.colYs, this.cols );
  };

  proto._getColGroupY = function( col, colSpan ) {
    return getColGroupY( col, colSpan, this.colYs );
  };

  // get column position based on horizontal index. #873
  proto._getHorizontalColPosition = function( colSpan, item ) {
    var state = {
      cols: this.cols,
      colYs: this.colYs,
      horizontalColIndex: this.horizontalColIndex,
    };
    var result = getHorizontalColPosition( colSpan, item.size, state );
    this.horizontalColIndex = result.newHorizontalColIndex;
    return { col: result.col, y: result.y };
  };

  proto._manageStamp = function( stamp ) {
    var stampSize = getSize( stamp );
    var offset = this._getElementOffset( stamp );
    var isOriginLeft = this._getOption('originLeft');
    var firstX = isOriginLeft ? offset.left : offset.right;
    var lastX = firstX + stampSize.outerWidth;
    var isOriginTop = this._getOption('originTop');
    var stampMaxY = ( isOriginTop ? offset.top : offset.bottom ) +
      stampSize.outerHeight;
    applyStamp( this.colYs, this.cols, this.columnWidth, firstX, lastX, stampMaxY );
  };

  proto._getContainerSize = function() {
    this.maxY = Math.max.apply( Math, this.colYs );
    var size = {
      height: this.maxY
    };

    if ( this._getOption('fitWidth') ) {
      size.width = this._getContainerFitWidth();
    }

    return size;
  };

  proto._getContainerFitWidth = function() {
    var fitWidth = computeFitContainerWidth( this.cols, this.colYs, this.columnWidth, this.gutter );
    // #033 / item J — cap fitWidth at parent's clientWidth so a narrow
    // parent (e.g., one with `max-width`) doesn't get a wider grid that
    // overflows. Closes desandro/masonry#1129. clientWidth respects
    // max-width on the parent transitively because the layout engine
    // applies the constraint before computing client dimensions.
    var parent = this.element.parentNode;
    if ( parent && typeof parent.clientWidth === 'number' && parent.clientWidth > 0 ) {
      return Math.min( fitWidth, parent.clientWidth );
    }
    return fitWidth;
  };

  proto.needsResizeLayout = function() {
    var previousWidth = this.containerWidth;
    this.getContainerWidth();
    return previousWidth != this.containerWidth;
  };

  // ─────────────────────────────────────────────────────────────────────
  // Static helper: Masonry.computeLayout (#017 / Phase 2 of
  // PRETEXT_SSR_ROADMAP.md). Pure-Node entry point — takes pre-measured
  // item sizes + container width + column width + gutter, returns
  // absolute positions. NO `this`, NO DOM, NO instance required.
  //
  // The killer use case is server-side layout precomputation: render
  // your text-driven grid in Node, hand the item sizes (from pretext or
  // any DOM-free measurement library) to Masonry.computeLayout, and
  // emit the resulting positions inline as `style="left: Xpx; top: Ypx"`.
  // The client constructs masonry with `initLayout: false` and adopts
  // the existing absolute positions — no hydration flash.
  //
  // Behavior matches `proto.measureColumns` + `proto._getItemLayoutPosition`
  // + `proto._manageStamp` + `proto._getContainerSize` byte-for-byte.
  // Verified by `test/visual/compute-layout.mjs`, a Node-only test that
  // asserts agreement with all 9 browser-rendered fixtures.
  //
  // @param {{
  //   items: Array<{outerWidth: number, outerHeight: number}>,
  //   containerWidth: number,
  //   columnWidth: number,
  //   gutter?: number,
  //   fitWidth?: boolean,
  //   horizontalOrder?: boolean,
  //   stamps?: Array<{x: number, y: number, width: number, height: number}>,
  //   columnWidthPercent?: number,
  // }} opts
  // @returns {{
  //   positions: Array<{x: number, y: number}>,
  //   cols: number,
  //   columnWidth: number,
  //   containerHeight: number,
  //   containerWidth?: number,
  // }}
  // ─────────────────────────────────────────────────────────────────────
  Masonry.computeLayout = function( opts ) {
    var items = opts.items || [];
    var gutter = opts.gutter || 0;
    var stamps = opts.stamps || [];

    // Derive cols + stride via the same helper proto.measureColumns uses,
    // so server and client agreement is structural rather than empirical.
    var derived = deriveCols(
      opts.containerWidth, opts.columnWidth, gutter, opts.columnWidthPercent
    );
    var cols = derived.cols;
    var stride = derived.stride;

    // Fresh colYs per call so subsequent calls don't see stale data.
    var colYs = new Array( cols );
    for ( var z = 0; z < cols; z++ ) colYs[z] = 0;

    for ( var s = 0; s < stamps.length; s++ ) {
      var stamp = stamps[s];
      applyStamp(
        colYs, cols, stride,
        stamp.x, stamp.x + stamp.width,
        stamp.y + stamp.height
      );
    }

    var state = {
      cols: cols,
      colYs: colYs,
      columnWidth: stride,
      horizontalColIndex: 0,
      horizontalOrder: !!opts.horizontalOrder,
      pickColumn: opts.pickColumn,
    };
    var positions = new Array( items.length );
    for ( var i = 0; i < items.length; i++ ) {
      var result = placeItem( items[i], state );
      positions[i] = { x: result.x, y: result.y };
    }

    var out = {
      positions: positions,
      cols: cols,
      columnWidth: stride,
      containerHeight: colYs.length ? Math.max.apply( Math, colYs ) : 0,
    };
    if ( opts.fitWidth ) {
      out.containerWidth = computeFitContainerWidth( cols, colYs, stride, gutter );
    }
    return out;
  };

  return Masonry;

}));
