# Bugs found, with root causes

Every entry cites the log line that exposed it. Ordered roughly by how much
time each cost.

---

## `mob` vs `animal` — one word broke two features silently

**Symptom:** bots stood next to sheep reporting "no sheep nearby". The forager
never caught a single animal in hours of running.

**Evidence:**
```
{Claude} ENTITIES: type=animal/name=sheep/d=0
{Claude} WOOL no sheep nearby, wandering
```

**Cause:** the filter was `e.type === 'mob'`. In this mineflayer/minecraft-data
version passive animals are `type: 'animal'`, not `'mob'`. Sheep at distance 0
never matched.

**Fix:** `(e.type === 'animal' || e.type === 'mob')`.

**Lesson:** the bug was invisible until I dumped the raw entity fields. Two
features had been quietly broken for hours. When something "isn't there", print
what *is* there before theorising.

---

## `air` vs `cave_air` — blocked the whole obsidian pipeline

**Symptom:** 80 lava blocks scanned, zero usable. Three consecutive checks
stalled on the same stage.

**Evidence:**
```
OBSIDIAN no source. sample: lava/lvl=0/meta=0/above=cave_air
OBSIDIAN scanned 80 lava blocks, source found: false
```

**Cause:** the check required the block above lava to be named exactly `air`.
Underground it is `cave_air`. Every candidate was a valid source (`lvl=0`) and
every one was rejected.

**Fix:** accept `air`, `cave_air` and `void_air`.

**Lesson:** I only found this because I made the failure print a *sample of what
it rejected*. "Found 80, used 0" is not diagnostic; "found 80, here are three
and why each failed" is.

---

## `bot.consume()` does not work on this protocol

**Symptom:** bots logged `ATE bread` repeatedly while starving to death. Food
never rose, bread count never fell.

**Evidence:**
```
{Miner}  ATE bread
{Claude} ATE bread
Claude food 0 | has bread? ['bread x24']
```

**Cause:** mineflayer's `consume()` is a no-op against Minecraft 26.1. It
resolves successfully and does nothing.

**Fix:** hold right-click instead, then verify:
```js
bot.activateItem(); await bot.waitForTicks(40); bot.deactivateItem()
if (bot.food > before) { /* actually ate */ }
```
Result: `ATE bread (14 -> 19)`.

**Lesson:** a library call that resolves is not proof of effect. Assert on world
state, not on the absence of an exception. This one nearly killed the run —
bots cannot survive in survival mode without eating.

---

## Placement fails in a 1×1 shaft — the hidden blocker behind everything

**Symptom:** crafting tables, furnaces and chests all failed underground.
Cascaded into: no pickaxes, no smelting, no diamond pickaxe, no progress.

**Evidence:**
```
{Miner} TABLE placement FAILED
{Miner} PICK no table
{Miner} OBSIDIAN aborted - no diamond pickaxe
```

**Cause:** bots dig straight down. At the bottom of a 1×1 shaft there is no
adjacent air block to place anything into. `placeNear()` returned null and every
caller aborted.

**Fix:** carve an alcove with the pickaxe, then retry. Diamond pickaxe crafted
on the first attempt afterwards.

**Lesson:** three separate features looked broken. One environmental
precondition was missing. Look for the shared cause before fixing three things.

---

## Silent early returns cost three debugging cycles

**Symptom:** `CMD obsidian 10` in the log, then nothing at all.

**Cause:** `getTable()` and `makeDiamondPick()` returned `false` on failure with
no logging. The task aborted invisibly.

**Fix:** log at every failure point. The bug was located in one cycle afterwards.

**Lesson:** an early return without a log is a debugging dead end. This wasted
more time than any actual bug.

---

## Jobs cancelled mid-execution

**Symptom:** `The goal was changed before it could be completed!` — killed
fishing, farming, item handovers, sleeping and obsidian mining.

**Cause:** the 12-second work cycle and the LLM's action dispatcher both issued
new pathfinder goals while a long job was running.

**Fix:** a `locked` flag respected by the work cycle, LLM dispatch, follow loop
and stuck watchdog. Wrapped in `try/finally` so it always releases.

**Caveat — not fully solved.** Locks still leaked occasionally
(`DEADLOCK cleared after 180s (busy=false locked=true)`). I could not reproduce
the escape path and instead bounded the cost: a watchdog clears any lock older
than 45s. That is mitigation, not a fix.

---

## Digging aborts on long mines

**Symptom:** obsidian never collected despite blocks existing.

**Evidence:** `mine obsidian: Digging aborted`

**Cause:** obsidian takes ~9 seconds. The bot was still pathfinding, and any
movement cancels a dig.

**Fix:** approach once, `setGoal(null)`, `clearControlStates()`, verify range,
*then* dig.

---

## Stuck detector fired on bots that weren't stuck

**Symptom:** 209 "stuck" events; 123 resolved by a single jump. Miner worst
affected.

**Cause:** standing still while *digging* is normal. The detector counted it as
wedged.

**Fix:** exclude `bot.targetDigBlock`, `bot.isSleeping`, open containers. Raised
the threshold from 21s to 36s. **209 → 0.**

**Second instance, same class of error:** Fighter generated 37 of 66 events by
pathing to random points 25 blocks away, many unreachable. Standing still
holding an impossible goal is not the same as being stuck. Fix: short 8–18 block
hops, always clear a failed goal, and treat "had an unreachable goal" as
resolved by dropping it. **20 per check → 1.**

---

## Full inventories block everything downstream

**Symptom:** `SMELT destination full`. Team had 19 diamonds but 1 iron ingot.

**Cause:** ~2,000 cobblestone filling every slot. Smelted output had nowhere to
go, and mined blocks could not be picked up.

**Fix:** `dumpJunk()` — toss low-value blocks above 18 used slots. **Critical
detail:** add a `NEVER_DUMP` list (obsidian, diamond, ores, ender pearls) *before*
making dumping aggressive, or the fix throws away the objective.

---

## Deaths silently destroyed hours of work

**Symptom:** team diamonds went 19 → 0.

**Cause:** default survival rules. Nobody noticed because the counter only
appeared in a periodic check.

**Fix:** `gamerule keep_inventory true`.

**Lesson:** for a long unattended run, protect accumulated state early. This
cost more real progress than any code bug.

---

## Fatal environmental hazards

- **Drowning.** The escape only held jump, which does nothing when submerged.
  Fixed by pillaring up with placed blocks and swimming toward dry land.
- **Lava.** 7 deaths from a routine that pours water on lava to make obsidian —
  the bot must stand beside the source and kept falling in. **Removed the
  routine entirely**; it had produced 7 deaths and 0 blocks. Lava deaths per
  check went 7 → 0.
- **Lava pockets while descending.** Checking one block below is useless when a
  bot falls faster than it reacts. Now scans 6 blocks down plus a 3-block shell.
- **Endermen.** Looking at one aggros it, and the bots call `lookAt()` on nearby
  entities. 6 of 10 deaths in one window. Fixed with a `safeLookAt()` guard that
  stares at the ground when an enderman is within 20 blocks.

---

## Verification methods that gave false results

Twice I reported something worked when it hadn't:

- `say -v Serena ""` — exits 0 for voices that are not installed.
- `say -v X -o /dev/null "test"` — fails for *every* voice, including valid ones.

Correct method: match against `say -v '?'` output, which is authoritative.

**Lesson:** when a check is cheap, verify the checker. I passed both false
results to the user as fact.

---

## Runaway retry loop burned two CPU cores

**Symptom:** the fan spun up; load average hit **22.4** on a 10-core machine.
Two `bot.js` processes at 100 % and 83 %.

**Evidence:**
```
{Claude}  NETHER failed to transfer
{Forager} NETHER failed to transfer
{Builder} NETHER failed to transfer
{Miner}   NETHER failed to transfer
```
Four agents failing, retrying immediately, each retry launching a fresh
pathfinding search.

**Cause:** no backoff on a failing operation. Pathfinding is the expensive part,
and a hopeless search was being restarted continuously.

**Fix:**
- 2-minute cooldown after a failed dimension transfer
- hard caps on the pathfinder: `thinkTimeout 3000ms`, `tickTimeout 20ms`,
  `searchRadius 96`
- ragdoll poll slowed 100 ms → 250 ms

**Result:** five of six agents went from ~75–92 % CPU to under 3 %; load 22.4 →
8.8.

**Lesson:** any retry against the world needs backoff. In an agent loop the
failure path runs far more often than the success path, so it deserves more care,
not less. Now watched automatically — see `wiki/monitoring.md`.

---

## Checking a zsh script with `bash -n`

**Symptom:** `syntax error: unexpected end of file` on a working script.

**Cause:** the script is `#!/bin/zsh`; `note() { ... }` without a trailing
semicolon is valid zsh, invalid bash. My checker was wrong, not the script.

**Fix:** `zsh -n babysit.sh`.

**Lesson:** third instance in this project of trusting a verification method
without verifying it — see also `bot.consume()` and `say -v`. Match the checker
to the interpreter.
