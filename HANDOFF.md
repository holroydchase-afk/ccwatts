# Handoff
<!-- status
stage: beta
goal: portfolio
milestone: CCW-M4
now: SITEHDR site header + info drawer built (intake #127), pending qa-tdd 3x and ux-reviewer. GitHub hold lifted (Chase, Nov 13: "do whatever you need to do without me"). Method v0.1.1 PR open; working the stable-demo plan (/mnt/project-files/ccwatts-reviews/2026-11-13-stable-demo-plan.md), a few pushes a day
next: 0.2.0 is on npm (Nov 16); post the v0.2.0 GitHub Release and send the portfolio INTAKE; later majors TS 7, tsup 9, zod 4
waiting_on_chase:
  - Go on M4.7 Leverage (proposed in docs/internal/IDEAS.md)
  - Repo settings: turn on secret scanning and push protection; add the npm-publish environment
  - Repo settings (#113): About gear: description, topics, website (exact text in docs/product/SPEC-REPO-STANDARDS.md); Settings > Code security: turn on Private vulnerability reporting (SECURITY.md depends on it)
blockers: []
-->

Live status for whoever picks up the build next (human or Claude). Updated every push. Keep this file under 8 KB: dated history goes to `docs/history/HANDOFF-archive.md` (Done log, old decisions, planning-ID map), and `git log` has the rest.

## Nov 27: engineering standard (intakes #134 lint, #136 gitleaks, #137 dev-loop gaps)
- **Done (config only):** studio ESLint gate (`eslint.config.mjs`, `eslint.studio-local.mjs` ignoring the generated plugin bundles, `npm run lint`, `.github/workflows/lint.yml`), warn-only: 29 warnings, 0 errors. `security.yml` (gitleaks over full history and `npm audit --omit=dev` at high; dependency review removed because the dependency graph is off, add it back once it is on), `codeql.yml` (javascript-typescript and actions), all actions SHA-pinned. `.nvmrc` 22.
- **Next:** clear the 29 warnings in small PRs, then set the repository variable `STUDIO_LINT_STRICT=1`. Then Prettier (#135; pre-commit and CHANGELOG landed Nov 27).
- **Verify on the PR:** the new workflows run for the first time there; `dependency-review` needs the dependency graph on (public repo default).

## Portfolio / public presence
- 2026-11-24: Intake #112 (eval findings at 390px): What if? shows its total beside the slider on load; a Sample data label sits above the share card preview (saved PNG/SVG unchanged); Pace leads with one number, details below the chart; Method shows the parameters table open. Live once Chase gives the go and Pages deploys.
- 2026-11-25 (intake #127): the playground wears the portfolio's site header (fixed 52px: "← Chase Holroyd", Building, Agents, "ccwatts demo", an "About this demo" button, Case study) and paints white in light mode; the "Demo" strip is gone, its copy and links now sit in the drawer behind that button. Live on the next Pages deploy. Portfolio thread: the header is built into the page, not demo-bar.js/.css, so a look change there needs a PR here.
- **Portfolio page:** https://chaseholroyd.com/ccwatts.html (source: `tools/build.py` in `holroydchase-afk.github.io`). It links the playground and this repo.
- **Live playground:** https://chaseholroyd.com/ccwatts/, deployed from this repo's `main` by `.github/workflows/pages.yml`. Deploys have succeeded since Oct 21, so CCW-M1.9 is live.
- **Demo data:** the playground opens on labeled synthetic sample data. Visitors can pick their own `.jsonl` files, which are parsed in the browser and never uploaded.
- **Studio-wide status** (portfolio, domain, every demo, what's waiting on Chase): https://github.com/holroydchase-afk/pm-tools/blob/main/STUDIO-STATUS.md
- **Keep in sync:** when a change here alters what the portfolio page or demo shows (features, numbers, screenshots, privacy claims), tell the portfolio thread ("Portfolio research and upgrade plan") or update the page in `holroydchase-afk.github.io` (`tools/build.py`). Any portfolio change that touches this product adds a dated line here.
- Older lines: `docs/history/HANDOFF-archive.md`.

## Done (latest only; full log in the archive)
- 2026-11-27: Repo hygiene for intakes #131/#134/#135 except Prettier, which waits for a quiet-PR window (spec docs/product/SPEC-REPO-HYGIENE.md, tests HYG-1..6, 8..10 in packages/cli/test/repo-hygiene.test.ts): `CHANGELOG.md` (Keep a Changelog, 0.1.0/0.1.1/0.2.0 plus Unreleased; HYG-2 fails a version bump without an entry), `THIRD_PARTY_NOTICES.md` (the 8 bundled packages' license files, shipped in the npm tarball via `files`/`prepack` and `studio-checks.json` release allowlist), `.editorconfig`, pre-commit now runs check-private, eslint on staged .ts/.tsx and `npm run typecheck`, `.github/CODEOWNERS`, core line-coverage floor 99% in `vitest.config.ts` (README line, `npm run coverage` step in ci.yml on Node 22). HYG-11 (README AI-use wording) left to positioning. #139 inventory doc: docs/eng/SHARED-INVENTORY.md (inventory only, nothing extracted). Next: Prettier PR when the queue is empty (architect for the devDependency); clear the 29 lint warnings, then `STUDIO_LINT_STRICT=1`.
- 2026-11-25: SITEHDR (intake #127, spec docs/product/SPEC-SITE-HEADER.md, Part A + Part B on Chase's yes): the playground gets the site header (`#site-bar` in template.html; app.ts builds every href from `PORTFOLIO_URL`'s origin, no new request, CSP byte-identical), the light page and sticky tabs paint white (`--pg`; `--bg` stays #F7F7F4 for DS-1), the tabs stick at 52px and deep links clear the header, and the `#demo-bar` strip becomes `#demo-toggle` + the `#demo-drawer` dialog (right panel at 700px+, bottom sheet below; close button, Esc and scrim close it and return focus; no motion under reduced motion). `ccwatts --html` keeps no header and Paper grey. Tests SITEHDR-1..16 (site-header.test.ts, site-header-drawer.test.ts, the SITEHDR blocks in check-no-network.ts). Tabs, panels and footer now sit in one `.views` column that fills the window under the header, so the sticky row can reach it. QA-R1: build.ts ships the page without stylesheet comments or line indentation, so dist is 149,524 bytes, under check-live's 150,000 (was 153,157). Plugin bundles rebuilt. Fix round (ux-reviewer UX-R1..R4): name link bold with an accent arrow in `<i aria-hidden>`, links padded 0 6px (focus offset 0), page scroll locked while the drawer is open, dark scrim .6; page 149,822 bytes. UX-R5..R7 (P2) deferred. SITEHDR-17: embed=1 drops the header (portfolio frames the demo; decision per issue #127 comment Nov 25: header built in for direct visits, skipped when embedded); `html.hd` (set in wireSiteBar only without `?embed=1`) carries the 52px offsets, toViewTop keys off it, the white page stays; page 149,914 bytes.
- 2026-11-24: M4.8.3 RANGES (spec docs/product/SPEC-RANGES.md, UX-R6): every share and comparison shown now carries a range. Core `shareRange`/`formatShare` ("64% (30–72%)"), `comparisons`/`everyday` take the total Range ("about 28 miles (4.4–102)"); headline wording lives in core `rereadShare` ("About 64% (30–72%)", no "Most"; "The surprise:" only when the low end is >= 50%; pending Chase, one-line change). Playground: Overview and Electricity get a "How we got this range" link to #method; by-model/project rows drop the %; chart tooltips say "(central)". Card slip rows and post carry ranges, post names the method version. CLI: one comparison per line, By model/type list what fits 80 columns plus a "Full split" `--by` hint; `--by` share column ranged (QA-R1); estimate's assumed mix on its own line and "Know the split?" shortened to fit 80 cols. METHODOLOGY "Ranges on shares and comparisons" (RANGE-14). Next: qa-tdd green 3x, ux-reviewer RANGE-13 (390 and 1280), then PR.
- 2026-11-24: M4.8.2 HEADER TRIM (UX-R2, CCW-DEC-17 recommendations): the playground drops the standalone "ccwatts" line above the h1 and shows the name in the demo bar; the demo bar stops repeating "nothing leaves this browser" (the lock line is the one promise); phone tab bar starts at 223px (was 271). Dashboard keeps its header. FOCUS-8..10. Merge waits on Chase's go (live demo). Next: M4.8.3 ranges on every number (UX-R6).

## In progress
- M4.8.3 ranges on every number: built on `claude/project-thread-g2k1g8`. Fix round done (Nov 24): QA-R1 tiny phone totals read "under 1% of a phone charge" again and a phone range topping one charge reads in charges ("about half a phone charge (0.1–1.5 charges)", never >100%); UX-R13 #ov-how text lines up with #ov-compare, 12px clear; UX-R14 comparison ends at 2 significant figures ("(4.4–100)"); UX-R15 tight en dash for kWh ranges ("1.3–30.5"; Pace hours and the Method params table keep "a – b"). EF-6 card hash re-pinned (diff is dash/rounding only). Next: qa-tdd green 3x, ux-reviewer recheck, then the PR.

## Exact next step
0. SITEHDR (intake #127): qa-tdd green 3x and ux-reviewer on the header and drawer at 320/390/1280, then the PR; it changes the live playground, so it merges on Chase's standing go and goes live on the next Pages deploy. Run `npm run check:live` after that deploy (SITEHDR-11 is Chase's manual check next to chaseholroyd.com/building.html).
1. Chase: the manual CLOUDP-8 check (paste the cloud prompt into a fresh claude.ai/code thread and a plain chat; neither should invent a number).
2. Chase merges #89, then this PR.
3. Done Nov 16: 0.2.0 published. Remaining: GitHub Release v0.2.0, close issue #38, portfolio INTAKE (box C in the stable-demo plan).
4. Then only on Chase's go: M4.7 Leverage (docs/internal/IDEAS.md); held majors TS 7, tsup 9, zod 4 (one planned task each).
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

## Repo best-practices pass (2026-11-25)
- Done: SUPPORT.md README-AI-line. Added from the GitHub, Linux Foundation and Syracuse checklists (studio-agents docs/repo-standards.md). Left for this project to review: a SHA-pinned CodeQL workflow (RB-4a requires 40-char SHAs and this session could not look one up), CHANGELOG.md, THIRD_PARTY_NOTICES, wording of the README AI-use line against the claims register, repo description and topics.
