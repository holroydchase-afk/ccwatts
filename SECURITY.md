# Security policy

## Supported versions

Only the latest version of `ccwatts` published on npm gets security fixes. Please upgrade before reporting (`npx -y ccwatts@latest --version`).

## Reporting a vulnerability

Please don't open a public issue. Use GitHub private vulnerability reporting instead:

1. Go to this repository's **Security** tab.
2. Click **Report a vulnerability**.
3. Describe the issue and how to reproduce it.

Only the maintainer sees the report. You'll get a reply in that thread, and a fix and advisory once it's confirmed.

## What counts

ccwatts promises to make no network calls, to keep counts only (never prompt or response content), and to store projects as a hash plus the folder's basename, never a full path. Anything that breaks one of those promises is a security issue, as is any usual vulnerability in the CLI, the MCP server, the plugin or the web playground.

When you report, include counts only. Never paste prompts, responses, full paths or tokens.
