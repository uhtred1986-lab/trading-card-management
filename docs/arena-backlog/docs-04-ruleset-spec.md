---
title: Arena docs: write docs/arena-ruleset-spec.md — the interpreter contract and the definition files
milestone: Arena M14 — Rules language and ruleset documentation
labels: backlog, ready-for-agent, documentation, area:arena-docs, area:arena-vm, area:arena-rulesets, phase:rules-docs, model:opus-5
stage: docs
---
**Source:** the plan's Docs section; `CLAUDE.md` already points at `docs/arena-ruleset-spec.md` as "to come"; `engines.ts`'s header comment refers to it.

**Problem.** The document that says what the rules engine *is* does not exist, and three stages already promise to write sections into it (the primitive-or-macro table, the hook inventory, the saved-games decision).

**Build — the document's sections, each owned by the stage that fills it.**
1. What is configuration and what is interpreter, and why (decision 2 of the plan) — written now, from the plan.
2. The primitives (the Stage 2 table) and the expression language.
3. The definition files: one section per `rulesets/dbs/*.rules` file, what it declares, its manual sections.
4. The hook contract (Stage 7's inventory) with one example body per hook.
5. How to add a primitive (interpreter case + schema row + doc row + tally) and how to add a game (files + drafter + vocabulary), with Fusion World as the worked hypothetical.
6. The oracle protocol: `arena:diff`, reprobe, fuzz, what "green" means per stage; the two-engines rule until Stage 10.
7. What stays code and why: the flow runner, event log, prompt mechanics, selector evaluation, payment search, RNG, the language, the drafter.

Write 1, 5 (skeleton), 6 and 7 now so the stage issues have a place to land their sections; the rest are filled by the stages and checked here.

**Acceptance.** The document exists with the seven sections, each either written or headed with the issue that fills it; `CLAUDE.md`'s pointer no longer says "to come".
