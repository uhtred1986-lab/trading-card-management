---
title: Arena: RULES_PRIMER, the EFFECT_LANGUAGE legend, comboQuestion and view.ts zone lines from the definition
milestone: Arena M11 — Everything else from config (Stage 8)
labels: backlog, ready-for-agent, enhancement, area:arena-vm, area:arena-workbench, phase:rules-stage8, model:sonnet-5
stage: 8
---
**Source:** plan Stage 8; `src/lib/arena/ai/view.ts` (`RULES_PRIMER` — what Claude is told about the game), `ai/opponent.ts` (`EFFECT_LANGUAGE` — the referee's legend, read off `OP_SCHEMA`), `view.ts` (`questionFor`, `comboQuestion`, the zone lines of `boardView`); `prompts.rules` and `game.rules`.

**Problem.** Three places tell someone — the model, the referee, the player — what the game is, in prose written by hand. On the rules engine the prose is generated from the definition so it cannot drift from what the engine plays.

**Build.**
1. `RULES_PRIMER` generated from `game.rules`/`zones.rules`/`turn.rules` by the printer, compared in a test with the hand-written one for DBS (differences reviewed once, then the generated text becomes the fixture).
2. `questionFor` reads `prompts.rules` templates; `comboQuestion` and the zone lines read the vocabulary.
3. The referee's legend adds the Stage 2 primitives and the macros by name, still from the schema (one source).
4. Caching note in `CLAUDE.md` re-checked: the primer's token count changes the cached prefix; record the new figure.

**Acceptance.** Gate; `contract:emit` reviewed (`effect-language.txt` may move); a Sparring game on the rules engine gets a primer that names every zone the definition declares.
