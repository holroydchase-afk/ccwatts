# Handoff

Live notes for whoever picks up the build next (human or Claude). Updated every push.

## Done
- S1 log parser (PR #1, draft, still needs a run on Chase's real logs).
- S2 energy model: `packages/core/src/energy.ts`, `methodology/params.json`, `METHODOLOGY.md`, sanity-check tests. Branch `s2-energy-model`, stacked on `s1-scaffold`.

## In progress
- S3 CLI summary.

## Exact next step
- Branch `s3-cli` from `s2-energy-model`; replace the token table in `packages/cli/src/index.ts` with the PLAN.md summary layout.

## Decisions to review
- Range math: each param's low/high is a ~90% interval; spreads combine root-sum-of-squares in log space; ranges add across types (fully correlated). See METHODOLOGY.md.
- No separate PUE/overhead parameter: per-token values are set at the comprehensive boundary directly, since the sources report at that boundary.
- Unknown models fall back to the Sonnet tier with a warning.
- Our 8-week range (32–678 kWh) is wider than Hausfather's (70–330). Kept on purpose.

## Blockers
- S1 still needs Chase's laptop run (real logs, `cleanupPeriodDays`). Not blocking later work.
