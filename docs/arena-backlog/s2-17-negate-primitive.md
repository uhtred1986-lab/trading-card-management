---
title: Arena: the negate primitive — the general form of negateSkills, negateSkillsOfKind, negateKeyword and negateOwnSkill (spec §2.2)
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, ready-for-agent, enhancement, area:arena-lang, area:arena-engine, area:arena-vm, area:arena-rulesets, phase:rules-stage2, model:opus-5
stage: 2
issue: 276
---
**Source:** #137 (owner's decision of 13 Sep 2026); `docs/arena-ruleset-spec.md` §2.2; `src/lib/arena/rulesets/dbs/ops.rules` (the rows waiting on `negate`: `negateSkills`, `negateSkillsOfKind`, `negateKeyword`, `negateOwnSkill`, and `comboFrom`'s negate half); the four rows in `src/lib/arena/engine/script-schema.ts`; the legacy `stepScript` cases in `src/lib/arena/engine/script.ts`; `src/lib/arena/vm/effects.ts` (continuous effects); `src/lib/arena/effects.ts` (the label a rule in force gets).

**Problem.** Four ops say "negate" with a different scope each, and `negate` — the one primitive they are — is not an op, so none can be declared as a macro.

**Build.**
1. `negate(target, what: skills | kind | keyword | own, kind?, keyword?, until)` as one primitive row; the legacy interpreter dispatches it to the four existing cases, the rules engine records it as a continuous effect whose `negated` reading `vm/effects.ts` answers through the layers.
2. Schema row, printer, parser, round trip; `src/lib/arena/effects.ts`'s label and duration unchanged for the four wordings.
3. Declare the four macros and `comboFrom`'s negate half in `ops.rules` (with `$name` holes); update the header table.
4. Glossary: the entry for skill negation if the engine's claim changes.

**Out of scope.** `replace` (exists), `costModifier`, `move` cause, `modifyAttr` subjects (sibling issues).

**Acceptance.**
- Gate; `npm run arena:fuzz -- 40` on both engines; `npm run contract:emit` reviewed (`effect-language.txt` gains one op, loses none).
- `scripts/verify/keywords.ts` negate scenarios unchanged; `scripts/verify/language.ts` lowering sweep for the declared rows.
- `scripts/verify/vm.ts`: `negateSkills` as macro and as op log the same events and the same `effect`/`effectEnded` beats on both engines.
- `npm run arena:readings` diff empty; `arena:reprobe` 0 moved.
