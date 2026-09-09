---
title: Arena Stage 3 tracking — definitions in the language
milestone: Arena M6 — Definitions in the language (Stage 3)
labels: epic, backlog, area:arena-lang, area:arena-rulesets, phase:rules-stage3
stage: 3
tracking: true
---
Stage 3 of the rules-language programme (plan summary in `docs/arena-backlog.md` §1; recommended model Opus 5, size M). The rules language stops being only a card's rule and becomes the way a **game** is written: a `DEFINE …` grammar, a loader that turns `src/lib/arena/rulesets/dbs/*.rules` into a `GameDefinition`, and the Dragon Ball Super game written as **declarations** — zones, attributes, phases, triggers, keywords, words — with the old engine untouched. Stage 4 interprets these files; Stage 3 only proves they can be written and are complete.

**Exit criteria**
- `parse(print(x))` holds for every `DEFINE` form, in `scripts/verify/lang.ts`.
- `scripts/verify/rulesets.ts` proves the DBS files declare every `Area`, `Trigger`, keyword and `Phase` the legacy engine's unions know, and nothing the engine does not.
- The `Vocabulary` built from the definition is what the language, the workbench editor and the referee prompt use — no second hard-coded list.
- Every non-primitive op is written as a `DEFINE OP` macro (decided in Stage 2's primitive-or-macro issue).
- `docs/arena-rules-language.md` §3 carries the `DEFINE` grammar; `docs/arena-ruleset-spec.md` exists and describes the definition files.

Child issues:

{{children}}
