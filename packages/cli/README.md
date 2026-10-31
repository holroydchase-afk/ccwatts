# ccwatts

See how much electricity your AI coding uses. ccwatts reads the logs Claude Code already keeps on your machine and turns token counts into an electricity estimate, always as a range with sourced assumptions.

```
npx ccwatts                # your last 30 days
npx ccwatts --by project   # also: model, day, type
npx ccwatts history        # weekly trend, survives log cleanup
npx ccwatts receipt        # share line and card
npx ccwatts dashboard      # offline HTML dashboard
npx ccwatts pace --demo    # work rhythm (opt-in): active hours, past 10pm, days off
npx ccwatts --method       # every parameter and its source
npx ccwatts --demo         # no Claude Code logs yet? try synthetic sample data
npx ccwatts help           # every command and option
```

Let Claude Code ask it directly, as a local MCP server on stdio (no port, no network):

```
claude mcp add ccwatts -- npx -y ccwatts mcp
```

Then ask "how much energy did my sessions use this week?". Tools: `energy_summary`, `energy_by_project`, `energy_weekly`, `methodology`.

- **Local only.** No network calls, no accounts, no telemetry. It reads token counts, never prompt or response text.
- **Pace is opt-in.** `ccwatts pace` keeps `~/.ccwatts/pace.jsonl` (daily minutes and whole hours only), created only when you run it. Delete it any time. It is never shared unless you pass `receipt --share-pace`.
- **Ranges, not false precision.** Every number shows a low–high range and the method version.
- **No runtime dependencies.** Everything, including the MCP SDK, is bundled. Node 20+.

Try it in your browser first, on sample data: https://chaseholroyd.com/ccwatts/

Methodology, source and screenshots: https://github.com/holroydchase-afk/ccwatts

MIT license. The methodology and parameters are CC BY 4.0.
