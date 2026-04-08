// test/visual/masonry.spec.js — position-assertion + screenshot regression
// suite for masonry-pretext.
//
// Loads each fixture in test/visual/pages/ via file:// URL, waits for
// `window.__READY` (set by the inline init script in each fixture), reads
// back computed item positions, and asserts them against hardcoded values
// derived from the upstream qunit suite (test/unit/*.js). Then takes a
// screenshot snapshot for visual diffing.
//
// See FORK_ROADMAP.md § Methodology, Layer 1 + Layer 2.

import { test, expect } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pagesDir = path.join(__dirname, 'pages');
const pageURL = name => pathToFileURL(path.join(pagesDir, name)).toString();

/**
 * Read each item's position relative to its container by parsing
 * style.left/top (which is what Masonry sets) and falling back to
 * getBoundingClientRect for sanity-checks.
 */
async function readItemPositions(page, containerSelector) {
  return await page.evaluate((sel) => {
    const container = document.querySelector(sel);
    const items = Array.from(container.querySelectorAll('.item'));
    const cRect = container.getBoundingClientRect();
    return items.map(el => {
      const rect = el.getBoundingClientRect();
      return {
        // Masonry writes pixel values into element.style.left/top
        styleLeft: el.style.left,
        styleTop: el.style.top,
        // Fallback / cross-check from layout
        rectLeft: Math.round(rect.left - cRect.left),
        rectTop: Math.round(rect.top - cRect.top),
      };
    });
  }, containerSelector);
}

async function gotoFixture(page, name) {
  await page.goto(pageURL(name));
  await page.waitForFunction(() => window.__READY === true);
}

// ─────────────────────────────────────────────────────────────────────────────
// Basic top-left layout (mirrors test/unit/basic-layout.js → "basic layout
// top left", with the columnWidth: 60 fixture from test/index.html).
// ─────────────────────────────────────────────────────────────────────────────
test('basic top-left positions', async ({ page }) => {
  await gotoFixture(page, 'basic.html');
  const positions = await readItemPositions(page, '#basic-layout-top-left');

  expect(positions).toHaveLength(5);
  expect(positions[0]).toMatchObject({ styleLeft: '0px',   styleTop: '0px'  });
  expect(positions[1]).toMatchObject({ styleLeft: '60px',  styleTop: '0px'  });
  expect(positions[2]).toMatchObject({ styleLeft: '120px', styleTop: '0px'  });
  expect(positions[3]).toMatchObject({ styleLeft: '0px',   styleTop: '30px' });
  expect(positions[4]).toMatchObject({ styleLeft: '60px',  styleTop: '90px' });

  await expect(page).toHaveScreenshot('basic.png');
});

// ─────────────────────────────────────────────────────────────────────────────
// Gutter (mirrors test/unit/gutter.js).
// ─────────────────────────────────────────────────────────────────────────────
test('gutter positions', async ({ page }) => {
  await gotoFixture(page, 'gutter.html');
  const positions = await readItemPositions(page, '#gutter');

  expect(positions).toHaveLength(4);
  expect(positions[0]).toMatchObject({ styleLeft: '0px',   styleTop: '0px'  });
  expect(positions[1]).toMatchObject({ styleLeft: '80px',  styleTop: '0px'  });
  expect(positions[2]).toMatchObject({ styleLeft: '160px', styleTop: '0px'  });
  expect(positions[3]).toMatchObject({ styleLeft: '0px',   styleTop: '30px' });

  await expect(page).toHaveScreenshot('gutter.png');
});

// ─────────────────────────────────────────────────────────────────────────────
// Horizontal order (mirrors test/unit/horizontal-order.js).
// All 9 items must end up in column (i % 3).
// ─────────────────────────────────────────────────────────────────────────────
test('horizontal-order column assignment', async ({ page }) => {
  await gotoFixture(page, 'horizontal-order.html');
  const positions = await readItemPositions(page, '#horizontal-order');

  expect(positions).toHaveLength(9);
  for (let i = 0; i < positions.length; i++) {
    const expectedCol = i % 3;
    const expectedLeft = `${expectedCol * 60}px`;
    expect(positions[i].styleLeft, `item ${i + 1} should be in column ${expectedCol + 1}`)
      .toBe(expectedLeft);
  }

  await expect(page).toHaveScreenshot('horizontal-order.png');
});

// ─────────────────────────────────────────────────────────────────────────────
// fitWidth — the container should size to its used columns and center
// inside its 160px parent. With columnWidth 60 and 3 items (default 60px
// wide each), all 3 items fit on one row → container width 180px overflows
// the 160px parent intentionally; this is the upstream-documented behavior.
// We assert relative item positions and let the screenshot catch container
// sizing.
// ─────────────────────────────────────────────────────────────────────────────
test('fit-width positions', async ({ page }) => {
  await gotoFixture(page, 'fit-width.html');
  const positions = await readItemPositions(page, '#fit-width');

  expect(positions).toHaveLength(3);
  expect(positions[0]).toMatchObject({ styleLeft: '0px',   styleTop: '0px' });
  expect(positions[1]).toMatchObject({ styleLeft: '60px',  styleTop: '0px' });
  expect(positions[2]).toMatchObject({ styleLeft: '120px', styleTop: '0px' });

  await expect(page).toHaveScreenshot('fit-width.png');
});
