---
title: Arena: the immunity family — 'isn't affected by your opponent's skills' (20-4)
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, ready-for-agent, enhancement, area:arena-compiler, area:arena-engine, phase:rules-stage2, model:opus-5
stage: 2
---
**Source:** plan Stage 2 gap table, rows "isn't affected by your opponent's skills" (7) and "unaffected by skills"; rule manual 20-4; the `immune` op already in `OP_SCHEMA` and the `forbid beChosen / beMovedBySkill` prohibitions.

**Problem.** The language can say "can't be chosen by skills" and "can't be moved by skills" but not full immunity: a card that is unaffected by the opponent's skills must ignore *every* effect those skills would apply — power changes, KO, mode switches, keyword grants, continuous effects — and the effect still resolves for other targets. Today those cards are unread, or read as a narrower prohibition than printed.

**Build.**
1. Measure first: `npm run arena:tally -- --show "affected by"` and `--show "unaffected"` list the real cards. Decide, and write into the glossary, which effects immunity blocks (20-4) and which it does not (costs paid by the opponent, game rules such as damage).
2. Extend the `immune` op with `from: pred` (whose skills: `opponent`, `any`, a filter on the source card) and make `stepScript`'s target application consult it at the one place effects land on a card, so a new op inherits the check automatically. Record that place in `docs/arena-ruleset-spec.md` when it exists.
3. `effects.ts` label ("unaffected by your opponent's skills") and `whyNot*` wording when a target is refused for immunity.

**Out of scope.** Immunity to *keywords* ([Critical], damage) — refuse with a note if the text says so.

**Acceptance.**
- Gate + `contract:emit` reviewed.
- `verify/keywords.ts`: an immune card is not KO'd, not powered down and not chosen by the opponent's skill, while the same skill still hits a non-immune card on the same board; the card's own side's skills still apply.
- `arena:reprobe` = 0 moved; tally and readings deltas recorded; language doc example added.
