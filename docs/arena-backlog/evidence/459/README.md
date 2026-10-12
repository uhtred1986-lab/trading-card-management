# #459 fixed-expectation migration ledger

The seven historical fixture suites, contract emission, two keyword cases and
AI presentation suite were already on rules-engine fixtures at `0e0af6b`.
`scripts/verify-arena.ts --rules-only` still lists `vm` as not run. The saved
legacy-game check in `engine-default` belongs to #118. This branch has not yet
earned #459's zero-legacy-call acceptance or closure.

## Assertions migrated in the first bounded unit

| `vm.ts` section | Former live comparison | Fixed assertion and independent basis |
| --- | --- | --- |
| §9 | Chooser; each side's hand, life, deck order and Leader instance | `vm-opening-459.ts` holds seed 7's exact instance order. Each side has six hand, eight life and 36 deck cards, with instances 1–50 partitioned across those piles and instance 0 as Leader. The existing checks still assert the manual's 6-2-1 sizes and 3-1 one-place-per-card invariant. |
| §11 redraw | p1's hand after the first mulligan | The same fixture holds the six exact instances. It is reached before life is dealt, as 6-2-1-9-1 precedes 6-2-1-10. |
| §§11/16 full games | Full action arrays, full event arrays, turn/winner and ordered p1 Energy Area for charge game | `vm-turn-459.ts` expands the seed-7 piles into every public action/event field. Its setup first draws six each, logs two declined mulligans, places life in reverse pile order, gives p2 one marker, then emits Charge/Main/End turns. Turn 1 has no turn draw; turns 2–72 each draw one. P2's last deck card is drawn at turn 72 and the game ends with p1 winning. The charge variant moves the next held card to Energy on each completed turn. The expansion compares 145 actions and 544 pass-only or 615 charging events field for field, with only `gameOver.reason` normalized as the old comparison already did. P1 Energy is asserted in exact instance order. |
| §16 Main-phase charge refusal | Legacy first requirement for every hand card | The existing direct assertion builds the expected list from each hand card with fixed `{ kind: "oncePerTurn", what: "charge" }`; it also asserts no ghost skip refusal and no legal charge. The legacy playback compared only the same requirement list. |
| §18 plays | Full events for Battle Card, played [Auto], two Unison plays, Z-card play and X-cost Unison; battle placement, markers, hand size, first price refusal and words; X menus and payment amount | Complete fixed event objects preserve action, rest, move, skill, draw, marker and Z-Energy ordering and every field. Seed-11's six-card hand is fixed. The wrong-colour board checks all six instance-keyed first requirements and their exact client sentences. Fixed X menus are `[0,1,2]` and `[1,2,3]`; X=1 rests one energy. Manual §§8-3-2, 9-6-9-4, 13-2, 16-2 and the printed synthetic cards justify the outcomes. |
| §22 | Whole `move` event produced by lowered `ko` on each host | Exact `{type: "move", card: stagedInstance, from: "battle", to: "drop", owner: "p1"}`. The separate macro assertion still requires `cause: "ko"` in the lowered op. |
| §23 counter | Legacy battle null, prompt `main`, p2 life equal to rules | Rules battle null, prompt `main`, and fixed p2 life length 8. The direct rules assertions also retain counter in Drop and rested attacker. |
| §23 combo | Legacy battle null, guard in p2 Drop, spent combo in p1 Drop | The same three direct rules assertions remain. The rules assertions also retain contribution 5000, power and offer flow. |
| §24 damage | Legacy script host moved its last life card | Rules script moves p2 life to length 0, then asserts winner p1, `gameOver` prompt and beat in the same run. |
| §31 | Seven `CardView` objects compared field by field to the legacy builder | `vm-card-views-459.ts` holds complete public objects, including fields absent from a given card. Every card is compared as a whole, so extra, missing or changed fields fail. Values follow the staged V1/AURA/BLOCKER printed cards, +5000 standing and +5000 timed power, the awakened Leader face and the ordinary blue opposing cards. Hidden Mode remains a separate direct assertion. |
| §28 | Full event arrays and pending trigger sets for opponent KO, own KO, Indestructible, token creation and token KO | Exact event arrays keep KO-before-move and `battle → removed` for a token. Fixed sorted trigger sets name every printed `koed`/`yourCardKoed`/`opponentCardKoed`/`kos` skill. The empty event and trigger sets on an Indestructible target are explicit. Token id `p1#token102` is fixed for this seed and staged board. |
| §29 | Burst/reduced-skill/payer/alternative-price offers, first refusals, full event arrays and final life count | Exact event arrays retain move order, reveal flags, energy rests, printed skill text and card instances. Every formerly compared menu has a fixed expected action list. Refusals state `[Burst 2] needs that many cards in the deck` and the red-orb shortfall explicitly; the life price ends at seven cards. The printed fixture skills and manual §§22-27, 4-3-3, 20-19 and 5-3 justify each case. |
| §26 Active Step | Whether a rested Energy card becomes active at its master's next Active Step | Direct fixed `mode === "active"` assertion remains, grounded in 7-2-7's named Energy Area. The paired legacy fixture added no other field check. |

§23 and §24 removed seven legacy outcome assertions. Each compared fact maps to
a direct literal rules assertion above; those cases never compared event, legal
action or view objects. §22 and §31 had broad object comparisons, retained as
exact fixed objects. The remaining live oracle sections are §7, §14,
§17 and §§19–21's action and price cases, and §26's legacy `cardNow`/`matches` face checks. §§1–2 and §5 assert adapter and saved legacy-state
compatibility; #118 must retain or retire those explicitly during adapter
deletion, rather than silently discarding them as gameplay assertions.

No contract or probe digest fixture was edited.

The trace expansion's counts are derived from the procedure: three setup
answers plus two answers on each of turns 1–71 make 145 actions; twelve opening
draws plus one on each of turns 2–72 make 83 draws; sixteen life placements
plus those 83 draw moves make 99 pass-only moves. Charging adds 71 moves. The
214 phase events are Charge on turns 1–72 plus Main and End on turns 1–71.
`gameStart`, one energy marker and `gameOver` supply the other three events.
