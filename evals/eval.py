#!/usr/bin/env python3
"""Evaluate local LLMs on the actual Minecraft-agent workload.

Scores what matters for driving a bot, not general benchmarks:
  - schema validity      does it emit {say, action} at all
  - action legality      is the action one we can execute
  - action appropriateness  is it sensible for the situation
  - brevity              under 15 words, as instructed
  - silence discipline   does it stay quiet when told there is nothing new
  - latency / throughput
"""
import json, time, urllib.request, statistics, sys

URL = "http://127.0.0.1:11434/api/generate"
ACTIONS = {"follow","stop","chop","mine","deep","forage","farm","fish",
           "come","deposit","build","chest","eat","explore","idle"}

SYSTEM = """You are Miner, gruff, happiest underground, deadpan.
You are one of six friends playing Minecraft: Claude, Woodcutter, Builder,
Miner, Forager, Fighter. Ben is the human.
Reply ONLY with JSON: {"say":"<under 15 words, or empty to stay quiet>",
"action":"<one of: follow, stop, chop, mine, deep, forage, farm, fish, come,
deposit, build, chest, eat, explore, idle>"}"""

# each case: prompt, actions we would accept, and whether silence is correct
CASES = [
    dict(name="teammate_question",
         ctx="<Builder> miner, how much iron have you got?\nYou hold 12 raw_iron.",
         ok={"idle","deposit","mine","deep"}, expect_speech=True),
    dict(name="danger",
         ctx="A creeper is 3 blocks away and hissing. Health 8/20.",
         ok={"stop","come","idle","eat"}, expect_speech=True),
    dict(name="hungry",
         ctx="Your food is 4/20. You have 12 bread. Nothing is attacking you.",
         ok={"eat"}, expect_speech=False),
    dict(name="direct_order",
         ctx="<Ben> miner, go mine some diamonds for us",
         ok={"deep","mine"}, expect_speech=True),
    dict(name="nothing_new",
         ctx="<Builder> found nether brick over here\n"
             "You already said 'found nether brick over here' one minute ago.\n"
             "You have nothing new to add.",
         ok={"idle","explore","mine","deep"}, expect_speech=False),
    dict(name="resource_request",
         ctx="<Forager> anyone got spare cobblestone? i need 20\nYou hold 64 cobblestone.",
         ok={"come","deposit","idle","follow"}, expect_speech=True),
]

def ask(model, prompt, think=None, timeout=45):
    body = {"model": model, "prompt": prompt, "stream": False, "format": "json",
            "keep_alive": "10m",
            "options": {"num_predict": 100, "temperature": 0.7, "num_ctx": 8192}}
    if think is not None:
        body["think"] = think
    req = urllib.request.Request(URL, json.dumps(body).encode(),
                                 {"Content-Type": "application/json"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        d = json.load(r)
    return d, time.time() - t0

def score(model, think=None, reps=1):
    rows, lat, tps = [], [], []
    for case in CASES:
        for _ in range(reps):
            prompt = f"{SYSTEM}\n\nSituation:\n{case['ctx']}\n\nJSON:"
            try:
                d, wall = ask(model, prompt, think)
            except Exception as e:
                rows.append(dict(case=case["name"], valid=False, legal=False,
                                 apt=False, brief=False, silent_ok=False, err=str(e)[:40]))
                continue
            lat.append(wall)
            if d.get("eval_count") and d.get("eval_duration"):
                tps.append(d["eval_count"] / (d["eval_duration"] / 1e9))
            raw = (d.get("response") or "").strip()
            valid = legal = apt = brief = silent_ok = False
            say = act = ""
            try:
                o = json.loads(raw)
                say = str(o.get("say", "")).strip()
                act = str(o.get("action", "")).strip().lower()
                valid = isinstance(o, dict) and "say" in o and "action" in o
                legal = act in ACTIONS
                apt = act in case["ok"]
                brief = len(say.split()) <= 15
                silent_ok = (bool(say) == case["expect_speech"]) or (not case["expect_speech"] and not say)
            except Exception:
                pass
            rows.append(dict(case=case["name"], valid=valid, legal=legal, apt=apt,
                             brief=brief, silent_ok=silent_ok, say=say[:60], action=act))
    n = len(rows)
    pct = lambda k: round(100 * sum(1 for r in rows if r.get(k)) / n)
    return dict(model=model, think=think, n=n,
                schema=pct("valid"), legal=pct("legal"), apt=pct("apt"),
                brief=pct("brief"), silence=pct("silent_ok"),
                latency=round(statistics.median(lat), 2) if lat else None,
                tps=round(statistics.median(tps), 1) if tps else None,
                rows=rows)

if __name__ == "__main__":
    targets = [(m, None) for m in sys.argv[1:]] or [("llama3.1:latest", None)]
    out = []
    for m, th in targets:
        print(f"  running {m} ...", flush=True)
        try:
            out.append(score(m, th))
        except Exception as e:
            print(f"    FAILED: {e}")
    print()
    hdr = f"{'model':<32}{'schema':>7}{'legal':>7}{'apt':>6}{'brief':>7}{'quiet':>7}{'tok/s':>8}{'lat':>7}"
    print(hdr); print("-" * len(hdr))
    for r in out:
        print(f"{r['model']:<32}{r['schema']:>6}%{r['legal']:>6}%{r['apt']:>5}%"
              f"{r['brief']:>6}%{r['silence']:>6}%{str(r['tps']):>8}{str(r['latency']):>7}")
    json.dump(out, open("eval-results.json", "w"), indent=2)
    print("\n  full results -> eval-results.json")
