# Handoff
<!-- status
stage: beta
goal: portfolio
milestone: CCW-M4
now: GitHub hold lifted (Chase, Nov 13: "do whatever you need to do without me"). Method v0.1.1 PR open; working the stable-demo plan (/mnt/project-files/ccwatts-reviews/2026-11-13-stable-demo-plan.md), a few pushes a day
next: 0.2.0 is on npm (Nov 16); post the v0.2.0 GitHub Release and send the portfolio INTAKE; later majors TS 7, tsup 9, zod 4
waiting_on_chase:
  - Go on M4.7 Leverage (proposed in docs/internal/IDEAS.md)
  - Repo settings: turn on secret scanning and push protection; add the npm-publish environment
  - Repo settings (#113): About gear: description, topics, website (exact text in docs/product/SPEC-REPO-STANDARDS.md); Settings > Code security: turn on Private vulnerability reporting (SECURITY.md depends on it)
blockers: []
-->

Live status for whoever picks up the build next (human or Claude). Updated every push. Keep this file under 8 KB: dated history goes to `docs/history/HANDOFF-archive.md` (Done log, old decisions, planning-ID map), and `git log` has the rest.

## Portfolio / public presence
- 2026-11-24 (intake #117): the portfolio's "8.5 kWh over 30 days, range 1.3 to 30.5" comes from `npx ccwatts --demo` (method v0.1.2, sample 2026-09-21 to 2026-10-20; JSON wh 1315 / 8507 / 30489). Unchanged; pinned by PORT-1 to PORT-3 in packages/cli/test/portfolio-numbers.test.ts, which fails if params or the fixture move it.
- 2026-11-24: the playground's Your logs gains "Use Claude Code on the web? Ask it." (a prompt to paste into a cloud session). Merged on Chase's go (Nov 24); live after Pages deploys, since it changes the live playground.
- 2026-11-24: Intake #112 (eval findings at 390px): What if? shows its total beside the slider on load; a Sample data label sits above the share card preview (saved PNG/SVG unchanged); Pace leads with one number, details below the chart; Method shows the parameters table open. Live once Chase gives the go and Pages deploys.
- **Portfolio page:** https://chaseholroyd.com/ccwatts.html (source: `tools/build.py` in `holroydchase-afk.github.io`). It links the playground and this repo.
- **Live playground:** https://chaseholroyd.com/ccwatts/, deployed from this repo's `main` by `.github/workflows/pages.yml`. Deploys have succeeded since Oct 21, so CCW-M1.9 is live.
- **Demo data:** the playground opens on labeled synthetic sample data. Visitors can pick their own `.jsonl` files, which are parsed in the browser and never uploaded.
- **Studio-wide status** (portfolio, domain, every demo, what's waiting on Chase): https://github.com/holroydchase-afk/pm-tools/blob/main/STUDIO-STATUS.md
- **Keep in sync:** when a change here alters what the portfolio page or demo shows (features, numbers, screenshots, privacy claims), tell the portfolio thread ("Portfolio research and upgrade plan") or update the page in `holroydchase-afk.github.io` (`tools/build.py`). Any portfolio change that touches this product adds a dated line here.
- Older lines: `docs/history/HANDOFF-archive.md`.

## Done (latest only; full log in the archive)
- 2026-11-24: M4.8.3 RANGES (spec docs/product/SPEC-RANGES.md, UX-R6): every share and comparison shown now carries a range. Core `shareRange`/`formatShare` ("64% (30–72%)"), `comparisons`/`everyday` take the total Range ("about 28 miles (4.4–102)"); headline wording lives in core `rereadShare` ("About 64% (30–72%)", no "Most"; "The surprise:" only when the low end is >= 50%; pending Chase, one-line change). Playground: Overview and Electricity get a "How we got this range" link to #method; by-model/project rows drop the %; chart tooltips say "(central)". Card slip rows and post carry ranges, post names the method version. CLI: one comparison per line, By model/type list what fits 80 columns plus a "Full split" `--by` hint; `--by` share column ranged (QA-R1); estimate's assumed mix on its own line and "Know the split?" shortened to fit 80 cols. METHODOLOGY "Ranges on shares and comparisons" (RANGE-14). Next: qa-tdd green 3x, ux-reviewer RANGE-13 (390 and 1280), then PR.
- 2026-11-24: M4.8.2 HEADER TRIM (UX-R2, CCW-DEC-17 recommendations): the playground drops the standalone "ccwatts" line above the h1 and shows the name in the demo bar; the demo bar stops repeating "nothing leaves this browser" (the lock line is the one promise); phone tab bar starts at 223px (was 271). Dashboard keeps its header. FOCUS-8..10. Merge waits on Chase's go (live demo). Next: M4.8.3 ranges on every number (UX-R6).
- 2026-11-24: Intake #117: portfolio sample numbers pinned (PORT-1 to PORT-3); command recorded under Portfolio.
- 2026-11-24: Intake #122 (privacy sweep): the one claude.ai artifact link in docs/history/HANDOFF-archive.md is gone (title kept). Repo now has no artifact links. Docs only.
- 2026-11-24: QA-R1 (CLOUDP/FOCUS): the Overview phone note under "Try it on your logs" now reads "On a phone? It works with Claude Code on the web." (Chase picked it, Nov 24; was "Needs a computer with Claude Code."), pointing phones to the cloud prompt. Tests CLOUDP-12, FOCUS-1; plugin bundles rebuilt.
- 2026-11-24: CLOUDP (spec docs/product/SPEC-CLOUDP.md): a cloud-session prompt in Your logs ("Use Claude Code on the web? Ask it.": Claude runs `npx -y ccwatts@latest` and replies in three lines, token counts only) and the same prompt byte for byte in the README. CLOUDP-1 to CLOUDP-11 test-first (packages/web/test/cloudp.test.ts, plus the browser block in check-no-network.ts). ux-reviewer UX-R69 (one-line phone hint) and UX-R70 (fallback points to the "Have a token count?" box on the Electricity tab, now a link to #electricity) fixed; UX-R68 left as P2. Save hook verified Nov 23: 6 sessions saved since Nov 22.

## In progress
- M4.8.3 ranges on every number: built on `claude/project-thread-g2k1g8`, awaiting qa-tdd 3x, ux-reviewer (RANGE-13; also the shortened "Know the split?" CLI line) and the PR.

## Exact next step
0. Chase: the manual CLOUDP-8 check (paste the cloud prompt into a fresh claude.ai/code thread and a plain chat; neither should invent a number).
1. Chase merges #89, then this PR.
2. Done Nov 16: 0.2.0 published. Remaining: GitHub Release v0.2.0, close issue #38, portfolio INTAKE (box C in the stable-demo plan).
3. Then only on Chase's go: M4.7 Leverage (docs/internal/IDEAS.md); held majors TS 7, tsup 9, zod 4 (one planned task each).
- The old, longer next-step list is in the archive; most of it shipped.

## Decisions to review (open only; settled ones are in the archive)
- Microsoft Research figure (Nov 18): the paper's abstract now reads 0.31 Wh (IQR 0.16–0.60); README, PLAN, MARKETING and one params note still say 0.34 (0.18–0.67), recorded Oct 21 with no URL. The scorecard and METHODOLOGY use the current figure and link. Say "update 0.34" to change the rest.
- Fable and Mythos priced at the Opus tier as a floor (Nov 18; Claude's default, per PLAN "nearest tier"). Say "own tier" to give them their own sourced parameter.
- The playground's What-if copy calls cache-read cost "the least certain assumption"; the scorecard shows Opus output energy drives more of the range. Copy left unchanged pending Chase.
- Pace on the public playground (Oct 31): ANCHORS D10 says no public pieces before the friend beta; Chase's recruiter-ready ask overrode it for the sample-only Pace section. Say "hold M4.5" to take it off the live page.
- Proposed ANCHORS D15 (architect, Oct 31; not in ANCHORS until Chase says yes): Pace keeps daily counts in a separate local `~/.ccwatts/pace.jsonl`, counts only, never shared without `--share-pace`.

- Repo settings only Chase can change: secret scanning and push protection on; an `npm-publish` environment (required reviewer: Chase, branch main), then `environment: npm-publish` in `publish.yml`.

## Blockers
- M2.1 local run needs Chase to use Claude Code on his Mac (parser already verified on real cloud logs, Oct 23). Not blocking.
