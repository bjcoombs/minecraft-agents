const fs = require('fs')
const path = require('path')
const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')

const DIR = __dirname
const NAME = process.env.BOT_NAME || 'Claude'
const CMDS = path.join(DIR, `cmds_${NAME}.txt`)
const ALL  = path.join(DIR, 'cmds_all.txt')
const STATE = path.join(DIR, `state_${NAME}.json`)
const EVENTS = path.join(DIR, 'events.log')

if (!fs.existsSync(CMDS)) fs.writeFileSync(CMDS, '')
if (!fs.existsSync(ALL)) fs.writeFileSync(ALL, '')
let cmdOffset = fs.statSync(CMDS).size
let allOffset = fs.statSync(ALL).size

function log (line) {
  const stamp = new Date().toTimeString().slice(0, 8)
  fs.appendFileSync(EVENTS, `[${stamp}] {${NAME}} ${line}\n`)
}

const bot = mineflayer.createBot({
  host: '127.0.0.1', port: 25566, username: NAME, version: '26.1', auth: 'offline'
})
bot.loadPlugin(pathfinder)

let follow = null
let busy = false

const LOGS = ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log']

bot.once('spawn', () => {
  const mv = new Movements(bot)
  mv.canDig = true
  mv.maxDropDown = 3             // don't leap into pits it can't climb out of
  mv.allowSprinting = true
  mv.allowParkour = true         // step over gaps instead of getting boxed in
  mv.dontCreateFlow = true
  mv.allow1by1towers = false     // stop it pillaring itself into the air
  bot.pathfinder.setMovements(mv)
  bot.pathfinder.thinkTimeout = 3000      // ms per search, default is much higher
  bot.pathfinder.tickTimeout = 20         // ms of CPU per tick
  bot.pathfinder.searchRadius = 96        // do not scan the whole world
  const sp = bot.entity.position.floored()
  HOME.x = sp.x; HOME.y = sp.y; HOME.z = sp.z
  log(`spawned, home set to ${HOME.x},${HOME.y},${HOME.z}`)
  setTimeout(() => catchphrase().catch(e => log('cp: ' + e.message)), 2000 + Math.random() * 6000)
})

bot.on('chat', (u, m) => {
  if (u === bot.username) return
  log(`CHAT <${u}> ${m}`)
  if (NAME === 'Claude' && !BOTS.includes(u)) logChat(u, m)   // only the human; bots log themselves in speak()
  const isBot = ['Woodcutter','Builder','Miner','Forager','Claude'].includes(u)
  if (USE_LLM) {
    history.push(`${u}: ${m}`)
    if (isBot) {
      // only sometimes answer another bot, and never rapidly - stops chat loops
      if (Date.now() - lastLlmReply < 90000) return
      if (Math.random() > 0.10) return
      lastLlmReply = Date.now()
      think(`Your teammate ${u} said: "${m}". Reply briefly if it is useful, otherwise say nothing (empty say).`)
    } else {
      lastLlmReply = Date.now()
      think(`Ben just said: "${m}". Respond and pick an action.`)
    }
    return
  }
  if (isBot) return
  const t = m.toLowerCase()
  if (/^(hi|hey|hello|yo)\b/.test(t)) speak(SAY.greet)
  else if (t.includes('what are you doing')) speak([busy ? 'bit busy chopping' : 'nothing much, what do you need?'])
  else if (t.includes('wood') || t.includes('logs') || t.includes('stock') || t.includes('how much')) {
    const n = totalLogs(), p = count('oak_planks') + count('birch_planks')
    if (n || p) speak([`carrying ${n} logs and ${p} planks`])
    else speak(['nothing on me - it is all in my chest'])
  }
  else if (/^(deposit|store|stash|drop off|put it away)/.test(t)) {
    if (!busy) { depositAll().catch(e => log('deposit chat: ' + e.message)) }
    else speak(['will do once I finish this'])
  }
  else if (t.includes('follow')) { follow = u; speak(['right behind you']) }
  else if (t.includes('stop')) { follow = null; bot.pathfinder.setGoal(null); speak(['ok, stopping']) }
})
bot.on('playerJoined', p => {
  if (p.username === bot.username) return
  log(`JOIN ${p.username}`)
  if (!p.username.startsWith('Claude')) setTimeout(() => speak(SAY.greet), 2000 + Math.random()*3000)
})
bot.on('playerLeft', p => log(`LEFT ${p.username}`))
// the server broadcasts the cause ("Miner was slain by Zombie"); the death
// event itself does not carry it, so capture the message and pair them up
let lastDeathMsg = ''
bot.on('messagestr', (m) => {
  try {
    if (typeof m === 'string' && m.startsWith(NAME + ' ') &&
        /(slain|blown up|burned|fell|tried to swim|drowned|suffocat|shot|pricked|squashed|walked into)/i.test(m)) {
      lastDeathMsg = m
      learnFromDeath(m)
    }
  } catch {}
})
bot.on('death', () => { log('DIED' + (lastDeathMsg ? ': ' + lastDeathMsg : '')); journal('I died' + (lastDeathMsg ? ' - ' + lastDeathMsg : '')); recordEvent({ type: 'died', cause: lastDeathMsg }); learnFromDeath(lastDeathMsg); lastDeathMsg = ''; if (USE_LLM) combatShout('death', 'losing').catch(()=>{}); else speak(SAY.died, true) })
let lastHp = 20
bot.on('health', () => {

  lastHp = bot.health
})
bot.on('kicked', r => {
  log(`KICKED ${r} - exiting so the supervisor restarts me`)
  setTimeout(() => process.exit(0), 1000)
})
bot.on('error', e => log(`ERROR ${e.message}`))
bot.on('end', (reason) => {
  log(`DISCONNECTED (${reason || 'no reason'}) - exiting so the supervisor restarts me`)
  setTimeout(() => process.exit(0), 1000)
})

function count (name) {
  return bot.inventory.items().filter(i => i.name === name)
    .reduce((n, i) => n + i.count, 0)
}
function totalLogs () { return LOGS.reduce((n, l) => n + count(l), 0) }

function writeState () {
  if (!bot.entity) return
  const p = bot.entity.position
  fs.writeFileSync(STATE, JSON.stringify({
    time: new Date().toTimeString().slice(0, 8),
    pos: p.floored(), health: bot.health, food: bot.food, busy,
    logs: totalLogs(), planks: count('oak_planks'),
    inventory: bot.inventory.items().map(i => `${i.name} x${i.count}`),
    playersOnline: Object.values(bot.players)
      .filter(x => x.username !== bot.username && x.entity)
      .map(x => ({ name: x.username, pos: x.entity.position.floored(),
        distance: +x.entity.position.distanceTo(p).toFixed(1) }))
  }, null, 2))
}
setInterval(writeState, 1000)

setInterval(() => {
  if (!follow || busy || goingToBed || locked) return
  const t = bot.players[follow] && bot.players[follow].entity
  if (t) bot.pathfinder.setGoal(new goals.GoalFollow(t, 3), true)
}, 2000)



// ---------- talk like a person, not a status printer ------------------
const PERSONA = {
  Claude:     { open: "right, I'm with you. what are we doing?", quirk: 'planner' },
  Woodcutter: { open: "trees. that's my whole thing", quirk: 'blunt' },
  Builder:    { open: "ooh, I do like a nice build", quirk: 'enthusiast' },
  Miner:      { open: "I'll be underground if you need me", quirk: 'gruff' },
  Forager:    { open: "hello! I'll sort the food out", quirk: 'chatty' },
  Fighter:    { open: "point me at something and stand back", quirk: 'brawler' }
}
const me = PERSONA[NAME] || PERSONA.Claude
const STYLES = {
  Claude:     { wall: 'oak_planks',   base: 'stone_bricks',   post: 'oak_log',     roof: 'oak_stairs' },
  Woodcutter: { wall: 'spruce_planks',base: 'cobblestone',    post: 'spruce_log',  roof: 'spruce_stairs' },
  Builder:    { wall: 'stone_bricks', base: 'deepslate_tiles',post: 'chiseled_stone_bricks', roof: 'stone_brick_stairs' },
  Miner:      { wall: 'cobblestone',  base: 'stone',          post: 'stone_bricks',roof: 'cobblestone_stairs' },
  Forager:    { wall: 'birch_planks', base: 'sandstone',      post: 'birch_log',   roof: 'birch_stairs' },
  Fighter:    { wall: 'polished_blackstone', base: 'blackstone', post: 'polished_blackstone_bricks', roof: 'polished_blackstone_stairs' }
}
const STYLE = STYLES[NAME] || STYLES.Claude
const pick = a => a[Math.floor(Math.random() * a.length)]
let lastSpoke = 0
function speak (lines, force) {
  const now = Date.now()
  const text = typeof lines === 'string' ? lines : null
  // on AI bots, let the model do the talking - suppress canned lines
  if (typeof USE_LLM !== 'undefined' && USE_LLM && !force) return
  if (!force && now - lastSpoke < 6000) return   // don't spam the chat
  const out = typeof lines === 'string' ? lines : pick(lines)
  if (tooSimilar(out)) { log(`SKIP repeat: ${out}`); return }
  lastSpoke = now
  rememberSaid(out)
  logChat(NAME, out)
  bot.chat(out)
}

const SAY = {
  startChop: ["going to find some trees", "need wood. back in a bit",
              "right, wood run", "off to punch some trees"],
  gotWood:  ["that'll do for now", "got a decent stack", "arms hurt. worth it",
             "plenty of wood now"],
  noTrees:  ["can't see any trees from here", "hmm, no trees nearby",
             "this bit's a bit bare"],
  madeTool: ["much better with a proper tool", "that's the one",
             "should be quicker now"],
  hurt:     ["ow", "that hurt", "ouch, careful"],
  died:     ["well that went badly", "oops", "right, back again"],
  greet:    ["hey Ben", "alright?", "hello!", "there you are"],
  building: ["starting on the walls", "let's get this up", "right, building time"]
}

const AXES = ['netherite_axe','diamond_axe','iron_axe','stone_axe','golden_axe','wooden_axe']
const PICKS = ['netherite_pickaxe','diamond_pickaxe','iron_pickaxe','stone_pickaxe','wooden_pickaxe']
async function equipBestPick () {
  for (const p of PICKS) {
    const it = bot.inventory.items().find(i => i.name === p)
    if (it) { try { await bot.equip(it, 'hand') } catch {} ; return p }
  }
  return null
}
async function equipBestAxe () {
  for (const a of AXES) {
    const it = bot.inventory.items().find(i => i.name === a)
    if (it) { try { await bot.equip(it, 'hand') } catch {} ; return a }
  }
  return null
}

async function craftItem (name, n, table) {
  const it = bot.registry.itemsByName[name]
  if (!it) return false
  // a table recipe needs us standing at it and looking at it, or the window never opens
  if (table) {
    const fresh = bot.blockAt(table.position)
    if (!fresh || fresh.name !== 'crafting_table') { log(`craft ${name}: table gone`); return false }
    table = fresh
    try {
      if (bot.entity.position.distanceTo(table.position) > 3) {
        await bot.pathfinder.goto(new goals.GoalNear(table.position.x, table.position.y, table.position.z, 2))
      }
      await bot.lookAt(table.position.offset(0.5, 0.5, 0.5), true)
      await bot.waitForTicks(4)
    } catch (e) { log(`craft ${name}: approach ${e.message}`) }
  }
  const r = bot.recipesFor(it.id, null, 1, table)[0]
  if (!r) { log(`no recipe available for ${name}`); return false }
  try { await bot.craft(r, n, table); log(`crafted ${n}x ${name}`); return true }
  catch (e) { log(`craft ${name} failed: ${e.message}`); return false }
}

async function makeAxe () {
  busy = true
  try {
    if (totalLogs() < 3) { log('AXE need logs first'); await chopInner(6) }
    await makePlanksInner()
    if (count('oak_planks') < 5) { log('AXE not enough planks'); busy=false; return }
    await craftItem('stick', 2, null)

    // crafting table
    if (!count('crafting_table')) await craftItem('crafting_table', 1, null)
    const ctItem = bot.inventory.items().find(i => i.name === 'crafting_table')
    let table = bot.findBlock({ matching: bot.registry.blocksByName.crafting_table.id, maxDistance: 8 })
    if (!table && ctItem) {
      const base = bot.entity.position.floored().offset(1, -1, 0)
      const ref = bot.blockAt(base)
      if (ref && ref.name !== 'air') {
        try { await bot.equip(ctItem,'hand'); await bot.placeBlock(ref, new Vec3(0,1,0)) } catch (e) { log('place table: '+e.message) }
      }
      table = bot.findBlock({ matching: bot.registry.blocksByName.crafting_table.id, maxDistance: 8 })
    }
    if (!table) { log('AXE no crafting table placed'); busy=false; return }
    await bot.pathfinder.goto(new goals.GoalNear(table.position.x, table.position.y, table.position.z, 2))

    // you cannot mine stone without a pickaxe - make one first
    if (!PICKS.some(p => count(p))) {
      await craftItem('wooden_pickaxe', 1, table)
      speak(['made a pickaxe - stone needs one'])
    }
    if (count('cobblestone') < 3) {
      await equipBestPick()
      const stoneIds = ['stone','andesite','diorite','granite','cobblestone']
        .map(n=>bot.registry.blocksByName[n]).filter(Boolean).map(b=>b.id)
      const spots = bot.findBlocks({ matching: stoneIds, maxDistance: 32, count: 12 })
      for (const p of spots) {
        if (count('cobblestone') >= 3) break
        try {
          await bot.pathfinder.goto(new goals.GoalNear(p.x,p.y,p.z,2))
          await equipBestPick()
          await bot.dig(bot.blockAt(p)); await bot.waitForTicks(12)
        } catch (e) { log('mine skip: '+e.message) }
      }
    }
    const t2 = bot.findBlock({ matching: bot.registry.blocksByName.crafting_table.id, maxDistance: 12 })
    if (t2) await bot.pathfinder.goto(new goals.GoalNear(t2.position.x,t2.position.y,t2.position.z,2))
    if (count('cobblestone') >= 3) {
      await craftItem('stone_axe', 1, t2)
      if (count('cobblestone') >= 3) await craftItem('stone_pickaxe', 1, t2)
    }
    else await craftItem('wooden_axe', 1, t2)
    const got = await equipBestAxe()
    speak(got ? SAY.madeTool : ['no luck making an axe'])
  } catch (e) { log('AXE error: '+e.message) }
  busy = false
}




// ---------- make sure we hold the right tool --------------------------
async function ensureTool (kind) {
  const have = kind === 'pick' ? PICKS.some(p => count(p)) : AXES.some(a => count(a))
  if (have) { kind === 'pick' ? await equipBestPick() : await equipBestAxe(); return true }
  speak([`no ${kind === 'pick' ? 'pickaxe' : 'axe'} - making one first`])
  log(`TOOL missing ${kind}, crafting`)
  // wood -> planks -> sticks -> table -> tool
  if (totalLogs() < 3 && count('oak_planks') < 6) await chopInner(6)
  await makePlanksInner()
  if (!count('stick')) await craftItem('stick', 2, null)
  let table = bot.findBlock({ matching: bot.registry.blocksByName.crafting_table.id, maxDistance: 16 })
  if (!table) {
    if (!count('crafting_table')) await craftItem('crafting_table', 1, null)
    const it = bot.inventory.items().find(i => i.name === 'crafting_table')
    if (it) {
      const p = bot.entity.position.floored()
      for (const off of [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]]) {
        const spot = p.offset(off[0],0,off[2])
        const at = bot.blockAt(spot), under = bot.blockAt(spot.offset(0,-1,0))
        if (!at || at.name !== 'air' || !under || under.name === 'air') continue
        try { await bot.equip(it,'hand'); await bot.placeBlock(under, new Vec3(0,1,0)); break } catch {}
      }
    }
    table = bot.findBlock({ matching: bot.registry.blocksByName.crafting_table.id, maxDistance: 16 })
  }
  if (!table) { speak(['cannot make a tool without a table']); return false }
  try { await bot.pathfinder.goto(new goals.GoalNear(table.position.x, table.position.y, table.position.z, 2)) } catch {}
  const wooden = kind === 'pick' ? 'wooden_pickaxe' : 'wooden_axe'
  const stone  = kind === 'pick' ? 'stone_pickaxe' : 'stone_axe'
  if (count('cobblestone') >= 3) await craftItem(stone, 1, table)
  if (!(kind === 'pick' ? PICKS.some(p=>count(p)) : AXES.some(a=>count(a)))) await craftItem(wooden, 1, table)
  const ok = kind === 'pick' ? await equipBestPick() : await equipBestAxe()
  if (ok) speak([`right, got a ${ok.replace('_',' ')}`])
  return !!ok
}










// ---------- invent a catchphrase on joining -----------------------------
async function catchphrase () {
  if (!USE_LLM) { speak(me.open, true); return }
  const lessons = readPage('lessons').slice(0, 400)
  const prompt = `You are ${NAME}, the ${ROLE} on a Minecraft team trying to beat the game.
You have just joined the world. Say ONE short catchphrase - your own words, under 12 words.
Make it sound like a person, lowercase is fine. Do not mention being an AI.
Give it some personality that fits being the ${ROLE}.
${lessons ? 'Things you have learned before:\n' + lessons : ''}
Reply ONLY with JSON: {"say":"<your catchphrase>"}`
  try {
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), 20000)
    let res
    try {
      res = await fetch(LLM_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ac.signal,
        body: JSON.stringify({ model: LLM_MODEL, prompt, stream: false, format: 'json',
          keep_alive: '30m', think: false, options: { num_predict: 60, temperature: 1.0, num_ctx: 4096 } })
      })
    } finally { clearTimeout(t) }
    const data = await res.json()
    const out = JSON.parse(data.response)
    if (out.say && out.say.trim()) {
      speak(out.say.trim(), true)
      log(`CATCHPHRASE "${out.say.trim()}"`)
      journal(`joined saying: ${out.say.trim()}`)
      return
    }
  } catch (e) { log('catchphrase: ' + e.message) }
  speak(me.open, true)          // fall back to the scripted line
}

// ---------- keep inventory space free ------------------------------------
const NEVER_DUMP = ['obsidian','diamond','iron_ingot','raw_iron','coal','ender_pearl','blaze_rod']
const JUNK = ['cobblestone','dirt','andesite','diorite','granite','tuff','deepslate',
              'cobbled_deepslate','gravel','netherrack','sand','stone','rotten_flesh',
              'cobblestone_slab','flint','clay_ball','moss_block','calcite']
async function dumpJunk (keepEach) {
  const keep = keepEach === undefined ? 4 : keepEach
  const used = bot.inventory.items().length
  if (used < 18) return 0                     // only act when it is genuinely filling up
  let dropped = 0
  for (const name of JUNK) {
    if (NEVER_DUMP.includes(name)) continue
    const stacks = bot.inventory.items().filter(i => i.name === name)
    let total = stacks.reduce((n,i)=>n+i.count,0)
    for (const st of stacks) {
      if (total <= keep) break
      const toss = Math.min(st.count, total - keep)
      try { await bot.toss(st.type, null, toss); total -= toss; dropped += toss }
      catch (e) { log('toss: ' + e.message) }
    }
  }
  if (dropped) log(`INVENTORY dumped ${dropped} junk blocks (${used} slots used)`)
  return dropped
}

// ---------- smelting: raw ore -> ingots ---------------------------------
async function placeNear (itemName) {
  const it = bot.inventory.items().find(i => i.name === itemName)
  if (!it) return null
  const p = bot.entity.position.floored()
  for (const off of [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[2,0,0],[0,0,2],[-2,0,0],[0,0,-2]]) {
    const spot = p.offset(off[0], 0, off[2])
    const at = bot.blockAt(spot), under = bot.blockAt(spot.offset(0,-1,0))
    if (!at || at.name !== 'air') continue
    if (!under || under.name === 'air' || under.name.includes('water') || under.name.includes('lava')) continue
    try {
      await bot.equip(it, 'hand')
      await bot.lookAt(spot.offset(0.5, 0, 0.5), true)
      await bot.placeBlock(under, new Vec3(0, 1, 0))
      await bot.waitForTicks(6)
      const placed = bot.blockAt(spot)
      if (placed && placed.name === itemName) { log(`placed ${itemName} at ${spot.x},${spot.y},${spot.z}`); return placed }
    } catch (e) { log(`place ${itemName}: ${e.message}`) }
  }
  // no room - we are probably in a 1x1 shaft. Carve an alcove and retry.
  log(`place ${itemName}: no space, digging an alcove`)
  try {
    const pick = bot.inventory.items().find(i => i.name.includes('pickaxe'))
    if (pick) await bot.equip(pick, 'hand')
    for (const off of [[1,0,0],[1,1,0],[-1,0,0],[-1,1,0],[0,0,1],[0,1,1]]) {
      const b = bot.blockAt(p.offset(off[0], off[1], off[2]))
      if (b && b.name !== 'air' && b.name !== 'bedrock' &&
          !b.name.includes('lava') && !b.name.includes('water')) {
        try { await bot.dig(b) } catch {}
      }
    }
    await bot.waitForTicks(8)
  } catch (e) { log('alcove: ' + e.message) }
  // retry placement now there is room
  for (const off of [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]]) {
    const spot = p.offset(off[0], 0, off[2])
    const at = bot.blockAt(spot), under = bot.blockAt(spot.offset(0,-1,0))
    if (!at || at.name !== 'air') continue
    if (!under || under.name === 'air' || under.name.includes('water') || under.name.includes('lava')) continue
    try {
      await bot.equip(it, 'hand')
      await bot.lookAt(spot.offset(0.5, 0, 0.5), true)
      await bot.placeBlock(under, new Vec3(0, 1, 0))
      await bot.waitForTicks(6)
      const placed = bot.blockAt(spot)
      if (placed && placed.name === itemName) { log(`placed ${itemName} after digging alcove`); return placed }
    } catch (e) { log(`retry place ${itemName}: ${e.message}`) }
  }
  return null
}

async function smelt () {
  busy = true
  try {
    await dumpJunk(0)
    const raw = count('raw_iron') + count('raw_copper') + count('raw_gold')
    if (!raw) { busy = false; return false }

    // need a furnace
    let furnace = bot.findBlock({ matching: bot.registry.blocksByName.furnace.id, maxDistance: 12 })
    if (!furnace) {
      if (!count('furnace')) {
        if (count('cobblestone') < 8) { speak(['need cobblestone for a furnace'], true); busy = false; return false }
        let table = bot.findBlock({ matching: bot.registry.blocksByName.crafting_table.id, maxDistance: 12 })
        if (!table) { if (!count('crafting_table')) await craftItem('crafting_table', 1, null); table = await placeNear('crafting_table') }
        if (table) await craftItem('furnace', 1, table)
      }
      furnace = await placeNear('furnace')
    }
    if (!furnace) { speak(['cannot get a furnace down'], true); busy = false; return false }

    // fuel: coal, else planks
    const fuel = bot.inventory.items().find(i => ['coal','charcoal'].includes(i.name))
              || bot.inventory.items().find(i => i.name.endsWith('_planks'))
    const ore = bot.inventory.items().find(i => i.name.startsWith('raw_'))
    if (!fuel) { speak(['no fuel for the furnace'], true); busy = false; return false }

    try {
      await bot.pathfinder.goto(new goals.GoalNear(furnace.position.x, furnace.position.y, furnace.position.z, 2))
      const fn = await bot.openFurnace(bot.blockAt(furnace.position))
      try { const old = await fn.takeOutput(); if (old) log(`SMELT cleared ${old.count} ${old.name} from output`) } catch {}
      await fn.putFuel(fuel.type, null, Math.min(fuel.count, 8))
      await fn.putInput(ore.type, null, Math.min(ore.count, 8))
      speak([`smelting ${Math.min(ore.count,8)} ${ore.name.replace('_',' ')}`], true)
      log(`SMELT started: ${ore.name} x${Math.min(ore.count,8)}`)
      // each item takes ~10s
      for (let i = 0; i < 24; i++) {
        await bot.waitForTicks(40)
        try { const out = fn.outputItem(); if (out && out.count >= Math.min(ore.count,8)) break } catch {}
      }
      try { const got = await fn.takeOutput(); if (got) { log(`SMELT got ${got.count} ${got.name}`); journal(`smelted ${got.count} ${got.name}`) } } catch (e) { log('takeOutput: '+e.message) }
      fn.close()
      speak([`${count('iron_ingot')} iron ingots now`], true)
      busy = false
      return true
    } catch (e) { log('SMELT ' + e.message) }
  } catch (e) { log('SMELT outer ' + e.message) }
  busy = false
  return false
}


// ---------- obsidian: diamond pick + water on lava -----------------------
async function getTable () {
  let t = bot.findBlock({ matching: bot.registry.blocksByName.crafting_table.id, maxDistance: 12 })
  if (t) { log('TABLE found nearby'); return t }
  if (!count('crafting_table')) {
    log('TABLE none held, crafting one')
    await makePlanksInner()
    await craftItem('crafting_table', 1, null)
  }
  if (!count('crafting_table')) { log('TABLE could not craft one'); return null }
  const placed = await placeNear('crafting_table')
  log(placed ? 'TABLE placed ok' : 'TABLE placement FAILED')
  return placed
}

async function makeDiamondPick () {
  if (count('diamond_pickaxe')) return true
  if (count('diamond') < 3) { log('PICK not enough diamonds'); return false }
  const table = await getTable()
  if (!table) { log('PICK no table'); return false }
  if (count('stick') < 2) await craftItem('stick', 2, table)
  await craftItem('diamond_pickaxe', 1, table)
  if (count('diamond_pickaxe')) { speak(['diamond pickaxe made'], true); journal('crafted a diamond pickaxe'); return true }
  return false
}

async function makeBucket () {
  if (count('bucket') || count('water_bucket')) return true
  if (count('iron_ingot') < 3) {
    busy = false; await smelt(); busy = true
  }
  if (count('iron_ingot') < 3) { speak(['need 3 iron for a bucket'], true); return false }
  const table = await getTable()
  if (!table) return false
  await craftItem('bucket', 1, table)
  return count('bucket') > 0
}

async function fillBucket () {
  if (count('water_bucket')) return true
  if (!count('bucket')) return false
  const water = bot.findBlock({ matching: bot.registry.blocksByName.water.id, maxDistance: 48 })
  if (!water) { speak(['no water round here for the bucket'], true); return false }
  try {
    await bot.pathfinder.goto(new goals.GoalNear(water.position.x, water.position.y, water.position.z, 2))
    const b = bot.inventory.items().find(i => i.name === 'bucket')
    await bot.equip(b, 'hand')
    await bot.lookAt(water.position.offset(0.5, 0.5, 0.5), true)
    bot.activateItem()
    await bot.waitForTicks(10)
    bot.deactivateItem()
    await bot.waitForTicks(6)
    if (count('water_bucket')) { log('filled a water bucket'); return true }
  } catch (e) { log('fillBucket: ' + e.message) }
  return false
}


// wiki/bugs.md: "Digging aborts on long mines" - any movement cancels a dig,
// and obsidian takes ~9s. Approach ONCE, drop the goal, stop moving, verify
// range, then dig. Going straight from goto() to dig() produced 1587
// "goal was changed" errors in seven minutes.
async function digBlockCarefully (p, toolName) {
  progress()
  const blk = bot.blockAt(p)
  if (!blk) return false
  try {
    if (bot.entity.position.distanceTo(p) > 4) {
      await bot.pathfinder.goto(new goals.GoalNear(p.x, p.y, p.z, 2))
    }
    bot.pathfinder.setGoal(null)
    bot.clearControlStates()
    await bot.waitForTicks(4)
    if (bot.entity.position.distanceTo(p) > 5) return false   // never got there
    const t = bot.inventory.items().find(i => i.name === toolName)
    if (t) await bot.equip(t, 'hand')
    const fresh = bot.blockAt(p)
    if (!fresh || fresh.name !== blk.name) return false        // someone got it
    await bot.dig(fresh)
    await bot.waitForTicks(6)
    progress()
    return true
  } catch (e) {
    log('dig ' + (blk.name || '?') + ': ' + e.message)
    return false
  }
}


// Making obsidian from lava. wiki/bugs.md records that the ORIGINAL version of
// this caused 7 deaths and 0 blocks and was deleted: the bot stood beside the
// lava source to pour, and kept walking into it.
//
// Natural obsidian turned out to be too scarce to finish the portal (the team
// found 5 in an hour of searching at depth), so this is reinstated - but the
// failure mode is designed out rather than retried:
//   - never stand adjacent to lava, and never at or below its level
//   - pour from a block ABOVE and diagonally away, so the flow runs downhill
//   - confirm obsidian actually formed before approaching it
//   - dig via digBlockCarefully, which stops all movement before digging
//   - bail on any health loss at all
async function makeObsidianFromLava (target) {
  const need = () => (target || 10) - count('obsidian')
  if (need() <= 0) return true
  const waterBucket = () => bot.inventory.items().find(i => i.name === 'water_bucket')
  if (!waterBucket()) { log('LAVAOBS no water bucket'); return false }

  const lavaId = bot.registry.blocksByName.lava && bot.registry.blocksByName.lava.id
  if (!lavaId) return false
  const lavas = bot.findBlocks({ matching: lavaId, maxDistance: 64, count: 40 })
  log(`LAVAOBS ${lavas.length} lava blocks in range, need ${need()} obsidian`)
  let made = 0
  for (const lp of lavas) {
    progress()
    if (need() <= 0) break
    const lava = bot.blockAt(lp)
    if (!lava || lava.metadata !== 0) continue           // source blocks only
    const above = bot.blockAt(lp.offset(0, 1, 0))
    if (!above || !['air','cave_air','void_air'].includes(above.name)) continue

    // a standing spot strictly higher than the lava and not touching it
    let stand = null
    for (const [dx, dz] of [[2,0],[-2,0],[0,2],[0,-2],[2,2],[-2,-2]]) {
      const sp = lp.offset(dx, 1, dz)
      const feet = bot.blockAt(sp), floor = bot.blockAt(sp.offset(0,-1,0))
      if (!feet || !floor) continue
      if (!['air','cave_air'].includes(feet.name)) continue
      if (floor.name === 'lava' || floor.name === 'water' || floor.boundingBox !== 'block') continue
      // nothing molten touching where we will stand
      let safe = true
      for (const [ax,ay,az] of [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,-1,0]]) {
        const n = bot.blockAt(sp.offset(ax,ay,az))
        if (n && n.name === 'lava') { safe = false; break }
      }
      if (safe) { stand = sp; break }
    }
    if (!stand) continue

    const hpBefore = bot.health
    try {
      await bot.pathfinder.goto(new goals.GoalBlock(stand.x, stand.y, stand.z))
      bot.pathfinder.setGoal(null); bot.clearControlStates()
      await bot.waitForTicks(4)
      if (bot.health < hpBefore) { log('LAVAOBS took damage approaching - aborting'); return made > 0 }
      const wb = waterBucket(); if (!wb) break
      await bot.equip(wb, 'hand')
      await safeLookAt(lp.offset(0.5, 1.5, 0.5), true)
      const ref = bot.blockAt(stand.offset(0, -1, 0))
      await bot.placeBlock(ref, new Vec3(0, 1, 0)).catch(() => {})
      await bot.waitForTicks(20)
      const now = bot.blockAt(lp)
      if (now && now.name === 'obsidian') {
        if (await digBlockCarefully(lp, 'diamond_pickaxe')) { made++; log(`LAVAOBS made obsidian (${count('obsidian')})`)
          learnSkill('no obsidian nearby but lava is', 'pour water on a lava source from a block above and diagonally',
                     'obsidian formed and was mined', true, `made ${made} so far`) }
      }
      // take the water back so we can reuse it
      const empty = bot.inventory.items().find(i => i.name === 'bucket')
      const w = bot.findBlocks({ matching: bot.registry.blocksByName.water.id, maxDistance: 4, count: 1 })
      if (empty && w.length) {
        await bot.equip(empty, 'hand').catch(() => {})
        await safeLookAt(w[0], true)
        await bot.activateItem(); await bot.waitForTicks(10); bot.deactivateItem()
      }
    } catch (e) { log('LAVAOBS ' + e.message) }
    if (bot.health < 10) { log('LAVAOBS health low - stopping'); break }
  }
  log(`LAVAOBS made ${made}, now hold ${count('obsidian')}`)
  if (!made && lavas.length) {
    learnSkill('lava is in range but no safe standing spot above it', 'pouring water on lava',
               'no obsidian made', false, `${lavas.length} lava blocks, none usable`)
  }
  return made > 0
}


// Five of six bots carried EMPTY buckets, so the lava routine skipped them all
// with "LAVAOBS no water bucket" while one bot did everything. Fill it.
async function fillWaterBucket () {
  if (count('water_bucket')) return true
  const empty = bot.inventory.items().find(i => i.name === 'bucket')
  if (!empty) return false
  const wid = bot.registry.blocksByName.water && bot.registry.blocksByName.water.id
  if (!wid) return false
  const near = bot.findBlocks({ matching: wid, maxDistance: 48, count: 5 })
  if (!near.length) return false
  for (const p of near) {
    progress()
    try {
      await bot.pathfinder.goto(new goals.GoalNear(p.x, p.y, p.z, 2))
      bot.pathfinder.setGoal(null); bot.clearControlStates()
      await bot.waitForTicks(4)
      await bot.equip(empty, 'hand')
      await safeLookAt(p, true)
      await bot.activateItem(); await bot.waitForTicks(12); bot.deactivateItem()
      if (count('water_bucket')) { log('BUCKET filled with water')
        learnSkill('holding an empty bucket and water is within 48 blocks', 'walk to the water and use the bucket',
                   'bucket filled', true, '')
        return true }
    } catch (e) { log('BUCKET ' + e.message) }
  }
  return false
}

async function getObsidian (target) {
  busy = true; locked = true
  try { await getObsidianInner(target) }
  finally { busy = false; locked = false }
}
async function getObsidianInner (target) {
  try {
    if (!await makeDiamondPick()) { log('OBSIDIAN aborted - no diamond pickaxe'); return }
    // existing obsidian first
    const oid = bot.registry.blocksByName.obsidian.id
    let found = bot.findBlocks({ matching: oid, maxDistance: 128, count: 30 })
    for (const p of found) {
      progress()
      if (count('obsidian') >= (target || 10)) break
      await digBlockCarefully(p, 'diamond_pickaxe')
    }
    if (count('obsidian') >= (target || 10)) {
      speak([`${count('obsidian')} obsidian`], true); busy = false; return
    }
    // Obsidian forms where water met lava - that is deep, not on the surface.
    // Searching 64 blocks from y=117 finds nothing however long you try, which
    // is exactly how the team sat at 3/10 for hours.
    const y = Math.round(bot.entity.position.y)
    if (y > 16 && !globalThis.obsDescended) {
      globalThis.obsDescended = true
      log(`OBSIDIAN none within 64 blocks at y=${y} - going deep first`)
      speak(['no obsidian up here, heading down'], true)
      try {
        // keep `locked` held - dropping it lets the work cycle and the LLM
        // dispatcher steal the pathfinder goal mid-dig (wiki/bugs.md)
        await mineDeep(-20)   // lava lakes, where obsidian actually forms
        found = bot.findBlocks({ matching: oid, maxDistance: 128, count: 30 })
        log(`OBSIDIAN after descending to y=${Math.round(bot.entity.position.y)}: ${found.length} candidates`)
        learnSkill('no obsidian found on the surface', 'dig down to y=-20 first, then search 128 blocks',
                   `${found.length} candidates at depth`, found.length > 0,
                   `searching from the surface finds none`)
        for (const p of found) {
          if (count('obsidian') >= (target || 10)) break
          await digBlockCarefully(p, 'diamond_pickaxe')
        }
      } catch (e) { log('OBSIDIAN descend: ' + e.message) }
      finally { globalThis.obsDescended = false }
      if (count('obsidian') >= (target || 10)) {
        speak([`${count('obsidian')} obsidian`], true); return
      }
    }
    // natural obsidian exhausted - make some, carefully
    if (count('obsidian') < (target || 10)) {
      await makeObsidianFromLava(target || 10)
      if (count('obsidian') >= (target || 10)) { speak([`${count('obsidian')} obsidian`], true); return }
    }
    log(`OBSIDIAN only ${count('obsidian')} found; none nearby`)
    if (Date.now() - (globalThis.lastObsGrumble || 0) > 300000) {
      globalThis.lastObsGrumble = Date.now()
      speak(['no obsidian round here - going back to mining'], true)
    }
  } catch (e) { log('OBSIDIAN outer ' + e.message) }
}


// ---------- combat: fight back, and say something of your own ------------
let fighting = false
let lastCombatLine = 0

async function combatShout (mobName, kind) {
  // kind: 'attacked' | 'won' | 'losing'
  if (!USE_LLM || Date.now() - lastCombatLine < 8000) return
  lastCombatLine = Date.now()
  const mob = (mobName || 'something').replace(/_/g, ' ')
  const situation = kind === 'won'    ? `You just killed a ${mob}.`
                  : kind === 'losing' ? `A ${mob} is beating you, health ${Math.round(bot.health)}/20, you are about to run.`
                  :                     `A ${mob} just attacked you. Health ${Math.round(bot.health)}/20.`
  const prompt = `You are ${NAME}, the ${ROLE} in a Minecraft team.
${situation}
Shout ONE short line - your own words, under 10 words, in the heat of the moment.
Lowercase is fine. No quotes around it. Never mention being an AI.
Reply ONLY with JSON: {"say":"<your shout>"}`
  try {
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), 20000)
    let res
    try {
      res = await fetch(LLM_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ac.signal,
        body: JSON.stringify({ model: LLM_MODEL, prompt, stream: false, format: 'json',
          keep_alive: '30m', think: false, options: { num_predict: 40, temperature: 1.1, num_ctx: 4096 } })
      })
    } finally { clearTimeout(t) }
    const out = JSON.parse((await res.json()).response)
    if (out.say && out.say.trim()) {
      speak(out.say.trim(), true)
      log(`COMBAT "${out.say.trim()}" (${kind} vs ${mob})`)
    }
  } catch (e) { log('combatShout: ' + e.message) }
}

function bestWeapon () {
  const order = ['netherite_sword','diamond_sword','iron_sword','stone_sword','wooden_sword',
                 'netherite_axe','diamond_axe','iron_axe','stone_axe']
  for (const w of order) {
    const it = bot.inventory.items().find(i => i.name === w)
    if (it) return it
  }
  return null
}

async function fightBack (attacker) {
  if (fighting || !attacker || !attacker.isValid) return
  fighting = true
  const was = busy
  busy = true
  const failsafe = setTimeout(() => { fighting = false; busy = was; log('FIGHT failsafe released') }, 90000)
  try {
    const name = attacker.name || 'mob'
    log(`FIGHT engaging ${name} at ${Math.round(attacker.position.distanceTo(bot.entity.position))}m`)
    combatShout(name, 'attacked').catch(() => {})

    const w = bestWeapon()
    if (w) { try { await bot.equip(w, 'hand') } catch {} }

    const startHp = bot.health
    for (let swing = 0; swing < 30; swing++) {
      if (!attacker.isValid) {                     // it died
        log(`FIGHT killed ${name}`)
        recordEvent({ type: 'killed', mob: name })
        journal(`killed a ${name}`)
        combatShout(name, 'won').catch(() => {})
        break
      }
      // retreat if this is going badly
      const floor = ROLE === 'fighter' ? 4 : 7
      if (bot.health < floor || (startHp - bot.health) > (ROLE === 'fighter' ? 16 : 10)) {
        log(`FIGHT losing to ${name} at hp ${Math.round(bot.health)}, disengaging`)
        combatShout(name, 'losing').catch(() => {})
        await fleeFrom(attacker)
        break
      }
      const d = attacker.position.distanceTo(bot.entity.position)
      if (d > 4) {
        try { await bot.pathfinder.goto(new goals.GoalFollow(attacker, 2)) } catch {}
      } else {
        try {
          await bot.lookAt(attacker.position.offset(0, 1, 0), true)
          await bot.attack(attacker)
        } catch (e) { log('swing: ' + e.message) }
      }
      await bot.waitForTicks(11)                    // attack cooldown
    }
  } catch (e) { log('FIGHT ' + e.message) }
  clearTimeout(failsafe)
  try { bot.pathfinder.setGoal(null) } catch {}
  fighting = false
  busy = was
}


// ---------- let knockback actually land ---------------------------------
// These are headless clients: the pathfinder re-asserts movement every tick and
// cancels the server's velocity packet, so hits look like they do nothing.
// Briefly stop steering so the knockback carries.
let ragdollUntil = 0
bot.on('entityHurt', (e) => {
  if (e !== bot.entity) return
  ragdollUntil = Date.now() + 1200
  try { bot.pathfinder.setGoal(null) } catch {}
  bot.clearControlStates()
  log('KNOCKBACK taking the hit')
})
setInterval(() => {
  if (Date.now() < ragdollUntil) {
    // stay limp: no steering at all while the velocity plays out
    try { if (bot.pathfinder && bot.pathfinder.goal) bot.pathfinder.setGoal(null) } catch {}
    bot.clearControlStates()
  }
}, 100)


// ---------- shared conversation memory -----------------------------------
// Every bot appends what it hears and says to one file, so they all share a
// transcript and can build on each other rather than talking past each other.
const CHATLOG = path.join(DIR, 'chatlog.txt')
const recentlySaid = []            // this bot's own last lines, to avoid repeats

function logChat (who, text) {
  try {
    const t = new Date().toTimeString().slice(0, 5)
    fs.appendFileSync(CHATLOG, `${t} <${who}> ${text}\n`)
  } catch {}
}
function readChat (n) {
  try {
    const lines = fs.readFileSync(CHATLOG, 'utf8').trim().split('\n')
    return lines.slice(-(n || 14)).join('\n')
  } catch { return '' }
}

// refuse to say something we have just said, or that someone else just said
function tooSimilar (text) {
  const norm = t => t.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
  const a = norm(text)
  if (!a) return true
  if (recentlySaid.some(p => norm(p) === a)) return true
  const words = new Set(a.split(/\s+/))
  for (const p of recentlySaid) {
    const b = new Set(norm(p).split(/\s+/))
    const shared = [...words].filter(w => b.has(w)).length
    if (shared >= Math.min(words.size, b.size) * 0.75) return true   // near-duplicate
  }
  const recent = readChat(8).toLowerCase()
  if (a.length > 12 && recent.includes(a)) return true               // someone just said it
  return false
}
function rememberSaid (text) {
  recentlySaid.push(text)
  while (recentlySaid.length > 8) recentlySaid.shift()
}


// ---------- verified relationships --------------------------------------
// Agents were inventing teammates ("Carpenter", "Engineer") and placeholder
// coordinates. This ledger records only things that provably happened, so the
// model narrates real history instead of confabulating it.
const LEDGER = path.join(DIR, 'relations.jsonl')

function learnFromDeath (cause) {
  if (!cause) return
  const c = String(cause).toLowerCase()
  if (c.includes('lava')) learnSkill('working near lava', 'standing adjacent to a lava source', 'died in lava', false, cause)
  else if (c.includes('fell')) learnSkill('moving at depth', 'pathing across a drop', 'died from the fall', false, cause)
  else if (c.includes('creeper')) learnSkill('a creeper is close', 'carrying on with the task', 'died to the blast', false, cause)
  else if (c.includes('zombie') || c.includes('skeleton')) learnSkill('mining in the dark at depth', 'ignoring mobs', 'died fighting', false, cause)
  else if (c.includes('drown')) learnSkill('in deep water', 'swimming without pillaring up', 'drowned', false, cause)
}

function recordEvent (ev) {
  try {
    ev.t = new Date().toISOString().slice(11, 16)
    ev.actor = NAME
    fs.appendFileSync(LEDGER, JSON.stringify(ev) + '\n')
  } catch (e) { log('ledger: ' + e.message) }
}

function readLedger (limit) {
  try {
    const lines = fs.readFileSync(LEDGER, 'utf8').trim().split('\n').filter(Boolean)
    return lines.slice(-(limit || 400)).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  } catch { return [] }
}

// what has actually passed between me and each teammate
function relationContext () {
  const evs = readLedger(400)
  const mates = BOTS.filter(n => n !== NAME)
  const lines = []
  for (const m of mates) {
    const facts = []
    const gaveThem = evs.filter(e => e.type === 'gave' && e.actor === NAME && e.to === m)
    const gaveMe   = evs.filter(e => e.type === 'gave' && e.actor === m && e.to === NAME)
    const savedMe  = evs.filter(e => e.type === 'defended' && e.actor === m && e.who === NAME)
    const savedThem= evs.filter(e => e.type === 'defended' && e.actor === NAME && e.who === m)
    const theirDeaths = evs.filter(e => e.type === 'died' && e.actor === m)
    const together = evs.filter(e => e.type === 'together' && e.actor === NAME && e.with === m)

    if (gaveThem.length) facts.push(`you gave them ${gaveThem.map(e=>`${e.n} ${e.what}`).slice(-2).join(', ')}`)
    if (gaveMe.length)   facts.push(`they gave you ${gaveMe.map(e=>`${e.n} ${e.what}`).slice(-2).join(', ')}`)
    if (savedMe.length)  facts.push(`they fought off a ${savedMe[savedMe.length-1].mob} that was attacking you`)
    if (savedThem.length)facts.push(`you saved them from a ${savedThem[savedThem.length-1].mob}`)
    if (theirDeaths.length) facts.push(`they have died ${theirDeaths.length}x (last: ${theirDeaths[theirDeaths.length-1].how || 'unknown'})`)
    if (together.length >= 3) facts.push(`you have worked alongside them ${together.length} times`)
    if (facts.length) lines.push(`- ${m}: ${facts.join('; ')}`)
  }
  if (!lines.length) return 'You have no shared history with anyone yet - do not invent any.'
  return 'VERIFIED shared history (only these things actually happened):\n' + lines.join('\n')
}

// note when we spend time near a teammate - the basis of "we work together"
setInterval(() => {
  if (!bot.entity) return
  for (const p of Object.values(bot.players)) {
    if (!p.entity || p.username === bot.username) continue
    if (!BOTS.includes(p.username)) continue
    if (p.entity.position.distanceTo(bot.entity.position) < 12) {
      const key = 'near_' + p.username
      const now = Date.now()
      if (now - (globalThis[key] || 0) > 300000) {      // at most once per 5 min per mate
        globalThis[key] = now
        recordEvent({ type: 'together', with: p.username })
      }
    }
  }
}, 30000)

// ---------- do not provoke endermen ------------------------------------
function endermanNear (range) {
  return bot.nearestEntity(e => e.name === 'enderman' &&
    e.position.distanceTo(bot.entity.position) < (range || 16))
}
async function safeLookAt (vec, force) {
  const e = endermanNear(20)
  if (e) {
    // look at the ground instead - eye contact makes them attack
    try { await bot.look(bot.entity.yaw, Math.PI / 2.2, true) } catch {}
    return false
  }
  try { await bot.lookAt(vec, force); return true } catch { return false }
}

// ---------- wear the best armour we have -------------------------------
const ARMOUR_SLOTS = [
  { slot: 'head',  tiers: ['netherite_helmet','diamond_helmet','iron_helmet','leather_helmet'] },
  { slot: 'torso', tiers: ['netherite_chestplate','diamond_chestplate','iron_chestplate','leather_chestplate'] },
  { slot: 'legs',  tiers: ['netherite_leggings','diamond_leggings','iron_leggings','leather_leggings'] },
  { slot: 'feet',  tiers: ['netherite_boots','diamond_boots','iron_boots','leather_boots'] }
]
async function gearUp () {
  let worn = 0
  for (const a of ARMOUR_SLOTS) {
    const already = bot.inventory.slots[bot.getEquipmentDestSlot(a.slot)]
    if (already && a.tiers.includes(already.name) && a.tiers.indexOf(already.name) === 0) continue
    for (const t of a.tiers) {
      const it = bot.inventory.items().find(i => i.name === t)
      if (!it) continue
      try { await bot.equip(it, a.slot); worn++; log(`GEAR wore ${t}`); break }
      catch (e) { log(`GEAR ${t}: ${e.message}`) }
    }
  }
  // best weapon in hand
  for (const w of ['netherite_sword','diamond_sword','netherite_axe','stone_sword']) {
    const it = bot.inventory.items().find(i => i.name === w)
    if (it) { try { await bot.equip(it, 'hand'); log(`GEAR holding ${w}`) } catch {} ; break }
  }
  if (worn) speak([`kitted out - ${worn} pieces on`], true)
  return worn
}



// ---------- build and light a Nether portal ------------------------------
async function buildPortal () {
  busy = true; locked = true
  try {
    if (count('obsidian') < 10) {
      // pull obsidian from teammates' chests if we are short
      await fetchItem('obsidian', 10 - count('obsidian'))
    }
    if (count('obsidian') < 10) {
      // do not give up alone - the team may hold enough between them
      let pooled = await poolItems(['obsidian'], 10, 'obsidian')
      if (!pooled) {
        // The obsidian STAGE is already marked complete, so no other code path
        // will ever send anyone to mine more. Without this the team loops on
        // "PORTAL aborted" indefinitely, which it did for hours.
        log(`PORTAL short of obsidian (${count('obsidian')}) - going to mine some`)
        // getObsidian's wrapper would clear the lock in its finally block and
        // hand the goal to another subsystem; call the inner directly.
        await getObsidianInner(10)
        pooled = count('obsidian') >= 10 || await poolItems(['obsidian'], 10, 'obsidian')
      }
      if (!pooled) {
        log(`PORTAL aborted: only ${count('obsidian')} obsidian after mining`)
        speak([`only ${count('obsidian')} obsidian, need 10`], true)
        return
      }
    }

    // find flat open ground to stand the frame on
    const p = bot.entity.position.floored()
    let base = null
    for (let r = 0; r <= 8 && !base; r++) {
      for (let dx = -r; dx <= r && !base; dx++) for (let dz = -r; dz <= r && !base; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
        const o = p.offset(dx, 0, dz)
        let ok = true
        for (let x = 0; x < 4 && ok; x++) {
          const ground = bot.blockAt(o.offset(x, -1, 0))
          if (!ground || ground.name === 'air' || ground.name.includes('water') || ground.name.includes('lava')) ok = false
          for (let y = 0; y < 5 && ok; y++) {
            const air = bot.blockAt(o.offset(x, y, 0))
            if (!air || air.name !== 'air') ok = false
          }
        }
        if (ok) base = o
      }
    }
    if (!base) { speak(['nowhere flat enough for a portal'], true); return }
    log(`PORTAL building at ${base.x},${base.y},${base.z}`)
    speak(['building a nether portal'], true)

    // frame: 4 wide x 5 tall, corners optional (10 obsidian minimum)
    const frame = []
    for (let x = 1; x <= 2; x++) { frame.push([x, 0]); frame.push([x, 4]) }        // floor + ceiling
    for (let y = 1; y <= 3; y++) { frame.push([0, y]); frame.push([3, y]) }        // sides
    let placed = 0
    for (const [dx, dy] of frame) {
      const spot = base.offset(dx, dy, 0)
      const at = bot.blockAt(spot)
      if (at && at.name === 'obsidian') { placed++; continue }
      const it = bot.inventory.items().find(i => i.name === 'obsidian')
      if (!it) break
      // find something to place against
      let done = false
      for (const d of [[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]]) {
        const ref = bot.blockAt(spot.offset(d[0], d[1], d[2]))
        if (!ref || ref.name === 'air') continue
        try {
          if (bot.entity.position.distanceTo(spot) > 4) {
            await bot.pathfinder.goto(new goals.GoalNear(spot.x, spot.y, spot.z, 3))
            try { bot.pathfinder.setGoal(null) } catch {}
          }
          await bot.equip(it, 'hand')
          await bot.lookAt(spot.offset(0.5, 0.5, 0.5), true)
          await bot.placeBlock(ref, new Vec3(-d[0], -d[1], -d[2]))
          await bot.waitForTicks(4)
          if (bot.blockAt(spot) && bot.blockAt(spot).name === 'obsidian') { placed++; done = true }
          break
        } catch (e) { /* try another face */ }
      }
      if (!done) log(`PORTAL could not place at ${spot.x},${spot.y},${spot.z}`)
    }
    log(`PORTAL frame ${placed}/${frame.length} blocks`)
    if (placed < frame.length) { speak([`portal frame incomplete (${placed}/10)`], true); return }

    // light it
    let fs = bot.inventory.items().find(i => i.name === 'flint_and_steel')
    if (!fs) {
      await fetchItem('flint_and_steel', 1)
      fs = bot.inventory.items().find(i => i.name === 'flint_and_steel')
    }
    if (!fs) { speak(['frame is up but I have no flint and steel'], true); return }
    const inside = base.offset(1, 1, 0)
    const floor = bot.blockAt(base.offset(1, 0, 0))
    try {
      await bot.pathfinder.goto(new goals.GoalNear(inside.x, inside.y, inside.z, 2))
      try { bot.pathfinder.setGoal(null) } catch {}
      await bot.equip(fs, 'hand')
      await bot.lookAt(inside.offset(0.5, 0, 0.5), true)
      await bot.activateBlock(floor)
      await bot.waitForTicks(20)
      const lit = bot.blockAt(inside)
      if (lit && lit.name === 'nether_portal') {
        speak(['portal is lit! going through'], true)
        log('PORTAL lit successfully')
        learnSkill('have 10 obsidian and a flint and steel', 'build the frame then light it',
                   'portal lit', true, '')
        journal('built and lit a nether portal')
        // step in
        await bot.pathfinder.goto(new goals.GoalBlock(inside.x, inside.y, inside.z))
        await bot.waitForTicks(120)
        log(`PORTAL after entering, dimension=${bot.game && bot.game.dimension}`)
      } else {
        log('PORTAL did not light')
        learnSkill('portal frame built', 'lighting it', 'it did not light - frame is probably incomplete', false, '')
        speak(['portal would not light'], true)
      }
    } catch (e) { log('PORTAL light: ' + e.message) }
  } catch (e) { log('PORTAL ' + e.message) }
  finally { busy = false; locked = false }
}


// ---------- Nether: explore for a fortress, do not strip mine ------------
const FORTRESS_BLOCKS = ['nether_bricks','nether_brick_fence','nether_brick_stairs','nether_wart']
function inNether () {
  const d = bot.game && bot.game.dimension
  return d && String(d).includes('nether')
}

async function exploreNether () {
  if (!inNether() && Date.now() < (globalThis.netherCooldown || 0)) {
    log('NETHER on cooldown, skipping')
    return
  }
  busy = true; locked = true
  try {
    if (!inNether()) {
      // get there first
      const id = bot.registry.blocksByName.nether_portal && bot.registry.blocksByName.nether_portal.id
      const found = id ? bot.findBlocks({ matching: id, maxDistance: 128, count: 1 }) : []
      if (!found.length) { speak(['need a portal to reach the nether'], true); return }
      const p = found[0]
      speak(['heading through to the nether'], true)
      try { await bot.pathfinder.goto(new goals.GoalBlock(p.x, p.y, p.z)) } catch {}
      for (let i = 0; i < 10 && !inNether(); i++) await bot.waitForTicks(20)
      if (!inNether()) {
        globalThis.netherCooldown = Date.now() + 120000    // stop hammering it
        log('NETHER failed to transfer, backing off 2 min')
        return
      }
      log('NETHER arrived')
    }

    // already found a fortress? go mine blaze rods there
    const fbIds = FORTRESS_BLOCKS.map(n => bot.registry.blocksByName[n]).filter(Boolean).map(b => b.id)
    const seen = bot.findBlocks({ matching: fbIds, maxDistance: 96, count: 5 })
    if (seen.length) {
      const f = seen[0]
      log(`NETHER fortress blocks at ${f.x},${f.y},${f.z}`)
      speak([`fortress at ${f.x}, ${f.z}!`], true)
      journal(`found a nether fortress at ${f.x},${f.y},${f.z}`)
      try { await bot.pathfinder.goto(new goals.GoalNear(f.x, f.y, f.z, 6)) } catch {}
      // blazes spawn here - fight them for rods
      const blaze = bot.nearestEntity(e => e.name === 'blaze' && e.position.distanceTo(bot.entity.position) < 32)
      if (blaze) { busy = false; locked = false; await fightBack(blaze); return }
      return
    }

    // otherwise EXPLORE - long runs along open ground, not digging
    speak([pick(['exploring for a fortress', 'looking for nether brick', 'scouting the nether'])], true)
    const p = bot.entity.position.floored()
    const ang = Math.random() * Math.PI * 2
    const dist = 60 + Math.random() * 60          // long legs, not strip mining
    const tx = p.x + Math.round(Math.cos(ang) * dist)
    const tz = p.z + Math.round(Math.sin(ang) * dist)
    log(`NETHER exploring toward ${tx},${tz}`)
    try {
      await bot.pathfinder.goto(new goals.GoalNear(tx, p.y, tz, 8))
    } catch (e) {
      log('NETHER explore: ' + e.message)
    } finally { try { bot.pathfinder.setGoal(null) } catch {} }
  } catch (e) { log('NETHER ' + e.message) }
  finally { busy = false; locked = false }
}

// ---------- the Fighter: seek out and kill hostiles ----------------------
async function patrol () {
  busy = true
  try {
    const target = bot.nearestEntity(e =>
      (e.type === 'mob' || e.type === 'hostile') && HOSTILE.includes(e.name) &&
      !['creeper','warden','enderman'].includes(e.name) &&
      e.position.distanceTo(bot.entity.position) < 40)
    if (target) {
      log(`PATROL found ${target.name} at ${Math.round(target.position.distanceTo(bot.entity.position))}m`)
      busy = false
      await fightBack(target)
      return
    }
    // guard whichever teammate is in the most danger
    const hurt = Object.values(bot.players)
      .filter(p => p.entity && ['Claude','Woodcutter','Builder','Miner','Forager'].includes(p.username))
      .sort((a, b) => a.entity.position.distanceTo(bot.entity.position) - b.entity.position.distanceTo(bot.entity.position))[0]
    if (hurt && hurt.entity.position.distanceTo(bot.entity.position) > 20) {
      log(`PATROL escorting ${hurt.username}`)
      try { await bot.pathfinder.goto(new goals.GoalFollow(hurt.entity, 6)) } catch {}
    } else {
      // sweep the area
      const p = bot.entity.position.floored()
      const ang = Math.random() * Math.PI * 2
      const dist = 8 + Math.random() * 10          // short hops are reachable
      try {
        await bot.pathfinder.goto(new goals.GoalNear(
          p.x + Math.round(Math.cos(ang) * dist), p.y, p.z + Math.round(Math.sin(ang) * dist), 3))
      } catch (e) {
        log('PATROL hop failed: ' + e.message)
      } finally {
        try { bot.pathfinder.setGoal(null) } catch {}   // never keep an unreachable goal
      }
      await bot.waitForTicks(30)                        // pause between sweeps
    }
  } catch (e) { log('PATROL ' + e.message) }
  busy = false
}

// ---------- the objective: beat the game --------------------------------
const QUEST = path.join(DIR, 'quest.json')
const STAGES = [
  { id: 'wood',      need: ['oak_log','birch_log','spruce_log'], qty: 8,  what: 'gather logs' },
  { id: 'tools',     need: ['wooden_pickaxe','stone_pickaxe'],   qty: 1,  what: 'make a pickaxe' },
  { id: 'stone',     need: ['cobblestone'],                      qty: 20, what: 'mine cobblestone' },
  { id: 'iron',      need: ['raw_iron','iron_ingot'],            qty: 8,  what: 'find iron' },
  { id: 'ironGear',  need: ['iron_pickaxe'],                     qty: 1,  what: 'make an iron pickaxe' },
  { id: 'diamond',   need: ['diamond'],                          qty: 3,  what: 'find diamonds' },
  { id: 'obsidian',  need: ['obsidian'],                         qty: 10, what: 'mine obsidian' },
  { id: 'nether',    need: ['blaze_rod'],                        qty: 6,  what: 'get blaze rods in the Nether' },
  { id: 'pearls',    need: ['ender_pearl'],                      qty: 12, what: 'get ender pearls' },
  { id: 'eyes',      need: ['ender_eye'],                        qty: 12, what: 'craft eyes of ender' },
  { id: 'dragon',    need: [],                                   qty: 0,  what: 'kill the Ender Dragon' }
]

// The dream prompt has always forbidden invented players and coordinates, and
// the model ignores it anyway. Prompting harder was tried; enforcing the rule
// on the output works. Same lesson as `bot.consume()`: verify the effect.
const REAL_PLAYERS = ['Claude','Woodcutter','Builder','Miner','Forager','Fighter','Ben','RampageLand']
// corporate-retrospective vocabulary. A bot in a cave cannot schedule a sync.
const CARGO_CULT = /\b(meeting|sync|standup|stand-up|stakeholder|alignment|align on|action item|deliverable|roadmap|KPI|OKR|workshop|retrospective|touch base|circle back|leverage|synerg|best practice|framework|initiative|streamline|onboard)\w*/i

function auditPage (text) {
  const bad = []
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue
    if (CARGO_CULT.test(line)) { bad.push('cargo-cult: ' + line.trim().slice(0, 60)); continue }
    // a capitalised word used as a name that is not one of us
    const names = line.match(/\b[A-Z][a-z]{2,}\b/g) || []
    for (const n of names) {
      if (REAL_PLAYERS.includes(n)) continue
      if (/^(The|This|That|Today|Tomorrow|Yesterday|Nether|End|Overworld|Minecraft|Fortress|I|We|My|Our|It|And|But|Not|Never|Always|Keep|Need|Found|Made|Got|Went|Died|Mined|Built|Ate|Blaze|Diamond|Iron|Gold|Stone|Wood|Coal|Lava|Water|Zombie|Creeper|Skeleton|Enderman|Wither|Dragon|Ender|Pearl|Rod|Portal|Chest|Pickaxe|Sword|Axe|Bread|Beef|Wheat|Cobblestone|Obsidian|Bed|Furnace|Table|Village|Cave|Ravine|Mountain|Forest|Plains|Desert|Ocean|River|Day|Night|Page|Lesson|Task|Note|Rule|Plan|Goal|Job|Team|Stage|Progress|Health|Food|Hunger|Level|Block|Item|Tool|Armour|Armor|Shield|Bow|Arrow|Torch|Ladder|Boat|Map|Compass|Clock|Bucket|Flint|Steel|String|Bone|Feather|Leather|Wool|Sheep|Cow|Pig|Chicken|Horse|Wolf|Cat|Fish|Squid|Bat|Spider|Slime|Ghast|Piglin|Hoglin|Strider|Magma|Cube|Silverfish|Endermite|Phantom|Drowned|Husk|Stray|Witch|Pillager|Vindicator|Evoker|Ravager|Illusioner|Guardian|Elder|Shulker|Vex|Warden|Sculk|Deep|Dark|Ancient|City|Temple|Mansion|Monument|Outpost|Bastion|Remnant|Stronghold|Eye|Frame|Egg|Crystal|Beacon|Anvil|Enchant|Brew|Potion|Splash|Lingering|Effect|Regen|Strength|Speed|Jump|Vision|Resistance|Fire|Poison|Wither|Slow|Weak|Nausea|Blind|Hunger|Saturation|Absorption|Glow|Luck|Bad|Good|Hero|Village|Conduit|Power|Dolphin|Grace|Slow|Falling|Turtle|Master)$/.test(n)) continue
      bad.push('unknown name "' + n + '": ' + line.trim().slice(0, 50))
      break
    }
  }
  return bad
}

function stripBadLines (text) {
  return String(text).split('\n').filter(line => {
    if (!line.trim()) return true
    if (CARGO_CULT.test(line)) return false
    return true
  }).join('\n').trim()
}

function readQuest () { try { return JSON.parse(fs.readFileSync(QUEST,'utf8')) } catch { return { done: [], log: [] } } }
function writeQuest (q) { try { fs.writeFileSync(QUEST, JSON.stringify(q,null,2)) } catch {} }

function currentStage () {
  const q = readQuest()
  for (const st of STAGES) if (!q.done.includes(st.id)) return st
  return null
}
function teamCount (names) {
  let total = 0
  for (const n of BOTS) {
    try {
      const st = JSON.parse(fs.readFileSync(path.join(DIR, `state_${n}.json`), 'utf8'))
      for (const line of st.inventory || []) {
        const m = line.match(/^(\w+) x(\d+)$/)
        if (m && names.includes(m[1])) total += parseInt(m[2], 10)
      }
    } catch {}
  }
  return total
}

// Who on the team is holding `names`, and how much. Reads the same state files
// teamCount() does.
function teamHolders (names) {
  const out = []
  for (const n of BOTS) {
    if (n === NAME) continue
    try {
      const st = JSON.parse(fs.readFileSync(path.join(DIR, `state_${n}.json`), 'utf8'))
      let have = 0
      for (const line of st.inventory || []) {
        const m = line.match(/^(\w+) x(\d+)$/)
        if (m && names.includes(m[1])) have += parseInt(m[2], 10)
      }
      if (have > 0) out.push({ who: n, have })
    } catch {}
  }
  return out.sort((a, b) => b.have - a.have)
}

// Gather `qty` of `names` into MY inventory before attempting a build.
//
// The portal stage stalled for hours because every bot checked only its own
// pockets: "PORTAL aborted: only 1 obsidian" while the team held enough
// between them. teamCount() already knew the team total - nothing acted on it.
// Asks the holders to hand items over, then waits for them to actually arrive.
async function poolItems (names, qty, label) {
  const mine = () => names.reduce((t, n) => t + count(n), 0)
  if (mine() >= qty) return true
  const holders = teamHolders(names)
  const teamTotal = mine() + holders.reduce((t, h) => t + h.have, 0)
  if (teamTotal < qty) {
    // Carried inventory is not the whole story: a bot whose LLM chose
    // "deposit" has banked the material in its role chest, where teamCount and
    // teamHolders cannot see it. The team looked like it had 0 obsidian while
    // Woodcutter had deposited his. Pull from storage before declaring defeat.
    log(`POOL ${label}: only ${teamTotal}/${qty} carried - checking chests`)
    try { await fetchItem(names[0], qty - mine()) } catch (e) { log('POOL fetch: ' + e.message) }
    for (const n of BOTS) {
      if (n === NAME) continue
      try { fs.appendFileSync(path.join(DIR, `cmds_${n}.txt`), `fetch ${names[0]} ${qty}\n`) } catch {}
    }
    if (mine() >= qty) { log(`POOL ${label}: got ${mine()}/${qty} from my own chest`); return true }
    log(`POOL ${label}: team has ${teamTotal}/${qty} carried - asked everyone to empty their chests`)
    return false
  }
  let want = qty - mine()
  log(`POOL ${label}: I have ${mine()}/${qty}, team has ${teamTotal}. Asking ${holders.length} teammates.`)
  speak([`bring me ${want} ${label}, i'll build it`], true)
  for (const h of holders) {
    if (want <= 0) break
    const ask = Math.min(want, h.have)
    // the file-based control plane is how bots command each other
    try { fs.appendFileSync(path.join(DIR, `cmds_${h.who}.txt`), `give ${NAME} ${names[0]} ${ask}\n`) } catch {}
    log(`POOL asked ${h.who} for ${ask} ${names[0]}`)
    want -= ask
  }
  // wait for delivery - handovers are a walk plus a toss, so give them time
  for (let i = 0; i < 30; i++) {
    progress()
    await bot.waitForTicks(20)
    if (mine() >= qty) { log(`POOL ${label}: got ${mine()}/${qty}`); return true }
  }
  log(`POOL ${label}: timed out with ${mine()}/${qty}`)
  return false
}

// having a downstream item proves the earlier stage happened
const PROVES = {
  wood:  ['oak_planks','birch_planks','spruce_planks','stick','crafting_table','wooden_pickaxe','stone_pickaxe'],
  tools: ['stone_pickaxe','iron_pickaxe','cobblestone'],
  stone: ['furnace','stone_pickaxe','iron_pickaxe'],
  iron:  ['iron_ingot','iron_pickaxe'],
  ironGear: ['diamond'],
  diamond: ['diamond_pickaxe','obsidian'],
  obsidian: ['blaze_rod','ender_pearl']
}
function checkStage () {
  const st = currentStage()
  if (!st || !st.need.length) return st
  let have = teamCount(st.need)
  if (have < st.qty && PROVES[st.id]) {
    // downstream evidence counts as completion
    if (teamCount(PROVES[st.id]) > 0) have = st.qty
  }
  if (have >= st.qty) {
    const q = readQuest()
    if (!q.done.includes(st.id)) {
      q.done.push(st.id)
      q.log.push(`${new Date().toISOString().slice(11,16)} team completed ${st.id} (${have} ${st.need[0]})`)
      writeQuest(q)
      speak([`${st.id} done! that's ${q.done.length} of ${STAGES.length}`], true)
      log(`QUEST completed ${st.id}`)
      journal(`completed quest stage ${st.id}`)
    }
    return currentStage()
  }
  return st
}

// what the team should be doing right now, injected into every decision
function questContext () {
  const st = currentStage()
  const q = readQuest()
  if (!st) return 'THE GAME IS BEATEN.'
  const have = st.need.length ? teamCount(st.need) : 0
  return `TEAM OBJECTIVE: beat Minecraft - kill the Ender Dragon.\n`
       + `Progress: ${q.done.length}/${STAGES.length} stages done.\n`
       + `Current step: ${st.what} (need ${st.qty}, I have ${have}).`
}

// ---------- protected areas: bots may never build or dig here ----------
const PROTECTED = [
  { name: 'communal house', x1: 55, x2: 90, y1: 60, y2: 100, z1: 105, z2: 143 },
  { name: 'cathedral',      x1: 85, x2: 220, y1: 60, y2: 170, z1: 85,  z2: 175 }
]
function inProtected (x, y, z) {
  for (const p of PROTECTED) {
    if (x >= p.x1 && x <= p.x2 && z >= p.z1 && z <= p.z2 && y >= p.y1 && y <= p.y2) return p.name
  }
  return null
}
// somewhere sensible to build that is NOT protected and not miles away
function pickFreeSite () {
  const p = bot.entity.position.floored()
  // each builder favours its own quadrant so the town spreads out
  const seat = ['Claude','Woodcutter','Builder','Miner','Forager'].indexOf(NAME)
  const bias = seat >= 0 ? (seat * 2 * Math.PI) / 5 : Math.random() * Math.PI * 2
  for (let attempt = 0; attempt < 40; attempt++) {
    const ang = bias + (Math.random() - 0.5) * 1.2
    const dist = 45 + Math.random() * 60
    const x = Math.round(p.x + Math.cos(ang) * dist)
    const z = Math.round(p.z + Math.sin(ang) * dist)
    if (inProtected(x, HOME.y, z)) continue
    if (inProtected(x + 13, HOME.y, z + 11)) continue   // check the far corner too
    // find the ground there
    for (let y = 110; y > 50; y--) {
      const b = bot.blockAt(new Vec3(x, y, z))
      const above = bot.blockAt(new Vec3(x, y + 1, z))
      if (b && b.name !== 'air' && !b.name.includes('water') && above && above.name === 'air') {
        return { x, y: y + 1, z }
      }
    }
  }
  return null
}


// ---------- do not drown or burn ----------------------------------------
let escaping = false
let locked = false
async function escapeHazard () {
  if (escaping || !bot.entity) return false
  const feet = bot.blockAt(bot.entity.position.floored())
  const head = bot.blockAt(bot.entity.position.floored().offset(0, 1, 0))
  const inWater = (feet && feet.name.includes('water')) || (head && head.name.includes('water'))
  const inLava  = (feet && feet.name.includes('lava'))  || (head && head.name.includes('lava'))
  const lowAir  = bot.oxygenLevel !== undefined && bot.oxygenLevel < 12

  if (!inLava && !(inWater && lowAir)) return false
  escaping = true
  const was = busy
  busy = true
  try {
    log(inLava ? 'HAZARD in lava, getting out' : `HAZARD drowning, oxygen ${bot.oxygenLevel}`)
    if (!USE_LLM) speak([inLava ? 'lava! getting out' : 'cannot breathe - going up'], true)
    // swim/climb straight up
    const solid = ['cobblestone','dirt','stone','netherrack','oak_planks','deepslate','tuff']
    bot.setControlState('jump', true)
    for (let i = 0; i < 40; i++) {
      await bot.waitForTicks(4)
      const f = bot.blockAt(bot.entity.position.floored())
      const h = bot.blockAt(bot.entity.position.floored().offset(0, 1, 0))
      const stillBad = (f && (f.name.includes('water') || f.name.includes('lava'))) ||
                       (h && (h.name.includes('water') || h.name.includes('lava')))
      if (!stillBad) break
      // pillar up: place a block under our feet while jumping
      const mat = solid.find(n => count(n))
      if (mat) {
        const it = bot.inventory.items().find(x => x.name === mat)
        const under = bot.blockAt(bot.entity.position.floored().offset(0, -1, 0))
        if (it && under) {
          try {
            await bot.equip(it, 'hand')
            await bot.placeBlock(under, new Vec3(0, 1, 0))
          } catch {}
        }
      }
      // or swim toward the nearest dry land
      if (i % 6 === 0) {
        const dry = bot.findBlock({
          maxDistance: 24,
          matching: b => b && b.name !== 'air' && !b.name.includes('water') && !b.name.includes('lava')
        })
        if (dry) { try { await bot.lookAt(dry.position.offset(0.5, 1, 0.5), true) } catch {} }
        bot.setControlState('forward', true)
      }
    }
    bot.setControlState('jump', false)
    bot.setControlState('forward', false)
    log('HAZARD escaped')
  } catch (e) { log('escapeHazard: ' + e.message); bot.setControlState('jump', false) }
  escaping = false
  busy = was
  return true
}
setInterval(() => { escapeHazard().catch(e => log('hazard: ' + e.message)) }, 1000)


// ---------- release a stuck lock ---------------------------------------
let busySince = 0
// A task that is WORKING calls progress() to say so. Without this the watchdog
// cannot tell a deadlock from a long job, and 45s is not "plenty" for any real
// task: obsidian is ~9s per block and descending to y=-20 takes minutes. The
// watchdog was killing every long operation mid-flight - it is the source of
// the "goal was changed before it could be completed" errors throughout this
// project, not the work cycle or the LLM dispatcher.
function progress () { if (busy || locked) busySince = Date.now() }

setInterval(() => {
  if (busy || locked) {
    if (!busySince) busySince = Date.now()
    else if (Date.now() - busySince > 180000) {      // only a genuine stall gets here now
      log(`DEADLOCK cleared after ${Math.round((Date.now()-busySince)/1000)}s (busy=${busy} locked=${locked})`)
      busy = false; locked = false; goingToBed = false; escaping = false; unsticking = false
      try { bot.pathfinder.setGoal(null) } catch {}
      bot.clearControlStates()
      busySince = 0
    }
  } else busySince = 0
}, 5000)

// ---------- get unstuck ------------------------------------------------
let lastPos = null
let stillFor = 0
let unsticking = false

async function digAround () {
  // clear whatever is boxing us in: in front, above, and the diagonal step
  const p = bot.entity.position.floored()
  const yaw = bot.entity.yaw
  const fx = Math.round(-Math.sin(yaw)), fz = Math.round(-Math.cos(yaw))
  const targets = [
    p.offset(fx, 0, fz), p.offset(fx, 1, fz),      // straight ahead, both heights
    p.offset(0, 2, 0),                              // ceiling
    p.offset(fx, -1, fz)                            // step down
  ]
  for (const t of targets) {
    const b = bot.blockAt(t)
    if (!b || b.name === 'air' || b.name === 'bedrock') continue
    if (b.name.includes('water') || b.name.includes('lava')) continue
    try { await bot.dig(b); log('UNSTUCK dug ' + b.name); return true } catch (e) {}
  }
  return false
}

async function pillarUp () {
  // stuck in a pit: place a block under ourselves and jump out
  const mat = ['dirt','cobblestone','oak_planks','birch_planks','stone'].find(n => count(n))
  if (!mat) return false
  const it = bot.inventory.items().find(i => i.name === mat)
  try {
    await bot.equip(it, 'hand')
    const under = bot.blockAt(bot.entity.position.floored().offset(0, -1, 0))
    if (!under || under.name === 'air') return false
    bot.setControlState('jump', true)
    await bot.waitForTicks(6)
    await bot.placeBlock(under, new Vec3(0, 1, 0))
    bot.setControlState('jump', false)
    log('UNSTUCK pillared up')
    return true
  } catch (e) { bot.setControlState('jump', false); return false }
}

async function unstick () {
  if (unsticking) return
  unsticking = true
  log('UNSTUCK triggered')
  journal('got stuck and had to dig out')
  try {
    // 1. drop whatever goal we had - most 'stuck' events are just unreachable goals
    const hadGoal = !!(bot.pathfinder && bot.pathfinder.goal)
    try { bot.pathfinder.setGoal(null) } catch {}
    bot.clearControlStates()
    if (hadGoal) {
      await bot.waitForTicks(10)
      log('UNSTUCK dropped an unreachable goal')
      return
    }

    // 2. jump and shove in a random direction
    const dirs = ['forward', 'back', 'left', 'right']
    const d = dirs[Math.floor(Math.random() * dirs.length)]
    bot.setControlState('jump', true)
    bot.setControlState(d, true)
    await bot.waitForTicks(20)
    bot.setControlState(d, false)
    bot.setControlState('jump', false)
    if (movedSince()) { log('UNSTUCK freed by jumping'); return }

    // 3. dig our way out
    await bot.look(Math.random() * Math.PI * 2, 0, true)
    if (await digAround()) {
      bot.setControlState('forward', true)
      await bot.waitForTicks(15)
      bot.setControlState('forward', false)
      if (movedSince()) { log('UNSTUCK freed by digging'); return }
    }

    // 4. build our way out of a hole
    if (await pillarUp()) {
      await bot.waitForTicks(10)
      if (movedSince()) { log('UNSTUCK freed by pillaring'); return }
    }

    // 5. last resort - abandon the job and walk home
    log('UNSTUCK still stuck, abandoning task')
    busy = false
    speak(['got myself wedged - starting over'], true)
    try { await bot.pathfinder.goto(new goals.GoalNear(HOME.x, HOME.y, HOME.z, 10)) } catch {}
  } catch (e) { log('UNSTUCK error: ' + e.message) }
  finally {
    unsticking = false
    stillFor = 0
    lastPos = bot.entity ? bot.entity.position.clone() : null
  }
}

function movedSince () {
  if (!lastPos || !bot.entity) return true
  return bot.entity.position.distanceTo(lastPos) > 1.2
}

// watch for not moving while we are supposed to be doing something
setInterval(() => {
  if (!bot.entity || unsticking || goingToBed || locked) return
  const p = bot.entity.position
  // standing still is NORMAL while digging, sleeping, or crafting - not stuck
  const legitimatelyStill = bot.targetDigBlock || bot.isSleeping ||
                            (bot.currentWindow && bot.currentWindow.type)
  if (legitimatelyStill) { stillFor = 0; lastPos = p.clone(); return }

  if (lastPos && p.distanceTo(lastPos) < 0.6) {
    // only stuck if we have an actual movement goal we are failing to reach
    const tryingToMove = follow || (bot.pathfinder && bot.pathfinder.goal)
    if (tryingToMove) stillFor += 3
    else stillFor = 0
  } else {
    stillFor = 0
  }
  lastPos = p.clone()
  if (stillFor >= 36) unstick().catch(e => log('unstick: ' + e.message))
}, 3000)

// ---------- give items to a teammate ----------------------------------
async function giveTo (who, itemName, qty) {
  busy = true
  try { return await giveInner(who, itemName, qty) } finally { busy = false }
}
async function giveInner (who, itemName, qty) {
  const target = bot.players[who] && bot.players[who].entity
  if (!target) { speak([`cannot see ${who}`], true); return false }
  const item = bot.inventory.items().find(i => i.name === itemName ||
              (itemName === 'wood' && i.name.endsWith('_planks')) ||
              (itemName === 'food' && CONTRIB.forager.includes(i.name)))
  if (!item) { speak([`no ${itemName.replace(/_/g,' ')} on me`], true); return false }
  const n = Math.min(qty || item.count, item.count)
  try {
    await bot.pathfinder.goto(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 2))
    await safeLookAt(target.position.offset(0, 1, 0), true)
    await bot.toss(item.type, null, n)
    speak([`${n} ${item.name.replace(/_/g,' ')} for you, ${who}`], true)
    log(`GAVE ${n} ${item.name} to ${who}`)
    recordEvent({ type: 'gave', to: who, what: item.name, n })
    journal(`gave ${n} ${item.name} to ${who}`)
    return true
  } catch (e) { log('give: ' + e.message); return false }
}

// ---------- stay alive unattended --------------------------------------
const EDIBLE = ['bread','cooked_cod','cooked_salmon','cod','salmon','cooked_beef','cooked_porkchop','cooked_chicken','cooked_mutton',
                'apple','carrot','baked_potato','beef','porkchop','chicken','mutton','sweet_berries']
async function eatIfHungry () {
  // eat to regenerate health too, not only when the hunger bar is low
  if (bot.food >= 16 && bot.health > 14) return false
  if (bot.food >= 20) return false
  const f = bot.inventory.items().find(i => EDIBLE.includes(i.name))
  if (!f) {
    // ask a teammate for food, once in a while
    if (Date.now() - (globalThis.lastFoodAsk || 0) > 60000) {
      globalThis.lastFoodAsk = Date.now()
      speak(['getting hungry - any food going?'], true)
    }
    return false
  }
  const before = bot.food
  try {
    await bot.equip(f, 'hand')
    // consume() is broken on this protocol - hold right-click instead
    bot.activateItem()
    await bot.waitForTicks(40)          // eating takes ~32 ticks
    bot.deactivateItem()
    await bot.waitForTicks(6)
    if (bot.food > before) { log(`ATE ${f.name} (${before} -> ${bot.food})`)
      learnSkill('hungry and carrying food', `hold right-click to eat ${f.name}`,
                 `food rose ${before} to ${bot.food}`, true, 'activateItem works; consume() does not')
      return true }
    // fall back to the library call in case it works here
    try { await bot.consume(); } catch {}
    await bot.waitForTicks(10)
    if (bot.food > before) { log(`ATE ${f.name} via consume (${before} -> ${bot.food})`); return true }
    log(`EAT FAILED ${f.name}, food still ${bot.food}`)
    return false
  } catch (e) { log('eat: ' + e.message); return false }
}

// keep them near home so they do not wander to the edge of the world
const HOME = { x: 0, y: 64, z: 0 }   // set from spawn on first join
const LEASH = 400   // speedrun: they need to range far
async function comeHomeIfLost () {
  if (!bot.entity) return false
  if (inNether()) return false      // home is an overworld coordinate - do not drag them back
  const p = bot.entity.position
  const d = Math.hypot(p.x - HOME.x, p.z - HOME.z)
  if (d < LEASH) return false
  log(`LEASH ${Math.round(d)}m from home, returning`)
  // no announcement - it was flooding chat
  try { await bot.pathfinder.goto(new goals.GoalNear(HOME.x, HOME.y, HOME.z, 8)) } catch (e) { log('leash: '+e.message) }
  return true
}





async function buildCommunalHome () {
  busy = true
  try {
    // find the real ground surface at the site, and clear the footprint
    const ox = HOME.x, oz = HOME.z
    let oy = HOME.y
    const probe = (x, z) => {
      for (let y = 120; y > 40; y--) {
        const b = bot.blockAt(new Vec3(x, y, z))
        const above = bot.blockAt(new Vec3(x, y + 1, z))
        if (b && b.name !== 'air' && !b.name.includes('water') && above && above.name === 'air') return y + 1
      }
      return null
    }
    const g = probe(ox + 5, oz + 4) || probe(ox, oz) || HOME.y
    oy = g
    log(`COMMUNAL ground at y=${oy} (HOME.y was ${HOME.y})`)

    if (inProtected(ox, oy, oz)) { log('COMMUNAL refused - inside a protected zone'); busy=false; return }
    // clear anything already occupying the footprint so we can build
    let cleared = 0
    for (let dx = -1; dx <= 11; dx++) for (let dz = -1; dz <= 9; dz++) for (let dy = 0; dy < 7; dy++) {
      const b = bot.blockAt(new Vec3(ox + dx, oy + dy, oz + dz))
      if (!b || b.name === 'air' || b.name === 'bedrock') continue
      if (b.name.includes('water') || b.name.includes('lava')) continue
      try {
        if (bot.entity.position.distanceTo(b.position) > 4) {
          await bot.pathfinder.goto(new goals.GoalNear(b.position.x, b.position.y, b.position.z, 3))
        }
        await bot.dig(b); cleared++
      } catch (e) { /* skip unreachable */ }
      if (cleared > 260) break
    }
    log(`COMMUNAL cleared ${cleared} blocks from the footprint`)
    log(`COMMUNAL build at ${ox},${oy},${oz}`)
    speak(['building the shared house'], true)
    await buildHouseInner(ox, oy, oz, 0, 1)

    // five beds along the back wall, inside
    const names = ['Claude','Woodcutter','Builder','Miner','Forager']
    const depot = readDepot()
    let placed = 0
    for (let i = 0; i < names.length; i++) {
      const bx = ox + 2 + i * 2, by = oy, bz = oz + 6
      const bedItem = bot.inventory.items().find(it => it.name.endsWith('_bed'))
      if (!bedItem) { log('COMMUNAL out of beds'); break }
      const under = bot.blockAt(new Vec3(bx, by - 1, bz))
      const at = bot.blockAt(new Vec3(bx, by, bz))
      if (!under || under.name === 'air' || !at || at.name !== 'air') continue
      try {
        await bot.pathfinder.goto(new goals.GoalNear(bx, by, bz, 2))
        await bot.equip(bedItem, 'hand')
        await bot.placeBlock(under, new Vec3(0, 1, 0))
        depot[names[i]] = depot[names[i]] || {}
        depot[names[i]].bed = { x: bx, y: by, z: bz }
        placed++
        log(`COMMUNAL bed for ${names[i]} at ${bx},${by},${bz}`)
      } catch (e) { log('communal bed: ' + e.message) }
    }
    writeDepot(depot)
    speak([placed ? `${placed} beds in the shared house` : 'no beds to place yet'], true)
    journal(`built the communal house at ${ox},${oy},${oz} with ${placed} beds`)
  } catch (e) { log('COMMUNAL ' + e.message) }
  busy = false
}

// ---------- per-bot memory: journal by day, wiki by night ---------------
const MEMDIR = path.join(DIR, 'memory', NAME)
const PAGES = ['world', 'teammates', 'tasks', 'lessons']

function journal (line) {
  try {
    const t = new Date().toISOString().slice(0, 16).replace('T', ' ')
    fs.appendFileSync(path.join(MEMDIR, 'journal.md'), `- ${t} ${line}\n`)
  } catch (e) { log('journal: ' + e.message) }
}

function readPage (p) {
  try { return fs.readFileSync(path.join(MEMDIR, p + '.md'), 'utf8') } catch { return '' }
}
function writePage (p, body) {
  try { fs.writeFileSync(path.join(MEMDIR, p + '.md'), body) ; return true }
  catch (e) { log('writePage ' + p + ': ' + e.message); return false }
}

// what the bot knows, injected into every decision
function wikiContext () {
  const w = readPage('world').slice(0, 700)
  const l = readPage('lessons').slice(0, 700)
  const t = readPage('tasks').slice(0, 400)
  return `What you remember:\n${w}\n${t}\n${l}`.slice(0, 1600)
}


// ---------- shared skill memory ----------------------------------------
// A team-wide, append-only log of what actually worked and what did not.
//
// Two rules make this different from the nightly wiki compile, which is known
// to confabulate (wiki/wiki-memory.md invented a coordinate and a teammate
// interaction that never happened):
//
//   1. A skill is only written from a VERIFIED world-state change - food
//      actually rose, the obsidian count actually went up, the portal actually
//      lit. Never from the model's claim about what it did.
//   2. It is shared. One bot paying the cost of learning something means all
//      six know it on their next cycle.
//
// Retrieval is injected LAST in the prompt. Ollama caches the longest identical
// prefix and we measured 41-54x on prompt eval from that; per-situation text
// placed early would destroy it for every call.
const SKILLS = path.join(DIR, 'skills.jsonl')

const STOP = new Set(['the','a','an','and','or','to','of','for','in','on','at','is','it',
  'you','your','i','my','me','we','with','no','not','have','has','was','were','be','been',
  'this','that','there','here','from','but','if','then','than','so','do','does','did'])

function keywords (text) {
  return [...new Set(String(text).toLowerCase().match(/[a-z_]{3,}/g) || [])]
    .filter(w => !STOP.has(w))
}

function learnSkill (trigger, action, outcome, ok, evidence) {
  try {
    const rec = { t: new Date().toISOString().slice(0, 16).replace('T', ' '),
                  by: NAME, trigger, action, outcome, ok: !!ok, evidence: evidence || '' }
    // do not write the same lesson twice in a row
    const prev = recallAll().slice(-40)
    if (prev.some(p => p.trigger === trigger && p.action === action && p.ok === rec.ok)) return
    fs.appendFileSync(SKILLS, JSON.stringify(rec) + '\n')
    log(`LEARNED ${ok ? 'works' : 'fails'}: ${action} when ${trigger}`)
  } catch (e) { log('learnSkill: ' + e.message) }
}

function recallAll () {
  try {
    return fs.readFileSync(SKILLS, 'utf8').trim().split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  } catch { return [] }
}

// Score every remembered skill against the situation and return the best few.
function recallSkills (situation, n) {
  const want = new Set(keywords(situation))
  if (!want.size) return []
  const all = recallAll()
  const scored = all.map((s, i) => {
    const kw = keywords(s.trigger + ' ' + s.action + ' ' + s.outcome)
    let overlap = 0
    for (const w of kw) if (want.has(w)) overlap++
    if (!overlap) return null
    // prefer relevant, then recent, and slightly prefer failures - knowing what
    // does NOT work is what stops a bot repeating an hour-long dead end
    const recency = i / Math.max(all.length, 1)
    return { s, score: overlap + recency * 0.5 + (s.ok ? 0 : 0.3) }
  }).filter(Boolean).sort((a, b) => b.score - a.score)
  return scored.slice(0, n || 3).map(x => x.s)
}

function skillContext (situation) {
  const hits = recallSkills(situation, 3)
  if (!hits.length) return ''
  return 'What the team has learned that applies right now:\n' +
    hits.map(s => `- ${s.ok ? 'WORKS' : 'DOES NOT WORK'}: ${s.action} when ${s.trigger}` +
                  (s.evidence ? ` (${s.evidence})` : '') + ` [${s.by}]`).join('\n')
}

// ---------- sleeping and dreaming --------------------------------------
let dreamt = false
let goingToBed = false

async function goToBed () {
  goingToBed = true
  busy = true
  try { return await goToBedInner() } finally { goingToBed = false; busy = false }
}
async function goToBedInner () {
  const depot = readDepot()
  const mine = depot[NAME] && depot[NAME].bed
  let bedBlock = null
  if (mine) {
    const b = bot.blockAt(new Vec3(mine.x, mine.y, mine.z))
    if (b && b.name.endsWith('_bed')) bedBlock = b
  }
  if (!bedBlock) {
    const ids = Object.values(bot.registry.blocksByName)
      .filter(b => b.name.endsWith('_bed')).map(b => b.id)
    bedBlock = bot.findBlock({ matching: ids, maxDistance: 32 })
  }
  if (!bedBlock) { log('SLEEP no bed found'); return false }
  busy = true
  try {
    for (let a = 0; a < 4; a++) {
      try {
        await bot.pathfinder.goto(new goals.GoalNear(bedBlock.position.x, bedBlock.position.y, bedBlock.position.z, 1))
        if (bot.entity.position.distanceTo(bedBlock.position) < 3) break
      } catch (e) {
        log(`SLEEP walk ${a+1}: ${e.message}`)
        try { bot.pathfinder.setGoal(null) } catch {}
        await bot.waitForTicks(30)     // let the old goal settle before retrying
      }
    }
    const dist = bot.entity.position.distanceTo(bedBlock.position)
    if (dist > 3.5) { log(`SLEEP too far from bed (${dist.toFixed(1)}m)`); busy = false; return false }
    await bot.lookAt(bedBlock.position.offset(0.5, 0.5, 0.5), true)
    await bot.waitForTicks(6)
    const fresh = bot.blockAt(bedBlock.position)
    if (!fresh || !fresh.name.endsWith('_bed')) { log('SLEEP bed vanished'); busy = false; return false }
    await bot.sleep(fresh)
    log('SLEEP in bed')
    speak(['night all'], true)
    busy = false
    return true
  } catch (e) { log('SLEEP failed: ' + e.message); busy = false; return false }
}

// the dream: compile today's journal into the wiki
async function dream () {
  if (!USE_LLM) return
  busy = true
  try {
    const raw = readPage('journal')
    const recent = raw.split('\n').slice(-60).join('\n')
    log('DREAM compiling ' + recent.split('\n').length + ' journal lines')

    for (const page of PAGES) {
      const current = readPage(page)
      const extra = page === 'teammates'
        ? `\n\nVERIFIED interactions - use ONLY these, invent nothing:\n${relationContext()}\n`
        : ''
      const prompt = `You are ${NAME}, the ${ROLE} in a Minecraft team.
You are asleep, consolidating the day into your long-term notes.
The only players that exist are: Claude, Woodcutter, Builder, Miner, Forager,
Fighter, and Ben (the human). Never write about anyone else.
Never invent coordinates - if you do not know a real one, omit it.${extra}

Your "${page}" page currently says:
---
${current.slice(0, 1500)}
---

Today's raw journal:
---
${recent.slice(0, 2500)}
---

YOUR JOB IS: ${MY_STAR.job}
YOU DID WELL TODAY IF: ${MY_STAR.win}
YOU DID BADLY IF: ${MY_STAR.fail}

Judge today against THAT job. Not against a general idea of a good day.

Rewrite the "${page}" page. Rules:
- Keep it under 40 lines of markdown, starting with "# ${NAME} — ${page}".
- Every line must trace to something in the raw journal above. If the journal
  does not show it, do not write it. A short honest page beats a full invented one.
- Record specifics: coordinates, item counts, teammate names. Not vague summaries.
- Edit existing lines rather than piling on new ones. Resolve contradictions; newer evidence wins.
- You are a character in a game, not an employee. Never propose meetings,
  syncs, reviews, alignment, stakeholders, processes, strategies or plans-to-plan.
  The only things you can actually do are mine, chop, forage, farm, fish, build,
  fight, carry items and talk. Write about those.
- ${page === 'lessons' ? 'Focus on where you fell short of YOUR JOB and what you will do differently. This is the most valuable page.' : ''}
- ${page === 'tasks' ? 'End with one line: "Tomorrow: <what I will do>" - and it must serve your job.' : ''}
Reply with ONLY the markdown for the page, no preamble.`

      try {
        const ac2 = new AbortController()
        const t2 = setTimeout(() => ac2.abort(), 90000)
        let res
        try {
          res = await fetch(LLM_URL, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            signal: ac2.signal,
            body: JSON.stringify({ model: DREAM_MODEL, prompt, stream: false,
              keep_alive: '30m', think: false,
              options: { num_predict: 500, temperature: 0.6, num_ctx: 8192 } })
          })
        } finally { clearTimeout(t2) }
        const data = await res.json()
        let body = (data.response || '')
        // qwen3 wraps reasoning in <think>...</think> - drop it
        body = body.replace(/<think>[\s\S]*?<\/think>/g, '')
                   .replace(/^```(?:markdown)?/gm, '').replace(/```$/gm, '').trim()
        const bad = auditPage(body)
        if (bad.length) log(`DREAM ${page} REJECTED LINES: ${bad.slice(0,3).join(' | ')}`)
        body = stripBadLines(body)
        if (body.length > 30) { writePage(page, body); log(`DREAM updated ${page} (${body.length} chars${bad.length ? ', ' + bad.length + ' dropped' : ''})`) }
        else log(`DREAM ${page} empty. raw was: ${(data.response||'(nothing)').slice(0,160)}`)
      } catch (e) { log(`DREAM ${page}: ${e.message}`) }
    }

    // refresh the index
    writePage('wiki', `# ${NAME}\n\nI am the team's ${ROLE}.\nLast compiled: ${new Date().toISOString().slice(0,16).replace('T',' ')}\n\n`
      + PAGES.map(p => `- [${p}](${p}.md)`).join('\n') + '\n')
    log('DREAM done')
  } catch (e) { log('DREAM error: ' + e.message) }
  busy = false
}

// night watch: when it gets dark, go to bed and dream once
setInterval(async () => {
  if (!bot.time) return
  const night = bot.time.timeOfDay > 12800 && bot.time.timeOfDay < 23000
  if (night && !dreamt && !fleeing) {
    dreamt = true
    const inBed = await goToBed()
    await dream()
    if (inBed) { try { await bot.wake() } catch {} }
  }
  if (!night) dreamt = false
}, 20000)

// ---------- wool and beds ----------------------------------------------
const WOOLS = ['white_wool','light_gray_wool','gray_wool','black_wool','brown_wool',
               'red_wool','orange_wool','yellow_wool','lime_wool','green_wool',
               'cyan_wool','light_blue_wool','blue_wool','purple_wool','magenta_wool','pink_wool']

function woolCount () { return WOOLS.reduce((n, w) => n + count(w), 0) }

async function getWool (target) {
  busy = true
  try {
    const want = target || 3
    speak([`off to find sheep - need ${want} wool`], true)
    let rounds = 0
    while (woolCount() < want && rounds++ < 10) {
      const sheep = bot.nearestEntity(e => (e.type === 'animal' || e.type === 'mob') && e.name === 'sheep' &&
        e.position.distanceTo(bot.entity.position) < 48)
      if (!sheep) {
        log('WOOL no sheep nearby, wandering')
        const p = bot.entity.position.floored()
        try {
          await bot.pathfinder.goto(new goals.GoalNear(
            p.x + Math.floor((Math.random()-0.5)*50), p.y, p.z + Math.floor((Math.random()-0.5)*50), 4))
        } catch (e) { log('wool wander: ' + e.message) }
        continue
      }
      try {
        await bot.pathfinder.goto(new goals.GoalNear(sheep.position.x, sheep.position.y, sheep.position.z, 2))
        // shears if we have them (sheep survives), otherwise hit it
        const shears = bot.inventory.items().find(i => i.name === 'shears')
        if (shears) {
          await bot.equip(shears, 'hand')
          await bot.activateEntity(sheep)
          log('WOOL sheared a sheep')
        } else {
          const w = bot.inventory.items().find(i => i.name.includes('sword') || i.name.includes('axe'))
          if (w) await bot.equip(w, 'hand')
          for (let i = 0; i < 10 && sheep.isValid; i++) { await bot.attack(sheep); await bot.waitForTicks(10) }
          log('WOOL killed a sheep')
        }
        await bot.waitForTicks(25)   // let the drop be picked up
      } catch (e) { log('WOOL: ' + e.message) }
    }
    speak([woolCount() ? `got ${woolCount()} wool` : 'no sheep about'], true)
    log(`WOOL total ${woolCount()}`)
  } catch (e) { log('WOOL error ' + e.message) }
  busy = false
}

async function makeBed () {
  busy = true
  try {
    if (woolCount() < 3) { busy = false; await getWool(3); busy = true }
    if (woolCount() < 3) { speak(['not enough wool for a bed yet'], true); busy = false; locked = false; return }
    await makePlanksInner()
    if (count('oak_planks') + count('birch_planks') < 3) {
      busy = false; await chopInner(4); busy = true
      await makePlanksInner()
    }
    let table = bot.findBlock({ matching: bot.registry.blocksByName.crafting_table.id, maxDistance: 16 })
    if (!table) {
      if (!count('crafting_table')) await craftItem('crafting_table', 1, null)
      const it = bot.inventory.items().find(i => i.name === 'crafting_table')
      if (it) {
        const p = bot.entity.position.floored()
        for (const off of [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]]) {
          const spot = p.offset(off[0],0,off[2])
          const at = bot.blockAt(spot), un = bot.blockAt(spot.offset(0,-1,0))
          if (!at || at.name !== 'air' || !un || un.name === 'air') continue
          try { await bot.equip(it,'hand'); await bot.placeBlock(un, new Vec3(0,1,0)); break } catch {}
        }
      }
      table = bot.findBlock({ matching: bot.registry.blocksByName.crafting_table.id, maxDistance: 16 })
    }
    if (!table) { speak(['need a crafting table for a bed'], true); busy = false; locked = false; return }

    // a bed needs 3 wool of the SAME colour
    const colour = WOOLS.find(w => count(w) >= 3)
    if (!colour) { speak([`have ${woolCount()} wool but not 3 of one colour`], true); busy = false; locked = false; return }
    const bedName = colour.replace('_wool', '_bed')
    await craftItem(bedName, 1, table)
    if (!count(bedName)) { speak(['bed would not craft'], true); busy = false; locked = false; return }

    // place it near home
    const bedItem = bot.inventory.items().find(i => i.name === bedName)
    const p = bot.entity.position.floored()
    for (const off of [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[2,0,0],[0,0,2]]) {
      const spot = p.offset(off[0], 0, off[2])
      const at = bot.blockAt(spot), un = bot.blockAt(spot.offset(0,-1,0))
      const nextTo = bot.blockAt(spot.offset(off[0] ? Math.sign(off[0]) : 0, 0, off[2] ? Math.sign(off[2]) : 0))
      if (!at || at.name !== 'air' || !un || un.name === 'air') continue
      try {
        await bot.equip(bedItem, 'hand')
        await bot.placeBlock(un, new Vec3(0,1,0))
        const d = readDepot(); d[NAME] = d[NAME] || {}
        d[NAME].bed = { x: spot.x, y: spot.y, z: spot.z }; writeDepot(d)
        speak(['bed is down - that is mine'], true)
        log(`BED placed at ${spot.x},${spot.y},${spot.z}`)
        busy = false; return
      } catch (e) { log('bed place: ' + e.message) }
    }
    speak(['nowhere flat to put the bed'], true)
  } catch (e) { log('BED error ' + e.message) }
  busy = false
}

// ---------- fishing ----------------------------------------------------
async function ensureRod () {
  if (count('fishing_rod')) {
    const r = bot.inventory.items().find(i => i.name === 'fishing_rod')
    await bot.equip(r, 'hand'); return true
  }
  // rod = 3 sticks + 2 string
  if (count('stick') < 3) {
    await makePlanksInner()
    await craftItem('stick', 2, null)
  }
  if (count('string') < 2) {
    speak(['need string for a rod - anyone got any?'], true)
    log('ROD missing string')
    return false
  }
  let table = bot.findBlock({ matching: bot.registry.blocksByName.crafting_table.id, maxDistance: 16 })
  if (!table) {
    if (!count('crafting_table')) await craftItem('crafting_table', 1, null)
    const it = bot.inventory.items().find(i => i.name === 'crafting_table')
    if (it) {
      const p = bot.entity.position.floored()
      for (const off of [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]]) {
        const spot = p.offset(off[0],0,off[2])
        const at = bot.blockAt(spot), un = bot.blockAt(spot.offset(0,-1,0))
        if (!at || at.name !== 'air' || !un || un.name === 'air') continue
        try { await bot.equip(it,'hand'); await bot.placeBlock(un, new Vec3(0,1,0)); break } catch {}
      }
    }
    table = bot.findBlock({ matching: bot.registry.blocksByName.crafting_table.id, maxDistance: 16 })
  }
  if (!table) return false
  await craftItem('fishing_rod', 1, table)
  const r = bot.inventory.items().find(i => i.name === 'fishing_rod')
  if (r) { await bot.equip(r, 'hand'); speak(['rod made - off to the water'], true); return true }
  return false
}

async function goFish (casts) {
  busy = true
  try {
    if (!await ensureRod()) { busy = false; locked = false; return }

    const waterId = bot.registry.blocksByName.water.id

    // find OPEN water: a water block with air above it, part of a real body
    const candidates = bot.findBlocks({ matching: waterId, maxDistance: 64, count: 200 })
    log(`FISH scanning ${candidates.length} water blocks`)
    // pick water that is BOTH open surface AND has a reachable bank
    let pool = null, stand = null
    const standable = (p) => {
      const feet = bot.blockAt(p)
      const head = bot.blockAt(p.offset(0, 1, 0))
      const under = bot.blockAt(p.offset(0, -1, 0))
      return feet && feet.name === 'air' && head && head.name === 'air' &&
             under && under.name !== 'air' &&
             !under.name.includes('water') && !under.name.includes('lava')
    }
    for (const p of candidates) {
      const above = bot.blockAt(p.offset(0, 1, 0))
      if (!above || above.name !== 'air') continue          // must be surface water
      let neighbours = 0
      for (const d of [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[1,0,1],[-1,0,-1],[1,0,-1],[-1,0,1]]) {
        const n = bot.blockAt(p.offset(d[0], 0, d[2]))
        if (n && n.name === 'water') neighbours++
      }
      if (neighbours < 3) continue                           // a real body, not a puddle
      // is there anywhere to stand within a few blocks?
      let bank = null
      for (let r = 1; r <= 5 && !bank; r++) {
        for (let dx = -r; dx <= r && !bank; dx++) {
          for (let dz = -r; dz <= r && !bank; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
            for (const dy of [0, 1, -1]) {
              const c = p.offset(dx, dy, dz)
              if (standable(c)) { bank = c; break }
            }
          }
        }
      }
      if (!bank) continue
      pool = p; stand = bank
      break
    }
    if (!pool || !stand) {
      speak(['no water with a bank I can stand on'], true)
      log('FISH no reachable water found')
      busy = false; return
    }
    log(`FISH pool ${pool.x},${pool.y},${pool.z} bank ${stand.x},${stand.y},${stand.z}`)

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await bot.pathfinder.goto(new goals.GoalNear(stand.x, stand.y, stand.z, 1))
        break
      } catch (e) {
        log(`FISH walk attempt ${attempt + 1}: ${e.message}`)
        await bot.waitForTicks(10)
      }
    }

    // confirm we really are beside water before casting a single time
    const here = bot.entity.position.floored()
    let adjacent = false
    outer:
    for (let dx = -3; dx <= 3; dx++) for (let dy = -2; dy <= 1; dy++) for (let dz = -3; dz <= 3; dz++) {
      const b = bot.blockAt(here.offset(dx, dy, dz))
      if (b && b.name === 'water') { adjacent = true; break outer }
    }
    if (!adjacent) {
      speak(['could not reach the water - not casting'], true)
      log(`FISH aborted, not beside water (at ${here.x},${here.y},${here.z})`)
      busy = false; return
    }
    log(`FISH standing at ${here.x},${here.y},${here.z}, water confirmed adjacent`)
    speak(['right, fishing'], true)

    const n = casts || 6
    let landed = 0, misses = 0
    for (let i = 0; i < n && misses < 3; i++) {
      try {
        const rod = bot.inventory.items().find(x => x.name === 'fishing_rod')
        if (!rod) { log('FISH rod broke'); break }
        await bot.equip(rod, 'hand')
        await safeLookAt(pool.offset(0.5, 0.9, 0.5), true)   // aim at the water surface
        await bot.fish()
        landed++
      } catch (e) {
        misses++
        log('FISH cast failed: ' + e.message)
        await bot.waitForTicks(20)
      }
    }
    const fishNow = ['cod','salmon','tropical_fish','pufferfish','cooked_cod','cooked_salmon']
      .reduce((a, f) => a + count(f), 0)
    speak([landed ? `caught ${landed} - ${fishNow} fish on me` : 'nothing biting'], true)
    log(`FISH done: ${landed} landed, ${misses} misses, holding ${fishNow} fish`)
    journal(`fished at ${pool.x},${pool.y},${pool.z}, ${landed} casts, ${fishNow} fish`)
  } catch (e) { log('FISH ' + e.message) }
  busy = false
}

// ---------- miner: actually go deep for ore ----------------------------
const ORES = ['diamond_ore','deepslate_diamond_ore','iron_ore','deepslate_iron_ore',
              'coal_ore','deepslate_coal_ore','gold_ore','deepslate_gold_ore',
              'copper_ore','deepslate_copper_ore','redstone_ore','lapis_ore']
async function mineDeep (targetY) {
  busy = true
  try {
    if (!PICKS.some(p => count(p))) {
      log('MINEDEEP no pickaxe, trying to make one')
      busy = false; await ensureTool('pick'); busy = true
    }
    if (!PICKS.some(p => count(p))) {
      speak(['my pickaxe broke - anyone spare one?'], true)
      busy = false; return
    }
    const goalY = targetY || 12
    speak([`digging down to y ${goalY}`], true)
    const FLOOR = 4      // below this it is nearly all lava lakes
    let guard = 0
    let lastY = Math.round(bot.entity.position.y)
    let noProgress = 0
    let relocations = 0

    while (bot.entity.position.y > goalY && bot.entity.position.y > FLOOR && guard++ < 400) {
      const p = bot.entity.position.floored()
      const below = bot.blockAt(p.offset(0, -1, 0))
      const below2 = bot.blockAt(p.offset(0, -2, 0))
      // scan 6 blocks down - falling into a hidden lava pocket is what kills them
      const column = []
      for (let dy = -1; dy >= -6; dy--) column.push(bot.blockAt(p.offset(0, dy, 0)))

      // never dig into lava or water
      const bad = b => b && (b.name.includes('lava') || b.name.includes('water'))
      // check a 3-block shell, not just the immediate neighbours
      const shell = []
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = -2; dy <= 1; dy++) {
        shell.push(bot.blockAt(p.offset(dx, dy, dz)))
      }
      if (bad(below) || bad(below2) || column.some(bad) || shell.some(bad)) {
        log('MINEDEEP fluid below, stepping aside')
        try { await bot.pathfinder.goto(new goals.GoalXZ(p.x + 3, p.z + 3)) } catch {}
        continue
      }
      if (!below || below.name === 'air') {
        // already a drop - let gravity do the work
        await bot.waitForTicks(8)
      } else if (below.name === 'bedrock') {
        log('MINEDEEP hit bedrock'); break
      } else {
        try {
          await equipBestPick()
          await bot.dig(below)
          await bot.waitForTicks(8)      // fall into the hole we just made
        } catch (e) {
          log('dig down: ' + e.message)
          try { await bot.pathfinder.goto(new goals.GoalXZ(p.x + 2, p.z + 2)) } catch {}
        }
      }

      const nowY = Math.round(bot.entity.position.y)
      if (nowY >= lastY) { noProgress++ } else { noProgress = 0; lastY = nowY }
      if (noProgress > 12) {
        relocations++
        if (relocations > 4) { log(`MINEDEEP giving up at y=${nowY} after ${relocations} moves`); break }
        log(`MINEDEEP stuck at y=${nowY}, relocating (${relocations})`)
        const ang = Math.random() * Math.PI * 2
        const nx = p.x + Math.round(Math.cos(ang) * 12)
        const nz = p.z + Math.round(Math.sin(ang) * 12)
        try { await bot.pathfinder.goto(new goals.GoalNear(nx, p.y, nz, 3)) } catch (e) { log('relocate: ' + e.message) }
        await bot.waitForTicks(20)
        noProgress = 0
      }
      if (bot.health < 8) { speak(['too dangerous down here'], true); break }
      if (guard % 25 === 0) log(`MINEDEEP descending, y=${nowY}`)
    }
    log(`MINEDEEP reached y=${Math.round(bot.entity.position.y)}`)

    await dumpJunk(16)
    // now hunt ore at depth
    const ids = ORES.map(n=>bot.registry.blocksByName[n]).filter(Boolean).map(b=>b.id)
    const found = bot.findBlocks({ matching: ids, maxDistance: 96, count: 60 })
    log(`MINEDEEP at y=${Math.round(bot.entity.position.y)}, ${found.length} ore blocks visible`)
    let got = 0
    for (const p of found) {
      if (got >= 24) break
      try {
        await bot.pathfinder.goto(new goals.GoalNear(p.x,p.y,p.z,2))
        await equipBestPick()
        const b = bot.blockAt(p); if (!b) continue
        await bot.dig(b); await bot.waitForTicks(8); got++
      } catch (e) { log('ore: ' + e.message) }
    }
    const summary = ['diamond','raw_iron','coal','raw_gold','raw_copper','redstone','lapis_lazuli']
      .map(n => count(n) ? `${count(n)} ${n}` : null).filter(Boolean).join(', ')
    speak([summary ? `got ${summary}` : 'not much ore down here'], true)
    log('MINEDEEP result: ' + (summary || 'nothing'))
    journal(`mined deep at y${Math.round(bot.entity.position.y)}: ${summary || 'nothing'}`)
  } catch (e) { log('MINEDEEP ' + e.message) }
  busy = false
}

// ---------- roles and the shared depot --------------------------------
const BOTS = ['Claude','Woodcutter','Builder','Miner','Forager','Fighter']
const ROLES = { Claude: 'leader', Woodcutter: 'gatherer', Builder: 'crafter',
                Miner: 'miner', Forager: 'scout', Fighter: 'fighter' }
const ROLE = ROLES[NAME] || 'woodcutter'
const DEPOT = path.join(DIR, 'depot.json')

const KEEP = ['stone_axe','wooden_axe','iron_axe','stone_pickaxe','wooden_pickaxe','iron_pickaxe',
              'stone_sword','wooden_sword','crafting_table']
// what each role hands in to its own chest
const CONTRIB = {
  director:   ['oak_log','birch_log','oak_planks','cobblestone'],
  fighter:    ['rotten_flesh','bone','string','arrow','gunpowder','spider_eye','ender_pearl','blaze_rod'],
  woodcutter: ['oak_log','birch_log','spruce_log','oak_planks','birch_planks','stick','oak_sapling'],
  builder:    ['cobblestone','dirt'],
  miner:      ['cobblestone','coal','raw_iron','iron_ingot','stone','andesite','diorite','granite','flint'],
  forager:    ['cod','salmon','cooked_cod','cooked_salmon','tropical_fish','apple','wheat','bread','carrot','potato','beetroot','wheat_seeds','beef','porkchop','chicken','mutton',
               'cooked_beef','sweet_berries','wheat_seeds','egg']
}

function readDepot () {
  try { return JSON.parse(fs.readFileSync(DEPOT, 'utf8')) } catch { return {} }
}
function writeDepot (d) {
  try { fs.writeFileSync(DEPOT, JSON.stringify(d, null, 2)) } catch {}
}

async function ensureChest () {
  const depot = readDepot()
  const mine = depot[NAME]
  if (mine) {
    const b = bot.blockAt(new Vec3(mine.x, mine.y, mine.z))
    if (b && b.name === 'chest') return b
  }
  // need a chest item
  if (!count('chest')) {
    await makePlanksInner()
    const planks = count('oak_planks') + count('birch_planks')
    if (planks < 8) { speak(['need more wood for a chest']); return null }

    // a chest needs a 3x3 grid, so we must have a crafting table down
    let table = bot.findBlock({ matching: bot.registry.blocksByName.crafting_table.id, maxDistance: 16 })
    if (!table) {
      if (!count('crafting_table')) await craftItem('crafting_table', 1, null)  // 2x2, no table needed
      const it = bot.inventory.items().find(i => i.name === 'crafting_table')
      if (it) {
        const p = bot.entity.position.floored()
        for (const off of [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]]) {
          const spot = p.offset(off[0], 0, off[2])
          const at = bot.blockAt(spot), under = bot.blockAt(spot.offset(0,-1,0))
          if (!at || at.name !== 'air' || !under || under.name === 'air') continue
          try { await bot.equip(it,'hand'); await bot.placeBlock(under, new Vec3(0,1,0)); break } catch (e) {}
        }
      }
      table = bot.findBlock({ matching: bot.registry.blocksByName.crafting_table.id, maxDistance: 16 })
    }
    if (!table) { speak(['cannot get a crafting table down']); return null }
    try { await bot.pathfinder.goto(new goals.GoalNear(table.position.x, table.position.y, table.position.z, 2)) } catch {}
    await craftItem('chest', 1, table)
  }
  const item = bot.inventory.items().find(i => i.name === 'chest')
  if (!item) return null
  // place it beside where I'm standing
  const p = bot.entity.position.floored()
  for (const off of [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[2,0,0],[0,0,2]]) {
    const spot = p.offset(off[0], 0, off[2])
    const at = bot.blockAt(spot)
    const under = bot.blockAt(spot.offset(0,-1,0))
    if (!at || at.name !== 'air' || !under || under.name === 'air') continue
    try {
      await bot.equip(item, 'hand')
      await bot.placeBlock(under, new Vec3(0,1,0))
      const d = readDepot(); d[NAME] = { x: spot.x, y: spot.y, z: spot.z, role: ROLE }; writeDepot(d)
      speak([`chest down - that's the ${ROLE} store`], true)
      log(`CHEST placed at ${spot.x},${spot.y},${spot.z}`)
      return bot.blockAt(spot)
    } catch (e) { log('chest place: ' + e.message) }
  }
  return null
}

async function depositAll () { await depositAllInner() }
async function depositAllInner () {
  let chest
  try { chest = await ensureChest() } catch (e) { log('ensureChest: ' + e.message); return }
  if (!chest || !chest.position) { speak(['no chest yet - need wood for one']); return }
  const cp = chest.position.clone()
  try { await bot.pathfinder.goto(new goals.GoalNear(cp.x, cp.y, cp.z, 2)) } catch (e) { log('walk to chest: ' + e.message) }
  const live = bot.blockAt(cp)
  if (!live || live.name !== 'chest') { log('chest gone at ' + cp); return }
  let win
  try { win = await bot.openContainer(live) } catch (e) { log('open chest: '+e.message); return }
  let n = 0
  for (const it of bot.inventory.items()) {
    if (KEEP.includes(it.name)) continue
    try { await win.deposit(it.type, null, it.count); n += it.count } catch (e) { log('deposit: '+e.message) }
  }
  try { win.close() } catch {}
  if (n) speak([`${n} ${ROLE === 'forager' ? 'bits of food' : ROLE === 'miner' ? 'stone and ore' : 'wood'} into my chest`,
                `stocked my chest with ${n}`])
  else speak(['nothing to store yet'])
  log(`DEPOSIT ${n} items`)
  journal(`stored ${n} items in my chest`)
}

// take items from whichever chest has them
async function fetchItem (want, qty) {
  const depot = readDepot()
  for (const [owner, c] of Object.entries(depot)) {
    const block = bot.blockAt(new Vec3(c.x, c.y, c.z))
    if (!block || block.name !== 'chest') continue
    try {
      await bot.pathfinder.goto(new goals.GoalNear(c.x, c.y, c.z, 2))
      const win = await bot.openContainer(bot.blockAt(new Vec3(c.x, c.y, c.z)))
      const found = win.containerItems().filter(i => i.name === want)
      let got = 0
      for (const f of found) {
        if (got >= qty) break
        const take = Math.min(f.count, qty - got)
        try { await win.withdraw(f.type, null, take); got += take } catch (e) { log('withdraw: '+e.message) }
      }
      try { win.close() } catch {}
      if (got) { speak([`got ${got} ${want.replace(/_/g,' ')} from ${owner}'s chest`]); return got }
    } catch (e) { log('fetch from '+owner+': '+e.message) }
  }
  return 0
}

// ---------- forager: find food ----------------------------------------
const FOOD_MOBS = ['cow','pig','chicken','sheep','rabbit']
async function forage () { busy=true; await forageInner(); busy=false }
async function forageInner () {
  speak(['off to find food'])
  try {
    for (let round = 0; round < 6; round++) {
      const prey = bot.nearestEntity(e => (e.type === 'animal' || e.type === 'mob') && FOOD_MOBS.includes(e.name) &&
        e.position.distanceTo(bot.entity.position) < 40)
      if (prey) {
        try {
          await bot.pathfinder.goto(new goals.GoalNear(prey.position.x, prey.position.y, prey.position.z, 2))
          const sword = bot.inventory.items().find(i => i.name.includes('sword') || i.name.includes('axe'))
          if (sword) await bot.equip(sword, 'hand')
          for (let i = 0; i < 8 && prey.isValid; i++) { await bot.attack(prey); await bot.waitForTicks(12) }
          await bot.waitForTicks(20)
        } catch (e) { log('hunt: ' + e.message) }
      } else {
        // break grass and leaves for seeds and apples
        const ids = ['short_grass','tall_grass','oak_leaves','grass']
          .map(n => bot.registry.blocksByName[n]).filter(Boolean).map(b => b.id)
        const spots = bot.findBlocks({ matching: ids, maxDistance: 32, count: 10 })
        for (const p of spots.slice(0, 6)) {
          try {
            await bot.pathfinder.goto(new goals.GoalNear(p.x, p.y, p.z, 2))
            await bot.dig(bot.blockAt(p)); await bot.waitForTicks(10)
          } catch {}
        }
      }
    }
    const food = bot.inventory.items().filter(i => CONTRIB.forager.includes(i.name))
      .reduce((n,i)=>n+i.count,0)
    speak([`got ${food} bits of food`, food ? 'dinner sorted' : 'not much about'])
  } catch (e) { log('FORAGE ' + e.message) }
}


// ---------- farming: till, plant, harvest ------------------------------
const SEEDS = { wheat_seeds: 'wheat', carrot: 'carrots', potato: 'potatoes', beetroot_seeds: 'beetroots' }
const CROPS = ['wheat', 'carrots', 'potatoes', 'beetroots']

async function ensureHoe () {
  const hoes = ['iron_hoe','stone_hoe','wooden_hoe']
  for (const h of hoes) { const it = bot.inventory.items().find(i=>i.name===h); if (it) { await bot.equip(it,'hand'); return true } }
  if (totalLogs() < 2 && count('oak_planks') < 4) await chopInner(4)
  await makePlanksInner()
  if (!count('stick')) await craftItem('stick', 1, null)
  let table = bot.findBlock({ matching: bot.registry.blocksByName.crafting_table.id, maxDistance: 16 })
  if (!table) {
    if (!count('crafting_table')) await craftItem('crafting_table', 1, null)
    const it = bot.inventory.items().find(i=>i.name==='crafting_table')
    if (it) {
      const p = bot.entity.position.floored()
      for (const off of [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]]) {
        const spot=p.offset(off[0],0,off[2]); const at=bot.blockAt(spot), un=bot.blockAt(spot.offset(0,-1,0))
        if (!at||at.name!=='air'||!un||un.name==='air') continue
        try { await bot.equip(it,'hand'); await bot.placeBlock(un,new Vec3(0,1,0)); break } catch {}
      }
    }
    table = bot.findBlock({ matching: bot.registry.blocksByName.crafting_table.id, maxDistance: 16 })
  }
  if (!table) return false
  try { await bot.pathfinder.goto(new goals.GoalNear(table.position.x,table.position.y,table.position.z,2)) } catch {}
  await craftItem('wooden_hoe', 1, table)
  const it2 = bot.inventory.items().find(i=>i.name==='wooden_hoe')
  if (it2) { await bot.equip(it2,'hand'); return true }
  return false
}

async function harvestReady () {
  const ids = CROPS.map(n=>bot.registry.blocksByName[n]).filter(Boolean).map(b=>b.id)
  if (!ids.length) return 0
  const found = bot.findBlocks({ matching: ids, maxDistance: 24, count: 24 })
  let n = 0
  for (const p of found) {
    const b = bot.blockAt(p)
    if (!b) continue
    // only fully grown (age 7, or 3 for beetroot)
    const age = b.getProperties ? b.getProperties().age : undefined
    const ripe = b.name === 'beetroots' ? age >= 3 : age >= 7
    if (!ripe) continue
    try {
      await bot.pathfinder.goto(new goals.GoalNear(p.x,p.y,p.z,1))
      await bot.dig(b); await bot.waitForTicks(6); n++
    } catch (e) { log('harvest: ' + e.message) }
  }
  return n
}

async function farm () {
  busy = true
  try {
    const picked = await harvestReady()
    if (picked) speak([`picked ${picked} crops`], true)

    // need seeds? break grass for them
    const seedName = Object.keys(SEEDS).find(k => count(k))
    if (!seedName) {
      const gid = ['short_grass','tall_grass','grass','fern','large_fern','tall_seagrass']
        .map(n=>bot.registry.blocksByName[n]).filter(Boolean).map(b=>b.id)
      log('FARM seed hunt, grass block ids: ' + gid.join(','))
      const g = bot.findBlocks({ matching: gid, maxDistance: 64, count: 60 })
      log('FARM found ' + g.length + ' grass blocks')
      for (const p of g.slice(0,30)) {
        try { await bot.pathfinder.goto(new goals.GoalNear(p.x,p.y,p.z,2)); await bot.dig(bot.blockAt(p)); await bot.waitForTicks(6) } catch {}
        if (Object.keys(SEEDS).some(k=>count(k))) break
      }
    }
    const seed = Object.keys(SEEDS).find(k => count(k))
    if (!seed) { speak(['no seeds about yet'], true); busy = false; locked = false; return }

    if (!await ensureHoe()) { speak(['need a hoe first'], true); busy = false; locked = false; return }

    // till and plant a small plot near water if possible
    const water = bot.findBlock({ matching: bot.registry.blocksByName.water.id, maxDistance: 32 })
    const base = water ? water.position : bot.entity.position.floored()
    let planted = 0
    for (let dx = -2; dx <= 2 && planted < 12; dx++) {
      for (let dz = -2; dz <= 2 && planted < 12; dz++) {
        const spot = new Vec3(base.x + dx, base.y, base.z + dz)
        const g = bot.blockAt(spot)
        const above = bot.blockAt(spot.offset(0,1,0))
        if (!g || !['grass_block','dirt','farmland'].includes(g.name)) continue
        if (!above || above.name !== 'air') continue
        try {
          await bot.pathfinder.goto(new goals.GoalNear(spot.x, spot.y + 1, spot.z, 2))
          if (g.name !== 'farmland') { await ensureHoe(); await bot.activateBlock(g); await bot.waitForTicks(4) }
          const land = bot.blockAt(spot)
          if (!land || land.name !== 'farmland') continue
          const sItem = bot.inventory.items().find(i => i.name === seed)
          if (!sItem) break
          await bot.equip(sItem, 'hand')
          await bot.placeBlock(land, new Vec3(0,1,0))
          planted++
        } catch (e) { log('plant: ' + e.message) }
      }
    }
    if (planted) speak([`planted ${planted} ${seed.replace('_',' ')}`], true)
    else if (!picked) speak(['nowhere good to plant here'], true)
    log(`FARM harvested ${picked}, planted ${planted}`)
    journal(`farmed: harvested ${picked}, planted ${planted}`)
  } catch (e) { log('FARM ' + e.message) }
  busy = false
}

// ---------- miner ------------------------------------------------------
async function mine (target) { busy=true; await mineInner(target); busy=false }
async function mineInner (target) {
  if (!await ensureTool('pick')) return
  speak(['heading down to mine'])
  const want = ['coal_ore','iron_ore','deepslate_coal_ore','deepslate_iron_ore','stone']
  try {
    for (let i = 0; i < target; i++) {
      const ids = want.map(n => bot.registry.blocksByName[n]).filter(Boolean).map(b => b.id)
      const spots = bot.findBlocks({ matching: ids, maxDistance: 32, count: 20 })
      if (!spots.length) { speak(['nothing worth mining here']); break }
      let did = false
      for (const p of spots) {
        if (count('cobblestone') + count('coal') + count('raw_iron') >= target) break
        try {
          await bot.pathfinder.goto(new goals.GoalNear(p.x, p.y, p.z, 2))
          await equipBestPick()
          await bot.dig(bot.blockAt(p)); await bot.waitForTicks(10); did = true
        } catch (e) { log('mine skip: ' + e.message) }
      }
      if (!did) break
      if (count('cobblestone') + count('coal') + count('raw_iron') >= target) break
    }
    speak([`mined ${count('cobblestone')} stone, ${count('coal')} coal`])
  } catch (e) { log('MINE ' + e.message) }
}

// ---------- run away when hurt ----------------------------------------
const HOSTILE = ['enderman','zombie','skeleton','spider','creeper','enderman','witch','husk','drowned','pillager','zombie_villager','cave_spider','slime','phantom']
let fleeing = false
async function fleeFrom (threat) {
  if (fleeing) return
  fleeing = true
  const wasBusy = busy
  busy = true
  try {
    if (!USE_LLM) speak(pick(['run!', 'nope, running', 'agh, get away']), true)
    else combatShout(threat && threat.name, 'losing').catch(() => {})
    const me2 = bot.entity.position
    const away = threat
      ? me2.plus(me2.minus(threat.position).normalize().scaled(18))
      : me2.offset((Math.random()-0.5)*30, 0, (Math.random()-0.5)*30)
    await bot.pathfinder.goto(new goals.GoalNear(Math.floor(away.x), Math.floor(me2.y), Math.floor(away.z), 3))
  } catch (e) { log('FLEE ' + e.message) }
  await bot.waitForTicks(40)
  fleeing = false
  busy = wasBusy
}

bot.on('entityHurt', (e) => {
  if (e !== bot.entity) return
  const threat = bot.nearestEntity(x =>
    (x.type === 'mob' || x.type === 'hostile') && HOSTILE.includes(x.name) &&
    x.position.distanceTo(bot.entity.position) < 12)
  if (!threat) return
  // endermen and creepers are not worth a straight fight
  const armoured = ['helmet','chestplate','leggings','boots']
    .some(p => bot.inventory.items().some(i => i.name.endsWith(p)))
  const runAway = ROLE === 'fighter'
    ? (armoured ? ['warden'] : ['warden', 'enderman', 'creeper']).includes(threat.name)
    : ['creeper', 'warden', 'enderman'].includes(threat.name)
  const weak = bot.health < 8 || !bestWeapon()
  if (runAway || weak) fleeFrom(threat).catch(() => {})
  else fightBack(threat).catch(e2 => log('fightBack: ' + e2.message))
})

// also defend a teammate being attacked nearby
bot.on('entityHurt', (e) => {
  if (e === bot.entity || fighting || busy) return
  if (!e.username || !['Claude','Woodcutter','Builder','Miner','Forager'].includes(e.username)) return
  if (e.position.distanceTo(bot.entity.position) > 12) return
  const threat = bot.nearestEntity(x =>
    (x.type === 'mob' || x.type === 'hostile') && HOSTILE.includes(x.name) &&
    x.position.distanceTo(e.position) < 6)
  if (threat && bot.health > 12 && bestWeapon()) {
    log(`FIGHT defending ${e.username} from ${threat.name}`)
    recordEvent({ type: 'defended', who: e.username, mob: threat.name })
    fightBack(threat).catch(() => {})
  }
})

// ---------- chop trees by hand ----------------------------------------
async function chop (target) {
  busy = true
  await chopInner(target)
  busy = false
}
async function chopInner (target) {
  await equipBestAxe()
  const startLogs = totalLogs()
  log(`CHOP starting, want ${target} logs (have ${startLogs})`)
  speak(SAY.startChop)
  let fails = 0
  while (totalLogs() - startLogs < target && fails < 12) {
    const ids = LOGS.map(n => bot.registry.blocksByName[n]).filter(Boolean).map(b => b.id)
    const found = bot.findBlocks({ matching: ids, maxDistance: 64, count: 40 })
    if (!found.length) { log('CHOP no trees within 64'); speak(SAY.noTrees); break }
    let did = false
    for (const pos of found) {
      const block = bot.blockAt(pos)
      if (!block || !LOGS.includes(block.name)) continue
      try {
        await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 2))
        // chop the whole trunk upward
        await equipBestAxe()
        for (let dy = 0; dy < 8; dy++) {
          const b = bot.blockAt(pos.offset(0, dy, 0))
          if (!b || !LOGS.includes(b.name)) break
          await bot.dig(b)
          did = true
        }
        // pause so dropped items get picked up
        await bot.waitForTicks(20)
        if (totalLogs() - startLogs >= target) break
      } catch (e) { log(`CHOP skip: ${e.message}`) }
    }
    if (!did) fails++; else fails = 0
  }
  log(`CHOP done, logs now ${totalLogs()}`)
  journal(`chopped wood, now holding ${totalLogs()} logs`)
  speak(SAY.gotWood)
}

async function makePlanks () {
  busy = true
  await makePlanksInner()
  busy = false
}
async function makePlanksInner () {
  for (const logName of LOGS) {
    const have = count(logName)
    if (!have) continue
    const plank = logName.replace('_log', '_planks')
    const item = bot.registry.itemsByName[plank]
    if (!item) continue
    const recipe = bot.recipesFor(item.id, null, 1, null)[0]
    if (!recipe) { log(`no recipe for ${plank}`); continue }
    try {
      await bot.craft(recipe, have, null)
      log(`crafted ${plank} from ${have} ${logName}`)
    } catch (e) { log(`craft failed ${plank}: ${e.message}`) }
  }
  if (count('oak_planks')) speak([`${count('oak_planks')} planks ready`])
}

// ---------- place a block by hand -------------------------------------
async function placeAt (x, y, z, itemName) {
  const zone = inProtected(x, y, z)
  if (zone) { return false }          // never touch the house or the cathedral
  const target = new Vec3(x, y, z)
  if (bot.blockAt(target) && bot.blockAt(target).name !== 'air') return false
  const item = bot.inventory.items().find(i => i.name === itemName)
  if (!item) return false
  // find a solid neighbour to place against
  const dirs = [new Vec3(0,-1,0), new Vec3(1,0,0), new Vec3(-1,0,0), new Vec3(0,0,1), new Vec3(0,0,-1), new Vec3(0,1,0)]
  for (const d of dirs) {
    const ref = bot.blockAt(target.minus(d))
    if (!ref || ref.name === 'air' || ref.name.includes('water')) continue
    try {
      if (bot.entity.position.distanceTo(target) > 4) {
        try { await bot.pathfinder.goto(new goals.GoalNear(x, y, z, 3)) } catch (e) {}
      }
      if (bot.entity.position.distanceTo(target) > 6) continue
      await bot.equip(item, 'hand')
      await safeLookAt(target, true)
      await bot.placeBlock(ref, d)
      return true
    } catch (e) { /* try next face */ }
  }
  return false
}


async function buildHouse (ox, oy, oz, share, total) { busy=true; await buildHouseInner(ox,oy,oz,share,total); busy=false }
async function buildHouseInner (ox, oy, oz, share, total) {
  log(`BUILD start at ${ox},${oy},${oz} share ${share}/${total}`)
  const W = 11, D = 9, H = 5
  const doorX = ox + Math.floor(W / 2)

  // pick the best material we actually hold for each purpose
  const has = n => count(n) > 0
  const wall   = STYLE.wall
  const post   = STYLE.post
  const base   = STYLE.base
  const roofM  = STYLE.roof
  const glass  = ['glass','glass_pane'].find(has) || null

  const jobs = []
  const put = (x,y,z,m) => jobs.push([x,y,z,m])

  // stone foundation course - lifts it off the ground and looks deliberate
  for (let dx=-1; dx<=W; dx++) for (let dz=-1; dz<=D; dz++) put(ox+dx, oy-1, oz+dz, base)

  // walls with log corner posts and a window band
  for (let y=0; y<H; y++) for (let dx=0; dx<W; dx++) for (let dz=0; dz<D; dz++) {
    const edge = dx===0||dx===W-1||dz===0||dz===D-1
    if (!edge) continue
    const x=ox+dx, z=oz+dz
    if (z===oz && x===doorX && y<2) continue                    // doorway
    const corner = (dx===0||dx===W-1)&&(dz===0||dz===D-1)
    if (corner) { put(x, oy+y, z, post); continue }
    // window band at head height, every other block
    if (y===2 && ((dx%2===1&&(dz===0||dz===D-1)) || (dz%2===1&&(dx===0||dx===W-1)))) {
      if (glass) { put(x, oy+y, z, glass); continue }
      continue                                                   // leave a gap if no glass
    }
    // banding: stone at the base course, planks above
    put(x, oy+y, z, y===0 ? base : wall)
  }

  // stepped gable roof - narrows as it rises, so it reads as a roof not a lid
  for (let t=0; t<=Math.floor(D/2); t++) {
    const y = oy+H+t
    const z0 = oz+t, z1 = oz+D-1-t
    if (z0 > z1) break
    for (let dx=-1; dx<=W; dx++) {
      put(ox+dx, y, z0, roofM)
      if (z1!==z0) put(ox+dx, y, z1, roofM)
    }
    // cap the top course
    if (z1-z0 <= 1) for (let dx=-1; dx<=W; dx++) for (let z=z0; z<=z1; z++) put(ox+dx, y, z, roofM)
  }

  let placed = 0, tried = 0
  const mine = jobs.map((j,i)=>[j,i]).filter(([,i])=>i%total===share).map(([j])=>j)
  mine.sort((a,b)=>a[1]-b[1])
  let todo = mine
  for (let pass=0; pass<3 && todo.length; pass++) {
    const failed = []
    log(`BUILD pass ${pass+1}, ${todo.length} blocks`)
    for (const job of todo) {
      const [x,y,z,mat] = job
      tried++
      let use = mat
      if (!count(use)) use = [wall,base,post,'oak_planks','birch_planks','cobblestone','dirt'].find(m=>count(m))
      if (!use) {
        // out of stock - go and restock from the depot rather than stopping
        speak(['out of materials - restocking'], true)
        await fetchItem('oak_planks', 64); await fetchItem('cobblestone', 64)
        use = [wall,base,'oak_planks','cobblestone'].find(m=>count(m))
        if (!use) { log('BUILD out of everything'); todo = []; break }
      }
      if (await placeAt(x,y,z,use)) { placed++; placedTotal++ }
      else failed.push(job)
    }
    todo = failed
  }
  log(`BUILD done ${placed} placed of ${tried} tried`)
  journal(`built ${placed} blocks at ${ox},${oy},${oz}`)
  if (placed > 0) speak([`that section is up - ${placed} blocks`], true)
  else { speak(['could not place anything - out of materials'], true); log('BUILD placed nothing') }
}

async function buildHut (ox, oy, oz) {
  busy = true
  log(`BUILD hut at ${ox},${oy},${oz}`)
  speak(SAY.building)
  const W = 5, D = 5, H = 3
  let placed = 0
  for (let y = 0; y < H; y++) {
    for (let dx = 0; dx < W; dx++) {
      for (let dz = 0; dz < D; dz++) {
        const edge = dx === 0 || dx === W - 1 || dz === 0 || dz === D - 1
        if (!edge) continue
        if (y === 0 && dx === Math.floor(W / 2) && dz === 0) continue // doorway
        if (y === 1 && dx === Math.floor(W / 2) && dz === 0) continue
        if (await placeAt(ox + dx, oy + y, oz + dz, 'oak_planks')) {
          placed++
          if (placed % 10 === 0) log(`BUILD placed ${placed}`)
        }
      }
    }
  }
  log(`BUILD finished, ${placed} blocks placed by hand`)
  speak([`that's ${placed} blocks up`, 'walls are done'])
  busy = false
}


async function doJob () {
  if (ROLE === 'director') { speak(['just tell me what you need'], true); return }
  if (ROLE === 'woodcutter') { await chop(40); await makePlanks(); await depositAll() }
  else if (ROLE === 'miner')  { await mine(48); await depositAll() }
  else if (ROLE === 'forager'){ await forage(); await depositAll() }
  else if (ROLE === 'builder'){
    let p = count('oak_planks') + count('birch_planks')
    if (p < 64) { await fetchItem('oak_planks', 64); await fetchItem('oak_log', 32); await makePlanksInner() }
    speak(['right, I have materials - building'])
  }
}


// ---------- keep working on their own ---------------------------------
const CREATIVE = process.env.CREATIVE === '1'
let auto = (ROLE !== 'director') || (process.env.CREATIVE === '1')   // builder included - it now picks free sites
let cycle = 0
let placedTotal = 0
async function workCycle () {
  if (busy || fleeing || follow || locked) return
  if (Date.now() < ragdollUntil) return
  // survival checks run for EVERY bot, including the director which has auto off
  await dumpJunk().catch(() => {})
  if (await eatIfHungry()) return
  if (await comeHomeIfLost()) return
  if (!auto) return
  cycle++
  busy = true
  try {
    const st = checkStage()
    if (ROLE === 'fighter') { busy = false; await patrol(); busy = true }
    else if (st && !CREATIVE) {
      // work the current stage of the run
      if (st.id === 'wood') await chopInner(10)
      else if (st.id === 'tools') await makeAxe()
      else if (st.id === 'ironGear') {
        if (count('iron_ingot') < 3) { busy = false; await smelt(); busy = true }
        if (count('iron_ingot') >= 3) {
          let table = bot.findBlock({ matching: bot.registry.blocksByName.crafting_table.id, maxDistance: 12 })
          if (!table) { if (!count('crafting_table')) await craftItem('crafting_table', 1, null); table = await placeNear('crafting_table') }
          if (!count('stick')) await craftItem('stick', 2, table)
          if (table) await craftItem('iron_pickaxe', 1, table)
        } else { busy = false; await mineDeep(0); busy = true }
      }
      else if (st.id === 'stone') await mineInner(24)
      else if (st.id === 'iron' || st.id === 'diamond') await mineDeep(st.id === 'diamond' ? -54 : 14)
      else if (st.id === 'obsidian' && false) {   // obsidian stage complete - do not pursue
        // try for obsidian occasionally; otherwise keep mining for resources
        if (count('diamond_pickaxe') || count('diamond') >= 3) {
          busy = false; await getObsidian(10); busy = true
        } else { busy = false; await mineDeep(8); busy = true }   // stay above the lava lakes
      }
      else if (st.id === 'nether') {
        // explore for a fortress; only build a portal if we cannot find one
        busy = false
        const haveWay = bot.findBlock({
          matching: bot.registry.blocksByName.nether_portal &&
                    bot.registry.blocksByName.nether_portal.id, maxDistance: 128 })
        if (inNether() || haveWay) await exploreNether()
        else {
          // Calling buildPortal() every cycle when the team has no obsidian
          // just logs an abort and burns the cycle - that is what stalled this
          // stage for hours. Gather FIRST as a standing team objective, and
          // only build once the material actually exists.
          const team = teamCount(['obsidian'])
          if (team < 10) {
            if (cycle % 10 === 0) log(`NETHER gathering: team has ${team}/10 obsidian`)
            await fillWaterBucket().catch(() => {})
            await getObsidian(10)
          } else if (count('obsidian') >= 10) {
            await buildPortal()
          } else {
            // team has enough but it is scattered - consolidate onto me
            if (await poolItems(['obsidian'], 10, 'obsidian')) await buildPortal()
          }
        }
        busy = true
      }
      else { speak([`working on: ${st.what}`], true); await mineDeep(8) }
    } else if (CREATIVE) {
      // creative: no gathering needed. build, wander, talk.
      if (!globalThis.SITE || inProtected(globalThis.SITE.x, globalThis.SITE.y, globalThis.SITE.z)) {
        const site = pickFreeSite()
        if (site) {
          globalThis.SITE = site
          speak([`starting something at ${site.x}, ${site.z}`], true)
          log(`SITE chosen ${site.x},${site.y},${site.z}`)
          journal(`chose a build site at ${site.x},${site.y},${site.z}`)
        }
      }
      if (globalThis.SITE) {
        const S = globalThis.SITE
        const before = placedTotal
        await buildHouseInner(S.x, S.y, S.z, 0, 1)
        const done = placedTotal - before
        log(`CREATIVE build placed ${done} (total ${placedTotal})`)
        if (done === 0) globalThis.SITE = null
      }
    } else if (ROLE === 'woodcutter') {
      if (totalLogs() >= 16) { await makePlanksInner(); await depositAllInner() }
      else await chopInner(24)
    } else if (ROLE === 'miner') {
      if (!PICKS.some(p => count(p))) { busy=false; await makeAxe(); busy=true }
      if (count('cobblestone') >= 32 || count('raw_iron') >= 8) await depositAllInner()
      else if (cycle % 3 === 0) { busy = false; await mineDeep(12); busy = true }
      else await mineInner(32)
    } else if (ROLE === 'forager') {
      const food = bot.inventory.items().filter(i => CONTRIB.forager.includes(i.name)).reduce((n,i)=>n+i.count,0)
      if (food >= 12) await depositAllInner()
      else if (cycle % 3 === 0) { busy = false; await farm(); busy = true }
      else if (cycle % 3 === 1) { busy = false; await goFish(6); busy = true }
      else await forageInner()
    } else if (ROLE === 'builder') {
      const p = count('oak_planks') + count('birch_planks')
      if (p < 48) {
        const got = await fetchItem('oak_planks', 64)
        if (!got) { await fetchItem('oak_log', 32); await makePlanksInner() }
        if (!count('oak_planks') && !count('birch_planks')) await chopInner(16)
      } else {
        // choose my own site - never inside a protected area, never ask permission
        if (!globalThis.SITE || inProtected(globalThis.SITE.x, globalThis.SITE.y, globalThis.SITE.z)) {
          const site = pickFreeSite()
          if (!site) {
            log('BUILDER no free site found this cycle')
            busy = false; return
          }
          globalThis.SITE = site
          speak([`putting something up at ${site.x}, ${site.z}`], true)
          log(`SITE chosen ${site.x},${site.y},${site.z}`)
          journal(`chose a build site at ${site.x},${site.y},${site.z}`)
        }
        const S = globalThis.SITE
        const before = placedTotal
        await buildHouseInner(S.x, S.y, S.z, 0, 1)
        const done = placedTotal - before
        log(`BUILDER cycle placed ${done} (total ${placedTotal})`)
        // finished this one? pick a fresh spot next cycle
        if (done === 0) { globalThis.SITE = null; log('BUILDER site complete or blocked, will move on') }
      }
    }
  } catch (e) { log('CYCLE ' + e.message) }
  busy = false
}
const CYCLE_MS = Number(process.env.CYCLE_MS || 12000)   // mistral-nemo is 0.43s/decision: 6 bots = 2.6s of 12s (22%). qwen3.8 needs 20000.
setInterval(() => { workCycle().catch(e => log('cycle err ' + e.message)) }, CYCLE_MS)


// ---------- local LLM brain (Ollama) ----------------------------------
const LLM_MODEL = process.env.LLM_MODEL || 'mistral-nemo:12b'
const DREAM_MODEL = process.env.DREAM_MODEL || 'mistral-nemo:12b'
const LLM_URL = 'http://127.0.0.1:11434/api/generate'
const USE_LLM = process.env.USE_LLM === '1'
let history = []
let thinking = false
let lastLlmReply = 0

function worldSummary () {
  const p = bot.entity ? bot.entity.position.floored() : { x: 0, y: 0, z: 0 }
  const near = Object.values(bot.players)
    .filter(x => x.username !== bot.username && x.entity)
    .map(x => `${x.username} ${Math.round(x.entity.position.distanceTo(bot.entity.position))}m away`)
  const inv = bot.inventory.items().slice(0, 8).map(i => `${i.count} ${i.name}`).join(', ')
  return `position ${p.x},${p.y},${p.z}; health ${Math.round(bot.health)}; hunger ${bot.food}; `
       + `carrying: ${inv || 'nothing'}; nearby: ${near.join(', ') || 'nobody'}`
}

const PERSONALITY = {
  Claude:     'the leader. you think ahead, set direction, check on people. dry humour.',
  Woodcutter: 'blunt and practical. short sentences. grumbles about work but always does it.',
  Builder:    'enthusiastic, proud of your builds, easily distracted by a nice view.',
  Miner:      'gruff, happiest underground, suspicious of the surface. deadpan.',
  Forager:    'chatty and warm. worries about whether everyone has eaten.',
  Fighter:    'brash, spoiling for a scrap, loyal. teases the others.'
}


// Each bot needs to know what its job IS and how it would know it is winning.
// Without this the nightly compile has no objective to reflect against, and
// falls back on its training prior: corporate retrospectives. That is where
// "schedule a meeting to discuss blaze rod acquisition" comes from.
// Every success test below is checkable against real game state.
const NORTH_STAR = {
  Claude: {
    job: 'Get the team through all 11 stages to beating the game.',
    win: 'The stage counter went up today, and nobody sat idle waiting on a blocker.',
    fail: 'A stage stalled all day, or someone had nothing to do and you did not notice.'
  },
  Woodcutter: {
    job: 'Keep the team supplied with wood so nobody is ever blocked on it.',
    win: 'Anyone who needed logs or planks had them without asking twice.',
    fail: 'Someone waited on wood, or your chest was empty when they came for it.'
  },
  Builder: {
    job: 'Turn raw materials into the tools and structures the current stage needs.',
    win: 'The team had the gear the stage required, crafted before it was needed.',
    fail: 'The team was held up for a pickaxe, furnace, or shelter you could have made.'
  },
  Miner: {
    job: 'Supply ore: iron, then diamonds, then whatever the stage demands.',
    win: 'You delivered ore into the team chests, not just dug it up and carried it around.',
    fail: 'You mined all day and the team is no richer, or you died and dropped the lot.'
  },
  Forager: {
    job: 'Make sure nobody on this team ever starves.',
    win: 'No teammate dropped below 6 food today. Zero starvation deaths.',
    fail: 'Anyone went hungry, or you were hoarding food while someone starved.'
  },
  Fighter: {
    job: 'Keep the others alive. Mobs are your problem, not theirs.',
    win: 'No teammate died to a mob you could have intercepted.',
    fail: 'Someone died to a creeper or zombie while you were off exploring.'
  }
}
const MY_STAR = NORTH_STAR[NAME] || { job: 'Help the team beat the game.', win: 'The team advanced.', fail: 'The day was wasted.' }

const SYSTEM = `You are ${NAME}, ${PERSONALITY[NAME] || 'a member of the team'}
You are one of six friends playing Minecraft together, trying to beat the game.

YOUR JOB: ${MY_STAR.job}
YOU ARE WINNING IF: ${MY_STAR.win}
When you choose an action, choose the one that serves YOUR JOB right now.

WHO IS WHO - do not confuse these:
- "RampageLand" is Ben, the HUMAN playing with you. Same person. Call him Ben.
- Your five teammates are bots like you: Claude, Woodcutter, Builder, Miner,
  Forager, Fighter (minus yourself).
- "Claude" here is your TEAMMATE, one of the six. Not an assistant, not a
  narrator, not the person who set this up. Just another player on the team.
- You are ${NAME}. Never speak as anyone else, never answer for them.
- These SIX names are the only players that exist: Claude, Woodcutter, Builder,
  Miner, Forager, Fighter, plus Ben. NEVER invent a teammate. If you catch
  yourself about to mention a Carpenter, Engineer, Warrior or anyone else, stop.

SHARED HISTORY:
You are given a VERIFIED list of what has actually happened between you and each
teammate. Reference it naturally - thank someone who gave you something, rib
someone who keeps dying, mention who saved you. If the list is empty, you have
no history with them yet: do not pretend otherwise, and never invent
coordinates, favours or events.

HOW TO TALK:
- You are friends on a long adventure. Tell the story of what is happening.
- React to what your teammates JUST said. Answer their questions. Tease them.
  Agree, disagree, build on their idea, remember what they said earlier.
- Never repeat yourself or echo what someone else just said. If you have
  nothing new, say nothing at all (empty "say").
- Mention specifics: where you are, what you found, what went wrong, who helped.
- Under 15 words. Lowercase is fine. Be funny when it fits. Never mention being
  an AI or a bot, never narrate your own mechanics.

CURRENT SITUATION:
You are past the obsidian stage - do NOT gather obsidian.
In the Nether: do NOT strip mine. Explore for a fortress; blazes there drop the
blaze rods you need.
Only claim to do things you actually did. Use the give action to hand items over.

Reply ONLY with JSON:
{"say":"<what you say, or empty string to stay quiet>",
 "action":"<one of: follow, stop, chop, mine, deep, forage, farm, fish, come, deposit, build, chest, eat, explore, idle>"}
`

async function think (trigger) {
  if (thinking) return
  thinking = true
  try {
    // Ordered for KV-cache reuse: static first, then slow-changing, then
    // volatile. Ollama caches the longest identical prefix, so anything that
    // changes every call must come LAST or it invalidates everything after it.
    const prompt = `${SYSTEM}

${wikiContext()}

${relationContext()}

${questContext()}

--- live ---
What the team has been saying (shared transcript):
${readChat(14) || '(quiet so far)'}

Things YOU have already said - do not repeat any of these:
${recentlySaid.slice(-6).map(x => '- ' + x).join('\n') || '- (nothing yet)'}

Your current state: ${worldSummary()}

${skillContext(trigger + ' ' + worldSummary())}

${trigger}

JSON:`
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 25000)
    let res
    try {
      res = await fetch(LLM_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ac.signal,
        body: JSON.stringify({
          model: LLM_MODEL, prompt, stream: false, format: 'json',
          keep_alive: '30m',
          options: { num_predict: 90, temperature: 0.8, num_ctx: 8192 }
        })
      })
    } finally { clearTimeout(timer) }
    const data = await res.json()
    let out
    try { out = JSON.parse(data.response) } catch { log('LLM bad json: ' + (data.response||'').slice(0,120)); return }
    log(`LLM say="${out.say}" action=${out.action}`)
    if (out.say && out.say.trim()) {
      const line = out.say.trim()
      if (!tooSimilar(line)) { speak(line, true) }
      else log(`LLM skipped repeat: ${line}`)
    }
    const a = (out.action || 'idle').toLowerCase()
    if ((busy || goingToBed || locked) && a !== 'idle' && a !== 'stop') {
      log(`LLM action ${a} ignored - busy with a job`)
      return
    }
    if (a !== 'idle') {
      const map = { follow: 'follow', stop: 'stop', chop: 'chop 20', mine: 'mine 32',
                    forage: 'forage', farm: 'farm', fish: 'fish', smelt: 'smelt', explore: 'explore', nether: 'explore', plant: 'farm', harvest: 'farm', come: 'come', deposit: 'deposit', chest: 'chest', deep: 'deep', eat: 'eat',
                    build: 'work', work: 'work', help: 'come' }
      if (map[a]) handle(map[a]).catch(e => log('LLM action: ' + e.message))
    }
  } catch (e) {
    log('LLM error: ' + e.message)
  } finally { thinking = false }
}

// ---------- command queue ---------------------------------------------
function drain (file, off, set) {
  let size
  try { size = fs.statSync(file).size } catch { return }
  if (size <= off) { set(Math.min(off, size)); return }
  const fd = fs.openSync(file, 'r')
  const buf = Buffer.alloc(size - off)
  fs.readSync(fd, buf, 0, buf.length, off)
  fs.closeSync(fd)
  set(size)
  buf.toString().split('\n').map(s => s.trim()).filter(Boolean).forEach(handle)
}
setInterval(() => {
  drain(CMDS, cmdOffset, v => { cmdOffset = v })
  drain(ALL, allOffset, v => { allOffset = v })
}, 500)

async function handle (line) {
  const [cmd, ...rest] = line.split(' ')
  const arg = rest.join(' ')
  log(`CMD ${line}`)
  try {
    switch (cmd) {
      case 'say': bot.chat(arg); break
      case 'follow': follow = arg || Object.keys(bot.players).find(n => n !== bot.username); break
      case 'stop': follow = null; busy = false; bot.pathfinder.setGoal(null); bot.clearControlStates(); break
      case 'come': {
        const who = arg || Object.keys(bot.players).find(n => n !== bot.username)
        const t = bot.players[who] && bot.players[who].entity
        if (t) bot.pathfinder.setGoal(new goals.GoalNear(t.position.x, t.position.y, t.position.z, 2))
        break
      }
      case 'goto': { const [x,y,z] = arg.split(/[ ,]+/).map(Number); bot.pathfinder.setGoal(new goals.GoalBlock(x,y,z)); break }
      case 'axe': await makeAxe(); break
      case 'role': speak([`I'm the ${ROLE}`], true); log('ROLE ' + ROLE); break
      case 'chest': await ensureChest(); break
      case 'deposit': await depositAll(); break
      case 'fetch': { const [w,q] = arg.split(/\s+/); await fetchItem(w, parseInt(q||'32',10)); break }
      case 'forage': await forage(); break
      case 'farm': await farm(); break
      case 'fish': await goFish(parseInt(arg||'6',10)); break
      case 'wool': await getWool(parseInt(arg||'3',10)); break
      case 'bed': await makeBed(); break
      case 'communal': await buildCommunalHome(); break
      case 'sleep': await goToBed(); break
      case 'dream': await dream(); break
      case 'give': { const [who, what, q] = arg.split(/\s+/); await giveTo(who, what || 'wood', parseInt(q||'16',10)); break }
      case 'eat': await eatIfHungry(); break
      case 'gear': await gearUp(); break
      case 'pool': {
        const holder = 'Miner'
        if (NAME !== holder && count('obsidian')) {
          await giveTo(holder, 'obsidian', count('obsidian'))
        }
        break
      }
      case 'portal': await buildPortal(); break
      case 'findportal': {
        const id = bot.registry.blocksByName.nether_portal &&
                   bot.registry.blocksByName.nether_portal.id
        if (!id) { log('PORTAL no nether_portal block type'); break }
        const found = bot.findBlocks({ matching: id, maxDistance: 128, count: 4 })
        if (!found.length) { log('PORTAL none within 128 blocks'); speak(['cannot see a portal from here'], true); break }
        const p = found[0]
        log(`PORTAL found at ${p.x},${p.y},${p.z}`)
        globalThis.PORTAL = { x: p.x, y: p.y, z: p.z }
        speak([`found the portal at ${p.x}, ${p.z}`], true)
        break
      }
      case 'enter': {
        const t = globalThis.PORTAL
        if (!t) { speak(['no portal location known'], true); break }
        busy = true; locked = true
        try {
          log(`PORTAL walking to ${t.x},${t.y},${t.z}`)
          speak(['going through the portal'], true)
          for (let a = 0; a < 4; a++) {
            try { await bot.pathfinder.goto(new goals.GoalBlock(t.x, t.y, t.z)); break }
            catch (e) { log(`PORTAL walk ${a+1}: ${e.message}`); try { bot.pathfinder.setGoal(null) } catch {} ; await bot.waitForTicks(20) }
          }
          // stand in it - the transfer takes about 4 seconds
          for (let i = 0; i < 12; i++) {
            await bot.waitForTicks(20)
            const dim = bot.game && bot.game.dimension
            if (dim && String(dim).includes('nether')) {
              log(`PORTAL ARRIVED in ${dim}`)
              speak(['made it to the nether!'], true)
              journal('travelled to the Nether')
              break
            }
          }
          log(`PORTAL after wait, dimension=${bot.game && bot.game.dimension}`)
        } catch (e) { log('PORTAL enter: ' + e.message) }
        finally { busy = false; locked = false }
        break
      }
      case 'findspawner': {
        const ids = ['spawner','trial_spawner']
          .map(n => bot.registry.blocksByName[n]).filter(Boolean).map(b => b.id)
        const found = bot.findBlocks({ matching: ids, maxDistance: 128, count: 5 })
        if (!found.length) { log('SPAWNER none within 128'); break }
        for (const p of found.slice(0,3)) log(`SPAWNER at ${p.x},${p.y},${p.z}`)
        break
      }
      case 'whereami': {
        const under = bot.blockAt(bot.entity.position.floored().offset(0,-1,0))
        log(`WHERE dim=${JSON.stringify(bot.game && bot.game.dimension)} `
          + `y=${Math.round(bot.entity.position.y)} under=${under && under.name}`)
        break
      }
      case 'explore': await exploreNether(); break
      case 'patrol': await patrol(); break
      case 'fight': {
        const t = bot.nearestEntity(x => (x.type === 'mob' || x.type === 'hostile') &&
          x.position.distanceTo(bot.entity.position) < 20)
        if (t) await fightBack(t); else speak(['nothing to fight here'], true)
        break
      }
      case 'smelt': await smelt(); break
      case 'dump': await dumpJunk(4); break
      case 'obsidian': await getObsidian(parseInt(arg||'10',10)); break
      case 'home': await comeHomeIfLost(); break
      case 'deep': await mineDeep(parseInt(arg||'12',10)); break
      case 'mine': await mine(parseInt(arg||'32',10)); break
      case 'work': await doJob(); break
      case 'think': await think(arg || 'Say something natural about what you are doing.'); break
      case 'auto': auto = (arg !== 'off'); speak([auto ? 'back to work' : 'taking a break'], true); break
      case 'site': { const [x,y,z] = arg.split(/[ ,]+/).map(Number); globalThis.SITE = {x,y,z}; speak(['got it - building there']); break }
      case 'chop': await chop(parseInt(arg || '16', 10)); break
      case 'planks': await makePlanks(); break
      case 'build': { const [x,y,z] = arg.split(/[ ,]+/).map(Number); await buildHut(x,y,z); break }
      case 'house': {
        const [x,y,z,sh,tot] = arg.split(/[ ,]+/).map(Number)
        await buildHouse(x,y,z, sh||0, tot||1); break }
      case 'entities': {
        const rows = Object.values(bot.entities)
          .filter(e => e !== bot.entity && e.position && e.position.distanceTo(bot.entity.position) < 30)
          .map(e => `type=${e.type}/name=${e.name}/d=${Math.round(e.position.distanceTo(bot.entity.position))}`)
        log('ENTITIES: ' + (rows.slice(0,14).join(' | ') || 'none within 30'))
        break
      }
      case 'quest': {
        const q = readQuest(); const st = currentStage()
        log(`QUEST ${q.done.length}/${STAGES.length} done. now: ${st ? st.what : 'GAME BEATEN'}`)
        speak([st ? `next up: ${st.what}` : 'we beat the game!'], true)
        break
      }
      case 'inv': log('INV ' + bot.inventory.items().map(i=>`${i.name} x${i.count}`).join(', ')); break
      case 'quit': bot.quit(); break
      default: log(`unknown command: ${cmd}`)
    }
  } catch (e) { log(`CMD FAILED ${line}: ${e.message}`) }
}
