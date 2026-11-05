# Decisions

Every call Chase makes on ccwatts, newest first. This file is an **index**: the full text of the founding decisions stays where it was made, in [ANCHORS.md](../../ANCHORS.md) (product, wins any conflict) and [PLAN.md](../../PLAN.md) (build). ANCHORS and PLAN number their decisions independently, so cite the file ("ANCHORS D3" is not "PLAN D3").

New calls get the next `CCW-DEC-n`, added in the same PR as the call: date, the call in Chase's words where we have them, why, and what it beat. Calls still waiting on Chase live in HANDOFF.md "Decisions to review", not here.

| ID | Date | The call | Why / what it beat | Where |
|---|---|---|---|---|
| CCW-DEC-16 | 2026-11-01 | Adopt the studio standard ("I want all projects to be standardized ... I don't want to deal with it"). | One rule set across projects instead of each repo drifting. | Intake #86 |
| CCW-DEC-15 | 2026-10-31 | Blocks of agent work with no human turn are agent time, not pace hours. | Keeps Pace about the person; agent time shows separately and feeds Leverage. | PLAN M4, HANDOFF |
| CCW-DEC-14 | 2026-10-31 | Build Pace (M4) under the name "pace"; the morning digest shows no finish times. | Work-rhythm signal without a timesheet feel. | Intake #71, IDEAS.md |
| CCW-DEC-13 | 2026-10-29 | Move the whole repo to TypeScript ("move this entire product to typescript"). | Reviewers see one strictly typed codebase; beat keeping `.mjs` helpers. | HANDOFF TS-1 |
| CCW-DEC-12 | 2026-10-29 | Dependabot ignores majors of TypeScript, tsup, vitest, zod and @types/node. | Those majors broke the build or need Node 22; a planned bump beats piecemeal PRs. | `.github/dependabot.yml` |
| CCW-DEC-11 | 2026-10-28 | Drop project ids from `--json`, MCP answers and the dashboard file (PS-R5). | An unsalted path hash is linkable; beat salting per install. | HANDOFF |
| CCW-DEC-10 | 2026-10-28 | The plugin bundles and registers the MCP server. | One install gets `/ccwatts` and the MCP tools. | HANDOFF M2.6.5b |
| CCW-DEC-9 | 2026-10-28 | Run the 7-phase release plan (CCW-M2.6). | Functional, polished demo release. | `docs/reviews/2026-10-28-release-plan.md` |
| CCW-DEC-8 | 2026-10-27 | Local MCP server, stdio only. | Claude can ask about its own energy with no port or network. | ANCHORS D14 |
| CCW-DEC-7 | 2026-10-22 | Name locked: **ccwatts**. | Free on npm, PyPI, crates; beat "tokenwatts". | ANCHORS P1, PR #35 |
| CCW-DEC-6 | 2026-10-22 | Plugin ships after npm; history stores output × context; v1 is kWh only. | Order of release, room for the model, honest scope. | ANCHORS D11–D13 |
| CCW-DEC-5 | 2026-10-21 | Host the playground on GitHub Pages at chaseholroyd.com/ccwatts/. | Free, static, on the portfolio domain. | HANDOFF M1.9 |
| CCW-DEC-4 | 2026-10-20 | MIT for code; CC BY 4.0 for METHODOLOGY.md and params.json. | Open method others can reuse with credit. | ANCHORS P4 |
| CCW-DEC-3 | 2026-10-20 | No limit on Claude's session length or scope; one PR per PLAN task. | Chase has about an hour a night to review. | CLAUDE.md |
| CCW-DEC-2 | 2026-10-16 | Founding product decisions D1–D10 (dev tool first, ranges, public repo, TypeScript, no mobile app, static playground, friend beta before posting). | | ANCHORS "Decisions made" |
| CCW-DEC-1 | 2026-10-16 | Locked build decisions D1–D8 (logs never leave the machine, one shared core, kWh only, reuse published parameters). | | PLAN "Locked decisions" |
