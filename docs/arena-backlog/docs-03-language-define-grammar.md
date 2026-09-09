---
title: Arena docs: the DEFINE grammar section of arena-rules-language.md
milestone: Arena M14 — Rules language and ruleset documentation
labels: backlog, ready-for-agent, documentation, area:arena-docs, area:arena-lang, phase:rules-docs, model:opus-5
stage: docs
---
**Source:** the Stage 3 `DEFINE` grammar issue; `docs/arena-rules-language.md` (which says in §1 that a game's definition is the second of the language's three uses).

**Build.** A §3b: the `DEFINE` productions (GAME, ATTRIBUTE, ZONE, PHASE, STEP, ACTION, TRIGGER, KEYWORD, COST, WIN, OP), one short real example each taken from `rulesets/dbs/*.rules`, the hook-body form, the macro form, and what the loader refuses. The round-trip section (§2) extended to whole files. A test that every `DEFINE_SCHEMA` row is named in the doc, as the op schema is checked against the effect-language legend.

**Acceptance.** Ships with or immediately after the Stage 3 grammar; the examples parse in `scripts/verify/lang.ts`.
