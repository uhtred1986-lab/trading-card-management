# Fusion World in the arena — plan for the four launch starter decks (Arena F1)

Written 26 Oct 2026 from the code on `main`, the Fusion World Official Rule Manual
(Bandai, `https://www.dbs-cardgame.com/fw/pdf/rules/manual/fw_manual_EN.pdf`, 12 pages, no section
numbers — cite by page) and the printed text of the 64 starter cards
(`docs/arena-fusion-world-starters.md`). Issues: milestone **Arena F1 — Fusion World: the four launch
starter decks**, files `docs/arena-backlog/f1-*.md`, tracking issue `f1-00-tracking.md`.

## 1. Scope

The arena plays the four Fusion World launch starters — FS01 Son Goku (red), FS02 Vegeta (blue),
FS03 Broly (green), FS04 Frieza (yellow) — against each other, hot-seat and against the local policy,
by the Fusion World rule manual, on the existing rules engine. Nothing else: no FB booster sets, no
[Barrier]/[Counter]/[Rush] (none of the 64 cards prints them), no offline pack, no Fusion World
tutorial, no Fusion World evaluation harness for the policy.

The owner's decision of 4 Sep 2026 ("the arena is `dbs`-only") was a scope choice, recorded as such
in `docs/arena-ruleset-spec.md` §5 ("Fusion World as the worked hypothetical"). This plan is that
hypothetical made real; the decision to run it is the owner's, taken by opening the milestone.

## 2. What Fusion World is, next to what the engine plays

From the manual, Fusion World is the original game with things removed. Same: one leader and a
50–60 card deck; 6-card opening hand with one mulligan; 8 life cards face down; the second player's
energy marker; one card from hand to the Energy Area per Charge Phase, face up; costs paid by resting
energy, with the specified colour orbs among the rested cards or a marker of the leader's colour
removed from the game; attack by resting the leader or a battle card, at the opponent's leader or a
rested battle card; the first player does not attack on turn one; the attacker wins ties; a leader hit
sends the top life card to the defender's hand; a losing battle card is KO'd to the Drop; combo cards
go to the Drop at the end of the battle; [Blocker], [Critical], [Double Strike] and [Awaken] mean what
they mean in the original game; the End Phase is your end-of-turn skills, theirs, your "for the turn"
expiries, theirs, pass.

Different, and each one is a line in a `.rules` file or one guarded branch, never a new algorithm:

| Rule | Original game | Fusion World | Where it lands |
|---|---|---|---|
| Zones | 12 + removed/under/play | leader, deck, hand, battle, combo, energy, drop, life, removed (no Z-Deck, Z-Energy, Unison, Warp) | `rulesets/fusion/zones.rules`; `scripts/verify/rulesets.ts` stops demanding 15 |
| Deck | up to 10 Z-cards; off-colour is a warning | no Z-Deck; off-colour is illegal | `game.rules` (`zDeck: 0`); `GAME_INFO.fusion` already says it |
| Combo | from hand paying the card's combo cost, or an active battle card from the field | from hand or an active battle card from the field, **no combo cost** | `vm/battle.ts` reads `comboCost` 0 when the game declares no combo price (F1-03) |
| Keywords | 39 | [Blocker], [Critical], [Double/Triple Strike], [Super Combo], [Awaken] (+ later sets' [Barrier], a field keyword, energy-icon activation prices) | `keywords.rules` subset (F1-02); the energy-icon price only as far as the starters need (none) |
| Timing tags | `[Auto] When this card attacks…`, `[Activate: Main]`, `[Once per turn]` | `[When Attacking]`, `[On Play]`, `[When KO'd]`, `[End of Your Turn]`, `[Activate:Main]`, `[Activate:Battle]`, `[Once Per Turn]`, `[Your Turn]`, `[Opponent's Turn]` | `text/cards.ts` tag table + glossary (F1-04) |
| Activation price spelling | `[Activate: Main]{g}: …` | `[Activate:Main] Place 1 of your energy in your Drop : …` | `compile/prices.ts` (F1-04) |
| Power reduced to 0 | the engine's current handling | to the Drop, **not** a KO: "when KO'd" does not trigger (manual p. 11) | F1-03 verifies and, if needed, guards |
| Skill activation order | turn player first | turn player first (manual p. 11) | same |

Verified on 26 Oct 2026 with a scratch script over `parseSkills` + `compileSkill`: the Fusion World
tags are the one real compiler gap. `[When Attacking] Draw 1 card.` and `[On Play] KO …` fall through
`kindOf` to a `[Permanent]`; the same sentences spelled the dbs way (`[Auto] When this card attacks,
draw 1 card.`, `[Activate: Main][Once per turn] …`) compile with no unread text. Every effect sentence
in the 64 cards (draw, life to hand, ±power for the battle/turn, KO by power or cost, bounce to hand or
bottom of deck, rest/active, "can't switch to Active during your opponent's next turn", life or Drop or
top of deck to energy, play a named cost-1 card from the Drop, "reduce the cost of this card in your
hand by 1", +10000 combo power, hand-size and energy-count conditions) has an op the dbs compiler
already emits.

## 3. Where the engine is still hard-wired to `dbs`

The ruleset spec promises "a second game is files, a drafter and words — no engine code"
(`docs/arena-ruleset-spec.md` §5). The code on `main` is close but not there:

- `src/lib/arena/vm/index.ts`: `const ARENA_GAME: Game = "dbs"` — the state's game is a constant, not
  the deck input's.
- `src/lib/arena/rulesets/index.ts`: `rulesetFor` returns a `RulesetError` for anything but `dbs` (the
  comment already says a second game is "a directory, a regenerated `files.ts` and a row below").
- `scripts/verify/rulesets.ts`: asserts the loaded definition declares exactly the 15 dbs zones and
  the 39 `KEYWORD_NAMES`, and the dbs `GAME` numbers.
- `src/lib/arena/vm/battle.ts` (five `game.id === "dbs"` sites around the end-combo stage),
  `vm/flow.ts`, `vm/unique.ts`, `vm/unison-zero.ts`: dbs-only branches. A Fusion World game must never
  enter them, which is what the guards already do; they stay.
- `vm/script.ts`, `vm/script-schema.ts`, `vm/view.ts`, `vm/effects.ts`, `vm/zones.ts`: about 50 literal
  zone names (`zDeck`, `zEnergy`, `unison`). An op that names a zone the game does not declare must
  refuse by name, not throw (`game.zones[zone]` is already the test in `effects.ts`).
- Gates: `load.ts` (`deckInputFor`), `deck-api.ts`, `offline-decks.ts`, `matches.ts`,
  `rules-store.ts` (the drafter's card query), `rules-progress.ts`, `app/arena/page.tsx`,
  `app/arena/match/[id]/page.tsx`, `app/arena/rules/sandbox-actions.ts`, `local/pack.ts`
  (`game: "dbs"` as a literal type), `catalog/deckplanet.ts` (`draftTouched` returns early for
  `fusion`).

## 4. The work, as issues

Order matters only where an arrow is drawn; everything else may run in parallel sessions grouped by
hot file (`docs/arena-backlog.md` §7).

```
F1-01 second game loads ──► F1-02 fusion/*.rules ──┬─► F1-03 rule differences in vm/
                                                    ├─► F1-04 compiler tags + price + glossary
                                                    ├─► F1-05 gates: the arena plays fusion
                                                    └─► F1-06 board words and screens
F1-03..06 ──► F1-07 verification suite + fuzz ──► F1-08 catalog drafter + owner data ──► F1-09 docs
```

| # | Issue | Model | Size | Touches |
|---|---|---|---|---|
| F1-01 | A second game loads: `rulesetFor("fusion")`, `ARENA_GAME` from the deck, per-game verifier expectations | sonnet | S | `rulesets/index.ts`, `vm/index.ts`, `scripts/verify/rulesets.ts`, `scripts/arena-rulesets-emit.mts` |
| F1-02 | `src/lib/arena/rulesets/fusion/*.rules`: the dbs files cut to Fusion World | sonnet | L | `rulesets/fusion/*` |
| F1-03 | The rule differences in the engine: combo without a price; power 0 is not a KO | sonnet, Opus review | M | `vm/battle.ts`, `vm/effects.ts` or `vm/zones.ts` |
| F1-04 | Compiler: Fusion World timing tags, the trailing-colon price, glossary | sonnet | M | `text/cards.ts`, `compile/prices.ts`, `glossary.ts`, `scripts/verify/*` |
| F1-05 | Gates: one `arenaGames` list replaces every `game === "dbs"` | haiku | S | `catalog/games.ts`, `load.ts`, `deck-api.ts`, `offline-decks.ts`, `matches.ts`, `rules-store.ts`, `rules-progress.ts`, `app/arena/*` |
| F1-06 | Board words and screens for a game with no Z, Unison or Warp areas | sonnet | M | `rulesets/fusion/words.rules`, `fusion/board-words.ts`, `components/arena/stage/*` |
| F1-07 | Verification: a Fusion World suite in `npm test`, fuzz on the starters | sonnet | M | `scripts/verify/arena-fusion-world.mts`, `scripts/verify-arena.ts`, `scripts/arena-fuzz.mts` |
| F1-08 | Catalog and drafter: draft Fusion World cards; the owner's data tasks | sonnet + owner | S + owner | `catalog/deckplanet.ts`, `draft.ts`, a migration |
| F1-09 | Docs: `CLAUDE.md`, `architecture/arena.md`, `arena-code-map.md`, `games.ts` comment, `arena-CURRENT.md` | haiku | S | docs |

Estimate: 4–6 focused sessions, 8–12 PRs, 2–3 owner data tasks. F1-01 and F1-02 are where the
estimate can double: nobody has loaded a second `GameDefinition` before.

## 5. Gate for every PR in the milestone

`npm run checks`; `npm test` where the PR touches `vm/`, `rulesets/`, `text/` or `compile/`;
`npm run arena:fuzz -- 40` for engine or ruleset changes (200 for F1-03); `npm run contract:emit`
reviewed if the `Snapshot` shape changed (it should not); `npm run arena:rulesets -- --check` green;
the glossary updated in the same commit as any compiler change (`CLAUDE.md`, hard rule). No `db:*`,
`sync:*` or Neon access from an agent session: anything only provable against the database is named
in the PR for the owner (`docs/agent-brief.md` → "Data").

## 6. Rulings to record before the owner plays

Each goes in through `npm run arena:rule` once the owner answers, then is filed (`docs/arena-backlog.md`
§5.6). None blocks the code work: F1-03 and F1-07 state the assumption they build on.

1. Power reduced to 0 by a skill: the manual says Drop without "when KO'd" (p. 11). Does the engine
   already treat the original game the same way? If not, F1-03 adds the Fusion World behaviour behind
   the game id and leaves `dbs` alone.
2. The Broly leader's back face as printed on fw.dbscards.fr shows no `[When Attacking] Draw 1 card`
   line, unlike the other three leaders. Confirm from the physical card before F1-08's rule review.
3. Specified costs: fw.dbscards.fr lists none. The owner enters them from the cards (F1-08), as was
   done for the original game by migration 0034.
