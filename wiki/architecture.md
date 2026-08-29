# Architecture

Six autonomous agents in one Minecraft world, each an independent Node process
with an LLM brain, persistent memory and a shared objective.

```
Minecraft server (vanilla 26.1, offline-mode, localhost:25566)
        ▲                                    ▲
        │ protocol                           │ console via named pipe (FIFO)
        │                                    │
   6 × bot.js  ──HTTP──▶  Ollama (llama3.1:8b, local)
        │
        ├── state_<Name>.json    published every 1s   (how I observe them)
        ├── cmds_<Name>.txt      polled every 500ms   (how I task them)
        ├── events.log           shared, prefixed {Name}
        └── memory/<Name>/       journal + compiled wiki
```

## Design decisions that held up

**File-based control plane.** Each agent publishes state to JSON and polls a
text file for commands. Crude, but it means the operator (me, or a script) can
observe and steer without any RPC layer, and everything is greppable after the
fact. `events.log` with a `{Name}` prefix made cross-agent debugging tractable.

**Server console over a FIFO.** Keeps the server's stdin open for admin
commands while it runs detached:
```sh
mkfifo console
nohup sh -c 'while true; do sleep 3600; done > console' &
nohup java -jar server.jar nogui < console > server.out &
echo "time set day" > console
```

**Supervisor tracks PIDs, not command lines.** The first version grepped `ps`
for `BOT_NAME=X node bot.js`. The env var does not appear in the command line,
so the check never matched, and it launched duplicates endlessly — each new
login kicking the previous one:
```
Builder lost connection: You logged in from another location
```
119 kicks before this was spotted. PID files fixed it.

**Long-running work must be the background task itself.** The harness kills a
background command's children when the command exits. A script that starts
workers and returns kills them. The supervisor loop has to *be* the
long-running process.

## Agent loop

```
every 12s: workCycle()
  ├─ survival first: eat if hurt or hungry, return home if too far
  ├─ if locked/busy/fleeing/following → skip
  └─ role behaviour (mine, chop, build, patrol, quest stage)

on chat:   LLM decides {say, action} → dispatch, unless busy
on hurt:   fight back, or flee if the mob is unwinnable
every 1s:  hazard check (lava, drowning)
every 5s:  deadlock watchdog
at night:  go to bed, then compile the day's journal into the wiki
```

**Survival checks must run for every agent**, including ones with autonomy off.
The "director" had `auto = false`, which skipped the whole cycle — so it never
ate and never came home, and drifted 125 m away. Survival is not part of the
work loop; it precedes it.

## Concurrency lessons

The single biggest source of bugs was **uncoordinated goal changes**. Five
different subsystems could issue a pathfinder goal: the work cycle, the LLM
dispatcher, the follow loop, the stuck watchdog and the hazard escape. Any of
them firing mid-task produced:

```
The goal was changed before it could be completed!
```

This killed fishing, farming, sleeping, item handovers and obsidian mining —
each of which I initially debugged as a separate problem. They were one problem.

A single `locked` flag respected by every subsystem fixed most of it. The
remaining leak is mitigated by a watchdog rather than solved (see `bugs.md`).

**Deadlock watchdog is mandatory** for anything unattended:
```js
if (busy || locked) {
  if (Date.now() - busySince > 45000) { /* clear every flag, drop goals */ }
}
```
Without it, one stuck lock idles an agent forever. With it, the cost is bounded
at 45 seconds and the run continues.
