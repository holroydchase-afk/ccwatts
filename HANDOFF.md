# Handoff
<!-- status
stage: beta
goal: portfolio
milestone: CCW-M4
now: GitHub hold lifted (Chase, Nov 13: "do whatever you need to do without me"). Method v0.1.1 PR open; working the stable-demo plan (/mnt/project-files/ccwatts-reviews/2026-11-13-stable-demo-plan.md), a few pushes a day
next: 0.2.0 is on npm (Nov 16); post the v0.2.0 GitHub Release and send the portfolio INTAKE; later majors TS 7, tsup 9, zod 4
waiting_on_chase:
  - Go to merge the dark elevation PR (changes the live playground); OK to fork dark tokens from hearth (UX-R66)
  - Go on M4.7 Leverage (proposed in IDEAS.md)
  - Repo settings: turn on secret scanning and push protection; add the npm-publish environment
blockers: []
-->

Live status for whoever picks up the build next (human or Claude). Updated every push. Keep this file under 8 KB: dated history goes to `docs/history/HANDOFF-archive.md` (Done log, old decisions, planning-ID map), and `git log` has the rest.

## Portfolio / public presence
- 2026-11-24: Intake #112 (eval findings at 390px): What if? shows its total beside the slider on load; a Sample data label sits above the share card preview (saved PNG/SVG unchanged); Pace leads with one number, details below the chart; Method shows the parameters table open. Live once Chase gives the go and Pages deploys.
- 2026-11-23: Dark mode cards now step lighter than the page (surface 1.08:1 to 1.18:1, intake #108). Light mode pixel-identical. Live once Chase gives the go and Pages deploys. Screenshots: /mnt/project-files/ccwatts-demo-2026-11-23/dark-elevation/.
- 2026-11-22: EVAL (PR #98) merged on Chase's go ("go on green"); after Pages deploys, the playground footer reads method v0.1.2. The portfolio page's "Status" line is stale (it says 0.2.0 waits on npm); an INTAKE for Product Studio is in the Nov 18 review doc.
- **Portfolio page:** https://chaseholroyd.com/ccwatts.html (source: `tools/build.py` in `holroydchase-afk.github.io`). It links the playground and this repo.
- **Live playground:** https://chaseholroyd.com/ccwatts/, deployed from this repo's `main` by `.github/workflows/pages.yml`. Deploys have succeeded since Oct 21, so CCW-M1.9 is live.
- **Demo data:** the playground opens on labeled synthetic sample data. Visitors can pick their own `.jsonl` files, which are parsed in the browser and never uploaded.
- **Studio-wide status** (portfolio, domain, every demo, what's waiting on Chase): https://github.com/holroydchase-afk/pm-tools/blob/main/STUDIO-STATUS.md
- **Keep in sync:** when a change here alters what the portfolio page or demo shows (features, numbers, screenshots, privacy claims), tell the portfolio thread ("Portfolio research and upgrade plan") or update the page in `holroydchase-afk.github.io` (`tools/build.py`). Any portfolio change that touches this product adds a dated line here.
- Older lines: `docs/history/HANDOFF-archive.md`.

## Done (latest only; full log in the archive)
- 2026-11-24: Intake #112 (spec docs/product/SPEC-EVAL-FINDINGS.md): EF-CC-1 What-if total line visible on load (role=status), EF-CC-4 Sample data label by #card, EF-CC-5 Pace lead is one number + range (rest, so-far with its range, agents below the chart; #pace-pill gone), EF-CC-6 params table open (per-parameter notes fold under "About this value"). Tests EF-1 to EF-13 in packages/web/test/eval-findings.test.ts; WI-2, PACE-WEB2 and AC-T2 updated (params open; 1280 budget 1900 -> 1920). EF-CC-2/3 owned by the M4.8.1 hero+CTA PR; dark item already fixed by #110. Plugin bundles rebuilt.
- 2026-11-23: QA-R1 decided (Chase, "root for Windows too"): projectRef names a Windows drive root (`C:\`, `C:/`, `D:`) "(root)", like `/`. Ids unchanged (still the hash of the trimmed path), so old history rows keep their id; a row saved earlier may still show "C:". Tests COV-3b to COV-3b3; plugin bundles rebuilt.
- 2026-11-23: DARK (intake #108, spec docs/product/SPEC-DARK-ELEVATION.md): dark --surface #24221E, --fill #33302B, --line #383530, --tab-line #77736D; high-contrast dark --muted #C6C0B6 (QA-R1). Tests DARK-1 to DARK-7 in packages/web/test/design-system.test.ts; plugin bundles rebuilt. Forks the dark tokens from hearth themes.paper (UX-R66); a hearth intake should follow if Chase agrees. UX-R67: check on a phone at low brightness once live; fallback surface #282622.
- 2026-11-23: Intake #107: CLAUDE.md gains the "Self-check before any ask" rule (Chase never updates settings, environments or repos by hand; do it yourself, use a tool or card, else one copy box). Docs only.
- 2026-11-22: EVAL merged (PR #98, built Nov 18 from the three-seat portfolio review). `npm run evals` writes `docs/EVALS.md` from `evals/models.json` and `evals/cases.json`: model coverage (8 ids), 4 reference checks with assumed inputs labeled, and a sensitivity table; `packages/core/test/evals.test.ts` fails on a stale file or a failed check. It found that Fable and Mythos ids were priced as Sonnet, half of Opus (now the Opus tier, method v0.1.2, no values changed), and that Opus output energy drives about 37% of a heavy day's range against 24% for the cache-read factor. `--by` tables print the unknown-model note. Review backlog next: docs/DESIGN.md, README refocus and release hygiene (tags, CHANGELOG, GitHub Release v0.2.0, close #38), friend beta kit.

## In progress

## Exact next step
0. Second PR: the cloud-session prompt (Claude runs `npx -y ccwatts@latest` and replies in three lines; staff-pm scope + ux-reviewer copy UX-R20 to R27, in the thread "Measure cloud sessions and pasted token counts") on the playground and README. Then check a fresh ccwatts thread saved its counts to /mnt/project-files/ccwatts-usage/.
1. Chase merges #89, then this PR.
2. Done Nov 16: 0.2.0 published. Remaining: GitHub Release v0.2.0, close issue #38, portfolio INTAKE (box C in the stable-demo plan).
3. Then only on Chase's go: M4.7 Leverage (IDEAS.md); held majors TS 7, tsup 9, zod 4 (one planned task each).
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
