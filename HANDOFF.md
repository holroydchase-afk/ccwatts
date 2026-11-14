# Handoff
<!-- status
stage: beta
goal: portfolio
milestone: CCW-M4
now: GitHub hold lifted (Chase, Nov 13: "do whatever you need to do without me"). Method v0.1.1 PR open; working the stable-demo plan (/mnt/project-files/ccwatts-reviews/2026-11-13-stable-demo-plan.md), a few pushes a day
next: merge LIVE-CHECK on green; then publish 0.2.0 once Chase re-adds the npm Trusted Publisher (issue #38); later majors TS 7, tsup 9, zod 4
waiting_on_chase:
  - Re-add the npm Trusted Publisher, then run Publish for 0.2.0 (issue #38)
  - Go on M4.7 Leverage (proposed in IDEAS.md)
  - Repo settings: turn on secret scanning and push protection; add the npm-publish environment
blockers: []
-->

Live status for whoever picks up the build next (human or Claude). Updated every push. Keep this file under 8 KB: dated history goes to `docs/history/HANDOFF-archive.md` (Done log, old decisions, planning-ID map), and `git log` has the rest.

## Portfolio / public presence
- 2026-11-13: the playground hero now reads "Claude Code electricity · a sample month" (was "last 30 days" over fixed Sep–Oct sample dates, which looked stale). Footer reads method v0.1.1 after PR #93. Portfolio copy unaffected.
- 2026-11-06: portfolio ccwatts page redesigned in the new shared product-page template (holroydchase-afk.github.io PR #56, merged): range-bar check against Hausfather (METHODOLOGY.md numbers, token mix labeled illustrative), proof, try-it commands. The page says npm has the CLI (0.1.1 live) and that 0.2.0 waits on the Trusted Publisher; update it when 0.2.0 publishes (Product Studio).
- 2026-11-05: the playground's try-it line now says "with Node 22+" (was 20+) once NODE-22 merges and Pages deploys. If the portfolio mentions a Node version, update it (Product Studio).
- 2026-11-02: the playground footer will read v0.2.0 after this merges and Pages deploys. Portfolio page refresh (stale screenshot, add Pace + nudge) filed as holroydchase-afk.github.io intake #48.
- **Portfolio page:** https://chaseholroyd.com/ccwatts.html (source: `tools/build.py` in `holroydchase-afk.github.io`). It links the playground and this repo.
- **Live playground:** https://chaseholroyd.com/ccwatts/, deployed from this repo's `main` by `.github/workflows/pages.yml`. Deploys have succeeded since Oct 21, so CCW-M1.9 is live.
- **Demo data:** the playground opens on labeled synthetic sample data. Visitors can pick their own `.jsonl` files, which are parsed in the browser and never uploaded.
- **Studio-wide status** (portfolio, domain, every demo, what's waiting on Chase): https://github.com/holroydchase-afk/pm-tools/blob/main/STUDIO-STATUS.md
- **Keep in sync:** when a change here alters what the portfolio page or demo shows (features, numbers, screenshots, privacy claims), tell the portfolio thread ("Portfolio research and upgrade plan") or update the page in `holroydchase-afk.github.io` (`tools/build.py`). Any portfolio change that touches this product adds a dated line here.
- Older lines: `docs/history/HANDOFF-archive.md`.

## Done (latest only; full log in the archive)
- 2026-11-14: LIVE-CHECK: pages.yml gains a live-check job after deploy that runs `npm run check:live` (read-only, contents: read, retries ~11 min for the Pages cache). Architect review: ARCH-R1 (retry window) and R4 (no write permissions, tested) fixed; R2 (commit SHA in page) and R3 (pass page_url) left as P2.
- 2026-11-13: GitHub hold lifted (Chase). Merged #91, #92 and method v0.1.1 (#93). DEMO-DATES: sample windows say "a sample month / week" instead of "last 30 / 7 days"; your own data keeps "last N days"; the share card keeps its wording.
- 2026-11-10: method v0.1.1 drafted (not pushed, GitHub hold). Compared ccwatts with 6 open-source Claude Code estimators and read Jegham et al. (2505.09598), Epoch AI, TokenPowerBench, GreenCache and EcoLogits. No parameter values changed: params notes cite Epoch and Jegham, Chase chose to keep ranges, not widen them (Nov 10). METHODOLOGY.md gains "How ccwatts compares" and a correlated-parameters open question, and a new sanity test keeps the other tools' heavy-agentic-day totals (0.85–1.6 kWh) inside our range. CLAUDE.md's example greeting said "Charlie's chief of staff"; now CCWatts. Survey: /mnt/project-files/ccwatts-reviews/2026-11-09-similar-tools-and-sources.md.
- 2026-11-05: HANDOFF.md trimmed from about 59 KB to a short status page (Chase's efficiency review: every session and subagent read the whole file first). The full Done log, every old decision and the planning-ID map moved word for word to `docs/history/HANDOFF-archive.md`. CCWatts' Intake check and the disabled night shift scheduled tasks were deleted (Chase: "Cut"); intakes for this repo get picked up when Chase opens the project. Dev work stays on the most capable model (Chase, Nov 5).
- 2026-11-05: NODE-22 (PR #89): minimum Node 22, vitest 5, @types/node 22.
- 2026-11-02: 0.2.0 bumped (Pace, bedtime nudge, MCP server); publish waits on the npm Trusted Publisher (issue #38).

## In progress
- Method v0.1.1 PR (this one). Hold lifted Nov 13; restart slowly: one thread, a few pushes a day, no bursts. Stable-demo plan (Nov 13): playground passes check:live; P0 is npm still on 0.1.1 while the page shows Pace and v0.2.0.

## Exact next step
1. Chase merges #89, then this PR.
2. Chase re-adds the npm Trusted Publisher (holroydchase-afk / ccwatts / publish.yml / environment blank), then Actions → Publish → Run workflow on main with confirm_version 0.2.0. After it publishes: Pages redeploys the footer, run `npm run check:live`, tick issue #38 (release-captain REL-1).
3. Then only on Chase's go: M4.7 Leverage (IDEAS.md); held majors TS 7, tsup 9, zod 4 (one planned task each).
- The old, longer next-step list is in the archive; most of it shipped.

## Decisions to review (open only; settled ones are in the archive)
- Pace on the public playground (Oct 31): ANCHORS D10 says no public pieces before the friend beta; Chase's recruiter-ready ask overrode it for the sample-only Pace section. Say "hold M4.5" to take it off the live page.
- Proposed ANCHORS D15 (architect, Oct 31; not in ANCHORS until Chase says yes): Pace keeps daily counts in a separate local `~/.ccwatts/pace.jsonl`, counts only, never shared without `--share-pace`.

- Repo settings only Chase can change: secret scanning and push protection on; an `npm-publish` environment (required reviewer: Chase, branch main), then `environment: npm-publish` in `publish.yml`.

## Blockers
- npm Trusted Publisher (step 2 above).
- M2.1 local run needs Chase to use Claude Code on his Mac (parser already verified on real cloud logs, Oct 23). Not blocking.
