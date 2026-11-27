# Shared inventory: what in ccwatts could be reused

Intake #139, scoped by Chase on Nov 27, 2026: **inventory only, build nothing.** This lists everything in ccwatts that another studio product, or another "measure your AI or dev usage" tool, could reuse. It covers UI, core logic, the CLI, tooling, CI, docs and assets. Each item says what it does in product-neutral words, so it can go into Building Blocks, which uses no product words.

Audited against `main` at `4f71b87` (Nov 27, 2026), plus the site header in PR #130 (branch `claude/project-thread-v7ay52`, not merged yet). Read-only: no code changed.

## How to read the tables

- **Cat (category):** `UI` generic UI · `TOOL` generic tooling · `DOM` domain-shareable (any usage-to-impact estimator, or any tool that reads local AI-agent logs) · `ONLY` ccwatts-only (listed so nobody goes looking for it).
- **Home** (where it would live):
  - `BB`: Building Blocks, the shared base for React and web UI.
  - `SA`: studio-agents, for tooling, CI and agent wiring.
  - `RANGE`: a proposed shared "estimates with ranges" library. It doesn't exist yet. It would be pure TypeScript with no dependencies, usable by a CLI or a browser.
  - `LOGKIT`: a proposed shared "local agent-log reader" for sibling tools that read Claude Code (or similar) logs.
  - `PORT`: the portfolio site repo.
- **Effort:** S is under a day, copied file plus a sync script. M is one to three days, needing an API cleanup or a React port. L is more than that, or needs a design decision first.
- **Rules that must travel:** the hard rules a copy has to keep. They come from CLAUDE.md: no network, counts only, no full paths, and every number gets a range and a method version.

The studio rule applies to every row: extract a block only when a second product needs it, as a copied file plus a sync script before it becomes a package.

---

## 1. Core: estimates with ranges (`packages/core`)

All pure TypeScript with no I/O, so it already runs in Node and in the browser.

| Item | Path | What it does (product-neutral) | Cat | Home | Effort | Blockers | Rules that must travel |
|---|---|---|---|---|---|---|---|
| Range type and add | `packages/core/src/energy.ts` (`Range`, `zeroRange`, `addRange`) | A `{low, central, high}` triple and in-place sum. The base type for any estimate shown as a range. | DOM | RANGE | S | Named "energy in Wh" in comments; rename the doc to unit-free. | Never shown without low and high. |
| Log-space range combination | `energy.ts` (`factor`, `energyForTokens`) | Multiplies a chain of sourced parameters. Each low/high is treated as an independent ~90% interval on a log scale; spreads combine root-sum-of-squares; result = central ÷ e^down … central × e^up. | DOM | RANGE | M | Chain is hard-coded per token type (`chain()`); a shared version needs a generic "chain of param ids" input. | Method doc (METHODOLOGY "How the range is built") must travel with it. |
| Breakdown by dimension | `energy.ts` (`estimate`, `Breakdown`, `Dimension`) | Totals plus breakdowns by model, type, day, group, each carrying its own range. | DOM | RANGE | M | Tied to `UsageRecord` and token types; needs a generic "record with counts + keys" shape. | Group keys are hash + basename, never paths. |
| Share-of-total range | `packages/core/src/format.ts` (`shareRange`, `formatShare`) | A part's share of a total at low/central/high corners, min/max of the three ratios; prints "64% (30–72%)", "7%" when all round equal, "<1%" for tiny. | DOM | RANGE | S | None. | Range on every share. |
| Number rounding for display | `format.ts` (`num`, `int`, `fixed`) | Rounds to sensible digits by size; keeps one decimal 1–100 so totals line up across surfaces. | UI | RANGE | S | `en-US` locale fixed. | None. |
| Unit picking for a range | `format.ts` (`formatEnergy`) | Picks Wh or kWh from the high bound and uses it for the whole range, so a range never mixes units. Tight en dash. | DOM | RANGE | S | Generalise to a unit ladder (W h/kWh, g/kg, ml/l). | Range + unit together. |
| Range-end significant figures | `energy.ts` (range-end rounding, `roundAmount`) | Range ends at 2 sig figs, ≤1 decimal, "<0.1" above zero, nothing printed when both ends round the same. Stops ends claiming more precision than the central. | DOM | RANGE | S | Private helpers today; export them. | None. |
| Everyday comparisons | `energy.ts` (`comparisons`, `ComparisonLine`), `packages/core/src/receipt.ts` (`everyday`, `rereadShare`) | Converts a total into relatable equivalents ("miles in an EV", "phone charges", "days of a fridge"), each with its own range; small totals read as "about 30% (10–90%) of a phone charge", never >100%. | DOM | RANGE | M | Copy and phrasing are energy-specific; extract the mechanism (pick 1–2 comparisons ≥1 unit, range in same unit) and keep the words per product. | Each comparison factor is sourced in params; range carries. |
| Sourced parameter schema | `packages/core/src/params.ts` (`Param`, `Comparison`, `ConfidenceLabel`, `Params`), `methodology/params.json` | Every number has value, low, high, unit, label (DISCLOSED/MEASURED/MODELED/GUESS), source URL, as_of, note. Top level has version, as_of, license, boundary, interval. | DOM | RANGE | S | `Params` type mixes generic fields with ccwatts sections (`tiers`, `pace`, `token_mix`); split into a generic `ParamSet` plus product extensions. A JSON Schema file would help non-TS users. | CC BY 4.0 for the data (ANCHORS P4); every param sourced. |
| What-if overrides | `params.ts` (`withOverrides`) | Copies a param set with some values moved (spread kept by ratio) or pinned (low = high). Powers "what if" sliders without touching the published number. | DOM | RANGE | S | None. | UI must label a what-if as not published. |
| Method versioning | `methodology/params.json` `version`, METHODOLOGY "Versioning", every surface printing `method vX` | A version on the parameter set, printed next to every number, so old screenshots stay interpretable. | DOM | RANGE (convention + helper) | S | Convention more than code; document it in the RANGE README. | Every number shows the method version. |
| Model tier matching | `energy.ts` (`tierFor`) | Maps a model id to a tier by substring, with a fallback and a `known` flag. | DOM | LOGKIT | S | Tier table is Claude-specific data; the mechanism is generic. | Unknown model must be flagged, not silently guessed. |
| Estimate from a typed total | `packages/core/src/manual.ts` (`parseTokenCount`, `estimateFromTotal`, `MIX_GUESSED`) | Parses "88.8M", "1.2k", "88,800,000"; estimates from a total with an assumed type mix, widening the range. | DOM | RANGE (parser) / LOGKIT (mix) | S | Mix shares are ccwatts data. | Range widens when the mix is guessed; say so. |
| Eval scorecard | `evals/scorecard.ts`, `evals/cases.json`, `evals/models.json`, `scripts/run-evals.ts` | Checks a model's central sits inside each reference's range and vice versa; writes a markdown scorecard; `--check` fails if stale. | DOM | RANGE | M | Case format tied to tokens and Wh. | Local files only. |
| Time windows | `packages/core/src/window.ts` (`parseSince`, `dropFuture`, `futureNote`) | Parses "7d", "12h", "4w", "2026-10-01", "all" with an injected clock; drops future-dated records with a note. | TOOL | LOGKIT (or RANGE utils) | S | None. | Pure; clock injected. |
| Weekly bucketing | `packages/core/src/history.ts` (`weekStart`, `weekly`) | Monday-start weeks and weekly sums of ranges. | TOOL | RANGE | S | None. | None. |

## 2. Core: local agent-log reading and privacy (`packages/core`)

| Item | Path | What it does (product-neutral) | Cat | Home | Effort | Blockers | Rules that must travel |
|---|---|---|---|---|---|---|---|
| Usage adapter interface | `packages/core/src/types.ts` (`UsageRecord`, `UsageAdapter`, `ActivityEvent`, `TokenCounts`) | A provider-neutral record of one billed response (source, dedupe key, time, model, four token counts, project ref) and an adapter contract (ANCHORS P2). | DOM | LOGKIT | S | None; already designed for more providers. | Adapters must never copy content into a record. |
| Claude Code log adapter | `packages/core/src/adapters/claude-code.ts` | Reads Claude Code JSONL, keeps only usage fields, caps absurd token counts (`MAX_TOKENS_PER_RESPONSE`), skips code fences. | DOM | LOGKIT | S | Log format can change under it; any sibling depends on its fixtures. | Counts only; content fields ignored. |
| Dedupe and rollups | `packages/core/src/rollup.ts`, `history.ts` (`rollup`, `mergeHistory`, `serializeHistory`, `parseHistory`, `HISTORY_SCHEMA`, `okCount`, `okDate`) | Dedupes responses across files; rolls up to one row per day/model/project; versioned JSONL history that outlives log pruning; validates every field on read. | DOM | LOGKIT | M | Row shape has ccwatts-specific `outputContext`. | No energy stored, counts only; schema version in header. |
| Counts-only log copy | `packages/core/src/counts-only.ts` (`countsOnlyLog`) | Rebuilds each log line from an allowlist (timestamps, ids that look like ids, model, counts, hashed project), dropping all text. | DOM | LOGKIT | S | None. | The whole point; keep its tests with it. |
| Project reference | `packages/core/src/project.ts` (`projectRef`, FNV-1a 64) | Turns a full path into hash + cleaned basename; handles roots and drive letters. Pure JS hash so it runs in browsers. | DOM | LOGKIT | S | None. | No full paths. Unsalted hash: never put it in a shareable file (PS-R5). |
| Display-safe names | `packages/core/src/sanitize.ts` (`safeName`, `NAME_MAX`) | Strips C0/C1 controls, ESC, DEL, bidi marks; caps length by code point. For any untrusted string shown in a terminal, HTML or model context. | TOOL | LOGKIT (or a tiny shared util) | S | None. | Apply before any display. |
| Work-rhythm (Pace) | `packages/core/src/pace.ts`, `pace-week.ts`, `pace-copy.ts`, `pace-history.ts` | From activity timestamps: active blocks at three idle-gap settings (a range), late-night hours, longest stretch, rest days, agent-only time, compared only to your own past weeks. Plain-string copy shared by CLI and web. | DOM | LOGKIT (separate module) | M | Copy is product voice; thresholds are GUESS params. Only a sibling that cares about work rhythm needs it. | Never stores time zone or event times (PS-R5, PS-R7); explicit key lists, no spreads; numbers, never a verdict. |
| Bedtime nudge | `packages/core/src/nudge.ts` (personas, `inBedtimeWindow`, `bedtimeNudge`, settings parse) | Opt-in line shown in a time window (wraps past midnight), persona by seed, stable within an hour, fits 78 columns. | DOM | LOGKIT (optional) | S | Copy is product voice. | Off by default; no health claims; injected clock. |
| Share text and card | `packages/core/src/receipt.ts` (`shareLine`, `linkedInPost`, `receiptSvg`) | Builds a one-line share, a longer social post and a 1200×627 SVG "receipt" card from an estimate, labelling sample data. | DOM | RANGE (card layout) | M | Layout and copy are ccwatts; extract the "receipt slip with range and method version" SVG builder. | Card shows range + method version; sample flagged. |
| Product constants | `packages/core/src/meta.ts` | Name, version, URLs in one place (ANCHORS P1). | ONLY (pattern is shared) | — | — | — | — |

## 3. CLI (`packages/cli`)

| Item | Path | What it does (product-neutral) | Cat | Home | Effort | Blockers | Rules that must travel |
|---|---|---|---|---|---|---|---|
| 80-column report layout | `packages/cli/src/render.ts` (`COLS`, `shares`, `clip`, `summary`, `breakdown`) | Summary within 80 columns; fits as many "label share (range)" items as room allows and says how many were left off. | TOOL | RANGE (render helpers) | M | Functions take ccwatts `Estimate`; split layout helpers from content. | Range + method version on every line. |
| ANSI styles with off switch | `render.ts` (`styles`) | Bold/dim/yellow that become no-ops when colour is off. | TOOL | SA (cli kit) | S | Tiny; may not be worth a block alone. | Respect NO_COLOR / non-TTY. |
| Terminal sparkline | `render.ts` (`sparkline`) | One block character per value, scaled to the max. | UI | RANGE (render helpers) | S | None. | None. |
| JSON/CSV output | `render.ts` (`json`, `manualJson`, `jsonError`, `historyCsv`, `paceCsv`) | Machine output with low/central/high and method version; typed error codes. | DOM | RANGE (pattern) | S | Field names are ccwatts. | Ranges and method version in JSON. |
| Status-line one-liner | `render.ts` (`statusLine`), `plugins/ccwatts/skills/statusline/SKILL.md` | One line under Claude Code's prompt with the session's estimate, plus a skill that installs it in the user's settings. | DOM | LOGKIT (pattern) | S | The skill edits user settings; each tool needs its own copy path. | Range + method version even in one line. |
| Safe error lines | `packages/cli/src/errors.ts` (`reason`, `errorLine`) | Prints an error's code, never its message, or cuts absolute paths (POSIX, Windows, quoted) out of it. | TOOL | SA (cli kit) or LOGKIT | S | None. | No full paths in output. |
| Log discovery and loading | `packages/cli/src/logs.ts` (`defaultLogRoots`, `loadLogs`, `unreadableNote`) | Finds Claude Code log roots (`CLAUDE_CONFIG_DIR` list) and reads them, reporting unreadable files by reason only. | DOM | LOGKIT | S | Node fs; Claude Code paths. | No paths in notes. |
| Local data store | `packages/cli/src/store.ts` (`dataDir`, read/write history, settings) | `~/.<app>` store, overridable by env, named from the app constant. | TOOL | LOGKIT | S | None. | Counts only on disk. |
| MCP server over stdio | `packages/cli/src/mcp.ts` (`createServer`, `serveStdio`, tool fns) | Exposes the same pure core as MCP tools over stdin/stdout: no port, no listener. Every answer carries low/central/high and method version. | DOM | LOGKIT (template) | M | Runtime deps `@modelcontextprotocol/sdk` and `zod` (bundled). A sibling copies the shape, not the tools. | No network (ANCHORS D14); counts only; basenames only. |
| Offline dashboard writer | `packages/cli/src/dashboard.ts` (`writeDashboard`, `opaqueProjectIds`, `openFile`) | Writes the single-file web page with the user's rollups embedded; swaps project hashes for "1", "2" labels in anything shareable. | DOM | RANGE/LOGKIT (with §4 builder) | M | Depends on the web builder. | PS-R5: no ids in a shareable file. |
| Claude Code plugin packaging | `plugins/ccwatts/` (plugin.json, `.mcp.json`, skills), `.claude-plugin/marketplace.json`, `scripts/build-plugin.ts` | Ships the bundled CLI + MCP server as a Claude Code plugin with slash-command skills; CI fails if the committed bundle is stale. | TOOL | SA (plugin template) | S | Committed bundles are large. | Plugin has no network. |
| Session counts Stop hook | `scripts/save-session-counts.ts` | Claude Code Stop hook saving a counts-only copy of the session log so cloud usage survives the container. Never blocks. | DOM | LOGKIT | S | Default dir is this project's mount. | Raw private data: never in fixtures or demos (PS-R19). |

## 4. Web page (`packages/web`)

Vanilla TypeScript building HTML strings, with one inlined CSS block. **Every item below needs a React port before it fits Building Blocks.** That's the main blocker for this whole section.

| Item | Path | What it does (product-neutral) | Cat | Home | Effort | Blockers | Rules that must travel |
|---|---|---|---|---|---|---|---|
| Design tokens (Paper theme) | `packages/web/src/template.html` `:root` block; source `docs/design/tokens.json`, `themes.css` | Colours, data colours (never the accent), mono/sans stacks, light/dark via `prefers-color-scheme` *and* a `data-theme` override, high-contrast (`prefers-contrast:more`) variants for both. | UI | BB (already sourced from the hearth design system) | S | Values are hand-copied into the template; BB should be the one source and products import it. | None. |
| Single-file offline page builder | `packages/web/build.ts`, `packages/web/src/inject.ts` (`safeJson`, `injectData`, `DATA_MARKER`) | Bundles the app into one HTML file: inline script with a sha256 CSP (`default-src 'none'`), inlined woff2 font, build-time sample data, a JSON data island safe against `</script>`. Same file serves as the hosted demo and the local dashboard. | TOOL | SA (template) | M | esbuild call is ccwatts-specific; product placeholders (`__WHATIF_*__`). | No network after load is enforced by the CSP; keep it. |
| Tabs + hash router | `app.ts` (`allTabs`, `selectTab`, `route`, `go`, `toViewTop`, `wireTabs`); CSS `.tabs`, `[role=tabpanel]` | WAI-ARIA tabs with roving tabindex, arrows wrap, Home/End; each view has a hash for deep links and Back; sticky row with scroll-fade under 375px; hidden panels keep their layout so charts keep size. | UI | BB | M | React port; file:// pushState fallback must come with it. | None. |
| Theme picker | `app.ts` (`applyTheme`, `wireTheme`); CSS `.seg` | Light/Dark/System segmented control; in memory only, so a reload goes back to System. | UI | BB | S | React port. | No storage (PS-R1). |
| Segmented control | CSS `.seg`, `aria-pressed` buttons | Pill group where the picked item gets an accent outline and word, never colour alone. | UI | BB | S | React port. | None. |
| Disclosure | CSS `.disclose`, `details` rules | 48px summary row with a rotating chevron; closed content takes no space; reduced-motion aware. | UI | BB | S | CSS only; easy. | None. |
| Grouped list rows | CSS `.group`, `.list`, `.row`, `.chev` | Settings-style list; each row is one whole tap target with title, big value, detail and chevron. | UI | BB | S | React port. | None. |
| Buttons | CSS `main button`, `.btn`, `.primary`, `.tinted`, `.vh` + label | Secondary/primary/tinted pills at 48px; visually-hidden file input with a styled, keyboard-reachable label. | UI | BB | S | React port. | None. |
| Range bar (log scale) | `app.ts` (`rangeAt`, `renderRangeBar`); CSS `.range-track`, `.range-dot`, `.range-ends` | Track with low/high end caps and a dot for the central placed on a log scale; one labelled image for screen readers. | DOM | BB (as a generic RangeBar) + RANGE (`rangeAt`) | S | React port. | Label must name low, central and high. |
| Stacked daily bar chart | `app.ts` (`renderChart`, `niceStep`, `chartWidth`, `SERIES`) | SVG drawn 1:1 at on-screen width so labels stay 17px; nice axis steps; stacked series in data colours; fewer ticks on phones; aria summary with the total and range. | UI | BB | M | React port; redraw-on-resize logic. | aria label carries the range. |
| Bars with range whiskers | `app.ts` (`renderPaceChart`, `whisker`) | Grouped bars with low–high whiskers, an overlay segment, and a hatch for an in-progress period. | DOM | BB (RangeBars) | M | React port; pace copy inline. | Ranges drawn, not just centrals. |
| Ranked list with bars | `app.ts` (`renderRank`); CSS `.rank` | Bill-style line items: name, amount, proportional bar, range under it. | DOM | BB | S | React port. | Range on each line. |
| Parameter/method table | `app.ts` (`renderMethod`, `sourceName`); CSS table rules, `@media (max-width:600px)` | Renders a sourced param set as a table (value, range, unit, confidence label, source host link, note disclosure); turns into stacked blocks on phones instead of scrolling sideways. | DOM | BB (component) + RANGE (data) | S | React port; reads `Params` shape. | Every param shows its source and label. |
| What-if slider | template `#whatif`, `app.ts` (`setWhatIf`, `renderWhatIf`), build-time bounds | Slider bounded by the param's published low/high, a "published" tick, a reset, a flag on every view while active; share card always uses the published value. | DOM | BB + RANGE (`withOverrides`) | M | React port; bounds injected at build. | Never present a what-if as published. |
| File drop + in-browser parsing | `packages/web/src/read.ts` (`readLogFiles`, `readPaste`); `app.ts` drop/pick wiring; CSS `.drop` | Folder or file picker, drag-drop, paste box; reads files one at a time in the browser, never throws, messages name no file. | DOM | BB (drop zone UI) + LOGKIT (reader) | M | React port for the UI. | Nothing uploaded; CSP blocks requests. |
| Copy with fallback | `app.ts` (`copy`, `copyCloud`) | Clipboard write; on failure opens the box and selects the text, saying so; button label confirms for 2 s. | UI | BB | S | React port. | None. |
| Download + SVG→PNG | `app.ts` (`download`, `savePng`, `renderShare` blob URL) | Saves a blob; rasterises an SVG card to PNG via canvas; "open full size" from a blob: URL so nothing is fetched. | UI | BB | S | React port. | Stays in-browser. |
| Responsive DOM reorder | `app.ts` (`placeCloud`) | Moves an element in the DOM (not CSS order) on a breakpoint so focus order matches what you see. | UI | BB (pattern note) | S | Pattern, not a component. | None. |
| No-wrap ranges | `app.ts` (`keepRanges`, `keep`, `keepHtml`) | Wraps "(low–high)" and "a – b" in no-wrap spans so a phone never breaks inside a range. | DOM | RANGE (string helper) | S | None. | None. |
| Status line | CSS `.status`, `setStatus` | Live region that hides when empty; error variant with a left rule. | UI | BB | S | React port. | None. |
| Demo bar (current) | template `#demo-bar`, `app.ts` (`wireDemoBar`); CSS `.demo-bar*` | Portfolio strip: back link, product name, "sample / your files" summary, push-down drawer with Esc. Spec from pm-tools `docs/DEMO-BANNER.md`. | UI | PORT (owner) / BB | S | Already a studio pattern; ccwatts has its own copy. | Copy says nothing is uploaded. |
| Site header + drawer (PR #130, not on main) | branch `claude/project-thread-v7ay52`: `template.html` `#site-bar`, `app.ts`, `docs/product/SPEC-SITE-HEADER.md`, tests `site-header*.test.ts` | Portfolio header copied in look from the portfolio's `demo-bar.js/.css`, rebuilt inline so the CSP stays `default-src 'none'`; Part B swaps the strip for an "About this demo" dialog/bottom sheet. | UI | PORT (source) → every demo | M | Owned by the portfolio; today each demo copies the look by hand. Needs one CSP-safe inline version (no external file) for offline demos. | No external script/style/font; no storage key. |
| Font | `packages/web/src/fonts/AtkinsonHyperlegibleNext-latin.woff2`, `OFL.txt` | Studio font, Latin subset, inlined as data: URL. | UI | BB | S | None (OFL lets it travel; keep OFL.txt). | Inlined, never fetched. |
| Window labels | `packages/web/src/labels.ts` | "last 7 days" vs "sample" so sample data never reads as stale. | DOM | RANGE (pattern) | S | Tiny. | Sample flagged. |
| Lede, copy, prompts | template copy, cloud/export prompts | Product words. | ONLY | — | — | — | MARKETING.md governs. |

## 5. Scripts and tools

| Item | Path | What it does (product-neutral) | Cat | Home | Effort | Blockers | Rules that must travel |
|---|---|---|---|---|---|---|---|
| Showcase check kit | `tools/showcase-check/` (`check.ts`, `cli.ts`, `shots.ts`, `selftest.ts`, fixtures, README) | Headless Chromium at phone and laptop, light and dark: network requests, console errors, sideways scroll, tap targets, keyboard reach, unfinished text, broken images, tiny text; screenshots. Plugs product checks in via `extra`. Imports no ccwatts code. | TOOL | SA | S | Already written to be lifted; studio-agents is `.mjs`, this is TS: pick one or ship both. | — |
| No-network browser check | `scripts/check-no-network.ts` | Loads the built page, uses sample data and the file picker, fails on any request, error or phone sideways scroll. Large (775 lines) with ccwatts flows. | DOM | SA (generic part is the kit; the rest stays) | M | Mostly product flows; the generic core is already the kit. | The no-network promise. |
| Live check | `scripts/check-live.ts` | After deploy: 200, no other-host requests, no errors, no sideways scroll, sample labelled, footer version matches package, load time. | TOOL | SA | S | Version/sample checks are ccwatts selectors; parametrise. | Read-only. |
| ux-rules | `scripts/ux-rules.ts` | Checks the studio rules code can check (G1–G5, G7–G9, G11; V2, V5, V9) at three widths. | TOOL | SA (already the source of the `.mjs`) | S | TS port of a studio-agents tool; header still says `#!/usr/bin/env node`. | — |
| ux-shots | `scripts/ux-shots.ts` | Screenshot set at phone/laptop, light/dark, plus a problem report; `--no-network`. | TOOL | SA (already the source of the `.mjs`) | S | Same as above; overlaps with kit `shots.ts`. | Sample data only, never live data. |
| Private-data check + hook | `scripts/check-private.ts`, `.githooks/pre-commit`, `studio-checks.json` `private` | Scans for home paths, emails, tokens/keys, `.env`; `--staged` mode bans the machine's login name and git email. | TOOL | SA | S | Check whether studio-agents already has one; if not, this is the candidate. | Allowlist lives per repo. |
| Log check | `scripts/check-logs.ts` | Static check that no `console.*` logs keys, URLs, emails or raw errors. | TOOL | SA (it came from there) | — | Already shared; TS port is the share-back. | — |
| QA report checker | `scripts/check-qa-report.ts` + 50 fixtures in `packages/cli/test/fixtures/qa-report/` | Validates the qa-tdd report block. | TOOL | SA (TS port of its `.mjs`) | S | Same TS-vs-mjs question. | — |
| Agent-run logging | `scripts/log-agent-run.sh`, `check-agent-runs.sh`, `check-agents.sh`, `agent-prompt.sh`, `check-handoff-status.sh` | Agent roster/log/verify wiring. | TOOL | SA (they came from there) | — | Already shared; `agent-prompt.sh` and the `--as` mode were added here (#104); confirm they're upstream. | Logs agent name only, never the prompt. |
| Release check | `scripts/check-release.ts`, `studio-checks.json` `release` | Without publishing: no workspace deps, `npm pack` allowlist, offline install into empty HOME, smoke commands, no temp-path leaks, version drift across manifests. | TOOL | SA | S | Config already in `studio-checks.json`; nothing ccwatts-specific in the logic. | Output must not leak paths. |
| OG image render | `scripts/make-og-image.ts`, `packages/web/src/og.svg` → `public/og.png` | Renders an SVG to a 1200×627 PNG link preview. | TOOL | SA | S | Paths hard-coded. | Crawler fetches the image; the page never does. |
| README image/GIF capture | `scripts/make-readme-images.ts`, `make-readme-gif.ts` | Re-shoots README screenshots from the built page; records terminal GIFs from the real CLI (Playwright + ffmpeg). | TOOL | SA | M | Shot list is product-specific; the terminal-to-GIF part is the generic piece. | Sample/demo data only. |
| Synthetic fixture generator | `scripts/make-demo-fixture.ts`, `fixtures/claude-code/demo.jsonl` | Seeded 30 days of fake, counts-only Claude Code usage for demos and tests. | DOM | LOGKIT | S | None. | Synthetic only; never real logs. |
| Pace spike | `scripts/pace-spike.ts` | Throwaway exploration. | ONLY | — | — | — | — |

## 6. CI, repo and agent wiring

| Item | Path | What it does | Cat | Home | Effort | Blockers | Rules that must travel |
|---|---|---|---|---|---|---|---|
| CI | `.github/workflows/ci.yml` | Install, roster/log/private checks, build, typecheck, test, stale-bundle check, browser job. | TOOL | SA (template) | S | Steps are npm-script driven, so mostly generic. | — |
| Pages deploy + live check | `.github/workflows/pages.yml` | Deploys only after green CI on push; then checks the live page read-only with retries. | TOOL | SA | S | Compare with the studio Pages workflow (consistency check). | — |
| Publish with provenance | `.github/workflows/publish.yml` | main-only, drops credentials and npm cache, `npm publish --provenance` (Trusted Publishing pending, #38). | TOOL | SA | S | Not yet proven end to end. | Only on Chase's go. |
| Security, CodeQL, lint, agents, handoff | `security.yml` (gitleaks full history, `npm audit`), `codeql.yml`, `lint.yml`, `agents-check.yml`, `handoff-check.yml` | Standard set. | TOOL | SA (most already from there) | S | — | — |
| Workflow hygiene tests | `packages/cli/test/repo.test.ts` (RB-1..RB-5, AC1..AC10) | Asserts SHA-pinned actions, deploy-after-CI, publish guards, dependabot groups, hook wiring, agent-log rules. | TOOL | SA | M | Some assertions name ccwatts files. | — |
| All-TypeScript guard | `packages/cli/test/typescript.test.ts` (TS-1, TS-1a) | Fails on any `.js/.mjs/.cjs` outside allowed paths. | TOOL | SA (opt-in) | S | Only for repos that choose TS-only. | — |
| Dependabot, templates, configs | `.github/dependabot.yml`, `ISSUE_TEMPLATE/`, `PULL_REQUEST_TEMPLATE.md`, `eslint.config.mjs` + `eslint.studio-local.mjs`, `tsconfig.base.json`, `vitest.config.ts`, `.nvmrc`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SUPPORT.md` | Standard repo set. | TOOL | SA (mostly already from there) | S | — | — |
| review-rounds skill, design rules | `.claude/skills/review-rounds/SKILL.md`, `.claude/design-rules.md` | Synced from studio-agents. | TOOL | SA (already) | — | Already shared. | — |

## 7. Methodology, docs and assets

| Item | Path | What it does | Cat | Home | Effort | Blockers | Rules that must travel |
|---|---|---|---|---|---|---|---|
| Methodology doc structure | `METHODOLOGY.md` (short version, boundary, model, parameters, how the range is built, ranges on shares and comparisons, estimating from a total, sanity checks, comparison with other tools, versioning, open questions) | A template for any "we estimate X from usage" product: a skeleton a sibling can fill in. | DOM | RANGE (template doc) | S | Content is energy; extract the headings and the range maths section. | CC BY 4.0. |
| Architecture data map | `docs/architecture/DATA.md` | Where data lives, what it holds, whether it leaves; guards. | TOOL | pm-tools template (already) | — | See drift note: no "Last checked against code" footer. | — |
| Design system copy | `docs/design/` | Vendored from hearth. | UI | BB / hearth (source) | — | Already shared; ccwatts is a consumer. | — |
| Plugin icon, OG image, README images | `plugins/ccwatts/.claude-plugin/icon.png`, `packages/web/public/og.png`, `docs/images/*` | Product art. | ONLY | — | — | Pipelines (§5) are the shareable part. | — |
| Inline SVG icons | template: lock (privacy), chevron, back arrow | Tiny inline icons, `aria-hidden`, `currentColor`. | UI | BB (icon set) | S | Probably already covered by BB's icons; check first. | — |

---

## Top 10 to extract first

Ranked by value to a second product, divided by the cost to extract. Each one waits for a named second user, as the studio rule says.

1. **Range maths and formatting** (`Range`, log-space combination, `shareRange`/`formatShare`, range-end sig figs, unit picking, `num`, no-wrap ranges) → `RANGE`. Pure and tested, and it's the heart of "every number has a range". Any usage-to-impact estimator (energy, carbon, water, cost) reuses it unchanged. Effort S–M; the only work is lifting `chain()` into a parameter.
2. **Sourced-parameter schema, `withOverrides` and method versioning** (`params.ts`, `params.json` shape, METHODOLOGY skeleton) → `RANGE`. It's what makes an estimate credible. Split the generic `ParamSet` from the ccwatts sections and add a JSON Schema. Effort S.
3. **Showcase check kit** → studio-agents. It was written to be lifted and imports no ccwatts code, so every product with a demo page benefits. Effort S. Only open question: TS or `.mjs` upstream.
4. **Single-file offline page builder** (CSP hash, inlined font, safe JSON data island) → studio-agents template. It's the mechanism behind the no-network promise on any static demo or local report. Effort M.
5. **Privacy primitives for local logs** (`projectRef`, `safeName`, `errorLine`/`reason`, `countsOnlyLog`) → `LOGKIT`. Small, pure and security-relevant. Copying them is safer than rewriting them, and their tests must come along. Effort S.
6. **Range visuals** (log-scale range bar, bars with whiskers, ranked list with ranges, method/param table) → Building Blocks as neutral `RangeBar`, `RangeBars`, `RankedList`, `SourcedParamTable`. Nothing in Building Blocks shows uncertainty today, as far as this audit can tell. Effort M, because of the React port.
7. **Usage adapter, Claude Code adapter, dedupe, rollup history** → `LOGKIT`. The obvious base for a sibling "measure your Claude Code" tool (cost, time, carbon). Effort M, since the `outputContext` field needs splitting out.
8. **Release check** (`check-release.ts` + `studio-checks.json` `release`) → studio-agents. Its logic is already generic and config-driven, and every npm-published product needs it. Effort S.
9. **Site header (PR #130) and demo bar** → the portfolio owns one CSP-safe inline snippet, and demos copy it with a sync script. Today each demo rebuilds the look by hand. Effort M. Wait until PR #130 merges and Part B is decided.
10. **Tabs + hash router, theme picker, disclosure, segmented control** → Building Blocks. They're accessible and tested, but Building Blocks may already have equivalents. Check it before porting. Effort M.

Left out of the top 10 on purpose: Pace and the bedtime nudge (only a work-rhythm sibling needs them), the MCP server (copy the shape, not the code), and the share card (mostly product copy).

## Drift seen during the audit

These are for whoever owns each fix. None was fixed here.

- **No `docs/REUSE.md`.** The studio rule says each repo lists what it could share there. This file could become it after review. Owner: ccwatts (staff-pm to agree).
- **`docs/architecture/DATA.md` has no "Last checked against code" footer.** The pm-tools template requires one. Owner: ccwatts.
- **Theme tokens are hand-copied into `template.html`**, not generated from `docs/design/tokens.json`. The DS-0..DS-9 test guards it, but a design-system refresh means editing by hand. Owner: ccwatts, or Building Blocks once tokens are packaged.
- **TS ports of studio-agents tools** (`check-qa-report`, `check-logs`, `ux-rules`, `ux-shots`) can drift from the upstream `.mjs` files. `ux-rules.ts` still has a `node` shebang and cites `tools/ux-rules.mjs`. Owner: studio-agents (INTAKE: decide whether to host TS ports upstream).
- **Overlapping screenshot tools:** `tools/showcase-check/shots.ts` and `scripts/ux-shots.ts` do similar jobs. Pick one when extracting. Owner: studio-agents.
