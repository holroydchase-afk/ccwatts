# Handoff
<!-- status
stage: beta
goal: portfolio
milestone: CCW-M4
now: HANDOFF trimmed to a status page (history in docs/history/HANDOFF-archive.md); NODE-22 PR #89 open
next: Chase merges the NODE-22 PR; then publish 0.2.0 once Chase re-adds the npm Trusted Publisher (issue #38); later majors TS 7, tsup 9, zod 4
waiting_on_chase:
  - Re-add the npm Trusted Publisher, then run Publish for 0.2.0 (issue #38)
  - Go on M4.7 Leverage (proposed in IDEAS.md)
  - Repo settings: turn on secret scanning and push protection; add the npm-publish environment
blockers: []
-->

Live status for whoever picks up the build next (human or Claude). Updated every push. Keep this file under 8 KB: dated history goes to `docs/history/HANDOFF-archive.md` (Done log, old decisions, planning-ID map), and `git log` has the rest.

## Portfolio / public presence
- 2026-11-05: the playground's try-it line now says "with Node 22+" (was 20+) once NODE-22 merges and Pages deploys. If the portfolio mentions a Node version, update it (Product Studio).
- 2026-11-02: the playground footer will read v0.2.0 after this merges and Pages deploys. Portfolio page refresh (stale screenshot, add Pace + nudge) filed as holroydchase-afk.github.io intake #48.
- **Portfolio page:** https://chaseholroyd.com/ccwatts.html (source: `tools/build.py` in `holroydchase-afk.github.io`). It links the playground and this repo.
- **Live playground:** https://chaseholroyd.com/ccwatts/, deployed from this repo's `main` by `.github/workflows/pages.yml`. Deploys have succeeded since Oct 21, so CCW-M1.9 is live.
- **Demo data:** the playground opens on labeled synthetic sample data. Visitors can pick their own `.jsonl` files, which are parsed in the browser and never uploaded.
- **Studio-wide status** (portfolio, domain, every demo, what's waiting on Chase): https://github.com/holroydchase-afk/pm-tools/blob/main/STUDIO-STATUS.md
- **Keep in sync:** when a change here alters what the portfolio page or demo shows (features, numbers, screenshots, privacy claims), tell the portfolio thread ("Portfolio research and upgrade plan") or update the page in `holroydchase-afk.github.io` (`tools/build.py`). Any portfolio change that touches this product adds a dated line here.
- Older lines: `docs/history/HANDOFF-archive.md`.

## Done (latest only; full log in the archive)
- 2026-11-05: HANDOFF.md trimmed from about 59 KB to a short status page (Chase's efficiency review: every session and subagent read the whole file first). The full Done log, every old decision and the planning-ID map moved word for word to `docs/history/HANDOFF-archive.md`. CCWatts' Intake check and the disabled night shift scheduled tasks were deleted (Chase: "Cut"); intakes for this repo get picked up when Chase opens the project. Dev work stays on the most capable model (Chase, Nov 5).
- 2026-11-05: NODE-22 (PR #89): minimum Node 22, vitest 5, @types/node 22.
- 2026-11-02: 0.2.0 bumped (Pace, bedtime nudge, MCP server); publish waits on the npm Trusted Publisher (issue #38).

## In progress
- PR #89 (NODE-22) open for Chase. This PR stacks on it.

## Exact next step
1. Chase merges #89, then this PR.
2. Chase re-adds the npm Trusted Publisher (holroydchase-afk / ccwatts / publish.yml / environment blank), then Actions → Publish → Run workflow on main with confirm_version 0.2.0. After it publishes: Pages redeploys the footer, run `npm run check:live`, tick issue #38 (release-captain REL-1).
3. Then only on Chase's go: M4.7 Leverage (IDEAS.md); held majors TS 7, tsup 9, zod 4 (one planned task each).
- The old, longer next-step list is in the archive; most of it shipped.

## Decisions to review (open only; settled ones are in the archive)
- Pace on the public playground (Oct 31): ANCHORS D10 says no public pieces before the friend beta; Chase's recruiter-ready ask overrode it for the sample-only Pace section. Say "hold M4.5" to take it off the live page.
- Proposed ANCHORS D15 (architect, Oct 31; not in ANCHORS until Chase says yes): Pace keeps daily counts in a separate local `~/.ccwatts/pace.jsonl`, counts only, never shared without `--share-pace`.
- Pace method version (Oct 31): params.json gained a `pace` section but `version` stays 0.1.0 because energy numbers didn't change. Say "bump to 0.1.1" for the strict reading of METHODOLOGY's rule.
- Repo settings only Chase can change: secret scanning and push protection on; an `npm-publish` environment (required reviewer: Chase, branch main), then `environment: npm-publish` in `publish.yml`.

## Blockers
- npm Trusted Publisher (step 2 above).
- M2.1 local run needs Chase to use Claude Code on his Mac (parser already verified on real cloud logs, Oct 23). Not blocking.
