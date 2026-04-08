// playwright.config.js — masonry-pretext visual regression suite
//
// See FORK_ROADMAP.md § Methodology for what this suite is for and why it
// loads dist/masonry.pkgd.min.js directly via file:// URLs instead of using
// the upstream test/index.html (which depends on bower_components/).

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/visual',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    // The fixtures are static HTML files in test/visual/pages/. Specs build
    // file:// URLs from __dirname so the suite has zero setup beyond
    // `npx playwright install chromium`.
    trace: 'on-first-retry',
  },
  // Snapshot tolerances: Masonry positioning is deterministic, so any visual
  // diff should be a real regression. Keep the threshold tight.
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.001,
      threshold: 0.1,
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
