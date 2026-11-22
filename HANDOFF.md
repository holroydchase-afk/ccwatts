# Handoff
<!-- status
stage: beta
goal: portfolio
milestone: CCW-M4
now: GitHub hold lifted (Chase, Nov 13: "do whatever you need to do without me"). Method v0.1.1 PR open; working the stable-demo plan (/mnt/project-files/ccwatts-reviews/2026-11-13-stable-demo-plan.md), a few pushes a day
next: 0.2.0 is on npm (Nov 16); post the v0.2.0 GitHub Release and send the portfolio INTAKE; later majors TS 7, tsup 9, zod 4
waiting_on_chase:
  - Go on M4.7 Leverage (proposed in IDEAS.md)
  - Repo settings: turn on secret scanning and push protection; add the npm-publish environment
blockers: []
-->

Live status for whoever picks up the build next (human or Claude). Updated every push. Keep this file under 8 KB: dated history goes to `docs/history/HANDOFF-archive.md` (Done log, old decisions, planning-ID map), and `git log` has the rest.

## Portfolio / public presence
- 2026-11-22: PR #102 merged on Chase's go ("Merge"); Pages redeploys the playground with the Overview redesign. 2026-11-21: same PR #102 now opens the playground on an Overview roll-up (Electricity, Pace, What drives it, Share, Your logs) with 5 linkable tabs (#electricity, #pace, #share, #method) and the studio design system (Paper theme, Atkinson Hyperlegible Next, 17px minimum). Looks clearly different from the portfolio screenshot once deployed; tell Product Studio. Shots: /mnt/project-files/ccwatts-demo-2026-11-21/design-system/.
- 2026-11-21: playground visual refresh PR (tabs, range bar, Pace open on phones). Once merged and deployed, the portfolio page screenshot of the playground is stale; tell Product Studio. Before/after shots: /mnt/project-files/ccwatts-demo-2026-11-21/.
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
- 2026-11-19: COVERAGE (Chase asked, picked tests + command): `npm run coverage` (new devDependency @vitest/coverage-v8, same version as vitest; local only, not in CI). Core/src went 98.4% to 99.8% lines, 89.1% to 93.5% branches, with 23 characterization tests in packages/core/test/coverage-gaps.test.ts (COV-1 to COV-6: dropFuture, since, projectRef roots, adapter edges, mid-hour offset change in Pace, empty receipt). No product code changed. CLI index/mcp/nudge and web app.ts read 0% because their tests run the built binary or a real browser; caveat in docs/eng/AGENT-NOTES.md. Open: QA-R1 (P2), projectRef("C:\\") is named "C:" while "/" is "(root)".
- 2026-11-16: PUBLISHED ccwatts@0.2.0 on npm with provenance (Chase re-added the Trusted Publisher and ran Publish; run 43902387836). Verified with an empty HOME: `npx ccwatts@0.2.0 --version`, `--demo`, `pace --demo`, `nudge --preview`, and `mcp --demo` over stdio (initialize, tools/list, energy_summary). README "not on npm yet" labels removed. Issue #38 can close. Next: GitHub Release v0.2.0 and the portfolio INTAKE (box C in the stable-demo plan).
- 2026-11-16: INTERVIEW-READY (Chase has an interview today). Verified live: playground passes check:live and every control works (windows, What-if slider, Pace, Save PNG, own-file load), no console errors; `npx ccwatts@0.1.1 --demo` and `history --demo` work. Half-baked for a visitor: README showed `npx ccwatts pace`/`nudge`/`mcp`, which 0.1.1 doesn't have; README now labels them "in v0.2.0, not on npm yet" and points to the plugin or a source build. Repo About box is still empty (Chase, box B in the stable-demo plan).
- 2026-11-14: LIVE-CHECK: pages.yml gains a live-check job after deploy that runs `npm run check:live` (read-only, contents: read, retries ~11 min for the Pages cache). Architect review: ARCH-R1 (retry window) and R4 (no write permissions, tested) fixed; R2 (commit SHA in page) and R3 (pass page_url) left as P2.
- 2026-11-13: GitHub hold lifted (Chase). Merged #91, #92 and method v0.1.1 (#93). DEMO-DATES: sample windows say "a sample month / week" instead of "last 30 / 7 days"; your own data keeps "last N days"; the share card keeps its wording.
- 2026-11-10: method v0.1.1 drafted (not pushed, GitHub hold). Compared ccwatts with 6 open-source Claude Code estimators and read Jegham et al. (2505.09598), Epoch AI, TokenPowerBench, GreenCache and EcoLogits. No parameter values changed: params notes cite Epoch and Jegham, Chase chose to keep ranges, not widen them (Nov 10). METHODOLOGY.md gains "How ccwatts compares" and a correlated-parameters open question, and a new sanity test keeps the other tools' heavy-agentic-day totals (0.85–1.6 kWh) inside our range. CLAUDE.md's example greeting said "Charlie's chief of staff"; now CCWatts. Survey: /mnt/project-files/ccwatts-reviews/2026-11-09-similar-tools-and-sources.md.
- 2026-11-05: HANDOFF.md trimmed from about 59 KB to a short status page (Chase's efficiency review: every session and subagent read the whole file first). The full Done log, every old decision and the planning-ID map moved word for word to `docs/history/HANDOFF-archive.md`. CCWatts' Intake check and the disabled night shift scheduled tasks were deleted (Chase: "Cut"); intakes for this repo get picked up when Chase opens the project. Dev work stays on the most capable model (Chase, Nov 5).
- 2026-11-05: NODE-22 (PR #89): minimum Node 22, vitest 5, @types/node 22.
- 2026-11-02: 0.2.0 bumped (Pace, bedtime nudge, MCP server); publish waits on the npm Trusted Publisher (issue #38).

## In progress
- 2026-11-21 STUDIO-DS (same PR #102; engineer): the playground and `ccwatts dashboard` follow the studio design system (hearth STUDIO-CORE.md, Paper theme, Atkinson Hyperlegible Next inlined as a data: font, CSP `font-src data:`). 5 tabs at the top: Overview (default, a grouped list of rows #ov-energy/#ov-pace/#ov-drives/#ov-share/#ov-logs), Electricity (statement, chart, by model/project, what drives it + What if), Pace, Share, Method. Hashes #electricity #pace #share #method #drop, Back works. 17px floor, weights 400/500/600, 48px targets, 4/12/pill corners, 4px grid; chart data in ink/ochre/brown, never the accent; high contrast via prefers-contrast:more; Light/Dark/System in the footer, in memory only (PS-R1: no browser storage; reload returns to System). design-system.test.ts DS-0..DS-9 green; old refresh/page/pace-web tests and check-no-network rewritten to the new design (R49/R52 radii/R57 retired for DS-3/DS-5). Next: qa-tdd 3x, ux-reviewer, privacy-security (localStorage), then Chase's go to merge. Fix round (PS-R1, UX-R61..R64): h1 22/28 everywhere, Overview kWh 34/40, overview list full width under the tab line, 320px tab fade + scroll-into-view, Your logs row says "Drop in a log folder or .jsonl files". Open for Chase: the share card (core receipt.ts) keeps its old green look.
- 2026-11-21 VISUAL-REFRESH (PR from branch claude/project-thread-60gx7n; merge changes the live playground, so it waits on Chase's go): playground and dashboard become a "utility bill": statement card (big number, log-scale range bar role=img, segmented window picker), then WAI-ARIA tabs (Breakdown, Pace, What if, Share, Method, Your logs in the playground). Driven by Chase (Nov 20): too much on one page, too much big text, too much grey text. Pace chart always shown; so-far week hatched; long notes folded behind details; 6-size type scale, 4 radii, no emoji. On phones the lede, privacy detail and #jump hide below 600px so tabs start above the fold. ux-reviewer 6/7 to 8/8 (390/1280); qa-tdd green 3x. Open P2s: UX-R59 chart caption still mono, UX-R60 Method details gap, QA-R7 assert End selects Your logs. #drop markup untouched (PR #101 conflicts expected only in plugin bundles and maybe template CSS).
- Method v0.1.1 PR (this one). Hold lifted Nov 13; restart slowly: one thread, a few pushes a day, no bursts. Stable-demo plan (Nov 13): playground passes check:live; P0 is npm still on 0.1.1 while the page shows Pace and v0.2.0.

## Exact next step
1. Chase merges #89, then this PR.
2. Done Nov 16: 0.2.0 published. Remaining: GitHub Release v0.2.0, close issue #38, portfolio INTAKE (box C in the stable-demo plan).
3. Then only on Chase's go: M4.7 Leverage (IDEAS.md); held majors TS 7, tsup 9, zod 4 (one planned task each).
- The old, longer next-step list is in the archive; most of it shipped.

## Decisions to review (open only; settled ones are in the archive)
- Pace on the public playground (Oct 31): ANCHORS D10 says no public pieces before the friend beta; Chase's recruiter-ready ask overrode it for the sample-only Pace section. Say "hold M4.5" to take it off the live page.
- Proposed ANCHORS D15 (architect, Oct 31; not in ANCHORS until Chase says yes): Pace keeps daily counts in a separate local `~/.ccwatts/pace.jsonl`, counts only, never shared without `--share-pace`.
- QA-R1 (P2, Nov 19): should a Windows drive root like `C:\` show as "(root)" the way `/` does? It shows "C:" today (no path leak). Say "root for Windows too" to change it.

- Repo settings only Chase can change: secret scanning and push protection on; an `npm-publish` environment (required reviewer: Chase, branch main), then `environment: npm-publish` in `publish.yml`.

## Blockers
- M2.1 local run needs Chase to use Claude Code on his Mac (parser already verified on real cloud logs, Oct 23). Not blocking.
