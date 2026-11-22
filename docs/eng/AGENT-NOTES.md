# Agent notes (ccwatts)

Project facts the studio agents need, kept here so a `sync.sh` never wipes them. Never hand-edit `.claude/agents/`; the chief of staff passes the matching section to each agent. Re-check this file after every studio sync.

## All agents
- The repo is all TypeScript (TS-1). Where a synced agent says `node scripts/<tool>.mjs` or `node tools/<tool>.mjs`, run `npx tsx scripts/<tool>.ts` here. Never add a `.mjs`, `.js` or `.cjs` file; TS-1a fails `npm test` on one.
- Hard rules in CLAUDE.md win: no network, counts only, no full paths, every number has a range and method version.
- Any screen, word or CLI output a user sees follows the studio design system in `docs/design/` (see the ux-reviewer section).
- Playwright isn't a dependency. In the cloud, set `PLAYWRIGHT_MODULE=/opt/node22/lib/node_modules/playwright/index.mjs` for `npm run check:browser`.

## qa-tdd
- Suites: `npm test` (builds the web page first, then vitest), `npm run typecheck`, `npm run check:browser`, `npm run check:release`, `npm run check:kit`. `studio-checks.json` `agents.verify` is `npm test`, rerun 3x on CI.
- QA report checker: `npx tsx scripts/check-qa-report.ts <report>`.
- `npm run coverage` measures coverage (v8, text report over `packages/*/src`).
- CLI `index.ts`, `mcp.ts`, `nudge.ts` and web `app.ts` read 0% because their tests run the built binary in a subprocess or a real browser, so read the `packages/core` numbers as the meaningful ones.

## ux-reviewer
- **Design system:** every screen follows the studio design system, vendored in `docs/design/` (`STUDIO-CORE.md` rules, `tokens.json`, `themes.css`; source and refresh steps in `docs/design/README.md`). STUDIO-CORE section 2 principles bind; changing one needs Chase's ask. The playground's implementation is guarded by `packages/web/test/design-system.test.ts` (DS-0..DS-9).
- Rules check: `npx tsx scripts/ux-rules.ts <page> [--click SEL]`. Screenshots: `npx tsx scripts/ux-shots.ts <page> --no-network` (ccwatts promises zero requests).
- Built page: `packages/web/dist/ccwatts.html`; live: https://chaseholroyd.com/ccwatts/ (`npm run check:live`).
- `check-findings` and the story-keeper's `check-story-entry` aren't ported to TypeScript yet; skip them rather than adding the `.mjs`.

## release-captain (project-only agent)
- `npx tsx scripts/check-release.ts`; publish only from `.github/workflows/publish.yml` on Chase's go. Trusted Publishing must be set up first (issue #38).

## story-keeper
- Mirror entries to [docs/STORY.md](../STORY.md). No personal data, ids or claude.ai links in the repo copy.
