---
title: Arena: DBS declarations — game.rules, attributes.rules and zones.rules
milestone: Arena M6 — Definitions in the language (Stage 3)
labels: backlog, ready-for-agent, enhancement, area:arena-rulesets, phase:rules-stage3, model:opus-5
stage: 3
---
**Source:** plan Stage 3; rule manual `docs/rules/rulemanual.txt` (setup §5, areas §3, card information §4); `src/lib/arena/engine/types.ts` (`PlayerState`, `Area`, `CardDef`), `state.ts` (`playCost`, `specifiedCostOf`).

**Problem.** The game's shape lives in TypeScript types and in the phase switch. Stage 4's engine needs it as data, and the only honest way to find out whether the language can say a whole game is to write one.

**Build — `src/lib/arena/rulesets/dbs/`, declarations only, the legacy engine untouched.**
- `game.rules`: `DEFINE GAME dbs` — setup (deck sizes, 6-card opening hand, 8 life, the +1 marker rule, mulligan), turn order, `WIN`/lose conditions (life 0, deck out, concede), the manual section cited on each line as a `--` comment.
- `attributes.rules`: `DEFINE ATTRIBUTE` for colors, energyCost | X, specifiedCost orbs, power, comboCost, comboPower, characters, traits, type, zEnergyCost; **derived** attributes `power`, `costOf`, `comboCostOf` as expressions (the ones the engine computes with layers today — say which layer order applies).
- `zones.rules`: `DEFINE ZONE` for hand, deck, life, leader{single}, battle{inPlay, modes}, combo, energy{markers}, unison{single}, warp, zDeck, zEnergy, removed, under{host} — visibility per side, ordered or not, what "in play" means (§9-1-3 of the manual).

Write the three files so that `loadRuleset` accepts them and `verify/rulesets.ts` (its own issue) can compare them with the engine's unions. Where the language cannot say something the manual needs, **do not stretch the file**: record the gap in the worklist entry and open a `DEFINE` grammar follow-up.

**Out of scope.** Triggers, keywords, words, prompts (separate issues); any interpreter.

**Acceptance.**
- Gate; `npm test` loads the three files without error.
- Every `Area` in `types.ts` appears as a `ZONE`; every `CardDef` field as an `ATTRIBUTE` (asserted by the completeness issue — this one must leave nothing for it to report).
- The worklist entry lists what the manual says that the files could not, if anything.
