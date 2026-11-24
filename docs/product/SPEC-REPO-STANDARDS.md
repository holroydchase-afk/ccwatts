# Spec: repo-standards scorecard (intake #113, plus #111's leftover)

One PR, docs only (every changed file is `.md`), so `qa-tdd skipped: docs only`. No live change: Pages, npm and the plugin are untouched.

## The bet
A recruiter or a stranger who opens the repo sees a product, not a planning folder: README, LICENSE, METHODOLOGY and source at the root, plus the files GitHub's community profile looks for. Signal: the repo's Insights > Community Standards page shows every item checked, and the root listing has no planning docs.

## What changes
- **Add** `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` at the root, written here (studio-agents PR 132's ready-made files can't be read from this session). No email address anywhere: `scripts/check-private.ts` fails one. Security reports go through GitHub private vulnerability reporting; conduct reports go to the maintainer through the same GitHub channel.
- **Add** `.github/PULL_REQUEST_TEMPLATE.md` and `.github/ISSUE_TEMPLATE/bug_report.md`, `feature_request.md`. Markdown only, no `config.yml`, so the PR stays docs-only for agents-check.
- **Move** (`git mv`, never delete) `ANCHORS.md`, `PLAN.md`, `IDEAS.md`, `KICKOFF.md`, `VISION.md` to `docs/internal/`. Use `git mv` with no edits to the moved files in the same commit, so rename detection holds and the open branch that edits `PLAN.md` rebases cleanly.
- **Stay at the root:** `CLAUDE.md` (Claude Code reads it there), `HANDOFF.md` (handoff-check.yml, the SessionStart hook in `.claude/settings.json` and studio sync read it there). No workflow or hook path changes.
- **Update paths** that name the moved files: README line 153 links, `docs/product/DECISIONS.md` (`../../ANCHORS.md`, `../../PLAN.md`, IDEAS), CLAUDE.md "Read before doing anything" and the other ANCHORS/PLAN mentions, HANDOFF.md's IDEAS.md mentions. Dated history (`docs/history/`, `docs/reviews/`) stays as written. Test names and comments that say "PLAN.md" are prose, not paths; leave them.
- **CLAUDE.md inbox rule (#111):** one line: every thread first lists the open intake issues in this repo before asking Chase anything.

## Acceptance criteria
| ID | Given / When / Then | Type |
|---|---|---|
| RS-1 | When `ls` runs at the root, then no `ANCHORS.md`, `PLAN.md`, `IDEAS.md`, `KICKOFF.md` or `VISION.md` is there, and all five exist in `docs/internal/` with unchanged content | auto |
| RS-2 | When `git diff --find-renames -M100% --name-status main...HEAD` runs, then the five files show as `R100` renames, not delete plus add | auto |
| RS-3 | `CLAUDE.md` and `HANDOFF.md` are still at the root; `handoff-check.yml` and `.claude/settings.json` are unchanged | auto |
| RS-4 | When `grep -rnE '\]\((\.\./)*(ANCHORS\|PLAN\|IDEAS\|KICKOFF\|VISION)\.md' --exclude-dir=node_modules --exclude-dir=history --exclude-dir=reviews .` runs, then it finds nothing (every live link points into `docs/internal/`), and every relative `.md` link in README, CLAUDE.md, HANDOFF.md and DECISIONS.md resolves to a file that exists | auto |
| RS-5 | `CONTRIBUTING.md` says how to set up (`npm install`, `npm test`), names the hard rules that bind contributors (no network, counts only, no full paths, sourced params, pure core), and links the PR template | manual |
| RS-6 | `SECURITY.md` points to GitHub private vulnerability reporting (Security tab > Report a vulnerability), states the supported version (latest on npm), and contains no email address | manual |
| RS-7 | `CODE_OF_CONDUCT.md` adopts Contributor Covenant 2.1 by name and link, with reporting through GitHub to the maintainer, and contains no email address | manual |
| RS-8 | `.github/PULL_REQUEST_TEMPLATE.md` has sections for what changed, how it was tested, HANDOFF.md updated, and a line starting `Agents:` with the `qa-tdd skipped: docs only` / `config only` hint, matching agents-check.yml's rule | auto |
| RS-9 | Bug and feature issue templates exist as `.md` with front matter (`name`, `about`, `labels`); the bug template asks for `ccwatts --version`, OS, and counts-only output, and warns never to paste prompts, responses or full paths | manual |
| RS-10 | `npm test` passes (it runs `check-private.ts` over the new files: no emails, home paths or tokens) | auto |
| RS-11 | README keeps the CI badge; it gains no new claim. Any sentence added (e.g. a pointer to CONTRIBUTING/SECURITY) uses only claims in `docs/product/MARKETING.md` | manual |
| RS-12 | CLAUDE.md gains exactly one inbox line (#111) and its paths read `docs/internal/ANCHORS.md` and `docs/internal/PLAN.md`; `bash scripts/check-agents.sh` passes | auto |
| RS-13 | HANDOFF.md gets one dated Done line for #113 and lists the GitHub settings step under waiting_on_chase; handoff-check passes | manual |
| RS-14 | The PR body says `Agents: staff-pm scoped #113; qa-tdd skipped: docs only` (plus any reviewer that really ran); agents-check passes | auto |

## Chase's one step (GitHub settings no tool here can change)
Settings > General: About (gear on the repo home page).
- Description: `Estimate the electricity your Claude Code use consumed, from logs already on your machine. Always a range, every assumption sourced.`
- Topics: `claude-code`, `cli`, `energy`, `electricity`, `ai-energy`, `llm`, `typescript`, `sustainability`
- Website: `https://chaseholroyd.com/ccwatts/`
- Settings > Code security: turn on Private vulnerability reporting (SECURITY.md depends on it).

## Out of scope
Rewriting the moved docs; a CHANGELOG or GitHub Release (separate backlog item); issue-template `config.yml`; README refocus (its own review item). If ux-reviewer or positioning want README copy changes, that is a follow-up PR.

Stop: if any check or workflow is found reading a moved file by path, keep that file at the root and note it in HANDOFF.md rather than editing the workflow in this PR.
