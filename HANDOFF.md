# Handoff

Live notes for whoever picks up the build next (human or Claude). Updated every push.

## Planning IDs (Oct 21, 2026)
The repo now uses the studio planning IDs (milestone `M1`, task `M1.1`, step `M1.1.1`; product code `CCW` across products). Old labels stay in git history and branch names. New work uses the new IDs.

| Old | New | What |
|---|---|---|
| S1 | CCW-M1.1 | Scaffold + parse spike |
| S2 | CCW-M1.2 | Energy model + params.json |
| S3 | CCW-M1.3 | CLI summary |
| S4 | CCW-M1.4 | History |
| S5 | CCW-M1.5 | Receipt |
| S6 | CCW-M1.6 | Web dashboard |
| S7 | CCW-M1.7 | Playground |
| v1-readme (PR #10) | CCW-M1.8 | v1 README |
| playground-pages (PR #12) | CCW-M1.9 | Playground hosting |
| S1 real-log check | CCW-M2.1 | Real-log run on Chase's laptop |
| S8 | CCW-M2.2 | Ship (npm, clean-machine test) |
| S9 | CCW-M2.3 | Friend beta fixes |
| S10 | CCW-M3.1 | Methodology hardening (v0.2) |

ANCHORS/PLAN decisions (`D1`), proposals (`P1`) and IDEAS entries keep their own numbers.

## Portfolio / public presence
_Updated 2026-10-21._
- **Portfolio page:** https://chaseholroyd.com/ccwatts.html (source: `tools/build.py` in `holroydchase-afk.github.io`). It links the playground and this repo.
- **Live playground:** https://chaseholroyd.com/ccwatts/, deployed from this repo's `main` by `.github/workflows/pages.yml`. Deploys have succeeded since Oct 21, so CCW-M1.9 is live.
- **Demo data:** the playground opens on labeled synthetic sample data. Visitors can pick their own `.jsonl` files, which are parsed in the browser and never uploaded.
- **Studio-wide status** (portfolio, domain, every demo, what's waiting on Chase): https://github.com/holroydchase-afk/pm-tools/blob/main/STUDIO-STATUS.md
- 2026-10-21: the portfolio home page lists ccwatts under "Since Jan 2026: independent product work" with a "Live playground" tag.
- 2026-10-22: README's top image is now a terminal GIF (`docs/images/cli-demo.gif`); `cli-summary.png` was re-shot from the same run if the portfolio wants a still.
- 2026-10-22: playground gains an H1 ("How much electricity does your AI coding use?"), a lede, and a "← Chase Holroyd's portfolio" link to https://chaseholroyd.com/ccwatts.html. Portfolio fix for `npx ccwatts` (RR-2) sent as an INTAKE block for Product Studio.
- 2026-10-22: README now links the live playground near the top, and its screenshots show the current playground on sample data (new H1 and back link). If the portfolio reuses README images, use `docs/images/playground-laptop.png` / `playground-phone.png`.
- 2026-10-23: the playground's "Try it on your own logs" box adds a copy-paste prompt and a paste box for Claude Code on the web users (PR pending). No portfolio change needed.
- 2026-10-23: README phone/laptop screenshots re-shot (hero meta line no longer splits a date on phones). Share text now says "like driving an EV about N miles" instead of "roughly driving…". If the portfolio quotes the share line, it can update.
- 2026-10-24: the playground's try-it box says "Prefer the terminal? Run `npx ccwatts` with Node 20+" (RR-22). Portfolio "Stack" line is stale ("on npm once the name is final"): INTAKE in `docs/reviews/2026-10-24-recruiter-ready-r2.md` (RR-23).
- 2026-10-27: README gains "Ask Claude about it (MCP server)" (`ccwatts mcp`, CCW-M2.5). The portfolio page could add it to the stack line once the next npm version ships; Product Studio's call.
- **Keep in sync:** when a change here alters what the portfolio page or demo shows (features, numbers, screenshots, privacy claims), tell the portfolio thread ("Portfolio research and upgrade plan") or update the page in `holroydchase-afk.github.io` (`tools/build.py`). Any portfolio change that touches this product adds a dated line here.

## Done
- 2026-10-27: CCW-M2.5 MCP server (Chase's call, Polish Freeze exception, INTAKE from Product Studio). `ccwatts mcp` serves four read-only tools over stdio: `energy_summary {since}` and `energy_by_project {since}` (default 7d), `energy_weekly {since}` (default all) and `methodology`. Every answer has low/central/high in Wh and `methodVersion`; counts only, project basename plus hash, no paths (even the no-logs message). `--path`, `--demo` and `--no-history` work as in the CLI. Shared loading moved to `packages/cli/src/usage.ts` (index.ts uses it too, no behavior change). The SDK (`@modelcontextprotocol/sdk` + `zod`) is bundled into a separate `dist/mcp.js` (~810 KB) that only `ccwatts mcp` loads, so the package still has no runtime dependencies and the status line stays small. stdio-only decision in ANCHORS D14. Tested: `packages/cli/test/mcp.test.ts` (7 tests, real MCP client over stdio, includes a log with prompt text and a full path that must never come back), 97 tests green; manual `claude -p` run with `--mcp-config` called all four tools on this container's own logs and answered "how much energy this week".
- 2026-10-24 (night shift, recruiter-ready round 2): walked portfolio → playground → README → npm README → CLI first run; review in `docs/reviews/2026-10-24-recruiter-ready-r2.md`. Fixed the two P2s left from the last run: tiny totals read "about half a phone charge" instead of "charging a phone about 0.5 times", singular "1 mile/day" (RR-20); energy values keep one decimal between 1 and 100 so the dashboard and playground line up ("8.0 kWh", RR-21). Playground now tells visitors the CLI runs with `npx ccwatts` (RR-22). Failing tests first; 88 tests green 3x, typecheck and `check:browser` pass.
- 2026-10-24 (night shift): PR #21 (Claude Code plugin, CCW-M2.4) merged to main on Chase's "Merge all" after CI passed. It was brought up to date with main (merge, conflicts in HANDOFF.md and `packages/cli/src/index.ts` imports only) and the plugin bundle rebuilt from the 0.1.1 CLI, so `/ccwatts` gets `--demo`, `-v` and the plain error messages too.
- 2026-10-21: Claude Code plugin (CCW-M2.4, Chase picked it Oct 21). Marketplace at `.claude-plugin/marketplace.json`, plugin in `plugins/ccwatts`: `/ccwatts` skill runs the bundled CLI (`bin/ccwatts.js`, copied from `packages/cli/dist` by `scripts/build-plugin.mjs` on `npm run build`, committed because installed plugins can't reach `packages/`), `/ccwatts:statusline` skill sets up the status line, new CLI command `ccwatts statusline` (reads the transcript path from stdin, never writes history, prints a quiet line on any error). New `.github/workflows/ci.yml` builds, typechecks and tests every PR and fails if the committed bundle is stale. Tested: `claude plugin validate`, and headless `claude -p "/ccwatts:ccwatts ..." --plugin-dir ./plugins/ccwatts` ran the CLI. Bare `/ccwatts` didn't resolve in headless `-p` mode; check it in the interactive picker.
- 2026-10-23 (night shift, UX sweep): ux-reviewer pass on the playground and dashboard at 390×844 and 1280×800, light and dark, full page: no sideways scroll, no console errors, method table and tap targets fine. Fixed: the hero meta line split a date across lines on phones ("2026-" / "09-21"); items now wrap whole (CCW-UX1, checked in `npm run check:browser`). Share line and LinkedIn post drop the double hedge ("roughly driving an EV about…" → "like driving an EV about… or running a fridge about…") and "All my Claude Code use so far used" → "came to" (CCW-UX2, test in receipt.test.ts). README phone and laptop screenshots re-shot with `scripts/make-readme-images.mjs`. 84 tests, green 3x.
- 2026-10-23 (night shift, CCW-H harden pass 1): ccwatts 0.1.0 is live on npm (published by Chase via the Actions workflow on Oct 23; `npx ccwatts@0.1.0` verified on the fixture with an empty HOME). README "Try it" now leads with `npx ccwatts` and drops the pre-publish wording (CCW-H6). CLI first-run fixes, each with a failing test first in `packages/cli/test/cli.test.ts` (end-to-end: bundles the CLI with esbuild and runs it in a throwaway HOME): `--path` no longer mixes into or writes your history (CCW-H1, it used to merge the README's sample file into your real totals forever); `-v/--version` (CCW-H2); plain messages for unknown options and missing values (CCW-H3); `--demo` runs on the same synthetic sample as the playground with no logs needed, labeled "Sample data (synthetic)", leaves history alone, and `receipt`/`dashboard` refuse it so nobody shares sample numbers as their own (CCW-H7); the no-logs message now offers `--demo` and the playground. 83 tests, green 3x; typecheck and `check:browser` pass.
- 2026-10-23: playground gets a copy-paste prompt for people who run Claude Code on the web (or can't find the folder). The prompt asks Claude to write a counts-only `ccwatts-usage.jsonl` (no content, cwd reduced to the folder name). The page reads it from a file or a paste box, and the Mac hidden-folder shortcut (⌘⇧.) is shown. Chase's idea after he found he only uses Claude Code in the browser. Covered by `page.test.ts` and `check:browser`.
- 2026-10-22: D12 built: history rows carry `outputContext` (sum of output × context per day/model/project). Counts only, not shown or priced yet; old rows without it still parse, and fresh logs fill it in. See `packages/core/README.md`.
- 2026-10-22: PR #18 (M2.2 prep, CLI installable) merged after a main merge; 64 tests, typecheck and build pass, and a packed tarball installs and runs in an empty project with an empty HOME.
- 2026-10-22: Recruiter-ready stack merged to main in order (#22 to #29, merge commits; tests and typecheck passed at every step and on main, 62 tests). Stale PR #2 (old CLAUDE.md rules) closed. Pages deploy of #29 started 18:30 UTC.
- 2026-10-22: M2.2 README GIF: the README now opens with `docs/images/cli-demo.gif`, an 8-second terminal recording of the real CLI on the demo fixture (`npx ccwatts --path demo.jsonl --since all`). `scripts/make-readme-gif.mjs` re-records it (Playwright + ffmpeg, run by hand) and refreshes the still `docs/images/cli-summary.png` (no longer in the README; kept for the portfolio). `readme.test.ts` checks the GIF is linked near the top and exists.
- 2026-10-22: Round 2 (RR-15 to RR-19): lede follows the data source, post says "I estimated" and only calls a 50%+ cache share a surprise, ranges pick kWh from the high bound, method labels explained, and `docs/images/receipt-sample.png` is now the labeled sample card (new `scripts/make-readme-images.mjs` re-shoots all three README playground images).
- 2026-10-22: RR-7, RR-14: README links the live playground in its second paragraph, says `npx ccwatts` works once it's on npm, and its screenshots are the current playground on sample data (`docs/images/playground-laptop.png` replaces `dashboard.png`; `playground-phone.png` re-shot). `packages/web/test/readme.test.ts` guards all three.
- 2026-10-22: RR-10, RR-11, RR-13: method-table source links name their site (e.g. theclimatebrink.com) and are 44px tall; under 600px the table becomes one card per parameter (no sideways scroll); phones see "On a phone? Claude Code keeps its logs on your computer…" under the pickers. All three are in `check:browser`.
- 2026-10-22: RR-8: the daily chart is drawn at its on-screen width (320 to 720 px) and redrawn on resize, so axis labels are 13px tall on a 390px phone instead of 7px. `check:browser` fails if they drop under 11px.
- 2026-10-22: RR-5, RR-6, RR-9, RR-12: file pickers are reachable by Tab (visually hidden inputs, focus ring on the label), the light-mode "Sample data" pill is 5.27:1, buttons are at least 44px tall with 3:1 borders (`--control`). `npm run check:browser` now also fails on unreachable pickers or buttons under 44px.
- 2026-10-22: RR-4: on sample data the share card says "SAMPLE DATA" and "Sample data, not a real measurement.", and the share line and LinkedIn post start with "(Sample data)" with no first person (`sample` flag on `ReceiptInput`). Real-data output is unchanged.
- 2026-10-22: recruiter-ready review saved to `docs/reviews/2026-10-22-recruiter-ready.md` (2 P0, 7 P1, 7 P2). Fixed RR-1 and RR-3: the playground now opens with an H1 and a plain lede, links back to the portfolio (`PORTFOLIO_URL` in `packages/core/src/meta.ts`) from the header, and every page says "Built by Chase Holroyd" in the footer.
- 2026-10-22: studio agents re-synced from studio-agents PR #6 branch (`claude/project-thread-wvkxmq`, not merged there yet): ux-reviewer gains the visual pass, heuristic sweep, showcase review mode and iterate loop; positioning reads HANDOFF.md first. Studio-only agents (orchestrator, focus-coach) not copied.
- 2026-10-21: link preview for the playground. `og:` and `twitter:` meta tags in `packages/web/src/template.html` point at `og.png`, a 1200×627 card rendered from `packages/web/src/og.svg` by `scripts/make-og-image.mjs` (Playwright, run by hand, commit both). The Pages workflow copies it next to `index.html`. The playground URL lives in `PLAYGROUND_URL` in `packages/core/src/meta.ts`; the LinkedIn post text now links it first and the repo second.
- 2026-10-21: studio session rules installed: `.claude/settings.json` SessionStart hook prints this file into every Claude Code session, `.github/workflows/handoff-check.yml` fails a PR that changes files without updating this file, and CLAUDE.md has a "Session rules" section.
All of M1.1 to M1.8 (old S1 to S7 plus the README; PRs #1, #3 to #10) and the Pages workflow (M1.9, PR #12) are merged to main as of Oct 21, 2026. Branch notes below are history.

- M1.1 (S1) log parser (PR #1, draft, still needs a run on Chase's real logs).
- M1.2 (S2) energy model: `packages/core/src/energy.ts`, `methodology/params.json`, `METHODOLOGY.md`, sanity-check tests. Branch `s2-energy-model`, stacked on `s1-scaffold`.

- M1.3 (S3) CLI: summary, `--since`, `--by`, `--json`, `--method` (`packages/cli/src/render.ts`, snapshot tests). Branch `s3-cli`.
- Demo data: `scripts/make-demo-fixture.mjs` writes `fixtures/claude-code/demo.jsonl` (synthetic, counts only, 30 days). Try `npm run build && node packages/cli/dist/index.js --path fixtures/claude-code --since all`.

- M1.4 (S4) history: core `history.ts` (rollup, merge, weekly), CLI `store.ts` (`~/.ccwatts/history.jsonl`, `CCWATTS_HOME` override), `ccwatts history`, `--export csv`, `--no-history`. Branch `s4-history`.

- M1.5 (S5) receipt: core `receipt.ts` (share line, LinkedIn post text, 1200×627 SVG card), shared formatting in core `format.ts`, `ccwatts receipt [--out file]`. Sample card at `docs/images/receipt-sample.png` (synthetic demo data). Branch `s5-receipt`.

- M1.6 (S6) dashboard: `packages/web` (template.html + app.ts, built by build.mjs with esbuild into one file, hash-pinned CSP). `ccwatts dashboard [--no-open]` writes `~/.ccwatts/dashboard.html`. Page has headline, daily stacked chart, by model/project, explainer, share card with Save PNG/SVG and copy buttons, method table. Branch `s6-dashboard`.

- M1.7 (S7) playground: same page as the dashboard (opens on labeled sample data, folder/file pickers, drag and drop). `npm run check:browser` (Playwright, not a dependency) fails on any request, console error or sideways scroll. Hosted on GitHub Pages via `.github/workflows/pages.yml` (Chase picked Actions, Oct 21). Branch `s7-playground`.

- M1.8 v1 README for the portfolio with screenshots in `docs/images/` (all from synthetic demo data). Branch `v1-readme`, which also merges PR #3 (VISION, IDEAS, LICENSE). Also fixed: the dashboard showed the file picker (CSS overrode `hidden`), and web windows now cut days the same way as the CLI.

- License audit (2026-10-21): LICENSE (MIT) and CC BY 4.0 notices were already in place; added a not-affiliated-with-Anthropic trademark line to the README.

## In progress
- M2.2 ship prep (everything except the npm publish). Done so far: fixed a packaging bug (the CLI listed the unpublished `@ccwatts/core` as a runtime dependency, so `npm install` of the tarball failed with a 404; it is bundled anyway, so it is now a devDependency), added a test that the CLI has no runtime dependencies, and ran a clean install of `npm pack` output into an empty project with an empty HOME: install took under a second, the summary and `dashboard` worked on the demo fixture.
- Oct 23: name decided (ccwatts, ANCHORS P1). The CLI package is publish-ready: `private` removed, `publishConfig.access` public, an npm README (`packages/cli/README.md`), and LICENSE copied in on pack (gitignored). `npm publish --dry-run` from `packages/cli` passes (4 files, 88 KB bundle), and a clean tarball install runs. `ccwatts` was still free on npm on Oct 23.
- M2.2 done (Oct 26): Chase merged #41 and published ccwatts@0.1.1 from the Actions workflow (`npx ccwatts@0.1.1 --demo` verified with an empty HOME), then deleted the npm token and the `NPM_TOKEN` secret. README Try it now lists `npx ccwatts --demo`.

## Exact next step
- CCW-M2.5: Chase reviews and merges the MCP PR. `npx -y ccwatts mcp` works only after the next npm release (0.1.2), which needs Trusted Publishing first (issue #38). Until then the README documents the local `node …/dist/index.js mcp` path.
- CCW-M2.5 follow-up (not done, needs Chase's OK): have the plugin register the MCP server too (plugin `.mcp.json` plus a bundled `bin/mcp.js`), so `/plugin install` brings the tools. Today the plugin's bundle has no `mcp.js` and `ccwatts mcp` there prints the `claude mcp add` line instead.
- M2.4, Chase (optional, on a laptop): `/plugin marketplace add holroydchase-afk/ccwatts`, `/plugin install ccwatts@ccwatts`, then `/ccwatts` and `/ccwatts:statusline`.
- Recruiter-ready stack is merged. Chase: paste the RR-2 INTAKE (in `docs/reviews/2026-10-22-recruiter-ready.md`) into Product Studio if not done.
- M2.1: Chase has only used Claude Code in the browser (cloud sessions), so his Mac has no `~/.claude/projects` logs yet. Oct 23: ran the CLI on a real cloud session's own log (95 responses, 13.5M tokens, Opus 5.5) and it matched an independent dedupe count exactly (same responses, same tokens). Still to do: a run on a local install once Chase uses Claude Code on his Mac, to record `cleanupPeriodDays` (cloud containers have no settings.json).
- M1.9 playground hosting (PR #12): live at chaseholroyd.com/ccwatts/ since Oct 21 (Pages deploys from `main` succeed).
- Next release: set up npm Trusted Publishing first (issue #38; package Settings → Trusted Publisher → GitHub Actions, workflow `publish.yml`), within 2 days of publishing, since the setting expires unused. The token and secret are gone, so the workflow can only publish through it.
- Product Studio: portfolio "Stack" line fix (RR-23) handed to Chase as an INTAKE on Oct 26.
- Waiting on Chase (from the Atlas intake, logged in IDEAS.md): what "metric data" meant for the bench idea.

## Decisions to review
- CCW-M2.5 (Oct 27): the MCP SDK is bundled, not a package.json dependency, so `npx ccwatts` still installs one package (the SDK would otherwise pull ~90, including express and hono, which the stdio server never uses). The tools also update `~/.ccwatts/history.jsonl` like a normal CLI run, so history keeps growing when you only ask through Claude. The README install line uses `npx -y`, since an npx install prompt would hang the MCP pipe.
- Night shift, Oct 23 (CCW-H1): `--path` estimates exactly what you point it at and never reads or writes `~/.ccwatts/history.jsonl`. Reason: the README told people to run the sample with `--path`, which merged synthetic data into their real history for good. People whose logs live elsewhere use `CLAUDE_CONFIG_DIR` (as Claude Code does), which keeps history; `--help` says so. Reversible if you'd rather `--path` keep history.
- Night shift, Oct 23 (CCW-H7): `--demo` covers summary, `--by`, `history` and `--json` (`"sample": true`); `receipt` and `dashboard` refuse it and point to the playground. Not bumping the version overnight; that's part of your next publish.
- npm publish runs in GitHub Actions (`.github/workflows/publish.yml`, manual only, asks you to type the version), so Chase never needs a terminal. It builds and tests before publishing, refuses a version that's already on npm, and publishes with provenance.
- `bin` path is `dist/index.js` (no `./`): npm was rewriting `./dist/index.js` at publish time with a warning.
- Chase, Oct 22: store output × context per day in history (ANCHORS D12, counts only, not shown yet), and v1 is kWh only, with carbon as a possible later opt-in (ANCHORS D13).
- Plugin order (Chase, Oct 22; ANCHORS D11): the Claude Code plugin (PR #21) ships after the npm release (M2.2). #21 carries its own bundled copy of the CLI, so npm doesn't depend on it. Two things to know: PR #18 (removes the unpublished `@ccwatts/core` runtime dependency) must merge before any publish, and #21's new `ccwatts statusline` command won't be in the first npm version unless #21 lands first. When #21 is picked up again, it needs a base merge (HANDOFF/README moved on) and could call the published package instead of the 986-line bundle.
- Recruiter-ready (Oct 22): range units now come from the high bound (a 618 Wh central with a 2,155 Wh high shows as 0.62 kWh, range 0.09 – 2.2 kWh). Share text on your own data says "I estimated", not "I measured".
- QA-2: `npm run check:browser` (the only real-browser test) still runs by hand. Running it in CI means installing Playwright in the workflow; not done without your OK.
- Final product name (P1): Chase leaned to `ccwatts` on Oct 22 and asked for an availability check before locking it. Oct 22 check: `ccwatts`, `@ccwatts/core`, `@ccwatts/cli` are unclaimed on npm (registry 404), also free on PyPI and crates.io; no product, repo or trademark found by web search. Locked Oct 22 on Chase's decision card (PR #35); publish (M2.2) waits on Chase's go.
- Range math: each param's low/high is a ~90% interval; spreads combine root-sum-of-squares in log space; ranges add across types (fully correlated). See METHODOLOGY.md.
- No separate PUE/overhead parameter: per-token values are set at the comprehensive boundary directly, since the sources report at that boundary.
- Unknown models fall back to the Sonnet tier with a warning.
- Our 8-week range (32–678 kWh) is wider than Hausfather's (70–330). Kept on purpose.

- Comparison line picks the first two everyday equivalents that are at least 1 (EV miles, fridge days, phone charges, home days), else the biggest one.
- Added an EPA phone-charge comparison (0.019 kWh) so small totals still get a picture.

- History merge keeps, per day/model/project, the row with more tokens. Claude Code only adds to a day's logs and then deletes whole old files, so this can't double-count or shrink. No per-message IDs are stored.
- Every run of the CLI updates history (opt out with `--no-history`; `--path` and `--demo` never touch it). Summaries read from history, so a 30-day window still works after cleanup.

- The CLI writes SVG only; LinkedIn needs PNG, so the dashboard (M1.6) gets a "Save PNG" button that rasterizes the same SVG in the browser. No native image dependency.
- `--path` accepts a single .jsonl file as well as a folder.

- Playground and dashboard are the same file; playground opens on sample data (clearly labeled) so the first view is never empty.
- Sample windows count back from the last day in the sample; real history counts back from today.
- `npm test` builds the web page first (about 1 second) so the page tests check the real output.

- Hosting: GitHub Pages through Actions (Chase, Oct 21). Live at https://chaseholroyd.com/ccwatts/ (deploys succeed since Oct 21).
- Shared studio agents are in `.claude/agents/` (source: holroydchase-afk/studio-agents; edit there, then sync).

## Blockers
- Oct 22: chaseholroyd.com was added to the cloud env's allowed hosts, but from the container the TLS handshake returns GitHub's `*.github.io` certificate, which doesn't cover chaseholroyd.com, so the page still can't be loaded with verification on. Chase to confirm in a real browser that https://chaseholroyd.com/ccwatts/ has no certificate warning (if it does: Pages settings, re-save the custom domain and tick Enforce HTTPS).
- M2.1 local run needs Chase to use Claude Code on his Mac first (he has only used it in the browser). The parser itself is verified on real cloud-session logs (Oct 23). Not blocking later work.
