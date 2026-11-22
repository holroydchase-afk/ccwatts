# Eval scorecard

**Method version 0.1.2. Overall: pass.** 8 of 8 model ids resolve to the expected tier. 7 of 7 reference comparisons pass, across 4 cases.

This file is built by `npm run evals` from `evals/models.json`, `evals/cases.json` and `methodology/params.json`. Do not edit it by hand. A test fails if it is out of date.

## Model coverage

Each model id ccwatts expects to see must match a tier by name. An id that matches nothing is priced at the fallback tier and fails here.

| Model id | Tier | Result |
| --- | --- | --- |
| `claude-opus-4-6` | opus | pass |
| `claude-sonnet-4-6` | sonnet | pass |
| `claude-haiku-4-5` | haiku | pass |
| `claude-opus-5-5` | opus | pass |
| `claude-sonnet-5-5` | sonnet | pass |
| `claude-haiku-5-5` | haiku | pass |
| `claude-fable-5-2` | opus | pass |
| `claude-mythos-5-2` | opus | pass |

## Reference checks

Each row compares a ccwatts estimate with one outside figure. "Token inputs" says whether the reference published its token counts or ccwatts assumed the mix. The ratio is the ccwatts central divided by the reference central.

| Case | Token inputs | Reference | Reference value | ccwatts central (low to high) | Ratio | Gate | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Typical chat query (1k input, 400 output, Sonnet) (`chat-query`) | assumed | [Microsoft Research: median frontier-model query, 0.31 Wh (IQR 0.16 to 0.60)](https://arxiv.org/abs/2509.20241) | 0.31 Wh (0.16 to 0.6) | 0.42 Wh (0.16 to 1.1) | 1.35x | ccwatts central inside the reference range | pass |
| Heavy agentic day, about $17 of Opus API spend (20M cache reads) (`heavy-agentic-day`) | assumed | [Simon Couch: a heavy day is about one dishwasher load or a fridge-day, roughly 1 to 2 kWh](https://simonpcouch.com/blog/2026-01-20-cc-impact/) | 1 to 2 kWh | 1.3 kWh (0.22 to 4.5) | no central published | ccwatts central inside the reference range | pass |
| 8 weeks of heavy use at about 3 kWh a day, 96% cache reads (`hausfather-8-weeks`) | assumed | [Hausfather: about 170 kWh (70 to 330) over 8 weeks](https://www.theclimatebrink.com/p/the-real-energy-use-of-agentic-ai) | 170 kWh (70 to 330) | 194 kWh (32 to 678) | 1.14x | ccwatts central inside the reference range | pass |
| The same heavy agentic day, priced with four other open-source estimators' Opus factors (`cross-tool-heavy-day`) | assumed | [claude-carbon](https://github.com/gwittebolle/claude-carbon) | 1.6 kWh | 1.3 kWh (0.22 to 4.5) | 0.81x | reference inside the ccwatts range | pass |
| The same heavy agentic day, priced with four other open-source estimators' Opus factors (`cross-tool-heavy-day`) | assumed | [claude-code-carbon-dashboard](https://github.com/benjaminpope/claude-code-carbon-dashboard) | 1.6 kWh | 1.3 kWh (0.22 to 4.5) | 0.81x | reference inside the ccwatts range | pass |
| The same heavy agentic day, priced with four other open-source estimators' Opus factors (`cross-tool-heavy-day`) | assumed | [tokentoll](https://github.com/codeandqa/tokentoll) | 1.4 kWh | 1.3 kWh (0.22 to 4.5) | 0.89x | reference inside the ccwatts range | pass |
| The same heavy agentic day, priced with four other open-source estimators' Opus factors (`cross-tool-heavy-day`) | assumed | [claude-cost](https://github.com/tighe-ecc/claude-cost) | 0.85 kWh | 1.3 kWh (0.22 to 4.5) | 1.52x | reference inside the ccwatts range | pass |

Token counts behind each case, per day:

- `chat-query` (sonnet tier, token mix assumed): 1,000 input, 0 cache write, 0 cache read, 400 output.
- `heavy-agentic-day` (opus tier, token mix assumed): 100,000 input, 1,000,000 cache write, 20,000,000 cache read, 150,000 output.
- `hausfather-8-weeks` (opus tier, token mix assumed): 300,000 input, 2,500,000 cache write, 55,000,000 cache read, 400,000 output, times 56 days.
- `cross-tool-heavy-day` (opus tier, token mix assumed): 100,000 input, 1,000,000 cache write, 20,000,000 cache read, 150,000 output.

## What drives the range

Computed on `heavy-agentic-day`. Range width is the high estimate divided by the low one. Each row pins one parameter at its central value and leaves the other bounds alone. Share is how much of the range goes away, on a log scale.

| Parameter | Range width now | Width if this were known exactly | Share of the range |
| --- | --- | --- | --- |
| `output_wh_per_1k.opus` | 20.7x | 6.69x | 37% |
| `cache_read_vs_input` | 20.7x | 10.1x | 24% |
| `input_vs_output` | 20.7x | 16.7x | 7% |
| `cache_write_vs_input` | 20.7x | 20.4x | under 1% |

The top driver is `output_wh_per_1k.opus`: knowing it exactly would remove 37% of the range. Shares do not add up to 100%, because the bounds combine as root-sum-of-squares.

## What this does not show

- There is no ground truth. No provider publishes energy per token, so nothing here measures accuracy.
- Every check uses a token mix ccwatts assumed. No reference published its token counts. These are consistency checks, not validation.
- The cross-tool check prices the same token mix with other tools' factors. It compares models like for like. It does not show that any of them is right.
- The model-coverage list holds the ids we know about. A new model id is not covered until someone adds it to `evals/models.json`.
- An outside review of the cache-read factor has not happened yet.

## How to rerun

```
npm run evals
```

That rewrites this file. `npx tsx scripts/run-evals.ts --check` writes nothing and exits 1 if this file is stale or any check fails. `npm test` runs the same comparison (`packages/core/test/evals.test.ts`).
