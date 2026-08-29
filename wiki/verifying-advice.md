# Verifying advice: a worked example

An external research assistant produced a detailed setup recommendation for
running multiple agents. Testing each claim against this machine took about ten
minutes and changed most of the conclusions — in both directions. Both parties
were wrong about something.

## The original claims, and what testing showed

| Claim | Verdict | Evidence |
|---|---|---|
| Each bot loads its own model instance | **Wrong** | 4 concurrent clients → `ollama ps` shows one 22 GB instance |
| 4 bots serialize at ~7–8 tok/s each | **Wrong** | 6 concurrent requests: 73.8–76.6 tok/s *each*, 0.89 s wall total |
| Run 4 Ollama instances on ports 11434–37 | **Counterproductive** | Would load four copies — the cost it aimed to avoid |
| `Andy-4` does not exist | **My error** | `sweaterdog/andy-4` manifest → HTTP 200 |
| Q4_K_M and context capping | **Right** | KV cache scales `NUM_PARALLEL × CONTEXT_LENGTH` |
| MLX breaks concurrency on Apple Silicon | **Real, not applicable** | Our model is `format: gguf` → llama.cpp |

## The test that settled the main question

```sh
# four clients at once, then look at what is loaded
for i in 1 2 3 4; do curl -s .../api/generate -d '...' & done; wait
ollama ps
```
```
NAME               SIZE     PROCESSOR    CONTEXT
llama3.1:latest    22 GB    100% GPU     131072
```

One instance, not four. Then six concurrent requests — our real agent count —
returned 73.8, 74.2, 75.8, 76.4, 76.6, 76.6 tok/s against 74.9 for a single
request alone. No measurable contention.

Ollama enabled concurrent batching by default in August 2024 and auto-sets
`OLLAMA_NUM_PARALLEL` when memory allows. On a constrained machine it would
default to 1 and the original serialization concern would have been correct —
which is precisely why the claim had to be tested *on this hardware*.

## My own error, and why it was the worse one

I ran `ollama pull andy-4:micro`, got `file does not exist`, and reported
**"Andy-4 doesn't exist"**. The correct name is `sweaterdog/andy-4:micro-q5_k_m`
— I had omitted the namespace. All tags return HTTP 200.

The failure was not the wrong answer. It was reporting a negative result from an
unverified method as an established fact, when the honest statement was *"my
lookup failed"*. This is the same shape as the `say -v` voice checks earlier in
the project, where an exit code was mistaken for evidence. Twice in one session.

**Rule:** a negative result is only as strong as the method that produced it.
Before asserting something does not exist, verify the lookup can find something
that does.

## What was actually wrong with our setup

Neither memory nor bandwidth — **context length**. Ours ran at `131072` for
prompts of a few hundred tokens, and KV cache scales with
`NUM_PARALLEL × CONTEXT_LENGTH`. Capped to 8192 for decisions and wiki compiles,
4096 for one-line dialogue.

Also adopted: `OLLAMA_KEEP_ALIVE=30m` as a **server environment variable**
rather than per-request, because some clients silently drop the parameter and
reset the model to the 5-minute default — the unload/reload cycle behind the
thrashing we saw at 806 calls.

## The general lesson

Two failures with the same root:

- **qwen3** — I adopted it on reputation *against my own benchmark*, and it
  returned empty responses for six wiki compiles running.
- **This advice** — plausible, internally consistent, confidently argued, and
  wrong about the mechanism on this specific machine.

General advice is a hypothesis about your setup, not a result from it. The
distinguishing test usually costs minutes. Run it before adopting *or*
dismissing.
