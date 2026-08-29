# Agent memory: the sleep/dream cycle

Each agent keeps its own `memory/<Name>/` directory implementing Karpathy's
three-layer wiki. This was the most successful part of the system — 210
successful compiles over the run.

## Structure

```
memory/<Name>/
  journal.md     layer 1 — append-only, written during the day, never edited
  wiki.md        layer 2 — index
  world.md       layer 2 — places, coordinates, what is where
  teammates.md   layer 2 — who does what, what they asked for
  tasks.md       layer 2 — doing, blocked, finished
  lessons.md     layer 2 — what went wrong and what to do differently
memory/schema.md layer 3 — the conventions
```

## The cycle

**Day:** significant events append one line to `journal.md` — logs chopped,
items stored, blocks built, deaths, getting stuck. Raw and immutable.

**Night:** when `timeOfDay > 12800`, the agent walks to its own bed, sleeps,
and *dreams*: for each wiki page, the LLM is given the current page plus the
last 60 journal lines and asked to rewrite the page. That is the compile step —
raw experience into durable structure.

**Always:** the compiled `world`, `tasks` and `lessons` pages are injected into
every decision prompt, so yesterday's understanding shapes today's actions.

## It produced genuinely useful reflection

Forager's `world.md`, unprompted:
```markdown
## Farming Summary
- 14:32: Planted 1 item at (-10, -12)
- 14:45: Planted 2 items at (-7, -11)

## Stuck Incidents
- Multiple incidents of getting stuck and needing to dig out between 14:19 and 15:05

## Storage
- Stored 88 items in my chest
```

Woodcutter's `lessons.md`, self-critical without being asked:
```markdown
## Chopping efficiency
* Started the day holding 12 logs, but was stuck chopping wood most of the
  time. Need to work on my chopping speed.

## Chest management
* Stored 10 items and then 46 items in a single chest. This is not efficient.
  Consider investing in more chests or improving inventory management.
```

## It also confabulates, and you must expect that

Same file, same session:
```markdown
## Stuck in mud at (1234, 5678)
* Coordinated with Miner to dig me out.
```
Placeholder coordinates, and no such coordination ever happened. An 8B model
fills gaps with plausible invention when the journal is thin.

**Treat the wiki as a useful but unreliable narrator.** It is excellent at
structuring what did happen and will cheerfully fabricate what didn't. Keep the
journal immutable so you can always check a claim against the raw record —
which is exactly the reason for the layer separation.

## What made it work

- **Non-reasoning model.** qwen3 burned its budget on hidden thinking and
  returned empty pages (1 success / 6 failures). llama3.1 fixed it immediately.
- **Strip `<think>` blocks and code fences** before writing the page.
- **Bounded timeout** (45 s) with fall-through, so a slow compile skips a page
  rather than hanging the agent.
- **Reject empty output** — keep the previous page rather than overwrite with
  nothing.
- **Per-page prompts**, not one prompt for the whole wiki. Smaller, more
  focused, more reliable.

## Extension that worked well

Seeding the *catchphrase* generator with `lessons.md` meant an agent's greeting
reflected what it had learned. Cheap, and it makes the memory visible in play:
```
<Claude>      let's dig into this thing
<Woodcutter>  chop chop, find food
<Builder>     build smart, not sorry!
<Miner>       digging deep, finding sweet
<Forager>     watch my back, team
```
