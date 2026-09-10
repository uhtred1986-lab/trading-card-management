---
title: Arena: implement structural side parsing fix in parseTarget
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, ready-for-agent, bug, area:arena-compiler, phase:rules-stage2, model:opus-5
stage: 2
---
**Source:** `docs/arena-side-scope.md` (the whole document); `docs/arena-next-session-prompt.md` §4(b); rule manual 20-1-6.

**Problem.** `parseTarget` (`src/lib/arena/engine/compile.ts`) decides whose cards a phrase names by testing the **whole clause** for a possessive. A clause routinely carries several — source, destination, measure, name — so any possessive anywhere sets the side of the *source* selector. Three bugs have come from this, each patched by stripping the offending phrase ("in their character names"; "their owner's Drop/Warp", printed on 113 skills; "to/into your opponent's Battle Area", which inverted the mechanic on seven cards), and the third patch needed two guards to avoid colliding with the first two. A fourth instance is untouched: **DB1-059 and EX08-06** read "an energy cost greater than or equal to your opponent's energy" as an *area to search*.

**Build.**
1. Decide the side from **the phrase that names the area**: `AREA_WORDS` already knows where it matched and what possessive precedes it. Keep the whole-clause scan **only** as the fallback for phrases that name no area ("your opponent's Battle Cards", which 20-1-6 makes the table) — that is the commonest shape in the game and must not move.
2. Remove the three strips once the structural rule makes them redundant; leave any that still guard a genuine ambiguity, with a comment saying which.
3. Fix DB1-059 / EX08-06 as the proof that the new rule reaches a case the patches did not.
4. Glossary: the reading rule for sides, in words.

**Out of scope.** The OR disjunction (#95); any change to `splitClauses`.

**Acceptance.**
- Gate + `contract:emit` reviewed.
- `npm run arena:readings` before/after; the readings diff will be **large** — prove the property *"the side moved only where the possessive the old test used belongs to a phrase other than the source"* over the whole moved set, and still hand-check BT21-092, EX25-35, DB1-059, EX08-06 and one card from each of the three earlier bug families.
- Gap-set diff: shapes entering must each be a refusal the commit explains.
- `scripts/verify/wordings.ts` assertions for the four cards named above and for the no-area fallback.
