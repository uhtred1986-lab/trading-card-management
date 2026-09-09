---
title: Arena: the Claude opponent and the referee play on the rules engine
milestone: Arena M11 — Everything else from config (Stage 8)
labels: backlog, ready-for-agent, enhancement, area:arena-vm, phase:rules-stage8, model:sonnet-5
stage: 8
---
**Source:** `src/lib/arena/ai/{view,opponent,run,debug,clarify}.ts`; `CLAUDE.md` "Claude as the arena opponent" and "Arena debug"; `aiPlayerOf`.

**Problem.** `opponent.ts` picks by index from the engine's legal-move list and answers the decisions that cannot go wrong without a call; `run.ts` drives it; the referee answers with a program when a card's text defeats the compiler. All of that is engine-agnostic by design but built against legacy types; on the rules engine it must go through `engineFor`.

**Build.**
1. `run.ts` and `opponent.ts` use the `Engine` interface only; the "cannot go wrong" shortcuts (one legal move, coin flip, mulligan, charge choice, the [Empower] carry) recognise the rules engine's prompts.
2. The referee's ruling lands as the card's draft rule exactly as today; a referee program is validated for the engine it will run on (macros allowed on both).
3. `arena_decisions` records the engine; `/arena/[id]/debug` shows it.

**Acceptance.** Gate; `npm run arena:vs -- --engine rules` plays a Sparring game to the end; costs totalled on the game row as today.
