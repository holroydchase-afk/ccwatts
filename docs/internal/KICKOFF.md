# Kickoff: how to start building

This file is for Chase. You can delete it once S1 is merged.

## One-time setup (10 min)

1. **Settle the name first** (ANCHORS P1). If it changes from ccwatts, rename this folder and replace "ccwatts" in the docs before the first commit.
2. Create a **public** GitHub repo with that name (ANCHORS D5).
3. Put this folder's contents in the repo, then commit and push:
   ```
   git init && git add . && git commit -m "Planning docs" 
   git branch -M main && git remote add origin <your repo URL> && git push -u origin main
   ```
4. Open the repo in Claude Code (`cd` into it and run `claude`). It reads `CLAUDE.md` automatically.

## Session 1 prompt (paste this into Claude Code)

> Read CLAUDE.md, ANCHORS.md and PLAN.md. We're doing session S1 from PLAN.md: scaffold + parse spike.
>
> 1. Set up the npm workspaces (packages/core, packages/cli, packages/web) with TypeScript strict, Vitest and tsup, per PLAN.md. Keep the name in one place so it's easy to rename.
> 2. Find my Claude Code logs (check `~/.claude/projects/` and anything else you can confirm), read the JSONL, and confirm which fields exist: usage token counts (input, output, cache creation, cache read), model, timestamp, cwd, and message/request IDs. Also confirm how log retention works (`cleanupPeriodDays`).
> 3. Put the parsing behind a small Claude Code adapter that returns normalized usage records (CLAUDE.md, P2).
> 4. Print total tokens by model and token type for my logs.
> 5. Document the field names and retention findings in packages/core/README.md.
>
> Never print or store prompt/response content, only counts. If the expected fields aren't there, stop and tell me what you found instead of guessing. Finish with a commit and a short summary, including any open questions.

## After each session

- Skim the summary and answer any open questions.
- Next session: "We're doing S<n> from PLAN.md." That's usually all the prompt you need.
- Bring decisions back to the claude.ai project so ANCHORS.md stays the source of truth.
