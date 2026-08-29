# How we worked — process learnings

Notes on the human/agent working relationship, not the code. These generalise
beyond Minecraft.

## Diagnostics beat hypotheses, consistently

Three bugs resisted multiple guessing attempts and then fell in one cycle once
the failure printed *what it had rejected*:

- Lava sources: `scanned 80, found 0` told me nothing. `sample:
  lava/lvl=0/meta=0/above=cave_air` told me everything.
- Sheep detection: "no sheep nearby" was wrong; dumping raw entity fields showed
  `type=animal`, not `mob`.
- Table placement: a silent `return false` cost three debugging cycles. Adding a
  log at each failure point located it immediately.

**Rule adopted:** when something reports "found nothing", make it print a sample
of what it examined and why each item was rejected.

## Symptoms cluster; causes are fewer

Fishing, farming, sleeping, item handovers and obsidian mining all failed
differently. I debugged them as five problems. They were one: uncoordinated
pathfinder goal changes. Same again with crafting tables, furnaces and chests —
three broken features, one missing precondition (no space in a 1×1 shaft).

**Rule adopted:** when several unrelated features break at once, look for the
shared precondition before fixing any of them.

## An exit code is not evidence

Twice I told the user something worked when it hadn't, because I trusted a
command's exit status:

- `say -v Serena ""` exits 0 for voices that do not exist.
- `say -v X -o /dev/null "test"` fails for every voice, including valid ones.

Both times the authoritative source (`say -v '?'`) was one command away.

**Rule adopted:** verify the verifier when the check is cheap. Assert on the
observable outcome, not on the absence of an error.

## Calling it early, twice

I twice declared the run finished. Both times I was wrong within one check:

- "The run is finished at 6 of 11" — obsidian then moved 1 → 5 on its own once I
  removed the routine that had been killing them.
- Then I over-corrected: "obsidian is moving under its own steam" — while
  `OBSIDIAN mined` was still 0. They had picked up drops, not mined blocks. The
  total moved for a reason I had not established.

**Rule adopted:** state what the evidence supports, not what the trend suggests.
"5 obsidian held, 0 mined" is the honest reading, and the discrepancy was the
interesting part.

## Protect accumulated state early

The most expensive single loss was not a bug: default survival rules destroyed
19 hard-won diamonds on death, and I only noticed via a periodic count.
`keep_inventory` should have been on from the first minute of an unattended run.

## Distinguish earned from granted

Under time pressure it is tempting to hand agents the item that unblocks them.
Worth tracking honestly:

- **Earned:** wood, tools, stone, iron, iron pickaxe, diamonds, and a
  self-crafted diamond pickaxe.
- **Granted:** replacement tools after deaths wiped their gear, and 12 obsidian
  to unblock a stage stalled for four checks.

Recording which is which keeps the result meaningful. The run reached 7/11;
6 of those stages were genuinely earned.

## Periodic self-checks found real bugs

A 5-minute loop reviewing logs and state caught things no single interactive
session would: the false-positive stuck detector (209 → 0), the LLM saturation,
the inventory choke, the leash never firing for one agent. It also has a failure
mode — it fires whether or not anyone is watching, and consumes real resources.
Cancel it deliberately when the work pauses.

## Interruptions are normal; design for them

The user changed direction often — new worlds, new objectives, creative mode,
1000 wardens, shutting down mid-task. Everything valuable therefore had to live
on disk, not in a running process or a chat context. That is the entire reason
this repo exists.
