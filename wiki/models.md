# Local model selection

Hardware: Apple M1 Max, 64 GB unified memory. Ollama 0.32.1.

## The measurement that mattered

Benchmarked on the actual workload — a short prompt returning strict JSON, which
is what a game agent needs.

| Model | Throughput | Warm latency | Notes |
|---|---|---|---|
| `llama3.1:8b` | **60 tok/s** | **0.55 s** | clean JSON, no reasoning overhead |
| `qwen3:8b` | 35 tok/s | 0.75 s | thinking model — see below |
| `llama3.1:70b` | ~6 tok/s | ~8 s | fits in 64 GB, far too slow to play |

## Reasoning models are the wrong tool for an action loop

I switched everything to `qwen3:8b` on its reputation for instruction-following,
ignoring my own benchmark showing llama3.1 was faster. It went badly.

qwen3 spends its token budget on hidden `<think>` blocks. With
`num_predict: 900` the visible answer came back **empty**:

```
DREAM world empty. raw was: (nothing)
qwen3:8b  11 GB  100% GPU  Stopping...     ← thrashing under load
806 LLM calls, most returning nothing
```

Wiki compiles ran at 1 success to 6 failures. After reverting to `llama3.1:8b`:
**14 successes, then 34, then 210.**

**Lesson at the time:** avoid reasoning models. **This was too broad** — later
measurement showed the boundary is about *output constraint*, not the model.
With `format:json` a reasoning model costs ~1 extra token; only unconstrained
free-text generation breaks, and `think:false` fixes that completely. See
`wiki/inference-cost.md`. The durable lesson is the other one: trust your own
measurements over a model's reputation.

## Serving several agents from one model

Six agents sharing one Ollama instance saturates it. What was needed:

- **`keep_alive: '30m'`** — otherwise the model unloads and reloads constantly.
- **Hard timeouts with `AbortController`** — 25 s for decisions, 45 s for wiki
  compiles, 20 s for combat one-liners. Without these a slow call hangs the
  agent indefinitely; `LLM error: This operation was aborted` is the healthy
  failure mode.
- **Throttled agent-to-agent chat** — 90 s cooldown, 10 % reply chance. Agents
  replying to each other was the bulk of 806 calls. Without a throttle they
  spiral.
- **Fall back to scripted lines** when a call fails, so the agent still acts.

## Where the local model was genuinely good

- **Structured output.** `format: 'json'` produced valid JSON essentially every
  time on llama3.1.
- **In-character dialogue.** Catchphrases and combat shouts, generated fresh:
  `"chop chop, find food"`, `"build smart, not sorry!"`,
  `"enderman go down"`, `"get out of my sight!!!"`.
- **Compiling a day's journal into structured notes** — see `wiki-memory.md`.

## Where it was not

- **Confabulation.** It invents specifics when the journal is thin. A bot wrote
  *"Stuck in mud at (1234, 5678) — coordinated with Miner to dig me out"*. Both
  invented: placeholder digits, and no such coordination happened.
- **Claiming actions it cannot perform.** Agents said "I'll bring you stone"
  with no mechanism behind it. The fix is to *add the real action* (`give`), not
  to prompt harder. Adding a real handover made the claims true.
- **Cost of a wrong choice.** No API cost — everything ran locally, zero
  bandwidth. The cost is entirely in latency and quality.
