---
title: Arena: skip as a standing rule, a whole turn and a span of phases — BT18-001, BT18-019, BT31-097, BT21-104 (20-13)
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, ready-for-agent, enhancement, area:arena-compiler, area:arena-engine, phase:rules-stage2, model:opus-5
stage: 2
issue: 278
status: closed
closed_at: 2026-09-14
---
**Source:** #126 (owner's decision of 13 Sep 2026: "close as delivered, open follow-up"); the `skip(what, side, when)` op in `src/lib/arena/engine/script-schema.ts` and `PlayerState.skips` consumed by `exec()` in `src/lib/arena/engine/engine.ts`; the `skipped` flag on the `phase`/`battleStep` beats (`src/lib/arena/beats.ts`, Kotlin contract); `permanents` and the statics readers in `src/lib/arena/vm/effects.ts` and `src/lib/arena/effects.ts`; `npm run arena:tally -- --show "skip"`; the glossary's skip entry; rule manual 20-13.

**Problem.** The one-shot phase flag from #126 compiles no card: all four that print the word need more. BT18-001 and BT18-019 print the step skip as a [Permanent] conditioned on a battle in progress — a standing rule read at the step, not a flag set once. BT31-097 skips a whole *turn*. BT21-104 skips a *span* of phases.

**Build.**
1. The [Permanent] form: a standing `skip` read at the step when its condition holds ("while this card is in a battle"), a static both engines' statics readers answer, not a flag.
2. `what: turn` (BT31-097): every phase of the next turn skipped, the `phase` beats saying so, the turn still counting for turn-number bookkeeping (20-13; record a ruling with `npm run arena:rule` if the manual leaves it open, and say so in the PR).
3. A span (BT21-104): `from`/`to` phases on `skip`, or `what: span` — pick the one the printer round-trips with the fewer rows.
4. Compile the four wordings; `narration.ts` ("skips the Charge Phase", "skips their next turn"); glossary; `wording.ts` if a refusal names it.

**Out of scope.** Control (20-9, delivered); "if declared" (20-15).

**Acceptance.**
- Gate; `npm run arena:fuzz -- 40` 0 crashes; `npm run contract:emit` and `android:test` only if a beat changes.
- `scripts/verify/keywords.ts`: each of the four forms on a synthetic card — a skipped turn produces no charge and no Main Phase prompt and the beats say `skipped`; the [Permanent] form skips the step only while the battle is in progress.
- `npm run arena:probe -- --card` for each of the four reports the rule applied; `npm run arena:readings` diff is those four cards; `arena:reprobe` 0 moved.
