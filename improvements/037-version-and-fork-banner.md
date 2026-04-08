# 037 — `Masonry.version` + `Masonry.fork` + one-time console banner

**Status:** landed
**Roadmap section:** post-#036 followup — runtime self-identification
**Tag:** `v5.0.0-dev.37`

## Hypothesis

Add three small pieces of runtime self-identification so users can confirm at a glance which masonry build they're running:

1. **`Masonry.version`** — string like `'5.0.0-dev.37'`. Replaced at build time by esbuild's `define` from `package.json` so it stays in sync without manual bumps.
2. **`Masonry.fork`** — string `'masonry-pretext'`. Discriminates from upstream `desandro/masonry`, which doesn't have this property.
3. **One-time `console.info` banner** on the first `new Masonry(...)` construction, printing `masonry-pretext v5.0.0-dev.37 — https://github.com/oriolj/masonry-pretext` with subtle color styling. Suppressible via `Masonry.silent = true`.

Predicted cost: ~80-150 B gz (the version constant + fork string + banner code + the once-flag).

## Method

### `Masonry.version` via esbuild `define`

In `masonry.js`:

```js
Masonry.version = ( typeof __MASONRY_VERSION__ !== 'undefined' )
  ? __MASONRY_VERSION__ : 'source';
Masonry.fork = 'masonry-pretext';
```

In `scripts/build.mjs` `baseConfig`:

```js
define: {
  __MASONRY_VERSION__: JSON.stringify( pkg.version ),
},
```

The `typeof` guard returns `'source'` when `masonry.js` is loaded raw via the `./source` package export (no build step, no `define` replacement). In the bundled outputs, esbuild replaces `__MASONRY_VERSION__` with the literal version string and the dead-code-eliminated branch becomes `Masonry.version = "5.0.0-dev.37"`.

### One-time console banner

A module-scope `hasLoggedBanner` flag inside the IIFE factory ensures the banner fires exactly once per page, no matter how many `Masonry` instances the user creates. Gated by `!Masonry.silent` so users who want zero log noise can opt out:

```js
var hasLoggedBanner = false;
var baseCreate = proto._create;
proto._create = function() {
  if ( !hasLoggedBanner && !Masonry.silent &&
       typeof console !== 'undefined' && console.info ) {
    hasLoggedBanner = true;
    console.info(
      '%cmasonry-pretext%c v' + Masonry.version +
        ' — https://github.com/oriolj/masonry-pretext',
      'color: #09f; font-weight: bold',
      'color: inherit'
    );
  }
  // ... existing _create body
};
```

The `%c` styling makes `masonry-pretext` appear in blue bold, with the version + URL in the inherited console color. Visible in DevTools without spamming production error dashboards (info-level).

### `masonry.d.ts` updates

Three new static members on the `Masonry` class declaration:

```ts
static version: string;
static fork: 'masonry-pretext';
static silent: boolean | undefined;
```

Each with full JSDoc + a runnable example.

### Verification

End-to-end check via Playwright:

```sh
$ node -e "import('./dist/masonry.mjs').then(m => console.log(m.default.version, m.default.fork))"
5.0.0-dev.37 masonry-pretext

$ # In chromium loading basic.html:
CONSOLE.INFO: %cmasonry-pretext%c v5.0.0-dev.37 — https://github.com/oriolj/masonry-pretext color: #09f; font-weight: bold color: inherit
```

The banner only fires once per page (verified by loading multiple fixtures sequentially in the visual test runner — no duplicate banner output).

## Numbers

| Metric | pre-037 | post-037 | Δ |
|---|---:|---:|---:|
| `dist/masonry.pkgd.js` raw | 51,358 | 51,882 | +524 |
| `dist/masonry.pkgd.js` gz | 9,868 | 10,041 | +173 |
| `dist/masonry.pkgd.min.js` raw | 22,860 | **23,123** | **+263** |
| `dist/masonry.pkgd.min.js` gz | 7,426 | **7,549** | **+123** |
| `dist/masonry.pkgd.min.js` brotli | 6,729 | **6,820** | **+91** |
| Visual + ssr + module + compute-layout + no-jquery | all green | all green | unchanged |

### Vs upstream-frozen v4.2.2

| Metric | v4.2.2 | v5.0.0-dev.37 | Δ |
|---|---:|---:|---:|
| `dist/masonry.pkgd.min.js` raw | 24,103 | **23,123** | **−980 (−4.06 %)** |
| `dist/masonry.pkgd.min.js` gz | 7,367 | 7,549 | +182 (+2.47 %) |

## Verdict

✅ **Match — landed inside the predicted +80-150 B gz band (+123 B actual).**

The +123 B gz is the cost of:
- The version string literal (19 B raw)
- The fork string literal (16 B raw)
- The one-time banner code path (~150 B raw including the styled format string)
- The `hasLoggedBanner` once-flag
- The `!Masonry.silent` gate

All gates green. The fork now has a clean way for users to verify which build they're loaded against.

## Notes / lessons

- **`define` replacement is whole-token only.** `__MASONRY_VERSION__` becomes the literal string, but only when it appears as a complete identifier. Inside `typeof __MASONRY_VERSION__`, the typeof operator is a separate token, so the `typeof "5.0.0-dev.37"` evaluation at runtime is correct.
- **`typeof` is the ONLY operator that won't ReferenceError on undeclared identifiers** in non-strict-mode and is actually the *only* operator that does so in strict mode too. The fallback branch in `masonry.js` works because `typeof __MASONRY_VERSION__` evaluates to `'undefined'` in the raw `./source` import path without throwing.
- **`Masonry.fork` is the right discriminator**, not `Masonry.version`. A future version of upstream `desandro/masonry` could ship a `Masonry.version` property (it doesn't today, but might), so checking the version string isn't load-bearing. The presence of `Masonry.fork === 'masonry-pretext'` is reliable forever — upstream would never adopt that exact property name with that exact value.
- **`console.info` not `console.log`** because most production setups suppress info-level by default. The banner is for dev-time confirmation; users in prod don't need to see it on every page load.
- **`%c` CSS styling in console.info** is supported by chromium / firefox / safari devtools — universal at the project's browser baseline. Falls back gracefully (the format string just shows literally) on older devtools or in Node.
- **`hasLoggedBanner` is module-scope inside the IIFE** so it survives across all instances on the page but resets when a new page loads (which is what we want). If a user wants ZERO banner output, they set `Masonry.silent = true` BEFORE the first `new Masonry(...)` call.
