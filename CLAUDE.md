# CLAUDE.md

Claude Code reads this file automatically at the start of every session in this repo.

## What this repo is

ccwatts (working name) is an open-source CLI that reads local Claude Code logs and estimates the electricity that usage consumed, always as a range with sourced assumptions. Think "ccusage for kilowatt-hours."

## Read before doing anything

1. `ANCHORS.md`: why it exists, decisions, candidate anchors, open proposals. **It wins any conflict with PLAN.md.**
2. `PLAN.md`: stack, repo layout, energy model, the three MVP surfaces, and the plan (milestones M1–M3, tasks like M1.2; the old S1–S10 labels map to them in HANDOFF.md).

Note: ANCHORS and PLAN number their decisions independently. "ANCHORS D3" and "PLAN D3" are different decisions, so always cite the file.

## Who does what

- **Chase** decides product questions, reviews, and ships. He works about an hour a night.
- **Claude Code** builds, with no limit on session length or scope (Chase, Oct 20). Long runs are fine; keep one PR per PLAN.md task (M1.2) so each can be reviewed and merged on its own.

## Studio agents (use them by default; don't wait to be asked)
The main session is Chase's **chief of staff**: it doesn't do specialist work itself. It sends each piece of work to the agent below with the Agent tool, one lane at a time, and reports back briefly. At the start of every session or scheduled run it reads this table and `ls .claude/agents/`. The team comes from holroydchase-afk/studio-agents (re-sync with its `scripts/sync.sh`).

| Moment | Agent |
|---|---|
| Start of a session or run; planning a milestone; before any new feature; triaging findings | `staff-pm` |
| Before building a fix or feature (failing test first); before any PR is marked ready (all suites 3x) | `qa-tdd` |
| Building, once the failing test exists | `engineer` |
| Any screen, word or CLI output a user sees; before anything goes public (showcase review mode) | `ux-reviewer` |
| Personal data, sign-in, secrets, telemetry, vendors; before a public demo, deploy or repo going public | `privacy-security` |
| A new dependency, vendor, paid service, schema change or CI/deploy workflow; picking a new project's stack | `architect` |
| Before any publish or release (npm, plugin, store, deploy tag); after a version bump | `release-captain` |
| README, landing or portfolio copy; a name or tagline; after a milestone, the "why I built it" story | `positioning` |

**One task, in order:** staff-pm scopes it, qa-tdd writes the failing test (red), engineer builds, qa-tdd runs all suites 3x (green), then ux-reviewer and privacy-security if users or the public will see it, positioning for any copy. Review findings get IDs (`<CODE>-R<n>`, P0 to P2) and each fix gets its own failing test first.

**The `Agents:` line (CI enforces it).** Every PR body has a line starting `Agents:` naming who ran and the verdict, for example `Agents: staff-pm scoped M1.2; qa-tdd red then green, 3x; ux-reviewer no P0/P1`. A PR that changes anything other than docs must name `qa-tdd` on that line, or say `qa-tdd skipped: <reason>`. `.github/workflows/agents-check.yml` fails the PR otherwise, and runs `scripts/check-agents.sh` so this table and `.claude/agents/` never drift. Bot PRs and titles with `[skip agents]` are exempt.

## Hard rules (non-negotiable)

- **No network calls, telemetry or analytics** anywhere in the CLI or the web page.
- **Counts only.** Never write prompt or response content to any file, output, fixture or test snapshot.
- **No full paths in anything we write.** Projects are stored as a hash plus the folder's basename.
- **Every number shown to a user has a range and the method version.**
- **Keep the core pure.** `packages/core` takes data and returns data. All I/O lives in `cli` or `web`.
- **Every parameter is sourced** in `methodology/params.json` (value, low, high, label, source, as_of).
- New runtime dependency? Give a one-line reason in the PR.

## Open proposals (don't act on them, don't block them)

ANCHORS.md lists P2–P3 as *proposed, not decided* (P1 and P4 are decided). Don't implement them, but don't make choices that would close them off:

- **P1 – name (decided Oct 22): ccwatts.** Still keep the name in one constant and in package.json files. **Publish to npm only on Chase's explicit go.**
- **P2 – more providers later.** Ship Claude Code only, but put log parsing behind a small adapter interface (e.g. `adapters/claude-code.ts` returns normalized usage records), so another agent CLI can be added later without touching the energy model.
- **P3 – possible hosted team tier later.** Keep `core` free of CLI/terminal assumptions so it could run elsewhere.
- **P4 – license (decided Oct 20).** MIT for code (`LICENSE`), CC BY 4.0 for METHODOLOGY.md and params.json.

## When to stop and ask Chase

- Any product decision not covered by ANCHORS.md or PLAN.md.
- The Claude Code log fields don't match what PLAN.md M1.1 expects.
- A sanity check (PLAN.md, energy model section) lands far off and you can't explain why.
- Anything that would touch the network, store content, or weaken the privacy story.

## How to end a session

- Tests pass (`npm test`).
- A PR (or commit summary) covering what changed, how it was tested, and open questions for Chase.
- If you learned something durable (log field names, retention behavior, a parameter source), write it down in the right file (`packages/core/README.md`, `METHODOLOGY.md`, `params.json`) rather than only in the PR.

## Session rules (studio-wide)

- Before starting: read this file and `HANDOFF.md` (a SessionStart hook prints it), then the doc this file points to for the task. Check open PRs and branches and resume, never redo.
- Every commit or PR that makes progress updates `HANDOFF.md` in the same commit or PR: done, in progress, exact next step, decisions to review, blockers. The `handoff-check` PR workflow enforces it; use `[skip handoff]` in the PR title only for changes that do not move the work.
- Full rules: `docs/session-rules.md` in holroydchase-afk/studio-agents.
