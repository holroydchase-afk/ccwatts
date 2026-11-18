# Handoff
<!-- status
stage: beta
goal: portfolio
milestone: CCW-M4
now: Portfolio review done Nov 18 (the review doc lives in the project, not the repo). EVAL PR open: eval scorecard (docs/EVALS.md), method v0.1.2
next: design doc (docs/DESIGN.md), then README refocus and release hygiene (tags, CHANGELOG, GitHub Release v0.2.0, close #38), then friend beta kit
waiting_on_chase:
  - Go to merge the EVAL PR (method v0.1.2 changes the playground footer)
  - Go on M4.7 Leverage (proposed in IDEAS.md)
  - Repo settings: turn on secret scanning and push protection; add the npm-publish environment
blockers: []
-->

Live status for whoever picks up the build next (human or Claude). Updated every push. Keep this file under 8 KB: dated history goes to `docs/history/HANDOFF-archive.md` (Done log, old decisions, planning-ID map), and `git log` has the rest.

## Portfolio / public presence
- 2026-11-18: after the EVAL PR merges and Pages deploys, the playground footer reads method v0.1.2. The portfolio page's "Status" line is stale (it says 0.2.0 waits on npm); an INTAKE was written for Product Studio.
- 2026-11-13: the playground hero now reads "Claude Code electricity · a sample month" (was "last 30 days" over fixed Sep–Oct sample dates, which looked stale). Footer reads method v0.1.1 after PR #93. Portfolio copy unaffected.
- **Portfolio page:** https://chaseholroyd.com/ccwatts.html (source: `tools/build.py` in `holroydchase-afk.github.io`). It links the playground and this repo.
- **Live playground:** https://chaseholroyd.com/ccwatts/, deployed from this repo's `main` by `.github/workflows/pages.yml`. Deploys have succeeded since Oct 21, so CCW-M1.9 is live.
- **Demo data:** the playground opens on labeled synthetic sample data. Visitors can pick their own `.jsonl` files, which are parsed in the browser and never uploaded.
- **Studio-wide status** (portfolio, domain, every demo, what's waiting on Chase): https://github.com/holroydchase-afk/pm-tools/blob/main/STUDIO-STATUS.md
- **Keep in sync:** when a change here alters what the portfolio page or demo shows (features, numbers, screenshots, privacy claims), tell the portfolio thread ("Portfolio research and upgrade plan") or update the page in `holroydchase-afk.github.io` (`tools/build.py`). Any portfolio change that touches this product adds a dated line here.
- Older lines: `docs/history/HANDOFF-archive.md`.

## Done (latest only; full log in the archive)
- 2026-11-18: EVAL (built, PR open). `npm run evals` writes `docs/EVALS.md` from `evals/models.json` and `evals/cases.json`: model coverage (8 ids), 4 reference checks with assumed inputs labeled, and a sensitivity table. `npx tsx scripts/run-evals.ts --check` and `packages/core/test/evals.test.ts` fail on a stale file or a failed check. It found two things: Fable and Mythos ids were priced as Sonnet (half of Opus), now the Opus tier as a floor (method v0.1.2, no parameter values changed); and Opus output energy drives about 37% of the heavy-day log range, cache reads about 24%. `--by` tables now print the unknown-model note. METHODOLOGY, README, LESSONS, MARKETING and STORY updated.
- 2026-11-16: PUBLISHED ccwatts@0.2.0 on npm with provenance (Chase re-added the Trusted Publisher and ran Publish; run 43902387836). Verified with an empty HOME: `npx ccwatts@0.2.0 --version`, `--demo`, `pace --demo`, `nudge --preview`, and `mcp --demo` over stdio (initialize, tools/list, energy_summary). README "not on npm yet" labels removed. Issue #38 can close. Next: GitHub Release v0.2.0 and the portfolio INTAKE (box C in the stable-demo plan).
- 2026-11-16: INTERVIEW-READY (Chase has an interview today). Verified live: playground passes check:live and every control works (windows, What-if slider, Pace, Save PNG, own-file load), no console errors; `npx ccwatts@0.1.1 --demo` and `history --demo` work. Half-baked for a visitor: README showed `npx ccwatts pace`/`nudge`/`mcp`, which 0.1.1 doesn't have; README now labels them "in v0.2.0, not on npm yet" and points to the plugin or a source build. Repo About box is still empty (Chase, box B in the stable-demo plan).

## In progress
- EVAL PR (this one): waits on Chase's go, because method v0.1.2 changes the playground footer.
- Pace of work (since the hold lifted Nov 13): one thread, a few pushes a day, no bursts.

## Exact next step
1. Chase gives the go; merge the EVAL PR; check the playground footer reads method v0.1.2 (`npm run check:live`).
2. Design doc (`docs/DESIGN.md`).
3. README refocus and release hygiene: tags, CHANGELOG, GitHub Release v0.2.0, close issue #38.
4. Friend beta kit. Only on Chase's go: M4.7 Leverage (IDEAS.md); held majors TS 7, tsup 9, zod 4 (one planned task each).

## Decisions to review (open only; settled ones are in the archive)
- Microsoft Research figure (Nov 18): the paper's abstract now reads 0.31 Wh (IQR 0.16–0.60); README, PLAN, MARKETING and one params note still say 0.34 (0.18–0.67), recorded Oct 21 with no URL. The scorecard and METHODOLOGY use the current figure and link. Say "update 0.34" to change the rest (the portfolio page too, via INTAKE).
- Fable and Mythos priced at the Opus tier as a floor (Nov 18; Claude's default, per PLAN "nearest tier"). Say "own tier" to give them their own sourced parameter.
- The playground's What-if copy calls cache-read cost "the least certain assumption"; the scorecard shows Opus output energy drives more of the range. Copy left unchanged pending Chase.
- Pace on the public playground (Oct 31): ANCHORS D10 says no public pieces before the friend beta; Chase's recruiter-ready ask overrode it for the sample-only Pace section. Say "hold M4.5" to take it off the live page.
- Proposed ANCHORS D15 (architect, Oct 31; not in ANCHORS until Chase says yes): Pace keeps daily counts in a separate local `~/.ccwatts/pace.jsonl`, counts only, never shared without `--share-pace`.

- Repo settings only Chase can change: secret scanning and push protection on; an `npm-publish` environment (required reviewer: Chase, branch main), then `environment: npm-publish` in `publish.yml`.

## Blockers
- M2.1 local run needs Chase to use Claude Code on his Mac (parser already verified on real cloud logs, Oct 23). Not blocking.
