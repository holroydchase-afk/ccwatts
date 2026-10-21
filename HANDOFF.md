# Handoff

Live notes for whoever picks up the build next (human or Claude). Updated every push.

## Done
- S1 log parser (PR #1, draft, still needs a run on Chase's real logs).
- S2 energy model: `packages/core/src/energy.ts`, `methodology/params.json`, `METHODOLOGY.md`, sanity-check tests. Branch `s2-energy-model`, stacked on `s1-scaffold`.

- S3 CLI: summary, `--since`, `--by`, `--json`, `--method` (`packages/cli/src/render.ts`, snapshot tests). Branch `s3-cli`.
- Demo data: `scripts/make-demo-fixture.mjs` writes `fixtures/claude-code/demo.jsonl` (synthetic, counts only, 30 days). Try `npm run build && node packages/cli/dist/index.js --path fixtures/claude-code --since all`.

- S4 history: core `history.ts` (rollup, merge, weekly), CLI `store.ts` (`~/.ccwatts/history.jsonl`, `CCWATTS_HOME` override), `ccwatts history`, `--export csv`, `--no-history`. Branch `s4-history`.

- S5 receipt: core `receipt.ts` (share line, LinkedIn post text, 1200×627 SVG card), shared formatting in core `format.ts`, `ccwatts receipt [--out file]`. Sample card at `docs/images/receipt-sample.png` (synthetic demo data). Branch `s5-receipt`.

## In progress
- S6 local dashboard.

## Exact next step
- Branch `s6-dashboard` from `s5-receipt`; `packages/web` builds one static HTML file (esbuild bundle of core + page script, inlined); `ccwatts dashboard` writes `~/.ccwatts/dashboard.html` with rollups embedded.

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

## Blockers
- S1 still needs Chase's laptop run (real logs, `cleanupPeriodDays`). Not blocking later work.
