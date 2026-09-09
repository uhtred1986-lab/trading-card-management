---
title: Arena: implement Empower up to Y player choice
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: backlog, bug, area:arena-engine, phase:capability-gap, model:opus-5
stage: ui
---
**Source:** `docs/arena-markers-stage-scope.md` §2 item 1 and §4 step B; rule manual 22-45-3; `src/lib/arena/engine/engine.ts` (the `[Empower XY]` carry near line 637 and the `empowerCarry` prompt kind near line 2826).

**Status check, 9 Sep 2026 — an `empowerCarry` prompt already exists in the engine**, so the scope document's claim that the engine "carries as many as it can (`Math.min`)" may itself be stale. Verify before building anything:

1. Does `resolvePlay` prompt the player for how many markers to carry (0…min(Y, available)), or still carry the maximum? Read both sites and one probe (`npm run arena:probe -- --card <a Unison with Empower>`).
2. If the prompt exists: confirm `view.ts` words it, `legalActions` offers every count, the AI opponent answers it without an API call (it is a decision that cannot go wrong, `opponent.ts`), the glossary's `engine` line for [Empower] no longer says `partial` for this reason, and the `markers` beat carries the chosen count. Then close with a comment listing what was verified.
3. If it does not: build the prompt inside `resolvePlay` (reachable from a flow step, so unlike `move()` this can suspend), with the same four confirmations, and a `verify/keywords.ts` assertion that a threshold skill ("if this card has 3 or more markers") sees the chosen count.

**Out of scope.** The transfer beat and animation (#109); `[Empower XY/ZY]` (#110); specified-cost (#96).

**Acceptance.** Gate + `contract:emit` reviewed; `arena:reprobe` = 0 moved except rules whose probe answers now include the choice; a closing comment or the assertion above.
