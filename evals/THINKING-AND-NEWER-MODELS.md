# Is a newer model better? Is "a little thinking" better?

Both asked by Ben. Both measured. Both answers are no, for reasons worth
recording.

Baselines throughout: random = 7% apt / 47% harm. Constant `mine` = 0% / 98%.

## Newer and bigger did not help

| model | released | GB | apt | harm | tok/s | warm lat |
|---|---|---|---|---|---|---|
| mistral-nemo:12b | Jul 2024 | 7.1 | 39% | 48% | 27.2 | **0.43s** |
| qwen3.8:27b-mlx | 2026 | 18 | 41-50% | 48-50% | 11.9 | 2.95s |
| qwen3.5:27b | 2026 | 17 | 41% | 45% | 9.5 | 4.56s |
| qwen3:30b-a3b (MoE) | 2025 | 18 | 30-39% | 57-61% | **64.2** | 0.55s |

The 2026 27B models are **not measurably better** than a 12B from July 2024,
and they are 3-10x slower per decision. `qwen3:30b-a3b` is the fastest thing
tested — a Mixture-of-Experts model activating ~3B of its 30B parameters per
token, which is exactly the shape that suits an M1 Max's memory bandwidth — but
it buys that speed with accuracy.

This is the third time on this project that recency failed to predict quality:
`llama3` beat `llama3.1`, `mistral-nemo` (2024) beats the 2026 27Bs, and
`codellama:34b` lost to 7B models.

## There is no useful middle setting for thinking

The hypothesis was that between "no thinking" and "full thinking" there might be
a cheap setting that buys accuracy. There is not, for two separate reasons.

**With `format: json`, every thinking level returns an empty response.**

| think | schema | apt | note |
|---|---|---|---|
| `false` | 100% | 39-50% | the only usable setting |
| `"low"` | 0% | 0% | empty response |
| `"medium"` | 0% | 0% | empty response |
| `"high"` | 0% | 0% | empty response |
| `true` | 0% | 0% | empty response |

This is **not** a token-budget problem — the first hypothesis, and it was wrong.
Raising `num_predict` from 100 to 1500 changed nothing, and the `thinking` field
came back populated (56-127 chars) while `response` stayed empty. The
`format: json` constraint and the thinking channel do not compose.

**Without `format: json` thinking works — and is not worth it.**

| model | think | latency | reasoning emitted | action chosen |
|---|---|---|---|---|
| qwen3.8:27b-mlx | `false` | **6.4s** | 0 chars | `stop` |
| qwen3.8:27b-mlx | `low` | 21.3s | 982 chars | `stop` |
| qwen3.8:27b-mlx | `medium` | 23.3s | 1104 chars | `come` |
| qwen3.8:27b-mlx | `high` | 22.7s | 845 chars | `stop` |
| qwen3:30b-a3b | `false` | 18.8s | 0 chars | `stop` |
| qwen3:30b-a3b | `low` | 20.8s | 4239 chars | `stop` |

Thinking costs roughly **3.5x the latency to reach the same answer**. At 21-23s
per decision across six bots, it does not fit a 12-second loop at any level.

**Keep `think: false`.** But keep it for the measured reason — thinking does not
compose with constrained output, and its unconstrained form is too slow — not
the original folk reason that "reasoning models are bad".

## Quantisation: no difference, so keep the faster one

`mistral-nemo` ships as Q4_0, a legacy quantisation. K-quants are usually better
per byte, so this looked like free quality. Over **3 repetitions, 132 samples
each**:

| build | apt | harm | tok/s | latency |
|---|---|---|---|---|
| Q4_0 (default) | 39% | 48% | **27.2** | **0.43s** |
| Q4_K_M | 40% | 48% | 21.6 | 0.60s |

Identical quality; Q4_0 is faster. **Keep the default.**

A single run had shown 45% vs 41% and I nearly recommended switching on it.

## The noise floor, measured

Repeat runs of the *same model with the same settings* vary by up to 9 points
(`qwen3.8:27b-mlx` scored 41% then 50%; `mistral-nemo` 45% then 41%).

**Single-run gaps under about 5 points are not real.** That retroactively means
`mistral-nemo` (41%), `phi4` (43%), `tulu3` (41%) and `llama3` (39%) were never
separable on the single-run data in `MODEL-SELECTION.md` — only the large gaps
are trustworthy, such as `llama3.1` at 16% and `granite3.3` at 11% against a
leading group around 40%. Use `--reps=3` for any decision that matters.

## Unmeasured, honestly

- **`gpt-oss:20b` still scores 0%** and is NOT known to be bad. It leaks its
  reasoning into the response field (`"The user says: ..."`) rather than
  emitting JSON, at every think setting. It needs its own response parsing
  before it can be judged. At 59.9 tok/s it is worth that work.
- **The MLX question is unanswered.** `qwen3.8:27b-mlx` runs at 11.9 tok/s, but
  its `q4_K_M` twin did not finish downloading, so there is no controlled
  comparison and therefore no measured statement about whether Apple's
  Metal-native build is faster. Do not assume it is.
- `command-r7b` timed out during a concurrent 18GB download. That result is
  confounded and it remains untested.
