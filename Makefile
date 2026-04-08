# masonry-pretext — common project commands
#
# Wraps the npm scripts and the measurement helper. The npm scripts are still
# available directly (`npm run build`, `npm test`, etc.) — this Makefile is the
# preferred entry point because it gives one stable interface across the
# different toolchains used in the wider project ecosystem (Astro, Next,
# Django, etc.).
#
# Run `make help` to list targets.

.PHONY: help start install build test test-update measure clean ci

# Default target shows help so a bare `make` is non-destructive.
help:
	@echo -e ""
	@echo -e "  \033[1mmasonry-pretext\033[0m — make targets"
	@echo -e ""
	@echo -e "  \033[36mmake start\033[0m         build + test (assumes deps already installed)"
	@echo -e "  \033[36mmake install\033[0m       npm install + download chromium for Playwright"
	@echo -e "  \033[36mmake build\033[0m         bundle dist/masonry.pkgd.{js,min.js} via esbuild"
	@echo -e "  \033[36mmake test\033[0m          run the visual regression suite (rebuilds first)"
	@echo -e "  \033[36mmake test-update\033[0m   refresh visual snapshots (commit them with the source change)"
	@echo -e "  \033[36mmake measure\033[0m       print size / LOC / dep metrics"
	@echo -e "  \033[36mmake clean\033[0m         delete dist artifacts and visual diff outputs"
	@echo -e "  \033[36mmake ci\033[0m            install + build + test (the gate every commit must pass)"
	@echo -e ""
	@echo -e "  See \033[36mFORK_ROADMAP.md\033[0m for the change-loop methodology before editing source."
	@echo -e ""

# `make start` is the standard "I just want to verify everything works" command.
# For a library this means: rebuild from source, run the regression suite. It
# does not install — use `make install` (or `make ci`) on a fresh checkout.
start: build test

install:
	npm install
	npx playwright install chromium

build:
	@node scripts/build.mjs

test: build
	@node test/visual/run.mjs
	@echo
	@node test/visual/ssr-smoke.mjs

test-update: build
	@node test/visual/run.mjs --update
	@echo
	@node test/visual/ssr-smoke.mjs

measure:
	@./scripts/measure.sh

clean:
	@rm -f dist/masonry.pkgd.js dist/masonry.pkgd.min.js
	@rm -f test/visual/__screenshots__/*.actual.png
	@rm -f test/visual/__screenshots__/*.diff.png
	@echo -e "  \033[32mcleaned\033[0m  dist artifacts and visual diff outputs"

# Full from-scratch verification — what CI should run.
ci: install build test
	@echo -e "  \033[32mci ok\033[0m   install + build + test all green"
