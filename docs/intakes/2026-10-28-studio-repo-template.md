# INTAKE for Product Studio: repo template lessons from ccwatts (2026-10-28)

**Owner:** Product Studio (studio-agents `templates/repo/`, pm-tools STACK.md). ccwatts does not edit those repos.
**Source:** ccwatts CCW-M2.6.7 (architect design, privacy-security PS-R7, QA-2). Files to copy from: `.github/workflows/{ci,pages,publish,handoff-check}.yml`, `.github/dependabot.yml`, `scripts/check-private.mjs`, `.githooks/pre-commit`, `studio-checks.json` (`private` block).

1. `ci.yml` runs on `pull_request` and `push: main`. `pages.yml` deploys on `workflow_run` of CI with `conclusion == 'success'` and `event == 'push'` (the event filter stops a fork PR's CI run from ever deploying). One CI run per commit, and the README badge reflects `main`. Avoid `workflow_call` for this.
2. `handoff-check.yml` must skip bot PRs (`github.event.pull_request.user.type != 'Bot'`) like agents-check, or every Dependabot PR fails.
3. Pin actions by commit SHA with a `# vX.Y.Z` comment; Dependabot (github-actions, weekly, minor+patch grouped) keeps them current.
4. Optional `browser` job: Playwright installed into `$RUNNER_TEMP` at one exact version and loaded through `PLAYWRIGHT_MODULE`, so it is never a repo dependency. About 2–3 min, in parallel with `test`.
5. `check-private.mjs`: allowlist placeholder *usernames* (`private.allowUsers`), never whole files, so fixtures stay scanned. Emails need a letter TLD (`pkg@0.1.1` isn't an email). In `--staged` mode also ban the machine's login name and git email at runtime (exempt `noreply@`). Print masked matches only.
6. Pre-commit hook via root `prepare`: `[ -d .git ] && git config core.hooksPath .githooks || true`. Safe only in a private root package; published workspaces must not copy it. CI runs the same check because `--no-verify` skips hooks.
7. `publish.yml` template: fail fast unless `refs/heads/main`, `persist-credentials: false`, no npm cache in release jobs, `id-token: write` at job level, and an `npm-publish` environment with a required reviewer (the owner creates it in Settings first).
8. Secret scanning: the repo's own `check-private` in CI plus GitHub's built-in secret scanning and push protection (free on public repos). No gitleaks.

**Also for STUDIO-STATUS:** "chaseholroyd.com HTTPS" can move from Waiting on Chase to Done. ccwatts loaded https://chaseholroyd.com/ccwatts/ in Chromium over valid HTTPS on Oct 28 (M2.6.6).
