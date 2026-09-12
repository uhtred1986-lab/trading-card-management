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

---

## Review of 12 Sep 2026

**State.** Seven of sixteen children are closed with their work in the tree (#94, #95, #97, #120, #121, #129; #93 and #96 are *not* — see below). #124 is in draft PR #207 and should be finished from that branch, not restarted. The remaining primitives (#122, #123, #125–#128) are independent of each other; **#130 (primitive or macro) gates Stage 3's #137 and Stage 4's #142 and should go first.** #93 and #96 were auto-closed on 10 Sep by the merge of PR #182 (which delivered only #100) and were reopened today.

**Code facts every child now carries in its own "Review of 12 Sep 2026" section:** `OP_SCHEMA`/`COND_SCHEMA` moved to `src/lib/arena/engine/script-schema.ts` (PR #203); the compiler is the directory `src/lib/arena/engine/compile/` (PR #201); the `Trigger` union has 53 names; the trigger vocabulary `validateRule` reads is `TRIGGERS` in `src/lib/arena/gaps.ts`. The older text in each issue that cites `compile.ts` or `script.ts` line numbers is stale — the review section says where the symbols are now.
