# ccwatts: Story & Anchors

**Owner:** Chase · **Started:** Oct 2026 · **Status:** pre-build · **Last updated:** Oct 20, 2026

This file explains why ccwatts exists, what it won't compromise on, and who it's for. `PLAN.md` explains how it gets built. When the two conflict, this file wins, and the conflict gets raised with Chase.

*"ccwatts" is the working name. See P1 below; the final name may change before S1.*

---

## Why ccwatts exists

AI usage has an electricity cost, and almost nobody using it can see theirs. Providers don't publish per-token energy. Public estimates vary by an order of magnitude. The people with the most AI usage, developers running agents all day, have no way to put a number on it.

Chase comes to this from climate and product. He has about 10 years of product management experience, including early roles in solar energy, co-founding startups, and early investment in LLM technology. ccwatts is a passion project for climate science and a public piece of product work, built in about an hour a night.

**The trigger.** In 2026, climate scientist Zeke Hausfather estimated his own Claude Code electricity use by hand: about 170 kWh over 8 weeks, with most tokens being cache reads. Nobody had packaged that into a tool. Meanwhile, tools like ccusage already parse Claude Code logs for tokens and cost. ccwatts combines the two: the same log data, with an energy model added.

**What it isn't (yet).** It isn't an enterprise carbon platform. Watershed published an open per-token AI emissions framework in July 2026 and is coming at the market from the top down. ccwatts starts as the individual developer's view. If it earns trust there, the bottom-up path to teams and companies is open (see Long-term direction).

**Money, honestly.** Zero now, possibly open-core later.
- **For the MVP, direct revenue is expected to be zero.** Individual developers rarely pay for this kind of tool. The near-term payoff is a credible public artifact at the intersection of climate and AI, plus a portfolio piece that shows product judgment.
- **If it's successful, the money is with companies, not individuals.** Sustainability teams that need to report AI-related emissions (CSRD, Scope 3, customer requests) have a budget and a deadline. The free tool is how ccwatts would earn the right to sell to them.
- **Don't close that door by accident.** Use a permissive license, keep the core cleanly separable from any surface, and keep the methodology public and versioned. Build nothing for companies before there's demand for it.

---

## Decisions made (Oct 16, 2026)

| # | Decision | Status |
|---|---|---|
| D1 | Start with a developer tool: an open-source CLI that reads Claude Code logs. Enterprise comes later, if ever. | Decided · revision proposed in P2/P3 |
| D2 | Estimates are shown as ranges, backed by a published methodology. | Decided |
| D3 | Dev-focused product, framed for a PM audience: devs adopt it, recruiters and LinkedIn readers understand it. | Decided |
| D4 | Build in Claude Code. Planning, writing and posts happen in claude.ai. | Decided |
| D5 | Public GitHub repo from day one. | Decided |
| D6 | TypeScript, with one shared core for the CLI and the web page. No Expo. | Decided |
| D7 | No mobile app for now. The web playground is mobile-responsive instead. Revisit only if v2 adds cloud-connected usage. | Decided |
| D8 | A static browser playground (no accounts, processed locally) is the "version folks can play with." | Decided |
| D9 | Not doing yet: account connections, other providers, enterprise dashboard, carbon/water. | Decided · revision proposed in P2 |
| D10 | Sequence: estimator → friend beta → share output + playground → case study → LinkedIn. No public post before the friend beta. | Decided |

## Proposed, not yet decided (Oct 18, 2026)

These came out of the Oct 18 naming and growth discussion. **None of them count until Chase decides.** Claude Code shouldn't act on them, except to avoid choices that would block them.

| # | Proposal | Notes | Status |
|---|---|---|---|
| P1 | **Final name.** Pick before S1, since the npm package, GitHub repo and domain must match. | Options so far: **ccwatts** (rides on ccusage, but "cc" ties it to Claude Code), **tokenwatts** (provider-neutral and self-describing, free on npm as of Oct 18), and **Wattson** (fun, but has conflicts with IBM Watson and the Apex Legends character; could be the voice on the receipt instead of the package name). Also free on npm as of Oct 18: agentwatts, promptwatts. | Open |
| P2 | **Claude Code first, not Claude Code only.** The long-term ambition is to cover many providers, Poe-style. Ship v0.1 with Claude Code only, but build the parser as per-provider adapters so adding Codex CLI or Gemini CLI is a single session. | Only agent CLIs that write local logs fit D3/C2. Grok, ChatGPT and claude.ai web usage would need account connections. Non-Anthropic models don't disclose their sizes, so ranges will be wider; METHODOLOGY must say so. | Open |
| P3 | **Open-core path if it takes off.** The CLI, methodology and parameters stay free and open forever. Possible later paid tier: a hosted team/org dashboard, org-level ingestion via provider admin/usage APIs, audit-ready reports (CSRD, GHG Protocol), SSO, retention. | Trigger: friend-beta or early users asking to run it across a team. Nothing gets built before that signal. | Open |
| P4 | **License: MIT** for the code, **CC BY 4.0** for METHODOLOGY.md and params.json. | MIT keeps adoption and acquirer diligence easy. CC BY means anyone reusing or citing the numbers credits the project. Avoid AGPL/source-available: they slow adoption. | **Decided Oct 20, 2026** |

---

## Anchors

Anchors are the few things every feature gets checked against. **Chase hasn't named any yet.** The candidates below are Claude's wording, drawn from the decisions above. Adopt, edit or cut them. Only adopted ones count.

| # | Candidate anchor | What it means | Adopted? |
|---|---|---|---|
| C1 | **Honest over precise** | Always a range, never a bare number. Every parameter has a source, a date and a confidence label. If we can't bound it, we say so. | — |
| C2 | **Your logs stay yours** | Nothing leaves the machine or the browser. No telemetry, no accounts, no content stored, only counts. Any future team or hosted feature must be opt-in and send counts only. | — |
| C3 | **Built for devs, legible to anyone** | The tool meets developer standards. Every output also has one line a non-developer understands. | — |
| C4 | ~~Fits in an hour~~ | Dropped by Chase, Oct 20: no limit on how much Claude builds per run. Work is still split into one PR per PLAN session. | Dropped |

---

## Long-term direction (if it works)

This isn't a plan, it's a map, so near-term choices don't block the long-term options.

| Horizon | Goal | What it looks like |
|---|---|---|
| **Short term** (now → launch) | Credibility and users | Everything in PLAN.md: CLI, history, dashboard/playground, methodology, friend beta, LinkedIn. |
| **Medium term** (if people use it) | Go from one developer to many tools and teams | Provider adapters (P2). Opt-in team rollups of anonymized daily counts. Org ingestion from provider usage APIs. |
| **Long term** (if companies ask) | Open core | Free CLI and methodology, paid hosted org product (P3). |

**Most likely payoffs, ranked by likelihood:** (1) the portfolio piece leads to a role, or an acqui-hire by a carbon platform or AI lab; (2) the methodology becomes the reference people cite, which sells advisory and enterprise work; (3) climate grants or sponsorship; (4) revenue from the paid org tier, which has the biggest upside and the hardest road.

**Tensions to manage deliberately:**
- **Trust vs. SaaS.** "Your logs stay yours" is the brand. A hosted product must never weaken it.
- **Time.** An hour a night builds a great CLI, not an enterprise product. The friend beta is the decision point.

---

## Stories

### Who it's for

| Who | Story | What it means for the build |
|---|---|---|
| **The heavy Claude Code user** | "I run agents all day. I'm curious, and a little guilty, about what that costs in electricity. I'll try anything that installs with one command and doesn't send my code anywhere." | `npx`, local only, results in under 2 seconds |
| **The skeptical climate person** | "Most AI energy numbers I see are wrong by 10x. Show me your assumptions or I'm not sharing this." | METHODOLOGY.md, sourced params, ranges |
| **The LinkedIn reader on a phone** | "I'll never install a CLI, but I'll tap a link to see what this is." | Playground with sample data, plain-English headline |
| **The hiring manager** | "I want to see how this person thinks: what they chose, what they cut, and why." | Case study, decision log (this file) |
| **Chase, as user zero** | "I want my own number, and I want it to be something I'd stand behind in public." | Dogfood first. His real numbers are the launch hook. |
| *Later: the sustainability lead* | *"I have to report our AI footprint and have no way to count it."* | *Not in MVP. The future buyer if P3 happens.* |

### User stories (MVP)

1. As a Claude Code user, I run one command and see my electricity use for the last 30 days as a range, so I get an answer without setup.
2. As a Claude Code user, I can see which models, projects and token types drive my number, so I understand what's behind it.
3. As a Claude Code user, I can see my history over time, even after Claude Code deletes old logs, so I can watch the trend.
4. As a Claude Code user, I can open a local dashboard of my data, so I can explore it visually.
5. As a skeptic, I can read every parameter with its source and confidence, so I can judge the estimate myself.
6. As someone sharing results, I get a one-line summary and an image I'm happy to post, so sharing takes seconds.
7. As a non-developer, I can open the playground on my phone with sample data and get the point in 10 seconds.
8. As anyone dropping in a log file, I'm told plainly that it never leaves my browser, and that's actually true.

---

## Open questions

- **Name (P1):** decide before S1, then claim the npm package, GitHub repo and domain together. Run a trademark check if the choice is Wattson.
- **Scope (P2):** adopt "Claude Code first," with adapters? If so, update D1/D9 and PLAN.md's core layout.
- Does the cache-read energy factor hold up? It may dominate agentic totals. Get an outside sanity check (Hausfather, EcoLogits maintainers).
- Should the share receipt lead with kWh or with a comparison ("≈ X miles")? Test both with the friend beta.
- What signal from the friend beta would justify team features? Define it before the beta, not after.
