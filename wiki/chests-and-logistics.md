# Chests, and knowing where the team's stuff is

The team lost 17 obsidian and spent hours unable to build a portal. None of it
was lost to deaths — `keep_inventory` was on the whole time. It was lost to
bookkeeping.

## `blockAt()` returns null for an unloaded chunk, and that is not "no chest"

Two functions treated those identically:

```js
// ensureChest
const b = bot.blockAt(new Vec3(mine.x, mine.y, mine.z))
if (b && b.name === 'chest') return b
// ...falls through and places a NEW chest, overwriting depot[NAME]

// fetchItem
if (!block || block.name !== 'chest') continue    // skips every unloaded chest
```

So a bot standing at y=-54, with every chest hundreds of blocks away and out of
render distance, would:

1. **Orphan its own chest** — the old location and everything in it dropped from
   the registry permanently, and a fresh chest placed wherever it happened to be.
2. **Report "not found" without searching anything** — `fetch obsidian 16`
   broadcast to all six recovered nothing, because all six skipped every chest.

**Fix:** `chestAt(c)` walks to the location to load the chunk before deciding a
chest is gone, and `depot._chests` is an append-only list so a location is never
forgotten even if `depot[NAME]` is replaced. Confirmed working in the logs:

```
{Woodcutter} CHEST mine at -302,44,-107 could not be confirmed
```

That is the new code declining to overwrite a chest it could not verify. The old
code would have silently orphaned it.

## Every bot knows every chest, and what is in it

`chests.json` is a shared index, written whenever *any* bot opens a chest —
position, contents, who saw it, when, and how many trips to it have failed.
Deposits update it before closing, which is the specific fix for what happened
here: Woodcutter's LLM chose `deposit`, and the obsidian became invisible to all
six because the state files only record *carried* inventory.

## Travel, ask, or make it again?

Knowing where something is only helps if fetching it is worth doing. Three real
costs, in blocks travelled:

| option | cost |
|---|---|
| go myself | `2 × dist(me → chest)` |
| ask a teammate | `dist(them → chest) + dist(chest → me)` |
| make it again | 0 travel, some gathering |

`arrangeDelivery()` computes all three across the four nearest chests and every
live teammate, then picks the cheapest. If a teammate wins it asks them over the
command channel *and says so in chat*, so the exchange is visible:

> `Woodcutter, you're closer to the obsidian - grab it and bring it over?`

The remake option is governed by what the thing is worth. Walking 400 blocks for
three planks is worse than chopping a tree:

```js
const CHEAP     = ['oak_log','cobblestone','dirt','stick','coal', ...]   // < 60 blocks
const PRECIOUS  = ['obsidian','diamond','ender_pearl','blaze_rod', ...]  // < 900 blocks
                                                                        // else < 250
```

Chests that fail three trips are marked unreachable and skipped, and
cross-dimension fetches are never attempted.

Both outcomes are written to the shared skill memory, so the decision itself is
something the team learns from.

## Still not fixed

Chest *placement* fails often, and that is now the binding constraint rather
than the bookkeeping:

```
{Forager} chest place: Event blockUpdate:(-440, 39, -110) did not fire within timeout of 5000ms
{Claude}  craft chest failed: Event windowOpen did not fire within timeout of 20000ms
```

Four of six bots still have no registered chest at all. These are mineflayer
interaction timeouts under load, not logic errors, and they need their own fix.

## Aside: the dream auditor was rejecting real lines

`auditPage()` treats an unknown capitalised word as an invented player. It was
throwing away legitimate entries whose first word happened to be capitalised:

```
REJECTED: "* **Quest Stage Iron**: updated to include smelted"
REJECTED: "* Killed 3 phantoms and 2 skeletons"
```

Now it strips bullets, bold labels and leading `Label:` before looking, and
skips the first word of the line. It still catches the real thing — an invented
`Steve`, a `Herobrine` — which is the case that matters, since the compile is
documented to invent both people and coordinates.
