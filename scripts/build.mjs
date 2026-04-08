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
// Entry — virtual stdin so we don't need a separate entry file in the repo.
// jquery-bridget was removed in improvement 006; the entry is now just the
// masonry source, with no jQuery shim.
// ─────────────────────────────────────────────────────────────────────────────
const entryContents = `
'use strict';
module.exports = require(${JSON.stringify(path.join(ROOT, 'masonry.js'))});
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
    ],
  },
  {
    file: /node_modules[\\/]get-size[\\/]get-size\.js$/,
    transforms: [
      {
        description: '[#005 SSR] get-size/get-size.js UMD call site',
        find: `})( window, function factory() {`,
        replace: `})( typeof window !== 'undefined' ? window : {}, function factory() {`,
      },
      // ── #007 — delete the IE11/Firefox<29 box-sizing detection ────────────
      // get-size has a one-time setup() that creates a probe div, mounts it,
      // measures it, and removes it on the first call to getSize() — solely
      // to detect a quirk where IE11 and Firefox<29 returned the *inner*
      // width on `style.width` for border-box elements while modern browsers
      // return the outer width. At our browser baseline (chrome84 /
      // firefox86 / safari15 / edge84) the modern behavior is universal, so
      // `isBoxSizeOuter` is always true. Delete the setup machinery + the
      // call site, then collapse `isBorderBoxSizeOuter = isBorderBox &&
      // isBoxSizeOuter` into just `isBorderBox`.
      //
      // Side benefit: eliminates one forced-reflow round-trip on the first
      // getSize() call (`appendChild` → `getComputedStyle` → `removeChild`).
      {
        description: '[#007] delete get-size setup() function + isSetup/isBoxSizeOuter state',
        find: `// -------------------------- setup -------------------------- //

var isSetup = false;

var isBoxSizeOuter;

/**
 * setup
 * check isBoxSizerOuter
 * do on first getSize() rather than on page load for Firefox bug
 */
function setup() {
  // setup once
  if ( isSetup ) {
    return;
  }
  isSetup = true;

  // -------------------------- box sizing -------------------------- //

  /**
   * Chrome & Safari measure the outer-width on style.width on border-box elems
   * IE11 & Firefox<29 measures the inner-width
   */
  var div = document.createElement('div');
  div.style.width = '200px';
  div.style.padding = '1px 2px 3px 4px';
  div.style.borderStyle = 'solid';
  div.style.borderWidth = '1px 2px 3px 4px';
  div.style.boxSizing = 'border-box';

  var body = document.body || document.documentElement;
  body.appendChild( div );
  var style = getStyle( div );
  // round value for browser zoom. desandro/masonry#928
  isBoxSizeOuter = Math.round( getStyleSize( style.width ) ) == 200;
  getSize.isBoxSizeOuter = isBoxSizeOuter;

  body.removeChild( div );
}

`,
        replace: `// box-sizing setup() deleted by masonry-pretext #007 (\u00a7 L.3)
// IE11 / Firefox<29 quirk; modern browsers always return outer width on
// style.width for border-box elements.

`,
      },
      {
        description: '[#007] delete `setup();` call from inside getSize()',
        find: `function getSize( elem ) {
  setup();

  // use querySeletor if elem is string`,
        replace: `function getSize( elem ) {
  // use querySeletor if elem is string`,
      },
      {
        description: '[#007] inline isBorderBoxSizeOuter (always equals isBorderBox at our browser baseline)',
        find: `  var isBorderBoxSizeOuter = isBorderBox && isBoxSizeOuter;

  // overwrite width and height if we can get it from style
  var styleWidth = getStyleSize( style.width );
  if ( styleWidth !== false ) {
    size.width = styleWidth +
      // add padding and border unless it's already including it
      ( isBorderBoxSizeOuter ? 0 : paddingWidth + borderWidth );
  }

  var styleHeight = getStyleSize( style.height );
  if ( styleHeight !== false ) {
    size.height = styleHeight +
      // add padding and border unless it's already including it
      ( isBorderBoxSizeOuter ? 0 : paddingHeight + borderHeight );
  }`,
        replace: `  // overwrite width and height if we can get it from style
  var styleWidth = getStyleSize( style.width );
  if ( styleWidth !== false ) {
    size.width = styleWidth +
      // add padding and border unless it's already including it
      ( isBorderBox ? 0 : paddingWidth + borderWidth );
  }

  var styleHeight = getStyleSize( style.height );
  if ( styleHeight !== false ) {
    size.height = styleHeight +
      // add padding and border unless it's already including it
      ( isBorderBox ? 0 : paddingHeight + borderHeight );
  }`,
      },
    ],
  },
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
      {
        description: '[#006 no-jquery] fizzy-ui-utils.js htmlInit — delete `var jQuery = window.jQuery;`',
        find: `    var dataOptionsAttr = dataAttr + '-options';
    var jQuery = window.jQuery;
`,
        replace: `    var dataOptionsAttr = dataAttr + '-options';
`,
      },
      {
        description: '[#006 no-jquery] fizzy-ui-utils.js htmlInit — delete `if (jQuery)` block (the $.data call)',
        find: `      // initialize
      var instance = new WidgetClass( elem, options );
      // make available via $().data('namespace')
      if ( jQuery ) {
        jQuery.data( elem, namespace, instance );
      }
    });`,
        replace: `      // initialize
      new WidgetClass( elem, options );
    });`,
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

const sharedConfig = {
  stdin: {
    contents: entryContents,
    resolveDir: ROOT,
    sourcefile: 'masonry-pkgd-entry.cjs',
    loader: 'js',
  },
  bundle: true,
  format: 'iife',
  globalName: 'Masonry',
  platform: 'browser',
  // Browser support baseline per FORK_ROADMAP.md "Browser support cuts".
  target: ['chrome84', 'firefox86', 'safari15', 'edge84'],
  banner: { js: banner },
  legalComments: 'inline',
  logLevel: 'info',
  plugins: [matchesSelectorShimPlugin, depFilePatchesPlugin],
};

// ─────────────────────────────────────────────────────────────────────────────
// Run unminified + minified builds in parallel. esbuild's `logLevel: 'info'`
// already prints warnings inline, so we don't post-process them here.
// ─────────────────────────────────────────────────────────────────────────────
await mkdir(DIST, { recursive: true });

const t0 = performance.now();

await Promise.all([
  esbuild.build({
    ...sharedConfig,
    outfile: path.join(DIST, 'masonry.pkgd.js'),
    minify: false,
  }),
  esbuild.build({
    ...sharedConfig,
    outfile: path.join(DIST, 'masonry.pkgd.min.js'),
    minify: true,
  }),
]);

const elapsed = performance.now() - t0;
const pkgdSize = (await stat(path.join(DIST, 'masonry.pkgd.js'))).size;
const minSize = (await stat(path.join(DIST, 'masonry.pkgd.min.js'))).size;

console.log('');
console.log(`built in ${elapsed.toFixed(1)}ms`);
console.log(`  dist/masonry.pkgd.js      ${pkgdSize.toString().padStart(7)} B`);
console.log(`  dist/masonry.pkgd.min.js  ${minSize.toString().padStart(7)} B`);
