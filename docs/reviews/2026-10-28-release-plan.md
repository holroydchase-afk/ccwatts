# Release plan CCW-M2.6: functional, high-quality demo (2026-10-28)

Chase's 7-phase release plan, run overnight. staff-pm scoped it; ux-reviewer took the before score. One PR per step, stacked.

**Goal:** a stranger gets from `npx ccwatts` or the playground to an honest number with no dead ends, and CI enforces every claim.

## Steps
| ID | Step | Done when |
|---|---|---|
| M2.6.1 | Plan (this file, PLAN.md, HANDOFF) | Plan posted and recorded |
| M2.6.2 | Works for real: F1–F8 below | Each gap has a failing test first, then a fix; suites green 3x |
| M2.6.3 | UI to 8/10: UX-R1–R13 below | ux-reviewer re-scores ≥8 for playground and CLI |
| M2.6.4 | Harden | qa-tdd bad-input suite; privacy-security no P0/P1 |
| M2.6.5 | Enhancements | Cache-read "what if" slider; plugin registers MCP (Chase's call) |
| M2.6.6 | Demo | Live playground loaded in a real browser, matches the CLI |
| M2.6.7 | Reusable blocks (pm-tools STACK.md) | CI on main + badge, Pages gated on CI, dependabot, privacy pre-commit check |

## Day-one gaps (staff-pm, all P2; no P0/P1 found)
- **F1** `--path /nope` says "No Claude Code logs found" and exits 0. Should say the folder doesn't exist, exit 1.
- **F2** A folder whose `.jsonl` files hold no usage is reported as "no logs". Should say files were found but had no usage.
- **F3** `--json` with no logs prints prose, exit 0. Should print JSON (`{"error":"no_logs"}`), no full paths.
- **F4** `ccwatts mcp` typed in a terminal waits silently on stdin; `ccwatts mcp --help` shows general help.
- **F5** "Recorded 1 days"; a single week is both lightest and heaviest; a one-day span prints "X to X"; "input 0%".
- **F6** `--method` ends with "Full write-up: METHODOLOGY.md", which npm users don't have. Link GitHub.
- **F7** `ccwatts help` is "Unknown command".
- **F8** Playground: a failed file read leaves the status on "Reading…".

## UX baseline (ux-reviewer, before): playground 6.5/10, CLI 6/10
- **UX-R1 (P1)** Errors only in `#drop-status`, below the fold, no `aria-live`; the whole hero is `aria-live`. Pill says "YOUR FILES" after a failed read.
- **UX-R2 (P1)** Error copy: "That text had no Claude Code usage in them." No next step; empty paste gives the same message.
- **UX-R3 (P1)** Window toggle hangs under the meta line; the "Try it" box splits the result from its chart.
- **UX-R4 (P1)** Monospace for whole paragraphs (chart caption, ranges, method descriptions, post textarea).
- **UX-R5 (P1)** Phone page is 6,251px: method cards and the post preview are always open.
- **UX-R6 (P1)** CLI has no bold/color in a TTY.
- **UX-R7 (P1)** `history` bars grow from the right; tables not indented like the summary; `--by project` header misaligned.
- **UX-R8 (P2)** "input 0%" (same as F5).
- **UX-R9 (P2)** Lightest week can be a partial week.
- **UX-R10 (P2)** Share-card preview text is ~4px on a phone.
- **UX-R11 (P2)** Footer says v0.1, CLI says 0.1.1.
- **UX-R12 (P2)** No-logs first run copy could lead with the next step.
- **UX-R13 (P2)** "Use Claude Code on the web…" `<summary>` is unstyled.

## Cut
0.1.2 publish (Chase, after Trusted Publishing #38); carbon (ANCHORS D13); other-CLI adapters (P2 proposal); `ccwatts bench` (M3.1); merges, deploys, secrets (never unattended).

## UX after M2.6.3 (ux-reviewer, same method): playground 8/10, CLI 8/10
Fixed: R1–R3, R5–R9, R11, R13; R4 mostly (mono kept for short data lines). Open: R10 (share card text ~5px on phones), R12 (no-logs copy). Measured contrast: `--danger` 5.96:1 light, 8.21:1 dark; muted 4.98:1 light.
New P2s, carried into M2.6.4:
- **UX-R14** single junk file: "Found 1 .jsonl file in bad.jsonl, but no … usage in them." → "bad.jsonl has no Claude Code usage."
- **UX-R15** no logs: plain run exits 0, `--json` exits 1. Pick one.
- **UX-R16** (finishes R12) lead the no-logs message with the next step, then a dim "Looked in:" list.
- **UX-R17** (finishes R10) share-card text ≥11px on phones (crop or "Open full size").
- **UX-R18** empty `#drop-status` leaves a gap: `:empty{display:none}`.
- **UX-R19** `history` draws a divider over the unlabeled bar column.
