# Copilot instructions

This repo's main guidance lives in [CLAUDE.md](../CLAUDE.md) — read it first for what the app
does, the safety facts, commands and conventions; the architecture and data sources are indexed
there and live in `docs/architecture/`. Everything there applies regardless of which
AI tool is being used.

## Working efficiently in this repo

How to check a change (`npm run checks`, when to run the full suite) and the working habits:
[docs/agent-brief.md](../docs/agent-brief.md). For the arena, start from `docs/arena-tooling.md` and
[docs/architecture/arena.md](../docs/architecture/arena.md): grep the long `docs/arena-*.md` files instead of
reading them, search for a symbol before opening `engine.ts`, `script.ts`, `state.ts` or
`src/db/schema.ts`, and update `src/lib/arena/glossary.ts` in the same change as any compiler change.

See `.github/instructions/arena.instructions.md` for arena-specific guidance that only applies
when working under `src/lib/arena/` or `docs/arena-*.md`.
