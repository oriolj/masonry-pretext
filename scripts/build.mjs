#!/usr/bin/env node
// scripts/build.mjs — masonry-pretext esbuild bundle.
//
// Replaces the dead Gulp 3 + RequireJS + UglifyJS pipeline. Produces the same
// two artifacts the upstream gulp build produced — `dist/masonry.pkgd.js` and
// `dist/masonry.pkgd.min.js` — by bundling `masonry.js` together with
// `jquery-bridget` (so consumers loading the packaged file get jQuery support
// for free, matching upstream behavior). Splitting jquery-bridget into its
// own optional file is roadmap § 2.5, not part of this improvement.
//
// The bundle format is `iife` with `globalName: 'Masonry'`, so consumers can
// drop the file in via `<script>` and use `new Masonry(...)` exactly the way
// they did with upstream v4.2.2. The CJS branch of each UMD wrapper in the
// dependency tree is what esbuild follows; the AMD and browser-global
// branches end up as dead code in the unminified output and are eliminated
// by the minifier.
//
// See FORK_ROADMAP.md § 2.1 and improvements/002-esbuild-build.md.

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
// Entry — virtual stdin so we don't need a separate entry file in the repo
// ─────────────────────────────────────────────────────────────────────────────
const entryContents = `
'use strict';
// Pull in the masonry source via its CommonJS UMD branch.
var Masonry = require(${JSON.stringify(path.join(ROOT, 'masonry.js'))});
// Bridge to jQuery so consumers can do $('.grid').masonry() if jQuery is
// present at runtime. jQuery itself is *not* bundled — bridget no-ops if
// window.jQuery is undefined.
var jQueryBridget = require('jquery-bridget');
jQueryBridget('masonry', Masonry);
module.exports = Masonry;
`;

// ─────────────────────────────────────────────────────────────────────────────
// jquery stub plugin
//
// jquery-bridget declares `jquery` as a hard runtime dependency in its
// package.json (not a devDep), so a naive `require('jquery-bridget')` would
// pull all 85 KB of jQuery into the bundle. Upstream's gulp build neutralized
// this with RequireJS's `paths: { jquery: 'empty:' }` trick. The esbuild
// equivalent is to intercept `require('jquery')` and return an empty CJS
// module — bridget then falls through to `window.jQuery` at runtime, which
// is exactly the upstream behavior (works if jQuery is loaded, no-ops if not).
// ─────────────────────────────────────────────────────────────────────────────
const jqueryStubPlugin = {
  name: 'jquery-stub',
  setup(build) {
    build.onResolve({ filter: /^jquery$/ }, () => ({
      path: 'jquery-stub',
      namespace: 'jquery-stub',
    }));
    build.onLoad({ filter: /.*/, namespace: 'jquery-stub' }, () => ({
      contents: 'module.exports = void 0;',
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
  plugins: [jqueryStubPlugin],
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
