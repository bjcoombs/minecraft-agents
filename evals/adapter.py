#!/usr/bin/env python3
"""Normalise ANY model output into {say, action}.

Ben's observation: restricting every model to `format: json` was not a neutral
harness choice, it was a selection filter. It scored gpt-oss at 0% four times,
made thinking unusable on the qwen3 family, and silently rejected andy-4 for
speaking a different protocol. We were choosing models that fit our contract
instead of choosing the contract that gets the best behaviour.

This is the contract-agnostic layer: take whatever the model natively emits and
convert it. Each strategy is tried in order and reports WHICH one succeeded, so
we can measure what a model's natural output format actually is.
"""
import json, re

ACTIONS = ["follow","stop","chop","mine","deep","forage","farm","fish","come",
           "deposit","build","chest","eat","explore","idle"]

# Mindcraft-style and other命令 conventions map onto our verbs.
ALIASES = {
    "moveaway":"stop", "goto":"come", "gotoplayer":"come", "followplayer":"follow",
    "collectblocks":"mine", "collect":"mine", "attack":"stop", "defend":"stop",
    "retreat":"stop", "flee":"stop", "run":"stop", "eatfood":"eat", "consume":"eat",
    "gathermine":"mine", "digdown":"deep", "harvest":"farm", "plant":"farm",
    "hunt":"forage", "gather":"forage", "craft":"build", "place":"build",
    "store":"deposit", "withdraw":"chest", "wander":"explore", "scout":"explore",
    "wait":"idle", "nothing":"idle", "stay":"idle", "sharebread":"deposit",
    "eatbread":"eat",
}

# natural-language fallback: verbs that imply an action, longest first so
# "dig down" beats "dig"
NL_PATTERNS = [
    (r"\b(dig down|mine deep|head down|go deeper)\b", "deep"),
    (r"\b(back away|back off|get away|retreat|stop|hold still|freeze)\b", "stop"),
    (r"\b(come to|head to|go to|on my way|coming)\b", "come"),
    (r"\b(chop|cut.*(wood|tree)|fell)\b", "chop"),
    (r"\b(eat|have a bite|food now|tuck in)\b", "eat"),
    (r"\b(fish|cast.*rod)\b", "fish"),
    (r"\b(farm|plant|harvest|wheat)\b", "farm"),
    (r"\b(hunt|forage|kill.*(cow|pig|sheep)|find food)\b", "forage"),
    (r"\b(build|place|construct)\b", "build"),
    (r"\b(deposit|store|put.*chest|drop off)\b", "deposit"),
    (r"\b(take from|withdraw|grab from.*chest)\b", "chest"),
    (r"\b(explore|scout|look around|wander|search)\b", "explore"),
    (r"\b(follow)\b", "follow"),
    (r"\b(mine|dig)\b", "mine"),
    (r"\b(idle|do nothing|wait|stay put)\b", "idle"),
]

def _norm_action(a):
    if not a: return ""
    a = str(a).strip().lower()
    a = re.sub(r"\(.*?\)", "", a).strip()          # act(...) -> act
    a = re.sub(r"[^a-z_]", "", a.replace(" ", "_"))
    if a in ACTIONS: return a
    flat = a.replace("_", "")
    if flat in ACTIONS: return flat
    if flat in ALIASES: return ALIASES[flat]
    for k, v in ALIASES.items():                    # substring match
        if k in flat: return v
    for act in ACTIONS:                             # last resort
        if act in flat: return act
    return ""

def _from_obj(o):
    if not isinstance(o, dict): return None
    # accept a variety of key spellings
    act = o.get("action") or o.get("act") or o.get("command") or o.get("tool")
    say = o.get("say") or o.get("speech") or o.get("message") or o.get("text") or ""
    if act is None and "name" in o:                 # tool-call shape
        act = o.get("name"); say = (o.get("arguments") or {}).get("say", say) if isinstance(o.get("arguments"), dict) else say
    if act is None: return None
    return {"say": str(say).strip(), "action": _norm_action(act)}

def normalise(raw, tool_calls=None, thinking=None):
    """Return ({say, action}, strategy_name). action is '' if nothing parsed."""
    # 1. native tool call - the general industry contract
    if tool_calls:
        try:
            fn = tool_calls[0].get("function", tool_calls[0])
            args = fn.get("arguments")
            if isinstance(args, str): args = json.loads(args)
            args = args or {}
            act = args.get("action") or fn.get("name")
            r = {"say": str(args.get("say","")).strip(), "action": _norm_action(act)}
            if r["action"]: return r, "tool_call"
        except Exception: pass

    text = (raw or "").strip()
    text = re.sub(r"<think>[\s\S]*?</think>", "", text).strip()

    # 2. clean JSON
    try:
        r = _from_obj(json.loads(text))
        if r and r["action"]: return r, "strict_json"
    except Exception: pass

    # 3. JSON inside prose or markdown fences
    for m in re.finditer(r"\{[^{}]*\}", text):
        try:
            r = _from_obj(json.loads(m.group(0)))
            if r and r["action"]: return r, "embedded_json"
        except Exception: continue

    # 4. command syntax:  !action(args)  or  action: mine
    m = re.search(r"!\s*([a-zA-Z_]+)\s*\(([^)]*)\)", text)
    if m:
        a = _norm_action(m.group(1))
        if a: return {"say": re.sub(r"!\s*[a-zA-Z_]+\s*\([^)]*\)", "", text).strip()[:120], "action": a}, "command_syntax"
    m = re.search(r"\baction\s*[:=]\s*[\"']?([a-zA-Z_]+)", text, re.I)
    if m:
        a = _norm_action(m.group(1))
        if a:
            s = re.search(r"\bsay\s*[:=]\s*[\"']([^\"']*)", text, re.I)
            return {"say": (s.group(1) if s else "")[:120], "action": a}, "key_value"

    # 5. natural language
    low = text.lower()
    for pat, act in NL_PATTERNS:
        if re.search(pat, low):
            return {"say": text[:120], "action": act}, "natural_language"

    # 6. reasoning-only output: the thinking field may hold the decision
    if thinking:
        low = thinking.lower()
        for pat, act in NL_PATTERNS:
            if re.search(pat, low):
                return {"say": "", "action": act}, "from_thinking"
    return {"say": text[:120], "action": ""}, "unparsed"

if __name__ == "__main__":
    tests = [
        ('{"say":"Stop, creeper nearby","action":"stop"}', None, "strict_json"),
        ('Sure! ```json\n{"say":"ok","action":"mine"}\n```', None, "embedded_json"),
        ("Time to give you some space. !moveAway(40)", None, "command_syntax"),
        ('action: deep\nsay: "heading down"', None, "key_value"),
        ("I'll back away from that creeper slowly.", None, "natural_language"),
        ("", None, "unparsed"),
        ('{"say":"hi","action":"share_bread(6)"}', None, "strict_json"),
    ]
    for raw, tc, expect in tests:
        r, strat = normalise(raw, tc)
        flag = "ok " if strat == expect else "DIFF"
        print(f"  [{flag}] {strat:<18} action={r['action']!r:<12} <- {raw[:42]!r}")
    r, s = normalise("", [{"function": {"name": "act", "arguments": '{"action":"eat","say":"starving"}'}}])
    print(f"  [{'ok ' if s=='tool_call' else 'DIFF'}] {s:<18} action={r['action']!r}  <- tool_call")
