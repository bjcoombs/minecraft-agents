# Inference cost: caching, reasoning, and where each actually bites

Two mechanisms are easy to confuse. Caching affects the **input** side; reasoning
affects the **output** side. Optimising one does nothing for the other.

## Prompt caching is automatic, and large

Ollama reuses the KV cache for any **byte-identical prompt prefix**. No flag, no
configuration. Measured with a 1,259-token shared prefix:

```
call 0:  prompt_eval 2.434s   ← cold
call 1:  prompt_eval 0.087s   ← 28x faster
call 2:  prompt_eval 0.086s
```

**The catch: prefix means prefix.** One changed byte early in the prompt
invalidates the cache for everything after it.

Our prompt was ordered badly — the live chat transcript and the agent's position
sat *before* the slow-changing wiki and relationship context, so almost nothing
was reusable. Reordered to:

```
SYSTEM          static per agent      cached
wiki context    changes nightly       cached between compiles
relationships   changes on events     mostly cached
quest           changes per stage     mostly cached
--- live ---
chat, state, trigger                  the only part re-evaluated
```

**Rule:** sort prompt sections by volatility, least-changing first. Anything
that changes every call goes last.

## Reasoning models: it depends entirely on the task

I originally concluded "avoid reasoning models" after qwen3 produced six empty
wiki compiles in a row. That was too broad a rule from one failure. Measured
properly, the boundary is sharp:

**Short JSON action, with `format:json`:**
```
think=true    19 output tokens, 0.65s, valid JSON
think=false   18 output tokens, 0.58s, valid JSON
```
Effectively free. The JSON grammar constrains generation and suppresses the
reasoning block.

**Free-text generation, unconstrained:**
```
think=true    400 output tokens, 11.15s, ZERO visible characters
think=false    38 output tokens,  1.32s, valid markdown
```
8.5x slower for **no output at all**. The entire `num_predict` budget went to
hidden `<think>` tokens.

## The correct rule

> A reasoning model is fine where output is grammar-constrained. It is unusable
> for unconstrained generation unless you set `think: false` — and `think:
> false` fixes it completely.

This reopens the field: qwen3, gpt-oss and deepseek-r1 are all viable with
`think:false` on free-text paths. Choose a model on quality, not on whether it
reasons.

We now set `think: false` explicitly on all three free-text calls (wiki compile,
catchphrase, combat shout). It is a no-op on non-reasoning models and essential
insurance if the model is ever swapped.

## Caching does not rescue a reasoning model

Worth stating plainly, because it is the tempting inference: caching only
removes prompt-evaluation time. In the failing case above, prompt_eval was
already ~0.04s. The 11 seconds were all output generation. No amount of caching
touches it.

## Current model landscape (August 2026)

`llama3.1:8b` is roughly two years old. Available in the Ollama registry now:

| Model | Size | Reasoning? |
|---|---|---|
| granite4 (IBM) | 2.1 GB | no |
| gemma3:4b (Google) | 3.3 GB | no |
| qwen3:8b | 5.2 GB | yes — set `think:false` |
| gemma3:12b | 8.1 GB | no |
| phi4 (Microsoft) | 9.1 GB | no |
| gpt-oss:20b (OpenAI) | 13.8 GB | configurable effort |
| mistral-small3.2 | 15.2 GB | no |
| llama3.3:70b | 42.5 GB | no, but too slow to play |

Untested here. `llama3.1:8b` remains in use because it is the only one
benchmarked on this workload — see `wiki/models.md` for why that matters.

## Andy-4: a Minecraft-tuned model that did not fit

`sweaterdog/andy-4` is a real model fine-tuned for **Mindcraft**, a different
agent framework. Tested on our workload:

| Model | Speed | Free text | JSON schema |
|---|---|---|---|
| llama3.1:8b | 61.9 tok/s | good | **valid** |
| andy-4:micro | **84.1 tok/s** | good | **broken** |
| andy-4:latest (8B) | — | `0000000000...` | empty |

`andy-4:micro` is 36 % faster and writes better dialogue —
*"No way, that's awesome! Wanna come check it out with me?"* — but ignores the
schema entirely:

```json
{"":"", "Action output:":"", "See you later!":"-300,44,-110,"}
```

Fatal here: every decision drives a real action, and a malformed `action` does
nothing. `andy-4:latest` appears broken under Ollama 0.32.1 — emits zeroes, no
token count.

**Lesson:** a model tuned for *a* Minecraft agent framework is not tuned for
*yours*. Fine-tuning binds a model to an output convention; if your convention
differs, the tuning works against you.

**Possible use:** `andy-4:micro` for dialogue only, llama3.1 for JSON actions.
Two models, ~6.2 GB resident. Untested.
