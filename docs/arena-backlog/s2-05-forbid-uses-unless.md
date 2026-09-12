---
title: Arena: counted and conditional prohibitions — forbid with uses and unless (20-14)
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

## Review of 12 Sep 2026 — where the code stands, and the steps in order

*Written for an agent that has read `CLAUDE.md` and this issue and nothing else. Line numbers are from `main` at commit `77cf236`; grep for the symbol if they have moved.*

**Code map (verified against the tree, not the older issue text above).**
- The effect language's tables are in `src/lib/arena/engine/script-schema.ts` (split out of `script.ts` by PR #203): `OP_SCHEMA` at line 120 (45 ops), `COND_SCHEMA` at line 384 (18 conditions), and the closed word lists `SIDES`, `SPECIAL_TARGETS`, `AREAS` (15), `DURATIONS` (6), `KEYWORD_NAMES` (39) at lines 65–76. `script.ts` re-exports all of it (`export * from "./script-schema"`, line 1436), so imports from `engine/script` still work. The types stay in `script.ts`: `Selector` (72), `Amount` (129), `Ref` (144), `Cond` (147), `Op` (207), `CostRecord` (452), `ScriptFrame` (523), `stepScript` (629).
- The engine's unions are in `src/lib/arena/engine/types.ts`: `Area` line 154 (13 names), `Phase` line 249 (6), `Trigger` line 468 (**53 names** — the keyword-timing moments from #129 are in), `Prompt` line 590 (17 kinds).
- The trigger vocabulary the language validates against is **not** in the schema file: `TRIGGER_IN_WORDS` in `src/lib/arena/gaps.ts` line 78, exported as `TRIGGERS` (line 133) and imported by `src/lib/arena/lang/validate.ts`.
- The language: `src/lib/arena/lang/` — `ast.ts` (156 lines: `Rule`, `LangError`, `SELECTOR_FIELDS`, `FILTER_FIELDS`, `EXPR_SCHEMA`, `RESERVED`), `tokens.ts` (125: `lex`, `--` comments already dropped here), `parse.ts` (708: `class Parser`, `parseRule` at 688, `parseCond` at 702), `print.ts` (328: `printRule` at 322, `printOp` 272, `printCond` 204, `printSelector` 108, `printFilter` 162, `printAmount` 82, `canonical`/`deepEqual` 40–74), `validate.ts` (63), `index.ts` (the public barrel). There is **no** `DEFINE` grammar, no `Definition` AST and no `DEFINE_SCHEMA` yet.
- Consumers of the hard-coded word lists today: `lang/parse.ts` line 18, `src/components/arena/rules/OpEditor.tsx` lines 5, 227, 252, 419, and `src/lib/arena/ai/opponent.ts` lines 25 and 294–295 (inside `EFFECT_LANGUAGE`, line 275).
- Tests: `scripts/verify-arena.ts` imports twelve suites in a fixed order (`text, setup, battles, compiler, keywords, readings, wordings, workflow, contract, language, lang, probe`); a new suite is one `import "./verify/<name>"` line there. `scripts/verify/lang.ts` is the round-trip suite, `scripts/verify/language.ts` the schema/legend suite; both build on `scripts/verify/harness.ts`.
- The engine switch: `src/lib/arena/engines.ts` — `Engine` has four calls (`createGame`, `apply`, `legalActions`, `rejectedActions`); `engineFor("rules")` throws `EngineNotBuilt`; `ENGINE_INFO.rules.available` is `false`. `snapshot.ts` line 143 goes through `engineFor` for `rejectedActions` only and calls the legacy `boardView` directly at line 164; `probe.ts` line 261 and `scripts/verify/harness.ts` line 198 call the legacy `createGame` directly; `beats.ts` line 137 (`toBeats`) reads the legacy `GameState`.
- The legacy flow runner is `exec()` in `src/lib/arena/engine/engine.ts` line 222 over `state.flow`; triggers are `pendTriggers` in `engine/triggers.ts` line 287.
- **Absent from the tree**, so do not look for them: `src/lib/arena/rulesets/`, `src/lib/arena/vm/`, `docs/arena-ruleset-spec.md`, `scripts/verify/rulesets.ts`, an `npm run test:rules` script. `--engine` is read only by `scripts/arena-fuzz.mts` (line 13), `scripts/arena-playthrough.mts` (line 201) and `scripts/arena-diff.mts`.
- The compiler is a directory now (PR #201): `src/lib/arena/engine/compile/{clauses,conditions,effects,index,prices,shared,targets}.ts`; `engine/compile.ts` is a 5-line barrel. Any `compile.ts` line number in the text above is stale — grep the symbol under `compile/`.

**The gate, every commit** (unchanged): `npm run typecheck && npm run lint && npm test && npm run build`, then `npx tsx --env-file-if-exists=.env.local scripts/arena-fuzz.mts 40` (0 crashes). A change to a schema row, a harness card or what the referee is told also needs `npm run contract:emit` and a reviewed diff of `contract/fixtures/` (CRLF noise: confirm with `git diff --stat`, then `git checkout -- contract/`). Touching what the engine understands means `src/lib/arena/glossary.ts` in the same commit.

**State on 12 Sep 2026.** A draft PR exists: **#207** (`copilot/add-counted-and-conditional-prohibitions`, base `main` at `7f154d6`) adds `uses` and `unless` to `forbid`, the legality/rejection parity, compile paths and wording. `main` does not have it yet (`grep -n "uses\|unless" src/lib/arena/engine/script-schema.ts` finds only doc text). **Do not start this from scratch** — review and finish #207:
1. Check out the branch, merge `main` into it (PR #203/#204 split `script.ts` and `ArenaStage.tsx` after #207 was opened — expect conflicts in `script-schema.ts` and `rejections.ts`).
2. Run the gate and `npm run contract:emit`; the `forbid` row changes `effect-language.txt`, which is expected.
3. Verify the acceptance in `scripts/verify/workflow.ts`: with `uses: 1` the second attack is rejected with a worded reason and the first legal; with `unless`, the action turns legal when the condition holds — through `legalActions` **and** `rejectedActions` (one rejection per card per action type, `docs/arena-workflow-spec.md` §3.2; the assertion lives in `verify/workflow.ts` and `scripts/arena-playthrough.mts` and both must say the same thing).
4. `src/lib/arena/lang/` needs no change for new optional fields (parser/printer are table-driven), but add a `forbid` maximal instance with `uses` and `unless` to `scripts/verify/lang.ts` if #207 did not.
5. Glossary and `docs/arena-rules-language.md` example: confirm #207's edits survive the merge.

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

