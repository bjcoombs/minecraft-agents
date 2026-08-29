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
    if [ "$alive" -eq 0 ]; then
      echo "[$(date +%T)] supervisor: starting $n" >> events.log
      BOT_NAME="$n" USE_LLM=1 LLM_MODEL="llama3.1:latest" DREAM_MODEL="llama3.1:latest" nohup node bot.js >> "bot_$n.out" 2>&1 &
      echo $! > "$pf"
      sleep 4
    fi
  done
  sleep 15
done
