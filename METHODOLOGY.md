# Methodology

**Method version 0.1.2** · parameters in [`methodology/params.json`](methodology/params.json) · last reviewed Nov 18, 2026

This page explains how ccwatts turns Claude Code token counts into an electricity estimate, and why the answer is always a range. The methodology and parameters are licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/): reuse them freely, with credit.

## The short version

1. ccwatts reads the token counts Claude Code already saves on your machine. It reads only counts, never your prompts or code.
2. Each token type (fresh input, cache write, cache read, output) gets an energy cost per token. The cost depends on the model family (Opus, Sonnet or Haiku).
3. Energy = tokens × energy per token, summed. Every parameter has a low and high bound, so the answer has one too.

Nobody outside Anthropic knows the real energy per token, and Anthropic doesn't publish it. So ccwatts builds the estimate from public measurements and published estimates, shows the uncertainty, and updates when better data appears.

## Boundary

The estimate uses the **comprehensive** boundary: the AI accelerators, plus host CPU and memory, idle capacity kept ready for load, and data-center overhead (cooling and power delivery, measured by PUE). This matches how Google reports its measured 0.24 Wh median Gemini prompt. Counting the accelerators alone would give roughly half as much (Google reports 0.10 Wh on that boundary).

It does **not** include training the model, manufacturing hardware, your own laptop, or the network. It covers electricity only, not carbon or water.

## What counts as usage

Each billed response in the Claude Code logs is counted once (deduped on message id and request id). Lines that can't be trusted are left out, not guessed at: a timestamp that isn't a date, a token count that isn't a whole number from 0 to 1 billion (1e9) for one response, and responses dated more than a day after the time you run it (a wrong clock or a corrupt line). The output says how many future-dated responses were left out. Details: `packages/core/README.md`.

## The model

```
energy (Wh) = Σ over token types:  tokens × output_wh_per_1k[tier] / 1000 × ratio[type]
```

| Token type | Energy per token |
|---|---|
| output | `output_wh_per_1k[tier]` / 1000 |
| fresh input | output × `input_vs_output` |
| cache write | output × `input_vs_output` × `cache_write_vs_input` |
| cache read | output × `input_vs_output` × `cache_read_vs_input` |

**Model tiers.** A model id containing "opus" uses the Opus tier, and the same goes for "sonnet" and "haiku". An id containing "fable" or "mythos" also uses the Opus tier. Those models sit above Opus in Anthropic's lineup and have no public size or energy figures, so Opus is the nearest tier and the largest one ccwatts has. Treat that as a floor, not a measurement. Anything else falls back to the Sonnet tier, and the output shows a warning.

### Why cache reads get their own parameter

In agentic sessions, most tokens are cache reads: context the model has already processed and reuses on the next turn. Zeke Hausfather found cache reads were about 96% of his tokens, and ccwatts' own M1.1 test log showed about 93%. Reading from the cache skips most of the work of processing those tokens again, so each one costs much less than fresh input. How much less is the least certain single number here: the cache-read factor has the widest bounds of any parameter (1% to 25%). ccwatts uses 10% of fresh input (Hausfather's central case and Anthropic's price ratio). On a heavy agentic day, though, the Opus output energy moves the total range more (about 37% of the log range versus about 24% for cache reads), because every token type scales with it. See [docs/EVALS.md](docs/EVALS.md).

## Parameters (v0.1.2)

| Parameter | Value | Low | High | Label | Source |
|---|---|---|---|---|---|
| Output, Opus tier (Wh per 1k tokens) | 1.2 | 0.4 | 3.0 | MODELED | [Hausfather](https://www.theclimatebrink.com/p/the-real-energy-use-of-agentic-ai) |
| Output, Sonnet tier (Wh per 1k tokens) | 0.6 | 0.25 | 1.5 | MODELED | [Google, 2025](https://arxiv.org/abs/2508.15734) |
| Output, Haiku tier (Wh per 1k tokens) | 0.25 | 0.08 | 0.6 | GUESS | [Anthropic pricing](https://www.anthropic.com/pricing) |
| Fresh input vs output | 0.3 | 0.15 | 0.5 | MODELED | [Anthropic pricing](https://www.anthropic.com/pricing) |
| Cache write vs input | 1.0 | 0.8 | 1.25 | MODELED | [Prompt caching docs](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching) |
| Cache read vs input | 0.1 | 0.01 | 0.25 | MODELED | [Hausfather](https://www.theclimatebrink.com/p/the-real-energy-use-of-agentic-ai) |

Each parameter's note in `params.json` explains its reasoning. **Labels:** DISCLOSED means the provider published it, MEASURED means someone measured it, MODELED means it's derived from measurements with stated assumptions, and GUESS means a reasoned placeholder waiting for better data.

## How the range is built

Each parameter's low and high are treated as a roughly 90% interval. Multiplying parameters with independent uncertainty widens the range, but not by as much as multiplying all the lows together, which would be wildly over-cautious. So spreads combine on a log scale as root-sum-of-squares:

```
high = central × exp( √Σ ln(highᵢ / valueᵢ)² )
low  = central ÷ exp( √Σ ln(valueᵢ / lowᵢ)² )
```

Across token types and models, ranges simply add up (lows with lows, highs with highs). That treats them as fully correlated, which is the cautious choice, since the same unknowns drive all of them.

### Ranges on shares and comparisons

Every share and comparison shown carries its own range, derived from the energy ranges above (method v0.1.2 onward; nothing new is estimated).

- **Shares** ("about 64% (30–72%) comes from re-reading the conversation") are worked out at three corners: the part's low over the total's low, central over central, and high over high. The low and high shown are the smallest and largest of those three ratios, not low/low and high/high in order, because a share can fall as the total rises: in the sample, cache writes are 48% of the low total but 21% of the high one. When all three round to the same whole percent, one number is shown; a share above zero that rounds to 0 reads "<1%". Token-count ratios ("cache reads were …% of tokens") are exact counts, so they carry no range and always say "of tokens".
- **Comparisons** ("driving an EV about 28 miles (4.4–102)") divide the energy's low, central and high by the comparison's factor from `params.json`. The factor itself is held at its central value, so the range reflects the energy estimate only, not the spread in EV efficiency or fridge size. The amount in JSON output stays the central value.

The playground's "What if?" slider lets you move `cache_read_vs_input` within its published low and high. The chosen value is pinned (its low and high both equal it), so the what-if range comes only from the other parameters' bounds. A what-if never changes the published estimate: the share card, LinkedIn post, CLI and params.json always use the values above.

## Estimating from a total

Some Claude usage leaves no local log: cloud threads, claude.ai chats, any app that only shows a token total. `ccwatts estimate 88.8M` and the playground's "Have a token count?" box take that total and give a range. They read no logs and save nothing.

A total hides the token-type mix, and the mix drives energy: an output token costs far more than a cache read. So ccwatts splits the total by a measured "typical Claude Code" mix, kept in the `token_mix` section of `params.json` (**MEASURED**, from counts-only copies of 6 Claude Code sessions, Oct to Nov 2026, 0.65M to 87.6M tokens each).

| Mix | Cache read | Cache write | Output | Input |
|---|---|---|---|---|
| Central | 95.5% | 4% | 0.4% | 0.1% |
| Light | 97.2% | 2.6% | 0.2% | 0% |
| Heavy | 88.8% | 10.6% | 0.5% | 0.1% |

Light and heavy are the lowest and highest shares we saw. The central value uses the central mix. The low end is the light mix's low, and the high end is the heavy mix's high. So the range covers both the usual parameter bounds and not knowing the mix, and it is wider than an estimate from logs. For 88.8M Opus tokens it is about 4.8 kWh (0.51 to 22.8).

If you know the split, pass it (`--output`, `--cache-read`, `--cache-write`, `--input`). Those counts are used as they are, the rest of the total counts as cache read, and the range is the normal one. A chat is not a Claude Code session, so its mix may differ. Treat a chat estimate as rougher still.

## Sanity checks

These run as unit tests (`packages/core/test/energy.test.ts`), so a parameter change that breaks them fails the build. The generated scorecard, [docs/EVALS.md](docs/EVALS.md), shows each check with its reference, which inputs were assumed, and which parameter drives the range.

| Check | Reference | ccwatts v0.1.2 |
|---|---|---|
| Typical chat query (1k input, 400 output, Sonnet) | [Microsoft Research](https://arxiv.org/abs/2509.20241) median frontier query 0.31 Wh (IQR 0.16–0.60) as its abstract read on Nov 18, 2026 (ccwatts recorded 0.34, IQR 0.18–0.67, on Oct 21); Google median Gemini prompt 0.24 Wh | **0.42 Wh** (0.16–1.1) |
| Heavy agentic day, about $17 of Opus API spend (20M cache reads, 1M cache writes, 0.1M input, 0.15M output) | [Simon Couch](https://simonpcouch.com/blog/2026-01-20-cc-impact/): a heavy day is about one dishwasher load or a fridge-day, roughly 1–2 kWh | **1.3 kWh** (0.2–4.5) |
| 8 weeks of heavy use at about 3 kWh/day, 96% cache reads (illustrative token mix; Hausfather's exact counts aren't published) | Hausfather: about 170 kWh (70–330) | **194 kWh** (32–678) |

**Why our range is wider than Hausfather's.** His 70–330 kWh comes from comparing several estimation methods. Ours combines the bounds of every parameter, including the 1%–25% spread on cache reads. That's deliberate: we'd rather show a range a skeptic can't easily push outside of. As better data comes out, the bounds tighten and the method version goes up.

## Pace (work rhythm)

Pace is not an energy number. It counts how long and when you worked, from the timestamps Claude Code already logs. It is covered by the method version, and its thresholds live in the `pace` section of `params.json`, apart from the energy parameters.

- **Blocks.** Log lines are sorted by time and split wherever the idle gap is longer than a threshold. The threshold is a **GUESS** (heuristic, not measured): 20 minutes, with 10 and 30 as the bounds. The 10-minute gap splits more often and gives the low active time; 30 gives the high. So active time is always a range.
- **Human turns, from structure only.** A block counts as your active time only if it holds at least one turn you typed. That is decided from the line's structure, never its text: a `user` line that is not `isMeta`, `isSidechain` or `isCompactSummary`, has no `toolUseResult` and no `tool_result` block, and, when the line has an `origin`, has `origin.kind` = `"human"`. Details: `packages/core/README.md`.
- **Agent time is shown separately.** A block with no human turn (an agent or subagent running on its own) is counted as agent time, not as your hours (Chase, Oct 31, 2026).
- **Local days.** Minutes are put on local days in the time zone you run it in. A block that crosses midnight is split at local midnight, and real elapsed time is used, so a 23- or 25-hour DST day comes out right.
- **Other counts** (central gap): late-night minutes (22:00 to 06:00 local), the longest stretch with no pause of 15 minutes or more (also a **GUESS**), and the first and last local hour you were active.

**Caveat: older logs over-count.** Logs written before Claude Code added `origin` don't say who wrote a line. There, any plain text or image `user` line counts as human, so some automated lines (a hook or command output written as plain text) can make an agent block look like your time. Active time from those logs may run high.

## How ccwatts compares

We read six other open-source Claude Code estimators on Nov 10, 2026. They split into two camps:

- **Output costs about the same as ours.** [tokentoll](https://github.com/codeandqa/tokentoll) and [claude-cost](https://github.com/tighe-ecc/claude-cost) use about 0.5–0.6 Wh per 1k Sonnet output tokens, with input at about 0.3–0.5× output. They lean on [Epoch AI](https://epoch.ai/gradient-updates/how-much-energy-does-chatgpt-use) and [Google, 2025](https://arxiv.org/abs/2508.15734).
- **Output costs about 5× more, input much less.** [claude-carbon](https://github.com/gwittebolle/claude-carbon) and [claude-code-carbon-dashboard](https://github.com/benjaminpope/claude-code-carbon-dashboard) use about 2.5–2.9 Wh per 1k Sonnet output, with input at about 0.05× output. They lean on [Jegham et al., "How Hungry is AI?"](https://arxiv.org/abs/2505.09598), which estimates Claude 3.7 Sonnet at 0.95 Wh for a 100-input, 300-output prompt. That paper infers hardware from API latency and throughput rather than measuring it.

All of them put cache reads at 0.08–0.1× input, inside our bounds.

The two camps cancel out on agentic use. For the heavy agentic day above (Opus, 20M cache reads), the four tools whose factors are published land at 0.85–1.6 kWh. ccwatts says 1.3 kWh (0.2–4.5). A unit test keeps every one of them inside our range.

**Where we differ:** for an output-heavy, chat-shaped Sonnet query (1k input, 400 output), the Jegham numbers give about 1.35 Wh. That's above our high of 1.1. Claude Code sessions are mostly cache reads, so this barely moves real totals. We don't simply raise the output bound, because these sources pair high output energy with low input energy. Widening each bound on its own would count that disagreement twice (see Open questions).

[EcoLogits](https://ecologits.ai) models energy per output token from the [ML.ENERGY](https://ml.energy/leaderboard) measurements of open models on H100s. For Anthropic it lists a PUE of 1.09–1.14 (AWS and Google). Our comprehensive boundary already includes PUE. For closed models, EcoLogits has to guess the parameter count (it assumes about 2T parameters for Claude 3 Opus), so we cite its method and PUE, not its per-token values.

## Versioning

- Any change to `params.json` bumps `version`, and every output prints the method version it used.
- History is stored as token counts, never as energy. So a new method version recalculates your whole history, and the output says which version it used.

## Open questions

- **Cache-read factor.** This needs an outside check, for example from Hausfather or the EcoLogits maintainers. It drives most of an agentic total.
- **Correlated parameters.** Sources that put output energy high put input energy low (see How ccwatts compares). The model treats `output_wh_per_1k` and `input_vs_output` as independent. Treating them as correlated would let the bounds cover both camps without widening agentic ranges.
- **Tier scaling.** Opus and Haiku are scaled from Sonnet using price gaps. If Anthropic discloses model sizes or energy, those labels move toward DISCLOSED.
- **Thinking tokens** are counted as output, which is how they're billed.
