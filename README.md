# ccwatts

**Estimate the electricity your Claude Code usage consumes.** Always as a range, with every assumption sourced.

> Status: early build. It reads your logs and prints token totals today; electricity estimates come next.

```
npm install
npm start          # token totals by model from your local Claude Code logs
npm start -- --path <dir>
```

- **Local only.** Your logs never leave your machine. No network calls, no telemetry, counts only.
- **Honest numbers.** Low / central / high, with a public methodology (`METHODOLOGY.md`, coming in S2).

See `ANCHORS.md` for why this exists and `PLAN.md` for how it's being built.

## License

Code: MIT (`LICENSE`). Methodology and parameters (`METHODOLOGY.md`, `methodology/params.json`): [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), so reuse them freely with credit.
