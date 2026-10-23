# ccwatts

See how much electricity your AI coding uses. ccwatts reads the logs Claude Code already keeps on your machine and turns token counts into an electricity estimate, always as a range with sourced assumptions.

```
npx ccwatts                # your last 30 days
npx ccwatts --by project   # also: model, day, type
npx ccwatts history        # weekly trend, survives log cleanup
npx ccwatts receipt        # share line and card
npx ccwatts dashboard      # offline HTML dashboard
npx ccwatts --method       # every parameter and its source
```

- **Local only.** No network calls, no accounts, no telemetry. It reads token counts, never prompt or response text.
- **Ranges, not false precision.** Every number shows a low–high range and the method version.
- **No runtime dependencies.** Node 20+.

Try it in your browser first, on sample data: https://chaseholroyd.com/ccwatts/

Methodology, source and screenshots: https://github.com/holroydchase-afk/ccwatts

MIT license. The methodology and parameters are CC BY 4.0.
