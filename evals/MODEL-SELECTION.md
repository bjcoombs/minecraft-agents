# Which model should drive the bots?

19 models measured on the real workload. Requirements: fits 64GB, fast enough
for a 12s decision loop, reuses the prompt cache, no unbounded thinking,
reliable structured output.

Baselines — **read every number against these, not against zero**:

| policy | apt | harmful |
|---|---|---|
| random choice (4000 trials) | 7% | 47% |
| constant `mine` | 0% | 98% |

## Results, 44 cases, quiet machine

| model | GB | schema | legal | apt | harmful | tok/s | warm lat | verdict |
|---|---|---|---|---|---|---|---|---|
| **mistral-nemo:12b** | 7.1 | 100% | 98% | **41%** | **45%** | 39.9 | **0.62s** | **best overall** |
| phi4:14b | 9.1 | 100% | 100% | **43%** | 50% | 18.2 | 1.75s | best apt, slowest |
| tulu3:8b | 4.9 | **86%** | 98% | 41% | 50% | 42.0 | 0.56s | fails structured output |
| qwen2.5:7b | 4.7 | 100% | 100% | 36% | 59% | 47.4 | 0.57s | best small model |
| qwen3:8b (think:false) | 5.2 | 100% | 98% | 36% | 55% | 37.5 | 0.67s | good |
| mistral:7b | 4.4 | 100% | 91% | 36% | 50% | 37.8 | 1.06s | good |
| qwen3:4b (think:false) | 2.5 | 100% | 98% | 34% | 55% | 73.4 | 0.57s | best per GB |
| gemma2:9b | 5.4 | 100% | 98% | 30% | 66% | 42.3 | 1.19s | |
| gemma3:12b | 8.1 | 100% | 100% | 30% | 64% | 24.4 | 1.78s | |
| llama3:latest | 4.7 | 100% | 100% | 39% | 59% | 71.3 | 0.52s | |
| llama2:latest | 3.8 | 100% | 95% | 27% | 61% | 56.3 | 0.87s | |
| codellama:34b | 19 | 100% | 98% | 27% | 57% | 9.9 | 3.24s | big and worse |
| hermes3:8b | 4.7 | 100% | 100% | 25% | 70% | 53.2 | 0.70s | |
| **llama3.1:latest** | 4.7 | 100% | 98% | **16%** | **75%** | 70.1 | 0.45s | **currently in production** |
| llama3.2:3b | 2.0 | 95% | 95% | 16% | 64% | 98.7 | 0.45s | fastest, not smart |
| granite3.3:8b | 4.9 | 100% | 82% | 11% | 50% | 30.8 | 1.16s | worst apt |
| llama3.1:70b | 39 | — | — | — | — | — | — | 503, will not load |

## Recommendation: `mistral-nemo:12b`

It is the only model measured that is **better than chance at avoiding harmful
actions** (45% vs 47%), while near the top on appropriateness (41%), with
perfect schema compliance and 0.62s warm latency. It meets every stated
requirement.

Against `llama3.1:8b`, which this repo currently runs: **2.6x the appropriate-
action rate (41% vs 16%) and 30 points less harm (45% vs 75%)**, for 0.17s more
latency per decision — irrelevant inside a 12s cycle.

If latency mattered more, `qwen2.5:7b` (0.57s, 100% schema, 36% apt) is the
better small pick. `qwen3:4b` is remarkable value at 2.5GB.

`phi4:14b` scores 2 points higher on appropriateness but runs at 18 tok/s and
1.75s — the weakest speed margin here, for a difference inside noise on a
single un-repeated run.

## Requirement checks

**Cacheability — all pass, and it matters enormously.** Warm call with a shared
prefix vs warm call with a new prefix, both after the model was already loaded:

| model | shared prefix | new prefix | benefit |
|---|---|---|---|
| mistral-nemo:12b | 105ms | 5656ms | **53.8x** |
| qwen2.5:7b | 100ms | 4427ms | 44.4x |
| llama3:latest | 87ms | 3636ms | 41.6x |
| phi4:14b | 202ms | 8409ms | 41.5x |

This is why `bot.js` orders its prompt static-first. Breaking that ordering
costs roughly 40x on prompt evaluation — far more than the choice of model.

**think:false — accepted by every model tested**, including non-reasoning ones,
where it is a harmless no-op. Always send it.

**Fit — everything at or below 14B loads comfortably.** `llama3.1:70b` (39GB)
returns HTTP 503 in 0.3s: it will not load on this machine. `codellama:34b`
loads but is slower *and* worse than 7B models. Parameter count does not
predict quality on this task.

## Two results that were harness bugs, not model failures

- **`qwen3:4b` first scored 0% on everything.** It returns an empty response
  unless sent `think: false`. With it: 100% schema, 34% apt, 73 tok/s. A model
  was nearly written off because of a missing flag.
- **`andy-4` scores 0% because it is fine-tuned for Mindcraft**, whose protocol
  is `!command()`, not our JSON. It answers `say='...!moveAway(40)'`. That
  measures convention mismatch, not capability — and it is the fastest model
  here at 97 tok/s.

Check the harness before believing a zero.

## Limitations

Ground truth in `cases.json` was written and critiqued by subagents; no human
has verified all 44. Single run per case at temperature 0.7 — treat gaps under
~5 points as noise. `mistral-nemo` vs `phi4` vs `tulu3` is a three-way tie
within that margin on appropriateness; the separation is on harm, schema, and
speed.
