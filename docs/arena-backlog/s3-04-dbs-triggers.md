---
title: Arena: DBS declarations — triggers.rules as event patterns
milestone: Arena M6 — Definitions in the language (Stage 3)
labels: backlog, ready-for-agent, enhancement, area:arena-rulesets, phase:rules-stage3, model:opus-5
stage: 3
---
**Source:** plan Stage 3; the `Trigger` union in `src/lib/arena/engine/types.ts` (~41 names) and `pendTriggers`/`skillAnswersTo` in `engine/triggers.ts`; rule manual 9-6 ([Auto] timing) and 9-6-9 (area-movement triggers); `docs/arena-rules-language.md` §7.

**Problem.** A trigger is a name today, matched by TypeScript against the event log. The rules engine will match **event patterns**: "played" is *a card moves from a non-in-play area to battle or unison* (9-6-9-4), "attacks" is *an attack event whose attacker is the subject*. Writing the 41 names as patterns is what lets a new game declare its own moments without code — and what shows whether the engine's current moments are the manual's.

**Build.**
1. `src/lib/arena/rulesets/dbs/triggers.rules`: one `DEFINE TRIGGER name ON <event pattern> [WHERE cond] BIND subject` per `Trigger` name, with the manual section as a comment. The counter windows (attack declared, blocker declared, skill activated — 9-8) are declared here too, as the moments a `[Counter:…]` answers to.
2. Where a legacy trigger name turns out to bundle two moments, or two names one moment, record it in the worklist and in `docs/arena-ruleset-spec.md`; do not change the legacy engine.
3. Keyword-timing triggers from the Stage 2 issue (Evolve used, Union activated …) are declared alongside so the record's WHEN vocabulary is the same list on both engines.

**Out of scope.** Firing anything (Stage 4's event-pattern matcher).

**Acceptance.**
- Gate; the file loads; `verify/rulesets.ts` finds every `Trigger` name declared.
- `validateRule`'s trigger list is the same set as the file's names (a test that diffs them, so the record's WHEN cannot name a moment the definition lacks).
