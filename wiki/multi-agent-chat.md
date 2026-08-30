# Multi-agent conversation

Making six agents sound like friends on an adventure rather than six status
printers shouting past each other.

## The failure mode

Each agent kept only its own last six lines of history, so nobody could see the
conversation. The result was relentless repetition:

```
10:03 <Woodcutter> looking for nether brick
10:03 <Woodcutter> looking for nether brick
10:03 <Woodcutter> trees. that's my whole thing
10:03 <Woodcutter> trees. that's my whole thing
10:03 <Builder> ooh, I do like a nice build
10:03 <Builder> ooh, I do like a nice build
```

Three separate causes, all needing fixing together.

## 1. A shared transcript

One file every agent appends to and reads before speaking:

```js
function logChat (who, text) { fs.appendFileSync(CHATLOG, `${t} <${who}> ${text}\n`) }
function readChat (n) { return lines.slice(-(n || 14)).join('\n') }
```

The last 14 lines go into every decision prompt. This is what turns parallel
monologues into a conversation — agents answer each other's questions, build on
a suggestion, and tease.

**Gotcha:** log each line exactly once. First attempt had each agent record what
it *said* and one designated agent record everything it *heard* — producing
perfect duplicates of every line. Fix: agents log their own speech in `speak()`,
and the listener records only the human's messages.

## 2. Refuse to repeat

Before any line is sent, check it against this agent's last 8 lines and the
shared transcript:

- exact match after normalisation → block
- **75 % word overlap** with something recently said → block (catches the
  near-duplicates that exact matching misses)
- already present in the last 8 shared lines → block, someone just said it

**66 repeats suppressed in the first 80 seconds.** This mattered more than the
prompt changes.

## 3. Personality, and permission to be quiet

Roles produce status reports; characters produce conversation. Each agent got a
written personality:

```js
Claude:     'the leader. you think ahead, set direction, check on people. dry humour.'
Woodcutter: 'blunt and practical. short sentences. grumbles but always does it.'
Builder:    'enthusiastic, proud of your builds, easily distracted by a nice view.'
Miner:      'gruff, happiest underground, suspicious of the surface. deadpan.'
Forager:    'chatty and warm. worries about whether everyone has eaten.'
Fighter:    'brash, spoiling for a scrap, loyal. teases the others.'
```

Plus the instruction that most improved quality: **say nothing if you have
nothing new**. An empty `say` is valid output. Filler is what makes agent chat
tiresome.

## 4. Say explicitly who is who

Agents confused the human's in-game name with his real name, and confused the
teammate called Claude with the assistant operating the system:

```
WHO IS WHO - do not confuse these:
- "RampageLand" is Ben, the HUMAN playing with you. Same person. Call him Ben.
- "Claude" here is your TEAMMATE, one of the six. Not an assistant, not a
  narrator, not the person who set this up.
- You are ${NAME}. Never speak as anyone else, never answer for them.
```

Identity ambiguity is not resolved by context — state it flatly.

## Result

```
<Woodcutter> be careful, ben, don't get too close to the lava
<Builder>    yeah no worries buddy, I've got your back.
             there's a nice cave system right behind you
<Miner>      watch your step, blackstone ahead
<Forager>    there's a fortress nearby, should we go check it out?
<Claude>     ah, Ben, always ready for battle. i'll point you at that Blaze mob
<Fighter>    yeah, good luck with that
```

## Still leaking

Scripted status lines from the work loop (`exploring for a fortress`,
`heading through to the nether`) still appear alongside the model's output.
They bypass the LLM entirely. Muting them for LLM-enabled agents would leave a
purely narrative channel.
