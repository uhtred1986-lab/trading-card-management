---
title: Arena docs: the DEFINE grammar section of arena-rules-language.md
issue: 113
milestone: Arena M14 — Rules language and ruleset documentation
labels: done, documentation, area:arena-docs, area:arena-lang, phase:rules-docs, model:opus-5
stage: docs
status: closed
closed_at: 2026-09-12
---
**Source:** the Stage 3 `DEFINE` grammar issue; `docs/arena-rules-language.md` (which says in §1 that a game's definition is the second of the language's three uses).

**Build.** A §3b: the `DEFINE` productions (GAME, ATTRIBUTE, ZONE, PHASE, STEP, ACTION, TRIGGER, KEYWORD, COST, WIN, OP), one short real example each taken from `rulesets/dbs/*.rules`, the hook-body form, the macro form, and what the loader refuses. The round-trip section (§2) extended to whole files. A test that every `DEFINE_SCHEMA` row is named in the doc, as the op schema is checked against the effect-language legend.

**Acceptance.** Ships with or immediately after the Stage 3 grammar; the examples parse in `scripts/verify/lang.ts`.

---

## Built 12 Sep 2026 — §3b exists

Shipped with #131. `docs/arena-rules-language.md` §3b holds the productions, what each of the
eleven kinds is for, and one example per kind, printed by `printDefinitions` so it cannot drift;
§2 says the promise covers a whole file and that `--` comments are dropped; the intro says two of
the three uses now exist. Two tests in `scripts/verify/lang.ts` read the doc: every `DEFINE`
example parses and prints back byte-identically, and every `DEFINE_SCHEMA` kind, field label and
row description is named in §3b.

Steps 2 and 4 of the plan above are only partly done, on purpose. The examples come from the
grammar rather than from `rulesets/dbs/*.rules`, which do not exist yet — #133–#135 should replace
them with real ones. And "what the loader refuses" lists the four refusals but names the parser as
the source of the last one only; the dangling reference, the duplicate name and the unknown hook
are the loader's (#132) and the section says so.
