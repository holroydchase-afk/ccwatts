# Pace spike (M4.1, intake #71): human turns and the default gap

Spike only, nothing ships. Two questions for M4.2 core:

- **Q1.** Can `type: "user"` lines be split into human prompts vs machine lines (tool results, meta/caveat lines, task notifications, compact summaries, subagent lines) **by structure alone**?
- **Q2.** Which idle gap should end an active block by default (brief proposes 10 / 20 / 30 min as low / central / high)?

## Method (structure only)

Throwaway scripts read each JSONL line and looked only at: `type`, top-level keys and flags (`isMeta`, `isSidechain`, `isCompactSummary`, `toolUseResult` present, `userType`, `origin.kind`), whether `message.content` is a string or an array, and each array block's `type`. They printed counts of signatures, never a text value, path or id. For Q2, only `user` and `assistant` lines with a valid timestamp count (bookkeeping lines like `queue-operation` and `attachment` are ignored); a block ends when the gap to the next line exceeds the threshold, and active minutes are the sum of block spans. `scripts/pace-spike.ts` does both and prints counts only (`npx tsx scripts/pace-spike.ts ~/.claude/projects`).

## Data

- **A. One cloud session (this container), Claude Code 2.1.x**, with its subagent logs: ~150 timed lines, about 60 `user` lines. Caveat: the human types in a chat app that relays prompts in, so this is not a terminal session, and it has only **one** human turn.
- **B. Chase's counts-only log**, one evening (Oct 22): 208 `assistant` lines, no `user` lines.

## Q1 results: `user` line signatures (data A)

| Count | content | flags / markers | What it is |
|---|---|---|---|
| 34 | array `[tool_result]` | `toolUseResult` present | tool result, main thread |
| 19 | array `[tool_result]` | `isSidechain` | tool result inside a subagent |
| 7 | string | `isMeta` (4 also `isSidechain`) | injected meta lines |
| 2 | string | `isSidechain` | the prompt a subagent gets from its parent |
| 4 | string | `origin.kind = task-notification` | machine wake (task finished, relay) |
| 1 | string | `origin.kind = human` | **the human prompt** |

`userType` was `external` on every line, so it does not tell humans from machines. The adapter today (`packages/core/src/adapters/claude-code.ts`) returns null for anything but `type: "assistant"`, so every `user` line is currently dropped.

## Q1 findings

1. **Yes, by structure, with a newer-version caveat.** Tool results are always an array containing `tool_result` blocks, and the main-thread ones also carry `toolUseResult`. `isMeta` and `isSidechain` cleanly remove meta and subagent lines.
2. **The hard case is a string prompt that a machine wrote.** Task notifications look exactly like a human prompt (string content, no flags); only the newer `origin.kind` field (plus `promptSource` / `turnOrigin`) sets them apart. Older logs without `origin` would count them as human.
3. **Not seen here, still to check on a terminal log:** slash-command lines (`/clear`, local command output and caveats), `isCompactSummary` lines and image pastes. In older versions some of these are plain string lines whose only marker is a tag at the start of the text, and checking that means reading content, which we don't do.

## Q2 results: blocks per gap threshold

| Gap (min) | A blocks | A active min | A longest | B blocks | B active min | B longest |
|---|---|---|---|---|---|---|
| 5 | 2 | 6.9 | 4.2 | 5 | 24.1 | 10.0 |
| 10 | 2 | 6.9 | 4.2 | 3 | 39.4 | 21.3 |
| 15 / 20 / 30 / 45 | 2 | 6.9 | 4.2 | 3 | 39.4 | 21.3 |

Gaps over 4 min: A has one (153 min); B has 5.8, 9.5, 173 and 250. With human-anchored lines (data A only; B has no `user` lines) the result is the same: one block begins with a task notification and the other with the human prompt. An earlier "split only at a human turn" variant wrongly merged the whole 159 min into one block, because a machine wake can end a long idle gap.

## Recommendation for M4.2 (core)

- **Human turn** = `type: "user"`, not `isMeta`, not `isSidechain`, not `isCompactSummary`, no `toolUseResult`, no `tool_result` block; and when `origin` is present, `origin.kind === "human"`. Without `origin`, string content or `text` / `image` blocks count as human, and the method notes say that older logs can over-count. Read structure only, never text.
- **Blocks:** split on any gap over the threshold, whatever line follows it (human or machine), and only then label each block by whether it holds a human turn. Use human turns to describe the blocks, not to decide where they split.
- **Default gap:** keep **10 / 20 / 30** (low / central / high) as proposed. On the data we have, every threshold from 10 to 45 gives the same blocks, so 20 is not contradicted, but it is not supported by evidence yet either. Only 5 min breaks up real work (B's 5.8 and 9.5 min pauses), so the low end should not go below 10.

## Open items

- **Missing data:** a multi-day local terminal log from Chase's Mac (M2.1). It is needed to see real idle-gap spread between 10 and 45 min, slash-command and compact lines, and older lines with no `origin`. Rerun `scripts/pace-spike.ts` on it and paste only the printed counts.
- Which Claude Code version first wrote `origin` / `promptSource` / `turnOrigin`, and whether terminal sessions set them (here `entrypoint` was a remote one).
- Product decision for Chase: should blocks that hold only machine wakes (scheduled runs, notifications) count as "pace" at all?

## Privacy-security ruling (Oct 31)

No P0/P1 on the spike. PS-R1 (an fs error could print a path) and PS-R2 (print only known block and origin values, else `other`) are fixed in `scripts/pace-spike.ts`. PS-R3: the script is not in the published package (`packages/cli` ships `dist` only). Constraints M4.2 to M4.4 must carry:

- Human turns come from structure only (flags, `origin.kind`, content and block types), never a text prefix, tag, regex or length. When structure can't decide, count it as not human and say so in METHODOLOGY. A test with text that looks like a command or tag proves the result doesn't change.
- Fixtures are synthetic: no real prompts or real timestamps.
- `pace.ts` takes the timezone as a parameter and never reads the clock or `Intl` itself.
- History (M4.3) may store first and last active hour only as whole local hours (0 to 23) per local date, using the same block rule. No minutes, offsets or zone names. PACE-3's test also checks that nothing finer than an hour is written. Export and delete cover the new fields.
- Pace never writes per-response times anywhere (history, cache, debug logs). It stays off receipt, card, post, MCP and the morning digest unless `--share-pace`, and MCP and digest need another privacy review first. A shared latest finish is a coarse bucket only ("after midnight on 2 nights").
