# Ideas, stories and experiences

A running log. Add to the top of each section. Every entry starts with the problem, then the idea. Nothing here is decided until it moves into `ANCHORS.md` or `PLAN.md`.

**Status:** 💡 idea · 🧪 proposed · ✅ adopted (link the decision) · ❌ dropped (say why)

---

## Ideas

### Easy LinkedIn sharing · 💡 idea
- **Problem:** The launch depends on people posting their number, and a terminal screenshot doesn't look good in a feed.
- **Ideas:**
  - A receipt card sized for LinkedIn (1200×627), with the kWh range, a comparison line ("about X miles in an EV"), the method version and the repo link.
  - A "Wrapped"-style recap of your month or year: total, trend, top project, and what drives your number.
  - A share link that opens the playground with your totals in the part of the URL after `#`. Browsers never send that part to a server, so it stays private.
  - A ready-to-paste post: two or three plain-English lines, plus a hashtag and the link.
  - A "methodology" badge on the card, so skeptics can see the sources before they comment.
- **Fits:** PLAN S5 (receipt) and S7 (playground). Only totals are shared, never logs.
- **Source:** Chase, Oct 20, 2026.

### Claude Code plugin: `/watts`, status line, session-end summary · 🧪 proposed
- **Problem:** Running a separate CLI is one more thing to remember. People see their usage where they work, inside Claude Code.
- **Idea:** A plugin that wraps the same local core: a `/watts` command for the report, a status line showing this session's kWh range, and a one-line summary when a session ends.
- **Why it fits:** It reads the same local data, so no server and no new privacy risk. A connector (MCP server) fits less well because it means running a service.
- **When:** After the CLI ships (around S8), as one small session. Chase liked the mockup (Oct 20).
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

### Cache reads dominate · Oct 19, 2026
- **What happened:** The S1 parser ran on a real Claude Code log. About 93% of tokens were cache reads, matching what Hausfather reported (96%).
- **So what:** The cache-read energy factor will swing the total more than anything else. S2 must give it its own wide range and explain it plainly.
