---
description: Turn on the ccwatts bedtime nudge, a short late-night line under the ccwatts status line that suggests going to bed, in a serious or funny persona. Use only when the user runs /ccwatts:nudge or asks for it.
allowed-tools: Bash(node ~/.ccwatts/bin/ccwatts.js nudge --preview), Bash(node ~/.ccwatts/bin/ccwatts.js nudge on:*), Bash(node ~/.ccwatts/bin/ccwatts.js nudge off), Bash(mkdir -p ~/.ccwatts/bin), Bash(cp "${CLAUDE_PLUGIN_ROOT}/bin/ccwatts.js" ~/.ccwatts/bin/ccwatts.js)
disable-model-invocation: true
---

The bedtime nudge adds a second line under the ccwatts status line late at night, for example:
`🌙 Sweetheart, it's 1:14am. The computer will still be there in the morning.`

It's opt-in and local: one small settings file (`~/.ccwatts/nudge.json`), no notifications, no sounds, and it never blocks work. Steps:

1. Make sure the CLI copy exists (the status line uses the same one):
   `mkdir -p ~/.ccwatts/bin && cp "${CLAUDE_PLUGIN_ROOT}/bin/ccwatts.js" ~/.ccwatts/bin/ccwatts.js`
2. Show the personas: run `node ~/.ccwatts/bin/ccwatts.js nudge --preview` and show its output as it is, in a code block.
3. Ask the user which persona they want. Serious: `coach`, `researcher`, `stoic`. Funny: `grandma`, `narrator`, `pirate`, `haiku`, `sergeant`. Or `random` for a different one each hour. If they want a different start time, ask for the hour on the 24-hour clock (0 to 23, default 23 for 11pm).
4. Run `node ~/.ccwatts/bin/ccwatts.js nudge on --persona <id>`, adding `--after <hour>` if they gave one, and show the output.
5. The nudge appears in the status line, so it needs the ccwatts status line. If `~/.claude/settings.json` has no `statusLine` running `ccwatts.js statusline`, tell the user to run `/ccwatts:statusline` once.
6. Tell them it shows only between the start hour and 5am, and that `node ~/.ccwatts/bin/ccwatts.js nudge off` turns it off.
