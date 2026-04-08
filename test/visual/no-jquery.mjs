#!/usr/bin/env node
// test/visual/no-jquery.mjs — assert the bundle contains zero jquery / bridget
// references in the bundled files.
//
// Behavior tests (visual + ssr-smoke) catch *runtime* regressions but cannot
// detect dead code that lives in the bundle bytes without ever running. The
// maintainer's call in improvement #006 is "remove everything jQuery, period",
// so this gate enforces it as a string-presence check on `dist/`.
//
// Future improvements that touch the build pipeline must keep this passing,
// or anyone trying to import the bundle will once again carry jquery code
// that they didn't ask for and don't run.
//
// Usage:
//   node test/visual/no-jquery.mjs                    # check both dist files
//   node test/visual/no-jquery.mjs path/to/file.js    # check a specific file

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const targets = process.argv.length > 2
  ? process.argv.slice(2)
  : [
      path.join(ROOT, 'dist/masonry.pkgd.js'),
      path.join(ROOT, 'dist/masonry.pkgd.min.js'),
    ];

// Case-insensitive — `jQuery`, `jquery`, and `JQUERY` all match. `bridget`
// catches the bridget shim symbols even if `jquery` itself was removed.
const NEEDLE = /jquery|bridget/i;

let failed = 0;
for (const target of targets) {
  const name = path.basename(target);
  const src = await readFile(target, 'utf8');
  const matches = src.match(new RegExp(NEEDLE.source, NEEDLE.flags + 'g'));
  if (matches && matches.length > 0) {
    failed++;
    console.error(`✗ ${name} contains ${matches.length} jquery/bridget references:`);
    // Print up to 5 unique matches with line context for diagnostics.
    const seen = new Set();
    const lines = src.split('\n');
    for (let i = 0; i < lines.length && seen.size < 5; i++) {
      const m = lines[i].match(NEEDLE);
      if (m && !seen.has(m[0].toLowerCase())) {
        seen.add(m[0].toLowerCase());
        const snippet = lines[i].length > 120 ? lines[i].slice(0, 120) + '…' : lines[i];
        console.error(`   line ${i + 1}: ${snippet.trim()}`);
      }
    }
  } else {
    console.log(`✓ ${name} contains 0 jquery/bridget references`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} file(s) failed the no-jquery check.`);
  process.exit(1);
}
