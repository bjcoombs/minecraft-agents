# Wiki schema

Every bot keeps its own directory: `memory/<Name>/`.

## The three layers

1. **Raw sources** (immutable) — `journal.md`. Append-only log of what actually
   happened, written during the day by the bot itself. Never edited, never deleted.
2. **The wiki** (LLM-maintained) — the pages below. Compiled from the journal
   each night during sleep. Rewritten freely as understanding improves.
3. **This schema** — the conventions the bot follows when compiling.

## Pages every bot maintains

- `wiki.md`      — index. Links to the other pages, plus a one-line "who I am".
- `world.md`     — places, coordinates, what is where. Home, chests, mines, water, sheep.
- `teammates.md` — one section per teammate: what they do, what they have asked for,
                   what they are good and bad at.
- `tasks.md`     — what I am trying to do, what is blocked, what I finished.
- `lessons.md`   — things that went wrong and what to do differently. The most valuable page.

## Rules for the nightly compile ("dreaming")

- Read `journal.md` since the last compile, plus the current wiki pages.
- Update pages in place. Prefer editing an existing line to appending a new one.
- Keep each page under 60 lines. If it grows past that, compress the oldest material.
- Record specifics: coordinates, item counts, names. Not "I gathered some wood".
- Contradictions get resolved, not stacked. Newer evidence wins; note when you changed your mind.
- Append one dated line to `tasks.md` describing what you will do tomorrow.
