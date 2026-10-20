# Vision

**Read this first, every session.** Every feature, idea and fix should point back to a problem on this page. If it doesn't, ask why we're building it.

*Owner: Chase. Started Oct 20, 2026. This page grows as we learn: edit it, don't fork it.*

## In one line

A free, open-source tool that shows developers how much electricity their AI coding uses, with numbers honest enough that a skeptic can't easily knock them down.

## The problems we're solving

| # | Problem | Our answer |
|---|---|---|
| 1 | Developers run AI agents all day and have no idea what it costs in electricity. | Read the logs Claude Code already writes and turn token counts into a kWh range. One command, no setup. |
| 2 | Public AI energy numbers disagree by 10x, so people don't trust any of them. | Always a range, never one number. Every parameter has a source, a date and a confidence label, all public. |
| 3 | AI logs contain private code and prompts, so devs won't hand them to a tool. | No servers, no accounts, no telemetry. Everything runs on your machine and reads counts only. The code is open so anyone can check. |
| 4 | Claude Code deletes old logs, so your history vanishes. | Keep our own daily rollups of counts, so the trend survives. |
| 5 | Non-developers (and LinkedIn readers) won't install a CLI. | A browser playground with sample data and a plain-English headline. |

## Principles (candidates, see ANCHORS.md C1–C4)

1. **Honest over precise.** A range we can defend beats a precise number we can't.
2. **Your logs stay yours.** If a feature needs a server, it isn't in this product.
3. **Built for devs, legible to anyone.** Every screen has one line a non-developer gets.

## Who it's for

The heavy Claude Code user, the skeptical climate person, the phone-only LinkedIn reader, the hiring manager, and Chase as user zero. Full stories are in `ANCHORS.md`.

## Where it's going

Claude Code first, not Claude Code only. CLI first, then history, a local dashboard, a playground, and a Claude Code plugin as another window onto the same local numbers. Teams and companies only if people ask. The map is in `ANCHORS.md` (Long-term direction); the build order is in `PLAN.md`.

## How we work

- **Problem first.** Write the problem before the solution. Log new ideas in `IDEAS.md`.
- **Decisions live in `ANCHORS.md`.** This page explains why; ANCHORS records what Chase decided.
- **Grow it.** When we learn something that changes a problem or an answer above, update this page in the same PR.
