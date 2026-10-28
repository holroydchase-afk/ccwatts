---
description: Set up the ccwatts status line, which shows the current Claude Code session's estimated electricity after every response. Use only when the user runs /ccwatts:statusline or asks for it.
allowed-tools: Bash(node ~/.ccwatts/bin/ccwatts.js statusline), Bash(echo '{}' | node ~/.ccwatts/bin/ccwatts.js statusline), Bash(mkdir -p ~/.ccwatts/bin), Bash(cp "${CLAUDE_PLUGIN_ROOT}/bin/ccwatts.js" ~/.ccwatts/bin/ccwatts.js), Read, Edit, Write
disable-model-invocation: true
---

Set up a status line that shows this session's energy estimate, for example:
`⚡ ~9.1 Wh this session (range 2.3 – 27.5) · method v0.1.0`

Plugins can't set a status line themselves, so this edits the user's own settings. Steps:

1. Copy the CLI to a stable place, because the plugin folder changes when the plugin updates:
   `mkdir -p ~/.ccwatts/bin && cp "${CLAUDE_PLUGIN_ROOT}/bin/ccwatts.js" ~/.ccwatts/bin/ccwatts.js`
2. Check it works: `echo '{}' | node ~/.ccwatts/bin/ccwatts.js statusline` should print a line starting with ⚡.
3. Read `~/.claude/settings.json` (it may not exist yet).
   - If it already has a `statusLine`, show the user what it is and ask before replacing it. Don't merge the two.
   - Otherwise, set: `"statusLine": { "type": "command", "command": "node ~/.ccwatts/bin/ccwatts.js statusline" }` and keep every other setting as it was.
4. Tell the user it appears after the next response, that it reads only the current session's token counts, and that running `/ccwatts:statusline` again after a plugin update refreshes the copy. To remove it, delete the `statusLine` entry.
