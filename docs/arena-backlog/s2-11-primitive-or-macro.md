---
title: Arena: decide primitive or macro for every op — modifyAttr under power, comboPower and gains
issue: 130
milestone: Arena M1 — Rules correctness and parser coverage
labels: done, enhancement, area:arena-lang, area:arena-engine, phase:rules-stage2, model:opus-5
stage: 2
status: closed
closed_at: 2026-09-12
---
**Source:** plan Stage 2 rule: *a primitive "says something no combination of others can"; otherwise it is re-declared as a macro in Stage 3*; the plan's `modifyAttr(target, attr, delta|value, until, scope?)` and `costModifier` rows; `OP_SCHEMA` in `src/lib/arena/engine/script.ts` (44 op kinds today).

**Problem.** Stage 3 will write the DBS game as configuration, and Stage 4's engine will interpret *primitives*. Today's 44 ops are DBS-shaped: `power`, `comboPower` and `gains` are three spellings of "change an attribute", `costReduction`/`altCost` two of "change a cost". Without a written decision per op, Stage 3 cannot write `DEFINE OP` macros and Stage 4 will re-implement every DBS op by hand — the outcome the owner rejected.

**Build.**
1. A table in `docs/arena-ruleset-spec.md` (create the section if the doc does not exist yet): every op and condition kind → *primitive* or *macro over …*, with the reason. Expect roughly: `modifyAttr` (power, comboPower, gains, "in all areas"), `costModifier` (costReduction, skill and evolve costs — see #96, #97), `move` (moveTo, ko, play, mill, discard, draw …), `choose`, `prompt`, `effect(layer)`, `forbid`, `immune`, `replace`, `control`, `skip`, `copySkills`, `token`, `marker`, flow ops (`if`, `chooseMode`, `may`, `delay`).
2. Introduce `modifyAttr` in `stepScript` and `OP_SCHEMA`, with `power`/`comboPower`/`gains` **kept as parseable spellings** that lower to it (the printer keeps printing the short forms until Stage 3 decides — the round-trip promise must hold either way, so `scripts/verify/lang.ts` is extended).
3. No card's reading may move: `npm run arena:readings` diff empty, `arena:reprobe` = 0 moved.

**Out of scope.** Writing the macros in the `DEFINE` grammar (Stage 3); removing any op spelling.

**Acceptance.**
- The table exists and names every row of `OP_SCHEMA` and `COND_SCHEMA`; `npm test` fails if a schema row is added without a table entry (a small check in `scripts/verify/language.ts` reading the doc, or a typed list beside the schema).
- Gate + `contract:emit` reviewed; readings diff empty; reprobe 0 moved.

---

## What the table decided — 12 Sep 2026, while doing the work

Written into `docs/arena-ruleset-spec.md` §2; kept here so the issue records what the classification
found rather than only that it happened.

- **Nineteen primitives carry all sixty-four rows** — fourteen operations (`move`, `modifyAttr`,
  `choose`, `reveal`, `shuffle`, `token`, `play`, `forbid`, `permit`, `immune`, `if`, `chooseMode`,
  `delay`, `note`) and five conditions (`count`, `did`, `not`, `any`, `isTurnPlayer`). Four of the
  primitives the macros lower to are the *general form* of a row that exists — `move` is `moveTo`,
  `negate` is `negateSkills`, `costModifier` is `costReduction`, `replace` is `replaceLeave` (#125).
- **Three departures from the plan's sketch**, each argued in §2.2–§2.3 rather than assumed:
  `marker` is not a primitive (a marker count is a number on a card, so `addMarker`/`removeMarker`
  are `modifyAttr`); `permit` is kept as one (its vocabulary is disjoint from `forbid`'s, though
  merging the two into a `permission` primitive would be a rename, not a mechanism); and
  `costModifier` is *not* folded into `modifyAttr` even though a cost is an attribute, because a
  price is orbs, a life payment or a whole program (`altCost`) and the specified cost never touches
  a total at all (BT19-039, 9 Sep 2026).
- **`play` is provisional.** It is a primitive only until Stage 3 declares the play action (#133,
  §3): which zone the card ends in, whether its text resolves and which moments fire are that
  action's steps, and no destination says them.
- **Five requirements fall out** (§2.5), none of them built here: `modifyAttr` must reach a player
  (`energyMarker`) and the battle in progress (`redirectAttack`) as well as a card; `move` must
  carry a cause, or `damage` and `lifeDownTo` become the same op; filters must name `flipped`,
  `markers`, "battled this turn" and the battle's roles, which is what five condition rows lower to;
  a price is structured, not scalar; and amounts must grow into expressions (#122) before
  `lifeDownTo`, `lifeVsOpponent` and `every` can be written as macros.
- **The row list in the steps above is one short**: `COND_SCHEMA` has a `not` row, which the
  issue's prose ran together with `did` and `chose`. Eighteen conditions, all classified.
