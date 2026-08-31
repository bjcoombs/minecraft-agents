#!/usr/bin/env python3
"""Measure the three things the runtime actually depends on, per model:

  1. CACHEABILITY - does Ollama reuse the KV cache for a byte-identical prompt
     prefix? bot.js orders its prompt static-first precisely to exploit this.
     A model that does not cache costs full prompt-eval on every 12s cycle.
  2. THINK-OFF SUPPORT - does the model accept `think: false`, and does it
     actually stop emitting hidden reasoning tokens when told to?
  3. FIT - does it load at all in 64GB alongside nothing else.
"""
import json, time, urllib.request, sys

URL = "http://127.0.0.1:11434/api/generate"

# A realistic static prefix: this is the shape bot.js sends every cycle.
PREFIX = ("You are Miner, gruff, happiest underground, deadpan.\n"
          "You are one of six friends playing Minecraft: Claude, Woodcutter, "
          "Builder, Miner, Forager, Fighter. Ben is the human.\n"
          + "Wiki memory:\n" + "\n".join(
              f"- day {i}: mined at y=-54, stored ore in my chest, ate bread, "
              f"fought a zombie near the ravine, slept at base." for i in range(40))
          + "\nReply ONLY with JSON: {\"say\":\"<under 15 words>\","
            "\"action\":\"<one of: follow, stop, chop, mine, deep, forage, farm, "
            "fish, come, deposit, build, chest, eat, explore, idle>\"}\n")

def call(model, prompt, think=None, timeout=240):
    body = {"model": model, "prompt": prompt, "stream": False, "format": "json",
            "keep_alive": "5m", "options": {"num_predict": 40, "temperature": 0}}
    if think is not None:
        body["think"] = think
    req = urllib.request.Request(URL, json.dumps(body).encode(),
                                 {"Content-Type": "application/json"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r), time.time() - t0

def evict_all():
    try:
        with urllib.request.urlopen("http://127.0.0.1:11434/api/ps", timeout=10) as r:
            for m in json.load(r).get("models", []):
                b = json.dumps({"model": m["name"], "keep_alive": 0}).encode()
                urllib.request.urlopen(urllib.request.Request(
                    URL, b, {"Content-Type": "application/json"}), timeout=30).read()
    except Exception:
        pass

def probe(model):
    evict_all()
    out = {"model": model}
    try:
        # ---- fit + cold load
        d, w = call(model, PREFIX + "Situation: nothing happening.\nJSON:")
        out["load_s"] = round(d.get("load_duration", 0) / 1e9, 1)
        out["fits"] = True
        pe1 = d.get("prompt_eval_duration", 0) / 1e9
        n1  = d.get("prompt_eval_count", 0)

        # ---- cacheability: identical prefix, different tail
        d2, _ = call(model, PREFIX + "Situation: a creeper is near.\nJSON:")
        pe2 = d2.get("prompt_eval_duration", 0) / 1e9
        n2  = d2.get("prompt_eval_count", 0)
        out["prompt_tokens_1st"] = n1
        out["prompt_tokens_2nd"] = n2
        out["prompt_eval_1st_s"] = round(pe1, 3)
        out["prompt_eval_2nd_s"] = round(pe2, 3)
        # if the cache is reused, the 2nd call re-evaluates far fewer tokens
        out["cache_reuse_pct"] = round(100 * (1 - (n2 / n1)), 0) if n1 else None
        out["cache_speedup"] = round(pe1 / pe2, 1) if pe2 > 0 else None

        # ---- think:false honoured?
        try:
            d3, w3 = call(model, PREFIX + "Situation: you are starving.\nJSON:",
                          think=False)
            r3 = (d3.get("response") or "").strip()
            out["think_false"] = "accepted" if r3 else "accepted but EMPTY output"
            out["think_false_lat"] = round(w3, 2)
        except Exception as e:
            msg = str(e)
            out["think_false"] = ("rejected (not a thinking model)"
                                  if "does not support" in msg or "400" in msg
                                  else f"error: {msg[:40]}")
        # ---- warm steady-state latency
        lats = []
        for i in range(3):
            _, w4 = call(model, PREFIX + f"Situation: turn {i}, all quiet.\nJSON:")
            lats.append(w4)
        out["warm_lat_s"] = round(sorted(lats)[1], 2)
    except Exception as e:
        out["fits"] = False
        out["error"] = str(e)[:90]
    return out

if __name__ == "__main__":
    res = [probe(m) for m in sys.argv[1:]]
    hdr = (f"{'model':<24}{'fit':>5}{'load':>7}{'warm':>7}"
           f"{'cache%':>8}{'spdup':>7}{'think:false':>32}")
    print(); print(hdr); print("-" * len(hdr))
    for r in res:
        if not r.get("fits"):
            print(f"{r['model']:<24}   NO   {r.get('error','')[:60]}"); continue
        print(f"{r['model']:<24}{'yes':>5}{str(r['load_s'])+'s':>7}"
              f"{str(r['warm_lat_s'])+'s':>7}{str(r['cache_reuse_pct'])+'%':>8}"
              f"{str(r['cache_speedup'])+'x':>7}{r['think_false']:>32}")
    json.dump(res, open("cache-results.json", "w"), indent=2)
    print("\n  -> cache-results.json")
