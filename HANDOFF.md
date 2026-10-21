# Handoff

Live notes for whoever picks up the build next (human or Claude). Updated every push.

## Done
All of S1 to S7, the README and Pages hosting (PRs #1, #3 to #10, #12) are merged to main as of Oct 21, 2026. Branch notes below are history.

- S1 log parser (PR #1, draft, still needs a run on Chase's real logs).
- S2 energy model: `packages/core/src/energy.ts`, `methodology/params.json`, `METHODOLOGY.md`, sanity-check tests. Branch `s2-energy-model`, stacked on `s1-scaffold`.

- S3 CLI: summary, `--since`, `--by`, `--json`, `--method` (`packages/cli/src/render.ts`, snapshot tests). Branch `s3-cli`.
- Demo data: `scripts/make-demo-fixture.mjs` writes `fixtures/claude-code/demo.jsonl` (synthetic, counts only, 30 days). Try `npm run build && node packages/cli/dist/index.js --path fixtures/claude-code --since all`.

- S4 history: core `history.ts` (rollup, merge, weekly), CLI `store.ts` (`~/.ccwatts/history.jsonl`, `CCWATTS_HOME` override), `ccwatts history`, `--export csv`, `--no-history`. Branch `s4-history`.

- S5 receipt: core `receipt.ts` (share line, LinkedIn post text, 1200×627 SVG card), shared formatting in core `format.ts`, `ccwatts receipt [--out file]`. Sample card at `docs/images/receipt-sample.png` (synthetic demo data). Branch `s5-receipt`.

- S6 dashboard: `packages/web` (template.html + app.ts, built by build.mjs with esbuild into one file, hash-pinned CSP). `ccwatts dashboard [--no-open]` writes `~/.ccwatts/dashboard.html`. Page has headline, daily stacked chart, by model/project, explainer, share card with Save PNG/SVG and copy buttons, method table. Branch `s6-dashboard`.

- S7 playground: same page as the dashboard (opens on labeled sample data, folder/file pickers, drag and drop). `npm run check:browser` (Playwright, not a dependency) fails on any request, console error or sideways scroll. Hosted on GitHub Pages via `.github/workflows/pages.yml` (Chase picked Actions, Oct 21). Branch `s7-playground`.

- v1 README for the portfolio with screenshots in `docs/images/` (all from synthetic demo data). Branch `v1-readme`, which also merges PR #3 (VISION, IDEAS, LICENSE). Also fixed: the dashboard showed the file picker (CSS overrode `hidden`), and web windows now cut days the same way as the CLI.

## In progress
- Nothing. Hardening if time allows.

## Exact next step
- Chase: run S1 on real logs (`npm install && npm run build && node packages/cli/dist/index.js` on main) to confirm totals and `cleanupPeriodDays`.
- Playground hosting is done (PR #12, Oct 21): GitHub Pages via Actions, with Chase's custom domain and DNS set up. Next: confirm the live page loads on a phone and passes the no-network check.
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

- The CLI writes SVG only; LinkedIn needs PNG, so the dashboard (S6) gets a "Save PNG" button that rasterizes the same SVG in the browser. No native image dependency.
- `--path` accepts a single .jsonl file as well as a folder.

- Playground and dashboard are the same file; playground opens on sample data (clearly labeled) so the first view is never empty.
- Sample windows count back from the last day in the sample; real history counts back from today.
- `npm test` builds the web page first (about 1 second) so the page tests check the real output.

- Hosting: GitHub Pages through Actions (Chase, Oct 21). Live at https://holroydchase-afk.github.io/ccwatts/ once the workflow runs.

## Blockers
- S1 still needs Chase's laptop run (real logs, `cleanupPeriodDays`). Not blocking later work.
