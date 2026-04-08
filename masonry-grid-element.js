/*!
 * masonry-pretext <masonry-grid> Custom Element wrapper
 * https://github.com/oriolj/masonry-pretext
 * MIT License
 */

// `<masonry-grid>` Web Component (#034 / item Q). A framework-agnostic
// Custom Element that constructs masonry on `connectedCallback`, destroys
// it on `disconnectedCallback`, and reads options from data-* attributes.
// Ships as a SEPARATE bundle (`dist/masonry-grid-element.{js,mjs}`) so
// users of the imperative `new Masonry(...)` API don't pay these bytes.
//
// Combines #015 `static: true`, #031 `observeMutations: true`, and #012's
// per-item ResizeObserver out of the box — drop a `<masonry-grid>` element
// into HTML and it Just Works for the common dynamic-content case.
//
// Usage in vanilla HTML:
//
//   <script src="masonry-grid-element.js"></script>
//   <masonry-grid column-width="240" gutter="16">
//     <div class="grid-item">...</div>
//     <div class="grid-item">...</div>
//   </masonry-grid>
//
// Usage in React (no React-specific API needed):
//
//   <masonry-grid column-width="240" gutter="16">
//     {items.map(item => <div key={item.id} className="grid-item">...</div>)}
//   </masonry-grid>
//
// For options that don't fit in attributes (callbacks like `pretextify` or
// `pickColumn`), set them via the `options` property:
//
//   document.querySelector('masonry-grid').options = {
//     pretextify: elem => ({ outerWidth: 240, outerHeight: 192 }),
//   };

( function( window, factory ) {
  if ( typeof define == 'function' && define.amd ) {
    define( [ 'masonry' ], factory );
  } else if ( typeof module == 'object' && module.exports ) {
    module.exports = factory( require( './masonry' ) );
  } else {
    window.MasonryGridElement = factory( window.Masonry );
  }
}( typeof window !== 'undefined' ? window : {}, function factory( Masonry ) {

'use strict';

// Bail in SSR contexts where HTMLElement isn't defined.
if ( typeof HTMLElement === 'undefined' || typeof customElements === 'undefined' ) {
  return null;
}

function MasonryGridElement() {
  // Custom Element constructors must call super() — but `function`
  // declarations can't extend HTMLElement directly. Use Reflect.construct
  // so the prototype chain is correct without `class` syntax.
  return Reflect.construct( HTMLElement, [], MasonryGridElement );
}
MasonryGridElement.prototype = Object.create( HTMLElement.prototype );
MasonryGridElement.prototype.constructor = MasonryGridElement;

MasonryGridElement.prototype.connectedCallback = function() {
  if ( this._masonry ) return;
  this._masonry = new Masonry( this, this._readOptions() );
};

MasonryGridElement.prototype.disconnectedCallback = function() {
  if ( this._masonry ) {
    this._masonry.destroy();
    this._masonry = null;
  }
};

MasonryGridElement.prototype._readOptions = function() {
  var opts = {
    // Defaults that make the common dynamic-content case work without
    // any wiring: observe DOM mutations + per-item resizes (#012 + #031),
    // skip the 0.4s animated settle (#015 implies this).
    observeMutations: true,
    transitionDuration: 0,
  };
  if ( this.hasAttribute( 'column-width' ) ) {
    var cw = this.getAttribute( 'column-width' );
    var num = parseFloat( cw );
    opts.columnWidth = isNaN( num ) ? cw : num;
  }
  if ( this.hasAttribute( 'gutter' ) ) {
    opts.gutter = parseFloat( this.getAttribute( 'gutter' ) ) || 0;
  }
  if ( this.hasAttribute( 'item-selector' ) ) {
    opts.itemSelector = this.getAttribute( 'item-selector' );
  }
  if ( this.hasAttribute( 'horizontal-order' ) ) opts.horizontalOrder = true;
  if ( this.hasAttribute( 'fit-width' ) ) opts.fitWidth = true;
  if ( this.hasAttribute( 'static' ) ) opts.static = true;
  if ( this.hasAttribute( 'percent-position' ) ) opts.percentPosition = true;
  // User-supplied options (callbacks, complex shapes) take precedence.
  return Object.assign( opts, this._userOptions || {} );
};

Object.defineProperty( MasonryGridElement.prototype, 'options', {
  get: function() { return this._userOptions; },
  set: function( value ) {
    if ( value === this._userOptions ) return;
    this._userOptions = value;
    if ( this._masonry ) {
      // Re-construct with the new options. NOTE: this destroys the
      // existing instance — observers re-attach, colYs is reset, any
      // .on() handlers are lost. For incremental tweaks (e.g. just
      // changing a callback), prefer `el.masonry.option({ ... })` on
      // the underlying instance, accessed via the `.masonry` getter.
      this._masonry.destroy();
      this._masonry = new Masonry( this, this._readOptions() );
    }
  },
});

// Public read-only access to the underlying Masonry instance, for users
// who need to call methods that bypass the destroy/re-construct cycle of
// the `options` setter (`layout()`, `appended()`, `option({ ... })`, etc.).
Object.defineProperty( MasonryGridElement.prototype, 'masonry', {
  get: function() { return this._masonry; },
});

if ( !customElements.get( 'masonry-grid' ) ) {
  customElements.define( 'masonry-grid', MasonryGridElement );
}

return MasonryGridElement;

}));
