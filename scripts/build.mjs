#!/usr/bin/env node
// scripts/build.mjs — masonry-pretext esbuild bundle.
//
// Replaces the dead Gulp 3 + RequireJS + UglifyJS pipeline (improvement
// 002). Produces `dist/masonry.pkgd.js` and `dist/masonry.pkgd.min.js` by
// bundling `masonry.js` and its CommonJS dependency tree.
//
// **No jQuery.** Improvement 006 removed `jquery-bridget` from devDeps,
// stripped it out of the bundle entry, and DCE-eliminated every `if (jQuery)`
// branch in `outlayer.js` / `fizzy-ui-utils.js`. Consumers who want
// `$('.grid').masonry()` syntax must migrate to `new Masonry('.grid', { … })`
// — the documented vanilla API. See improvements/006-remove-jquery.md.
//
// The bundle format is `iife` with `globalName: 'Masonry'`, so consumers can
// drop the file in via `<script>` and use `new Masonry(...)` exactly the way
// they did with upstream v4.2.2 (minus the jQuery shim). The CJS branch of
// each UMD wrapper in the dependency tree is what esbuild follows; the AMD
// and browser-global branches end up as dead code in the unminified output
// and are eliminated by the minifier.
//
// See FORK_ROADMAP.md § 2.1 and § 2.5.

import * as esbuild from 'esbuild';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// ─────────────────────────────────────────────────────────────────────────────
// Banner — preserve upstream's attribution + version
// ─────────────────────────────────────────────────────────────────────────────
const masonrySrc = await readFile(path.join(ROOT, 'masonry.js'), 'utf8');
const bannerMatch = masonrySrc.match(/^\s*\/\*[\s\S]*?\*\//);
if (!bannerMatch) {
  console.error('build: could not find banner comment in masonry.js');
  process.exit(1);
}
const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
const banner = bannerMatch[0]
  .replace(/Masonry v[\d.]+(?:-[\w.]+)?/, `Masonry PACKAGED v${pkg.version}`)
  .replace('https://masonry.desandro.com', 'https://github.com/oriolj/masonry-pretext');

// ─────────────────────────────────────────────────────────────────────────────
// Entries — virtual stdin so we don't need separate entry files in the repo.
// jquery-bridget was removed in improvement 006; entries are just the
// masonry source, with no jQuery shim.
//
// We ship three formats for three different consumer styles (#013, § 2.2):
//   • IIFE — `<script src="masonry.pkgd.min.js">` drop-in, exposes `Masonry`
//     as a top-level `var`. Two flavors (`pkgd.js` unminified, `pkgd.min.js`
//     minified) since browser users have no bundler to minify for them.
//   • CJS  — `require('masonry-pretext')` from Node / webpack 4 / older
//     toolchains. Emits `module.exports = factory(...)`.
//   • ESM  — `import Masonry from 'masonry-pretext'` from Vite / Rollup /
//     esbuild / webpack 5 / Node ESM. Emits `export default Masonry`.
//
// CJS/ESM are not pre-minified: consumers' bundlers minify the final output,
// so shipping a minified library bloats their source maps for no win.
// ─────────────────────────────────────────────────────────────────────────────
const cjsEntryContents = `
'use strict';
module.exports = require(${JSON.stringify(path.join(ROOT, 'masonry.js'))});
`;

const esmEntryContents = `
import Masonry from ${JSON.stringify(path.join(ROOT, 'masonry.js'))};
export default Masonry;
`;

// ─────────────────────────────────────────────────────────────────────────────
// Dep-file patches plugin (improvements 004 vendor-prefixes + 005 SSR + 006
// jQuery removal)
//
// Single plugin that applies build-time string transforms to the bundled
// dependency files. Each entry covers one file and lists the transforms
// applied to it. esbuild only allows one onLoad handler per file pattern,
// so all patches a given file needs live in one entry.
//
// All transforms are exact-string substitutions, NOT regex. If a pattern is
// not found the build aborts loudly — that guards against silent breakage
// if a dep is ever updated upstream (none have been since 2018, but defense
// in depth is cheap).
//
// Concerns currently covered:
//   - **vendor-prefix deletion (#004, § L.2a):** strip every reference to
//     `WebkitTransition` / `WebkitTransform` / `vendorProperties` /
//     `dashedVendorProperties` / `onwebkitTransitionEnd` / `toDashedAll`
//     from `outlayer/item.js`. transition + transform are unprefixed in
//     every browser at our chrome84/firefox86/safari15/edge84 baseline.
//   - **SSR safety (#005, § L.2b):** wrap UMD wrapper IIFE call sites with
//     `typeof window !== 'undefined' ? window : {}` so the bundle can be
//     loaded in a Node `vm` context with empty globals. Plus a
//     `typeof document === 'undefined'` short-circuit at the top of
//     `fizzy-ui-utils.docReady` (called at module load via
//     `Outlayer.create('masonry')` → `htmlInit` → `docReady`).
//   - **jQuery removal (#006, § 2.5):** delete every `if (jQuery) { … }`
//     branch in `outlayer.js` and `fizzy-ui-utils.js` directly. (An earlier
//     attempt used `const jQuery = false` + esbuild's minifier DCE; that
//     left dead `bridget` references in the minified output because esbuild
//     doesn't constant-propagate across function-property closures. Verified
//     by `test/visual/no-jquery.mjs`.)
//
// `ev-emitter` is already SSR-safe upstream (its source uses
// `typeof window != 'undefined' ? window : this`) and needs no patching.
// `masonry.js` is OUR source file and is patched directly — see the
// matching edit on line ~33 of `masonry.js`.
// ─────────────────────────────────────────────────────────────────────────────
const DEP_FILE_PATCHES = [
  {
    file: /node_modules[\\/]outlayer[\\/]item\.js$/,
    transforms: [
      // ── #004 — delete the vendor-prefix detection block + module-load
      //          DOM access. The `var docElemStyle = document.documentElement.style;`
      //          line is the first executable line of the file's body.
      {
        description: '[#004] delete vendor-prefix detection block',
        find: `var docElemStyle = document.documentElement.style;

var transitionProperty = typeof docElemStyle.transition == 'string' ?
  'transition' : 'WebkitTransition';
var transformProperty = typeof docElemStyle.transform == 'string' ?
  'transform' : 'WebkitTransform';

var transitionEndEvent = {
  WebkitTransition: 'webkitTransitionEnd',
  transition: 'transitionend'
}[ transitionProperty ];

// cache all vendor properties that could have vendor prefix
var vendorProperties = {
  transform: transformProperty,
  transition: transitionProperty,
  transitionDuration: transitionProperty + 'Duration',
  transitionProperty: transitionProperty + 'Property',
  transitionDelay: transitionProperty + 'Delay'
};`,
        replace: `// vendor-prefix detection deleted by masonry-pretext #004 (\u00a7 L.2)
// transition / transform unprefixed in every browser since 2014.
var transitionEndEvent = 'transitionend';`,
      },
      {
        description: '[#004] simplify proto.css — drop vendorProperties lookup',
        find: `  for ( var prop in style ) {
    // use vendor property if available
    var supportedProp = vendorProperties[ prop ] || prop;
    elemStyle[ supportedProp ] = style[ prop ];
  }`,
        replace: `  for ( var prop in style ) {
    elemStyle[ prop ] = style[ prop ];
  }`,
      },
      {
        description: '[#004] simplify transitionProps — drop toDashedAll helper',
        find: `// dash before all cap letters, including first for
// WebkitTransform => -webkit-transform
function toDashedAll( str ) {
  return str.replace( /([A-Z])/g, function( $1 ) {
    return '-' + $1.toLowerCase();
  });
}

var transitionProps = 'opacity,' + toDashedAll( transformProperty );`,
        replace: `var transitionProps = 'opacity,transform';`,
      },
      {
        description: '[#004] delete legacy onwebkitTransitionEnd / onotransitionend / dashedVendorProperties',
        find: `proto.onwebkitTransitionEnd = function( event ) {
  this.ontransitionend( event );
};

proto.onotransitionend = function( event ) {
  this.ontransitionend( event );
};

// properties that I munge to make my life easier
var dashedVendorProperties = {
  '-webkit-transform': 'transform'
};

`,
        replace: ``,
      },
      {
        description: '[#004] simplify ontransitionend — drop dashedVendorProperties lookup',
        find: `  // get property name of transitioned property, convert to prefix-free
  var propertyName = dashedVendorProperties[ event.propertyName ] || event.propertyName;`,
        replace: `  var propertyName = event.propertyName;`,
      },
      {
        description: '[#004] simplify proto.remove — drop transitionProperty truthy check',
        find: `proto.remove = function() {
  // just remove element if no transition support or no transition
  if ( !transitionProperty || !parseFloat( this.layout.options.transitionDuration ) ) {`,
        replace: `proto.remove = function() {
  // just remove element if no transition duration
  if ( !parseFloat( this.layout.options.transitionDuration ) ) {`,
      },
      {
        description: '[#005 SSR] outlayer/item.js UMD call site',
        find: `}( window, function factory( EvEmitter, getSize ) {`,
        replace: `}( typeof window !== 'undefined' ? window : {}, function factory( EvEmitter, getSize ) {`,
      },
      // ── #024 — delete Item.stagger + staggerDelay (item B continued) ────
      {
        description: '[#024] item.js — drop transitionDelay (staggerDelay) from css call',
        find: `  this.css({
    transitionProperty: transitionProps,
    transitionDuration: duration,
    transitionDelay: this.staggerDelay || 0
  });`,
        replace: `  this.css({
    transitionProperty: transitionProps,
    transitionDuration: duration
  });`,
      },
      {
        description: '[#024] item.js — delete proto.stagger',
        find: `// ----- stagger ----- //

proto.stagger = function( delay ) {
  delay = isNaN( delay ) ? 0 : delay;
  this.staggerDelay = delay + 'ms';
};

`,
        replace: ``,
      },
      // ── #028 — delete Item.hide / Item.reveal + simplify Item.remove ────
      {
        description: '[#028] item.js — simplify Item.remove (drop hide() transition path)',
        find: `proto.remove = function() {
  // just remove element if no transition duration
  if ( !parseFloat( this.layout.options.transitionDuration ) ) {
    this.removeElem();
    return;
  }

  // start transition
  this.once( 'transitionEnd', function() {
    this.removeElem();
  });
  this.hide();
};`,
        replace: `proto.remove = function() {
  this.removeElem();
};`,
      },
      {
        description: '[#028] item.js — delete proto.reveal + proto.hide + onRevealTransitionEnd + onHideTransitionEnd + getHideRevealTransitionEndProperty',
        find: `proto.reveal = function() {
  delete this.isHidden;
  // remove display: none
  this.css({ display: '' });

  var options = this.layout.options;

  var onTransitionEnd = {};
  var transitionEndProperty = this.getHideRevealTransitionEndProperty('visibleStyle');
  onTransitionEnd[ transitionEndProperty ] = this.onRevealTransitionEnd;

  this.transition({
    from: options.hiddenStyle,
    to: options.visibleStyle,
    isCleaning: true,
    onTransitionEnd: onTransitionEnd
  });
};

proto.onRevealTransitionEnd = function() {
  // check if still visible
  // during transition, item may have been hidden
  if ( !this.isHidden ) {
    this.emitEvent('reveal');
  }
};

/**
 * get style property use for hide/reveal transition end
 * @param {String} styleProperty - hiddenStyle/visibleStyle
 * @returns {String}
 */
proto.getHideRevealTransitionEndProperty = function( styleProperty ) {
  var optionStyle = this.layout.options[ styleProperty ];
  // use opacity
  if ( optionStyle.opacity ) {
    return 'opacity';
  }
  // get first property
  for ( var prop in optionStyle ) {
    return prop;
  }
};

proto.hide = function() {
  // set flag
  this.isHidden = true;
  // remove display: none
  this.css({ display: '' });

  var options = this.layout.options;

  var onTransitionEnd = {};
  var transitionEndProperty = this.getHideRevealTransitionEndProperty('hiddenStyle');
  onTransitionEnd[ transitionEndProperty ] = this.onHideTransitionEnd;

  this.transition({
    from: options.visibleStyle,
    to: options.hiddenStyle,
    // keep hidden stuff hidden
    isCleaning: true,
    onTransitionEnd: onTransitionEnd
  });
};

proto.onHideTransitionEnd = function() {
  // check if still hidden
  // during transition, item may have been un-hidden
  if ( this.isHidden ) {
    this.css({ display: 'none' });
    this.emitEvent('hide');
  }
};

`,
        replace: ``,
      },
    ],
  },
  {
    file: /node_modules[\\/]outlayer[\\/]outlayer\.js$/,
    transforms: [
      {
        description: '[#005 SSR] outlayer/outlayer.js UMD call site',
        find: `}( window, function factory( window, EvEmitter, getSize, utils, Item ) {`,
        replace: `}( typeof window !== 'undefined' ? window : {}, function factory( window, EvEmitter, getSize, utils, Item ) {`,
      },
      {
        description: '[#006 no-jquery] outlayer.js — delete `var jQuery = window.jQuery;`',
        find: `var jQuery = window.jQuery;
`,
        replace: ``,
      },
      {
        description: '[#006 no-jquery] outlayer.js — delete constructor `if (jQuery)` block',
        find: `  this.element = queryElement;
  // add jQuery
  if ( jQuery ) {
    this.$element = jQuery( this.element );
  }
`,
        replace: `  this.element = queryElement;
`,
      },
      {
        description: '[#006 no-jquery] outlayer.js — delete dispatchEvent `if (jQuery)` block',
        find: `  this.emitEvent( type, emitArgs );

  if ( jQuery ) {
    // set this.$element
    this.$element = this.$element || jQuery( this.element );
    if ( event ) {
      // create jQuery event
      var $event = jQuery.Event( event );
      $event.type = type;
      this.$element.trigger( $event, args );
    } else {
      // just trigger with type if no event available
      this.$element.trigger( type, args );
    }
  }
};`,
        replace: `  this.emitEvent( type, emitArgs );
};`,
      },
      {
        description: '[#006 no-jquery] outlayer.js — delete destroy `if (jQuery)` block',
        find: `  delete this.element.outlayerGUID;
  // remove data for jQuery
  if ( jQuery ) {
    jQuery.removeData( this.element, this.constructor.namespace );
  }

};`,
        replace: `  delete this.element.outlayerGUID;
};`,
      },
      {
        description: '[#006 no-jquery] outlayer.js — delete Outlayer.create `if (jQuery && jQuery.bridget)` block',
        find: `  utils.htmlInit( Layout, namespace );

  // -------------------------- jQuery bridge -------------------------- //

  // make into jQuery plugin
  if ( jQuery && jQuery.bridget ) {
    jQuery.bridget( namespace, Layout );
  }

  return Layout;`,
        replace: `  utils.htmlInit( Layout, namespace );

  return Layout;`,
      },
      // ── #023 — inline single-call helpers (item F) ─────────────────────────
      // `_filterFindItemElements` and `_getItemsForLayout` are each called
      // exactly once and each are a single trivial expression. Inlining them
      // at the call site saves the proto declaration + the method dispatch
      // overhead that the minifier can't fully optimize away.
      {
        description: '[#023] outlayer.js — inline _filterFindItemElements into _itemize',
        find: `proto._itemize = function( elems ) {

  var itemElems = this._filterFindItemElements( elems );
  var Item = this.constructor.Item;`,
        replace: `proto._itemize = function( elems ) {

  var itemElems = utils.filterFindElements( elems, this.options.itemSelector );
  var Item = this.constructor.Item;`,
      },
      {
        description: '[#023] outlayer.js — delete now-unused proto._filterFindItemElements',
        find: `/**
 * get item elements to be used in layout
 * @param {Array or NodeList or HTMLElement} elems
 * @returns {Array} items - item elements
 */
proto._filterFindItemElements = function( elems ) {
  return utils.filterFindElements( elems, this.options.itemSelector );
};

`,
        replace: ``,
      },
      {
        description: '[#023] outlayer.js — inline _getItemsForLayout into layoutItems',
        find: `proto.layoutItems = function( items, isInstant ) {
  items = this._getItemsForLayout( items );

  this._layoutItems( items, isInstant );

  this._postLayout();
};`,
        replace: `proto.layoutItems = function( items, isInstant ) {
  items = items.filter( function( item ) { return !item.isIgnored; });

  this._layoutItems( items, isInstant );

  this._postLayout();
};`,
      },
      {
        description: '[#023] outlayer.js — delete now-unused proto._getItemsForLayout',
        find: `/**
 * get the items to be laid out
 * you may want to skip over some items
 * @param {Array} items
 * @returns {Array} items
 */
proto._getItemsForLayout = function( items ) {
  return items.filter( function( item ) {
    return !item.isIgnored;
  });
};

`,
        replace: ``,
      },
      // ── #024 — delete stagger machinery (item B) ──────────────────────────
      // `options.stagger` is unused in masonry-pretext: it never gets set
      // by the visual fixtures, the Astro/Next.js examples, or any consumer.
      // The hide/reveal animation system that stagger feeds into is itself
      // slated for deletion in item A. Strip:
      //   - proto.updateStagger (the option-to-ms reader)
      //   - the `i` arg + stagger call in proto._positionItem
      //   - the stagger calls in proto.reveal / proto.hide
      //   - msUnits + getMilliseconds (only used by updateStagger)
      // Plus from item.js:
      //   - proto.stagger + the staggerDelay state
      //   - the transitionDelay line in css() that reads staggerDelay
      {
        description: '[#024] outlayer.js — delete proto.updateStagger',
        find: `// set stagger from option in milliseconds number
proto.updateStagger = function() {
  var stagger = this.options.stagger;
  if ( stagger === null || stagger === undefined ) {
    this.stagger = 0;
    return;
  }
  this.stagger = getMilliseconds( stagger );
  return this.stagger;
};

`,
        replace: ``,
      },
      {
        description: '[#024] outlayer.js — drop updateStagger call + stagger arg from _processLayoutQueue',
        find: `proto._processLayoutQueue = function( queue ) {
  this.updateStagger();
  queue.forEach( function( obj, i ) {
    this._positionItem( obj.item, obj.x, obj.y, obj.isInstant, i );
  }, this );
};`,
        replace: `proto._processLayoutQueue = function( queue ) {
  queue.forEach( function( obj ) {
    this._positionItem( obj.item, obj.x, obj.y, obj.isInstant );
  }, this );
};`,
      },
      {
        description: '[#024] outlayer.js — drop stagger arg + call from _positionItem definition',
        find: `proto._positionItem = function( item, x, y, isInstant, i ) {
  if ( isInstant ) {
    // if not transition, just set CSS
    item.goTo( x, y );
  } else {
    item.stagger( i * this.stagger );
    item.moveTo( x, y );
  }
};`,
        replace: `proto._positionItem = function( item, x, y, isInstant ) {
  if ( isInstant ) {
    item.goTo( x, y );
  } else {
    item.moveTo( x, y );
  }
};`,
      },
      {
        description: '[#024] outlayer.js — drop stagger from proto.reveal',
        find: `proto.reveal = function( items ) {
  this._emitCompleteOnItems( 'reveal', items );
  if ( !items || !items.length ) {
    return;
  }
  var stagger = this.updateStagger();
  items.forEach( function( item, i ) {
    item.stagger( i * stagger );
    item.reveal();
  });
};`,
        replace: `proto.reveal = function( items ) {
  this._emitCompleteOnItems( 'reveal', items );
  if ( !items || !items.length ) {
    return;
  }
  items.forEach( function( item ) {
    item.reveal();
  });
};`,
      },
      {
        description: '[#024] outlayer.js — drop stagger from proto.hide',
        find: `proto.hide = function( items ) {
  this._emitCompleteOnItems( 'hide', items );
  if ( !items || !items.length ) {
    return;
  }
  var stagger = this.updateStagger();
  items.forEach( function( item, i ) {
    item.stagger( i * stagger );
    item.hide();
  });
};`,
        replace: `proto.hide = function( items ) {
  this._emitCompleteOnItems( 'hide', items );
  if ( !items || !items.length ) {
    return;
  }
  items.forEach( function( item ) {
    item.hide();
  });
};`,
      },
      // ── #026 — WeakMap-keyed instance registry (item N) ─────────────────
      // Replace `var GUID + var instances = {} + element.outlayerGUID expando`
      // with a single module-level `WeakMap<Element, Outlayer>`. Eliminates:
      //   - the GUID counter + integer ID allocations
      //   - the `outlayerGUID` expando (potential leak if destroy not called)
      //   - the global `instances{}` object that leaks instance refs
      // The WeakMap automatically GCs entries when the container element is
      // collected, even without explicit destroy(). The alive-check pattern
      // (`self.element && self.element.outlayerGUID`) used in masonry.js for
      // post-#010 / #012 deferred callbacks shifts to a `_destroyed` boolean
      // set in destroy().
      {
        description: '[#026] outlayer.js — replace var GUID + instances{} with WeakMap',
        find: `// globally unique identifiers
var GUID = 0;
// internal store of all Outlayer intances
var instances = {};`,
        replace: `// internal store of all Outlayer instances, keyed by container element
var instances = new WeakMap();`,
      },
      {
        description: '[#026] outlayer.js — drop GUID expando from constructor',
        find: `  // add id for Outlayer.getFromElement
  var id = ++GUID;
  this.element.outlayerGUID = id; // expando
  instances[ id ] = this; // associate via id`,
        replace: `  // associate this instance with its container element via WeakMap (#026 / item N)
  instances.set( this.element, this );`,
      },
      {
        description: '[#026] outlayer.js — drop GUID delete + add _destroyed flag in destroy',
        find: `  var id = this.element.outlayerGUID;
  delete instances[ id ]; // remove reference to instance by id
  delete this.element.outlayerGUID;
};`,
        replace: `  instances.delete( this.element );
  this._destroyed = true;
};`,
      },
      {
        description: '[#026] outlayer.js — Outlayer.data via WeakMap',
        find: `Outlayer.data = function( elem ) {
  elem = utils.getQueryElement( elem );
  var id = elem && elem.outlayerGUID;
  return id && instances[ id ];
};`,
        replace: `Outlayer.data = function( elem ) {
  elem = utils.getQueryElement( elem );
  return elem && instances.get( elem );
};`,
      },
      // ── #030 — simplify _emitCompleteOnItems (item D) ───────────────────
      // Items emit `eventName` SYNCHRONOUSLY during `_processLayoutQueue`
      // (Item.layoutPosition fires `'layout'` after writing positions, with
      // or without transitions). The per-item `once()` aggregation is
      // therefore unnecessary — `_layoutItems` already runs synchronously
      // through the queue, so we can fire the aggregate `eventNameComplete`
      // event directly. Removing the once() machinery unblocks the
      // EvEmitter shim (which drops `proto.once`).
      {
        description: '[#030] outlayer.js — replace _emitCompleteOnItems with direct dispatch',
        find: `proto._emitCompleteOnItems = function( eventName, items ) {
  var _this = this;
  function onComplete() {
    _this.dispatchEvent( eventName + 'Complete', null, [ items ] );
  }

  var count = items.length;
  if ( !items || !count ) {
    onComplete();
    return;
  }

  var doneCount = 0;
  function tick() {
    doneCount++;
    if ( doneCount == count ) {
      onComplete();
    }
  }

  // bind callback
  items.forEach( function( item ) {
    item.once( eventName, tick );
  });
};`,
        replace: `proto._emitCompleteOnItems = function( eventName, items ) {
  this.dispatchEvent( eventName + 'Complete', null, [ items ] );
};`,
      },
      // ── #029 — delete Outlayer.create factory + subclass helper (item E) ─
      // masonry.js inlines the Outlayer subclass directly (#029 / item E),
      // so the factory + the subclass helper + the htmlInit auto-init are
      // dead code. Closes desandro/masonry#1104. Breaking for `data-masonry`
      // attribute users — they need to switch to imperative `new Masonry(...)`.
      {
        description: '[#029] outlayer.js — delete Outlayer.create factory',
        find: `/**
 * create a layout class
 * @param {String} namespace
 */
Outlayer.create = function( namespace, options ) {
  // sub-class Outlayer
  var Layout = subclass( Outlayer );
  // apply new options and compatOptions
  Layout.defaults = utils.extend( {}, Outlayer.defaults );
  utils.extend( Layout.defaults, options );
  Layout.compatOptions = utils.extend( {}, Outlayer.compatOptions  );

  Layout.namespace = namespace;

  Layout.data = Outlayer.data;

  // sub-class Item
  Layout.Item = subclass( Item );

  // -------------------------- declarative -------------------------- //

  utils.htmlInit( Layout, namespace );

  return Layout;
};

function subclass( Parent ) {
  function SubClass() {
    Parent.apply( this, arguments );
  }

  SubClass.prototype = Object.create( Parent.prototype );
  SubClass.prototype.constructor = SubClass;

  return SubClass;
}

`,
        replace: ``,
      },
      // ── #028 — delete hide/reveal animation system (item A) ─────────────
      // The fade-in/scale-up animation system from upstream's defaults
      // (`hiddenStyle: { opacity: 0, transform: 'scale(0.001)' }`,
      // `visibleStyle: { opacity: 1, transform: 'scale(1)' }`) is dead
      // weight in masonry-pretext: it relies on transitions, which the
      // SSR preset (#015) forces off, and on stagger, which #024 deleted.
      // Delete: defaults.hiddenStyle, defaults.visibleStyle, proto.reveal,
      // proto.hide, proto.revealItemElements, proto.hideItemElements,
      // the reveal calls in proto.appended and proto.prepended.
      // **Breaking change for plugin authors expecting fade-in animation.**
      {
        description: '[#028] outlayer.js — delete defaults.hiddenStyle + visibleStyle',
        find: `  // item options
  transitionDuration: '0.4s',
  hiddenStyle: {
    opacity: 0,
    transform: 'scale(0.001)'
  },
  visibleStyle: {
    opacity: 1,
    transform: 'scale(1)'
  }
};`,
        replace: `  // item options
  transitionDuration: '0.4s'
};`,
      },
      {
        description: '[#028] outlayer.js — drop reveal call from proto.appended',
        find: `proto.appended = function( elems ) {
  var items = this.addItems( elems );
  if ( !items.length ) {
    return;
  }
  // layout and reveal just the new items
  this.layoutItems( items, true );
  this.reveal( items );
};`,
        replace: `proto.appended = function( elems ) {
  var items = this.addItems( elems );
  if ( !items.length ) {
    return;
  }
  this.layoutItems( items, true );
};`,
      },
      {
        description: '[#028] outlayer.js — drop reveal call from proto.prepended',
        find: `  // start new layout
  this._resetLayout();
  this._manageStamps();
  // layout new stuff without transition
  this.layoutItems( items, true );
  this.reveal( items );
  // layout previous items
  this.layoutItems( previousItems );
};`,
        replace: `  this._resetLayout();
  this._manageStamps();
  this.layoutItems( items, true );
  this.layoutItems( previousItems );
};`,
      },
      {
        description: '[#028] outlayer.js — delete proto.reveal + proto.hide + proto.revealItemElements + proto.hideItemElements',
        find: `/**
 * reveal a collection of items
 * @param {Array of Outlayer.Items} items
 */
proto.reveal = function( items ) {
  this._emitCompleteOnItems( 'reveal', items );
  if ( !items || !items.length ) {
    return;
  }
  items.forEach( function( item ) {
    item.reveal();
  });
};

/**
 * hide a collection of items
 * @param {Array of Outlayer.Items} items
 */
proto.hide = function( items ) {
  this._emitCompleteOnItems( 'hide', items );
  if ( !items || !items.length ) {
    return;
  }
  items.forEach( function( item ) {
    item.hide();
  });
};

/**
 * reveal item elements
 * @param {Array}, {Element}, {NodeList} items
 */
proto.revealItemElements = function( elems ) {
  var items = this.getItems( elems );
  this.reveal( items );
};

/**
 * hide item elements
 * @param {Array}, {Element}, {NodeList} items
 */
proto.hideItemElements = function( elems ) {
  var items = this.getItems( elems );
  this.hide( items );
};

`,
        replace: ``,
      },
      {
        description: '[#024] outlayer.js — delete msUnits + getMilliseconds (only used by updateStagger)',
        find: `// ----- helpers ----- //

// how many milliseconds are in each unit
var msUnits = {
  ms: 1,
  s: 1000
};

// munge time-like parameter into millisecond number
// '0.4s' -> 40
function getMilliseconds( time ) {
  if ( typeof time == 'number' ) {
    return time;
  }
  var matches = time.match( /(^\\d*\\.?\\d*)(\\w*)/ );
  var num = matches && matches[1];
  var unit = matches && matches[2];
  if ( !num.length ) {
    return 0;
  }
  num = parseFloat( num );
  var mult = msUnits[ unit ] || 1;
  return num * mult;
}

`,
        replace: ``,
      },
    ],
  },
  // ── #027 / item O — get-size DEP_FILE_PATCHES are now obsolete ───────
  // The `getSizeShimPlugin` (registered in baseConfig.plugins) intercepts
  // the `get-size` resolution and replaces the entire ~200 LOC package with
  // a ~25 LOC inlined implementation. The transforms previously here for
  // #005 (SSR call site) and #007 (box-sizing setup deletion) no longer
  // apply because `node_modules/get-size/get-size.js` is never loaded.
  // Block intentionally left empty for the audit trail; remove the entry
  // from DEP_FILE_PATCHES if a future improvement deletes this file.
  {
    file: /node_modules[\\/]fizzy-ui-utils[\\/]utils\.js$/,
    transforms: [
      {
        description: '[#005 SSR] fizzy-ui-utils/utils.js UMD call site',
        find: `}( window, function factory( window, matchesSelector ) {`,
        replace: `}( typeof window !== 'undefined' ? window : {}, function factory( window, matchesSelector ) {`,
      },
      {
        description: '[#005 SSR] fizzy-ui-utils/utils.js docReady — guard against undefined document',
        find: `utils.docReady = function( callback ) {
  var readyState = document.readyState;`,
        replace: `utils.docReady = function( callback ) {
  if ( typeof document === 'undefined' ) return;
  var readyState = document.readyState;`,
      },
      // ── #022 — delete the setTimeout(0) docReady wrapper (§ L.6) ─────────
      // The wrapper was a flickity-specific workaround (metafizzy/flickity#441)
      // to defer auto-init by one task so other widgets had time to register.
      // masonry-pretext does not bundle flickity and the only docReady caller
      // is `htmlInit` (which is itself slated for deletion in item E). The
      // setTimeout wraps a synchronous callback in async noise that swallows
      // exceptions and adds a tick of latency. Deleted.
      {
        description: '[#022] fizzy-ui-utils.js docReady — drop the setTimeout(0) wrapper',
        find: `  if ( readyState == 'complete' || readyState == 'interactive' ) {
    // do async to allow for other scripts to run. metafizzy/flickity#441
    setTimeout( callback );
  } else {
    document.addEventListener( 'DOMContentLoaded', callback );
  }`,
        replace: `  if ( readyState == 'complete' || readyState == 'interactive' ) {
    callback();
  } else {
    document.addEventListener( 'DOMContentLoaded', callback );
  }`,
      },
      // ── #008 — delete fizzy-ui-utils methods unused by masonry/outlayer ────
      // Audit (greppped masonry.js + node_modules/outlayer/{outlayer,item}.js)
      // shows utils.modulo and utils.getParent are NEVER called from the
      // masonry consumption path. They're 7 LOC apiece. esbuild can't
      // tree-shake them because they're properties on a `utils` object — the
      // whole object is reachable, all properties stay. Delete them
      // explicitly via build-time transforms.
      {
        description: '[#008] fizzy-ui-utils.js — delete unused utils.modulo',
        find: `// ----- modulo ----- //

utils.modulo = function( num, div ) {
  return ( ( num % div ) + div ) % div;
};

`,
        replace: ``,
      },
      {
        description: '[#008] fizzy-ui-utils.js — delete unused utils.getParent',
        find: `// ----- getParent ----- //

utils.getParent = function( elem, selector ) {
  while ( elem.parentNode && elem != document.body ) {
    elem = elem.parentNode;
    if ( matchesSelector( elem, selector ) ) {
      return elem;
    }
  }
};

`,
        replace: ``,
      },
      // ── #029 — delete utils.htmlInit + utils.toDashed (item E) ─────────
      // htmlInit auto-initialized data-masonry attributes via docReady. The
      // factory that called it (Outlayer.create) is also deleted in #029,
      // so the only consumer of htmlInit is gone. toDashed is only used by
      // htmlInit. (Both prior #006 jQuery patches inside htmlInit become
      // dead code; this single patch deletes the whole function instead.)
      // utils.docReady remains because it has no other call sites in the
      // bundle but is exported as part of utils — leaving it lets future
      // improvements that need DOMContentLoaded reuse it.
      {
        description: '[#029] fizzy-ui-utils.js — delete utils.toDashed + utils.htmlInit',
        find: `// ----- htmlInit ----- //

// http://jamesroberts.name/blog/2010/02/22/string-functions-for-javascript-trim-to-camel-case-to-dashed-and-to-underscore/
utils.toDashed = function( str ) {
  return str.replace( /(.)([A-Z])/g, function( match, $1, $2 ) {
    return $1 + '-' + $2;
  }).toLowerCase();
};

var console = window.console;
/**
 * allow user to initialize classes via [data-namespace] or .js-namespace class
 * htmlInit( Widget, 'widgetName' )
 * options are parsed from data-namespace-options
 */
utils.htmlInit = function( WidgetClass, namespace ) {
  utils.docReady( function() {
    var dashedNamespace = utils.toDashed( namespace );
    var dataAttr = 'data-' + dashedNamespace;
    var dataAttrElems = document.querySelectorAll( '[' + dataAttr + ']' );
    var jsDashElems = document.querySelectorAll( '.js-' + dashedNamespace );
    var elems = utils.makeArray( dataAttrElems )
      .concat( utils.makeArray( jsDashElems ) );
    var dataOptionsAttr = dataAttr + '-options';
    var jQuery = window.jQuery;

    elems.forEach( function( elem ) {
      var attr = elem.getAttribute( dataAttr ) ||
        elem.getAttribute( dataOptionsAttr );
      var options;
      try {
        options = attr && JSON.parse( attr );
      } catch ( error ) {
        // log error, do not initialize
        if ( console ) {
          console.error( 'Error parsing ' + dataAttr + ' on ' + elem.className +
          ': ' + error );
        }
        return;
      }
      // initialize
      var instance = new WidgetClass( elem, options );
      // make available via $().data('namespace')
      if ( jQuery ) {
        jQuery.data( elem, namespace, instance );
      }
    });

  });
};
`,
        replace: ``,
      },
    ],
  },
];

const depFilePatchesPlugin = {
  name: 'dep-file-patches',
  setup(build) {
    for (const { file, transforms } of DEP_FILE_PATCHES) {
      build.onLoad({ filter: file }, async (args) => {
        let src = await readFile(args.path, 'utf8');
        for (const { description, find, replace } of transforms) {
          const before = src;
          src = src.replace(find, replace);
          if (src === before) {
            throw new Error(
              `dep-file-patches: pattern not found for "${description}" in ${args.path}.`,
            );
          }
        }
        return { contents: src, loader: 'js' };
      });
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// matchesSelector shim plugin (improvement 003 / roadmap § L.1)
//
// `desandro-matches-selector` is a 50-line polyfill that walks
// `webkitMatchesSelector` / `mozMatchesSelector` / `msMatchesSelector` /
// `oMatchesSelector` looking for a usable method on Element.prototype. This
// is dead code in 2026 — `Element.matches` has been unprefixed in every
// browser since 2014 (Chrome 34, Firefox 34, Safari 7.1) and is universally
// available at our target baseline (chrome84 / firefox86 / safari15 /
// edge84). Replace the entire dep with a one-line shim that calls the
// native method directly.
//
// Why a build-time shim instead of editing node_modules: I can't delete code
// inside `node_modules/desandro-matches-selector/` without forking the
// package. The shim is functionally equivalent (same `(elem, selector) =>
// boolean` signature) and gets bundled in place of the real module.
// ─────────────────────────────────────────────────────────────────────────────
const matchesSelectorShimPlugin = {
  name: 'matches-selector-shim',
  setup(build) {
    build.onResolve({ filter: /^desandro-matches-selector$/ }, () => ({
      path: 'matches-selector-shim',
      namespace: 'matches-selector-shim',
    }));
    build.onLoad({ filter: /.*/, namespace: 'matches-selector-shim' }, () => ({
      contents: 'module.exports = function(elem, selector) { return elem.matches(selector); };',
      loader: 'js',
    }));
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// `ev-emitter` shim plugin (improvement #030 / item D)
//
// Replace the bundled `desandro/ev-emitter` package with a ~30 LOC inlined
// version. The original is ~110 LOC and includes:
//   - proto.on (the only frequently-used method)
//   - proto.off (used by users + internally)
//   - proto.once (unused after #028 deleted Item.remove's transition path
//                 and #024 deleted stagger's reveal/hide aggregation)
//   - proto.allOff (unused anywhere in the bundle)
//   - proto.emitEvent (with `_onceEvents` cleanup branches)
//   - the `_onceEvents` storage tracking that proto.once + proto.emitEvent
//     coordinate through
//
// The shim keeps `on` / `off` / `emitEvent` (which masonry's public event
// API needs) and drops the `once` machinery. Also drops the `_onceEvents`
// removal branches inside `emitEvent` so the loop is straight-line.
// ─────────────────────────────────────────────────────────────────────────────
const evEmitterShimContents = `
'use strict';
function EvEmitter() {}
var proto = EvEmitter.prototype;
proto.on = function( eventName, listener ) {
  if ( !eventName || !listener ) return;
  var events = this._events = this._events || {};
  var listeners = events[ eventName ] = events[ eventName ] || [];
  if ( listeners.indexOf( listener ) == -1 ) listeners.push( listener );
  return this;
};
proto.off = function( eventName, listener ) {
  var listeners = this._events && this._events[ eventName ];
  if ( !listeners || !listeners.length ) return;
  var index = listeners.indexOf( listener );
  if ( index != -1 ) listeners.splice( index, 1 );
  return this;
};
proto.emitEvent = function( eventName, args ) {
  var listeners = this._events && this._events[ eventName ];
  if ( !listeners || !listeners.length ) return;
  // copy to avoid interference if .off() in listener
  listeners = listeners.slice( 0 );
  args = args || [];
  for ( var i = 0; i < listeners.length; i++ ) {
    listeners[ i ].apply( this, args );
  }
  return this;
};
module.exports = EvEmitter;
`;

const evEmitterShimPlugin = {
  name: 'ev-emitter-shim',
  setup(build) {
    build.onResolve({ filter: /^ev-emitter$/ }, () => ({
      path: 'ev-emitter-shim',
      namespace: 'ev-emitter-shim',
    }));
    build.onLoad({ filter: /.*/, namespace: 'ev-emitter-shim' }, () => ({
      contents: evEmitterShimContents,
      loader: 'js',
    }));
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// `get-size` shim plugin (improvement #027 / item O)
//
// Replace the bundled `desandro/get-size` package with a much smaller
// inlined implementation. The original is ~200 LOC and includes:
//   - a setup() probe to detect IE11/Firefox-<29 box-sizing quirks (#007
//     already deleted that)
//   - a `getStyleSize()` helper that explicitly rejects percent strings
//   - a 14-property box-model extraction loop
//   - a getZeroSize() builder for hidden elements
//   - getStyle() with a Firefox bug workaround
//
// At our browser baseline (chrome 84+ / firefox 86+ / safari 15+ / edge 84+):
//   - `offsetWidth/offsetHeight` return the visual box dimensions (including
//     padding + border, regardless of box-sizing). NO probe needed.
//   - `getComputedStyle` returns resolved px values for all numeric props.
//
// The shim returns the same object shape masonry/outlayer consumes
// (`width/height/innerWidth/innerHeight/outerWidth/outerHeight` plus the
// 12 padding/margin/border properties used by `_getBoundingRect` and
// `_setContainerMeasure`). String selectors are still resolved via
// `document.querySelector` for backward compat with `_getMeasurement`.
//
// Drops one runtime dependency (`get-size`) — masonry-pretext now has
// a single runtime dep (`outlayer`).
// ─────────────────────────────────────────────────────────────────────────────
const getSizeShimContents = `
'use strict';
var GS_PROPS = ['paddingLeft','paddingRight','paddingTop','paddingBottom',
  'marginLeft','marginRight','marginTop','marginBottom',
  'borderLeftWidth','borderRightWidth','borderTopWidth','borderBottomWidth'];

function getSize( elem ) {
  if ( typeof elem == 'string' ) elem = document.querySelector( elem );
  if ( !elem || typeof elem != 'object' || !elem.nodeType ) return;
  var style = getComputedStyle( elem );
  var size, i;
  if ( style.display == 'none' ) {
    size = { width: 0, height: 0, innerWidth: 0, innerHeight: 0, outerWidth: 0, outerHeight: 0 };
    for ( i = 0; i < 12; i++ ) size[ GS_PROPS[i] ] = 0;
    return size;
  }
  size = { width: elem.offsetWidth, height: elem.offsetHeight };
  for ( i = 0; i < 12; i++ ) {
    size[ GS_PROPS[i] ] = parseFloat( style[ GS_PROPS[i] ] ) || 0;
  }
  size.innerWidth = size.width - size.paddingLeft - size.paddingRight - size.borderLeftWidth - size.borderRightWidth;
  size.innerHeight = size.height - size.paddingTop - size.paddingBottom - size.borderTopWidth - size.borderBottomWidth;
  size.outerWidth = size.width + size.marginLeft + size.marginRight;
  size.outerHeight = size.height + size.marginTop + size.marginBottom;
  return size;
}

module.exports = getSize;
`;

const getSizeShimPlugin = {
  name: 'get-size-shim',
  setup(build) {
    build.onResolve({ filter: /^get-size$/ }, () => ({
      path: 'get-size-shim',
      namespace: 'get-size-shim',
    }));
    build.onLoad({ filter: /.*/, namespace: 'get-size-shim' }, () => ({
      contents: getSizeShimContents,
      loader: 'js',
    }));
  },
};

// Base config shared by every output format. Format-specific bits
// (`format`, `globalName`, `stdin`, `outfile`, `minify`) are layered on top.
const baseConfig = {
  bundle: true,
  platform: 'browser',
  // Browser support baseline per FORK_ROADMAP.md "Browser support cuts".
  // The CJS/ESM bundles also load fine in Node ≥ 18 because every UMD-wrapper
  // dep is patched for SSR safety in DEP_FILE_PATCHES (#005).
  target: ['chrome84', 'firefox86', 'safari15', 'edge84'],
  banner: { js: banner },
  legalComments: 'inline',
  logLevel: 'info',
  plugins: [matchesSelectorShimPlugin, getSizeShimPlugin, evEmitterShimPlugin, depFilePatchesPlugin],
};

const iifeSharedConfig = {
  ...baseConfig,
  stdin: {
    contents: cjsEntryContents,
    resolveDir: ROOT,
    sourcefile: 'masonry-pkgd-entry.cjs',
    loader: 'js',
  },
  format: 'iife',
  globalName: 'Masonry',
};

const cjsConfig = {
  ...baseConfig,
  stdin: {
    contents: cjsEntryContents,
    resolveDir: ROOT,
    sourcefile: 'masonry-cjs-entry.cjs',
    loader: 'js',
  },
  format: 'cjs',
  outfile: path.join(DIST, 'masonry.cjs'),
  // Bundlers minify for the consumer; shipping a minified library inflates
  // their source maps without changing what the user actually downloads.
  minify: false,
};

const esmConfig = {
  ...baseConfig,
  stdin: {
    contents: esmEntryContents,
    resolveDir: ROOT,
    sourcefile: 'masonry-esm-entry.mjs',
    loader: 'js',
  },
  format: 'esm',
  outfile: path.join(DIST, 'masonry.mjs'),
  minify: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// Run unminified + minified builds in parallel. esbuild's `logLevel: 'info'`
// already prints warnings inline, so we don't post-process them here.
// ─────────────────────────────────────────────────────────────────────────────
await mkdir(DIST, { recursive: true });

const t0 = performance.now();

await Promise.all([
  esbuild.build({
    ...iifeSharedConfig,
    outfile: path.join(DIST, 'masonry.pkgd.js'),
    minify: false,
  }),
  esbuild.build({
    ...iifeSharedConfig,
    outfile: path.join(DIST, 'masonry.pkgd.min.js'),
    minify: true,
  }),
  esbuild.build(cjsConfig),
  esbuild.build(esmConfig),
]);

const elapsed = performance.now() - t0;
const sizes = await Promise.all(
  [
    'masonry.pkgd.js',
    'masonry.pkgd.min.js',
    'masonry.cjs',
    'masonry.mjs',
  ].map(async (name) => [name, (await stat(path.join(DIST, name))).size]),
);

console.log('');
console.log(`built in ${elapsed.toFixed(1)}ms`);
for (const [name, size] of sizes) {
  console.log(`  dist/${name.padEnd(18)} ${size.toString().padStart(7)} B`);
}
