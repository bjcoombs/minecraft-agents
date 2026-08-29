# Schema

The conventions this repo follows. Based on Karpathy's LLM-wiki idea
(https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f), which
separates immutable evidence from compiled understanding.

## Three layers

1. **`sources/`** — raw, immutable. Log excerpts, the agents' own journals,
   final state files. Never edited, never tidied. This is the evidence.
2. **`wiki/`** — LLM-maintained. Compiled understanding: what broke, why, and
   what fixed it. Rewritten freely as understanding improves.
3. **`SCHEMA.md`** — this file. The conventions used when compiling layer 2
   from layer 1.

The point of the split: a claim in `wiki/` must be traceable to something in
`sources/`. If it isn't, it's a guess and should be labelled as one.

## Rules for wiki pages

- **Every finding cites its evidence.** Quote the actual log line. A finding
  without a log line is a hypothesis, and must say so.
- **Root cause, not symptom.** "Bots idle" is a symptom. "`ensureTool()` failed
  because a 1×1 shaft has no adjacent air to place a crafting table" is a cause.
- **Record the wrong turns.** The failed hypotheses are often more useful than
  the fix, because they show what the evidence *looked* like at the time.
- **Keep pages under ~150 lines.** Compress the oldest material when they grow.
- **Newer evidence wins.** Resolve contradictions rather than stacking them,
  and note when a previous conclusion was overturned.

## What earns a place in `wiki/`

Something that would cost an hour to rediscover. Version-specific API
behaviour, silent failure modes, a measurement that contradicts the obvious
choice. Not general programming knowledge, and not anything the code already
says plainly.
