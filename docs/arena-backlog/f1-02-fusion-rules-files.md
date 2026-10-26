---
title: "Arena F1-02: src/lib/arena/rulesets/fusion/*.rules — the dbs files cut down to Fusion World"
issue: 1185
milestone: Arena F1 — Fusion World: the four launch starter decks
labels: backlog, ready-for-agent, area:arena-rulesets, phase:fusion-world, model:sonnet-5
stage: fusion-world
priority: P2
touches: src/lib/arena/rulesets/fusion/game.rules, src/lib/arena/rulesets/fusion/zones.rules, src/lib/arena/rulesets/fusion/attributes.rules, src/lib/arena/rulesets/fusion/triggers.rules, src/lib/arena/rulesets/fusion/keywords.rules, src/lib/arena/rulesets/fusion/words.rules, src/lib/arena/rulesets/fusion/prompts.rules, src/lib/arena/rulesets/fusion/ops.rules, src/lib/arena/rulesets/fusion/actions.rules, src/lib/arena/rulesets/fusion/costs.rules, src/lib/arena/rulesets/fusion/battle.rules, scripts/verify/rulesets.ts
---
Tracking: Arena F1. Depends on F1-01 (the placeholder copy and the per-game verifier table). Plan:
`docs/arena-fusion-world-plan.md` §2. Priority P2, size L, Sonnet. Manual: the Fusion World Official
Rule Manual PDF (link in the plan), cited by page in `--` comments as the dbs files cite `rulemanual.txt`
sections.

## Why

After F1-01 the `fusion` directory is a copy of `dbs`. Fusion World is the original game with zones,
keywords and a price removed, so the work is deletion with a few rewrites — every edit must cite the
manual page it comes from, exactly as the dbs files do, because a `.rules` line is the only record of
why the engine does what it does.

## Build — file by file

Work in this order; run `npm run arena:rulesets && npx tsx scripts/verify/rulesets.ts` after each file.

1. **`game.rules`**: `DEFINE GAME fusion`, `title: "Dragon Ball Super Card Game Fusion World"`,
   `deck: 50`, `zDeck: 0`, `hand: 6`, `life: 8`, `mulligan: true`, `firstPlayerDraws: false`
   (manual p. 7: the first player draws on turn one only under the 1 Jul 2024 change the manual v1.10
   does not carry — record it in the header comment and leave `false`; the owner rules on it in F1-08).
   Remove `setupZDeck` from the setup phase's steps. Keep the six phases and the other steps; rewrite
   the End Phase comment to the manual's five steps (p. 11: your end-of-turn skills, theirs, your "for
   the turn" expiries, theirs, pass) — the step list already matches, only the citations change.
   `WIN lifeOut` and `WIN deckOut` stay (p. 6).
2. **`zones.rules`**: keep `deck`, `hand`, `drop`, `leader`, `battle`, `combo`, `energy`, `life`,
   `removed`, `under`, `play`; delete `warp`, `unison`, `zDeck`, `zEnergy`. Cite p. 5 (the seven areas).
   Any `text:` that mentions a Unison or Z area is rewritten.
3. **`attributes.rules`**: delete the Z-Energy cost attribute and the `growUnison` flag; keep energy
   markers (p. 6: the second player places one; p. 8: a marker pays a cost of the leader's colour and
   is removed from the game). Keep `comboCost` as an attribute (the column exists; it is null for every
   Fusion World card) — the price that reads it is what goes (file 10).
4. **`triggers.rules`**: delete every declaration whose event or zone names `unison`, `zEnergy`,
   `zDeck`, `warp`, or a dbs-only moment (`addedToZEnergy`, union/evolve/over-realm moments,
   `opponentEnergyActiveBySkill` and the other card-specific ones whose doc comment names a BT/SD
   card). Keep: `played`, `playedFromHand`, `attacks`, `attacked`, `koed`, `kos`, `yourCardKoed`,
   `opponentCardKoed`, `dealtDamage`, `chargeStart`, `mainStart`, `mainEnd`, `turnEnd`,
   `opponentTurnEnd`, `opponentTurnStart`, `battleEnd`, `comboed`, `comboToDrop`, `comboUsed`,
   `opponentPlayed`, `youPlayed`, `opponentAttacks`, `selfRestToActive`, and the five `counter:*`
   windows. The loader refuses a trigger whose zone is undeclared, so the verifier tells you what is
   left.
5. **`keywords.rules`**: keep exactly `Awaken`, `Blocker`, `Critical`, `Strike`, `Super Combo`,
   `Dragon Ball` (the manual's "only up to N total cards with this skill" copy-limit keyword, p. 12 —
   keep the dbs name, it is the same deck rule); delete the other 33. Each kept entry's `text:` is
   rewritten to the manual's glossary wording (p. 12) and cites it. `Awaken`'s `DO`/`AFTER` body
   stays: the four starter leaders print "[Awaken] When your life is at 4 or less, draw 1 card. Then,
   flip this card over."
6. **`words.rules`**: the board words for the remaining zones, phases, modes and colours; delete the
   Z/Unison/Warp rows; the Fusion World manual calls the modes "Active Mode" and "Rest Mode" and the
   piles "Drop", "Life", "Energy Area", "Combo Area" (p. 5).
7. **`prompts.rules`**: keep every `PROMPT_KINDS` kind (the loader needs one per kind); reword only
   the ones that mention Z-Energy or Unison.
8. **`ops.rules`**: delete macros that lower to Z/Unison/Warp zones or dbs-only keywords
   (`evolve`, `union`, `overRealm`, `zAwaken`, …); the verifier's "every macro's primitives exist"
   check tells you which are dead.
9. **`actions.rules`**: keep `charge`, `play`, `activate`, `endMain`, `pass`, `concede`; delete
   `playUnison`, `playZ`, `growUnison`. In `play`, delete the Unison/Z refusals.
10. **`costs.rules`**: keep `energy` (with specified orbs — p. 8), `marker`, `life`, `rest`, `payWith`,
    `text`; delete `zEnergy`, `burst`, `spiritBoost`. **Do not** declare a combo price: Fusion World
    combos cost nothing (p. 10). F1-03 makes `vm/battle.ts` honour the absence.
11. **`battle.rules`**: keep the steps; rewrite the `battleOffenseCombo`/`battleDefenseCombo` `text:`
    to "from the hand or an Active Mode Battle Card in the Battle Area, with no cost" (p. 10) and the
    `battleDamage` text without the Unison marker clause (p. 10: leader → life card to hand, battle
    card → KO to Drop, loser attacking → battle ends).
12. **`scripts/verify/rulesets.ts`**: edit the F1-01 per-game row for `fusion`: 11 zones, the 6
    keywords, `zDeck === 0`, and a new assertion that no `DEFINE COST` consumes `combo`.
13. Regenerate: `npm run arena:rulesets` (both `files.ts` and both `board-words.ts`).

## Out of scope

The engine honouring any of it in play (F1-03), board rendering (F1-06), card text (F1-04).

## Acceptance

- `npm run checks`, `npm test`, `npm run arena:rulesets -- --check`, `npm run arena:fuzz -- 40`
  (dbs, unchanged).
- `npx tsx scripts/verify/rulesets.ts` passes with the fusion row's new numbers; the PR body lists the
  declaration count per file before and after.
- Scenario proof: a scratch `tsx` one-liner that calls `loadFusion()` and prints
  `Object.keys(def.zones)`, `Object.keys(def.keywords)` and the `COST` names, pasted in the PR body.
- Every deleted or rewritten line's replacement cites a manual page in a `--` comment.
