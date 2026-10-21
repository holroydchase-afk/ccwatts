# Handoff

Live notes for whoever picks up the build next (human or Claude). Updated every push.

## Planning IDs (Oct 21, 2026)
The repo now uses the studio planning IDs (milestone `M1`, task `M1.1`, step `M1.1.1`; product code `CCW` across products). Old labels stay in git history and branch names. New work uses the new IDs.

| Old | New | What |
|---|---|---|
| S1 | CCW-M1.1 | Scaffold + parse spike |
| S2 | CCW-M1.2 | Energy model + params.json |
| S3 | CCW-M1.3 | CLI summary |
| S4 | CCW-M1.4 | History |
| S5 | CCW-M1.5 | Receipt |
| S6 | CCW-M1.6 | Web dashboard |
| S7 | CCW-M1.7 | Playground |
| v1-readme (PR #10) | CCW-M1.8 | v1 README |
| playground-pages (PR #12) | CCW-M1.9 | Playground hosting |
| S1 real-log check | CCW-M2.1 | Real-log run on Chase's laptop |
| S8 | CCW-M2.2 | Ship (npm, clean-machine test) |
| S9 | CCW-M2.3 | Friend beta fixes |
| S10 | CCW-M3.1 | Methodology hardening (v0.2) |

ANCHORS/PLAN decisions (`D1`), proposals (`P1`) and IDEAS entries keep their own numbers.

## Portfolio / public presence
_Updated 2026-10-21._
- **Portfolio page:** https://chaseholroyd.com/ccwatts.html (source: `tools/build.py` in `holroydchase-afk.github.io`). It links the playground and this repo.
- **Live playground:** https://chaseholroyd.com/ccwatts/, deployed from this repo's `main` by `.github/workflows/pages.yml`. Deploys have succeeded since Oct 21, so CCW-M1.9 is live.
- **Demo data:** the playground opens on labeled synthetic sample data. Visitors can pick their own `.jsonl` files, which are parsed in the browser and never uploaded.
- 2026-10-21: the portfolio home page lists ccwatts under "Since Jan 2026: independent product work" with a "Live playground" tag.
- **Keep in sync:** when a change here alters what the portfolio page or demo shows (features, numbers, screenshots, privacy claims), tell the portfolio thread ("Portfolio research and upgrade plan") or update the page in `holroydchase-afk.github.io` (`tools/build.py`). Any portfolio change that touches this product adds a dated line here.

## Done
- 2026-10-21: studio session rules installed: `.claude/settings.json` SessionStart hook prints this file into every Claude Code session, `.github/workflows/handoff-check.yml` fails a PR that changes files without updating this file, and CLAUDE.md has a "Session rules" section.
All of M1.1 to M1.8 (old S1 to S7 plus the README; PRs #1, #3 to #10) and the Pages workflow (M1.9, PR #12) are merged to main as of Oct 21, 2026. Branch notes below are history.

- M1.1 (S1) log parser (PR #1, draft, still needs a run on Chase's real logs).
- M1.2 (S2) energy model: `packages/core/src/energy.ts`, `methodology/params.json`, `METHODOLOGY.md`, sanity-check tests. Branch `s2-energy-model`, stacked on `s1-scaffold`.

- M1.3 (S3) CLI: summary, `--since`, `--by`, `--json`, `--method` (`packages/cli/src/render.ts`, snapshot tests). Branch `s3-cli`.
- Demo data: `scripts/make-demo-fixture.mjs` writes `fixtures/claude-code/demo.jsonl` (synthetic, counts only, 30 days). Try `npm run build && node packages/cli/dist/index.js --path fixtures/claude-code --since all`.

- M1.4 (S4) history: core `history.ts` (rollup, merge, weekly), CLI `store.ts` (`~/.ccwatts/history.jsonl`, `CCWATTS_HOME` override), `ccwatts history`, `--export csv`, `--no-history`. Branch `s4-history`.

- M1.5 (S5) receipt: core `receipt.ts` (share line, LinkedIn post text, 1200×627 SVG card), shared formatting in core `format.ts`, `ccwatts receipt [--out file]`. Sample card at `docs/images/receipt-sample.png` (synthetic demo data). Branch `s5-receipt`.

- M1.6 (S6) dashboard: `packages/web` (template.html + app.ts, built by build.mjs with esbuild into one file, hash-pinned CSP). `ccwatts dashboard [--no-open]` writes `~/.ccwatts/dashboard.html`. Page has headline, daily stacked chart, by model/project, explainer, share card with Save PNG/SVG and copy buttons, method table. Branch `s6-dashboard`.

- M1.7 (S7) playground: same page as the dashboard (opens on labeled sample data, folder/file pickers, drag and drop). `npm run check:browser` (Playwright, not a dependency) fails on any request, console error or sideways scroll. Hosted on GitHub Pages via `.github/workflows/pages.yml` (Chase picked Actions, Oct 21). Branch `s7-playground`.

- M1.8 v1 README for the portfolio with screenshots in `docs/images/` (all from synthetic demo data). Branch `v1-readme`, which also merges PR #3 (VISION, IDEAS, LICENSE). Also fixed: the dashboard showed the file picker (CSS overrode `hidden`), and web windows now cut days the same way as the CLI.

- License audit (2026-10-21): LICENSE (MIT) and CC BY 4.0 notices were already in place; added a not-affiliated-with-Anthropic trademark line to the README.

## In progress
- Nothing. Hardening if time allows.

## Exact next step
- M2.1, Chase: run on real logs (`npm install && npm run build && node packages/cli/dist/index.js` on main) to confirm totals and `cleanupPeriodDays`.
- M1.9 playground hosting (PR #12): live at chaseholroyd.com/ccwatts/ since Oct 21 (Pages deploys from `main` succeed).
- Waiting on Chase (from the Atlas intake, logged in IDEAS.md): approve storing output × context, opt-in carbon or kWh-only, what "metric data" meant for the bench idea.

## Decisions to review
- Range math: each param's low/high is a ~90% interval; spreads combine root-sum-of-squares in log space; ranges add across types (fully correlated). See METHODOLOGY.md.
- No separate PUE/overhead parameter: per-token values are set at the comprehensive boundary directly, since the sources report at that boundary.
- Unknown models fall back to the Sonnet tier with a warning.
- Our 8-week range (32–678 kWh) is wider than Hausfather's (70–330). Kept on purpose.

- Comparison line picks the first two everyday equivalents that are at least 1 (EV miles, fridge days, phone charges, home days), else the biggest one.
- Added an EPA phone-charge comparison (0.019 kWh) so small totals still get a picture.

- History merge keeps, per day/model/project, the row with more tokens. Claude Code only adds to a day's logs and then deletes whole old files, so this can't double-count or shrink. No per-message IDs are stored.
- Every run of the CLI updates history (opt out with `--no-history`). Summaries read from history, so a 30-day window still works after cleanup.

- The CLI writes SVG only; LinkedIn needs PNG, so the dashboard (M1.6) gets a "Save PNG" button that rasterizes the same SVG in the browser. No native image dependency.
- `--path` accepts a single .jsonl file as well as a folder.

- Playground and dashboard are the same file; playground opens on sample data (clearly labeled) so the first view is never empty.
- Sample windows count back from the last day in the sample; real history counts back from today.
- `npm test` builds the web page first (about 1 second) so the page tests check the real output.

- Hosting: GitHub Pages through Actions (Chase, Oct 21). Live at https://holroydchase-afk.github.io/ccwatts/ once the workflow runs.
- Shared studio agents are in `.claude/agents/` (source: holroydchase-afk/studio-agents; edit there, then sync).

## Blockers
- M2.1 needs Chase's laptop run (real logs, `cleanupPeriodDays`). Not blocking later work.
