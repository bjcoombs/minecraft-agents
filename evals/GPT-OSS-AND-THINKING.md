# gpt-oss, and the middle setting for thinking that does exist

An earlier page in this repo concluded there was **no useful middle ground**
between no thinking and full thinking. That conclusion was wrong, and it was
wrong because of a harness bug rather than a measurement.

## gpt-oss scored 0% four times because of one flag

`gpt-oss:20b` returned 0% on every metric across four separate runs. It was
recorded as "unmeasured, needs its own parser". The actual cause:

**Sending `format: json` corrupts it.** gpt-oss already separates its channels —
reasoning goes to the `thinking` field, the answer to `response`. Adding the
JSON constraint makes it dump reasoning into `response` as prose:

```
format:json   response = 'We need to respond as Miner. We must output JSON with
                          keys ":", ",". The ":", "," must be correct. ...'
no format     thinking = 'We need to respond with JSON only. The situation:
                          creeper 3 blocks away...'
              response = '{"say":"Stop, creeper nearby","action":"stop"}'
```

The fix is one line: do not send `format: json` to this model family.

This is the **third** zero on this project that was a harness bug rather than a
model failure, after `qwen3:4b` (needed `think:false`) and `andy-4` (speaks
Mindcraft's `!command()` protocol). A zero is a claim about your harness until
you have proved otherwise.

## The thinking curve, 3 reps, 132 samples per row

| think | schema | apt | harm | latency | tok/s |
|---|---|---|---|---|---|
| `false` | 100% | 45%* | 48%* | 1.67s | 44.2 |
| `"low"` | **100%** | 45% | 48% | **1.67s** | 41.6 |
| `"medium"` | 84% | **58%** | **23%** | 8.06s | 39.8 |
| `"high"` | 16% | 14% | 2% | 15.65s | 39.3 |

\* single-run figures for `false` differed (50/25); the noise floor is ±9.

Baselines: random 7% apt / 47% harm. Constant `mine` 0% / 98%.

**`medium` is the best result measured anywhere on this project.** 58%
appropriateness and — more importantly — **23% harm, half the rate of every
other model tested** and less than half of random. Harm is the metric that
means "chose `mine` next to a primed creeper".

**`high` collapses.** 16% schema validity: it reasons past its token budget and
emits nothing parseable. Its 2% harm is an artefact of mostly returning nothing,
not of good judgement. More thinking is not monotonically better.

## So there IS a middle ground, with a real cost

The earlier "no middle ground" finding held for **qwen3-family** models, where
`format:json` and thinking genuinely do not compose at any level, and the
unconstrained form costs 3.5x latency to reach the same answer. That still
stands for those models.

It does **not** generalise. On gpt-oss the middle setting is the best setting,
and Ben's hypothesis — that there might be a useful balance rather than a binary
— was correct.

The cost is what makes it a judgement call rather than an obvious switch:

- **`medium` costs 8.06s per decision.** Six bots on a 12-second cycle sharing
  one Ollama instance have roughly 2s each if their calls serialise. `medium`
  does not fit without either a longer cycle or a second Ollama instance.
- **`medium` fails schema 16% of the time**, so it needs a retry-or-fallback
  path that the current `bot.js` does not have.
- **`low` fits the loop today** (1.67s, 100% schema) but scores the same as
  `false` — the thinking is free but buys nothing at that level.

## Where this leaves model selection

| model / setting | apt | harm | schema | latency | fits 12s loop? |
|---|---|---|---|---|---|
| gpt-oss:20b `medium` | **58%** | **23%** | 84% | 8.06s | no, and needs retry logic |
| qwen3.8:27b-q4_K_M | 52% | 40% | 100% | 2.45s | marginal |
| qwen3.8:27b-mlx | 47% | 50% | 100% | 2.01s | marginal |
| gpt-oss:20b `low` | 45% | 48% | 100% | 1.67s | yes |
| **mistral-nemo:12b** (running) | 39% | 48% | 100% | **0.43s** | yes, comfortably |

Nothing has been switched. The two candidates worth a live trial are
`gpt-oss:20b` at `low` (drop-in, same latency class) and `qwen3.8:27b-q4_K_M`
(best quality that still keeps 100% schema), and the deciding measurement is
throughput under six concurrent bots, which has not been run.
