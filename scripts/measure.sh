#!/usr/bin/env bash
# scripts/measure.sh — capture size, LOC, and dep metrics for masonry-pretext.
#
# Output is a stable, parseable table on stdout. With `--save <label>` it also
# appends a row to metrics/history.tsv so the trend over time is auditable.
#
# This script is the single source of truth for size/LOC numbers in the
# fork. See FORK_ROADMAP.md § Methodology for the change-loop protocol that
# makes those numbers meaningful.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# ---- helpers ----------------------------------------------------------------

# bytes_raw FILE
bytes_raw() { wc -c < "$1" | tr -d ' '; }

# bytes_gzip FILE — gzip -9, no name/timestamp metadata so the result is stable
bytes_gzip() { gzip -9nc "$1" | wc -c | tr -d ' '; }

# bytes_brotli FILE — brotli -q11 (max), to stdout
bytes_brotli() {
  if command -v brotli >/dev/null 2>&1; then
    brotli -q 11 -c "$1" | wc -c | tr -d ' '
  else
    echo "n/a"
  fi
}

# loc FILE
loc() { wc -l < "$1" | tr -d ' '; }

# pretty FILE — print "raw / gz / br / loc" for one file
file_row() {
  local label="$1" path="$2"
  if [[ ! -f "$path" ]]; then
    printf '  %-32s  %10s  %10s  %10s  %8s\n' "$label" "(missing)" "-" "-" "-"
    return
  fi
  printf '  %-32s  %10s  %10s  %10s  %8s\n' \
    "$label" \
    "$(bytes_raw "$path")" \
    "$(bytes_gzip "$path")" \
    "$(bytes_brotli "$path")" \
    "$(loc "$path")"
}

# ---- gather -----------------------------------------------------------------

label="${1:-}"
save=""
if [[ "$label" == "--save" ]]; then
  save="${2:-unlabeled}"
  shift 2 || true
fi

# Tracked + staged + untracked-not-ignored files & total LOC.
# This counts what *would* be in the next commit if you `git add` everything,
# minus anything in .gitignore. Pure-deleted files in the worktree are
# correctly excluded by `git ls-files -co --exclude-standard --deduplicate`
# combined with the existence check inside the wc loop.
file_list_tmp="$(mktemp)"
trap 'rm -f "$file_list_tmp"' EXIT
git ls-files -co --exclude-standard --deduplicate > "$file_list_tmp"
# Drop entries that no longer exist on disk (worktree-deleted files).
total_files=0
total_loc=0
while IFS= read -r f; do
  [[ -f "$f" ]] || continue
  total_files=$((total_files + 1))
  if [[ -r "$f" ]]; then
    lines=$(wc -l < "$f" 2>/dev/null || echo 0)
    total_loc=$((total_loc + lines))
  fi
done < "$file_list_tmp"

# dep counts from package.json
dep_count="$(jq -r '.dependencies // {} | length' package.json 2>/dev/null || echo 0)"
devdep_count="$(jq -r '.devDependencies // {} | length' package.json 2>/dev/null || echo 0)"
pkg_name="$(jq -r '.name // ""' package.json 2>/dev/null || echo "")"
pkg_version="$(jq -r '.version // ""' package.json 2>/dev/null || echo "")"

# bundle sizes (the headline numbers)
src_raw=0; src_gz=0; src_br=0
pkgd_raw=0; pkgd_gz=0; pkgd_br=0
min_raw=0; min_gz=0; min_br=0

if [[ -f masonry.js ]]; then
  src_raw=$(bytes_raw masonry.js)
  src_gz=$(bytes_gzip masonry.js)
  src_br=$(bytes_brotli masonry.js)
fi
if [[ -f dist/masonry.pkgd.js ]]; then
  pkgd_raw=$(bytes_raw dist/masonry.pkgd.js)
  pkgd_gz=$(bytes_gzip dist/masonry.pkgd.js)
  pkgd_br=$(bytes_brotli dist/masonry.pkgd.js)
fi
if [[ -f dist/masonry.pkgd.min.js ]]; then
  min_raw=$(bytes_raw dist/masonry.pkgd.min.js)
  min_gz=$(bytes_gzip dist/masonry.pkgd.min.js)
  min_br=$(bytes_brotli dist/masonry.pkgd.min.js)
fi

# ---- print ------------------------------------------------------------------

printf '== masonry-pretext metrics ==\n'
printf 'package           %s@%s\n' "$pkg_name" "$pkg_version"
printf 'tracked files     %s\n' "$total_files"
printf 'total LOC         %s\n' "$total_loc"
printf 'dependencies      %s\n' "$dep_count"
printf 'devDependencies   %s\n' "$devdep_count"
printf '\n'
printf '  %-32s  %10s  %10s  %10s  %8s\n' "file" "raw" "gzip" "brotli" "lines"
printf '  %-32s  %10s  %10s  %10s  %8s\n' "----" "---" "----" "------" "-----"
file_row "masonry.js (source)"            masonry.js
file_row "dist/masonry.pkgd.js"           dist/masonry.pkgd.js
file_row "dist/masonry.pkgd.min.js"       dist/masonry.pkgd.min.js
printf '\n'

# ---- save -------------------------------------------------------------------

if [[ -n "$save" ]]; then
  mkdir -p metrics
  if [[ ! -f metrics/history.tsv ]]; then
    printf 'timestamp\tlabel\tcommit\tpkg_name\tpkg_version\tfiles\tloc\tdeps\tdev_deps\tsrc_raw\tsrc_gz\tsrc_br\tpkgd_raw\tpkgd_gz\tpkgd_br\tmin_raw\tmin_gz\tmin_br\n' \
      > metrics/history.tsv
  fi
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  commit="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$ts" "$save" "$commit" "$pkg_name" "$pkg_version" \
    "$total_files" "$total_loc" "$dep_count" "$devdep_count" \
    "$src_raw" "$src_gz" "$src_br" \
    "$pkgd_raw" "$pkgd_gz" "$pkgd_br" \
    "$min_raw" "$min_gz" "$min_br" \
    >> metrics/history.tsv
  printf 'saved row to metrics/history.tsv  (label=%s, commit=%s)\n' "$save" "$commit"
fi
