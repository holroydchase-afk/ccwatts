# Changelog

All notable changes to the `ccwatts` CLI on npm are recorded here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Dates are the day the version went live on npm. The energy method has its own version (`methodology/params.json`, `ccwatts --method`), shown next to every number.

## [Unreleased]

### Added
- `ccwatts estimate`: estimate the energy of a token count you type in, no logs needed.
- Every number the CLI prints (shares, comparisons, the receipt card and post) carries its range, with a link to how the range was worked out.
- `--by` tables print a note when a model id isn't in the price table.

### Changed
- Method v0.1.2: Fable and Mythos model ids are priced at the Opus tier (they were priced as Sonnet). No parameter values changed.

### Fixed
- Windows drive roots are named `(root)`, like `/`.

## [0.2.0] - 2026-11-16

### Added
- `ccwatts pace`: a weekly line and a 4-week table, with `--json`, `--csv` and `--share-pace`. Pace history is opt-in and kept in its own `pace.jsonl`.
- `ccwatts nudge`: an opt-in late-night status line, in a serious or a funny persona (`nudge --preview` shows a sample).
- `ccwatts mcp`: a local stdio MCP server, so Claude Code can ask for the same numbers as tools.

### Changed
- Node 22 is the minimum (Node 20 is past end of life).
- `--json`, the MCP tools and the dashboard file no longer include the project path hash.
- CLI errors are plain one-line messages, with no raw errors or paths.

### Fixed
- Pace `--demo` no longer depends on the day of the week.

## [0.1.1] - 2026-10-26

### Added
- `--demo` runs on a synthetic sample with no logs needed, labeled "Sample data (synthetic)"; `receipt` and `dashboard` refuse it.
- `-v` / `--version`.

### Fixed
- `--path` no longer mixes the file it reads into your saved history.
- Unknown options and missing values get plain messages.
- The no-logs message offers `--demo` and the playground.

## [0.1.0] - 2026-10-23

### Added
- First npm release: reads local Claude Code logs and estimates the electricity used, always as a range with the method version.
- Summary with `--since`, `--by`, `--json` and `--method`.
- Local history that survives Claude Code's log cleanup.
- `receipt`: share text, LinkedIn post text and a 1200x627 card.
- `dashboard`: an offline, single-file HTML dashboard.

[Unreleased]: https://github.com/holroydchase-afk/ccwatts/commits/main
[0.2.0]: https://www.npmjs.com/package/ccwatts/v/0.2.0
[0.1.1]: https://www.npmjs.com/package/ccwatts/v/0.1.1
[0.1.0]: https://www.npmjs.com/package/ccwatts/v/0.1.0
