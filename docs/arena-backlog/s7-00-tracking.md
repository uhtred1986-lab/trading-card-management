---
title: Arena Stage 7 tracking — keywords as macros over hook points
milestone: Arena M10 — Keywords as macros (Stage 7)
labels: epic, backlog, area:arena-vm, area:arena-rulesets, phase:rules-stage7
stage: 7
tracking: true
---
Stage 7 of the rules-language programme (Opus 5, size XL). The 39 keyword skills the parser knows (`KEYWORD_NAMES` in `src/lib/arena/engine/script.ts`) become **bodies in `keywords.rules`** written against a fixed contract of interpreter **hook points** (`src/lib/arena/vm/hooks.ts`), replacing the legacy engine's 27+ inline `has()` sites. One hook group per commit; `scripts/verify/keywords.ts` (958 lines) and `battles.ts` on the rules engine green after each.

**Exit criterion:** every keyword's body is written; `verify/keywords.ts` is green on both engines; the glossary's `engine` line for each keyword is true of the rules engine (and says where the two engines still differ, if anywhere); `arena:reprobe --engine rules` on the keyword families = 0 moved.

**Rule:** a keyword that needs a hook the contract lacks gets the hook added to the contract (one interpreter case, documented in `docs/arena-ruleset-spec.md`), never a special case in `vm/`. The plan's hook inventory — `chooseable`, `attrBonus`, `koByEffect`, `onEnter`, `onLeave`, `activeStep`, `block`, `counterWindow`, `playRefused`, `chargeLimit`, `altPayment`, `afterSkill`, `beforeDamage`, `onAttackDeclared`, `battleEnd` — is the starting point, to be confirmed by the inventory issue.

Child issues:

{{children}}
