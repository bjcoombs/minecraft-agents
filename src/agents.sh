#!/bin/zsh
# Start/stop the whole 26.1 agent stack, and swap the model without editing files.
# The Create world is a SEPARATE game - the agents are pure CPU/GPU overhead
# while you are playing it.
cd "$(dirname "$0")"
case "$1" in
  stop)
    pkill -f babysit.sh; pkill -f supervise.sh; sleep 1
    pkill -f "node bot.js"; sleep 2
    # release the GPU too, or the model sits resident for its keep_alive
    for m in $(curl -s --max-time 10 http://127.0.0.1:11434/api/ps 2>/dev/null \
               | python3 -c "import json,sys;[print(x['name']) for x in json.load(sys.stdin).get('models',[])]" 2>/dev/null); do
      curl -s --max-time 20 http://127.0.0.1:11434/api/generate -d "{\"model\":\"$m\",\"keep_alive\":0}" >/dev/null
    done
    echo "agents stopped, GPU released (server left running)"
    ;;
  start)
    nohup ./supervise.sh > supervise.out 2>&1 & sleep 2
    nohup ./babysit.sh > babysit.out 2>&1 & sleep 20
    echo "bots: $(pgrep -f 'bot.js'|wc -l|tr -d ' ')/6 on ${LLM_MODEL:-default}"
    ;;
  light)   # low-power model: 7GB and 0.43s per decision instead of 17GB and 2.45s
    $0 stop
    LLM_MODEL=mistral-nemo:12b DREAM_MODEL=mistral-nemo:12b CYCLE_MS=12000 $0 start
    ;;
  heavy)   # best-measured quality
    $0 stop
    LLM_MODEL=qwen3.8:27b-q4_K_M DREAM_MODEL=qwen3.8:27b-q4_K_M CYCLE_MS=20000 $0 start
    ;;
  status)
    echo "  server: $(pgrep -f server.jar >/dev/null && echo up || echo down)"
    echo "  bots:   $(pgrep -f 'bot.js'|wc -l|tr -d ' ')/6"
    echo "  model:  $(ps -Eo command= -p $(pgrep -f 'node bot.js'|head -1) 2>/dev/null | tr ' ' '\n' | grep '^LLM_MODEL=' | cut -d= -f2)"
    timeout 10 ollama ps 2>/dev/null | tail -n +2
    uptime | sed 's/.*averages*: /  load: /'
    ;;
  *) echo "usage: ./agents.sh {stop|start|light|heavy|status}";;
esac
