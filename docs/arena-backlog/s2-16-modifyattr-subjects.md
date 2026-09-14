---
title: Arena: modifyAttr reaches a player and the battle in progress, and the attributes the cards need (spec §2.5-1, §2.5-3)
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, ready-for-agent, enhancement, area:arena-lang, area:arena-engine, area:arena-vm, area:arena-rulesets, phase:rules-stage2, model:opus-5
stage: 2
issue: 275
---
**Source:** #137 (owner's decision of 13 Sep 2026); `docs/arena-ruleset-spec.md` §2.5-1 and §2.5-3; `src/lib/arena/rulesets/dbs/ops.rules` (the rows waiting on `subject`: `energyMarker`, `switchMode`, `grant`, `hidden`, `redirectAttack`, `flip`, `faceUp`, `addMarker`, `removeMarker`, `gains`); the `modifyAttr` row in `src/lib/arena/engine/script-schema.ts`; `src/lib/arena/rulesets/dbs/attributes.rules`; `src/lib/arena/vm/effects.ts` (layers); the player-attributes issue (Stage 5, split from #146) for the player subject.

**Problem.** `modifyAttr` reaches one card and six attributes. The rows above need a *player* (`energyMarker`) and the *battle in progress* (`redirectAttack`) as subjects, and `mode`, `markers`, `keywords`, `hidden`, `faceUp` and `flipped` as attributes, each declared with its layers.

**Build.**
1. `modifyAttr`'s subject: a card `Ref` (today), `player` (a side) and `battle`; the attributes above declared in `attributes.rules` with their layer order (9-9-1), read by `vm/effects.ts` through the layers and nowhere else.
2. The legacy evaluator maps each new subject/attribute pair to the existing op's behaviour (refactor-grade: `flip` as `modifyAttr(flipped)` does what `flip` did), so nothing changes at runtime on the legacy engine.
3. Schema rows, printer, parser, round trip; `expandMacros` follows.
4. Declare the rows that wait on `subject` alone — `redirectAttack`, `flip` — and, with `$name` holes, `switchMode`, `faceUp`, `addMarker`, `removeMarker`, `hidden`, `energyMarker`, `grant`, `gains`; update the header table.

**Out of scope.** Keywords as hook bodies (Stage 7, #153–#157); the player attribute's declaration itself (the Stage 5 issue owns `DEFINE ATTRIBUTE` on a player — coordinate, do not duplicate).

**Acceptance.**
- Gate; `npm run arena:fuzz -- 40` on both engines; `npm run contract:emit` no change.
- `scripts/verify/lang.ts` round-trips every new subject and attribute; `scripts/verify/language.ts` lowering sweep for the declared rows.
- `scripts/verify/vm.ts`: `flip` and `switchMode` written as macro and as op log the same events on both engines.
- `npm run arena:readings` diff empty; `arena:reprobe` 0 moved.
