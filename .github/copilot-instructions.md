# Copilot instructions

This repo's main guidance lives in [CLAUDE.md](../CLAUDE.md) — read it first for what the app
does, architecture, data sources, and conventions. Everything there applies regardless of which
AI tool is being used.

## Working efficiently in this repo

- Before opening arena docs or engine source for a specific question, start with
  `docs/arena-tooling.md` (what each verify/probe/tally script proves) and
  `docs/arena-next-session-prompt.md` (current state, priority order). There are 20+ other
  `docs/arena-*.md` files (several 400-2,400+ lines) — grep them for the term you need rather than
  reading multiple specs end to end.
- `src/lib/arena/engine/` is large: the compiler implementation now lives under
  `src/lib/arena/engine/compile/`, `compile.ts` is its stable public barrel, and `engine.ts`,
  `script.ts`, `state.ts` are each 1,800-4,600 lines. Search for the symbol/function first and
  read only the surrounding region — don't open these files in full.
- For iterating on pure rule logic, run `npx tsx scripts/verify-rules.ts` and
  `npx tsx scripts/verify-arena.ts` — much faster than the full `npm test`, which also runs
  `verify-db.mts` (spins up PGlite + migrations every time). Run the full suite before finalizing.
- Never run `npm run sync:catalog` or `npm run sync:prices` just to inspect state — they hit real
  network endpoints and take 30-50 seconds.
- Before editing a large file (`src/db/schema.ts`, `src/components/arena/stage/ArenaStage.tsx`,
  `src/lib/arena/probe.ts`, anything in `src/lib/arena/engine/`), search for the target symbol and
  edit that region rather than reading and rewriting the whole file.
- If a change affects what the compiler understands about card text, update
  `src/lib/arena/glossary.ts` in the same change — it's the single source of truth (see CLAUDE.md
  Conventions) and a stale entry is worse than none.

See `.github/instructions/arena.instructions.md` for arena-specific guidance that only applies
when working under `src/lib/arena/` or `docs/arena-*.md`.
