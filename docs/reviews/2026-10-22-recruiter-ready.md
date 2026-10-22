# Recruiter-ready review: ccwatts (2026-10-22)

Sprint: Recruiter-Ready Sprint v2 (Chase approved 2026-10-22). Bar: a recruiter or hiring manager opens ccwatts from chaseholroyd.com and it works, looks finished and tells one clear, true story in under 2 minutes, on phone and laptop, with sample data and no login.

## How this was checked
- **Built locally** from `main` (87a2fcc): `npm ci && npm run build`. The playground (`packages/web/dist/ccwatts.html`) is the exact file the Pages workflow publishes.
- **Live site not loaded.** chaseholroyd.com is not on this environment's allowed hosts (proxy 403), so every screenshot is of the local build, and external links (parameter sources, chaseholroyd.com) are unverified. github.com/holroydchase-afk/ccwatts returned 200. `ccwatts` and `tokenwatts` are both unclaimed on npm (registry 404).
- **Screens:** Playwright (Chromium 1194) at 390×844 and 1280×800, light and dark, viewport and full page, in two states (sample data, and after loading `fixtures/claude-code/sample.jsonl`). 24 screenshots, all opened.
- **Personas:** (1) a developer who has never opened a terminal log folder (the product's least tech-savvy user), (2) a recruiter on a phone with 90 seconds, (3) a hiring manager on a laptop with 5 minutes.
- **QA:** `npm test` 3× (49/49 each, no flakes), `npm run typecheck` clean, `npm run check:browser` passed (no requests, no console errors, no sideways scroll), demo flows: load a good file, a bad `.jsonl`, a `.txt`, switch windows, reset to sample, reload. Keyboard Tab order recorded. Contrast computed from the CSS tokens.
- **One-story check:** the portfolio page (`holroydchase-afk.github.io` `tools/build.py`, main d527084), this README, `docs/images/*`, HANDOFF.md and pm-tools STUDIO-STATUS.md.

## Verdict
**Needs changes.** The page works, is private by construction and never empty. It fails the bar on three things: no way back to chaseholroyd.com, the first screen never says what ccwatts is to someone who doesn't know Claude Code, and the portfolio promises an `npx ccwatts` command that doesn't exist yet.
- Least tech-savvy developer: can use it with sample data; can't reach the file pickers by keyboard.
- Recruiter on a phone: sees "ccwatts" and a big number with no sentence saying what it is; chart labels are too small to read; no way back.
- Hiring manager on a laptop: strong method table and privacy story; the README never links the live playground, and the share card on sample data claims "Estimated on my laptop".

## Ranked list
Priority: P0 blocks showing it, P1 hurts the impression, P2 polish. Status is updated every fix round.

| ID | P | Where | Problem (evidence) | Fix | Acceptance criteria | Status |
|---|---|---|---|---|---|---|
| RR-1 | P0 | Playground, first screen | No link back to chaseholroyd.com anywhere on the page (Nielsen 3, user control). | Header link "← Chase Holroyd" to the portfolio's ccwatts page in playground mode; footer "Built by Chase Holroyd" in both modes. URL in one constant in `meta.ts`. | Link visible without scrolling at 390 and 1280; href is `https://chaseholroyd.com/ccwatts.html`; test in `page.test.ts`. | fixed (#23) |
| RR-2 | P0 | Portfolio ccwatts page (other repo) | Stack line says the CLI runs as `npx ccwatts`; the package isn't on npm (404), so a visitor who tries it gets an error. Contradicts README "Not on npm yet". | INTAKE to Product Studio (below). | Portfolio no longer shows `npx ccwatts` until the name is final and published. | INTAKE |
| RR-3 | P1 | Playground, first screen | No H1 and no sentence saying what this is; the eyebrow "Claude Code electricity" assumes you know Claude Code (Nielsen 2, match with the real world; WCAG 1.3.1/2.4.6, no H1). | H1 "How much electricity does your AI coding use?" plus a one-line lede naming Claude Code as an AI coding agent and saying the page starts on sample data. Wrap content in `<main>`. | Exactly one `<h1>`, one `<main>`; lede mentions "sample data" in playground mode; visible above the fold at 390×844. | fixed (#23) |
| RR-4 | P1 | Share card and LinkedIn post on sample data | On sample data the card says "Estimated on my laptop. No logs left it." and the post says "I measured…". A fake reads as a real measurement (showcase: honest demo). | `sample` flag in `ReceiptInput`: the card shows a "SAMPLE DATA" stamp and "Sample data, not a real measurement"; the post starts with "(Sample data)" and drops "my". | Core tests: sample card contains "SAMPLE DATA" and not "my laptop"; sample post starts with "(Sample data)". Real-data output unchanged. | fixed (#24) |
| RR-5 | P1 | "Try it on your own logs" | "Choose folder" and "Choose files" are `<label>`s for `hidden` inputs, so Tab skips them (recorded Tab order: windows, Use sample data, share buttons). WCAG 2.1.1. | Visually hide the inputs (still focusable) and show focus on the label. | Tab reaches both pickers; focus ring visible; `check:browser` asserts it. | fixed (#25) |
| RR-6 | P1 | "Sample data" pill, light mode | Amber text #c08a2e on #f4f2ea is 2.71:1 at 12px (WCAG 1.4.3 needs 4.5:1). It's the label that says the data is fake. | Darker amber for light mode text. | Pill text ≥ 4.5:1 in light and dark (dark is 8.84:1 already). | fixed (#25) |
| RR-7 | P1 | README | Top of the README never links the live playground; the hero screenshot shows `$ npx ccwatts` while "Try it" says it isn't on npm. A hiring manager arriving from GitHub can't find the demo. | Add "Try it in your browser" link to the playground in the first paragraph; caption says the screenshot is of sample data and `npx` works once it's on npm. | README's first 10 lines contain the playground URL; no unqualified `npx ccwatts` claim. | fixed (#28) |
| RR-8 | P1 | Chart, phone | Axis text is 11 units in a 720-wide viewBox, about 5.5px on a 390 screen: unreadable. | Draw the chart at the container's pixel width (min 320, max 720) and redraw on resize. | At 390×844 axis text renders ≥ 11px; no horizontal scroll. | fixed (#26) |
| RR-9 | P1 | All buttons | Buttons are 40px tall (measured), under the studio 44px bar. WCAG 2.5.8 passes (24px) but the studio rule doesn't. | `min-height:44px` on buttons and button-styled labels. | Every button ≥ 44px tall at 390 and 1280. | fixed (#25) |
| RR-10 | P2 | Method table | "source" link text is the same six times (WCAG 2.4.4 in context passes, but not unique words) and links are 17px tall. | Link text is the source's domain, padded to a 44px target. | Six distinct link texts; each ≥ 44px tall. | fixed (#27) |
| RR-11 | P2 | Method table, phone | Table forces a sideways scroll inside its box at 390; the Range column is cut off. | Stack each parameter as a card under 600px. | No inner horizontal scroll at 390; all columns readable. | fixed (#27) |
| RR-12 | P2 | Buttons | Button borders are 1.23:1 against the page (light) and 1.5:1 (dark); WCAG 1.4.11 asks 3:1 for control boundaries. | A separate `--control` border token at ≥ 3:1. | Button border ≥ 3:1 in both themes. | fixed (#25) |
| RR-13 | P2 | Pickers on a phone | "Choose folder" is the primary button on a phone, where no Claude Code logs live (iOS ignores folder picking). | On narrow screens, add "Your logs are on your computer, so open this page there." | Hint visible at 390, hidden at 1280. | fixed (#27) |
| RR-14 | P2 | README screenshots | `dashboard.png` shows a "Your history" pill on synthetic data. The caption under the first image covers it, but the image alone reads as real. | Re-shoot the dashboard screenshot with the new header and the sample label. | README images match the current page and say sample. | fixed (#28) |
| RR-15 | P2 | LinkedIn post, real data | Post opened "I measured…" though the tool estimates, and called an 11% cache share "The surprise". (Round 2, measured.) | "I estimated…"; "The surprise:" only when the cache share is 50% or more. | Core tests. | fixed (#29) |
| RR-16 | P1 | Lede after loading your own files | Pill said "Your files" but the lede still said "You're looking at sample data" (Nielsen 1, honest demo). (Round 2, measured.) | Lede set from the data source on every render. | `check:browser` asserts the lede after loading a file and after "Use sample data". | fixed (#29) |
| RR-17 | P2 | By model, haiku row; hero comparison | "range 88.5 – 2,155 Wh" next to kWh rows; hero said "About the same as driving an EV about 28 miles". (Round 2, seen.) | Unit picked from the high bound ("0.09 – 2.2 kWh"); hero reads "That's like driving an EV about 28 miles, or…". | Core test on `formatEnergy`. | fixed (#29) |
| RR-18 | P2 | Method table labels | MODELED and GUESS badges never explained; "GUESS" alone can read as weak (Nielsen 10). (Round 2, inferred; confirm with a real user.) | One sentence in the method intro explaining both. | Page test. | fixed (#29) |
| RR-19 | P1 | README `receipt-sample.png` | Synthetic card still said "Estimated on my laptop. No logs left it." with no sample label, between two sample screenshots. (Round 2, seen.) | Re-rendered from the playground's sample card by new `scripts/make-readme-images.mjs`, which refuses to write a card without "SAMPLE DATA". | Script check; image re-shot. | fixed (#29) |
| QA-1 | P2 | Tests | No automated check for keyboard reach, the back link or sample labeling. | Add with RR-1, RR-4, RR-5. | Tests exist and fail before the fix. | fixed (#23–#29) |
| QA-2 | P2 | CI | `check:browser` (the only real-browser test) runs by hand, not in CI. | Decision for Chase (needs Playwright in CI). | Logged under Decisions to review. | decision |

Not findings: zero network requests, zero console errors, no sideways page scroll at 390, bad inputs get clear messages ("Those files had no Claude Code usage in them.", "No .jsonl files found there…"), reload returns to sample data (nothing is stored, which is right for privacy). No TODO, placeholder, lorem or "coming soon" text in the page, README or docs.

## One-story check
| Claim | Portfolio | README | Playground | HANDOFF / STUDIO-STATUS |
|---|---|---|---|---|
| Stage | "Developer tool · playground live" | "v0.1, pre-release" | v0.1.0 | v1 merged, playground live |
| How to run the CLI | `npx ccwatts` (**wrong**, RR-2) | from a clone; screenshot shows `npx` (RR-7) | n/a | not on npm until the name is final |
| Hausfather anchor | 170 kWh over eight weeks | same | n/a | same |
| Privacy | logs never leave your machine | same | same | same |
| Demo data | n/a | synthetic, labeled | labeled "Sample data" (contrast, RR-6); share card not (RR-4) | synthetic |

## INTAKE for Product Studio (portfolio repo)
```
INTAKE from ccwatts (Recruiter-Ready Sprint v2, 2026-10-22), for holroydchase-afk.github.io
1. P0 ccwatts.html "Stack" section: replace "the CLI (<code>npx ccwatts</code>)" with "a CLI" (or "a CLI, on npm once the name is final"). npx ccwatts returns a 404 today; the README says it isn't on npm yet.
2. P1 ccwatts.html links: keep "Try the playground" first. The playground now links back to https://chaseholroyd.com/ccwatts.html (ccwatts PR for RR-1), so please keep that URL stable.
3. P2 When WEB-M4.7 adds the 390px ccwatts screenshot, shoot it after the ccwatts fix PRs merge (new H1 and back link), so the picture matches the live page.
```

## Rounds
- **Round 0 (review), 03:30–04:00Z:** 14 UX + 2 QA findings, 1 P0 in this repo, 1 P0 for the portfolio.
- **Round 1 (fixes), 03:30–03:42Z:** RR-1, RR-3 to RR-14 and QA-1 fixed in stacked draft PRs #23 to #28, each with a failing test first. Suites 3× green after the round (59/59; `check:browser` 3× pass).
- **Round 2 (re-review), 03:42–03:55Z:** a fresh ux-reviewer pass (showcase mode, 390/1280/320 px, light and dark, loaded state) confirmed every round-1 fix and found 5 new items (RR-15 to RR-19: 2 P1, 3 P2), all fixed in #29.
- **Round 3 (re-review), 03:47–03:52Z:** ux-reviewer confirmed RR-15 to RR-19 and every earlier fix (no console errors or requests, no sideways scroll at 320/390/1280, no button under 44px, pickers reachable by Tab). **Nothing new at P2 or above: verdict Ready.** Suites 3× green (62/62). One sub-P2 note kept for later: the share post reads "roughly driving an EV about 28 miles · running a fridge…".

## Left
- RR-2 (P0, portfolio repo): INTAKE above, for Product Studio.
- QA-2 (decision): run `check:browser` in CI (needs Playwright in CI).
- The live site (chaseholroyd.com) was never loaded from this environment; after merge, open https://chaseholroyd.com/ccwatts/ once on a phone to confirm.
