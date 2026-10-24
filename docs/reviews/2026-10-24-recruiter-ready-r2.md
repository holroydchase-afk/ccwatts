# Recruiter-ready review, round 2: ccwatts (2026-10-24)

Night shift, Chase's steer: "Prioritize sharing with a recruiter readiness. Move past blockers." Bar unchanged from the [Oct 22 review](2026-10-22-recruiter-ready.md): a recruiter (phone, 90 seconds) or hiring manager (laptop, 5 minutes) opens ccwatts from chaseholroyd.com and it works, looks finished and tells one true story.

## How this was checked
- **Path walked:** portfolio page source (`holroydchase-afk.github.io` `ccwatts.html` on main, read from GitHub raw) → playground (local build of `packages/web`, the file Pages publishes) → GitHub README → npm README (`packages/cli/README.md`) → CLI first run (`npx ccwatts` with an empty HOME, `--demo`, `receipt`, `dashboard`).
- **Live site not loaded.** chaseholroyd.com can't be verified from this sandbox; every screenshot is of the local build.
- **Screens:** Playwright at 390×844 and 1280×800, light and dark, viewport and full page, playground and dashboard. No console errors, no requests, no sideways scroll.
- **QA:** `npm test` 3×, `npm run typecheck`, `npm run check:browser`.

## Verdict
**Ready, with one step for Chase.** The playground and README hold up. The weak spots are one-story gaps between surfaces now that the CLI is on npm: the portfolio still says "on npm once the name is final", the playground never mentions the CLI, and npm still serves 0.1.0 (no `--demo`, older no-logs message) while the repo is 0.1.1.

## Ranked list
| ID | P | Where | Problem | Fix | Test | Status |
|---|---|---|---|---|---|---|
| RR-20 | P2 | CLI summary, receipt, playground hero | Tiny totals read "charging a phone about 0.5 times"; exactly one reads "about 1 miles". | "about half a phone charge", "about 30% of a phone charge", "under 1% of a phone charge", "about once"; singular mile/day. | `energy.test.ts` | fixed |
| RR-21 | P2 | Dashboard vs playground | "8 kWh" on one surface, "8.5 kWh" on the other: a whole number drops its decimal, so totals look inconsistent side by side. | One decimal between 1 and 100 in every energy value ("8.0 kWh", "1.0 – 3.0"). | `receipt.test.ts`, `render.test.ts` | fixed |
| RR-22 | P1 | Playground | A hiring manager can't tell the tool is a real, installable CLI: the page never says `npx ccwatts`. | "Prefer the terminal? Run `npx ccwatts` with Node 20+…" in the try-it box (name from the constant). | `page.test.ts` | fixed |
| RR-23 | P1 | Portfolio ccwatts page (other repo) | Stack line says "a CLI, on npm once the name is final"; ccwatts has been on npm since Oct 23. | INTAKE below. | — | INTAKE |
| RR-24 | P1 | npm (published 0.1.0) | npmjs.com shows 0.1.0: no `--demo`, so a recruiter without Claude Code who runs `npx ccwatts` gets only "No Claude Code logs found". The playground footer and repo already say 0.1.1. | Chase runs the Publish workflow for 0.1.1 (token valid until about Oct 30). | — | Chase |

## INTAKE for Product Studio (portfolio repo)
```
INTAKE from ccwatts (night shift, 2026-10-24), for holroydchase-afk.github.io
1. P1 ccwatts.html "Stack" section: "a CLI, on npm once the name is final" is stale. ccwatts is on npm (0.1.0 since Oct 23). Replace with: "a CLI you can run with <code>npx ccwatts</code>". Optionally change the stage tag "Developer tool · playground live" to "Developer tool · on npm · playground live".
2. P2 The playground now says "Prefer the terminal? Run npx ccwatts" in its try-it box; if the portfolio quotes the playground, nothing else changes.
```
