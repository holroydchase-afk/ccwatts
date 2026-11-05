# Lessons

Post mortems, newest first: what happened, why, and the rule or guard it added. Write one after any lost evening, broken demo or wrong call. Read this before picking a version or calling a build ready.

## 2026-11-01: a studio re-sync rewrites our TypeScript tool names
**What:** `sync.sh` put `node scripts/ux-rules.mjs` back into `ux-reviewer.md`, and `install-rules.sh` re-added `scripts/check-logs.mjs`, which the all-TypeScript rule (TS-1a) rejects.
**Why:** studio-agents still ships `.mjs` tools, and ccwatts had hand-edited its agent files.
**Guard:** agent files stay exactly as synced; the `.ts` names live in [AGENT-NOTES.md](AGENT-NOTES.md). After every sync, delete any new `scripts/*.mjs` and run `npm test` (TS-1a fails on it).

## 2026-11-01: Pace read Sunday as a full week
**What:** on Sundays the weekly lead line treated the current week as complete, so the PACE-C1 test fails on Sundays.
**Guard:** the "(partial)" fix is in PR #85 (open). Date logic gets a test for each weekday edge; a suite that passes Monday to Saturday is not green.

## 2026-10-29: Dependabot majors broke the build
**What:** TypeScript 7, tsup 9, vitest 5, zod 4 and @types/node majors each failed CI or need Node 22.
**Guard:** `dependabot.yml` ignores those majors; they move together as one planned task after a Node 22 decision. Dependabot PRs touching the MCP SDK or zod must rebuild and commit `plugins/ccwatts/bin`. Look versions up on the registry, never from memory.

## 2026-10-29: tsx breaks named functions inside `page.evaluate`
**What:** after the TypeScript move, Playwright checks failed with `__name is not defined`.
**Guard:** code passed to `page.evaluate` declares no named functions (written into the showcase kit README).

## 2026-10-28: an unreadable log stopped every command and leaked a path
**What:** privacy-security's hostile-log review found one bad file stopped the CLI and put the full home path into MCP answers.
**Guard:** unreadable files are skipped and counted by reason code; errors print reason codes, never raw fs messages (`check-logs` in CI).

## 2026-10-23: `--path` merged sample data into real history
**What:** the README told people to try the sample with `--path`, which wrote synthetic days into `~/.ccwatts/history.jsonl` for good.
**Guard:** `--path` and `--demo` never read or write history (CCW-H1 test).

## 2026-10-21: the npm package depended on an unpublished package
**What:** `npm install` of the CLI tarball 404'd on `@ccwatts/core`.
**Guard:** core is bundled and a devDependency; a test fails if the CLI has any runtime dependency; a clean `npm pack` install runs before every release (release-captain).

## 2026-10-22: "verified live" from a container that couldn't reach the site
**What:** the custom domain served the `*.github.io` certificate from the cloud, so the live page couldn't be checked for days.
**Guard:** "verified" only for what ran this session; `npm run check:live` loads the real URL in Chromium before calling a deploy done.
