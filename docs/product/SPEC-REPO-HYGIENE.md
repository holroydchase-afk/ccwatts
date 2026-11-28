# Spec: repo hygiene (intakes #128, #131, #134, #135, #137)

Chase, Nov 27: "Do everything but #132." Inventory taken on main at 4f71b87 (after PRs #129 and #138). One PR, no runtime dependency, nothing live changes (no Pages, npm or plugin release).

## The bet
An engineer or hiring manager who opens the repo finds the dev loop they expect (lint, format rules, hooks, changelog, notices, scans), each one enforced by a check, not just present. Signal: every row below is "done" with a test ID or CI job as evidence; no item is "exists but unchecked".

## Inventory
| Intake item | Status | Evidence / owner |
|---|---|---|
| SUPPORT.md (#128, #131) | done | `SUPPORT.md` (PR #129) |
| CodeQL workflow, SHA-pinned (#128, #131, #135, #137) | done | `.github/workflows/codeql.yml` (PR #138): javascript-typescript + actions, `build-mode: none`, pinned `codeql-action@915412ff` v4.39.5 |
| gitleaks full history (#137) | done | `security.yml` job `secrets`, `fetch-depth: 0`, checksum-verified binary |
| npm audit in CI (#135, #137) | done | `security.yml` job `audit`: `npm audit --omit=dev --audit-level=high` |
| dependency-review (#137) | not ours | needs Settings > Code security > Dependency graph on; job comes back after (HANDOFF) |
| ESLint studio config + `lint` script + CI (#134, #137) | done | `eslint.config.mjs`, `lint.yml`, `npm run lint`: 0 errors, 29 warnings |
| Lint ignores `plugins/ccwatts/bin/*.js` (#134) | done | `eslint.studio-local.mjs` ignores `plugins/ccwatts/bin/**` |
| Lint strict (`STUDIO_LINT_STRICT=1`) (#134) | to do, later PR | clear the 29 warnings first (code change, own PR); then set the variable (try `gh api` first; Chase only if it 403s) |
| `.nvmrc` matching engines >=22.12 (#134) | done | `.nvmrc` = `22` resolves to latest 22.x (>=22.12) |
| README AI-use line (#128, #131) | to do | line exists (README "How this is built") but no row in `MARKETING.md`, and it duplicates the heading "How it's built" |
| CHANGELOG.md, Keep a Changelog, semver (#128, #131, #134) | to do | npm has 0.1.0, 0.1.1, 0.2.0; no git tags or GitHub Releases |
| THIRD_PARTY_NOTICES.md (#128, #131) | to do | the CLI and plugin bundles ship 8 third-party packages: `@modelcontextprotocol/sdk`, `zod`, `zod-to-json-schema`, `ajv`, `ajv-formats`, `fast-deep-equal`, `fast-uri`, `json-schema-traverse`. MIT/BSD require their notices in copies we distribute; today we ship none |
| Coverage number in README (#134) | to do | `npm run coverage` today: `packages/core/src` 99.84% lines (99.36% stmts). All-files 52% is misleading (CLI/web run as subprocess/browser, AGENT-NOTES) |
| `.editorconfig` (#135, #137) | to do | missing; tree is already clean (no tabs, no CRLF, every text file ends in a newline) |
| Formatter (#135) | deferred, own PR | see "Formatter path" |
| Pre-commit runs lint + typecheck (#135) | to do | `.githooks/pre-commit` runs only `check-private --staged` |
| `.github/CODEOWNERS` (#135) | to do | missing |
| CodeQL alerts triage (#131) | blocked | `code-scanning/alerts` returns 403 to this session; needs a look at the Security tab |
| Description, topics, branch protection (#128) | not ours | Chase's settings list (HANDOFF `waiting_on_chase`) |

## Formatter path (recommendation)
`.editorconfig` now, enforced by a test; Prettier in its own PR later. Why: the repo already satisfies EditorConfig, so it lands with zero churn and zero dependencies. Prettier adopted partway either reformats every touched file (noise in every future diff) or checks nothing. Do it once: one mechanical "format the repo" PR when the PR queue is empty (PR #130 is open now), config matched to today's style (double quotes, semicolons), `format:check` in `lint.yml`, and the commit SHA in `.git-blame-ignore-revs`. That PR needs `architect` for the devDependency. #135 closes with it.

## Acceptance criteria
Tests go in `packages/cli/test/repo-hygiene.test.ts` (same pattern as `typescript.test.ts`), so they run in `npm test` and fail red before the files exist.

| ID | Given / When / Then | Type |
|---|---|---|
| HYG-1 | Given the repo, when the test reads `CHANGELOG.md`, then it links keepachangelog.com and semver.org, has `## [Unreleased]`, and has a `## [x.y.z] - YYYY-MM-DD` heading for 0.1.0, 0.1.1 and 0.2.0 | auto |
| HYG-2 | Given `packages/cli/package.json` version V, then the newest dated heading in `CHANGELOG.md` is V (a version bump without an entry fails) | auto |
| HYG-3 | Given the plugin bundles, when the test lists every package named in their `// ../../node_modules/<pkg>/` comments, then `THIRD_PARTY_NOTICES.md` has a section per package with the license id from that package's `package.json` and its copyright line | auto |
| HYG-4 | Given `packages/cli/package.json`, then `files` includes `THIRD_PARTY_NOTICES.md` and `prepack` copies it in, like `LICENSE` | auto |
| HYG-5 | Given `.editorconfig`, then it sets `root = true`, utf-8, LF, final newline, 2-space indent, and `trim_trailing_whitespace = false` for `*.md`; and every tracked text file (not `plugins/ccwatts/bin/*.js`, not binaries) has LF endings, no tab indent and a final newline | auto |
| HYG-6 | Given `.githooks/pre-commit`, then it still runs `check-private.ts --staged`, runs `eslint` on staged `.ts/.tsx` files only (skipped when none), and runs `npm run typecheck`; and exits non-zero if any step fails | auto |
| HYG-7 | Given a staged `.ts` file with a type error, when `git commit` runs in a clone with hooks on, then the commit is refused; after the fix it goes through | manual |
| HYG-8 | Given `.github/CODEOWNERS`, then it has a `*` rule owned by the repo owner (`@holroydchase-afk`) | auto |
| HYG-9 | Given `vitest.config.ts`, then a coverage threshold for `packages/core/src/**` lines exists; and README states the same number as "packages/core line coverage at least N%" with the command; the test fails if the two differ | auto |
| HYG-10 | Given `ci.yml`, then a step runs `npm run coverage`, so the threshold fails CI when coverage drops | auto |
| HYG-11 | README has one build section (merge "How this is built" into "How it's built"), and its AI-use sentence matches a row in `MARKETING.md` with proof (agents-check.yml, ci.yml, commit trailers) | manual (positioning) |
| HYG-12 | `npm test`, `npm run typecheck` and `npm run lint` (0 errors) pass 3x; `check-private` passes on the new files | auto |

Coverage is a dev metric, not an energy estimate, so the range-plus-method-version rule doesn't apply; it carries the command and a floor instead.

## Intakes this PR closes
- **#128**: closed as superseded by #131 (its own text says so).
- **#131**: closes with this PR. CodeQL alerts move to Chase's list (403 from here).
- **#134**: closes (its done-when: lint green, CHANGELOG with Unreleased, README coverage). Strict mode tracked in HANDOFF next step.
- **#137**: closes now on evidence (PR #138: lint, gitleaks, CodeQL, audit run on every PR). Dependency-review waits on the dependency-graph setting.
- **#135**: stays open until the Prettier PR. Everything else in it lands here.

## Not doing
- Prettier reformat: own PR (above). Clearing the 29 lint warnings: own PR, code change with qa-tdd.
- License scanner in CI: HYG-3 covers what we ship; a full scanner is a new dependency with no reader yet.
- GitHub Releases/tags for past versions: release-captain's call at the next publish.
- `packages/cli` engines says `>=22` while the root says `>=22.12`: real but separate; fix at the next release with release-captain.
