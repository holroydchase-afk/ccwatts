# SPEC-CLOUDP: a prompt for Claude Code on the web

Owner: Chase (go Nov 23, 2026: "go with recommendations, build the prompt"). Scope by staff-pm, copy by ux-reviewer (UX-R20 to R27), Nov 20.

## Problem (VISION #1, #6)
People who use Claude Code on the web (claude.ai/code, project threads) have no local log folder to pick. `npx ccwatts` works inside a cloud session, but nobody tells them. The playground's only web option (Oct 23) asks Claude to hand-build JSON lines that the person pastes back: three hand-offs on a phone. It also tells Claude to read the raw logs, and nothing stops Claude from guessing a number when the command fails.

## Solution
A new disclosure in Your logs (`#drop`), summary **"Use Claude Code on the web? Ask it."**, with a prompt the person pastes into a cloud session. Claude runs ccwatts there and replies in the chat. The old export prompt stays as the desktop fallback, under a summary renamed to **"Can't find the folder?"**.

Recommendations Chase accepted: on phones the new disclosure comes first, above the folder pickers, and is open; on wide screens it is closed and sits below the pickers. The prompt pins `@latest` so npx can't run an old cached version.

### Intro (above the prompt)
Paste this into a Claude Code session at claude.ai/code. Claude runs ccwatts there and replies with that session's electricity, from token counts only. Each web session keeps only its own log. Plain claude.ai chats keep none; use the token count box instead.

### The prompt (byte-identical in the page and README)
```
Estimate the electricity this Claude Code session has used, with ccwatts.

1. Run: npx -y ccwatts@latest
2. Reply in three short lines: the energy range exactly as ccwatts shows it, the method version, and the one comparison it prints.
3. If I ask for a breakdown, run: npx -y ccwatts@latest --by day

Rules: ccwatts reads token counts only. Don't open, read, search or quote the log files or anything from our conversation yourself. Use only what ccwatts prints. If the command fails, tell me the error in one line. Don't guess a number.
```

### Under the Copy button
Claude says npm is blocked? Some sessions can't download tools. If your app shows a token total for the session, type it in the "Have a token count?" box on the Electricity tab. Otherwise, run the prompt on a computer with Claude Code.

("Have a token count?" is a link to `#electricity`. Plain spaces only, no U+00A0: CLOUDP-9, UX-R70.)

### Phone hint (replaces `#phone-hint`)
On a phone? Your logs live where Claude Code runs.

### README
Under the playground or CLI section: "Using Claude Code on the web? Paste this prompt into a session, and Claude runs `npx -y ccwatts@latest` there and replies with that session's range. It counts tokens only, and only that session." followed by the prompt in a code block.

## Acceptance criteria
- CLOUDP-1: `#drop` has a `<details id="cloud">` with summary "Use Claude Code on the web? Ask it.", the intro, the prompt in `#cloud-prompt`, a "Copy prompt" button (`#copy-cloud`, reads "Copied" for about 2 s after a tap) and the fallback line.
- CLOUDP-2: the prompt contains `npx -y ccwatts@latest`, "Reply in three short lines", "Don't open, read, search or quote" and "Don't guess a number"; it contains no `curl`, `http`, "upload", "message.usage" or "Read every .jsonl".
- CLOUDP-3: the prompt text in README.md and template.html is byte-identical.
- CLOUDP-4: the intro contains "only its own log" and "token count box".
- CLOUDP-5: at 390x844 `#cloud` comes before `#pick-folder` in visual order and is open; at 1280x800 it is closed and below the pickers. The old disclosure's summary reads "Can't find the folder?".
- CLOUDP-6: the prompt text is set in the reading font (not monospace) at 17px or more; no sideways scroll at 320px; light and dark.
- CLOUDP-7: no em-dash in any new string; check:browser stays green (no network, nothing stored).
- CLOUDP-8 (manual, Chase): paste the prompt into a fresh claude.ai/code session and into a plain claude.ai chat. The session replies in three lines with a range, a method version and a comparison, and quotes no conversation text; the chat does not invent a number.

## Not doing
- Replacing the export prompt (backlog: a `ccwatts export --counts` command).
- A prompt for plain chats (their number would be invented). The token count box covers chats that show a total.
