# ccwatts: Build Plan

**For:** Claude Code sessions in the `ccwatts` repo
**Owner:** Chase (decides, reviews, ships). Claude Code builds.
**Last updated:** Oct 16, 2026
**Read first:** `ANCHORS.md`. If a change conflicts with an anchor, stop and ask.

---

## What we're building

ccwatts is "ccusage for kilowatt-hours." It's a free, open-source tool that reads your local Claude Code logs and estimates the electricity your usage consumed. Results are reported as a range (low / central / high), with every assumption sourced.

The MVP has three surfaces:

1. **CLI** (`npx ccwatts`): the main surface for developers.
2. **History**: usage over time, preserved even after Claude Code cleans up old logs.
3. **Dashboard**: a local, offline HTML view of the same data. The same page doubles as the hosted playground for people who won't install anything.

## Locked decisions

| # | Decision | Why |
|---|---|---|
| D1 | Developer tool first. Claude Code logs only. | The data is local and rich. Enterprise and the Admin API come later. |
| D2 | Always show a range, never a bare number. | Credibility is the product. Public estimates vary widely. |
| D3 | Logs never leave the machine. No network calls, no telemetry. | Logs contain code and prompts. This is the trust story. |
| D4 | Dev-grade tool, framed for a PM audience. | Devs adopt it. Hiring managers and LinkedIn readers need the translation line. |
| D5 | TypeScript monorepo. One shared core used by the CLI and the web page. | The two surfaces can't drift apart. |
| D6 | No mobile app. The web page is mobile-responsive. | The data lives on laptops, and most LinkedIn traffic is on phones. |
| D7 | Electricity (kWh) only. Leave room in the data model for carbon later. | Keeps the scope honest. |
| D8 | Reuse published parameters (EcoLogits, Microsoft, Google). Don't invent a model. | Defensibility, and less work. |

**Not in MVP:** account connections, the Admin API, other providers or agent CLIs, carbon or water, user accounts, any backend, a mobile app.

---

## Stack and repo layout

- TypeScript (strict), Node 20+, npm workspaces, Vitest, esbuild or tsup.
- Minimal dependencies. Each new runtime dependency needs a one-line reason in the PR.

```
ccwatts/
  packages/
    core/        # parsing, rollups, energy model. Pure functions, no I/O in the model.
    cli/         # npx ccwatts. Reads files and prints output.
    web/         # static dashboard + playground. Imports core.
  methodology/
    params.json  # versioned parameters, each with value/low/high/label/source/date
  fixtures/      # anonymized sample logs (counts only) for tests and the playground
  METHODOLOGY.md
  ANCHORS.md
  PLAN.md
  README.md
```

---

## The energy model (v0)

**Input:** token counts by model and token type:
- fresh input
- cache write
- cache read
- output

**Output:** kWh as low, central and high, broken down by model, token type, day and project.

```
energy = Σ tokens[type] × Wh_per_1k[model_tier][type] / 1000 × overhead (PUE etc.)
```

- **Model tiers:** map each model ID (Opus / Sonnet / Haiku families) to a tier. Unknown models fall back to the nearest tier and get a warning.
- **Parameters:** every value in `params.json` has `value`, `low`, `high`, `label` (DISCLOSED / MEASURED / MODELED / GUESS), `source` (URL) and `as_of`. Bump `version` on any change and print it in every output.
- **Cache reads matter.** Agentic sessions are mostly cache reads, and how we treat them can swing the total. Make the cache-read energy factor its own parameter, give it a wide range, and explain it in METHODOLOGY.md.
- **Sanity checks to run against** (from the research pass, Oct 16):
  - Zeke Hausfather estimated about 170 kWh (range 70–330) for 8 weeks of heavy Claude Code use, with 96% of tokens being cache reads.
  - Microsoft Research puts the median frontier-model query at about 0.34 Wh (IQR 0.18–0.67).
  - Google reports a median Gemini text prompt at 0.24 Wh using a comprehensive boundary.
  - If our numbers land far outside these, explain why in METHODOLOGY.md or fix the model.
- **Boundary:** use the comprehensive boundary (accelerators + host + idle + PUE) and say so in the docs.

---

## MVP surface 1: CLI UI

**Default command:** `npx ccwatts`

```
ccwatts v0.1 · method v0.1 · last 30 days

  Electricity   6.2 kWh   (range 2.9 – 13.1)
  ≈ driving an EV about 25 miles · running a fridge about 5 days

  By model      opus-4.x   71%   sonnet-4.x  27%   haiku  2%
  By type       cache read 58%   output 24%   input 11%   cache write 7%
  Top project   ~/code/ccwatts   2.1 kWh

  How this is estimated: ccwatts --method   ·   Share: ccwatts receipt
```

*(The numbers above are layout placeholders, not estimates.)*

**Flags and subcommands:**

| Command | What it does |
|---|---|
| `--since 7d`, `--since 2026-10-01` | Time window. Default is 30 days. |
| `--by model\|day\|project\|type` | Breakdown table |
| `--json` | Machine-readable output, same numbers |
| `--method` | Prints parameters with sources and the methodology version |
| `receipt` | Prints the one-line share text and writes `ccwatts-receipt.svg` (and `.png` if cheap). This is the screenshot people post. |

**Rules:**
- The comparison line ("≈ X miles") always uses the central value, labeled "about."
- Comparison factors live in `params.json` and are sourced like everything else.
- If no logs are found: say where we looked, how to point at another path (`--path`), and exit cleanly.

**Done when:** a fresh `npx ccwatts` on Chase's machine prints a sane summary in under 2 seconds, and `--json` matches the table output.

---

## MVP surface 2: History

The problem: Claude Code prunes old session logs. The default retention is believed to be about 30 days (`cleanupPeriodDays`), but confirm this in session 1. Without our own record, a user's history disappears.

- On every run, write **daily rollups** (counts only, never content) to `~/.ccwatts/history.jsonl`:
  - key: date + model + project hash
  - values: token counts by type
- Dedupe by message or request ID, so rerunning never double-counts.
- Store project paths as a hash plus the folder's basename. No full paths in any file we write.
- Add `ccwatts history`: weekly table plus a terminal sparkline, all-time total, and best/worst weeks.
- Energy is always **recomputed** from stored counts with the current `params.json`. This lets a methodology update restate history, and the output says which method version was used.
- Add `ccwatts history --export csv`.

**Done when:** deleting the Claude Code logs doesn't erase ccwatts history, and two runs in a row produce identical totals.

---

## MVP surface 3: Dashboard and playground (one page, two modes)

`packages/web` builds a **single static HTML file** with no server and no network calls after load.

| Mode | How it's opened | Data source |
|---|---|---|
| Local dashboard | `ccwatts dashboard` writes `~/.ccwatts/dashboard.html` with the rollups embedded, then opens it | Your history |
| Hosted playground | GitHub Pages (or Vercel) | Drag in a `.jsonl` log file, parsed in the browser, or click "Try sample data" |

**Views:**
1. **Headline:** kWh range, the comparison line, and the method version.
2. **Over time:** daily or weekly bars stacked by token type, with a range band.
3. **By model and by project:** simple ranked bars.
4. **"What drives your number":** a short plain-English explanation of cache reads vs output. This is the PM-audience translation.
5. **Methodology:** the parameter table from `params.json` with sources, plus a link to METHODOLOGY.md.
6. **Share:** the same receipt as the CLI, downloadable.

**Rules:**
- The playground headline says: "Your logs never leave this browser." Enforce it with a CSP that blocks network requests after load, and add a test that asserts no fetch or XHR calls are made.
- Mobile-responsive. Most visitors arrive from LinkedIn on a phone and will only see sample data.
- No frameworks unless needed. A small charting library is fine.

**Done when:** a non-developer can open the playground on a phone, tap "Try sample data," and understand the headline in 10 seconds.

---

## Plan (no time limit per task; one PR each)

IDs follow the studio standard (`docs/planning-ids.md` in holroydchase-afk/studio-agents): milestone `M1`, task `M1.1`, step `M1.1.1`. Across products this repo's code is `CCW` (for example `CCW-M2.1`). Status is todo, doing, blocked, done or dropped. The old S1–S10 labels map to these IDs in `HANDOFF.md`.

### M1: v1, recruiter-demoable (M1.1–M1.8 done Oct 21, 2026)

| ID | Task | Done when | Status | Branch |
|---|---|---|---|---|
| M1.1 | **Scaffold + parse spike.** Set up the workspaces. Find Claude Code logs, read the JSONL, and confirm the fields (`message.usage` input/output/cache-creation/cache-read tokens, `model`, `timestamp`, `cwd`, ids) and log retention. Print tokens by model. | Real token totals print for Chase's logs, and field names are documented in `core/README.md`. **If the fields aren't there, stop and tell Chase.** | done (real-log check moved to M2.1) | `s1-scaffold` |
| M1.2 | **Energy model + params.json.** Seed parameters from EcoLogits and the research sources, then draft METHODOLOGY.md. | Unit tests pass, and the central estimate is within an explainable distance of the sanity checks | done | `s2-energy-model` |
| M1.3 | **CLI summary**, `--by`, `--json`, `--method`. Fixture-based tests. | Output matches the mock layout. Snapshot tests pass. | done | `s3-cli` |
| M1.4 | **History**: rollups, dedupe, `history`, CSV export. | Survives log deletion, and reruns produce identical totals | done | `s4-history` |
| M1.5 | **Receipt**: share line plus SVG card. | Chase would actually post the image | done | `s5-receipt` |
| M1.6 | **Web dashboard**: shared core build and `ccwatts dashboard`. | Opens offline with real history | done | `s6-dashboard` |
| M1.7 | **Playground**: drop-file parsing, sample data, CSP, deploy. | Works on a phone, and the no-network test passes | done | `s7-playground` |
| M1.8 | **v1 README** with screenshots from demo data. | A recruiter understands it from the README alone | done | `v1-readme` |
| M1.9 | **Playground hosting** on GitHub Pages via Actions. | Playground is live at chaseholroyd.com/ccwatts | done (Chase, Oct 21) | `playground-pages` |

### M2: Friend beta

| ID | Task | Done when | Status | Branch |
|---|---|---|---|---|
| M2.1 | **Real-log run** on Chase's laptop. | Totals look right and `cleanupPeriodDays` is recorded in `core/README.md` | todo (Chase) | n/a |
| M2.2 | **Ship**: npm publish, README with GIF, test on a clean machine. | A friend installs it in under 60 seconds | done (0.1.1 on npm, Oct 26) | `m2.2-ship` |
| M2.3 | **Friend beta fixes.** | Top 3 issues from beta feedback fixed | todo | `m2.3-beta-fixes` |
| M2.4 | **Claude Code plugin**: `/ccwatts` and the status line. | Plugin installs from this repo and runs the CLI | done (PR #21) | `claude/project-thread-*` |
| M2.5 | **MCP server**: `ccwatts mcp` on stdio with `energy_summary`, `energy_by_project`, `energy_weekly`, `methodology` (ANCHORS D14). | All four tools answer in a Vitest test and a manual Claude Code run | done (PR #45) | `claude/project-thread-a66r4n` |
| M2.6 | **Release: functional, high-quality demo** (Chase's 7-phase plan, Oct 28). One PR per step, stacked: M2.6.1 plan; M2.6.2 works for real (day-one gaps F1–F8: missing `--path`, empty files, `--json` with no logs, `mcp` in a terminal, `help`, plural/one-week copy, `--method` link, playground read errors); M2.6.3 UI to 8/10 (ux-reviewer before 6.5 playground / 6 CLI); M2.6.4 harden (qa-tdd bad-input suite, privacy-security review); M2.6.5 enhancements (cache-read "what if" slider; plugin registers MCP if Chase OKs); M2.6.6 demo check on the live page; M2.6.7 reusable blocks (CI on main + badge, Pages gated on CI, dependabot, privacy pre-commit check). | Each step's PR is green 3x with an `Agents:` line; ux-reviewer scores ≥8 after; live playground loads with sample data | doing | `claude/project-thread-xfle8z*` |

### M3: Methodology v0.2

| ID | Task | Done when | Status | Branch |
|---|---|---|---|---|
| M3.1 | **Methodology hardening** after an outside sanity check. | METHODOLOGY v0.2 tagged | todo | `m3.1-methodology` |

### M4: Pace (work-rhythm signals)

From issue #71 (Chase's go, Oct 31, 2026). Opt-in `ccwatts pace`. Pace logic is pure core behind the adapter interface (ANCHORS P2), with no ccwatts-specific terms. Later items (status-line nudge, opt-in share card, MCP pace tool) are not scheduled. Every M4 PR also meets PACE-6: no new network calls.

| ID | Task | Done when | Status | Branch |
|---|---|---|---|---|
| M4.1 | **Spike (no ship).** Detect human turns from log structure alone, and pick the default gap threshold. | Findings and the chosen default gap are written up; nothing ships | done (Oct 31, `docs/spikes/2026-10-31-pace-spike.md`; default gap rechecked on a multi-day Mac log with M2.1) | `claude/project-thread-qdyp4r` |
| M4.2 | **Core `pace.ts`** with fixtures: overnight blocks, a DST change, and an agent run with no human turns (counted as agent time, not pace hours: Chase, Oct 31). Gap thresholds 10/20/30 min in `params.json`, labeled heuristic. | PACE-1: two blocks split by a 45 min gap count as two blocks, with active time as a range. PACE-2: a block crossing midnight counts minutes on the right local days, including across DST. | done (Oct 31) | `claude/project-thread-qdyp4r` |
| M4.3 | **History: daily pace counts.** New pace.jsonl, PACE_SCHEMA 1, with architect review. Store active min low/central/high, late-night min, longest block, and first/last active hour per day. | PACE-3: history stores only daily pace counts, and a test proves no per-response timestamps are written | done (Oct 31) | `claude/project-thread-qdyp4r-m4.3` |
| M4.4 | **CLI `ccwatts pace`**: weekly line plus a 4-week table. `--share-pace` opt-in for share outputs. | PACE-4: receipt, card and post hold no pace data unless `--share-pace` is passed. PACE-5: every pace number names the gap thresholds and the method version. | done (Oct 31) | `claude/project-thread-qdyp4r-m4.4` |
| M4.5 | **Dashboard and playground Pace tab** on sample data. | PACE-5 holds on the tab, and the no-network test still passes (PACE-6) | todo | `m4.5-pace-web` |

## Conventions for Claude Code

- Keep the core pure: parsing and math take data and return data. All I/O happens in the CLI or web packages.
- Every number shown to a user comes with its range and the method version.
- Never write prompt or response content anywhere. Counts only.
- Never add network calls, telemetry, or analytics.
- One PR per task (`M1.2`). Branch `m1.2-short-name`, PR title `M1.2: short name`. Each PR description says what changed, how it was tested, and any open question for Chase.
- When unsure about a product decision, check ANCHORS.md, then ask. Don't guess.

## Definition of done (MVP)

- [ ] `npx ccwatts` works on a clean macOS and Linux machine
- [ ] Ranges everywhere; METHODOLOGY.md and params.json are complete with sources
- [ ] History survives Claude Code log cleanup
- [ ] Local dashboard and hosted playground both work, with no network calls
- [ ] README has a GIF, the privacy statement, and the methodology link
- [ ] 3–5 friend devs have run it and sent back their numbers
