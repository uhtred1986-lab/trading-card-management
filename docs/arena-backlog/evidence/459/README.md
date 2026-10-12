# #459 fixed-expectation migration ledger

The seven historical fixture suites, contract emission, two keyword cases and
AI presentation suite were already on rules-engine fixtures at `0e0af6b`.
The branch includes `vm` in `scripts/verify-arena.ts --rules-only`. The full
rules-only run passed 56/56 suites, with zero legacy calls and no suite omitted;
the normal arena run passed 56/56 too. The saved legacy-game check in
`engine-default` belongs to #118.

## Assertions migrated in the first bounded unit

| `vm.ts` section | Former live comparison | Fixed assertion and independent basis |
| --- | --- | --- |
| §9 | Chooser; each side's hand, life, deck order and Leader instance | `vm-opening-459.ts` holds seed 7's exact instance order. Each side has six hand, eight life and 36 deck cards, with instances 1–50 partitioned across those piles and instance 0 as Leader. The existing checks still assert the manual's 6-2-1 sizes and 3-1 one-place-per-card invariant. |
| §11 redraw | p1's hand after the first mulligan | The same fixture holds the six exact instances. It is reached before life is dealt, as 6-2-1-9-1 precedes 6-2-1-10. |
| §§11/16 full games | Full action arrays, full event arrays, turn/winner and ordered p1 Energy Area for charge game | `vm-turn-459.ts` expands the seed-7 piles into every public action/event field. Its setup first draws six each, logs two declined mulligans, places life in reverse pile order, gives p2 one marker, then emits Charge/Main/End turns. Turn 1 has no turn draw; turns 2–72 each draw one. P2's last deck card is drawn at turn 72 and the game ends with p1 winning. The charge variant moves the next held card to Energy on each completed turn. The expansion compares 145 actions and 544 pass-only or 615 charging events field for field, with only `gameOver.reason` normalized as the old comparison already did. P1 Energy is asserted in exact instance order. |
| §16 Main-phase charge refusal | Legacy first requirement for every hand card | The existing direct assertion builds the expected list from each hand card with fixed `{ kind: "oncePerTurn", what: "charge" }`; it also asserts no ghost skip refusal and no legal charge. The legacy playback compared only the same requirement list. |
| §18 plays | Full events for Battle Card, played [Auto], two Unison plays, Z-card play and X-cost Unison; battle placement, markers, hand size, first price refusal and words; X menus and payment amount | Complete fixed event objects preserve action, rest, move, skill, draw, marker and Z-Energy ordering and every field. Seed-11's six-card hand is fixed. The wrong-colour board checks all six instance-keyed first requirements and their exact client sentences. Fixed X menus are `[0,1,2]` and `[1,2,3]`; X=1 rests one energy. Manual §§8-3-2, 9-6-9-4, 13-2, 16-2 and the printed synthetic cards justify the outcomes. |
| §19 activations | Full logs for free/priced/once-per-turn skills, a hand Extra, an orb-priced Extra and PUMPCRIT; hand size, line keys, first refusals and words, Extra price/zone/refusal, effects in force | Complete fixed event arrays include exact action, energy rest, skill text, draw, Extra hand-to-Drop move and effect payload/order. The three-line card checks indices 0/10/20. The blocked board checks five line-keyed requirements and all five client sentences. Direct literal checks retain used-up, wrong area and red-orb shortage cases. PUMPCRIT checks the power +5000 and Critical effect records against fixed values. Printed synthetic skills and manual §§7-3-4, 9-1-3-1, 12-2-2, 22-44-3 ground the values. |
| §22 | Whole `move` event produced by lowered `ko` on each host | Exact `{type: "move", card: stagedInstance, from: "battle", to: "drop", owner: "p1"}`. The separate macro assertion still requires `cause: "ko"` in the lowered op. |
| §23 counter | Legacy battle null, prompt `main`, p2 life equal to rules | Rules battle null, prompt `main`, and fixed p2 life length 8. The direct rules assertions also retain counter in Drop and rested attacker. |
| §23 combo | Legacy battle null, guard in p2 Drop, spent combo in p1 Drop | The same three direct rules assertions remain. The rules assertions also retain contribution 5000, power and offer flow. |
| §24 damage | Legacy script host moved its last life card | Rules script moves p2 life to length 0, then asserts winner p1, `gameOver` prompt and beat in the same run. |
| §31 | Seven `CardView` objects compared field by field to the legacy builder | `vm-card-views-459.ts` holds complete public objects, including fields absent from a given card. Every card is compared as a whole, so extra, missing or changed fields fail. Values follow the staged V1/AURA/BLOCKER printed cards, +5000 standing and +5000 timed power, the awakened Leader face and the ordinary blue opposing cards. Hidden Mode remains a separate direct assertion. |
| §28 | Full event arrays and pending trigger sets for opponent KO, own KO, Indestructible, token creation and token KO | Exact event arrays keep KO-before-move and `battle → removed` for a token. Fixed sorted trigger sets name every printed `koed`/`yourCardKoed`/`opponentCardKoed`/`kos` skill. The empty event and trigger sets on an Indestructible target are explicit. Token id `p1#token102` is fixed for this seed and staged board. |
| §29 | Burst/reduced-skill/payer/alternative-price offers, first refusals, full event arrays and final life count | Exact event arrays retain move order, reveal flags, energy rests, printed skill text and card instances. Every formerly compared menu has a fixed expected action list. Refusals state `[Burst 2] needs that many cards in the deck` and the red-orb shortfall explicitly; the life price ends at seven cards. The printed fixture skills and manual §§22-27, 4-3-3, 20-19 and 5-3 justify each case. |
| §20 | Legacy `playCost` total/specified for baseline, reduced, zero and relaxed plays; first refusals; complete reduced-play event list and ordered energy | Printed R-TWO costs two with one red orb. One flat reducer removes one total and its red orb; the sole staged blue Energy card `p1#6` pays, so fixed events are action, rest `p1#6`, and revealed hand-to-battle move `p1#43`. A reduction past zero floors at zero; the specified-only reducer removes the red orb while retaining total two. The baseline and colour-short boards keep their exact first refusal objects. Full fixed events, energy order and rested mode retain the former broad comparisons. The exact instance IDs follow seed 13's staged pile; rule basis is manual 20-21 and the printed synthetic reducer text. |
| §21 | Legacy-side offers and first refusals for a control play, prohibited play, card's own ban, prohibited charge and skill; no-Unison and legal grow checks; grown marker and under-card; legacy price-before-ban divergence | Each shared gameplay result already has a direct rules assertion with the exact offer/refusal, including the two charge menu variants, and the grow result checks the exact marker/under-card and once-per-turn fact. The intentional legacy ordering is separately asserted against fixed `{kind:"energy",need:1,have:0}` in guarded `vm-legacy-118.ts`; the rules result stays fixed to `{kind:"forbidden",by:"F-NO-PLAY",until:"permanent"}`. Manual §§20-14, 7-2-11, 13-3 and printed prohibitions ground the rules results. |
| §§1–3/5 adapter | Six legacy adapter function identities, legacy availability, legacy state shape and saved-state seam | The same assertions now live in `vm-legacy-118.ts`, guarded by `RULES_ONLY`. They remain executable in the normal VM lane for #118 and are explicitly excluded from #459's rules-only lane. Rules-engine interface, state, round-trip and invalid-state checks remain in `vm.ts`. |
| §26 legacy faces | Legacy `cardNow` front/back/Hidden Mode name, skill, colours and traits; `matches` awakened/front name predicate | These are compatibility assertions about the old interpreter's public card reading, now retained verbatim in guarded `vm-legacy-118.ts` for #118. The rules-only lane has its own fixed `attrsNow` assertions for every front/back/hidden field and the separate full `CardView` fixture in §31. |
| §7 | Every sampled `CardFilter` field on every catalog row: 40 fields × 98 rows, including the explicit `originalColors` exception | `vm-filters-459.ts` fixes the exact 98-row order and all 40 complete matching sets or complements. The two distinct `RENAMED` rows have distinct keys. Each outcome was checked against its sampled phrase and the printed synthetic rows: blue/red/multicolour, characters/traits/names, printed keyword and skill lines, card types, numeric printed costs/power/combo including null and X, token/Z flags and the deferred catalog flags. The test checks corpus identity, set membership validity and every one of 3,920 outcomes. A new card or changed printed row now needs deliberate expectation review. |
| §17 | 45 payment cases: payable status, full refusal arrays, selected rest/marker payment, complete payment options and description; 98 harness-card total and specified-orb prices | `vm-costs-459.ts` fixes all five staged pool rows and nine named printed-price columns. Literal instance numbers expand only to `p1#N`; no planner feeds the expected values. The options retain order and every rest/marker choice, including Red markers, dual-colour energy and either-orbs. Refusals include the two simultaneous shortfalls on the marker-only board and the impossible three-Red-orb/two-total price. The card-price classes freeze membership of all 98 non-Leader, non-token cards: printed numeric totals, zero-start X, first-colour orb, and Colorless COST2. Manual 3-8-2, 5-3 and 22-13 plus the printed synthetic cards ground the cases. The rest of §17 keeps direct fixed charge-event and payCost prompt assertions. |
| §14 primitive negation, flip and mode | Full rules and legacy spelled/primitive events and beats, plus legacy effect/flip/rest facts | Each rules spelling and primitive is compared with complete literal event and beat arrays, including both negated targets, effect IDs, source, duration and beat sequence; the Leader's flip and the Battle Card's rest each have their exact event/beat objects. `vm-legacy-118.ts` retains the separate legacy host's spelled/primitive equivalence and effect/flip/rest checks behind the #118 guard. Printed `[Permanent]` and 1-9/1-10-1 ground the effects. |
| §14 macro and counted moves | Full rules spelled/lowered `Seen` tuple: every event, beat, both players' full side/zone arrays and attrs, prompt, `did`, vars; legacy spelled/lowered tuple equality and legacy timed/lifetime assertions; five resolving records | `vm-scripts-459.json` holds 29 complete immutable rules records. Both spellings equal the full record, and the test checks that no expected case is unused. [`script-14-review.md`](script-14-review.md) ties each program to the printed op, seed-7 piles, ordered event/zone changes, prompt and binding. The five resolving records are separately fixed because `sides` excludes `resolving`. Legacy-host self-equivalence, bound-target/lifetime checks and legacy resolving state stay executable in the normal lane behind explicit `!RULES_ONLY` #118 guards. |
| §26 Active Step | Whether a rested Energy card becomes active at its master's next Active Step | Direct fixed `mode === "active"` assertion remains, grounded in 7-2-7's named Energy Area. The paired legacy fixture added no other field check. |

§23 and §24 removed seven legacy outcome assertions. Each compared fact maps to
a direct literal rules assertion above; those cases never compared event, legal
action or view objects. §22 and §31 had broad object comparisons, retained as
exact fixed objects. No rules-engine gameplay expectation now comes from a
legacy runtime result.
The #118 adapter, saved-state and legacy face-reading checks remain in a
separate guarded module for explicit retirement. The legacy script-host
self-equivalence and lifetime cases still live in `vm.ts`, but every call is
behind `!RULES_ONLY` and is tracked as #118 compatibility. After rebase onto
`origin/main` `2f04b7e`, the direct guarded VM run reports zero legacy calls
and the shared suite registry no longer excludes `vm`. The full branch proof
below passed. Root review and integration remain.

No contract or probe digest fixture was edited.

The full runner executes other suites before `vm`, and those suites append or
replace card rows in the shared `DEFS` object. `vm-base-corpus-459.ts` captures
the original harness card inputs before the first suite; the fixed literals
remain in the separate filter and cost files. The test checks that the capture
has exactly the reviewed original card IDs, checks every original priced card
is in the 98-card price corpus, and uses the captured printed row for both
direct and full-suite VM runs. This resolved a full-suite failure in which an
earlier suite had repriced `EXILE`; no expectation was changed to accept that
mutation.

## Assertion inventory and #118 boundary

The large former comparisons remain broad checks: two complete 145-action
games with 544 and 615 full event objects; 40 filter fields across each of 98
catalog rows (3,920 fixed outcomes); 45 price/payment boards, all 98 catalog
prices, and all 29 complete script cases checked for both spelled and lowered
forms (58 full `Seen` comparisons). The five `resolvingPlay` variants also
check their complete resolving records for both forms. Seven complete card
views and the smaller exact action, event, refusal, zone and legal-menu
assertions appear in the mapping above. The table states the independent rule,
printed-card or fixed-pile basis for each changed comparison; these totals
describe cases, not a count of `assert` calls.

The normal VM lane deliberately retains these #118 compatibility assertions,
all guarded from `--rules-only`:

- `vm-legacy-118.ts`: six adapter function identities and availability,
  legacy-shaped state and saved-state seam, the legacy price-before-ban
  answer, and legacy front/back/Hidden Mode `cardNow` and name-filter facts.
- `vm-legacy-118.ts`: legacy host primitive/spelled equivalence and its
  negation, Leader flip and mode facts for §14's three primitive programs.
- `vm.ts` §14: legacy host spelled/lowered self-equivalence across the 29
  scripts, the bound-target, timed-selector and lifetime behavior, its
  resolving-play records and the legacy-only side of the negate-attack fact.

These compatibility assertions run in the normal lane and are excluded only
from the rules-only lane. Their removal belongs to #118; their presence does
not supply any rules-engine gameplay expectation.

## Rules-only source audit

`vm.ts` has three remaining imports that can execute legacy code:
`engine.createGame`, `engine/legacy-host.legacyHost`, and the legacy-state
`beats.toBeats`. All three occur only inside §14's `onLegacy` function.
Its `same()` caller returns before invoking `onLegacy` when `RULES_ONLY` is
true, and all three direct timed-selector/lifetime invocations have explicit
`if (!RULES_ONLY)` guards. The legacy primitive and adapter helper runner
also returns before any legacy call in that lane. No runtime legacy payment,
filter, card-view, event or action expectation remains. Importing a pure card
definition or filter shape is not an engine call.

This source audit matters because the current proxy guard does not intercept
some statically bound legacy exports. A passing guard report by itself would
miss the former §7 `matches`, §17 `planPayment` and §14 host calls. The corpus,
price and complete script fixtures replace those expectations directly.

The trace expansion's counts are derived from the procedure: three setup
answers plus two answers on each of turns 1–71 make 145 actions; twelve opening
draws plus one on each of turns 2–72 make 83 draws; sixteen life placements
plus those 83 draw moves make 99 pass-only moves. Charging adds 71 moves. The
214 phase events are Charge on turns 1–72 plus Main and End on turns 1–71.
`gameStart`, one energy marker and `gameOver` supply the other three events.

## Branch validation — 12 Oct 2026

- `DATABASE_URL='' npx tsx scripts/verify-arena.ts --rules-only`: 56/56 passed,
  zero omitted, zero failed, `legacy engine calls: none`.
- `DATABASE_URL='' npx tsx scripts/verify-arena.ts`: 56/56 passed, zero skipped
  and zero failed. This executes the separately guarded #118 compatibility
  assertions in the normal VM lane.
- `DATABASE_URL='' npm test`, with only the default
  `tsx scripts/verify-arena.ts && ` invocation temporarily removed from the
  package test command: exit 0. The rules-only 56/56 gate, capability inventory
  check, and all later commands completed. A Python `try/finally` restored
  `package.json` byte for byte; its original and restored SHA-256 were both
  `8d76ecb225567271107e3f781135bff6b83ccbfff22ee88a875baaa70b3c353b`.
  The temporary package edit is not committed.
- `npm run typecheck`, focused ESLint on changed scripts, and
  `scripts/verify/capabilities.mts --check` passed.

The build remains for root validation: `npm run build` hit Turbopack's refusal
of this worktree's external `node_modules` symlink; a webpack build reached
standalone file copying but failed with `ENOSPC` on the shared 32 GB overlay.
Only this worktree's generated `.next` directory was removed afterward.
