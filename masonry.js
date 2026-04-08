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

  // create an Outlayer layout class
  var Masonry = Outlayer.create('masonry');
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
      pos = getTopColPosition( colSpan, colYs, cols );
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

  function getTopColPosition( colSpan, colYs, cols ) {
    var colGroup = getTopColGroup( colSpan, colYs, cols );
    // get the minimum Y value from the columns
    var minimumY = Math.min.apply( Math, colGroup );
    return {
      col: colGroup.indexOf( minimumY ),
      y: minimumY,
    };
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
    if ( colSpan < 2 ) {
      return colYs[ col ];
    }
    // make an array of colY values for that one group
    var groupColYs = colYs.slice( col, col + colSpan );
    // and get the max value of the array
    return Math.max.apply( Math, groupColYs );
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
        if ( self1.element && self1.element.outlayerGUID ) {
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
            if ( self2.element && self2.element.outlayerGUID ) {
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

  // Disconnect the ResizeObserver on destroy.
  var baseDestroy = proto.destroy;
  proto.destroy = function() {
    if ( this._resizeObserver ) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    return baseDestroy.call( this );
  };

  proto._resetLayout = function() {
    this.getSize();

    // ── #014 — detect percentage columnWidth before _getMeasurement runs.
    // For the literal 'NN%' option path we MUST short-circuit, because
    // _getMeasurement would call querySelector('20%') and throw on the
    // invalid selector. For the sizer-element path we let _getMeasurement
    // run normally and then probe the resolved sizer afterwards.
    this._columnWidthPercent = null;
    var optCW = this.options.columnWidth;
    var literalMatch = typeof optCW === 'string' && optCW.match( PERCENT_RE );
    if ( literalMatch ) {
      this._columnWidthPercent = parseFloat( literalMatch[1] );
      // measureColumns will replace this via the percent path below.
      this.columnWidth = 0;
    } else {
      this._getMeasurement( 'columnWidth', 'outerWidth' );
      if ( typeof optCW === 'string' || optCW instanceof HTMLElement ) {
        var sizer = optCW instanceof HTMLElement
          ? optCW
          : this.element.querySelector( optCW );
        if ( sizer ) {
          this._columnWidthPercent = detectPercentWidth( sizer );
        }
      }
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

    // ── #014 — percent columnWidth math fix (closes desandro/masonry#1006).
    // When columnWidth originated from a percentage, derive cols directly
    // from the percent literal — round(100/percent) — and recompute
    // columnWidth as the per-column stride (item width + gutter) so the
    // inter-column gutters fit inside the container. Stride formula:
    //   cols * stride - gutter = containerWidth
    //   ⇒ stride = (containerWidth + gutter) / cols
    // Matches the convention from the standard branch below where
    // `this.columnWidth += this.gutter` makes columnWidth a stride too.
    // Replaces the buggy gutter-overshoot math, which drops a column
    // whenever (containerWidth + gutter) / (columnWidth + gutter)
    // overshoots an integer by more than 1px.
    if ( this._columnWidthPercent && this.containerWidth ) {
      this.cols = Math.max( 1, Math.round( 100 / this._columnWidthPercent ) );
      this.columnWidth = ( this.containerWidth + this.gutter ) / this.cols;
      return;
    }

    // if columnWidth is 0, default to outerWidth of first item
    if ( !this.columnWidth ) {
      var firstItem = this.items[0];
      var firstItemElem = firstItem && firstItem.element;
      // columnWidth fall back to item of first element
      this.columnWidth = firstItemElem && getSize( firstItemElem ).outerWidth ||
        // if first elem has no width, default to size of container
        this.containerWidth;
    }

    var columnWidth = this.columnWidth += this.gutter;

    // calculate columns
    var containerWidth = this.containerWidth + this.gutter;
    var cols = containerWidth / columnWidth;
    // fix rounding errors, typically with gutters
    var excess = columnWidth - containerWidth % columnWidth;
    // if overshoot is less than a pixel, round up, otherwise floor it
    var mathMethod = excess && excess < 1 ? 'round' : 'floor';
    cols = Math[ mathMethod ]( cols );
    this.cols = Math.max( cols, 1 );
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
    return getTopColPosition( colSpan, this.colYs, this.cols );
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
    // get the columns that this stamp affects
    var isOriginLeft = this._getOption('originLeft');
    var firstX = isOriginLeft ? offset.left : offset.right;
    var lastX = firstX + stampSize.outerWidth;
    var firstCol = Math.floor( firstX / this.columnWidth );
    firstCol = Math.max( 0, firstCol );
    var lastCol = Math.floor( lastX / this.columnWidth );
    // lastCol should not go over if multiple of columnWidth #425
    lastCol -= lastX % this.columnWidth ? 0 : 1;
    lastCol = Math.min( this.cols - 1, lastCol );
    // set colYs to bottom of the stamp

    var isOriginTop = this._getOption('originTop');
    var stampMaxY = ( isOriginTop ? offset.top : offset.bottom ) +
      stampSize.outerHeight;
    for ( var i = firstCol; i <= lastCol; i++ ) {
      this.colYs[i] = Math.max( stampMaxY, this.colYs[i] );
    }
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
    var unusedCols = 0;
    // count unused columns
    var i = this.cols;
    while ( --i ) {
      if ( this.colYs[i] !== 0 ) {
        break;
      }
      unusedCols++;
    }
    // fit container to columns that have been used
    return ( this.cols - unusedCols ) * this.columnWidth - this.gutter;
  };

  proto.needsResizeLayout = function() {
    var previousWidth = this.containerWidth;
    this.getContainerWidth();
    return previousWidth != this.containerWidth;
  };

  return Masonry;

}));
