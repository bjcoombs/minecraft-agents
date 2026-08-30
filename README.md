# minecraft-agents

Six autonomous agents playing Minecraft together, driven by a local LLM, with
persistent memory that survives between sessions.

Built over one evening. This repo exists so the learnings outlive the chat
context they were discovered in.

## What it does

Six mineflayer bots — `Claude`, `Woodcutter`, `Builder`, `Miner`, `Forager`,
`Fighter` — each an independent Node process with:

- **A local LLM brain** (`llama3.1:8b` via Ollama) deciding what to say and do
- **Persistent memory** — a per-agent wiki compiled nightly from a raw journal
- **A shared objective** — an 11-stage progression toward beating the game
- **Roles** — gathering, mining, crafting, foraging, combat
- **Improvised dialogue** — catchphrases and combat shouts written in the moment

Everything runs locally. No API keys, no cost, no internet at runtime.

## What actually happened

Reached **7 of 11 stages**: wood → tools → stone → iron → iron pickaxe →
diamonds → obsidian. Six of those seven were genuinely earned, including
crafting a diamond pickaxe unaided after a placement bug was fixed. The Nether
was never reached.

Along the way they mined at y=-54, smelted their own iron, fished, farmed wheat,
fought zombies, kept chests, slept in beds, and wrote 210 wiki entries about
their own days — including this unprompted self-criticism from Woodcutter:

> *Stored 10 items and then 46 items in a single chest. This is not efficient.
> Consider investing in more chests or improving inventory management.*

## Layout

Follows [Karpathy's LLM-wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) —
immutable evidence, compiled understanding, and the schema that connects them.

```
CLAUDE.md      instructions for agents working on this repo
SCHEMA.md      conventions (layer 3)
wiki/          compiled learnings (layer 2)
  bugs.md          every bug, root cause, and the log line that proved it
  architecture.md  how it fits together; the concurrency traps
  models.md        local model benchmarks and selection
  wiki-memory.md   the sleep/dream memory cycle
  process.md       how to debug this kind of system
  inference-cost.md    caching, reasoning cost, model landscape
  monitoring.md    what to watch in an unattended swarm
  multi-agent-chat.md  making agents converse, not repeat
  verifying-advice.md  testing a recommendation before adopting it
sources/       raw immutable evidence (layer 1)
  memory/          the agents' own journals and compiled wikis
  quest-final.json final progression state
src/           the working code
  bot.js           the agent (~2000 lines)
  supervise.sh     PID-tracking process supervisor
  babysit.sh       health watchdog
  speak.sh         text-to-speech, one voice per agent
  builds/          command-driven builds (Salisbury Cathedral, Big Ben)
```

## The five findings worth your time

1. **A reasoning model is the wrong choice for an action loop.** qwen3:8b spent
   its whole token budget on hidden `<think>` blocks and returned empty
   responses. llama3.1:8b was faster *and* better here. Trust your benchmark
   over reputation. → `wiki/models.md`

2. **A library call that resolves is not proof it worked.** `bot.consume()`
   silently does nothing on Minecraft 26.1 — agents logged "ATE bread" while
   starving to death. Assert on world state. → `wiki/bugs.md`

3. **Log what you rejected.** "Scanned 80 lava blocks, found 0 sources" is not
   diagnostic. Printing one rejected sample revealed the bug instantly: the code
   required `air` above, but underground it is `cave_air`. → `wiki/process.md`

4. **Many symptoms, one cause.** Fishing, farming, sleeping, item handovers and
   mining all failed differently. All were uncoordinated pathfinder goal
   changes. → `wiki/architecture.md`

5. **Agent memory works, and confabulates.** The nightly compile produced
   genuinely useful structured reflection — and invented a coordinate
   `(1234, 5678)` and a teammate interaction that never happened. Keep the raw
   journal immutable so claims stay checkable. → `wiki/wiki-memory.md`

## Requirements

Ollama with `llama3.1:8b`, Node 22+, Java 25 (for Minecraft 26.1), a Minecraft
server jar. Developed on an M1 Max / 64 GB.
