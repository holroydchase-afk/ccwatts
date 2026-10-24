---
description: Estimate the electricity this machine's Claude Code usage consumed, as a sourced kWh range. Use when the user runs /ccwatts or asks about the energy, electricity or footprint of their Claude Code use.
argument-hint: "[history | receipt | dashboard] [--since 7d] [--by model|day|project|type] [--method]"
allowed-tools: Bash(node *)
---

Run the bundled ccwatts CLI with the user's arguments and show them the result:

```
node "${CLAUDE_PLUGIN_ROOT}/bin/ccwatts.js" $ARGUMENTS
```

If no arguments were given, run it with none (a 30-day summary).

Rules:
- Show the CLI's output as it is, in a code block. Don't recompute, round or restate the numbers without their range, and keep the method version line.
- After the output, add at most two short sentences: the main driver of the number if the output names one, and one useful next command (`/ccwatts history`, `/ccwatts --by project`, `/ccwatts receipt` to share, `/ccwatts --method` for sources).
- The CLI reads token counts only. Never open or quote the user's log files yourself.
- If the CLI says no logs were found, say where it looked and that `--path <dir>` points it elsewhere.
- If `node` is missing, say that ccwatts needs Node.js 20 or newer.
