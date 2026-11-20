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
- 2026-11-20: the playground gains a "Have a token count?" box (type a total like 88.8M, pick a model, get a kWh range with the mix assumed), and the What-if slider folds on phones under "What if cache reads cost more or less?". Live once Chase gives the go and Pages deploys. Portfolio copy unaffected.
- 2026-11-13: the playground hero now reads "Claude Code electricity · a sample month" (was "last 30 days" over fixed Sep–Oct sample dates, which looked stale). Footer reads method v0.1.1 after PR #93. Portfolio copy unaffected.
- 2026-11-06: portfolio ccwatts page redesigned in the new shared product-page template (holroydchase-afk.github.io PR #56, merged): range-bar check against Hausfather (METHODOLOGY.md numbers, token mix labeled illustrative), proof, try-it commands. The page says npm has the CLI (0.1.1 live) and that 0.2.0 waits on the Trusted Publisher; update it when 0.2.0 publishes (Product Studio).
- **Portfolio page:** https://chaseholroyd.com/ccwatts.html (source: `tools/build.py` in `holroydchase-afk.github.io`). It links the playground and this repo.
- **Live playground:** https://chaseholroyd.com/ccwatts/, deployed from this repo's `main` by `.github/workflows/pages.yml`. Deploys have succeeded since Oct 21, so CCW-M1.9 is live.
- **Demo data:** the playground opens on labeled synthetic sample data. Visitors can pick their own `.jsonl` files, which are parsed in the browser and never uploaded.
- **Studio-wide status** (portfolio, domain, every demo, what's waiting on Chase): https://github.com/holroydchase-afk/pm-tools/blob/main/STUDIO-STATUS.md
- **Keep in sync:** when a change here alters what the portfolio page or demo shows (features, numbers, screenshots, privacy claims), tell the portfolio thread ("Portfolio research and upgrade plan") or update the page in `holroydchase-afk.github.io` (`tools/build.py`). Any portfolio change that touches this product adds a dated line here.
- Older lines: `docs/history/HANDOFF-archive.md`.

## Done (latest only; full log in the archive)
- 2026-11-20: EST, enter a token count (Chase, Nov 19: "I could look at my Opus 5 thread and see it has 88.8M tokens"). `ccwatts estimate 88.8M --model opus` (reads no logs, writes nothing) and a playground box. Core `estimateFromTotal`/`parseTokenCount` (packages/core/src/manual.ts). A total hides the token mix, so params.json gains `token_mix` (measured on 6 counts-only cloud sessions: central, light and heavy mixes); low uses the light mix, high the heavy mix. 88.8M on Opus = 4.8 kWh (range 0.51 to 22.8). Method version not bumped (PR #98 bumps to 0.1.2; whichever merges second reconciles and rebuilds plugin bundles). qa-tdd red first (EST-1 to EST-20), ux-reviewer UX-R28 to R33 fixed test-first. VISION problem 6, IDEAS (2 entries), METHODOLOGY "Estimating from a total".
- 2026-11-20: CLOUD CAPTURE: the Stop hook that saves counts-only session copies (Nov 1) stopped firing about Nov 2, because project threads start above the repo and Claude Code only loads the repo's hooks inside it. Chase approved (Nov 19) a setup script on the ccwatts cloud environment that installs the save hook and the agent-run hook at user level. Unproven until a fresh thread runs. Chase's saved cloud usage so far: private dashboard https://claude.ai/artifact/8m85ihmuQp1qkiW5ENdPUA.
- 2026-11-19: COVERAGE (Chase asked, picked tests + command): `npm run coverage` (new devDependency @vitest/coverage-v8, same version as vitest; local only, not in CI). Core/src went 98.4% to 99.8% lines, 89.1% to 93.5% branches, with 23 characterization tests in packages/core/test/coverage-gaps.test.ts (COV-1 to COV-6: dropFuture, since, projectRef roots, adapter edges, mid-hour offset change in Pace, empty receipt). No product code changed. CLI index/mcp/nudge and web app.ts read 0% because their tests run the built binary or a real browser; caveat in docs/eng/AGENT-NOTES.md. Open: QA-R1 (P2), projectRef("C:\\") is named "C:" while "/" is "(root)".
- 2026-11-16: PUBLISHED ccwatts@0.2.0 on npm with provenance (Chase re-added the Trusted Publisher and ran Publish; run 43902387836). Verified with an empty HOME: `npx ccwatts@0.2.0 --version`, `--demo`, `pace --demo`, `nudge --preview`, and `mcp --demo` over stdio (initialize, tools/list, energy_summary). README "not on npm yet" labels removed. Issue #38 can close. Next: GitHub Release v0.2.0 and the portfolio INTAKE (box C in the stable-demo plan).
- 2026-11-16: INTERVIEW-READY (Chase has an interview today). Verified live: playground passes check:live and every control works (windows, What-if slider, Pace, Save PNG, own-file load), no console errors; `npx ccwatts@0.1.1 --demo` and `history --demo` work. Half-baked for a visitor: README showed `npx ccwatts pace`/`nudge`/`mcp`, which 0.1.1 doesn't have; README now labels them "in v0.2.0, not on npm yet" and points to the plugin or a source build. Repo About box is still empty (Chase, box B in the stable-demo plan).
- 2026-11-13: GitHub hold lifted (Chase). Merged #91, #92 and method v0.1.1 (#93). DEMO-DATES: sample windows say "a sample month / week" instead of "last 30 / 7 days"; your own data keeps "last N days"; the share card keeps its wording.

## In progress
- Method v0.1.1 PR (this one). Hold lifted Nov 13; restart slowly: one thread, a few pushes a day, no bursts. Stable-demo plan (Nov 13): playground passes check:live; P0 is npm still on 0.1.1 while the page shows Pace and v0.2.0.

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
