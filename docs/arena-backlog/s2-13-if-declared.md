---
title: Arena: the "if declared" timing window as a [Counter] condition, distinct from the counter moment itself (20-15)
milestone: Arena M1 — Rules correctness and parser coverage
labels: done, enhancement, area:arena-compiler, area:arena-engine, phase:rules-stage2, model:sonnet-5
stage: 2
status: closed
closed_at: 2026-09-13
---
**Item type:** Feature

**Source references:** `docs/rules/rulemanual.txt` §20-15 "If Declared"; found while writing §4b of `docs/arena-rules-language.md` for issue #112.

**Problem statement.** 20-15-1: "If a [Counter] skill or other skill includes the text 'if declared,' then this means the period of time from when an action is declared until the action is taken or having information indicating that something has that status." A `counter:*` WHEN already answers *during* the declared-but-not-yet-resolved window (that is what makes it a [Counter] rather than an [Auto]), so the moment itself is not the gap — but a card can say a *later* skill only applies "if [some other action] is declared", i.e. read whether a different action is currently in that pending window, as a condition rather than as its own trigger. No `Cond` in `COND_SCHEMA` (`src/lib/arena/engine/script-schema.ts`) reads "is an action currently declared-but-not-resolved". No card in the current catalog was found printing this exact fixed phrase in the corpus fetched for issue #112 (`npm run arena:tally -- --show "if declared"` returned nothing at the time of writing) — re-run that query first, since the catalog changes; if a real card still cannot be found, this stays a manual-only rule with no observable gap and the issue should be re-scoped or closed as not-yet-needed.

**Expected behavior/outcome.** A `declared(what: ...)` (or similarly named) condition/hook that is true while a named action is in its "declared, not yet resolved" window, readable from a skill other than the [Counter] answering it directly.

**Scope boundaries.**
In scope:
- Confirming with a fresh `arena:tally --show "if declared"` (and nearby wordings — "while … is declared", "in response to") whether any real card needs this before building anything.
- If a real card is found: the condition/hook, its compile pattern, and a glossary entry citing 20-15.
Out of scope:
- Re-deriving how `counter:*` WHEN clauses already work (9-7) — this issue is only about reading the window as a *condition* elsewhere.

**Acceptance checks.**
- `npm run typecheck && npm run lint && npm test && npm run build`.
- If built: `scripts/verify/lang.ts` round-trips the new condition; `verify/compiler.ts` has a scenario from a real or harness card.
- `docs/arena-rules-language.md` §4b gains a real worked example in place of the "unreadable" placeholder this issue closes, or the issue is closed not-planned if no real card ever needs it.

**Required triage metadata.**
Area labels: area:arena-compiler, area:arena-engine
Phase labels: phase:rules-stage2
Milestone: Arena M1 — Rules correctness and parser coverage

**Ready for agent pickup:** this issue is specific enough for a future agent to implement without extra clarification.

---

## Review of 13 Sep 2026 — re-measured, no card found, recommend closing not-planned

**What was checked.** A fresh `npm run arena:tally -- --show "if declared"` against the live catalog (6,493 cards, same run that reports 72.6 % fully compiled) returns `cards printing "if declared" (0)`. The issue's own escape hatch — "re-run that query first, since the catalog changes" — was exercised and the result has not changed since #112. The nearby wordings the issue itself names were checked too:
- `--show "in response to"` → `cards printing "in response to" (0)`.
- `--show "while"` → 7 cards, none in the 20-15 sense: `BT12-082`'s "[Permanent] While in a Battle Area, …" and `BT19-141`'s "can only attack while you have 3 or more energy" are both ordinary standing conditions on the card's own state, not a read of another action's pending-declared window.
- `--show "declared"` → 12 cards, all "Declare 1 number" (a value chosen as part of a cost/effect and referred back to later, e.g. `BT22-104`/`BT24-105`/`P-535`) — a different, already-partly-read mechanic, and not the 20-15 "action is declared but not yet resolved" timing window at all.

**Conclusion.** No card in the current catalog prints "if declared" (20-15) as a condition read by a skill other than the [Counter] it answers. The gap is real as a manual-only rule (20-15-1's text exists and is unambiguous) but has no observable effect on any card the engine plays or will play, so there is nothing to build a scenario against — `verify/compiler.ts` and `scripts/verify/lang.ts` have no real card to round-trip, and adding a `declared(...)` `Cond` with no card exercising it would be exactly the "un-derived future requirement" this codebase's conventions ask agents to avoid. No compiler, schema, or glossary change was made in this pass.

**Recommendation.** Close this issue **not-planned** per its own scope note, rather than leaving it open indefinitely waiting for a card that may never print. `docs/arena-rules-language.md` §20-15 has been updated to record this measurement in place of the open "unreadable" placeholder, so a future `arena:tally` run that *does* turn up a real card has a clear, current baseline to diff against and can reopen this item (or file a fresh one) with that card cited. If the owner would rather keep this open as a standing watch, downgrade acceptance to "re-check on every `sync:catalog`" instead of "build now."
