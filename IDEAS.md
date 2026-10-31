# Ideas, stories and experiences

A running log. Add to the top of each section. Every entry starts with the problem, then the idea. Nothing here is decided until it moves into `ANCHORS.md` or `PLAN.md`.

**Status:** 💡 idea · 🧪 proposed · ✅ adopted (link the decision) · ❌ dropped (say why)

---

## Ideas

### Leverage: your hours vs. your agents' hours · 💡 idea
- **Problem:** Other tools count tokens or dollars. Nobody shows how much machine work an hour of your attention buys, or what it costs the grid, so AI energy reads as guilt with no lever to pull.
- **Idea:** Under the weekly Pace line, add one more line, for example "You worked 11 to 14 hours. Your agents ran 31 to 40 hours and used 2.1 to 4.8 kWh. Method 0.1.0, gaps 10/20/30." It's a delegation ratio people want to improve and post.
- **Fits:** after M4.4, as M4.6 (about two PRs). Local counts only, ranges with method version, shared only with `--share-pace`.
- **Source:** staff-pm pitch for Chase, Oct 31, 2026.

### Pace: work-rhythm signals (`ccwatts pace`) · 🧪 proposed
- **Problem:** Heavy Claude Code users can lose track of how long and how late they work. The same local logs that give energy also show when work happened, and nobody turns that into a plain weekly picture.
- **Idea:** An opt-in `ccwatts pace` command. Group responses into work blocks (a gap over N minutes ends a block) and show active hours per day as a range, late-night share (10pm to 6am local), latest finish per day, longest stretch without a 15+ minute break, rest days in the last 7 and 28, weekend share, and this week against your own last 4 weeks. No population norms, scores or diagnosis.
- **Honesty:** Active time is low/central/high from gap thresholds of 10, 20 and 30 minutes, kept in `methodology/params.json` and labeled heuristic. Every pace number names its thresholds and the method version.
- **Privacy:** Local only, counts only, no network. History keeps daily pace aggregates only, never per-response times, and no timezone name. Off the receipt, share card and post unless `--share-pace` is passed. An MCP pace tool comes later, weekly summary only, after privacy-security.
- **Fits:** PLAN M4 (M4.1 to M4.5). Pure `packages/core/src/pace.ts` behind the adapter interface (ANCHORS P2). Not doing: health scores, interrupting notifications, a server, comparisons with others.
- **Decided so far:** Chase gave the go on Oct 31, 2026. Shipped name is "pace". The studio morning digest does not show finish times.
- **Source:** Intake #71 from Product Studio, Oct 30, 2026.

### Measure the token-type ratios ourselves ("ccwatts bench") · 💡 idea
- **Problem:** The cache-read and output factors come from other people's estimates, and they disagree. Skeptics will ask where the ratios come from.
- **Idea:** Rent an H100 for a few hours, run open models on vLLM, meter the GPU with NVML/Zeus, and publish measured input, output and cache-read ratios as METHODOLOGY v0.2.
- **Fits:** PLAN M3.1 (methodology hardening). Separate `bench/` folder; nothing in the CLI changes.
- **Open:** Chase to say whether "metric data" meant energy measurements like this or usage data.
- **Source:** Atlas intake of the original chat "Gathering own data plan", Oct 18, 2026.

### Keep output × context per message, before logs are pruned · ✅ adopted (ANCHORS D12)
- **Problem:** Output energy grows with how much context the model reads per token, but history only keeps daily totals. Claude Code deletes logs after about 30 days, so the detail is lost if we wait.
- **Idea:** Store one extra count per day: the sum of output tokens times context size. Don't show it yet; use it once the energy model can price it.
- **Decided:** Chase approved storing it, Oct 22, 2026 (ANCHORS D12).
- **Source:** Atlas intake of the original chat "Environmental impact tracking agent", Oct 18, 2026.

### Ask Hausfather or the EcoLogits maintainers for a sanity check · 💡 idea
- **Problem:** Three published figures can't all be true (Hausfather's hand estimate, Microsoft's per-query number, price-based ratios). An outside check is the strongest answer to skeptics.
- **Idea:** A short email with METHODOLOGY.md, our 8-week range next to Hausfather's, and one specific question about the cache-read factor.
- **Fits:** PLAN M3.1. Chase sends it; Claude can draft it.
- **Source:** Atlas intake, Oct 18, 2026; ANCHORS open questions.

### Carbon comparisons, opt-in · 💡 idea (later; v1 is kWh only, ANCHORS D13)
- **Problem:** kWh means little to most people. On the US grid, 1 kWh and one gas-car mile emit about the same CO2, which is an easy picture.
- **Idea:** An opt-in carbon line using a grid factor, kept off by default because PLAN D7 says kWh only for the MVP.
- **Decided:** kWh only for v1 (Chase, Oct 22, 2026; ANCHORS D13). Carbon stays a possible opt-in after v1.
- **Source:** Atlas intake, Oct 18, 2026.

### Admin API path for solo devs · 💡 idea
- **Problem:** People who use Claude outside Claude Code have no local logs to read.
- **Idea:** Test whether a solo developer can pull their own usage from the Anthropic Admin API. Post-MVP (PLAN D1, ANCHORS D9); the test was never run.
- **Source:** Atlas intake of the original chat "AI environmental impact tracker", Oct 16, 2026.

### Easy LinkedIn sharing · 💡 idea
- **Problem:** The launch depends on people posting their number, and a terminal screenshot doesn't look good in a feed.
- **Ideas:**
  - A receipt card sized for LinkedIn (1200×627), with the kWh range, a comparison line ("about X miles in an EV"), the method version and the repo link.
  - A "Wrapped"-style recap of your month or year: total, trend, top project, and what drives your number.
  - A share link that opens the playground with your totals in the part of the URL after `#`. Browsers never send that part to a server, so it stays private.
  - A ready-to-paste post: two or three plain-English lines, plus a hashtag and the link.
  - A "methodology" badge on the card, so skeptics can see the sources before they comment.
  - A link preview, so a pasted playground link shows a proper card in the feed instead of a bare URL. Done Oct 21 (`packages/web/src/og.svg`).
- **Status so far:** the receipt card, Save PNG and the ready-to-paste post shipped in M1.5 and M1.6. The post now links the playground first, since most LinkedIn readers won't open a repo.
- **Fits:** PLAN M1.5 (receipt) and M1.7 (playground). Only totals are shared, never logs.
- **Source:** Chase, Oct 20, 2026.

### Claude Code plugin: `/ccwatts`, status line, session-end summary · ✅ adopted (Chase, Oct 21; command named `/ccwatts`)
- **Problem:** Running a separate CLI is one more thing to remember. People see their usage where they work, inside Claude Code.
- **Idea:** A plugin that wraps the same local core: a `/watts` command for the report, a status line showing this session's kWh range, and a one-line summary when a session ends.
- **Why it fits:** It reads the same local data, so no server and no new privacy risk. A connector (MCP server) fits less well because it means running a service. *Update Oct 27:* a stdio MCP server doesn't: Claude Code starts it on demand over a pipe, with no port or listener. Built as `ccwatts mcp` (ANCHORS D14).
- **When:** Chase picked it as the next build on Oct 21, ahead of npm, because a plugin installs from this repo and doesn't need the final name on npm.
- **Status:** `/ccwatts` and the status line are built (`plugins/ccwatts`). The session-end summary is left out for now: plugin SessionEnd hooks get about 1.5 seconds and their output may not show to the user, so it needs a test on a real install first.
- **Source:** project chat, Oct 20, 2026.

### No servers, ever, for the core product · ✅ already decided (PLAN D3, ANCHORS C2 candidate)
- **Problem:** Devs and skeptics won't trust a tool that uploads logs full of their code.
- **Idea:** Local only. No network calls, no telemetry, counts only, open source so anyone can audit it. The playground parses files in the browser and a test proves no requests are made.
- **Source:** Chase, project chat, Oct 20, 2026: "developers and sceptics should have little room to complain and it should be as airtight as possible."

---

## Stories

New user stories as we find them. The MVP stories are in `ANCHORS.md` (Stories).

*(none yet)*

---

## Experiences

What actually happened when someone used it or when we built it: surprises, friction, quotes. These are the raw material for the case study.

### One night shift built M1.2 to M1.7 (old S2 to S7) · Oct 21, 2026
- **What happened:** An unattended run starting at 2:15am built M1.2 through M1.7 (old S2 to S7) plus the README as PRs #4 to #10, with 48 tests. Chase merged all of them the same day. Nothing is published or deployed.
- **So what:** Chase's hour a night now goes to review and decisions, not building.

### Building it cost about 186 Wh · Oct 17, 2026
- **What happened:** An early sandbox build (before the repo existed) ran the estimator on its own build sessions: about 186 Wh, range 80 to 550.
- **So what:** A ready-made hook for the launch post. The sandbox code was later replaced by the repo build.

### Cache reads dominate · Oct 19, 2026
- **What happened:** The M1.1 (S1) parser ran on a real Claude Code log. About 93% of tokens were cache reads, matching what Hausfather reported (96%).
- **So what:** The cache-read energy factor will swing the total more than anything else. M1.2 must give it its own wide range and explain it plainly.
