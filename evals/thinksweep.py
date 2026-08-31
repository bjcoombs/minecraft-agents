#!/usr/bin/env python3
"""Is there a useful middle setting between 'no thinking' and 'full thinking'?

Ben's question. The repo currently treats thinking as a binary and sends
think:false everywhere, on the strength of one bad experience with qwen3 that
was later shown to be about output constraint, not reasoning.

This sweeps every reasoning level a model will accept and measures the tradeoff
that actually matters here: appropriateness and harm against latency, on the
same 44 cases. A 12s decision loop can afford roughly 2-3s per call across six
bots, so a level is only interesting if it buys accuracy inside that budget.
"""
import json, sys, time, statistics, urllib.request
import eval2   # reuse the identical scorer, cases and baselines

LEVELS = [False, "low", "medium", "high", True]

def supports(model, level):
    """Does this model accept this reasoning level at all?"""
    try:
        body = {"model": model, "prompt": "hi", "stream": False,
                "think": level, "options": {"num_predict": 4}}
        req = urllib.request.Request(eval2.URL, json.dumps(body).encode(),
                                     {"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=120) as r:
            d = json.load(r)
        return ("error" not in d), d.get("error", "")[:60]
    except urllib.error.HTTPError as e:
        try: msg = json.load(e).get("error", "")[:60]
        except Exception: msg = f"HTTP {e.code}"
        return False, msg
    except Exception as e:
        return False, str(e)[:60]

if __name__ == "__main__":
    cases = eval2.load_cases()
    models = [a for a in sys.argv[1:] if not a.startswith("-")]
    out = []
    for m in models:
        eval2.warm(m)   # evict others, load this one once for the whole sweep
        for lvl in LEVELS:
            ok, err = supports(m, lvl)
            if not ok:
                print(f"  {m} think={lvl!r}: unsupported ({err})", flush=True)
                continue
            t0 = time.time()
            r = eval2.score(m, cases, think=lvl)
            r["level"] = str(lvl)
            r["sweep_wall"] = round(time.time() - t0, 1)
            out.append(r)
            print(f"  {m:<22} think={str(lvl):<7} apt {r['apt']:>3}%  "
                  f"harm {r['harmful']:>3}%  lat {r['latency']}s  "
                  f"({r['sweep_wall']}s)", flush=True)
    hdr = f"{'model':<24}{'think':>8}{'apt':>6}{'harm':>6}{'schema':>8}{'lat':>7}{'p90':>7}{'tok/s':>8}"
    print(); print(hdr); print("-"*len(hdr))
    for r in out:
        print(f"{r['model']:<24}{r['level']:>8}{r['apt']:>5}%{r['harmful']:>5}%"
              f"{r['schema']:>7}%{str(r['latency']):>7}{str(r.get('p90')):>7}{str(r['tps']):>8}")
    print("\n  baselines: random apt 7% / harm 47%; constant 'mine' apt 0% / harm 98%")
    json.dump(out, open("think-sweep.json","w"), indent=2)
