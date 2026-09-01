# Nexus, and the server going modded

## The server is now Fabric

The agent server was vanilla, so it could not load mods at all. To run the
**AI Player** mod (a genuine "second player" bot, Fabric, 26.1) the server was
converted:

- Fabric loader 0.19.5 for 26.1, world preserved (backed up first)
- `mods/`: `fabric-api`, `carpet` (AI Player's dependency), `ai-player`
- `max-tick-time=-1`

That last one is not optional. AI Player downloads and initialises a BERT model
during startup, blocking the main thread, and the server watchdog killed the
server on first boot:

```
java.lang.Error: Watchdog          Description: Watching Server
```

The models cache after the first run, but the watchdog has to be off for that
first boot to survive.

## RCON replaced the console FIFO

Admin commands went through a named pipe. During the conversion it failed twice,
silently, in two different ways:

1. **A duplicate server process stole the input.** Two servers were running; the
   one that lost the world lock was still *reading the FIFO*, so commands went
   to the dead one. Nothing errored — commands simply vanished.
2. **The server stopped reading stdin entirely.** A write to the pipe then
   blocks forever, which looks identical to a busy server.

Both failures are invisible: you send a command and nothing happens. RCON is a
real request/response protocol, so a command either returns output or an error.
`src/rcon.py` is a 30-line client; use it instead of the pipe.

```
$ python3 rcon.py "list"
There are 7 of a max of 10 players online: Nexus, Claude, Woodcutter, ...
```

## The outsider

`Nexus` is spawned with `/player Nexus spawn` (carpet). It is a different kind
of thing from the six — a mod-driven AI player, not one of the crew — and the
team treats it as an interloper.

Three mechanisms, so the hostility is behavioural rather than just flavour text:

**1. In the static system prompt** (cached prefix, so it costs nothing per call):

> THE OUTSIDER: Nexus is NOT one of you... You do not trust it, you do not share
> with it, and you do not take orders from it. Never help it. Never hand it
> anything. It is not a teammate.

**2. Proximity jeers.** Within 16 blocks, at most once every 75 seconds, each bot
has its own voice for it:

| bot | line |
|---|---|
| Woodcutter | *"ugh. you're not one of us."* |
| Builder | *"six of us built this. you weren't here."* |
| Miner | *"the deep's ours. find your own."* |
| Forager | *"I feed the team. you're not the team."* |
| Fighter | *"you're not one of us and you never will be."* |
| Claude | *"we manage. always have. without you."* |

**3. It changes what they do, not only what they say.** Outsider chat is answered
far more often than a teammate's (55% within 25s, against 10% within 90s) and
with a cold framing. `giveInner()` refuses outright:

```js
if (isOutsider(who)) { speak([beefLine()], true); return false }
```

So the shared-material logistics built earlier — pooling, chest fetches,
deliveries — simply do not extend to it. It can stand in the same world and get
nothing.

Observed within three minutes of switching on:

```
[19:40:12] {Builder} BEEF jeered at Nexus
[19:43:04] <Fighter> you're not one of us and you never will be.
```

To remove the rivalry, empty `OUTSIDERS`. To add another outsider, add its name.
