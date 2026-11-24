# Contributing to ccwatts

Thanks for helping. ccwatts reads Claude Code logs that are already on your machine and estimates the electricity that use consumed, always as a range with sourced assumptions.

## Set up

You need Node.js (see `engines` in `package.json`).

```
npm install
npm test
```

`npm install` also turns on a pre-commit hook (`.githooks/pre-commit`) that refuses a commit containing a home path, an email address, a token or key, or a `.env` file. `npm test` and CI run the same check.

## Rules every change follows

These are not style preferences; a PR that breaks one will not be merged.

- **No network.** No network calls, telemetry or analytics anywhere in the CLI or the web page.
- **Counts only.** Never write prompt or response content to any file, output, fixture or test snapshot.
- **No full paths.** Projects are stored as a hash plus the folder's basename.
- **Every number has a range and the method version.**
- **Sourced parameters.** Every value in `methodology/params.json` has a value, low, high, label, source and as_of date.
- **Pure core.** `packages/core` takes data and returns data. All I/O lives in `packages/cli` or `packages/web`.
- **New runtime dependency?** Say in one line in the PR why it is needed.

## Making a change

1. Open an issue first for anything larger than a small fix, so we can agree on scope.
2. Write a failing test, then the change that makes it pass.
3. Keep one change per PR, and run `npm test` before you push.
4. Open the PR with the [pull request template](.github/PULL_REQUEST_TEMPLATE.md) filled in.

Changes to the energy model also update [METHODOLOGY.md](METHODOLOGY.md) and `methodology/params.json`.

## Reporting bugs and security issues

- Bugs and ideas: open an issue with the bug or feature template. Paste counts only, never prompts, responses or full paths.
- Security issues: see [SECURITY.md](SECURITY.md). Please don't open a public issue.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Code is MIT licensed; METHODOLOGY.md and params.json are CC BY 4.0 (see [LICENSE](LICENSE) and the README).
