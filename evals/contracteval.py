#!/usr/bin/env python3
"""Which OUTPUT CONTRACT gets the best behaviour out of each model?

The previous evals held the contract fixed (`format: json`) and varied the
model. That is backwards for choosing a general model: it measures how well a
model complies with one arbitrary convention, not how well it decides.

Here the model is held fixed and the CONTRACT varies, with adapter.normalise()
converting whatever comes back. Four contracts:

  json_format  Ollama's format:json, the strict constrained decode (status quo)
  free_text    no constraint at all; parse the prose
  tool_call    /api/chat with a function schema - the general industry contract
  think_free   thinking enabled, unconstrained output, parse the prose

Reported per cell: how often the output was PARSEABLE at all, which parse
strategy won, and the same apt/harm scores as every other eval so the numbers
are comparable.
"""
import json, re, sys, time, statistics, urllib.request
from collections import Counter
import adapter

GEN  = "http://127.0.0.1:11434/api/generate"
CHAT = "http://127.0.0.1:11434/api/chat"

SYSTEM = """You are Miner, gruff, happiest underground, deadpan.
You are one of six friends playing Minecraft: Claude, Woodcutter, Builder,
Miner, Forager, Fighter. Ben is the human."""

JSON_TAIL = ("""Reply ONLY with JSON: {"say":"<under 15 words, or empty to stay quiet>",
"action":"<one of: follow, stop, chop, mine, deep, forage, farm, fish, come,
deposit, build, chest, eat, explore, idle>"}""")

FREE_TAIL = ("""Say what you do, then give your chosen action on its own line as
  action: <one of follow, stop, chop, mine, deep, forage, farm, fish, come,
  deposit, build, chest, eat, explore, idle>""")

TOOL = [{"type":"function","function":{
    "name":"act","description":"Take one action, optionally saying something",
    "parameters":{"type":"object","required":["action"],"properties":{
        "action":{"type":"string","enum":adapter.ACTIONS},
        "say":{"type":"string","description":"under 15 words; empty to stay quiet"}}}}}]

def post(url, body, timeout=240):
    req = urllib.request.Request(url, json.dumps(body).encode(),
                                 {"Content-Type": "application/json"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r), time.time() - t0

def run_case(model, case, contract):
    ctx = case["ctx"]
    if contract == "tool_call":
        body = {"model": model, "stream": False, "think": False, "keep_alive": "10m",
                "messages": [{"role": "system", "content": SYSTEM},
                             {"role": "user", "content": f"Situation:\n{ctx}"}],
                "tools": TOOL, "options": {"num_predict": 200, "temperature": 0.7}}
        d, w = post(CHAT, body)
        m = d.get("message", {}) or {}
        return adapter.normalise(m.get("content"), m.get("tool_calls"), m.get("thinking")), w, d
    tail = JSON_TAIL if contract == "json_format" else FREE_TAIL
    body = {"model": model, "stream": False, "keep_alive": "10m",
            "prompt": f"{SYSTEM}\n{tail}\n\nSituation:\n{ctx}\n\nReply:",
            "options": {"num_predict": 100 if contract=="json_format" else 400,
                        "temperature": 0.7, "num_ctx": 8192}}
    if contract == "json_format": body["format"] = "json"; body["think"] = False
    elif contract == "free_text": body["think"] = False
    elif contract == "think_free": body["think"] = True; body["options"]["num_predict"] = 1200
    d, w = post(GEN, body)
    return adapter.normalise(d.get("response"), None, d.get("thinking")), w, d

def score(model, cases, contract):
    rows, lat, strategies = [], [], Counter()
    for case in cases:
        try:
            (out, strat), w, d = run_case(model, case, contract)
        except Exception as e:
            rows.append({"parsed":False,"apt":False,"harm":False,"brief":False}); continue
        lat.append(w); strategies[strat] += 1
        act, say = out["action"], out["say"]
        rows.append({"parsed": bool(act),
                     "apt": act in case["ok"],
                     "harm": act in case.get("bad", []),
                     "brief": len(say.split()) <= 15,
                     "action": act, "strategy": strat})
    n = max(len(rows), 1)
    pct = lambda k: round(100*sum(1 for r in rows if r.get(k))/n)
    acts = Counter(r.get("action") for r in rows if r.get("action"))
    return {"model": model, "contract": contract, "n": n,
            "parsed": pct("parsed"), "apt": pct("apt"), "harm": pct("harm"),
            "brief": pct("brief"),
            "latency": round(statistics.median(lat),2) if lat else None,
            "strategies": dict(strategies),
            "distinct_actions": len(acts),
            "top_action": acts.most_common(1)[0] if acts else None}

def evict_others(model):
    """Ollama will not co-load a 17GB and a 13GB model; a second model's request
    queues behind the first's keep_alive lease indefinitely. This bug is
    documented in evals/README.md and I reintroduced it here - the run sat at
    0% CPU for 18 minutes. Evict before every model."""
    try:
        with urllib.request.urlopen("http://127.0.0.1:11434/api/ps", timeout=10) as r:
            for m in json.load(r).get("models", []):
                if m["name"] == model: continue
                b = json.dumps({"model": m["name"], "keep_alive": 0}).encode()
                urllib.request.urlopen(urllib.request.Request(
                    GEN, b, {"Content-Type":"application/json"}), timeout=30).read()
    except Exception:
        pass

if __name__ == "__main__":
    cases = json.load(open("cases.json"))
    models = [a for a in sys.argv[1:] if not a.startswith("-")]
    contracts = ["json_format","free_text","tool_call","think_free"]
    out = []
    for m in models:
        evict_others(m)
        print(f"  --- {m} (others evicted) ---", flush=True)
        for c in contracts:
            try:
                r = score(m, cases, c)
            except Exception as e:
                print(f"  {m} / {c}: FAILED {str(e)[:60]}", flush=True); continue
            out.append(r)
            print(f"  {m:<24}{c:<12} parsed {r['parsed']:>3}%  apt {r['apt']:>3}%  "
                  f"harm {r['harm']:>3}%  lat {r['latency']}s  via {r['strategies']}", flush=True)
    hdr = f"{'model':<24}{'contract':<12}{'parsed':>8}{'apt':>6}{'harm':>6}{'lat':>7}{'acts':>6}"
    print(); print(hdr); print("-"*len(hdr))
    for r in out:
        print(f"{r['model']:<24}{r['contract']:<12}{r['parsed']:>7}%{r['apt']:>5}%"
              f"{r['harm']:>5}%{str(r['latency']):>7}{r['distinct_actions']:>6}")
    print("\n  baselines: random apt 7% / harm 47%")
    json.dump(out, open("contract-results.json","w"), indent=2)
