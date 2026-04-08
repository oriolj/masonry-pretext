# Improvements log

This folder is the **per-change record** for masonry-pretext. One file per discrete improvement, numbered in landing order.

Each improvement file follows the same template (see [`TEMPLATE.md`](./TEMPLATE.md)) so the change loop from [`../FORK_ROADMAP.md`](../FORK_ROADMAP.md) § Methodology is enforced consistently:

- **Hypothesis** — what the change is expected to do (in numbers, not adjectives).
- **Method** — the actual edits and the commands run.
- **Before / After** — `scripts/measure.sh` output, screenshot diffs, bench numbers.
- **Verdict** — did the actual delta match the hypothesis? If not, why?
- **Roadmap link** — which roadmap section(s) this closes, plus any upstream desandro/masonry issue numbers it addresses.

Improvements live here in **addition** to the rolling list in `FORK_ROADMAP.md` § Progress and the user-facing notes in `FORK_RELEASE_NOTES.md`. The three files have different audiences:

| File | Audience | Granularity |
|---|---|---|
| `improvements/NNN-*.md` | Future maintainers / Claude sessions auditing the change history | One file per change, with full numbers and reasoning |
| `FORK_ROADMAP.md` § Progress | Anyone planning the next change | Checklist, one line per item |
| `FORK_RELEASE_NOTES.md` | Users upgrading the package | Keep-a-Changelog style, grouped by version |

When you start a new improvement: copy `TEMPLATE.md` to the next number, fill in the hypothesis section, then make the change.