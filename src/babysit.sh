#!/bin/zsh
# Watchdog: keeps the server, bots and Ollama healthy while nobody is watching.
cd "$(dirname "$0")"
LOG=babysit.log
J=/opt/homebrew/opt/openjdk@25/bin/java
BOTS=(Claude Woodcutter Builder Miner Forager Fighter)

note() { echo "[$(date +%H:%M:%S)] $1" >> $LOG }

note "watchdog started"

while true; do
  # --- 1. is the Minecraft server alive? ---
  if ! pgrep -f "openjdk@25.*server.jar" >/dev/null 2>&1; then
    note "SERVER DOWN - restarting"
    rm -f console; mkfifo console
    nohup sh -c 'while true; do sleep 3600; done > console' >/dev/null 2>&1 &
    nohup $J -Xms1G -Xmx3G -jar server.jar nogui < console > server.out 2>&1 &
    sleep 25
    echo "gamerule advance_time false" > console
    echo "weather clear 1000000" > console
    note "server restarted"
  fi

  # --- 2. is Ollama alive? (the bots' brain) ---
  if ! curl -s --max-time 3 http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
    note "OLLAMA DOWN - restarting"
    nohup ollama serve > /tmp/ollama.log 2>&1 &
    sleep 8
  fi

  # --- 3. are all five bots connected? ---
  online=0
  for n in $BOTS; do
    f="state_$n.json"
    if [ -f "$f" ]; then
      age=$(( $(date +%s) - $(stat -f %m "$f") ))
      [ $age -lt 30 ] && online=$((online+1))
    fi
  done
  [ $online -lt 5 ] && note "only $online/5 bots reporting"

  # --- 4. per-bot health check + remedies ---
  python3 - <<'PY' >> $LOG 2>&1
import json, glob, os, time
now = time.time()
for f in sorted(glob.glob('state_*.json')):
    name = f.split('state_')[1][:-5]
    try:
        age = now - os.path.getmtime(f)
        if age > 30:
            print(f"[warn] {name} stale ({int(age)}s) - probably disconnected")
            continue
        s = json.load(open(f))
        hp, food = s.get('health', 0), s.get('food', 0)
        p = s.get('pos', {})
        d = (p.get('x',0)-72)**2 + (p.get('z',0)-124)**2
        flags = []
        if hp < 8:   flags.append(f"LOW HP {round(hp)}")
        if food < 6: flags.append(f"HUNGRY {food}")
        pass  # no fixed home on a speedrun
        if flags:
            print(f"[warn] {name}: {', '.join(flags)}")
            # ask it to eat and come home
            open(f'cmds_{name}.txt','a').write('eat\nhome\n')
    except Exception as e:
        print(f"[err] {name}: {e}")
PY


  # --- 6. CPU watch: a bot spinning at 100% means a runaway loop ---
  load=$(uptime | sed 's/.*load averages*: //' | awk '{print $1}' | tr -d ',')
  hot=0
  ps -Ao pid=,%cpu=,command= | grep "[n]ode bot.js" | while read pid cpu rest; do
    name=$(ps -Eo command= -p $pid 2>/dev/null | tr ' ' '\n' | grep '^BOT_NAME=' | cut -d= -f2)
    whole=${cpu%%.*}
    if [ "${whole:-0}" -ge 70 ]; then
      note "HOT ${name:-?} at ${cpu}% cpu (load $load) - clearing its goal"
      # drop whatever it is grinding on; the deadlock watchdog does the rest
      printf 'stop\n' >> "cmds_${name}.txt" 2>/dev/null
    fi
  done
  # sustained high load is worth flagging even if no single bot is hot
  loadint=${load%%.*}
  if [ "${loadint:-0}" -ge 18 ]; then
    note "LOAD HIGH: $load (10 cores) - bots may be thrashing"
  fi

  # --- 5. progress snapshot every 5 minutes ---
  m=$(date +%M)
  if [ $((10#$m % 5)) -eq 0 ]; then
    placed=$(grep -c "BUILD done" events.log 2>/dev/null || echo 0)
    deaths=$(grep -c "DIED" events.log 2>/dev/null || echo 0)
    stuck=$(grep -c "UNSTUCK triggered" events.log 2>/dev/null || echo 0)
    fish=$(grep -c "FISH done" events.log 2>/dev/null || echo 0)
    topcpu=$(ps -Ao %cpu=,command= | grep "[n]ode bot.js" | sort -rn | head -1 | awk '{print $1}')
    note "progress: deaths=$deaths unstucks=$stuck bots=$online load=$load top-bot-cpu=${topcpu}%"
  fi

  sleep 60
done
