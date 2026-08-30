# Monitoring an unattended agent swarm

What to watch, why, and what each signal actually caught. All of these earned
their place by detecting a real failure.

## Three layers

1. **`supervise.sh`** — restarts any agent process that dies. Tracks PID files,
   never `ps | grep` (see `wiki/architecture.md` for why that failed).
2. **`babysit.sh`** — every 60 s, checks server, Ollama, agent liveness, health,
   hunger and CPU. Applies remedies without asking.
3. **A periodic review** — reads the logs and state, spots trends the per-tick
   checks cannot.

## Signals worth watching

| Signal | Threshold | What it caught |
|---|---|---|
| **Per-agent CPU** | > 70 % | A retry loop with no backoff pinned two cores; load hit 22.4 on 10 cores |
| **Load average** | > 18 | Sustained thrash even when no single agent is hot |
| **State file age** | > 30 s stale | Agent disconnected but process alive |
| **Health / hunger** | hp < 8, food < 6 | Agents starving because `consume()` silently failed |
| **Deaths** | any increase | 19 diamonds destroyed before `keep_inventory` was on |
| **Stuck events** | rate, not total | 209 events, 123 false positives from a bad detector |
| **Deadlocks** | any | A leaked lock idles an agent indefinitely |
| **LLM errors** | rate | Ollama saturation, model thrashing |
| **Quest progress** | stalled 2+ checks | The signal that something upstream is broken |

## Watch rates, not totals

Totals only ever rise, so they stop being informative. The useful question is
always *how many since last time*:

- stuck events **20 per check → 1** after the false-positive fix
- lava deaths **7 per check → 0** after removing the routine causing them

A total of 209 tells you nothing. "20 in the last five minutes, was 1" tells you
something broke just now.

## Remediate automatically where the fix is obvious

The watchdog does not just report:

```sh
if [ "$whole" -ge 70 ]; then
  note "HOT ${name} at ${cpu}% cpu - clearing its goal"
  printf 'stop\n' >> "cmds_${name}.txt"
fi
```

Same for hunger and straying too far — it appends `eat` and `home`. Anything
detectable and safely fixable should be fixed without waiting for a human.

## The periodic review earns its keep

A 5-minute automated review found things no single interactive session would:
the false-positive stuck detector, LLM saturation from 806 calls, the inventory
choke blocking smelting, and a survival check that never ran for one agent
because it had autonomy disabled.

**Its failure mode:** it fires whether or not anyone is watching, and every
firing costs real resources. Cancel it deliberately when work pauses.

## Instrument before theorising

Every hard bug here was found by making a failure describe itself:

- `scanned 80 lava blocks, found 0` → useless
- `sample: lava/lvl=0/meta=0/above=cave_air` → bug obvious immediately

The pattern: when something reports finding nothing, log a sample of what it
examined and why each candidate was rejected.

## Check the checker

Three times in this project a verification method gave a false result and I
reported it as fact:

- `bot.consume()` resolves successfully and does nothing
- `say -v <voice> ""` exits 0 for voices that do not exist
- `bash -n` on a `#!/bin/zsh` script reports a syntax error in valid code

A monitoring system built on unverified checks reports confidently and wrongly.
Assert on observable state — did food rise, did the block appear, is the process
alive — never on the absence of an error.
