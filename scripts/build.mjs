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
// outlayer/item.js modern-browser transform (improvement 004 / roadmap § L.2)
//
// Strips the vendor-prefix detection block + every site that uses it from
// `node_modules/outlayer/item.js`. This is dead code in 2026 — `transition`
// and `transform` have been unprefixed in every browser since 2014, and the
// browser support baseline (chrome84/firefox86/safari15/edge84) is well past
// the point where vendor-prefix variants matter. The deleted code includes:
//
//   - `var docElemStyle = document.documentElement.style;` (the **first** line
//     of the file's executable body — this is what blocks SSR `import`s of
//     the bundled module by accessing `document` at module load. Removing it
//     is necessary but NOT sufficient for SSR — the bundled IIFE still
//     accesses `window.jQuery` from outlayer.js elsewhere; see roadmap § 2.2
//     for the full fix.)
//   - The `transitionProperty` / `transformProperty` / `vendorProperties` /
//     `dashedVendorProperties` lookup tables.
//   - The `onwebkitTransitionEnd` / `onotransitionend` legacy event handlers.
//   - The `toDashedAll` helper that camelCased `WebkitTransform` to `-webkit-transform`.
//   - Every consumer site (the `css` method, `enableTransition`,
//     `ontransitionend`, `proto.remove`).
//
// All transformations are exact-string substitutions, NOT regex. If any
// substitution fails to find its target the build aborts loudly — that
// guards against silent breakage if `outlayer` is ever updated upstream
// (which it hasn't been since 2018, but defense in depth is cheap).
// ─────────────────────────────────────────────────────────────────────────────
const OUTLAYER_ITEM_TRANSFORMS = [
  // ── 1. Delete the vendor-prefix detection block + module-load DOM access ──
  {
    description: 'delete vendor-prefix detection block',
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

  // ── 2. Simplify css() — drop vendorProperties lookup ──────────────────────
  {
    description: 'simplify proto.css — drop vendorProperties lookup',
    find: `  for ( var prop in style ) {
    // use vendor property if available
    var supportedProp = vendorProperties[ prop ] || prop;
    elemStyle[ supportedProp ] = style[ prop ];
  }`,
    replace: `  for ( var prop in style ) {
    elemStyle[ prop ] = style[ prop ];
  }`,
  },

  // ── 3. Simplify transitionProps — drop toDashedAll helper ─────────────────
  {
    description: 'simplify transitionProps — drop toDashedAll helper',
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

  // ── 4. Delete the onwebkit / onotransitionend handlers + dashedVendorProps ─
  {
    description: 'delete legacy onwebkitTransitionEnd / onotransitionend / dashedVendorProperties',
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

  // ── 5. Simplify ontransitionend property normalization ────────────────────
  {
    description: 'simplify ontransitionend — drop dashedVendorProperties lookup',
    find: `  // get property name of transitioned property, convert to prefix-free
  var propertyName = dashedVendorProperties[ event.propertyName ] || event.propertyName;`,
    replace: `  var propertyName = event.propertyName;`,
  },

  // ── 6. Simplify proto.remove — drop transitionProperty truthy check ───────
  {
    description: 'simplify proto.remove — drop transitionProperty truthy check',
    find: `proto.remove = function() {
  // just remove element if no transition support or no transition
  if ( !transitionProperty || !parseFloat( this.layout.options.transitionDuration ) ) {`,
    replace: `proto.remove = function() {
  // just remove element if no transition duration
  if ( !parseFloat( this.layout.options.transitionDuration ) ) {`,
  },

  // ── 7. SSR guard for the UMD call site (improvement 005 / § L.2b) ────────
  // The IIFE invocation passes \`window\` as a free variable, which throws
  // ReferenceError when the bundle is loaded in a Node \`vm\` context.
  // Wrap with a typeof guard so SSR-importing the bundle no longer crashes.
  // The factory body parameter \`window\` then becomes \`{}\` in Node, and the
  // \`window.console\` / \`window.jQuery\` reads inside become \`undefined\` —
  // both of which are handled by existing falsy checks.
  {
    description: '[SSR] guard outlayer/item.js UMD call site',
    find: `}( window, function factory( EvEmitter, getSize ) {`,
    replace: `}( typeof window !== 'undefined' ? window : {}, function factory( EvEmitter, getSize ) {`,
  },
];

const outlayerItemModernPlugin = {
  name: 'outlayer-item-modern',
  setup(build) {
    build.onLoad({ filter: /outlayer[\\/]item\.js$/ }, async (args) => {
      let src = await readFile(args.path, 'utf8');
      for (const { description, find, replace } of OUTLAYER_ITEM_TRANSFORMS) {
        const before = src;
        src = src.replace(find, replace);
        if (src === before) {
          throw new Error(
            `outlayer-item-modern: pattern not found for "${description}" ` +
            `in ${args.path}. The outlayer/item.js source may have changed; ` +
            `re-derive the transform list and update scripts/build.mjs.`,
          );
        }
      }
      return { contents: src, loader: 'js' };
    });
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// SSR DOM guard plugin (improvement 005 / roadmap § L.2b)
//
// Two classes of patch make the bundled file safe to load in a Node SSR
// context (Next.js, Nuxt, SvelteKit, etc.):
//
//   1. **UMD wrapper guards.** Each dependency's UMD wrapper invokes its
//      factory with a bare \`window\` reference, which throws ReferenceError
//      in Node. Wrap with \`typeof window !== 'undefined' ? window : {}\` so
//      Node gets an empty object instead.
//
//   2. **utils.docReady guard.** masonry.js's factory body calls
//      \`Outlayer.create('masonry')\` at module load. \`Outlayer.create\`
//      transitively calls \`utils.htmlInit\` → \`utils.docReady\` →
//      \`document.readyState\`, which throws when document is undefined. Add
//      a \`typeof document === 'undefined'\` short-circuit to docReady.
//
// outlayer/item.js's UMD guard goes through the existing
// \`outlayerItemPatchPlugin\` (transform #7) — esbuild only allows one
// onLoad per file pattern, so the two plugins must not overlap.
//
// ev-emitter is already SSR-safe (its source uses \`typeof window !=
// 'undefined' ? window : this\`) and doesn't need patching.
//
// masonry.js is OUR source file and is patched directly (not via this
// plugin) — see the matching edit on line ~33 of masonry.js.
//
// Verified by test/visual/ssr-smoke.mjs which loads the bundle in a Node
// vm context with empty globals.
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Dep-file patches plugin (improvements 005 SSR + 006 jQuery removal)
//
// Single plugin that applies build-time string transforms to the bundled
// dependency files. Each entry covers one file and lists the transforms
// applied to it. esbuild only allows one onLoad handler per file pattern,
// so all the patches a given file needs must live in one entry.
//
// Concerns currently covered:
//   - **SSR safety (#005, § L.2b):** wrap UMD wrapper IIFE call sites with
//     `typeof window !== 'undefined' ? window : {}` so the bundle can be
//     loaded in a Node `vm` context with empty globals (verified by
//     test/visual/ssr-smoke.mjs).
//   - **docReady guard (#005, § L.2b):** add a `typeof document === 'undefined'`
//     short-circuit to fizzy-ui-utils.docReady, called at module load via
//     Outlayer.create('masonry') → htmlInit → docReady.
//   - **jQuery removal (#006, § 2.5):** replace `var jQuery = window.jQuery`
//     with `var jQuery = false` in outlayer.js and fizzy-ui-utils.js so
//     esbuild's minifier DCE-eliminates every `if (jQuery)` branch (the
//     dispatchEvent jQuery event firing, the destroy `removeData` call, the
//     Outlayer.create bridget call, the htmlInit `$.data` call). With
//     jquery-bridget no longer bundled, these branches can never run anyway.
//
// outlayer/item.js's transforms live in `outlayerItemModernPlugin` instead
// (it has 7 transforms covering vendor-prefix deletion + the SSR guard).
// ev-emitter is already SSR-safe upstream and needs no patching.
// ─────────────────────────────────────────────────────────────────────────────
const DEP_FILE_PATCHES = [
  {
    file: /node_modules[\\/]outlayer[\\/]outlayer\.js$/,
    transforms: [
      {
        description: '[SSR] outlayer/outlayer.js UMD call site',
        find: `}( window, function factory( window, EvEmitter, getSize, utils, Item ) {`,
        replace: `}( typeof window !== 'undefined' ? window : {}, function factory( window, EvEmitter, getSize, utils, Item ) {`,
      },
      // ── jQuery removal (#006, § 2.5) — direct branch deletion ──────────────
      // Could not rely on `var jQuery = false` + esbuild constant folding —
      // the minifier doesn't propagate the constant across function-property
      // closures (`Outlayer.create`, `proto.dispatchEvent`, etc.). The fix is
      // to delete each `if (jQuery) { … }` block explicitly. Each transform
      // is an exact-string substitution that aborts the build if the pattern
      // is no longer present.
      {
        description: '[no-jquery] outlayer.js — delete `var jQuery = window.jQuery;`',
        find: `var jQuery = window.jQuery;
`,
        replace: ``,
      },
      {
        description: '[no-jquery] outlayer.js — delete constructor `if (jQuery)` block',
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
        description: '[no-jquery] outlayer.js — delete dispatchEvent `if (jQuery)` block',
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
        description: '[no-jquery] outlayer.js — delete destroy `if (jQuery)` block',
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
        description: '[no-jquery] outlayer.js — delete Outlayer.create `if (jQuery && jQuery.bridget)` block',
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
        description: '[SSR] get-size/get-size.js UMD call site',
        find: `})( window, function factory() {`,
        replace: `})( typeof window !== 'undefined' ? window : {}, function factory() {`,
      },
    ],
  },
  {
    file: /node_modules[\\/]fizzy-ui-utils[\\/]utils\.js$/,
    transforms: [
      {
        description: '[SSR] fizzy-ui-utils/utils.js UMD call site',
        find: `}( window, function factory( window, matchesSelector ) {`,
        replace: `}( typeof window !== 'undefined' ? window : {}, function factory( window, matchesSelector ) {`,
      },
      {
        description: '[SSR] fizzy-ui-utils/utils.js docReady — guard against undefined document',
        find: `utils.docReady = function( callback ) {
  var readyState = document.readyState;`,
        replace: `utils.docReady = function( callback ) {
  if ( typeof document === 'undefined' ) return;
  var readyState = document.readyState;`,
      },
      {
        description: '[no-jquery] fizzy-ui-utils.js htmlInit — delete `var jQuery = window.jQuery;`',
        find: `    var dataOptionsAttr = dataAttr + '-options';
    var jQuery = window.jQuery;
`,
        replace: `    var dataOptionsAttr = dataAttr + '-options';
`,
      },
      {
        description: '[no-jquery] fizzy-ui-utils.js htmlInit — delete `if (jQuery)` block (the $.data call)',
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
  plugins: [matchesSelectorShimPlugin, outlayerItemModernPlugin, depFilePatchesPlugin],
};

// ─────────────────────────────────────────────────────────────────────────────
// Run two builds: unminified + minified.
// ─────────────────────────────────────────────────────────────────────────────
await mkdir(DIST, { recursive: true });

const t0 = performance.now();

const unminified = await esbuild.build({
  ...sharedConfig,
  outfile: path.join(DIST, 'masonry.pkgd.js'),
  minify: false,
});

const minified = await esbuild.build({
  ...sharedConfig,
  outfile: path.join(DIST, 'masonry.pkgd.min.js'),
  minify: true,
});

const elapsed = performance.now() - t0;

// ─────────────────────────────────────────────────────────────────────────────
// Report
// ─────────────────────────────────────────────────────────────────────────────
const pkgdSize = (await stat(path.join(DIST, 'masonry.pkgd.js'))).size;
const minSize = (await stat(path.join(DIST, 'masonry.pkgd.min.js'))).size;

console.log('');
console.log(`built in ${elapsed.toFixed(1)}ms`);
console.log(`  dist/masonry.pkgd.js      ${pkgdSize.toString().padStart(7)} B`);
console.log(`  dist/masonry.pkgd.min.js  ${minSize.toString().padStart(7)} B`);

if (unminified.warnings.length || minified.warnings.length) {
  console.log('');
  console.log('warnings:');
  for (const w of [...unminified.warnings, ...minified.warnings]) {
    console.log(`  ${w.text}`);
  }
}
