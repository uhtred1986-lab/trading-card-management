---
title: Arena: keyword-timing triggers as data — 'when using this card's [Evolve]', free [Counter] from hand (22-5, 22-10)
milestone: Arena M1 — Rules correctness and parser coverage
labels: done, enhancement, area:arena-compiler, area:arena-engine, phase:rules-stage2, model:opus-5
stage: 2
status: closed
closed_at: 2026-09-10
---
**Source:** plan Stage 2 gap table, last row: keyword-timing triggers (7 clauses) and free [Counter] from hand (7); rule manual 22-5, 22-10; `src/lib/arena/engine/triggers.ts` (`skillAnswersTo`); `docs/arena-rules-language.md` §7.

**Problem.** Since Stage 1 an [Auto]'s moment is read off `card_rules.trigger`, but a keyword's own moments are hard-coded per keyword in the engine. Cards whose trigger *is* a keyword's timing — "when using this card's [Evolve] from your hand", "when this card's [Union-Absorb] is activated" — and [Counter] skills usable from hand at no energy cost have no trigger name to be given, so the record cannot express them and the text view cannot fix them.

**Build.**
1. Add `Trigger` names for the keyword timings the catalog uses (`npm run arena:tally -- --show "when using this card's"`), fired by the engine at the point each keyword resolves; `skillAnswersTo` treats them like any other trigger, so the WHEN chip and the text view can carry them.
2. Free [Counter] from hand: a `COST` item or a WHEN qualifier (`fromHand`) — decide which by the round-trip promise (one printed form) and record it in the language doc; `legalActions` offers the counter from hand in the counter window with no energy charged.
3. Compile patterns; glossary entries under the keywords involved; `describeSelector`/`wording.ts` for the price sentence.

**Out of scope.** Turning *all* keyword moments into data (that is Stage 7's hook contract in the rules engine).

**Acceptance.**
- Gate + `contract:emit` reviewed (`Trigger` union grows → `effect-language.txt` may move).
- `verify/keywords.ts`: a harness card with an [Evolve]-timing [Auto] fires only when the [Evolve] is used from hand; a free [Counter] from hand is offered and charges nothing.
- `validateRule` accepts the new trigger names; `scripts/verify/lang.ts` round-trips them.
- Tally and readings deltas recorded; language doc §3 WHEN vocabulary updated.
