# Methodology

**Method version 0.1.0** · parameters in [`methodology/params.json`](methodology/params.json) · last reviewed Oct 21, 2026

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

**Model tiers.** A model id containing "opus" uses the Opus tier, and the same goes for "sonnet" and "haiku". Anything else falls back to the Sonnet tier, and the output shows a warning.

### Why cache reads get their own parameter

In agentic sessions, most tokens are cache reads: context the model has already processed and reuses on the next turn. Zeke Hausfather found cache reads were about 96% of his tokens, and ccwatts' own M1.1 test log showed about 93%. Reading from the cache skips most of the work of processing those tokens again, so each one costs much less than fresh input. How much less is the single biggest uncertainty in the whole estimate. ccwatts uses 10% of fresh input (Hausfather's central case and Anthropic's price ratio), bounded at 1% and 25%.

## Parameters (v0.1.0)

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

The comparison line ("about X miles in an EV") always uses the central value and says "about".

The playground's "What if?" slider lets you move `cache_read_vs_input` within its published low and high; it moves that parameter's low and high by the same ratio, so its spread is unchanged. A what-if never changes the published estimate: the share card, LinkedIn post, CLI and params.json always use the values above.

## Sanity checks

These run as unit tests (`packages/core/test/energy.test.ts`), so a parameter change that breaks them fails the build.

| Check | Reference | ccwatts v0.1.0 |
|---|---|---|
| Typical chat query (1k input, 400 output, Sonnet) | Microsoft Research median frontier query 0.34 Wh (IQR 0.18–0.67); Google median Gemini prompt 0.24 Wh | **0.42 Wh** (0.16–1.1) |
| Heavy agentic day, about $17 of Opus API spend (20M cache reads, 1M cache writes, 0.1M input, 0.15M output) | [Simon Couch](https://simonpcouch.com/blog/2026-01-20-cc-impact/): a heavy day is about one dishwasher load or a fridge-day, roughly 1–2 kWh | **1.3 kWh** (0.2–4.5) |
| 8 weeks of heavy use at about 3 kWh/day, 96% cache reads (illustrative token mix; Hausfather's exact counts aren't published) | Hausfather: about 170 kWh (70–330) | **194 kWh** (32–678) |

**Why our range is wider than Hausfather's.** His 70–330 kWh comes from comparing several estimation methods. Ours combines the bounds of every parameter, including the 1%–25% spread on cache reads. That's deliberate: we'd rather show a range a skeptic can't easily push outside of. As better data comes out, the bounds tighten and the method version goes up.

## Versioning

- Any change to `params.json` bumps `version`, and every output prints the method version it used.
- History is stored as token counts, never as energy. So a new method version recalculates your whole history, and the output says which version it used.

## Open questions

- **Cache-read factor.** This needs an outside check, for example from Hausfather or the EcoLogits maintainers. It drives most of an agentic total.
- **Tier scaling.** Opus and Haiku are scaled from Sonnet using price gaps. If Anthropic discloses model sizes or energy, those labels move toward DISCLOSED.
- **Thinking tokens** are counted as output, which is how they're billed.
