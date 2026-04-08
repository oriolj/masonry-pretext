#!/usr/bin/env node
// test/visual/module-smoke.mjs — verify the CJS and ESM bundles expose a
// usable constructor through Node's actual module loaders.
//
// Why this exists: `ssr-smoke.mjs` only validates the IIFE bundle by reading
// it as raw text and evaluating it inside `vm.runInContext`. That tests SSR
// safety (no top-level DOM access) but does NOT test that consumers' module
// resolvers can find a constructor on the import. The IIFE bundle has no
// `module.exports` / `export default` at all — `require('masonry-pretext')`
// from a Vite/Rollup/webpack project resolves to `undefined`, which is the
// exact bug improvement #013 fixed by adding ./dist/masonry.cjs and
// ./dist/masonry.mjs.
//
// This smoke does the loads the way real consumers do them:
//   • `require('./dist/masonry.cjs')` via `createRequire`
//   • `import('./dist/masonry.mjs')` via dynamic import
//
// For each, assert the result is a constructor function with the expected
// `prototype.layout` method. If either resolves to `undefined`, an object
// without `prototype`, or anything else, the test fails loudly.
//
// Usage:
//   node test/visual/module-smoke.mjs
//
// Exit 0 if both bundles import cleanly and expose `Masonry.prototype.layout`.
// Exit 1 otherwise.

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const require = createRequire(import.meta.url);

let failed = false;

function assertConstructor(label, ctor) {
  if (typeof ctor !== 'function') {
    throw new Error(`expected constructor function, got ${typeof ctor}`);
  }
  if (typeof ctor.prototype?.layout !== 'function') {
    throw new Error(
      `expected ${label}.prototype.layout to be a function, got ${typeof ctor.prototype?.layout}`,
    );
  }
}

// CJS smoke ──────────────────────────────────────────────────────────────────
try {
  const cjsPath = path.join(ROOT, 'dist/masonry.cjs');
  const Masonry = require(cjsPath);
  assertConstructor("require('dist/masonry.cjs')", Masonry);
  console.log('✓ dist/masonry.cjs requires cleanly');
  console.log(`  Masonry export type: ${typeof Masonry}`);
  console.log(`  Masonry.prototype.layout: function`);
} catch (err) {
  console.error('✗ dist/masonry.cjs failed CJS require:');
  console.error(`  ${err.message}`);
  failed = true;
}

console.log('');

// ESM smoke ──────────────────────────────────────────────────────────────────
try {
  const esmPath = path.join(ROOT, 'dist/masonry.mjs');
  // Use file:// URL — `import('/abs/path')` works on POSIX but not on Windows.
  const mod = await import(pathToFileURL(esmPath).href);
  const Masonry = mod.default;
  assertConstructor("import('dist/masonry.mjs').default", Masonry);
  console.log('✓ dist/masonry.mjs imports cleanly');
  console.log(`  default export type: ${typeof Masonry}`);
  console.log(`  Masonry.prototype.layout: function`);
} catch (err) {
  console.error('✗ dist/masonry.mjs failed ESM import:');
  console.error(`  ${err.message}`);
  failed = true;
}

process.exit(failed ? 1 : 0);
