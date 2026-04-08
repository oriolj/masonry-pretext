# 021 — Internal docs refresh + Next.js example SSR parity

**Status:** landed
**Roadmap section:** Post-#020 followup — closes the "PR welcome" caveats from #019 and brings every internal doc current with the dev.15 → dev.20 batch.
**Closes upstream issues:** none. **Documentation + Next.js example upgrade.**
**Tag:** `v5.0.0-dev.21`
**Commit:** _filled in after landing_

## Hypothesis

After the dev.15 → dev.20 batch (the entire SSR feature line), an audit of internal docs found multiple staleness gaps:

1. **`FORK_RELEASE_NOTES.md`** jumped from dev.14 → dev.13. **Six entries missing** (dev.15, dev.16, dev.17, dev.18, dev.19, dev.20).
2. **`FORK_ROADMAP.md` § Progress** had a row for #015 (item S) but **no rows for #016-#020**. The SSR feature line was visible only via `PRETEXT_SSR_ROADMAP.md`'s Progress table, not the master roadmap.
3. **`PRETEXT_SSR_ROADMAP.md`** had two staleness layers: (a) the "Current state" table near the top still listed Phase 0.5 as "🟡 in flight" and Phases 1-5 as "❌ pending", and (b) the per-phase narrative status lines at the bottom of each phase section still said "⬜ pending. Blocked by Phase N." All 6 needed updating to ✅ shipped with tag + improvement-record links.
4. **`CLAUDE.md`** referenced `dist/` as "the unmodified v4.2.2 packaged build inherited from upstream" — false since #002 (esbuild build, dev.2). Also no mention of `Masonry.computeLayout`, `static: true`, the new test gates (`compute-layout.mjs`, `module-smoke.mjs`), the new bench scripts, the engine/adapter split, the percent-detection helpers, or the new `PRETEXT_SSR_ROADMAP.md` sibling roadmap. Years of accumulated drift.
5. **`README.md`** Key improvements table was **out of order** (dev.14 listed below dev.15) AND missing rows for **dev.16, dev.17, dev.18, dev.19, dev.20**. Also: no link to `FORK_RELEASE_NOTES.md` from the intro.
6. **`examples/nextjs/`** still used the simpler `static: true`–only pattern from #015, while `examples/astro/` had been upgraded in #019 to the full SSR pipeline. The Astro README documented the Next.js parity gap as "PR welcome." This improvement upgrades the Next.js example to full pipeline parity.

This improvement closes all six gaps in one commit. Pure docs + example upgrade — zero source change to `masonry.js`, zero bundle byte change.

### Predictions

1. **Zero changes to `masonry.js` / `masonry.d.ts` / `dist/`** — pure documentation + example upgrade.
2. **Zero test gate changes** — all 10 visual fixtures + ssr + module + compute-layout + no-jquery stay green.
3. **`FORK_RELEASE_NOTES.md`** gains 6 new sections (one per dev.15-20).
4. **`FORK_ROADMAP.md` § Progress** gains 5 new rows (P, CL, AD, EX, BH for #016-#020) with a banner separator pointing readers at `PRETEXT_SSR_ROADMAP.md`.
5. **`PRETEXT_SSR_ROADMAP.md`** has every "Current state" row updated to ✅ with the actual landing tag, every per-phase narrative status line updated to ✅ shipped with the tag + improvement-record link.
6. **`CLAUDE.md`** is comprehensively rewritten to reflect the current state of the codebase (esbuild build, all 5 test gates, the new bench scripts, the SSR feature line, the engine/adapter split, the percent helpers, the static preset, and a "Read these first" pointer to BOTH roadmaps).
7. **`README.md`** Key improvements table is reordered (dev.14 → dev.15 → dev.16 → ... → dev.20) and gains 5 new rows for #016-#020. The intro section gains an "Internal documentation" bullet list linking to all five primary internal docs (`FORK_ROADMAP.md`, `PRETEXT_SSR_ROADMAP.md`, `FORK_RELEASE_NOTES.md`, `improvements/`, `CLAUDE.md`).
8. **`examples/nextjs/app/page.tsx`** (Server Component) is rewritten to call `Masonry.computeLayout` in pure Node, pass positions as props to the client component.
9. **`examples/nextjs/app/MasonryGrid.tsx`** (Client Component) is rewritten to receive positions as a prop and adopt them via `initLayout: false + static: true`.
10. **`examples/nextjs/README.md`** is rewritten to document the four-step pipeline, the two CSS details that matter (`--grid-height` reservation + `position: absolute` at render time), the before/after CLS comparison, and the four constraints.
11. **`examples/astro/README.md`** "Comparison to the Next.js example" section is updated — was "PR welcome", now points at the upgraded parity demo.

## Method

### `FORK_RELEASE_NOTES.md` — 6 new entries

Added sections for dev.20, dev.19, dev.18, dev.17, dev.16, dev.15 in reverse-chronological order (matching the existing convention). Each entry has the headline result, an Added/Changed list, a numbers table, and a Migration note. The dev.20 entry leads with the **CLS 0.7421 → 0.0000 measured** headline.

### `FORK_ROADMAP.md § Progress` — 5 new rows + section banner

Added a banner row `**— PRETEXT + SSR feature line: see PRETEXT_SSR_ROADMAP.md for the full design — — —**` and 5 new rows directly under it: P (#016 engine split), CL (#017 computeLayout), AD (#018 initLayout adoption), EX (#019 Astro example), BH (#020 benchmarks). Each row links to the per-improvement record and notes the headline number. Item S (#015) stays where it was.

### `PRETEXT_SSR_ROADMAP.md` — narrative refresh

Every stale narrative line updated:

- **"Current state" table** — all 6 phase rows flipped from `🟡` / `❌` to `✅ shipped (#NNN)` with one-line summaries of what each shipped.
- **Per-phase narrative `Status:` lines** — `⬜ pending. Blocked by Phase N.` → `✅ shipped (v5.0.0-dev.NN)` with the tag + improvement-record link.
- **The "headline gap"** sentence at the end of the Current state section was removed (it pointed at Phase 1 as the prerequisite; no longer relevant).

### `CLAUDE.md` — comprehensive rewrite

The biggest single doc update in this improvement. Changes:

- **"Read this first" → "Read these first"** with both roadmaps as load-bearing reading. Old version only mentioned `FORK_ROADMAP.md`.
- **Build, Lint, Test section** — `npm install` table updated, `make build` / `make test` / `make bench` / `make measure` documented. Old version said `dist/` was "the unmodified v4.2.2 packaged build" — false since #002.
- **NEW "Test gates" subsection** — all 5 gates documented with what each catches and where it lives. Old version only mentioned `run.mjs`.
- **NEW "Benchmarks" subsection** — `bench-server-layout.mjs`, `bench-hydration.mjs`, and `bench-pretext.mjs` documented with their measurement targets and current numbers. Old version had nothing.
- **Architecture section — full rewrite** — now documents the `placeItem` pure-math layer, the four prototype wrappers (kept for backward compat), the percent-detection helpers (`detectPercentForOption`, `deriveCols`, `applyStamp`, `computeFitContainerWidth`), the constructor extensions (`document.fonts.ready` hook + per-item `ResizeObserver` + `static: true` opt-out), and `Masonry.computeLayout`. Old version listed only the proto methods at a high level.
- **NEW "Examples" section** — documents both the Astro example (canonical SSR demo) and the Next.js example (RSC equivalent).
- **Conventions** — added `#NNN` for fork improvements (was only `#873`-style for upstream issues).

### `README.md` — three changes

1. **NEW "Internal documentation" bullet list** in the intro section, immediately after the "every change has to produce a measurable improvement" sentence. Links to all five primary internal docs.
2. **Key improvements table** — reordered (dev.14 → dev.15) and gained 5 new rows (dev.16, dev.17, dev.18, dev.19, dev.20). Each row links to its improvement record and references the `PRETEXT_SSR_ROADMAP.md` phase.
3. **No change to the existing "🎯 The headline feature" callout** — that was added in #020 and is still accurate.

### `examples/nextjs/app/page.tsx` — full rewrite

```tsx
import Masonry from 'masonry-pretext';
import MasonryGrid from './MasonryGrid';

const COL_WIDTH = 240;
const GUTTER = 16;
const CONTAINER_WIDTH = 752;

export default function Page() {
  const items = getItems();

  // THE KILLER STEP — server-side layout precomputation in pure Node.
  const { positions, containerHeight } = Masonry.computeLayout({
    items: items.map(item => ({ outerWidth: COL_WIDTH, outerHeight: item.outerHeight })),
    containerWidth: CONTAINER_WIDTH,
    columnWidth: COL_WIDTH,
    gutter: GUTTER,
  });

  return (
    <main>
      <MasonryGrid items={items} positions={positions} containerHeight={containerHeight}
                   columnWidth={COL_WIDTH} gutter={GUTTER} />
    </main>
  );
}
```

The Server Component imports `Masonry from 'masonry-pretext'` (SSR-safe since #005), calls `Masonry.computeLayout` in pure Node (#017), and passes the `positions` array as a prop. React serializes the array into the SSR payload; the client component receives the same numbers the server computed.

### `examples/nextjs/app/MasonryGrid.tsx` — full rewrite

```tsx
'use client';
export default function MasonryGrid({ items, positions, containerHeight, columnWidth, gutter }) {
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const msnry = new Masonry(gridRef.current, {
      itemSelector: '.grid-item',
      columnWidth, gutter,
      initLayout: false,    // adopt existing positions, don't relayout
      static: true,         // no observers, no animations, no font hooks
    });
    return () => msnry.destroy();
  }, [items, columnWidth, gutter]);

  return (
    <div ref={gridRef} className="grid"
         style={{ position: 'relative', height: containerHeight }}>
      {items.map((item, i) => (
        <div key={item.id} className="grid-item"
             style={{
               position: 'absolute',
               left: positions[i].x,
               top: positions[i].y,
               width: columnWidth, height: item.outerHeight,
               // ... visual styles
             }}>
          {item.title}
        </div>
      ))}
    </div>
  );
}
```

The two CSS details that matter for CLS = 0.00:
1. The grid container reserves `height: containerHeight` from the server-computed value (without this the grid collapses to 0 since all children are absolute).
2. Each `.grid-item` has `position: absolute` AT RENDER TIME (in the inline `style` prop), not just after script construction.

### `examples/nextjs/README.md` — full rewrite

Restructured around the four-step pipeline (matching the Astro example's README):

1. Server-side measurement (RSC, Node)
2. `Masonry.computeLayout` in pure Node (RSC)
3. Pass positions as props to the client component
4. Client-side adoption (`'use client'`)

Plus: how-to-run instructions, the two CSS details, before/after CLS comparison, "When NOT to use this pattern" section with the four constraints, and a comparison to the Astro example.

### `examples/astro/README.md` — one section update

The "Comparison to the Next.js example" section was previously "PR welcome" (the Next.js example used the simpler `static: true`–only pattern). Now updated to reflect parity: "Pick whichever framework you're already using."

### Files touched

| File | Type | Lines added |
|---|---|---|
| `FORK_RELEASE_NOTES.md` | new sections | +198 |
| `FORK_ROADMAP.md` | new Progress rows + banner | +6 |
| `PRETEXT_SSR_ROADMAP.md` | narrative refresh | ~12 lines edited in place |
| `CLAUDE.md` | comprehensive rewrite | net +50 (97 line file, lots of structural changes) |
| `README.md` | intro link block + 5 new table rows + reorder | +12 |
| `examples/nextjs/app/page.tsx` | full rewrite | +75 |
| `examples/nextjs/app/MasonryGrid.tsx` | full rewrite | +95 |
| `examples/nextjs/README.md` | full rewrite | +145 |
| `examples/astro/README.md` | one section update | +0 (in-place edit) |
| `improvements/021-internal-docs-refresh-and-nextjs-parity.md` | this file | +180 |

**Zero changes to `masonry.js`, `masonry.d.ts`, `dist/`, `test/visual/`, `Makefile`, `package.json` (except version bump).**

### Commands run

```sh
make test                                          # 10/10 + 4 gates baseline
# audit FORK_RELEASE_NOTES, FORK_ROADMAP, PRETEXT_SSR_ROADMAP, README, CLAUDE.md
# add 6 entries to FORK_RELEASE_NOTES (dev.15-20)
# add 5 rows + banner to FORK_ROADMAP § Progress
# update PRETEXT_SSR_ROADMAP narrative status lines
# comprehensive CLAUDE.md rewrite
# add Internal documentation block to README intro
# reorder + add 5 rows to README Key improvements table
# rewrite examples/nextjs/{page.tsx, MasonryGrid.tsx, README.md}
# update examples/astro/README.md "Comparison to Next.js" section

make test                                          # still 10/10 + 4 gates green
# bump pkg.json → 5.0.0-dev.21, rebuild for banner
./scripts/measure.sh --save post-021-docs-and-nextjs
```

## Before / After

**Before:** `FORK_RELEASE_NOTES.md` jumped dev.14 → dev.13; `FORK_ROADMAP.md` had no rows for #016-#020; `PRETEXT_SSR_ROADMAP.md` had stale "in flight" / "pending" status lines; `CLAUDE.md` referenced `dist/` as the v4.2.2 packaged build; `README.md` table was out of order with dev.14 below dev.15 and missing dev.16-20; `examples/nextjs/` used the simpler `static: true`–only pattern.

**After:** All five docs current. Both examples use the full SSR pipeline. The Astro README's "PR welcome" caveat is gone. Future Claude sessions reading `CLAUDE.md` see both roadmaps as load-bearing, all 5 test gates documented, and the architecture description includes the `placeItem` pure-math layer + the percent helpers + the static preset + `Masonry.computeLayout`.

## Delta

| Metric | pre-021 | post-021 | Δ |
|---|---:|---:|---:|
| `masonry.js` source raw | 29,127 | **29,127** | **0** |
| `dist/masonry.pkgd.min.js` raw | 25,571 | **25,571** | **0** |
| `dist/masonry.pkgd.min.js` gz | 8,241 | **8,242** | **+1** (banner version string `dev.20` → `dev.21`, same length, single-byte compression jitter) |
| Visual + ssr + module + compute-layout + no-jquery gates | all green | all green | unchanged |
| **Internal docs current** | **stale** (6 missing FORK_RELEASE_NOTES entries, 5 missing FORK_ROADMAP rows, stale PRETEXT_SSR narrative, stale CLAUDE.md, README missing 5 rows + reorder) | **all current** | the gap is closed |
| **Next.js example** | `static: true`–only (simpler pattern) | **full SSR pipeline parity with Astro** | the "PR welcome" caveat is closed |

## Verdict

✅ **Match — every prediction landed exactly as designed.** Zero source change, zero bundle byte change (modulo a 1-byte jitter from the banner version string). All five internal docs are now current with the dev.15 → dev.20 batch. Both example projects (Astro + Next.js) now use the full SSR pipeline with parity in features and documentation. The "PR welcome" caveat in `examples/astro/README.md` is closed.

## Notes / lessons

- **Six commits in one session is the limit before the docs drift.** The dev.15 → dev.20 batch landed in one productive afternoon, but maintaining `FORK_RELEASE_NOTES.md` and `FORK_ROADMAP.md` § Progress in lockstep with each commit became impractical when the focus was on shipping. Doing the doc refresh as a separate dedicated improvement (this one) is the right shape — it lets the implementation work stay focused, and the docs catch up in a single coherent pass after.
- **`CLAUDE.md` is the highest-leverage doc to keep current.** Every future Claude session reads it first. Stale guidance there compounds — a future session will follow stale instructions until corrected. The other docs are reference material; `CLAUDE.md` is the operating manual.
- **The "Internal documentation" bullet list in README.md** is the cheapest way to ensure all five docs stay discoverable. One block of links, ~6 lines, tells any reader (human or AI) that the project has both a master roadmap AND a focused feature roadmap AND a release notes file AND an improvements log AND a Claude-specific instructions file. Without this list, the only links into the doc tree were scattered through the body text.
- **The Next.js parity work is mostly props serialization.** The Server Component computes positions in pure Node (free), passes them as JSON props (free, React already does this), and the Client Component renders them (free). The interesting part is the **CSS contract**: `height: containerHeight` on the container + `position: absolute` at render time on each item. Both are 1-line changes that the demo's existing visual styles needed to add. Without those two CSS details, the pipeline still works for positions but CLS is non-zero because the container collapses-then-expands.
- **`improvements/` records are immutable audit trails.** I deliberately did NOT update `improvements/019-astro-ssr-pipeline-example.md` to remove its "Next.js example untouched, marked as PR-welcome" notes — that was the historical state when #019 landed. The living docs (`FORK_RELEASE_NOTES.md`, `PRETEXT_SSR_ROADMAP.md`, the Astro example README) are the right place to reflect "the PR-welcome was closed in the followup."
- **Three minor doc improvements** worth noting that this commit does NOT do, but could in a future pass: (a) the `improvements/README.md` could list every improvement with a one-liner (currently it just describes the format), (b) the FORK_RELEASE_NOTES "How to read entries" template at the bottom is dated and could be trimmed, (c) the FORK_ROADMAP § "Re-ranked sequencing" section at the bottom still uses the old `#015 → #019` numbering plan that was superseded by the actual landing order. None of these block anything; flagged for a future pass.
