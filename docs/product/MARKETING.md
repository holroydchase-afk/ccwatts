# Marketing claims register

What we can truthfully say about ccwatts today, each with its proof. Owned by the `positioning` agent. Public copy (README, npm README, playground, portfolio, posts) uses only claims listed here; add a claim with its proof before using it.

| Claim | Proof | Checked |
|---|---|---|
| Estimates the electricity your Claude Code use consumed, from logs already on your machine. | `packages/core/src/adapters` parser; verified on a real cloud-session log (exact match vs an independent count, HANDOFF Oct 23) | 2026-10-23 |
| Always a range, never a single number; every parameter is sourced. | `methodology/params.json` (value, low, high, source, as_of); CLAUDE.md hard rule; tests | 2026-11-01 |
| Nothing leaves your machine: no servers, accounts or telemetry; counts only. | `scripts/check-no-network.ts`, `check-logs`, CSP `default-src 'none'`, `npm run check:browser` shows zero requests | 2026-10-28 |
| Try it in the browser with no install or sign-in, on labeled sample data. | Live page check M2.6.6 (`npm run check:live`): one request, sample data labeled | 2026-10-28 |
| `npx ccwatts` works. | ccwatts@0.1.1 on npm, `npx ccwatts@0.1.1 --demo` with an empty HOME | 2026-10-26 |
| History survives Claude Code's log cleanup. | `~/.ccwatts/history.jsonl` daily counts; history tests | 2026-10-21 |
| Sanity-checked against Google's 0.24 Wh prompt, Microsoft's 0.34 Wh query and Hausfather's 170 kWh. | unit tests in `packages/core` | 2026-10-21 |
| Claude Code plugin with `/ccwatts`, a status line and a local MCP server. | `plugins/ccwatts`, `claude plugin validate`, MCP tests | 2026-10-28 |

**Not claimable yet:** carbon or water figures (ANCHORS D13: kWh only); "measured" (it's an estimate; say "I estimated"); any user count or friend-beta result (the beta hasn't run); `npx ccwatts pace` or `npx -y ccwatts mcp` from npm until 0.1.2 is published.
