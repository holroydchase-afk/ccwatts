# Spec: studio-agents wiring (issue #104)

One PR, docs + CI plumbing. No live change: Pages, npm and the plugin are untouched.

## Problem
Cloud project threads start above the repo, so the Agent tool can't load studio agent types and the run-log hook never fires. Today that leaves two options: skip qa-tdd or fake the log. The upstream fix (`scripts/agent-prompt.sh` plus `log-agent-run.sh --as`) is half-installed here. Our `log-agent-run.sh`, `check-agent-runs.sh` and `agents-check.yml` were "kept existing" by sync, and CLAUDE.md's Studio agents section is behind the template. Until this lands, nothing stops a code PR from saying "qa-tdd skipped: no time".

## Acceptance criteria
Tests for scripts live in `packages/cli/test/repo.test.ts` (vitest, spawnSync on a temp git repo). Every criterion runs from the repo root.

| ID | Given / When / Then | Type |
|---|---|---|
| AC1 | Given a git repo on branch `a/b`, when `bash scripts/log-agent-run.sh --as qa-tdd` runs, then `.claude/agent-runs/a-b.log` gains exactly one line matching `^<ISO-UTC> qa-tdd via-general-purpose$` and it exits 0 | auto |
| AC2 | Given `--as` with a bad name (`../x`, empty, uppercase), when it runs, then it exits non-zero and writes no log file | auto |
| AC3 | Given hook JSON on stdin (`tool_input.subagent_type: engineer`), when it runs with no args, then it logs `<time> engineer` exactly as today, and it exits 0 even on bad JSON (the hook never blocks) | auto |
| AC4 | Given a log line `<time> qa-tdd via-general-purpose` and `Agents: qa-tdd green 3x`, when `check-agent-runs.sh` runs, then qa-tdd counts as run (the verify step can be stubbed) | auto |
| AC5 | Given the Agents: line names `engineer` and the log has only `<time> engineer via-something-else` or no entry, when `check-agent-runs.sh` runs, then it exits 1 with the `::error::` that names `agent-prompt.sh` | auto |
| AC6 | When `bash scripts/agent-prompt.sh qa-tdd "test"` runs, then it exits 0 and prints `studio agent qa-tdd`, `log-agent-run.sh --as qa-tdd`, and `test` after `## Your task`. Given an unknown agent, it exits 1 | auto |
| AC7 | Given the "Agents line in the PR body" step from `agents-check.yml` (the test pulls its `run:` block out of the YAML) and a diff touching `scripts/`, when BODY says `qa-tdd skipped: no time`, then it fails. `qa-tdd skipped: docs only` and `qa-tdd skipped: config only` pass. A docs-only diff with any skip reason passes | auto |
| AC8 | `agents-check.yml` keeps the repo's pinned action SHAs (no `@v<n>` tags), `cache: npm`, and `npm ci && npm run build` before the run-log step | auto |
| AC9 | CLAUDE.md's Studio agents section matches `templates/CLAUDE-agents.md` with only these differences: the greeting reads "Hi Chase, I'm your CCWatts chief of staff" (CLAUDE.md never says "Charlie"), the release-captain row stays, the `check-qa-report.ts` checker line stays, and the `docs/eng/AGENT-NOTES.md` pointer stays. `bash scripts/check-agents.sh` passes | auto |
| AC10 | `scripts/check-logs.mjs` is absent and `scripts/check-logs.ts` is unchanged | auto |
| AC11 | The diff leaves `.claude/settings.json`, `studio-checks.json`, `handoff-check.yml`, `pages.yml`, `publish.yml`, `packages/web/` and the plugin untouched | auto |
| AC12 | HANDOFF.md gets one dated line for #104, and handoff-check passes | manual |
| AC13 | `npm test` passes 3x locally, and the PR's own Agents: line names qa-tdd as really run (this PR changes scripts, so the new rule applies to it) | manual |

Success: the next cloud-thread code PR logs qa-tdd through `--as` and passes agents-check without a hand-edited log.
Stop: if AC7 can't be tested without a YAML parser dependency, extract the step to `scripts/check-agents-line.sh` instead. Don't add a dependency.

## Out of scope
- Changing the `settings.json`, `studio-checks.json` or `handoff-check.yml` extras. They're repo-specific, so ours stay.
- Unpinning actions or adopting the template's `setup-node@v7` tag.
- Reinstalling `check-logs.mjs`. The TS port is canonical here.
- Editing `.claude/agents/*.md` by hand, or any upstream change to studio-agents. A template wording fix ("Charlie's") goes upstream as a one-line note.
- Any Pages, npm or plugin release.
