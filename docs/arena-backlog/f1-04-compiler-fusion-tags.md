---
title: "Arena F1-04: compiler — Fusion World timing tags, the trailing-colon activation price, and the glossary"
issue: 1187
milestone: Arena F1 — Fusion World: the four launch starter decks
labels: backlog, ready-for-agent, area:arena-compiler, phase:fusion-world, model:sonnet-5
stage: fusion-world
priority: P2
touches: src/lib/arena/text/cards.ts, src/lib/arena/compile/prices.ts, src/lib/arena/glossary.ts, scripts/verify/arena-fusion-world.mts, docs/arena-rules-language.md
---
Tracking: Arena F1. Independent of F1-02/F1-03 (pure text → record). Plan:
`docs/arena-fusion-world-plan.md` §2. Priority P2, size M, Sonnet. Card text:
`docs/arena-fusion-world-starters.md` (64 cards, tally at the end).

## Why

Measured 26 Oct 2026 with `parseSkills` + `compileSkill`: Fusion World's bracket tags are the one real
compiler gap. `kindOf` in `src/lib/arena/text/cards.ts` knows `activate:main`, `activate:battle`,
`auto`, `permanent`, `counter:*`; anything else falls through to `[Permanent]`. So
`[When Attacking] Draw 1 card.` compiles as a permanent with one op (never fires), `[On Play] KO …` as
a permanent, `[Your Turn] This card gets +5000 power.` as an unconditional permanent. The sentences
themselves already read: spelled the dbs way (`[Auto] When this card attacks, draw 1 card.`,
`[Activate: Main][Once per turn] …`) every one of the 64 cards' effects compiles with no unread text.

Tags by card count in the starters: `[On Play]` 17, `[When Attacking]` 11, `[Permanent]` 7,
`[Activate:Main]` 7, `[Critical]` 6, `[Blocker]` 6, `[Activate:Battle]` 5, `[Once Per Turn]` 5,
`[Opponent's Turn]` 5, `[Auto]` 4, `[Super Combo]` 4, `[Awaken]` 4, `[Double Strike]` 3,
`[Your Turn]` 3, `[When KO'd]` 2, `[End of Your Turn]` 1.

## Build

1. **`text/cards.ts`, the tag table.** Teach `kindOf`/`splitTags` (and the trigger reader
   `triggerOf`/the head-rule in the same file) these spellings, as *aliases* of what the dbs parser
   already produces — a Fusion World card must compile to the same `SkillKind`/`Trigger` a dbs card
   with the same meaning compiles to:
   - `[On Play]` → kind `auto`, trigger `played` (the manual p. 12: "activates when a card with this
     skill is played into a Battle Area"; the Fusion World FAQ treats a play by a skill the same, so
     `played`, not `playedFromHand`).
   - `[When Attacking]` → `auto` / `attacks`.
   - `[When KO'd]` → `auto` / `koed`.
   - `[End of Your Turn]` → `auto` / `turnEnd`.
   - `[Activate:Main]`, `[Activate:Battle]` (no space) → the existing kinds; `kindOf` already
     normalises `\s*:\s*`, so verify rather than add.
   - `[Once Per Turn]` (capital P) → the `oncePerTurn` usage flag (`lower.includes("once per turn")`
     already lowercases — verify).
   - `[Your Turn]` / `[Opponent's Turn]` as a tag beside `[Permanent]` → the permanent's condition
     "during your turn" / "during your opponent's turn" (the dbs compiler has that condition for the
     printed phrase; emit the same `Cond`). Beside `[Auto]` (the four `[Super Combo]` cards:
     `[Auto][Opponent's Turn] When you use this card in a combo from your hand, this card gets +10000
     combo power`) → the trigger's turn condition (`comboUsed` with the opponent's-turn cond).
   - `[Double Strike]` → `Strike x: 2` (already reads; keep a test).
2. **`compile/prices.ts`, the trailing colon.** Fusion World prints an activation price as a clause
   closed by " : " — `[Activate:Main][Once Per Turn] Place 1 of your energy in your Drop : switch up
   to 2 of your Battle Cards to Active Mode` (FS04-01 back), `Discard 1 card from your hand :` (FS02-16).
   The dbs price reader expects `{g}:`/`[-1]:`-style prices; read "<clause> :" before the first
   effect sentence as the price, using the existing `payWith`/`text` price records (`costs.rules`
   `DEFINE COST text` is the unreadable-price fallback; a discard or an energy-to-Drop is readable
   today for dbs when printed as a cost — reuse that path).
3. **`glossary.ts`**: a `fusionSpellings` (or equivalent) section listing every tag alias above with
   the dbs form it reads as, and the price spelling. `npm test` already checks every glossary `tag` is a
   spelling `keywordOf` reads back; extend the same check to the new aliases. **Same commit as the
   parser change** (`CLAUDE.md` hard rule).
4. **`docs/arena-rules-language.md`**: one short subsection "Fusion World spellings" pointing at the
   glossary.
5. **Tests**: in `scripts/verify/arena-fusion-world.mts` (create it if F1-03 has not), compile every
   skill line of the 64 cards from `docs/arena-fusion-world-starters.md` (parse the `FSxx-yy | … | text`
   lines; leaders' `FRONT:`/`BACK:`), and assert: no skill's `unread` is non-empty, no `[On Play]`,
   `[When Attacking]`, `[When KO'd]` or `[End of Your Turn]` line compiles to kind `permanent`, the
   kind/trigger of each tag is the one in the table above, and the two colon-priced skills carry a
   price record. Print the per-card result table in the PR body.

## Out of scope

Energy-icon activation prices (⟨⟨N⟩⟩; no starter prints one), [Barrier], [Counter], [Rush], and any
change to how dbs text reads — `npm run arena:tally` / `npm run arena:readings` on the dbs catalog must
show no diff.

## Acceptance

- `npm run checks`, `npm test`, `npm run arena:tally` and `npm run arena:readings` diffs reviewed
  (expected: none for dbs cards; the PR body says so).
- The 64-card compile table in `npm test`, all rows reading, none `permanent` for a timed tag.
- Glossary entries rendered at `/arena/rules/reference#keywords` (screenshot in the PR via
  `npm run shots:compare -- /arena/rules/reference`).
