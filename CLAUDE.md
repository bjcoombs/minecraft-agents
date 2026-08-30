# CLAUDE.md — minecraft-agents

Six LLM-driven Minecraft agents running on a local model, with persistent
per-agent memory. This file is loaded automatically; read `wiki/` before
changing anything.

## Read these first

- `wiki/bugs.md` — every bug found, with the log line that exposed it. Most
  cost an hour or more to find. Do not rediscover them.
- `wiki/architecture.md` — how the pieces fit, and the concurrency traps.
- `wiki/models.md` — model benchmarks. **Model choice depends on the call:**
  `llama3.1:8b` for free-text, but it is the *worst* tested model at choosing
  actions (see `evals/README.md`). Do not assume one model wins both.
- `wiki/wiki-memory.md` — the sleep/dream memory cycle.
- `wiki/inference-cost.md` — prompt caching, reasoning cost, model landscape.
- `wiki/monitoring.md` — what to watch when it runs unattended, and why.
- `wiki/multi-agent-chat.md` — making six agents converse instead of repeat.
- `wiki/verifying-advice.md` — worked example of testing a recommendation.
- `wiki/process.md` — how to debug this system effectively.
- `SCHEMA.md` — the conventions for maintaining this repo.

## Running it

```sh
ollama serve &                     # local model, no internet needed
cd src
mkfifo console
nohup sh -c 'while true; do sleep 3600; done > console' &
nohup java -jar server.jar nogui < console > server.out &
./supervise.sh                     # must BE the long-running process
```

Admin commands go to the server via `echo "time set day" > console`.

Everything is local: server on `127.0.0.1:25566`, Ollama on `127.0.0.1:11434`.
**No internet is used at runtime.**

## Hard-won rules

**Benchmark against a baseline, or you have measured nothing.** "42%
appropriateness" meant nothing until a constant-`mine` policy was scored on the
same cases and got 42% too. Always score the degenerate policy and chance.

**Evict other models before benchmarking.** Ollama would not co-load qwen3
(11GB) beside llama3.1, so qwen3 queued behind a 30-minute `keep_alive` lease
the bots kept renewing, and looked hung for 8 minutes. It loads in 3.8s. Send
`keep_alive: 0` for every other model first.

**Order prompts by volatility.** Ollama caches byte-identical prefixes (28x
faster prompt eval). Static first, live state last, or you poison the cache.

**Set `think: false` on free-text calls.** A reasoning model burns its whole
budget on hidden tokens and returns nothing. Harmless on non-reasoning models.

**Verify effects, never trust a successful call.** `bot.consume()` resolves and
does nothing on 26.1. Assert on world state:
```js
const before = bot.food
bot.activateItem(); await bot.waitForTicks(40); bot.deactivateItem()
if (bot.food > before) { /* it actually worked */ }
```

**Log what you rejected, not just that you found nothing.** Every hard bug here
was solved by printing a sample of the rejected candidates.

**Never let a subsystem steal a pathfinder goal.** The work cycle, LLM
dispatcher, follow loop, stuck watchdog and hazard escape can all issue goals.
Respect the `locked` flag in all of them, and always release it in `finally`.

**Run a deadlock watchdog.** Clear any lock held over 45 s. Without it a single
leaked flag idles an agent permanently.

**Standing still is not being stuck.** Exclude digging, sleeping and open
containers, and treat an unreachable goal as resolved by dropping it. Ignoring
this produced 209 false positives.

**Protect state before making anything aggressive.** `keep_inventory` on from
the start; a `NEVER_DUMP` list before inventory culling.

**Entity types:** passive animals are `type: 'animal'`, not `'mob'`. Underground
air is `cave_air`, not `air`.

**Remove routines that cost more than they produce.** The lava-to-obsidian
routine caused 7 deaths and 0 blocks. Deleting it was the fix.

## Style

Match the existing code: plain JavaScript, no framework, comments explaining
*why* rather than what. Keep the file-based control plane — it is what makes
this debuggable.

## When you learn something

Add it to the right `wiki/` page with the log line that proves it. If you cannot
cite evidence, label it a hypothesis. Keep raw material in `sources/` untouched.
