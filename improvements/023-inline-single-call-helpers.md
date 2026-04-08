# 023 — Inline single-call helpers (item F)

**Status:** landed
**Roadmap section:** § Post-#010 / FORK_ROADMAP.md item F
**Tag:** `v5.0.0-dev.23`

## Method

Two `outlayer.js` proto methods were each called from exactly one place and each were a single trivial expression. Inlined at the call site via build-time patches:

- **`_filterFindItemElements`** — `utils.filterFindElements(elems, this.options.itemSelector)`. Inlined into `_itemize`.
- **`_getItemsForLayout`** — `items.filter(item => !item.isIgnored)`. Inlined into `layoutItems`.

Both proto declarations deleted from the bundle.

## Numbers

| Metric | pre-023 | post-023 | Δ |
|---|---:|---:|---:|
| `dist/masonry.pkgd.js` raw | 58,715 | 58,479 | −236 |
| `dist/masonry.pkgd.js` gz | 11,060 | 11,034 | −26 |
| `dist/masonry.pkgd.min.js` raw | 25,561 | **25,415** | **−146** |
| `dist/masonry.pkgd.min.js` gz | 8,241 | **8,214** | **−27** |
| `dist/masonry.pkgd.min.js` brotli | 7,481 | **7,465** | **−16** |
| Visual + ssr + module + compute-layout + no-jquery | all green | all green | unchanged |

## Verdict

✅ **Match.** Inside the predicted ~60-90 B gz band's lower half. Plugin authors who reach into `_filterFindItemElements` or `_getItemsForLayout` would lose those hooks — same backward-compat tradeoff as the masonry-pretext convention. Risk is minimal because both helpers are single trivial expressions; if a user really needs to override item filtering they can override `_itemize` directly.
