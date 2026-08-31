#!/bin/zsh
cd "$(dirname "$0")"
export OLLAMA_KEEP_ALIVE=30m
BOTS=(Claude Woodcutter Builder Miner Forager Fighter)
mkdir -p pids
while true; do
  for n in $BOTS; do
    pf="pids/$n.pid"
    alive=0
    if [ -f "$pf" ]; then
      p=$(cat "$pf" 2>/dev/null)
      if [ -n "$p" ] && kill -0 "$p" 2>/dev/null; then alive=1; fi
    fi
    # a process can be alive but disconnected - treat a stale state file as dead
    if [ "$alive" -eq 1 ] && [ -f "state_$n.json" ]; then
      age=$(( $(date +%s) - $(stat -f %m "state_$n.json") ))
      if [ $age -gt 90 ]; then
        echo "[$(date +%T)] supervisor: $n stale ${age}s, restarting" >> events.log
        kill "$p" 2>/dev/null; sleep 1; alive=0
      fi
    fi
    if [ "$alive" -eq 0 ]; then
      echo "[$(date +%T)] supervisor: starting $n" >> events.log
      BOT_NAME="$n" USE_LLM=1 LLM_MODEL="${LLM_MODEL:-qwen3.8:27b-q4_K_M}" DREAM_MODEL="${DREAM_MODEL:-qwen3.8:27b-q4_K_M}" CYCLE_MS="${CYCLE_MS:-20000}" nohup node bot.js >> "bot_$n.out" 2>&1 &
      echo $! > "$pf"
      sleep 4
    fi
  done
  sleep 15
done
