# The output contract is a variable, not a constant

Ben: *"we seem to be limiting ourselves to only supporting structured json"*.

He was right, and it was a flaw in the method. Every eval before this one held
the contract fixed at Ollama's `format: json` and varied the model. That does
not measure how well a model **decides** — it measures how well it complies with
one arbitrary convention. It was a selection filter dressed up as a harness.

`adapter.py` normalises whatever a model emits — strict JSON, JSON embedded in
prose, markdown fences, `!command(args)`, `key: value`, plain English, native
tool calls, or a decision left in the `thinking` field — into `{say, action}`,
and reports **which** strategy won so the model's natural format is visible.

## Same model, four contracts, 44 cases

| model | contract | parseable | apt | harm | latency | how it parsed |
|---|---|---|---|---|---|---|
| gpt-oss:20b | `json_format` | **20%** | 9% | 7% | 2.02s | 35/44 unparseable |
| gpt-oss:20b | `free_text` | 100% | 27% | 43% | 9.89s | 40 from `thinking` |
| gpt-oss:20b | `tool_call` | 91% | 30% | 48% | 5.68s | 39 from `thinking`, 1 real tool call |
| gpt-oss:20b | `think_free` | 100% | **57%** | **32%** | 15.24s | 39 `key_value` |
| mistral-nemo:12b | `json_format` | 95% | 39% | 48% | **0.76s** | 42 strict JSON |
| mistral-nemo:12b | `free_text` | 95% | **41%** | **45%** | 1.66s | 40 `key_value` |
| mistral-nemo:12b | `tool_call` | 95% | 32% | 55% | 1.84s | 41 real tool calls |
| mistral-nemo:12b | `think_free` | 0% | 0% | 0% | — | no thinking support |

Baselines: random 7% apt / 47% harm.

## The finding

**For gpt-oss the contract matters more than the model does.** The same weights
score 9% appropriateness under `json_format` and 57% under `think_free` — a
48-point swing from a harness setting. Under the original harness it was
recorded as a 0% failure four separate times.

**For mistral-nemo the contract barely matters** (39 / 41 / 32). It is contract-
agnostic, which is exactly why it looked good in the earlier evals: those evals
rewarded compliance, and it complies with everything.

So the earlier model ranking was partly a ranking of *convention compliance*.
The models that lost were not always worse at deciding; some were being asked to
speak a language they are not fluent in.

## Generic principle, beyond Minecraft

1. **Never evaluate a model through one output contract.** A zero is a claim
   about your harness until you have tried the model's native format. This
   project produced four such zeros: gpt-oss (`format:json`), qwen3:4b
   (`think:false` missing), and two andy-4 variants.
2. **Constrained decoding is not free.** `format: json` forces token-level
   constraint that can fight a model's trained output distribution. On gpt-oss
   it destroys the output entirely; on mistral-nemo it costs nothing.
3. **Prefer an adapter to a constraint.** Parsing loosely and normalising is
   more portable than forcing every model into one schema, and it lets you swap
   models without re-tuning prompts.
4. **Tool calling is not automatically better.** It is the industry-standard
   contract, and here it was *worse* for both models than the simpler ones
   (gpt-oss 30% vs 57%; mistral-nemo 32% vs 41%). Only mistral-nemo actually
   emitted real tool calls; gpt-oss emitted one in 44 attempts.

## Caveat that limits these numbers

The four contracts do not use identical prompt text — `json_format` asks for a
JSON object while `free_text` asks for an `action:` line. So each cell varies
**contract and wording together**, and the comparison is contract-as-implemented
rather than an isolated measurement of constrained decoding. The 48-point
gpt-oss swing is far too large to be wording alone, but the smaller gaps
(mistral-nemo's 39 vs 41) are not separable from prompt phrasing or from the
±9 noise floor.

## andy-4 is simply broken, correcting an earlier claim

`MODEL-SELECTION.md` records that andy-4 "is fine-tuned for Mindcraft and
answers in `!command()` syntax". That was true of `andy-4:micro-q5_k_m`. The
`:latest` build emits literal nonsense on any prompt:

```
response: '0000000000000000000000000000000'
```

0% parseable under all four contracts, including the adapter's command-syntax
and natural-language strategies. That is a broken GGUF or an incompatibility
with Ollama 0.33.2, not a protocol difference. Corrected here.
