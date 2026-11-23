# Spec: dark-mode elevation by tone, not shadow (intake #108)

One PR, one session. Token values only in `packages/web/src/template.html`. Polish Freeze: allowed (a small item that directly supports UI polish). Light mode does not change.

## Problem
The intake measured the live page at 390px in dark mode. Text contrast passes (0 failures in 34 elements), but cards sit at about 1.08:1 against the page (`--surface #1C1A17` on `--bg #131210`, computed 1.078:1), so they barely separate. Shadows don't show on dark. Reference DARK-5 (Material 3 tonal surfaces: page tone 6, containers tone 10 to 22): elevation should come from a lighter surface. The intake calls its own measurement "crude; confirm by eye", so the screenshots below are part of done.

## What changes (dark only)
Starting values the engineer may tune. The tests check ratios, not exact hex.

| Token | Now | Proposed | Why |
|---|---|---|---|
| `--surface` | `#1C1A17` | `#24221E` | 1.18:1 on bg (target is 1.15 or more) |
| `--fill` | `#24221E` | `#33302B` | Would equal the new surface otherwise. Gives 1.21:1 on surface and keeps muted (5.83) and accent (5.68) on fill |
| `--line` | `#2E2B27` | `#383530` | Row dividers in `.list` would drop to 1.13:1 on the new surface. Decorative, so no 3:1 rule |
| `--tab-line` | `#696661` | `#77736D` | DS-1 needs tab-line on surface at 3:1 or more. The old value drops to 2.78 on the new surface; the new one gives 3.37 |

Both dark blocks change together: `@media (prefers-color-scheme:dark){:root:not([data-theme="light"])}` and `:root[data-theme="dark"]`. The high-contrast dark blocks keep `--line #807D78`, which gives 3.87:1 on the new surface.

**QA-R1 (P1), resolved.** High-contrast dark inherits the new `--fill #33302B`, so its old `--muted #B2ACA2` dropped to 5.83:1 on fill (HC needs 7). Both high-contrast dark blocks now set `--muted #C6C0B6` (same hue, lighter): 8.78:1 on surface `#24221E`, 7.27:1 on fill `#33302B`, 10.36:1 on bg. HC dark keeps the new fill, so DARK-2's fill-differs-from-surface rule still holds there. No test pins the HC muted value; DARK-3 checks the ratio.

## Acceptance criteria
Tests go in `packages/web/test/design-system.test.ts`, next to DS-1. They reuse its CSS reader (`themeFor`, `SCENES`, `contrast`) on `dist/ccwatts.html` and `src/template.html`. No browser is needed for DARK-1 to DARK-7.

| ID | Given / When / Then | Type |
|---|---|---|
| DARK-1 | Given the built page in the `dark` scene, when `--surface` and `--bg` are resolved, then contrast(surface, bg) is 1.15 or more | auto |
| DARK-2 | Given the `dark` and `high contrast dark` scenes, when `--fill` is resolved, then it is not equal to `--surface` and contrast(fill, surface) is 1.1 or more. (Buttons and the `.seg` track use fill on surface, and the pressed segment uses surface on fill) | auto |
| DARK-3 | Given the `dark` and `high contrast dark` scenes, then `--ink` on `--surface` is 7 or more, `--muted` on `--surface` and on `--fill` is 4.5 or more (7 in high contrast), `--accent` on `--surface` and on `--fill` is 4.5 or more, and `--tab-line` on `--surface` and on `--bg` is 3 or more | auto |
| DARK-4 | Given `template.html`, when the 10 DS-1 tokens are read from the prefers-color-scheme dark block and from the `:root[data-theme="dark"]` block, then the two sets are identical. The same holds for scene `dark` and scene `{scheme: light, theme: dark}` | auto |
| DARK-5 | Given the `light` and `high contrast light` scenes, then every token equals its value before this PR. The existing DS-1 light check stays green and unedited | auto |
| DARK-6 | Given the `<style>` in `template.html`, when every `box-shadow` value is parsed, then none has a blur radius above 0. Rings (`0 0 0 1px`) and insets with zero blur are allowed, and elevation comes from tone alone | auto |
| DARK-7 | Existing DS-1 dark checks pass with `PAPER.dark` updated to the new values and a comment naming #108 and the source (see Decision 1) | auto |
| DARK-8 | Given the built page at 390px and 1280px, in light and dark, when screenshots are taken before and after, then in dark the cards, lists and `.sharetext` read as one step lighter than the page by eye, and the light shots match before and after. Attach all 8 to the PR | manual |

Success: DARK-1 to DARK-7 are green 3x, and the 8 screenshots are in the PR. The signal is the intake's script rerun on the live page after deploy, which should report surface vs bg at 1.15 or more with 0 text failures.
Stop: if the eye check at 390px still shows no step at 1.18:1, try one more step (surface `#282622`, about 1.24:1; muted stays 6.7). If that fails too, stop and ask Chase. Don't add borders or shadows.

## Not doing
- Light mode, layout, radii, or new elevation levels. The Polish Freeze applies, and one surface tone is enough.
- Removing the 1px rings on `.card` and `.thumb`. Those are image outlines, not elevation, and DARK-6 allows them.
- Re-tuning accent, data colours, or `--accent-soft`. They still pass on the new tones.

## Risk
DS-1 pins dark tokens to hearth `tokens.json` `themes.paper` exactly, so this PR forks ccwatts from the studio design system. DARK-7 handles it on our side. The real fix lives upstream (Decision 1).

## Decisions for Chase
1. Where the new tones live. Recommendation: ship in ccwatts now with `PAPER.dark` updated and commented, and open a hearth intake to adopt the same four values in `tokens.json`, since every Paper-dark app has the same 1.08:1 problem. The alternative is to wait for hearth, which blocks a one-session fix on another repo.
2. Whether the change goes live. Merging changes the Pages playground, so it waits for your go.

## Handoffs
- qa-tdd: write DARK-1 to DARK-7 red against the current template. Done when DARK-1, DARK-2 and DARK-3 fail on the current values and the others pass or are pinned.
- engineer: change the four tokens in both dark blocks and update `PAPER.dark`. Done when all suites are green 3x.
- ux-reviewer: review the DARK-8 screenshots. Done when there's no P0 or P1.
- story-keeper: log Decision 1 in `docs/product/DECISIONS.md` once Chase makes the call.
