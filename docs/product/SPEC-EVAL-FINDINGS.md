# SPEC: Eval findings at 390px (intake #112)

Owner: staff-pm. Status: todo. Before screenshots at 7b7f6c3: `/mnt/project-files/ccwatts-demo-2026-11-24/before/`.

## The bet
A phone-only LinkedIn reader or a skeptic (VISION problems 2 and 5) can use each tab at 390px without zooming
or scrolling away to find the number. Signal: each tab's answer sits in the first screen after the tab bar, in the
after screenshots, at 390px. Hard rules hold: every number has a range and the method version, no network, the
demo stays synthetic.

## Scope (this PR)
Template and app only (`packages/web/src/template.html`, `packages/web/src/app.ts`). Tests go in
`packages/web/test/` (page.test.ts, pace-web.test.ts). One small change per finding.

### EF-CC-1 (P1) What if? result beside the slider
Today `#whatif-note` stays hidden until the slider moves, and the 8.5 kWh total is about 1,500px higher.
- **EF-1** (auto) Given the Electricity tab loads, when nothing has moved, then a result line inside `#whatif`
  (directly after the slider scale, before "Why this assumption?") shows the total with "range" and
  "Method v" in it, and it is not `hidden`.
- **EF-2** (auto) Given the slider moves off the published value, when `input` fires, then that same line shows
  the what-if total and range and the published total and range, with no reload or button press.
- **EF-3** (auto) Given the slider is off the published value, then the line says it is a what-if and the share
  card keeps the published value (existing "The share card keeps 10%" wording), and the share card image
  is unchanged (rendered from `published`).
- **EF-4** (auto) The line is `role="status"` (or `aria-live="polite"`) so screen readers hear the update.

### EF-CC-4 (P1) Share card preview readable on a phone
The preview scales a 1200x627 card to ~340px, so card text is 5 to 7px. Least invasive fix: a readable
label outside the image; the image and saved files do not change.
- **EF-5** (auto) Given the Share tab, then a visible text element directly above or below `#card` says
  "Sample data" while the sample is shown (and is hidden for a user's own logs), at the body size (>= 17px,
  no `.vh`, no font-size under 17px in its rule).
- **EF-6** (auto) The PNG and SVG outputs are byte-identical to before for the sample (snapshot or hash of
  the generated SVG string from core is unchanged; no edits to `packages/core` receipt or card code).
- **EF-7** (manual) At 390px the label reads without zoom; "Open full size" still opens the card.

### EF-CC-5 (P1) Pace leads with one heading, one number, then the chart
- **EF-8** (auto) The Pace panel has one heading containing "Pace" and no eyebrow repeating it; the
  `#pace-pill` "Sample data" pill is gone (the demo bar already says Sample data).
- **EF-9** (auto) `#pace-lead` is one line: the latest full week's active hours with its range
  (e.g. "About 30 active hours last week (range 27 – 33)"). The late-night, longest-stretch, days-active,
  so-far and agent figures move below the chart.
- **EF-10** (auto) In document order, `#pace-lead` comes before `#pace-chart`, and `#pace-chart` comes before
  the detail lines (`#pace-sofar`, `#pace-agents`, the moved details).
- **EF-11** (auto) Every hour figure in the detail lines keeps a range or an explicit low–high; the panel or
  footer shows the method version. Opt-in, skipped and unreadable notes are unchanged.

### EF-CC-6 (P1) Method tab shows parameters and sources by default
- **EF-12** (auto) `#params-box` renders open (`<details open>`), or the table is no longer inside a
  `<details>`; the table lists each parameter's value, low, high and source.
- **EF-13** (auto) On a phone the table stays inside `.tablewrap` (scrolls itself; no horizontal page scroll).
- **EF-14** (manual) At 390px the first parameter row is visible within one screen of the tab bar.

### Dark mode elevation (P2, audit D-3): close, no work
Fixed by PR #110 (merge e59a03d, on main before 7b7f6c3). Evidence: DARK-1 to DARK-7 in
`packages/web/test/design-system.test.ts`, spec `docs/product/SPEC-DARK-ELEVATION.md`.
- **EF-15** (manual) Note the evidence on issue #112 and close that item.

## Out of scope
- EF-CC-2 and EF-CC-3: owned by the M4.8.1 hero+CTA PR (branch `claude/project-thread-g2k1g8`). Don't touch
  the hero, the demo bar or the CTA here; rebase on it if it merges first.
- Changing What-if copy about "least certain assumption" (open decision for Chase in HANDOFF).
- A phone-specific crop of the card: changes what people share; not now.
- Any core, params or method version change.

## Build notes
- Plugin bundle: affected. `scripts/build-plugin.ts` copies `packages/cli/dist/index.js`, which inlines the
  dashboard page (template + app) via tsup, so rebuild and commit `plugins/ccwatts/bin/` (CI checks it).
- After screenshots at 390px for all four tabs to `/mnt/project-files/ccwatts-demo-2026-11-24/after/`.
- Live playground change: merge waits for Chase's go.

## Handoffs
qa-tdd: EF-1..EF-13 red first. engineer: build to green. ux-reviewer: wording of the What-if line, the
sample label and the Pace headline at 390px. privacy-security: skipped (no data, vendor or network change).
