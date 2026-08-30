# Evals: which local model should drive the bots?

Run: `python3 eval2.py <model> [model ...]` with Ollama up. Cases in `cases.json`.

## Why v1 was wrong, twice

The first eval batch produced a claim I committed to this repo:

> qwen3:8b and andy-4:micro take minutes per model in the harness against
> llama3.1's 0.47s median - too slow for a 12s decision loop.

**Both halves of that were measurement artefacts.** Ben asked "did the mac
sleep? that might have confused things." It had.

**Artefact 1 - the machine slept.** `pmset -g log` showed repeated Maintenance
Sleeps spanning the run. Load average was 46.60 (15-min) against 3.97 (1-min):
a backlog draining after wake, not a working machine.

**Artefact 2 - eviction starvation.** With the Mac awake, qwen3 *still* appeared
to hang. It had not loaded after 8 minutes. The cause was not the model:

```
ollama ps  ->  llama3.1  5.7GB  100% GPU  UNTIL 28 minutes from now
```

qwen3 wants 11GB at a 40960 context; Ollama would not co-load them, so the
request sat behind llama3.1's 30-minute `keep_alive` lease. The six bots renew
that lease continuously, so it would never have cleared. After an explicit
evict (`keep_alive: 0`):

```
load_duration 3.8s   eval_duration 0.14s   response {"ok":1}
```

**qwen3 was never slow.** Measured properly, all six models complete the full
44-case set in 21-42 seconds. No model is disqualified on speed.

The harness now force-evicts other models before each run. If you benchmark
against a live Ollama that something else is using, you are measuring the
scheduler, not the model.

## Why v1's *scores* were also meaningless

v1 gave llama3.1 "42% action appropriateness" with no baseline. It never asked
what a model that ignores the situation entirely would score. Every run now
scores constant policies through the identical scorer, plus a random baseline:

| policy | apt | harmful |
|---|---|---|
| random choice (4000 trials) | 7% | 47% |
| constant `mine` | 0% | 98% |
| constant `idle` | 2% | 98% |

**Read every model number against these, never against zero.**

The v1 case set was also not discriminative: constant `mine` scored 42% on it.
The current 44 cases span five dimensions (survival, social, orders, silence,
taskswitch), were adversarially critiqued case-by-case for lazy-default leakage,
and include negative controls where *persisting* with the current goal is
correct. The best constant policy now scores 16%.

## Results — 44 cases, quiet machine, bots stopped

| model | schema | legal | apt | harmful | brief | quiet | tok/s | lat | p90 |
|---|---|---|---|---|---|---|---|---|---|
| llama3.1:latest | 100% | 98% | 16% | **75%** | 100% | 59% | 70.1 | 0.50 | 0.57 |
| qwen3:8b | 100% | 93% | 34% | **52%** | 100% | 61% | 38.1 | 0.69 | 1.23 |
| llama3:latest | 100% | 100% | **39%** | 59% | 100% | 57% | 71.3 | 0.48 | 0.54 |
| llama2:latest | 100% | 95% | 27% | 61% | 93% | 59% | 56.3 | 0.87 | 1.10 |
| sweaterdog/andy-4 | 0% | 0% | 0% | 0% | — | — | — | 0.39 | 0.45 |
| sweaterdog/andy-4:micro | 0% | 0% | 0% | 0% | 84% | 41% | 97.1 | 0.70 | 1.26 |

## The finding that matters

**`llama3.1:8b` — the model this repo recommends and runs in production — is the
worst of the four on situational awareness, and worse than random at avoiding
actively harmful actions (75% vs 47%).**

Action distribution over the 44 cases explains it:

| model | distinct actions | most common | share |
|---|---|---|---|
| llama3.1:latest | 10/15 | `mine` | **45%** |
| llama2:latest | 10/15 | `mine` | 36% |
| llama3:latest | 12/15 | `mine` | 25% |
| qwen3:8b | 13/15 | `mine` | 15% |

llama3.1 answers `mine` to nearly half of all situations — including a hissing
creeper and starving-with-bread-in-hand. It is the closest of the four to the
degenerate constant policy, which is exactly why its harm rate exceeds chance.

**This does not make the original llama3.1-over-qwen3 decision wrong.** That
decision was made on *free-text wiki compiles*, where qwen3's hidden `<think>`
blocks consumed the whole token budget and returned empty (see `wiki/models.md`).
That result stands. It simply does not transfer to constrained JSON action
selection, which is a different workload — and it was generalised to "use
llama3.1" across the board without ever being tested here.

The likely right answer is **different models for different calls**: llama3 or
qwen3 for the action loop, llama3.1 for free-text.

## andy-4 scores 0% for a reason worth knowing

andy-4 is not broken and not bad. It is fine-tuned for the **Mindcraft**
framework, which uses a different calling convention. Asked for our JSON, it
replies in Mindcraft's command syntax:

```
say='Time to give you some space. !moveAway(40)'   action=''
```

The fine-tune overrides our schema instruction. Scoring it against our format
measures convention mismatch, not capability. To evaluate it fairly you would
adopt Mindcraft's `!command()` protocol. Its throughput is the highest measured
here (97 tok/s), so it may deserve that.

## Known limitations — read before trusting these numbers

- **Ground truth is model-authored.** The `ok`/`bad` sets were written by
  subagents and adversarially critiqued by other subagents. No human has
  verified all 44. A wrong `ok` set produces a confident wrong ranking. Spot-check
  `cases.json` before acting on this.
- **`bad` lists are wide** (mean 7.1 of 15 actions), which is why the random
  harm baseline is 47%. The metric is only meaningful as a delta against that.
- **Single run, no repetitions.** Temperature is 0.7, so these are one sample per
  case. Re-run with `reps` for variance before treating small gaps as real.
- **`taskswitch` needed rescuing.** All 8 designed cases had "abandon the goal"
  as the answer, so an always-abandon policy scored 100%. Three negative controls
  were added. Watch for this shape in any new dimension.
