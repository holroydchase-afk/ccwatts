# CLAUDE.md

Claude Code reads this file automatically at the start of every session in this repo.

## What this repo is

ccwatts (working name) is an open-source CLI that reads local Claude Code logs and estimates the electricity that usage consumed, always as a range with sourced assumptions. Think "ccusage for kilowatt-hours."

## Read before doing anything

1. `ANCHORS.md`: why it exists, decisions, candidate anchors, open proposals. **It wins any conflict with PLAN.md.**
2. `PLAN.md`: stack, repo layout, energy model, the three MVP surfaces, and the session plan (S1–S10).

Note: ANCHORS and PLAN number their decisions independently. "ANCHORS D3" and "PLAN D3" are different decisions, so always cite the file.

## Who does what

- **Chase** decides product questions, reviews, and ships. He works about an hour a night.
- **Claude Code** builds. One session = one PLAN.md session row = one small PR.

## Hard rules (non-negotiable)

- **No network calls, telemetry or analytics** anywhere in the CLI or the web page.
- **Counts only.** Never write prompt or response content to any file, output, fixture or test snapshot.
- **No full paths in anything we write.** Projects are stored as a hash plus the folder's basename.
- **Every number shown to a user has a range and the method version.**
- **Keep the core pure.** `packages/core` takes data and returns data. All I/O lives in `cli` or `web`.
- **Every parameter is sourced** in `methodology/params.json` (value, low, high, label, source, as_of).
- New runtime dependency? Give a one-line reason in the PR.

## Open proposals (don't act on them, don't block them)

ANCHORS.md lists P1–P4 as *proposed, not decided*. Don't implement them, but don't make choices that would close them off:

- **P1 – name may change.** Don't hard-code "ccwatts" in a way that's painful to rename: keep the name in one constant and in package.json files. **Do not publish to npm or claim names** until Chase confirms the name.
- **P2 – more providers later.** Ship Claude Code only, but put log parsing behind a small adapter interface (e.g. `adapters/claude-code.ts` returns normalized usage records), so another agent CLI can be added later without touching the energy model.
- **P3 – possible hosted team tier later.** Keep `core` free of CLI/terminal assumptions so it could run elsewhere.
- **P4 – license.** Add MIT only after Chase confirms.

## When to stop and ask Chase

- Any product decision not covered by ANCHORS.md or PLAN.md.
- The Claude Code log fields don't match what PLAN.md S1 expects.
- A sanity check (PLAN.md, energy model section) lands far off and you can't explain why.
- Anything that would touch the network, store content, or weaken the privacy story.

## How to end a session

- Tests pass (`npm test`).
- A PR (or commit summary) covering what changed, how it was tested, and open questions for Chase.
- If you learned something durable (log field names, retention behavior, a parameter source), write it down in the right file (`packages/core/README.md`, `METHODOLOGY.md`, `params.json`) rather than only in the PR.

## Working with Chase

Chase is a full-time dad with limited time. These rules apply to every session.

### Minimize Chase's effort
- Always optimize for Chase's efficiency.
- Before sending any reply, check every ask you make of Chase. If you could do it yourself, do it instead of asking.
- When something truly needs Chase (a purchase, a login, a decision), make it a single step: give the exact link, the exact text to paste, or a one-word question with your recommendation.
- Never hand Chase a multi-step chore you could shrink to one step, or a copy-and-paste you could avoid by saving the result somewhere you can reach.
- Pick sensible defaults and keep going instead of asking.
- If Chase is about to make a mistake (wasted money or time, a risky or irreversible step, a worse option than an obvious alternative), say so plainly and briefly before going along with it.

### Token hygiene
- Keep memory files short. Store facts and links there, never copies of docs.
- Split shared docs by topic, one file per area, and read only the section you need.
- Keep one session per stream of work. Continue it instead of starting a new one.
- Edit docs directly, re-reading them just before you write.
- Keep replies short and lead with the answer.
