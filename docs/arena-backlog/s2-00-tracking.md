---
title: Arena Stage 2 tracking — primitives the cards need
milestone: Arena M1 — Rules correctness and parser coverage
labels: epic, backlog, area:arena-compiler, area:arena-engine, phase:rules-stage2
stage: 2
tracking: true
---
Stage 2 of the rules-language programme (`docs/arena-history-lessons.md`, entries dated 9 Sep 2026; the approved plan is summarised in `docs/arena-backlog.md` §1). The aim of the programme is **fix each card by setting the right DSL statement**; Stage 2 makes that possible for the ~3,400 clauses the compiler cannot read today, by giving the language the *mechanisms* they need and by removing readings that are wrong.

**Exit criteria**
- Every primitive in the plan's gap table either exists (interpreter case in `stepScript`, schema row in `OP_SCHEMA`/`COND_SCHEMA`, compile pattern, glossary entry, `verify/*` assertion, `contract:emit` reviewed) or has an issue explaining why it is a macro rather than a primitive.
- `npm run arena:tally` and `npm run arena:readings` baselines recorded in the history archive before and after each increment; the stage summary names the wordings each primitive unlocked.
- No clause known to *compile and read wrongly* is left unlisted: every one found is fixed or filed here with card ids.
- `docs/arena-rules-language.md` describes every new primitive and the expression grammar (see the documentation milestone).

**Discipline for every child issue** (`docs/arena-next-session-prompt.md` §3): snapshot both measurements first, diff the gap set *and* the readings, sign off every moved reading by card, prefer unread to wrongly read, update `src/lib/arena/glossary.ts` in the same commit, and run the gate (`typecheck`, `lint`, `test`, `build`, `arena-fuzz 40`).

Child issues:

{{children}}
