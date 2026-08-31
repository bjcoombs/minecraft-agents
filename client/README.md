# Client setups

Two isolated profiles. They must not share a `mods` directory — one is Fabric,
the other NeoForge, and mixing them fails at load.

## `26.1 + Sodium` — the world the agents play in

Minecraft 26.1, Fabric loader 0.19.5, mods in the default
`~/Library/Application Support/minecraft/mods`:

| mod | purpose |
|---|---|
| fabric-api | required by the rest |
| fabric-language-kotlin | required by Zoomify |
| sodium 0.8.9 | rendering performance |
| sodium-fullbright 1.2.0 | full brightness |
| yet_another_config_lib_v3 | config UI for Zoomify |
| zoomify 2.16.1 | zoom |

## `Create 1.21.1` — Create and its addons

**Create does not exist for 26.1.** Verified against Modrinth: `create` is
Forge/NeoForge to 1.21.1, `create-fabric` stops at 1.20.1, `create-aeronautics`
is NeoForge only. 1.21.1 NeoForge is the only version where Create and Create
Aeronautics coexist, so this is a separate profile and a **separate world** —
Create is `server_side: required` and the agent server is 26.1, so the six bots
cannot join it.

- Minecraft 1.21.1, NeoForge 21.1.249
- `gameDir` = `~/minecraft-create` (isolated from the Fabric mods above)
- `-Xmx6G` — Create stutters on the 2GB default

Mods: Create 6.0.10, Create Aeronautics 1.3.2 (bundled), Create Coasters 2.0,
Sodium (NeoForge), Just Zoom, Full Brightness Toggle, plus the dependencies
below. Exact versions in `create-1211-mods.json`.

### It crashed first time: trust the jar, not the registry

Modrinth's API reported Create's required dependencies as **none**. That is the
registry's metadata, not the mod's. The jars' own `mods.toml` files declared
three mandatory dependencies that were missing, and the client crashed on
launch with mod-loading failures:

```
Mod justzoom requires konkrete 1.9.0 or above     - not installed
Mod aeronautics requires sable 2.0.0 or above     - not installed
Mod fullbrightnesstoggle requires collective 8.5  - not installed
```

Three of those came from mods **nested inside** Create Aeronautics' jarjar
archives (`aeronautics`, `offroad`, `simulated`), which no top-level dependency
listing shows.

**Pre-flight check that would have caught it**, and which now lives in this
repo's history — extract every `mods.toml` including nested jarjar entries,
collect provided `modId`s, and diff against mandatory dependencies:

```
mods present   : 9
modIds provided: 34
required ids   : 11
all mandatory dependencies satisfied
```

Do that before launching, rather than launching to find out.

## Performance note

Running the Create client *and* the 26.1 agent server *and* six bots *and* a
27B model resident on the GPU puts this machine at load ~16 on 10 cores. The
agent stack and the Create world are unrelated — pause the agents while playing
Create (`pkill -f babysit.sh; pkill -f supervise.sh; pkill -f "node bot.js"`)
or run the agents on `mistral-nemo:12b`, which is 7GB and 0.43s per decision
against qwen3.8's 17GB and 2.45s.
