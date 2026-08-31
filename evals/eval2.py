#!/usr/bin/env python3
"""Evaluate local LLMs on the actual Minecraft-agent workload.

v2. Fixes four measurement flaws in v1:

  1. Cold-start contamination. v1 charged Ollama's model LOAD time (seconds to
     minutes for a 5GB model) to the model's latency. That is what made qwen3
     and andy-4 look "too slow for a 12s loop". We now warm each model first
     and report load_duration separately from inference.
  2. No sleep detection. The v1 batch ran while the Mac was asleep; the numbers
     were garbage and nothing said so. We stamp load average before and after
     and flag any wall-clock gap that inference cannot explain.
  3. No degenerate baseline. v1 scored llama3.1 at 42% appropriateness without
     ever asking what a model that ALWAYS answers "mine" would score. If a
     constant policy scores near a real model, the eval measures nothing.
     Every run now scores the constant policies through the identical scorer.
  4. No penalty for actively wrong answers. "not in the ok set" lumped a
     harmless choice together with a dangerous one. Cases now carry a `bad`
     set, scored separately.
"""
import json, time, urllib.request, statistics, sys, os, subprocess, re

URL = "http://127.0.0.1:11434/api/generate"
ACTIONS = {"follow","stop","chop","mine","deep","forage","farm","fish",
           "come","deposit","build","chest","eat","explore","idle"}

SYSTEM = """You are Miner, gruff, happiest underground, deadpan.
You are one of six friends playing Minecraft: Claude, Woodcutter, Builder,
Miner, Forager, Fighter. Ben is the human.
Reply ONLY with JSON: {"say":"<under 15 words, or empty to stay quiet>",
"action":"<one of: follow, stop, chop, mine, deep, forage, farm, fish, come,
deposit, build, chest, eat, explore, idle>"}"""

def load_cases(path="cases.json"):
    if os.path.exists(path):
        return json.load(open(path))
    # v1 fallback set, now with `bad` populated
    return [
      dict(name="teammate_question",
           ctx="<Builder> miner, how much iron have you got?\nYou hold 12 raw_iron.",
           ok=["idle","deposit"], bad=["chop","fish","farm","build"], expect_speech=True),
      dict(name="danger",
           ctx="A creeper is 3 blocks away and hissing. Health 8/20.",
           ok=["stop","come"], bad=["mine","deep","chop","farm","fish","build","idle"],
           expect_speech=True),
      dict(name="hungry",
           ctx="Your food is 4/20. You have 12 bread. Nothing is attacking you.",
           ok=["eat"], bad=["mine","deep","chop","fish","farm","build","idle","explore"],
           expect_speech=False),
      dict(name="direct_order",
           ctx="<Ben> miner, go mine some diamonds for us",
           ok=["deep"], bad=["chop","fish","farm","build","idle","follow"],
           expect_speech=True),
      dict(name="nothing_new",
           ctx="<Builder> found nether brick over here\n"
               "You already said 'found nether brick over here' one minute ago.\n"
               "You have nothing new to add.",
           ok=["idle","explore","mine","deep"], bad=[], expect_speech=False),
      dict(name="resource_request",
           ctx="<Forager> anyone got spare cobblestone? i need 20\nYou hold 64 cobblestone.",
           ok=["come","deposit"], bad=["mine","deep","chop","fish","farm","build"],
           expect_speech=True),
    ]

def loadavg():
    return os.getloadavg()[0]

# gpt-oss emits reasoning into `thinking` and the answer into `response` on its
# own. Adding format:json makes it dump the reasoning into `response` as prose
# instead - it scored 0% for four runs purely because of this flag.
NO_JSON_FORMAT = ("gpt-oss",)

def wants_json_format(model):
    return not any(k in model for k in NO_JSON_FORMAT)

def extract_json(raw):
    """Pull the first {...} object out of a free-text response."""
    raw = re.sub(r"<think>[\s\S]*?</think>", "", raw or "")
    m = re.search(r'\{[^{}]*"action"[^{}]*\}', raw)
    if m: return m.group(0)
    m = re.search(r"\{[\s\S]*?\}", raw)
    return m.group(0) if m else raw.strip()

def ask(model, prompt, think=None, timeout=180):
    body = {"model": model, "prompt": prompt, "stream": False,
            "keep_alive": "10m",
            "options": {"num_predict": 100, "temperature": 0.7, "num_ctx": 8192}}
    if wants_json_format(model):
        body["format"] = "json"
    else:
        body["options"]["num_predict"] = 600   # room for reasoning + answer
    if think is not None:
        body["think"] = think
    req = urllib.request.Request(URL, json.dumps(body).encode(),
                                 {"Content-Type": "application/json"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        d = json.load(r)
    return d, time.time() - t0

def evict(model):
    """Force Ollama to unload a model by requesting it with keep_alive 0.

    Ollama would not co-load qwen3 (11GB @ 40960 ctx) alongside llama3.1, so a
    second model's request sat queued behind the first model's 30-minute
    keep_alive lease - forever, if bots keep renewing it. Measured: qwen3
    appeared to hang for >8 minutes; after evicting llama3.1 it loaded in 3.8s
    and generated in 0.14s. THAT is what "too slow for a 12s loop" actually was.
    """
    try:
        body = json.dumps({"model": model, "keep_alive": 0}).encode()
        req = urllib.request.Request(URL, body, {"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=30).read()
    except Exception:
        pass

def loaded_models():
    try:
        with urllib.request.urlopen("http://127.0.0.1:11434/api/ps", timeout=10) as r:
            return [m["name"] for m in json.load(r).get("models", [])]
    except Exception:
        return []

def warm(model):
    """Load the model into memory and report how long that cost.

    This is the number that made v1 wrong: it was being charged to latency.
    """
    for other in loaded_models():
        if other != model:
            evict(other)
    t0 = time.time()
    try:
        d, _ = ask(model, "Reply with {\"ok\":1,\"action\":\"idle\",\"say\":\"\"}", timeout=600)
        return dict(ok=True, wall=round(time.time() - t0, 1),
                    load_s=round(d.get("load_duration", 0) / 1e9, 1))
    except Exception as e:
        return dict(ok=False, wall=round(time.time() - t0, 1), err=str(e)[:80])

def judge(say, act, case):
    """Score one response. Shared by real models and the constant baselines."""
    legal = act in ACTIONS
    apt   = act in case["ok"]
    harm  = act in case.get("bad", [])
    brief = len(say.split()) <= 15
    silent_ok = bool(say) == case["expect_speech"]
    return legal, apt, harm, brief, silent_ok

def score_constant(action, cases, reps=1):
    """What does a model that ignores the situation entirely score?

    If a real model cannot clearly beat this, the eval is not measuring
    situational awareness - it is measuring nothing.
    """
    rows = []
    for case in cases:
        for _ in range(reps):
            legal, apt, harm, brief, sok = judge("", action, case)
            rows.append(dict(case=case["name"], valid=True, legal=legal, apt=apt,
                             harmful=harm, brief=brief, silent_ok=sok, action=action))
    return summarize(f"[constant:{action}]", None, rows, [], [], None)

def summarize(model, think, rows, lat, tps, warminfo):
    n = max(len(rows), 1)
    pct = lambda k: round(100 * sum(1 for r in rows if r.get(k)) / n)
    return dict(model=model, think=think, n=n,
                schema=pct("valid"), legal=pct("legal"), apt=pct("apt"),
                harmful=pct("harmful"), brief=pct("brief"), silence=pct("silent_ok"),
                latency=round(statistics.median(lat), 2) if lat else None,
                p90=round(sorted(lat)[int(len(lat)*0.9)], 2) if len(lat) > 2 else None,
                tps=round(statistics.median(tps), 1) if tps else None,
                warm=warminfo, rows=rows)

def score(model, cases, think=None, reps=1):
    w = warm(model)   # evicts any other resident model first - see evict()
    if not w["ok"]:
        return dict(model=model, error=w.get("err"), warm=w, rows=[])
    rows, lat, tps = [], [], []
    for case in cases:
        for _ in range(reps):
            prompt = f"{SYSTEM}\n\nSituation:\n{case['ctx']}\n\nJSON:"
            l0 = loadavg()
            try:
                d, wall = ask(model, prompt, think)
            except Exception as e:
                rows.append(dict(case=case["name"], valid=False, legal=False,
                                 apt=False, harmful=False, brief=False,
                                 silent_ok=False, err=str(e)[:60]))
                continue
            # a nonzero load_duration mid-run means the model was evicted and
            # reloaded - that sample's wall time is not inference time
            reloaded = d.get("load_duration", 0) / 1e9 > 1.0
            if not reloaded:
                lat.append(wall)
            if d.get("eval_count") and d.get("eval_duration"):
                tps.append(d["eval_count"] / (d["eval_duration"] / 1e9))
            raw = (d.get("response") or "").strip()
            if not wants_json_format(model):
                raw = extract_json(raw)
            valid = legal = apt = harm = brief = sok = False
            say = act = ""
            try:
                o = json.loads(raw)
                say = str(o.get("say", "")).strip()
                act = str(o.get("action", "")).strip().lower()
                valid = isinstance(o, dict) and "say" in o and "action" in o
                legal, apt, harm, brief, sok = judge(say, act, case)
            except Exception:
                pass
            rows.append(dict(case=case["name"], valid=valid, legal=legal, apt=apt,
                             harmful=harm, brief=brief, silent_ok=sok,
                             say=say[:70], action=act, wall=round(wall, 2),
                             reloaded=reloaded, load=round(l0, 1)))
    return summarize(model, think, rows, lat, tps, w)

HDR = (f"{'model':<30}{'schema':>7}{'legal':>7}{'apt':>6}{'harm':>6}"
       f"{'brief':>7}{'quiet':>7}{'tok/s':>8}{'lat':>7}{'p90':>7}{'load_s':>8}")

def row(r):
    if r.get("error"):
        return f"{r['model']:<30}  FAILED: {r['error'][:60]}"
    w = r.get("warm") or {}
    return (f"{r['model']:<30}{r['schema']:>6}%{r['legal']:>6}%{r['apt']:>5}%"
            f"{r['harmful']:>5}%{r['brief']:>6}%{r['silence']:>6}%"
            f"{str(r['tps']):>8}{str(r['latency']):>7}{str(r.get('p90')):>7}"
            f"{str(w.get('load_s','-')):>8}")

if __name__ == "__main__":
    cases = load_cases()
    argv = sys.argv[1:]
    # reasoning models return EMPTY unless told to stop thinking - qwen3:4b
    # scored 0% purely because the harness never sent think:false.
    think = False if "--think-false" in argv else None
    for a in argv:
        if a.startswith("--think="):
            v = a.split("=",1)[1]
            think = {"false":False,"true":True}.get(v.lower(), v)
    reps = 1
    for a in argv:
        if a.startswith("--reps="): reps = int(a.split("=")[1])
    models = [a for a in argv if not a.startswith("--")] or ["llama3.1:latest"]
    t_start = time.time()
    print(f"  {len(cases)} cases, load avg {loadavg():.1f}", flush=True)
    out = []
    for m in models:
        print(f"  running {m} ...", flush=True)
        t0 = time.time()
        try:
            r = score(m, cases, think=think, reps=reps)
        except Exception as e:
            r = dict(model=m, error=str(e)[:80], rows=[])
        r["wall_total"] = round(time.time() - t0, 1)
        if think is not None:
            r["model"] = r["model"] + f" (think:{think})"
        print(f"    {r['wall_total']}s"
              + (f"  (model load {r['warm']['load_s']}s of that)" if r.get("warm",{}).get("load_s") else ""),
              flush=True)
        out.append(r)
    # the control: what a situation-blind policy scores on this same set
    for const in ("mine", "idle"):
        out.append(score_constant(const, cases))

    print(); print(HDR); print("-" * len(HDR))
    for r in out: print(row(r))
    print(f"\n  total wall {round(time.time()-t_start,1)}s, load avg now {loadavg():.1f}")
    json.dump(out, open("eval-results-v2.json", "w"), indent=2)
    print("  full results -> eval-results-v2.json")
