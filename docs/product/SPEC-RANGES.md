# SPEC: Ranges on every number + method link (CCW-M4.8.3, UX-R6 P1)

Owner: staff-pm. Status: todo. Source: CCW-DEC-17, PLAN M4.8, review `2026-11-22-demo-focus` (ux-report UX-R6,
AC-R6; pm-report item 4). Hard rule (CLAUDE.md): "Every number shown to a user has a range and the method version."

## The bet
The skeptical climate reader (pm-report section 2) sees that every estimate on the page is a range and is one tap
from how it was made. Signal: the audit test (RANGE-11) finds zero bare estimates; the 10-second test (pm-report)
still has 4 of 5 recalling the number and knowing it's a range. Stop: if ranges push the Overview CTA out of the
first viewport (FOCUS-1), cut words, not the range.

## Audit (sample data, method v0.1.2, built page + `ccwatts --demo`, on main)

| # | Where | Shown | Range from core? | Call |
|---|---|---|---|---|
| A1 | Overview "What drives it", Electricity lead + "Why this happens" | 64% re-reading | cacheRead.low/total.low = **30%**, central 64%, high **72%** | Show range. Not constant. |
| A2 | Overview `#ov-compare`, Electricity `#hero-compare`, CLI, share line, post, card, MCP text, manual estimate | ~28 EV miles, fridge ~5.7 days | total.low/high ÷ factor: EV **4.4–100** (ends at 2 significant figures, UX-R14), fridge **0.9–20** | Show range. |
| A3 | Electricity "Why this happens" | cache write 26%, output 10% | 48% / 22% at low end, 21% / 7% at high | Show range. |
| A4 | Electricity by-model / by-project rows | "3.2 kWh · 37%" | kWh range already on the row; shares move ≤4 pts (opus 61–65, portfolio 36–37) | Drop the %; bar + kWh range carry it. |
| A5 | CLI default "By model" / "By type" | 65% / 64% | as above | Show range per item. |
| A6 | Share card receipt rows | per-type kWh, model % | yes | Range per row; model share range. |
| A7 | LinkedIn post | 64%, comparisons; no method version | yes | Ranges + "method v". |
| A8 | Electricity daily chart tooltips | per-day per-type kWh | central only | Tooltip says "(central)"; chart caption already says it. |

**Exempt (exact counts or stated inputs, not estimates):** responses, tokens, dates, "cache reads were X% of
tokens" (a count ratio; must say "of tokens"), the manual estimate's "mix assumed" (an input, labeled assumed),
chart axis ticks, the what-if slider value (an input), Pace late-night time, longest stretch and rest days
(measured from timestamps; Pace hours already carry ranges). `--by` table and MCP JSON already carry ranges; MCP
JSON share bounds are backlog.

## Acceptance criteria
- **RANGE-1** (auto) Given a part and total `Range`, when core `shareRange` runs, then it returns min/max/central
  of part/total at low, central, high; demo cacheRead gives 30/64/72 (±1). Pure, no I/O.
- **RANGE-2** (auto) `formatShare` gives "64% (30–72%)"; if all three round equal it gives "7%"; above 0 but
  rounding to 0 gives "<1%".
- **RANGE-3** (auto) `comparisons`/`everyday` take the total `Range` and give "driving an EV about 28 miles
  (4.4–100)", ends rounded to 2 significant figures, at most 1 decimal (fix round, UX-R14; was the central's rule, "4.4–102"). Energy ranges use the same tight en dash: "1.3–30.5 kWh" (UX-R15). Phone ranges whose high end tops one charge read in charges ("about half a phone charge (0.1–1.5 charges)"), never a % above 100 (QA-R1).
- **RANGE-4** (auto) Overview: `#ov-drives-text` and `#ov-compare` contain a range; no new row added.
- **RANGE-5** (auto) Electricity: `#hero-compare`, `#explain`, `#explain-more` show every share and comparison with
  a range (token share exempt, says "of tokens").
- **RANGE-6** (auto) By-model/by-project rows contain no `%`; each keeps central kWh + "range".
- **RANGE-7** (auto) Overview and Electricity each have one link `href="#method"` beside the range, text
  "How we got this range", not inside another `<a>` (Overview's row is a link), target ≥48px; following it shows
  the Method heading below the sticky tabs (FOCUS-4).
- **RANGE-8** (auto) Card: each per-type row and model row shows a range; every slip line ≤36 chars; "method v"
  stays.
- **RANGE-9** (auto) Share line and post: comparison and cache share carry ranges; post includes "method v". Post
  says "The surprise:" only when the share's low ≥50%.
- **RANGE-10** (auto) CLI `--demo` and `estimate`: comparisons and shares carry ranges; no line over 80 cols;
  items that don't fit move behind a `--by <dim>` hint.
- **RANGE-11** (auto) Audit guard: in the built page (playground and dashboard mode, every tab, sample data) and
  CLI `--demo`, every `%` or comparison number has a range in the same element, except an allowlist of the exempt
  ids above.
- **RANGE-12** (auto) Tooltips on the daily chart include "(central)".
- **RANGE-13** (manual) ux-reviewer at 390×844 and 1280×800: FOCUS-1 still passes; no P0/P1 on clutter.
- **RANGE-14** (manual) METHODOLOGY.md says how share and comparison ranges are derived (corner ratios, comparison
  factors held fixed).

## Files likely touched
`packages/core/src/{format,energy,receipt,index}.ts`; `packages/web/src/{app.ts,template.html}`;
`packages/cli/src/{render,mcp}.ts`; tests in `packages/core/test`, `packages/web/test`, `packages/cli/test`;
`METHODOLOGY.md`; `HANDOFF.md`; PLAN M4.8 row. Size: 2 sessions.

## Not doing
MCP JSON share bounds; low/high for comparison factors in params.json (EPA gives 25–35 kWh/100 mi; backlog).

## Decision for Chase
"Most of the electricity comes from re-reading" is false at the low end (30% vs cache write 48%). Recommend
rewording to "About 64% (30–72%) comes from re-reading the conversation" and dropping "Most"/"The surprise" unless
the low end is ≥50%.
