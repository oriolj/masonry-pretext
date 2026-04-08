# NNN — short title

**Status:** in-progress | landed | reverted
**Roadmap section:** § _e.g. L.1, P.1b, 2.6_
**Closes upstream issues:** _e.g. desandro/masonry#1194, #1121, or "none"_
**Commit(s):** _filled in after landing_

## Hypothesis

What this change is expected to do, stated in **numbers**, not adjectives.

- _e.g. "Reduce `dist/masonry.pkgd.min.js` by ~600 bytes raw, ~250 bytes gzipped."_
- _e.g. "Eliminate one forced reflow per layout pass on grids with text bricks."_
- _e.g. "No behavior change — visual snapshots must match byte-for-byte."_

State the hypothesis **before** making the change. If the prediction is fuzzy, sharpen it first — vague predictions can't be falsified.

## Method

The actual edits made and the commands run. Be specific enough that someone could reproduce the change from scratch.

- Files touched:
- Commands run:
- Manual verification steps:

## Before

`scripts/measure.sh` output captured immediately before the change, on a clean working tree:

```
(paste the output)
```

Test status before the change:
- `npm run test:visual` — _pass/fail with details_

## After

`scripts/measure.sh` output captured immediately after the change:

```
(paste the output)
```

Test status after the change:
- `npm run test:visual` — _must be pass_
- Snapshot diffs: _none, or list updated snapshots with rationale_

## Delta

Side-by-side comparison of the metrics that moved:

| Metric | Before | After | Δ | % |
|---|---:|---:|---:|---:|
| dist/masonry.pkgd.min.js raw | | | | |
| dist/masonry.pkgd.min.js gzip | | | | |
| dist/masonry.pkgd.min.js brotli | | | | |
| (other relevant rows) | | | | |

## Verdict

Did the actual delta match the hypothesis?

- ✅ **Match** — landed as predicted.
- ⚠️ **Partial** — landed with smaller/larger delta than predicted. Explain why.
- ❌ **Miss** — prediction was wrong. Document the lesson and update the roadmap if the underlying claim was load-bearing for other planned items.

## Notes / lessons

Anything surprising. What the next prediction should account for. Sharp edges discovered.