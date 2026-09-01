# Shared skill memory

A team-wide, append-only log of what actually worked and what did not, retrieved
per situation and injected into the decision prompt.

This is the second memory system here. The first — the nightly wiki compile
(`wiki-memory.md`) — produces genuinely useful reflection **and confabulates**:
it invented a coordinate `(1234, 5678)` and a teammate interaction that never
happened. This one is built so it cannot do that.

## Two rules that make it trustworthy

**1. Only verified world-state changes become skills.** Never the model's claim
about what it did. Every write sits behind a check that already existed for
other reasons:

```js
if (bot.food > before) {                    // food ACTUALLY rose
  learnSkill('hungry and carrying food', `hold right-click to eat ${f.name}`,
             `food rose ${before} to ${bot.food}`, true,
             'activateItem works; consume() does not')
}
```

Death causes come from the server's own broadcast (`"Miner was slain by
Zombie"`), not from the bot's guess — the `death` event carries no cause, so the
message is captured separately and paired up.

**2. It is shared.** One bot paying the cost of learning something means all six
know it on their next cycle. Observed within minutes of switching it on:

```
{Claude}  LEARNED fails: pouring water on lava when lava is in range
                          but no safe standing spot above it
{Forager} LEARNED works: hold right-click to eat cooked_beef when hungry
```

Forager's lesson is now in Claude's context, and vice versa, without either
repeating the other's mistake.

## Retrieval must go LAST in the prompt

This is the part that is easy to get wrong. Ollama caches the longest identical
prefix, and that is worth **41-54x on prompt evaluation** (measured, see
`evals/MODEL-SELECTION.md`: 105ms with a shared prefix against 5656ms without).

Retrieved memories are volatile by definition — they change with the situation.
Injected high in the prompt they would invalidate the cache on **every single
call**, turning a 105ms prompt eval into seconds, six times per cycle. So the
order is:

```
SYSTEM  ->  wiki  ->  relationships  ->  quest      <- static, cached
--- live ---  chat, recent speech, world state
skillContext(...)                                    <- volatile, retrieved
trigger
```

A memory system that slows every decision by 40x is not worth the memories.

## Scoring

Keyword overlap between the situation and each skill's `trigger`/`action`/
`outcome`, plus a small recency bonus, plus a deliberate **+0.3 for failures**.
Knowing what does *not* work is what stops a bot repeating an hour-long dead
end, and this project produced several of those.

```
situation: "food 4/20, carrying bread. no obsidian nearby, lava is close"
  -> [DOES NOT WORK] pouring water on lava
  -> [WORKS] hold right-click to eat cooked_beef
```

## Seeded with what this session proved

Rather than make the bots rediscover today's findings, `skills.jsonl` is seeded
with them — obsidian only exists deep, `consume()` does nothing, approach-then-
dig, pool before building, and never pour water while standing beside lava.

## Limits, honestly

- Keyword matching, not embeddings. Cheap and cache-safe, but it will miss a
  paraphrase. Embeddings via `nomic-embed-text` would be the upgrade.
- Deduplication only checks the last 40 entries, so the file will drift toward
  repetition over long runs and eventually wants compaction.
- A skill is only as good as the check behind it. Anywhere the code does not
  already verify an effect, no skill can be written — which is the correct
  failure mode, but it means coverage follows wherever effects are asserted.
