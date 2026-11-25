# SPEC-SITE-HEADER: the portfolio site header on the playground

Owner: Chase (intake #127, via the portfolio thread). Scope by staff-pm, Nov 25, 2026. Part A is asked for. Part B waits on Chase's yes (decision card out); drop the whole Part B section if he says no.

## Problem
The playground at chaseholroyd.com/ccwatts/ is the only portfolio demo without the site's own header, and its light page is Paper grey (#F7F7F4) where the site is white. A visitor coming from the portfolio lands somewhere that looks like a different site, and the way back is a small "← Portfolio" link in a strip of its own.

## Bet and signal
A visitor who comes from the portfolio knows they are still on Chase's site and can get back (or to the case study) in one tap, at any width, with no new network request. Signal: SITEHDR-11 (manual, Chase) on a phone and a laptop, with no help needed. Stop condition: if the header can't ship without loosening the CSP or making a request, stop and bring it back to Chase. Don't add `'self'` or an external file.

## Part A: the header (asked for)
Built into `template.html` and `app.ts` (option 1). No external script, stylesheet or font. The CSP stays exactly as it is.

Look copied from the portfolio's demo-bar.js/.css (the look, not the code):
- `<header id="site-bar">`, fixed to the top, 52px tall, z-index above the sticky tabs, flex, gap 8px, padding `0 max(16px, env(safe-area-inset-left))`, 1px bottom rule in the header's line colour.
- In order: link "← Chase Holroyd" (class `nm`, aria-label "Chase Holroyd, back to the portfolio"); `<nav aria-label="Site">` with "Building" and "Agents"; a flex spacer; the label "ccwatts demo"; link "Case study" (accent colour, bold). Below 560px, hide the nav and "Case study".
- Light: bg #fff, ink #14161A, muted #5B6068, line #E4E6E2, accent #0B7A4B. Dark: bg #131210, ink #F2F0EA, muted #A8A49A, line #2C2A26, accent #4CC38A.
- Font: 500 15px, the page's bundled "Atkinson Hyperlegible Next", system-ui. Links: min-height 44px, muted, no underline, ink on hover, 2px accent outline on focus-visible.
- Theme: follow the playground's own picker (`data-theme` light/dark, or the OS when System) in CSS, the same way the page tokens do. No separate storage key and no "dk" class set from JS.
- Links: absolute, built from the origin of `PORTFOLIO_URL` in `packages/core/src/meta.ts`: `/`, `/building.html` and `/agents.html` on that origin; "Case study" is `PORTFOLIO_URL` itself. They then work from a local copy of dist too.
- Playground only. The `ccwatts --html` dashboard has no header and no 52px offset. Render the header at build or first paint, not after a delay that shifts the page.
- Page background: in playground mode with the light theme, the page and the sticky tabs paint white (`--surface`, #FFFFFF). The `--bg` token stays #F7F7F4 (see "Design system"). Dark is unchanged.
- The sticky tabs sit right under the header (top 52px), and deep links (`#electricity`, `#pace`, `#share`, `#method`) don't land under it.

Part A without Part B: keep the `#demo-bar` strip under the header, minus its "← Portfolio" link (`#demo-home`). The header now carries the way back. The drawer's "← Chase Holroyd's portfolio" link stays.

## Part B: the strip becomes an info button and drawer (pending Chase)
- Remove the `#demo-bar` strip. Right of "ccwatts demo" in the header, add a 44px icon button (`#demo-toggle`, aria-label "About this demo", `aria-expanded`, `aria-controls` = the drawer id). It's always visible, including at 320px.
- The drawer is a dialog (`role="dialog"`, `aria-modal="true"`, labelled by its title) over a scrim. At 700px and wider it's a 360px panel on the right; under 700px it's a bottom sheet. It doesn't push the page down.
- Contents: a "Demo" pill, a title, the line the strip shows today (`#demo-copy-sample` / `#demo-copy-files`, still switched by app.ts when files load or "Use sample data" is tapped), and links: back to the portfolio (`#demo-back`), Code on GitHub (`#demo-code`, `REPO_URL`), and Case study.
- Closing: the close button, Esc, and a tap on the scrim all close it, and focus goes back to `#demo-toggle`. On open, focus moves into the drawer. Under reduced motion it doesn't slide.
- `#page-top` stays hidden in the playground, as today.

## Acceptance criteria
Part A:
- SITEHDR-1 (auto): Given the playground at 320, 390 and 1280px, then `#site-bar` is the first visible element, 52px tall, fixed at top 0, and holds in order "← Chase Holroyd" (aria-label as above), nav "Site", "ccwatts demo" and "Case study". At 320 and 390 the nav and "Case study" are hidden; at 1280 they're visible.
- SITEHDR-2 (auto): The hrefs are exactly `https://chaseholroyd.com/`, `…/building.html`, `…/agents.html` and `PORTFOLIO_URL`, and the code derives them from `PORTFOLIO_URL` (a static test fails if a second hard-coded origin appears in app.ts or template.html).
- SITEHDR-3 (auto): With the OS light and the picker on Light or System, the header's computed bg/ink/accent are #fff/#14161A/#0B7A4B. With Dark picked, or System with the OS dark, they're #131210/#F2F0EA/#4CC38A. It switches with no reload, and the page writes no localStorage key.
- SITEHDR-4 (auto): The header font is "Atkinson Hyperlegible Next" at 15px weight 500. Every header link is 44px or taller and shows a 2px outline on keyboard focus.
- SITEHDR-5 (auto): In playground light, body and `.tabs` compute to rgb(255,255,255). `var(--bg)` still resolves to #F7F7F4, and cards keep their 1px `--line` ring.
- SITEHDR-6 (auto): Scrolled down, the sticky tabs sit at 52px (not under the header). Opening `#pace` directly puts the panel's h2 fully below the header and tabs.
- SITEHDR-7 (auto): The built page has no horizontal scroll (`scrollWidth <= innerWidth`) at 320, 390 and 1280px, light and dark.
- SITEHDR-8 (auto): The dashboard built by `ccwatts --html` has no visible `#site-bar`, body padding-top is 0, and the light bg is still #F7F7F4.
- SITEHDR-9 (auto): check:browser is still green. The playground makes zero network requests with the header in place, and the CSP meta is byte-identical to before (no `'self'`, no new source).
- SITEHDR-10 (auto, Part A only): `#demo-home` is gone. `#demo-bar` sits right under the header, and `#demo-back` still goes to `PORTFOLIO_URL`.
- SITEHDR-11 (manual, Chase): Open the live page on a phone and a laptop next to chaseholroyd.com/building.html. The header matches the site's, the page is white, and both header links go where they say.

Part B (drop if Chase says no; it replaces SITEHDR-10):
- SITEHDR-12 (auto): `#demo-bar` is gone. `#demo-toggle` is in `#site-bar` right after "ccwatts demo", is 44x44 or larger, carries the aria-label "About this demo" and `aria-expanded="false"`, and its `aria-controls` names the dialog. It's visible at 320px.
- SITEHDR-13 (auto): A tap opens the dialog (`aria-expanded="true"`). At 1280px it's 360px wide on the right; at 390px it's a bottom sheet that fills the width. The scrim is visible, and the content behind it doesn't move.
- SITEHDR-14 (auto): The dialog shows the "Demo" pill, a title, the standard sample copy, and the links `#demo-back` (`PORTFOLIO_URL`), `#demo-code` (`REPO_URL`) and Case study. After a file loads, it shows `#demo-copy-files` instead, and "Use sample data" switches it back.
- SITEHDR-15 (auto): The close button, Esc and a scrim tap each close the dialog and return focus to `#demo-toggle`. On open, focus is inside the dialog.
- SITEHDR-16 (auto): With `prefers-reduced-motion: reduce`, the dialog shows and hides with no transition or animation (computed duration 0).

## Design system
- DS-1 and DS-9 pin the light `--bg` at #F7F7F4 (`HEARTH_PAPER.light.bg`, and the `tokens()` probe). Don't redefine `--bg` for the playground. Paint the playground's page and tabs with `--surface` (#FFFFFF), which is already a Paper token. Contrast only gets better on white, so DS-1 needs no change.
- The header follows the portfolio's design, not Paper: 44px targets, a bold link, and a green accent next to the page's terracotta. DS-0, DS-3 and DS-5 already exempt `#demo-bar` on the same grounds (a shared studio component). Add `#site-bar` and the Part B dialog to that exemption, with a comment pointing here.

## Existing tests to update
- `scripts/check-no-network.ts`: DEMO-BAR-1 (the bar is no longer first on the page) and DEMO-UX-R1 (aligns `#demo-home`). DEMO-BAR-2 and DEMO-BAR-11 ("← Portfolio" visible) move to the header link. DEMO-BAR-4 and DEMO-BAR-7 apply only if the strip stays. Under Part B, DEMO-BAR-1..13 retire in favour of SITEHDR-12..16. DEMO-BAR-6 (the open drawer pushes the page down) inverts.
- `packages/web/test/page.test.ts`: line 56 expects "← Portfolio"; line 336 checks the `--demo-*` vars (Part B removes them).
- `packages/web/test/focus.test.ts`: the `#demo-bar` exclusions (lines 99, 201, 287, 341) add `#site-bar`. Line 295 (ccwatts named in the bar) and line 382 (the dashboard hides the bar) cover the header too.
- `packages/web/test/ranges.test.ts:132`: add `#site-bar` (and the dialog) to the skip list.
- `packages/web/test/design-system.test.ts`: the `exempt` helper and the DS-3..DS-5 header comment.
- `scripts/check-live.ts`: check whether it asserts the old strip.

## Not doing
- Loading the portfolio's demo-bar.js/.css, or any `'self'` or external source in the CSP: it breaks the zero-request promise.
- A white background for the local dashboard: Chase asked about the public page only.
- Remembering the theme across visits: PS-R1 (no storage) stands.
- The same header on other studio demos: that's the portfolio thread's job.
- Changing Paper `--bg` upstream in hearth: the playground override is enough.
