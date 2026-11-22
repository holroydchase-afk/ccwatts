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
- 2026-11-20: the playground gains a "Have a token count?" box (type a total like 88.8M, pick a model, get a kWh range with the mix assumed), in the Electricity tab under What if (merged onto main's tabbed design; the earlier phone fold for What if is dropped because tabs replaced the long page). Live once Chase gives the go and Pages deploys. Portfolio copy unaffected.
- 2026-11-22: PR #102 merged on Chase's go ("Merge"); Pages redeploys the playground with the Overview redesign. Also fixed a midnight-UTC flake in pace-cli PACE-C4 (fixture's 40 minutes crossed 00:00 UTC; now uses UTC+2 in the first hour of any UTC day). 2026-11-21: same PR #102 now opens the playground on an Overview roll-up (Electricity, Pace, What drives it, Share, Your logs) with 5 linkable tabs (#electricity, #pace, #share, #method) and the studio design system (Paper theme, Atkinson Hyperlegible Next, 17px minimum). Looks clearly different from the portfolio screenshot once deployed; tell Product Studio. Shots: /mnt/project-files/ccwatts-demo-2026-11-21/design-system/.
- **Portfolio page:** https://chaseholroyd.com/ccwatts.html (source: `tools/build.py` in `holroydchase-afk.github.io`). It links the playground and this repo.
- **Live playground:** https://chaseholroyd.com/ccwatts/, deployed from this repo's `main` by `.github/workflows/pages.yml`. Deploys have succeeded since Oct 21, so CCW-M1.9 is live.
- **Demo data:** the playground opens on labeled synthetic sample data. Visitors can pick their own `.jsonl` files, which are parsed in the browser and never uploaded.
- **Studio-wide status** (portfolio, domain, every demo, what's waiting on Chase): https://github.com/holroydchase-afk/pm-tools/blob/main/STUDIO-STATUS.md
- **Keep in sync:** when a change here alters what the portfolio page or demo shows (features, numbers, screenshots, privacy claims), tell the portfolio thread ("Portfolio research and upgrade plan") or update the page in `holroydchase-afk.github.io` (`tools/build.py`). Any portfolio change that touches this product adds a dated line here.
- Older lines: `docs/history/HANDOFF-archive.md`.

## Done (latest only; full log in the archive)
- 2026-11-22: STUDIO-WIRING (#104, spec docs/product/SPEC-STUDIO-WIRING.md): cloud threads can now run studio agents as general-purpose via `scripts/agent-prompt.sh` and log them with `log-agent-run.sh --as <agent>` ("<time> <agent> via-general-purpose", accepted by check-agent-runs.sh); agents-check.yml gains the "qa-tdd cannot be skipped" rule on code PRs (only "docs only" / "config only" skips pass), pinned SHAs and npm build kept; CLAUDE.md's Studio agents section now matches templates/CLAUDE-agents.md (CCWatts greeting, release-captain row, check-qa-report.ts line and AGENT-NOTES pointer kept). Next: qa-tdd green 3x, then the PR with qa-tdd really run.
- 2026-11-22: DESIGN-SYSTEM VENDORED: the studio design system (hearth `docs/design/` STUDIO-CORE.md, tokens.json, themes.css at 58fe9ad) now lives in `docs/design/` with a README (source, refresh steps), and `docs/eng/AGENT-NOTES.md` points every agent at it. Before this, agents in this repo had no copy and only HANDOFF mentioned it. Same day: demo-focus review (ux-reviewer + staff-pm) of the busy playground, 28 shots in /mnt/project-files/ccwatts-demo-2026-11-22/; report in thread "Simplify the demo's focus and CTAs". Next: Chase picks which cuts to build.
- 2026-11-20: EST, enter a token count (Chase, Nov 19: "I could look at my Opus 5 thread and see it has 88.8M tokens"). `ccwatts estimate 88.8M --model opus` (reads no logs, writes nothing) and a playground box. Core `estimateFromTotal`/`parseTokenCount` (packages/core/src/manual.ts). A total hides the token mix, so params.json gains `token_mix` (measured on 6 counts-only cloud sessions: central, light and heavy mixes); low uses the light mix, high the heavy mix. 88.8M on Opus = 4.8 kWh (range 0.51 to 22.8). Method version not bumped (PR #98 bumps to 0.1.2; whichever merges second reconciles and rebuilds plugin bundles). qa-tdd red first (EST-1 to EST-20), ux-reviewer UX-R28 to R33 fixed test-first. VISION problem 6, IDEAS (2 entries), METHODOLOGY "Estimating from a total".

## In progress
- 2026-11-22 EST on STUDIO-DS (PR #101, merged origin/main with #102): the "Have a token count?" box now sits in the Electricity tab after What if, in design-system tokens (17px floor, 48px inputs, 12px corners, no accent on the result). EST-20 (UX-R30 What-if fold) retired by the tabs and rewritten: What if and the box stay in #p-electricity, not the Overview; check:browser EST-17 opens the Electricity tab first. Next: qa-tdd 3x, ux-reviewer on the box, then Chase's go. UX-R65 to R67 (ux-reviewer, test-first EST-21 to 24): What if gets its own 22px h2 beside the token box (label now "Cache-read cost", sharing the row so the Electricity tab stays at the 1900px budget), the box hint comes first, pretty wrap. Waits on Chase's go.

## Exact next step
0. Chase's go to merge the EST PR (changes the live playground). Then a second PR: the cloud-session prompt (Claude runs `npx -y ccwatts@latest` and replies; staff-pm scope + ux-reviewer copy, UX-R20 to R27) on the playground and README. Then check a fresh ccwatts thread saved its counts to /mnt/project-files/ccwatts-usage/.
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
