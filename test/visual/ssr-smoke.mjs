#!/usr/bin/env node
// test/visual/ssr-smoke.mjs — verify the bundled file can be loaded in a
// Node context with no `window` / `document` / `navigator` globals.
//
// This is the literal test for SSR-import compatibility. If the bundle's
// IIFE crashes when evaluated in a DOM-less context, an `import Masonry from
// 'masonry-pretext'` in a Next.js / Nuxt / SvelteKit page will crash too —
// which is exactly what upstream issues #1194 and #1121 are about.
//
// Usage:
//   node test/visual/ssr-smoke.mjs
//   node test/visual/ssr-smoke.mjs path/to/bundle.js     # custom bundle
//
// Exit 0 if the bundle loads cleanly. Exit 1 if it throws — the error
// message is printed verbatim so we can see *which* DOM access tripped it.

import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const target = process.argv[2] || path.join(ROOT, 'dist/masonry.pkgd.min.js');

const bundle = await readFile(target, 'utf8');

// Empty context — no window, no document, no navigator. This is what a
// fresh Node SSR worker looks like before any browser polyfill.
const ctx = vm.createContext({});

try {
  vm.runInContext(bundle, ctx, {
    filename: path.basename(target),
    timeout: 5000,
  });
  // If we got here the bundle's top-level IIFE ran without throwing.
  // Verify the global was actually set.
  const exported = ctx.Masonry;
  if (typeof exported !== 'function' && typeof exported !== 'object') {
    console.error(`SSR smoke: bundle loaded but Masonry export is ${typeof exported}`);
    process.exit(1);
  }
  console.log(`✓ ${path.basename(target)} loads in DOM-less context`);
  console.log(`  Masonry export type: ${typeof exported}`);
  process.exit(0);
} catch (err) {
  console.error(`✗ ${path.basename(target)} crashes in DOM-less context`);
  console.error(`  ${err.message}`);
  // Print the full stack so we can see *which* DOM access tripped it.
  if (err.stack) {
    for (const line of err.stack.split('\n').slice(0, 8)) {
      console.error('   ' + line);
    }
  }
  process.exit(1);
}
