---
title: Arena: DBS declarations — game.rules, attributes.rules and zones.rules
issue: 133
milestone: Arena M6 — Definitions in the language (Stage 3)
labels: done, enhancement, area:arena-rulesets, phase:rules-stage3, model:opus-5
stage: 3
status: closed
closed_at: 2026-09-12
---
**Source:** plan Stage 3; rule manual `docs/rules/rulemanual.txt` (setup §5, areas §3, card information §4); `src/lib/arena/engine/types.ts` (`PlayerState`, `Area`, `CardDef`), `state.ts` (`playCost`, `specifiedCostOf`).

**Problem.** The game's shape lives in TypeScript types and in the phase switch. Stage 4's engine needs it as data, and the only honest way to find out whether the language can say a whole game is to write one.

**Build — `src/lib/arena/rulesets/dbs/`, declarations only, the legacy engine untouched.**
- `game.rules`: `DEFINE GAME dbs` — setup (deck sizes, 6-card opening hand, 8 life, the +1 marker rule, mulligan), turn order, `WIN`/lose conditions (life 0, deck out, concede), the manual section cited on each line as a `--` comment.
- `attributes.rules`: `DEFINE ATTRIBUTE` for colors, energyCost | X, specifiedCost orbs, power, comboCost, comboPower, characters, traits, type, zEnergyCost; **derived** attributes `power`, `costOf`, `comboCostOf` as expressions (the ones the engine computes with layers today — say which layer order applies).
- `zones.rules`: `DEFINE ZONE` for hand, deck, life, leader{single}, battle{inPlay, modes}, combo, energy{markers}, unison{single}, warp, zDeck, zEnergy, removed, under{host} — visibility per side, ordered or not, what "in play" means (§9-1-3 of the manual).

Write the three files so that `loadRuleset` accepts them and `verify/rulesets.ts` (its own issue) can compare them with the engine's unions. Where the language cannot say something the manual needs, **do not stretch the file**: record the gap in a history entry and open a `DEFINE` grammar follow-up.

**Out of scope.** Triggers, keywords, words, prompts (separate issues); any interpreter.

**Acceptance.**
- Gate; `npm test` loads the three files without error.
- Every `Area` in `types.ts` appears as a `ZONE`; every `CardDef` field as an `ATTRIBUTE` (asserted by the completeness issue — this one must leave nothing for it to report).
- The history entry lists what the manual says that the files could not, if anything.

---

## Built — 12 Sep 2026

The three files are in `src/lib/arena/rulesets/dbs/` and the set loads: **69 declarations**, every
one carrying its `docs/rules/rulemanual.txt` section as a `--` comment.

- `zones.rules` — 15 `ZONE`s: the manual's twelve areas (§3) plus `removed` (20-10), `under`
  (23-2) and `play` (9-1-3-1, the word for the Leader, Battle and Unison Areas together). `play` is
  declared rather than left as a pseudo-zone, because the loader refuses any program naming a zone
  nothing declares and `AREAS` carries it.
- `attributes.rules` — 19 `ATTRIBUTE`s: every `CardDef` field, the three derived costs (`costOf`,
  `comboCostOf`, `zEnergyCostOf`) with their layer order, and the player's `energyMarkers`.
- `game.rules` — one `GAME`, six `PHASE`s (the four of a turn, plus `setup` and `over`), the 26
  `STEP`s of §6-2-1 and §7, and two `WIN`s.

`scripts/verify/rulesets.ts` loads the real set instead of asserting the directory is empty, and
round-trips the whole ruleset through `printDefinitions`. `docs/arena-ruleset-spec.md` §3 has the
file table and the conventions; `docs/arena-history-lessons.md` has the entry and the six gaps.

**Two notes for #136.** The completeness check over attributes must be **one-directional** — every
`CardDef` field has a card attribute, and the four beside them (three derived costs and
`energyMarkers`) have no printed counterpart — and `mainEnd` is a `PHASE` here where the manual
makes it a step of the Main Phase (7-3-5), which is the engine's shape and not an error.
