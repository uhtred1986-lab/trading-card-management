---
title: Arena: copySkills primitive — 'gains that skill' and 'gains all of the chosen card's skills' (20-18)
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, ready-for-agent, enhancement, area:arena-compiler, area:arena-engine, phase:rules-stage2, model:opus-5
stage: 2
---
**Source:** plan Stage 2 gap table, row "gains that skill" / BT3-049; rule manual 20-18; `docs/arena-next-stage-spec.md` §6.11.

**Problem.** `grant` takes keyword skills only. A card that copies a *printed* skill from another card ("choose 1 skill of a Battle Card and this card gains that skill", "gains all of the chosen card's skills until end of turn") cannot be said in the language, so every such card is unread.

**Build.**
1. New op `copySkills(target, from: REF, which?: index | all, until)`: one interpreter case in `stepScript` (`src/lib/arena/engine/script.ts`) that attaches the source card's `Script`s (from `rulesFor` — never recompiled at game time) to the target as a `ContinuousEffect` with the given duration, plus one `OP_SCHEMA` row with a `sentence`. The engine's skill enumeration (`legalActions`, `pendTriggers`) must see copied skills as the target's own; a copied [Auto] answers to the *target's* moments.
2. `grant` may also take `"quoted skill text"` where a card prints in full the skill it grants. Decide whether that is `copySkills` with an inline `Script` or a `grantText` field, and record the decision in the glossary.
3. Compile patterns for the wordings `npm run arena:tally -- --show "gains that skill"` and `--show "all of the chosen card's skills"` list; `sentence` wording; glossary entry.
4. Probe family: `familyOf` in `src/lib/arena/probe.ts` stages a board with a source card whose skill is visible on the target after the copy.

**Out of scope.** Copying a skill of a card that has left play — cite 20-18 on which snapshot applies in the commit.

**Acceptance.**
- Gate + `contract:emit` reviewed (new op → `effect-language.txt` moves, expected).
- `verify/keywords.ts` or `verify/compiler.ts`: a harness card copies a [Permanent] and an [Auto]; the [Auto] fires on the target's moment; the copy expires with `until`.
- Tally and readings deltas recorded; `docs/arena-rules-language.md` gains the example.
