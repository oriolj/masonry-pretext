# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Masonry (masonry-layout) — a cascading grid layout library by David DeSandro / Metafizzy. Source of truth is the single file `masonry.js` at the repo root. Everything in `dist/` is generated.

## Build, Lint, Test

The toolchain is Gulp 3 + JSHint + QUnit. Dependencies are split between npm (`package.json`, build tooling) and Bower (`bower.json`, runtime deps like `outlayer`, `get-size`, `jquery-bridget`, `qunit`). Both must be installed before building or testing — `bower_components/` is referenced directly by `gulpfile.js` and `test/index.html`.

```sh
npm install
bower install
```

- `gulp` — default task: runs `hint` then `uglify` (which depends on `requirejs`). Produces `dist/masonry.pkgd.js` and `dist/masonry.pkgd.min.js`.
- `gulp hint` — JSHint over `masonry.js`, `test/unit/*.js`, `gulpfile.js`, plus JSON lint.
- `gulp requirejs` — bundles `masonry.js` with `jquery-bridget` from `bower_components/` into `dist/masonry.pkgd.js`.
- `gulp uglify` — minifies the packaged file.
- `gulp version -t 4.2.3` — bumps the version string in `masonry.js` and `package.json` (regex replace; does not touch `bower.json`).

Tests are QUnit running in the browser, not a CLI runner. Open `test/index.html` directly. There is no way to run a single unit file without editing `test/index.html` to comment out the others (or use QUnit's `?testId=` URL filter once the page is loaded). `npm test` is not wired up — the script just points at the html file.

## Architecture

Masonry is a thin layout subclass on top of [Outlayer](https://outlayer.metafizzy.co), which provides item lifecycle, events, jQuery bridget, and the public API. `masonry.js` only implements the column-based positioning algorithm by overriding a handful of Outlayer prototype methods:

- `_resetLayout` — measures `columnWidth`, `gutter`, computes `cols`, zeros `colYs` (the per-column running Y).
- `measureColumns` — derives `cols` from container width / `columnWidth`, with sub-pixel rounding tolerance.
- `_getItemLayoutPosition(item)` — for each item: computes `colSpan`, then dispatches to either `_getTopColPosition` (default) or `_getHorizontalColPosition` (when `horizontalOrder: true`), then advances `colYs` for the spanned columns.
- `_getTopColGroup` / `_getColGroupY` — for multi-column items, walks all valid horizontal positions and picks the one whose tallest spanned column is shortest.
- `_getHorizontalColPosition` — left-to-right placement using `horizontalColIndex`, wrapping rows when an item won't fit. Added in #873.
- `_manageStamp` — for stamped (fixed-position) elements: computes which columns the stamp covers and pushes those `colYs` down past the stamp.
- `_getContainerSize` / `_getContainerFitWidth` — reports container height (and width when `fitWidth` is on) back to Outlayer.
- `needsResizeLayout` — only relayout on resize when the container width actually changed.

UMD wrapper at the top of `masonry.js` supports AMD (`define`), CommonJS (`module.exports`), and browser globals (`window.Masonry`). Keep all three branches working when modifying it. Also: `Masonry.compatOptions.fitWidth = 'isFitWidth'` keeps the legacy `isFitWidth` option name working alongside `fitWidth`; use `this._getOption('fitWidth')` rather than reading the option directly.

`dist/masonry.pkgd.js` is the **packaged** build that inlines `outlayer`, `get-size`, `ev-emitter`, `fizzy-ui-utils`, `desandro-matches-selector`, and `jquery-bridget`. Never edit it by hand — regenerate via `gulp`.

`sandbox/` contains standalone HTML demos (`basic.html`, `fit-width.html`, `horizontal-order.html`, `stamps.html`, `right-to-left.html`, `bottom-up.html`, `add-items.html`, `element-sizing.html`, `fluid.html`, `jquery.html`, plus `browserify/` and `require-js/` subfolders) — useful for eyeballing changes against `bower_components/` deps without running the test suite.

## Conventions

- 2-space indentation, single quotes, spaces inside parens (`Math.max( a, b )`) — match the surrounding style; JSHint config is in `.jshintrc`.
- Issue numbers are referenced inline as `#873`-style comments next to the code that fixed them. Preserve those when refactoring.
- Bug reports require a reduced test case — see `.github/contributing.md`. Use the CodePen demos linked there as a starting point.
