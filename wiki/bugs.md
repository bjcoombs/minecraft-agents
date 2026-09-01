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

---

## Nobody could build the portal because every bot checked only its own pockets

**Symptom:** the team sat on the `nether` stage for hours, all six looping:

```
{Claude}     PORTAL aborted: only 1 obsidian
{Forager}    PORTAL aborted: only 0 obsidian
{Woodcutter} PORTAL aborted: only 2 obsidian
```

**Cause 1 — no pooling.** `buildPortal()` tested `count('obsidian') < 10`, which
is the *caller's* inventory. `teamCount()` already existed and already knew the
team total; nothing connected the two. Even with 10 obsidian spread two-per-bot,
no one would ever build the portal.

**Cause 2 — `teamCount` silently excluded Fighter.** It iterated a hardcoded
`['Claude','Woodcutter','Builder','Miner','Forager']`, so anything the Fighter
carried was invisible to every quest check. Now iterates `BOTS`.

**Fix:** `poolItems(names, qty, label)` — read every teammate's state file, find
holders, append `give <me> <item> <n>` to their command files, then wait for
delivery and re-check. Failure now reports the honest reason
(`team has 3/10 - not enough to gather`) instead of six bots each blaming their
own empty pockets.

---

## A completed stage stops anyone from ever gathering its material again

**Symptom:** `PORTAL aborted` forever, with nobody mining obsidian.

**Cause:** the `obsidian` stage completed legitimately (17 blocks at 18:20). The
material was later spent or lost. Because the stage was marked done, no code
path would ever task anyone with obsidian again — but the *next* stage needs 10
of it for a portal. A one-way stage counter cannot express "this material is
consumed downstream".

**Fix:** a failed portal now calls `getObsidianInner(10)` itself rather than
logging and returning. Make the failure actionable at the point of failure.

---

## Obsidian does not exist where the bots were looking

**Symptom:** `OBSIDIAN only 0 found; none nearby`, repeatedly, at y=117.

**Cause:** `getObsidian` searched 64 blocks from wherever the bot stood, and the
bots were on the surface. Obsidian forms where water met lava — deep. The search
would never succeed however long it ran.

**Fix:** descend (`mineDeep(-20)`) before giving up, and widen the search to 128
blocks. Bots now reach y=-54 and do find obsidian.

---

## Reinstating the lava routine, with the failure designed out

The original water-on-lava routine was **deleted** after 7 deaths and 0 blocks
(above). It was reinstated only because natural obsidian proved too scarce to
finish the portal — the team found 5 in an hour at depth.

The difference is that the old routine's failure mode is now structurally
prevented rather than retried: never stand adjacent to lava or at its level;
pour from a block above and diagonally away; confirm obsidian formed before
approaching; dig through `digBlockCarefully`; abort on any health loss.

**Measured:** across the monitoring window it caused **zero** lava deaths. The
deaths that did occur (zombies, creepers, a fall) are the ordinary cost of
mining at y=-54 with `keep_inventory` on. The single "tried to swim in lava"
predates the routine.

**Still not working, honestly:** five of six bots hold *empty* buckets, so they
log `LAVAOBS no water bucket` and skip. The one bot with water gets its
pathfinding interrupted mid-approach. The team remains at 5/10.

---

## `digBlockCarefully` — the documented remedy, applied

"Digging aborts on long mines" was recorded above but the obsidian loop still
went straight from `pathfinder.goto()` to `bot.dig()`, producing **1587**
`goal was changed` errors in seven minutes. Routing both obsidian dig loops
through a helper that approaches once, clears the goal, stops all movement,
verifies range and re-checks the block halved that to 762.

Halved, not eliminated — something still issues goals during long operations.
`locked` is honoured by the work cycle, follow loop, stuck watchdog and deadlock
watchdog, and `escapeHazard` only fires when already *in* lava, so the remaining
thief has not been identified.

---

## The deadlock watchdog was the goal thief all along

**Symptom:** *"The goal was changed before it could be completed!"* — thousands
of them, across fishing, farming, item handovers, sleeping, bucket filling and
every obsidian attempt. Recorded earlier in this file as "uncoordinated
pathfinder goal changes" and blamed on the work cycle and the LLM dispatcher.
Both were innocent.

**Cause:** the deadlock watchdog, added as a *mitigation* for a leaked lock:

```js
else if (Date.now() - busySince > 45000) {   // "45s is plenty for any single task"
  busy = false; locked = false; ...
  try { bot.pathfinder.setGoal(null) } catch {}
}
```

45 seconds is not plenty. Obsidian takes ~9 seconds **per block**; descending to
y=-20 takes minutes; walking to a lava lake and back takes longer. The watchdog
could not distinguish a deadlocked bot from a working one, so it killed the
pathfinder goal of every legitimately long task, forever. The lock guards added
elsewhere could never help: the thief ran on a timer and cleared the lock itself.

**Fix:** a heartbeat. Long-running loops call `progress()`, which resets the
timer, and the threshold moves to 180s as a backstop:

```js
function progress () { if (busy || locked) busySince = Date.now() }
```

Called from the dig loop, the lava routine, bucket filling, the pooling wait and
the obsidian search.

**Measured over eight minutes, same workload:**

| | before | after |
|---|---|---|
| `DEADLOCK cleared` | 1817 | **1** |
| `goal was changed` | 762 / 7 min | **360 / 8 min** |

Combined with `digBlockCarefully`, the goal-change rate is down from 1587 per
seven minutes to 360 per eight — roughly 4.4x. Obsidian started accumulating
again for the first time in hours.

**Lesson:** a watchdog that cannot tell "slow" from "stuck" will eventually
become the outage. Give long work a way to say it is still alive, rather than
picking a timeout and hoping. And note the shape of the original error: this was
a *mitigation* for a bug that was never found, and the mitigation did far more
damage than the leak it covered.

---

## Team material is invisible once a bot deposits it

**Symptom:** team obsidian read 6, then 0, with no deaths in between and
`keep_inventory` confirmed `true`.

**Cause:** the LLM chose `deposit`:

```
{Woodcutter} LLM say="hey ben, i've got some obsidian over here" action=deposit
```

`teamCount()` and `teamHolders()` read the per-bot `state_*.json` files, which
record **carried** inventory only. Anything banked in a role chest is invisible
to every quest check and to pooling. The team looked like it had nothing while
the material sat in storage — the same shape as the pooling bug above, one level
further out.

**Fix:** `poolItems()` now calls `fetchItem()` (which already searches *all*
registered chests, not just the caller's) and asks every teammate to do the same
before reporting failure.

**Not fully resolved.** After the fix, a `fetch obsidian 16` broadcast to all six
recovered nothing, and a `data get block` query against the two registered chests
returned no data. Only two chests are registered in `depot.json` (Claude and
Woodcutter) though six bots have been depositing, so either most chests were
never recorded or the material is somewhere neither the depot nor carried
inventory knows about. Unresolved.

**Lesson, and it is the third time in this file:** a check that reads one
location — your own pockets, then the team's pockets, then the team's pockets
*and* chests — will keep being wrong until it reads every place the thing can
be. Each fix here moved the boundary out by one, and each time the material was
just outside it.
