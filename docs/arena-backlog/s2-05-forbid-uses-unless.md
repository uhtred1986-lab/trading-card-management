---
title: Arena: counted and conditional prohibitions — forbid with uses and unless (20-14)
issue: 124
milestone: Arena M1 — Rules correctness and parser coverage
labels: done, enhancement, area:arena-compiler, area:arena-engine, phase:rules-stage2, model:opus-5
stage: 2
status: closed
closed_at: 2026-09-12
---
**Source:** plan Stage 2 gap table, rows BT3-104 ("can only attack **one more** time") and BT13-030 ("can't do A **unless** B"); rule manual 20-14; `docs/arena-next-stage-spec.md` §6.5.

**Problem.** `forbid` is all-or-nothing. A prohibition with a count ("can attack one more time this turn", "can't attack more than once per turn") or an escape clause ("can't be played unless you have 3 or more energy") cannot be expressed, so those cards are unread — and a partial reading would forbid everything.

**Build.**
1. Extend the `forbid` op with optional `uses: expr` (a budget the interpreter decrements each time the forbidden action happens) and `unless: cond` (evaluated at legality time — in the `whyNot*` twins as well as in `legalActions`, so the refusal sentence explains the escape).
2. `src/lib/arena/wording.ts` and `src/lib/arena/effects.ts` (the only places a rule in force becomes a sentence) learn the two new shapes: "can attack once more this turn", "can't attack unless …".
3. Compile patterns for the motivating wordings; glossary entry under prohibitions.

**Out of scope.** Prohibitions on the opponent's choices that need a prompt (replacement territory, #107).

**Acceptance.**
- Gate + `contract:emit` reviewed.
- `scripts/verify/workflow.ts`: with `uses: 1` the second attack is *rejected* with a worded reason and the first is legal; with `unless` the action turns legal when the condition holds — asserted through `legalActions` and `rejectedActions`, one rejection per card per action type (workflow spec §3.2).
- Tally and readings deltas recorded; language doc example added.

---

## Done on 12 Sep 2026 — what finishing #207 actually took

`main` merged into the branch cleanly: PR #203's `script.ts` split and #204's `ArenaStage.tsx`
split touched none of the same lines, so the conflicts the review expected in `script-schema.ts`
and `rejections.ts` did not happen. Steps 4 and 5 were already satisfied — `lang/` needed no
change (the round-trip loop builds a maximal `forbid` straight off `OP_SCHEMA`, so `uses` and
`unless` were covered the moment the schema rows landed), the glossary entry and the
`docs/arena-rules-language.md` example both survived, and the doc example is checked by
`scripts/verify/lang.ts` like every other one.

Four things the review did not know about, found by finishing it:

1. **The escape clause was being read from the wrong chair.** `unless` is a clause of the card
   that printed it, so "you" and "your opponent" in it belong to that card's controller — but it
   was evaluated with the *acting* player as the frame's master, which inverts every such card.
   The prohibition now records its `master` (`Prohibition.master`, stamped in `stepScript`,
   `collectStatics` and `ownProhibitions`) and the condition is asked in that frame. Said back to
   the player being refused, the clause is mirrored — the one place the engine flips "you" and
   "your opponent" rather than printing them as the script wrote them.
2. **The acceptance now runs both ways round.** `scripts/verify/workflow.ts` asserts the counted
   case through `legalActions` *and* `rejectedActions` (offered while the budget stands, off the
   menu and refused once spent, with the refusal as a sentence through `wording.refusal`), and the
   conditional case the same way, on a board where reading the escape from the wrong chair would
   let the play through.
3. **Coverage falls, and that is the change.** `arena:tally` over the live catalog: fully compiled
   4705 → 4690 (72.5 % → 72.2 %), skills 87.1 % → 86.9 %, `forbid` ops 651 → 618, unread clauses
   3383 → 3418 over 2361 → 2391 shapes. Every one of the 20 lost readings is "…unless they pay X
   **each time**" (BT10-063, BT11-053, BT13-082, BT13-140 …) — the replacement territory this
   issue puts out of scope, which used to compile as an *unconditional* ban, a stricter rule than
   the card prints. An escape the compiler cannot read now takes the whole prohibition with it.
   The gains are the escapes that are plain state conditions ("unless your Leader Card is a
   <Dark Broly> card", 4 cards; "unless there is a Z-Card in your Battle Area", 3) and the counted
   `once more` forbids.
4. **`arena:tally` and `arena:readings` did not run at all**, on `main` or on the branch: the
   barrel splits of #201 and #203 left `compileSkill` and `describeScript` as `export *` names,
   which an import cycle leaves uninstantiated, and both scripts died on "does not provide an
   export named …". Each barrel now also re-exports its entry points by name. Without this the
   tally and readings deltas above could not have been taken.

**Left for later, not smuggled in here.** BT6-015 ("unless your Leader Card is a ≪Saiyan≫ card
**and it is red and no other color**") now reads the escape as any ≪Saiyan≫ leader: `splitClauses`
breaks the tail at the "and" before the prohibition is compiled, so the colour half arrives as its
own clause and is reported unread — the card is flagged, not silently wrong, but the rule it plays
is looser than the card prints where it used to be stricter. A compound escape that survives
splitting reads as `any`/`all` correctly (checked), so this is `splitClauses` meeting `unless`,
not the `unless` reading itself.

