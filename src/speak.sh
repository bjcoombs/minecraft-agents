#!/bin/zsh
# Speak Minecraft bot chat aloud, one voice per bot.
LOG="$(dirname "$0")/server.out"

voice_for() {
  case "$1" in
    Claude)     echo "Daniel"   ;;   # British male
    Woodcutter) echo "Moira"    ;;   # Irish female
    Builder)    echo "Karen"    ;;   # Australian female
    Miner)      echo "Samantha" ;;   # American female
    Forager)    echo "Fiona"    ;;   # Scottish female (falls back if absent)
    *)          echo "Daniel"   ;;
  esac
}

BOTS="Claude Woodcutter Builder Miner Forager"

tail -n 0 -F "$LOG" 2>/dev/null | while IFS= read -r line; do
  case "$line" in
    *"[Not Secure] <"*)
      body="${line#*\[Not Secure\] <}"
      who="${body%%>*}"
      msg="${body#*> }"
      [ -z "$msg" ] && continue
      # only speak for our bots, never the human player
      speak_it=0
      for b in ${=BOTS}; do
        [ "$who" = "$b" ] && speak_it=1
      done
      [ "$speak_it" -eq 0 ] && continue
      v=$(voice_for "$who")
      # fall back to Daniel if the voice is not installed
      if ! say -v '?' 2>/dev/null | awk '{print $1}' | grep -qx "$v"; then v="Daniel"; fi
      say -v "$v" -r 190 "$msg" 2>/dev/null
      ;;
  esac
done
