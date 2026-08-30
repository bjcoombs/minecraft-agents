# Evals

`eval.py` scores a local model on the *actual* agent workload rather than a
general benchmark. Six scenarios drawn from real failures observed in play.

## What it measures

| Metric | Why it matters |
|---|---|
| **schema** | does it emit `{say, action}` at all — a malformed reply means the bot does nothing |
| **legal** | is the action one we can execute |
| **appropriate** | is the action sensible for the situation |
| **brief** | respects "under 15 words" |
| **silence** | stays quiet when told there is nothing new |
| **tok/s, latency** | must fit inside a 12-second decision loop |

## Run it

```sh
ollama serve &
python3 eval.py llama3.1:latest qwen3:8b <others>
```

Results are written to `eval-results.json`, including every individual response
so failures can be read directly.

## Baseline result — llama3.1:8b

```
schema  legal   apt  brief  quiet   tok/s   lat
  100%    92%   42%   100%    42%    48.5  0.47
```

**The summary hides the real problem; the per-case detail shows it:**

```
teammate_question    action=mine    asked how much iron; starts mining
danger               action=mine    creeper 3 blocks away; starts mining
hungry               action=mine    food 4/20 with bread in hand; starts mining
direct_order         action=mine    correct
nothing_new          action=idle    correct
resource_request     action=mine    teammate asks for cobblestone; starts mining
```

**It answers `mine` to almost everything** — 10 of 12 responses. Schema perfect,
dialogue fine ("Creeper incoming", "A dozen."), action nearly constant.

This retrospectively explains behaviour previously blamed on other causes: bots
ignoring requests, not eating when hungry, wandering off mid-conversation.

**Diagnosis:** the prompt lists fifteen actions flatly with no guidance on when
each applies, so the model picks the safe default. The fix to test is making the
action choice discriminative — describe when each action applies, and place the
situation before the list.

**Method note:** the aggregate score would have led to "92% legal, good enough".
Only the per-case dump revealed that one action dominated. Always log the
individual responses, not just the totals.
