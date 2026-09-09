---
title: Arena: implement specified-cost reducer mechanics
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, ready-for-agent, enhancement, area:arena-engine, area:arena-compiler, phase:rules-stage2, model:opus-5
stage: 2
---
**Source:** `docs/arena-markers-stage-scope.md` §2 (item 3) and §4 (step A); `docs/arena-next-session-prompt.md` §4(c); the comment above `specifiedOps` in `src/lib/arena/engine/state.ts` (~line 1775); the owner's ruling of 9 Sep 2026 recorded with `npm run arena:rule -- --list`.

**Problem.** The reducer is wired but inert. Per the owner's ruling, "reduce the specified cost of this card in your hand by {u}" relaxes only the **colour requirement** (2 blue down to 1 blue); the total stays X and the player chooses it, and markers follow what was actually paid. The `costReduction … what: "specified"` op and the `playCost` branch exist, but `playCost` gives every X-cost card an **empty specified-cost baseline**, because nothing in the catalog feed says a Unison's "2 blue" is 2 rather than 1 or 3 — so six to eight cards (BT19-039, BT19-040, BT15-063, BT20-118 and four more) read correctly and change nothing on the board.

**Build.**
1. Establish the baseline: derive an X-cost card's specified requirement from its printed cost orbs (`specifiedCostOf` / `cards.ts`), and verify against the catalog that every Unison and X-cost card carries the orbs the rule needs; where the feed is silent, refuse rather than guess and list the cards.
2. `playCost` subtracts the reduction from the coloured requirement alone — the shape the [Warrior of Universe 7] branch already has (`state.ts` ~1603) — never from the total.
3. Markers on arrival follow the amount paid (22-45 for Unisons); add the assertion.
4. Glossary entry for `costReduction what: specified`; `wording.ts` price sentence shows the relaxed requirement.

**Out of scope.** Skill-cost reduction (#97); X as a bound expression (see the X/expressions issue — this issue may land first with a fixed baseline).

**Acceptance.**
- Gate + `contract:emit` reviewed.
- `scripts/verify/keywords.ts`: a Unison "2 blue, X" with one {u} reduction is playable with 1 blue among X energy and arrives with X markers; without the reduction it is refused with a worded reason.
- `npm run arena:probe -- --card BT19-039` reports the play as legal on a board with one blue energy; readings diff empty (this is engine work).
