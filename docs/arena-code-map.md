# Arena code map

Written 14 Sep 2026, moved out of `CLAUDE.md` (issue #282) so the file loaded into every session
stays small. This is the detailed *how it was built and how it fits together* narrative for every
arena module — engine, compiler, rules language, UI. `CLAUDE.md`'s Architecture section keeps a
three-line pointer to each of these bullets: what the module is, the one rule to keep, and this
document. Read `docs/arena-next-session-prompt.md` first for *where the programme stands and what
to work on next* — this document is the reference for *what exists and why*, not a to-do list.

Every sentence here that states a rule or an invariant is binding on future work in that module,
the same as if it were still in `CLAUDE.md`.

---

- **Arena rules engine** (`src/lib/arena/engine/`): **Dragon Ball Super
  only — it does not play Fusion World**, so `deckInputFor` returns null for such a deck and the
  arena's deck lists ask for `game: "dbs"`. Pure TypeScript, no React,
  no database. A game is a `GameState` plus an append-only event log; `apply(ctx, state, action)` is the
  only mutator and runs the flow (a data step list in `state.flow`) until the next `prompt`, so a game
  is storable mid-decision and reproducible from seed + actions. `legalActions()` drives both the UI
  and, later, Claude's move menu. Card text is *read*, not interpreted: `cards.ts` parses skill
  types, keyword skills (§22 of `docs/rules/rulemanual.txt`) and orb costs; `filters.ts` reads the
  fixed target grammar ("Blue <Baby> with an energy cost of 4"); `effects.ts` handles a few fixed
  phrasings natively and logs a note for everything else, which is where the phase-3 compiled
  scripts and the runtime referee plug in. Only skills the engine can both pay for and resolve are
  offered as actions. Design and decisions: `docs/arena-design-proposal.md`; history and
  lessons: `docs/arena-history-lessons.md`; **the current worklist: `docs/arena-rules-worklist.md`; the current work brief with code map,
  checklists and backlog: `docs/arena-next-stage-spec.md`** — read it before touching the compiler. Tests:
  `scripts/verify-arena.ts` (part of `npm test`), synthetic cards, sections cited in messages.
  **Picking the work up cold: `docs/arena-next-session-prompt.md`** says where the programme stands,
  what to do next in priority order, and how to run streams in parallel; `docs/arena-tooling.md`
  says how to tell whether you broke something. Two pieces of work are scoped but not built, each
  with its own document and each deliberately *not* smuggled into a wording commit:
  `docs/arena-side-scope.md` (the side test, three bugs from one mechanism) and
  `docs/arena-markers-stage-scope.md` (markers and [Empower], where most of it already works).
  The third, `docs/arena-move-replacement-scope.md` (letting a replacement prompt), is **built**
  — §5 says what both increments measured, §6 the remainder: `move()` is still synchronous at 46 of
  its 48 call sites and the two that are not decide the replacement before calling it, so 9-10-2's
  choice, 9-10-3's "you may" and the "by an opponent's skill" narrowing all read.
- **The compiler's glossary** (`src/lib/arena/glossary.ts`, shown at `/arena/rules/keywords`): every
  keyword skill the parser recognises, the keywords that are not skills, the skill types, and the
  rules a line is read by — each with what the manual *means* and, separately, what this engine
  actually *does*, including where it approximates. It is the only place either of those is
  written down, so **it is part of the compiler, not documentation about it**: see the Conventions
  rule below. `KEYWORDS` is keyed by `KeywordSkill["name"]` so a new keyword fails `npm run
  typecheck` until it is described, and `npm test` checks every tag printed there is a spelling
  `keywordOf` really reads.
- **Two engines, chosen per game** (`src/lib/arena/engines.ts`, since 9 Sep 2026): `legacy` is
  `src/lib/arena/engine/` — frozen, bug fixes only — and `rules` is the configuration-driven
  engine being built beside it under `src/lib/arena/vm/` (the programme: the plan the owner
  approved on 9 Sep 2026; specified in `docs/arena-rules-language.md` and
  `docs/arena-ruleset-spec.md`). A game keeps the engine it was made on (`arena_games.engine`,
  and `arena_matches.engine` for a 1 v 1), because `state` is that engine's shape and `actions`
  replay only on it. `engineFor(row.engine)` is the one switch; `games.ts`, `snapshot.ts` and
  the scripts go through it and never import `./engine` to play a saved game. `ENGINE_INFO`
  says which engines can play; the `/arena` form greys the rest, and the `arena.engine`
  setting (Settings → Arena engine, `engine-setting.ts`) is the default until the owner flips
  it. The old engine stays the **oracle**: `arena:diff` replays a game's actions on either
  engine and must land on the row's state. `Snapshot.game.engine`/`.game` are the one
  contract change. `engineFor` resolves **both** ids — the `Engine` interface is the six calls
  `createGame`, `apply`, `legalActions`, `rejectedActions`, `boardView` and `toBeats`, and what the
  rules engine cannot do yet it refuses with `NotYet`, naming the issue that builds it (an
  `IllegalAction`, so the API answers one rather than failing).
  A side is `Record<zoneName, cardId[]>` built
  from the `ZONE` declarations (`vm/zones.ts`, where `moveCard` is the only mover and honours
  `single`, `modes`, `markers`, `place`, order and `under{host}` generically), a card is a bag of
  declared attributes read off the catalog by `vm/cards.ts`, and a `CardFilter` becomes a predicate
  over those attributes through the one adapter in `vm/filters.ts` — so the compiler, `card_rules`
  and the drafter are untouched (#139).
  **The turn is a program** (`vm/flow.ts`, #140): `state.flow` is a stack of `{phase, index}`
  frames over the `DEFINE PHASE`/`DEFINE STEP` declarations, the frame *is* the suspension (so a
  game is storable mid-decision and reproducible from seed plus actions), a step's `prompt:` is
  what raises a question, and the End Phase's repeat is a `LIMIT n` on the step — the ceiling in
  the declaration, so a mis-declared trigger cannot hang a game. `DEFINE GAME` names the setup and
  over phases so the runner knows neither by name. It plays **pass, endMain, concede, the charge and
  the play family** — a game of charging, playing and passing runs turn to turn to a deck-out and
  logs event for event what the legacy engine logs, which `verify/vm.ts` asserts and `arena-fuzz
  --engine rules` shakes out. Four constants still name pieces of the DBS definition and each is
  checked against it at load: `SETUP_ZONES`, `STEP_WORK` (the six steps whose `DO` programs Stage 5
  writes) and `vm/play.ts`'s `PLAY_ZONES` and its two neighbours.
  **A move and its refusal are one paragraph** (`vm/actions.ts` + `dbs/actions.rules`, #144):
  `DEFINE ACTION` is WHEN / `prompts:` / FOR / BIND / COST / DO / REFUSE, and `legalActions` and
  `rejectedActions` are two readings of it — the candidates whose `REFUSE` lines all hold, and the
  first requirement that stopped each of the rest. There is no `whyNot*` twin to drift; a `REFUSE`
  names a `Requirement` kind and nothing else (`REQUIREMENT_KINDS`, closed) so `wording.ts` needs no
  second table; and §3.2's one-rejection-per-card is the *shape* rather than a dedupe pass —
  `assertMenuInvariants` in `scripts/verify/harness.ts` is the one function both engines' menus are
  passed to. `listed: false` is the concede rule written down: accepted, never enumerated, on
  neither list. What the interpreter reads so far is a `FOR` by side/area/filter/mode, a `REFUSE` of
  `count()`/`isTurnPlayer()`/`asking()`/`forbidden()` and their combinations, and a `DO` of `note()`;
  everything else is refused *by name* rather than read as false. `actions.rules` declares charge, endMain, pass and
  concede (#145), the play family (#146) and `activate` (#147).
  **Playing a card is a paragraph too** (`vm/play.ts` + the three `play` declarations, #146):
  `play` (8-3-2), `playUnison` (13-2) and `playZ` (16-2) each name a `COST` and a `DO` of the one
  `play` op, so a play a player declares and a play a skill makes (5-5-3) resolve in the same place.
  The card's arrival is a `moved(asPlay: true)` moment `triggers.rules` turns into `played` — nothing
  pends a trigger by name — a Unison's markers are the energy paid (`addMarker(n: X)`, where a move's
  `X` is the amount its price was settled at), 3-11-5 is read off the zone's `single:` rather than
  off the card's type, and a [Permanent] comes into force by the card being in an in-play area.
  7-3-4's free timing is the declaration's `again:`: taking a play leaves the Main Phase's question
  on the table, and `endMain` — which carries none — is what ends the phase. `verify/vm.ts` §18
  asserts the log event for event against the legacy engine, and the first refusal per card with it.
  Two gaps are written into `actions.rules` beside the paragraphs: an **X** cost has no total until
  its master names one and a candidate is a card and nothing else, so such a card is refused `unread`
  rather than offered free; and 22-39's [Unique] needs a filter for "the same name as this
  candidate", which `FILTER_FIELDS` has none.
  **20-14's prohibitions are in force and read** (#145's last piece): `permanents` collects the
  `forbid` op out of a [Permanent], `vm/program.ts`'s `forbids`/`forbiddenBy` are the legacy
  predicate and its twin over this engine's board — the timed effects, the standing ones, and a
  card's own rule about itself wherever it sits (9-1-3-3) — and the `forbidden()` condition is what a
  `REFUSE` gates a move on, with the fields only the board knows (which card's rule, how long, the
  escape clause) filled in by the interpreter. The play family, the charge and the activation all
  carry the gate, a selector honours "can't be chosen" (20-4), and the host's 0-2-5 question answers
  off the board instead of `false`. The one ordering that is *not* legacy's is recorded rather than
  matched: a `REFUSE` runs before the price, and legacy puts the price first for a plain Battle Card
  and the prohibition first for a Unison or an X cost (`verify/vm.ts` §21 asserts both). 22-33's
  `offering` is a boolean answer no candidate can carry (#157).
  **A player has facts of their own, not only cards** (`DEFINE ATTRIBUTE of: player`, issue #269):
  `reset: turnStart` is the declaration's own ceiling for one that returns to rest on its own —
  `vm/flow.ts`'s `endTurn` clears every one so flagged, off `game.attributes` rather than by name —
  and `playerAttr`/`setPlayerAttr` are the one `Cond`/`Op` row that reads and writes one. `charged`
  (7-2-11) and `grewUnison` (13-3) are the first two. The charge's once-a-turn `REFUSE` now reads
  `charged` — true from the moment the Charge Phase's own question is answered, win or skip, set in
  `mainPending` rather than in the action's own `DO`, because leaving the Charge Phase closes the
  window whether or not a card was placed — in place of the `asking(prompt: charge)` proxy #145 left
  it on. 13-3's `growUnison` is declared beside it, gated the same board-then-card order as
  `whyNotCharge`; "a copy of the Unison Card in play" is `sameCard`, a new `Cond` reading two
  selectors for the same printed identity rather than stretching a filter to name another card's
  identity dynamically (the same gap #145 named for 22-39's [Unique], `FILTER_FIELDS` still has no
  word for it, and this does not add one — a selector pair only reaches a card the declaration itself
  names, e.g. the one card a `ZONE single: true` area holds). **What it does not do**: finish the
  move. `vm/host.ts`'s `placeUnder` throws `NotYet("#146")` unconditionally, so taking a legal,
  correctly-refused `growUnison` still stops there — caught at `stepProgram`'s existing boundary
  (`vm/flow.ts`), the same safety net every other unbuilt primitive uses, which now ends the game
  rather than noting the gap and playing on (#149, `ENGINE_INFO.rules.available` is true). Discovered
  delivering #269, not fixed by it.
  **Using a skill is a paragraph about a *line*** (`vm/activate.ts` + the `activate` declaration,
  #147): the one move whose candidate is not a card. A card prints up to nine skills, each with its
  own price, its own condition and its own once-per-turn ceiling, so `DEFINE ACTION`'s new `skills:`
  line says which printed kinds the move offers and `FOR` says only which cards are looked at —
  which is §3.2's one exception (one rejection per card per action type, **one per skill line for an
  activation**) as the *shape* rather than as a special case. A line of the same family in another
  window is still a candidate and is refused with the `timing` requirement naming the window it
  belongs to; the window a move offers is the one its declared kinds share, so Stage 6's battle
  paragraph needs no second table. The `DO` is empty and checked to be: the program an activation
  runs is the **record's** (`Script.ops`), queued on the interpreter a pended [Auto] runs on, and the
  moment is a `skillActivated` the declarations answer. The **price** is the record's too — the orbs
  printed in front of the line and 13-4's marker cost, bound from the line rather than read off the
  card (`BoundAmounts` in `vm/costs.ts`), with the declared `text` price refusing a cost this engine
  cannot read instead of playing the skill free. The gates are the legacy `whyNotActivate`'s in its
  order, so the *first* requirement is the same on both engines (`verify/vm.ts` §19, and
  `assertMenuInvariants` now asserts every activation names its line — the same words in
  `arena-playthrough.mts`). What it does not read is written into `actions.rules` beside it: a
  keyword's own activation is a `DEFINE KEYWORD` hook body (Stage 7), an X price and an action price
  are refused `unread` for the same reason a play's X cost is, and [Counter] windows are Stage 6's;
  20-14's prohibition is the one gate of this move that is not a `REFUSE` line, because
  `whyNotActivate` asks it second and a declared `REFUSE` runs before everything. `VmCard` gained `usedThisTurn` and
  `usedMarkerSkill` for 22-44-3 and 13-4, emptied by `endTurn` (state version 6).
  **A price is a declaration too** (`vm/costs.ts` + `dbs/costs.rules`, #148): seven `DEFINE COST`s —
  energy (total, coloured orbs, either-orbs, X), zEnergy (5-4, brought forward from #151 so `playZ`
  is not offered free), marker, life, rest, payWith and the `text` price no engine charges itself —
  each saying what it `consumes:`, which card attribute its `amount:` is read off, and how the
  payment `asks:` its question,
  and **one planner over those words rather than a branch per price**. It switches on `consumes:`
  and never on a declaration's name, and reads the declaration's `DO` for two things at once: the
  op's `target` is the pool the price is paid out of (`IN you.energy active` names both the area and
  the mode) and the op is what paying does to what was taken. The promises are the legacy engine's,
  asserted board for board against `planPayment` in `scripts/verify/vm.ts` §17: the same
  `Requirement` when a price cannot be met (so `wording.ts` needs no second table), the same
  `payCost` prompt with legacy `Payment` options (so no `Prompt` kind and no `Snapshot` field moved),
  and the same cards rested. `priceFor` is the one evaluation the row's `ActionCost` and the charge
  both come from. One gap was named rather than charged as nothing: the amounts of marker, life and
  20-19's payWith are all bound from a skill's own line by an activation (#147, and payWith #149),
  so a price named by an action that binds nothing is refused by name rather than charged as free.
  `payWith` here is the record's own per-price form — a [Permanent]'s whole-board grant of the same
  permission (BT3-039, "you can use this card to pay energy costs…") is still unread on this engine
  (`vm/effects.ts`'s `DEFERRED_STATICS`), and no card yet compiles to the per-price form itself.
  **20-21's reductions are read, and read as layers** (#148 Build 2): `permanents` reads the
  `costReduction` op out of a [Permanent] — which could only matter once a card could be put in
  play (#146) — and `attributes.rules` declares `costOf` as `[printed, reduction]` and
  `specifiedCost` as `[printed, reduction, specified]`, so the total falls, one coloured orb goes
  with each energy (20-21-2), the floor is zero and "reduce the specified cost by {u}" relaxes a
  colour without moving the total (the owner's BT19-039 ruling). A layer is a function rather than
  a sum, `LAYER_KINDS` is the one place an attribute's name is paired with the effect kind a layer
  of it reads, and `costLayerGaps` checks that pairing against the declarations when a game is made.
  `verify/vm.ts` §20 stages a reducer on both engines and compares the price, the refusal and the
  energy rested. What is still out is 22-19's [Warrior of Universe 7]: a **keyword** rather than a
  cost reduction, so a `DEFINE KEYWORD` hook body and Stage 7's.
  **A moment is an event pattern, not a name** (`vm/events.ts` + `vm/triggers.ts`, #141): the
  runner says what happened — a card moved, a phase began, a mode switched — as a `Moment` in the
  words `dbs/triggers.rules` is written in, and the declarations decide which [Auto]s that is a
  moment for (`watcher:` who is asked, `WHERE` which side, `BIND` what the moment's card is called).
  The name that comes out is the name `card_rules.trigger` says, so the record's WHEN means the same
  thing on both engines, and a card with no record falls back to the legacy `autoTriggerMatches`
  — imported, never copied. The runner names no trigger anywhere, which is the difference from the
  forty hand-placed `pendTriggers` calls in `engine/`. 9-1-3-1's eleven "fires while the card is
  elsewhere" exceptions are **derived**: a pattern that names a place (`moved(from: combo)`) has
  already said where the card is. `state.pending` is the queue, `nextPending` is 9-6-6 (turn player
  first) copied from the legacy `checkpoint`, and the runner drains one between steps and before any
  question. §22 keyword
  moments are pended by neither the record nor `triggers.rules`: they are Stage 7's hooks (#153).
  **#153 confirmed the fifteen hook points and built the contract**, `vm/hooks.ts`, from a full
  inventory of the legacy engine's 38 inline keyword sites (`docs/arena-ruleset-spec.md` §4). Fifteen
  names, four groups matching the `s7-0{2,3,4,5}` issues (A choosing/immunity/KO-by-effect, B
  enter/leave/after-a-skill, C battle, D play/charge/pay), each answering as a **query** (asked
  mid-calculation, read declaratively off the body the way `vm/effects.ts`'s `permanents()` reads a
  [Permanent] without running it — `queryHookStatics`) or an **effect** (something happens; queued
  onto `state.programs` exactly like a triggered [Auto]'s `DO` block — `fireHook`). Both go through
  one lookup, `hookBodiesFor`, so a hook body is never a special case a call site invents — `rulesets/
  hooks.ts` carries the closed name list the loader checks a `HOOK` against (it cannot import `vm/`,
  which imports it back), `vm/hooks.ts`'s `HOOK_CONTRACT` is the typed, documented half beside it
  (moved to the leaf `vm/hook-contract.ts` by #154 so `vm/program.ts` — where `queryHookStatics`
  actually lives — and `vm/hooks.ts` can both read the table without importing each other). Writing
  the 39 real bodies is `s7-02` through `s7-05`.
  **#154 built hook group A for real** — [Barrier] (`chooseable`), [Indestructible]'s battle-KO half
  (`koByEffect`, read directly in `vm/battle.ts` for the "as a result of battle" clause, since that
  is not an effect) and [Servant]'s power (`attrBonus`) — and found the contract's own `chooseable`/
  `koByEffect` example wrong while wiring the first real caller: a query hook's refusal already has a
  `ForbiddenAction` word (`beChosen`, `beKOdBySkill`, `beMovedBySkill`), so a body ends in `forbid`,
  folded straight into `prohibitions()`'s existing 20-14 reading (`vm/program.ts`) rather than the
  `immune` op #153 illustrated — `queryHookStatics` moved there in the same commit, since it needs
  the same recursion-guarded `condHolds`/`amount` every other interpreter reading does. Three
  candidates in `s7-02`'s own list moved to the hook they actually need once checked against the
  inventory: [Unique] to `playRefused` (group D), [Deflect] to `counterWindow` (group C), [Critical]/
  [Strike]/[Victory Strike] to `beforeDamage` (group C) — `docs/arena-backlog/s7-02-*.md`'s "confirm
  against the inventory... move it to the later one" working as intended. What #154 did **not**
  build, named rather than hidden: a `chooseCards` prompt has no `rejectedActions` reasoning on the
  rules engine at all (`chooseRejectionGap`, `scripts/verify/workflow.ts` — [Barrier]'s own legality
  is proven, its rejection *reason* is not), and [Indestructible]'s skill-KO half has no caller since
  the rules engine does not resolve a skill's `ko` yet (#146).
  **`s7-03` (#155) wrote group B's four tractable bodies**: [Field]'s onEnter (22-3, dropping the
  Field Extra already out), [Heroic]/[Villainous]'s afterSkill (22-35/22-36, fired from `moved()`
  itself for every other in-play card the entering card's owner controls, not folded into onEnter
  because the broadcast is about the *entering* card's play rather than something the receiving
  card's own hooks say about itself) and [Servant]'s activeStep (22-40, a query `chargeActivate`
  reads before switching a card to Active Mode — see #154 for the same keyword's attrBonus half).
  [Heroic]/[Villainous]'s printed self-negation is a known, named gap: a hook body's frame carries
  no `skillIndex` for `negate(what: own)` to read, so each fires once per other card played rather
  than once a turn. The rest of B's candidates — [Arrival], [Wish], [Successor], [Overlord],
  [Rejuvenate], [Z-Awaken] — are whole-keyword activations with no `do:` a `DEFINE KEYWORD` can
  carry yet (`s7-05`/#157's gap, not B's), and [Z-Stack]/[Revive] each need a per-card filter or a
  covering-set choice the language cannot ask for yet (`moved()`'s own comment names both).
  **`s7-04` (#156) found every one of group C's candidates blocked**, and fixed a real bug in the
  contract on the way. [Revenge]'s `battleEnd` body (22-9) is exactly the contract's own worked
  example (`ko(target: [attacker])`), and `vm/battle.ts`'s `battleEnd` step now fires it — on the
  guard alone, since the manual conditions it on "becomes the guard card" — but the body is not
  declared in `keywords.rules`, because the `ko` op it would run throws `NotYet` unconditionally
  (`vm/host.ts`: "a KO is a move a rule makes, and moves by skill are declared in #146 yet"), which
  would turn a Revenge card winning its own battle into a crashed game rather than a silent gap. A
  *query* hook like [Indestructible]'s `koByEffect` (#154) is safe to declare ahead of its own
  caller — inert until read — but an *effect* hook is not: it runs, and #146 is what it would need
  to run into. Firing `battleEnd` still uncovered a real ordering bug, fixed regardless of Revenge's
  own gate: the contract's own claim that `{special:"attacker"}`/`{special:"guard"}` "still resolve
  here, one step before `state.battle` clears" did not hold, because `battleEnd`'s own step used to
  null `state.battle` itself, synchronously, before the queued hook program the runner drains one
  loop pass later ever ran. The fix moved that clearing to `vm/flow.ts`'s own phase-pop, the point
  the battle phase actually runs out of steps, so the specials stay live for exactly as long as the
  contract says they do — ready the day #146 lets `battleEnd` actually fire something. The rest of
  C's candidates are deferred for their own reasons: [Blocker]'s effect is already correct and
  native (`vm/battle.ts`'s `applyBlock`) — routing it through `modifyAttr(attr:mode)`'s `switchMode`
  lowering would wrongly fire "rested by one of your skills" (1-10), which blocking is not; [Deflect]
  needs the Counter:Play window (`vm/host.ts`'s own `NotYet`, #150 opened only the battle-triggered
  one) and its own hook's `self` (a counter candidate) does not obviously name the card seeking
  immunity rather than the cards it would suppress — read again before writing; [Attack]/
  [Dual Attack] needs a per-card numeric "attacked this turn" count no primitive carries yet
  (`battledThisTurn` is a bare boolean); [Alliance]'s rested cards are a cost bound into the rest of
  its own printed skill, not a fixed body every [Alliance] card shares; [Critical]/[Strike]/
  [Victory Strike] read a life-damage amount or destination before `dealDamage` moves the card — a
  synchronous decision an `effect` hook's deferred queue cannot make in time; and [Ultimate]'s own
  moment is `onLeave` (group B), whose firing site is #155's, not this issue's.
  **`s7-05` (#157) wrote group D's one tractable body**: [Energy-Exhaust]'s `chargeLimit` (22-31),
  fired from `vm/host.ts`'s `moveTo` — the one *script-level* mover every `DO` program's own
  `moveTo` op runs through, the charge action's own included — rather than `vm/flow.ts`'s `moved()`
  (a *different*, native mover for a KO, a combo card leaving, a battle; #155's own hooks live
  there). The rest of D's candidates are deferred: [Offering]'s own moment is `onEnter` (group B,
  #155's firing site, not this issue's); [Evolve]/[Union]/[Over Realm]/[Swap] are whole-keyword
  activations with no `do:` a `DEFINE KEYWORD` can carry yet, and their Group D half (cost math,
  once-a-turn limits, legality checks) is part of the same unbuilt activation, not separable from
  it; [Spirit Boost] already resolves through the price grammar directly
  (`engine/compile/effects.ts`), needing no hook at all; and [Empower]'s "asked, not assumed" carry
  choice (owner's ruling, 9 Sep 2026) is a suspended prompt mid-play that no candidate hook's shape
  covers. **[Unique]'s own reassignment to `playRefused` (#154) turned out mistaken**, found while
  writing its body: the contract's own worked example (`count("a card with the same name" IN
  you.battle) >= 1`) does not actually read "the same name" as a self-referential comparison at
  all — `parseFilter` has no such phrase, so it silently parses to an empty, match-anything filter
  (checked directly: `names: []`), which would make the compiled rule forbid *every* play the
  moment any card is in the Battle Area. The real primitive for "no one may play a card sharing my
  name" is `forbid`'s own `sameNameAsSelf` (`engine/script.ts`), but it is a *targetless, board-wide
  [Permanent]-style static* — read through `statics()`'s own zone-gated `forbid` case (`!inPlayNow`
  continues), naturally matching "while a card with [Unique] is in play" — not a per-candidate
  query asked of the *hand card being checked*, which is what `playRefused` actually binds `self`
  to. Forcing it through `playRefused` reads the wrong card's own keyword entirely (a duplicate
  candidate would need to carry [Unique] itself, and the fact would test the candidate's name
  against its own, which is always true). [Unique] fits none of the fifteen hook points as
  contracted; left undeclared, named here rather than forced.
  **The interpreter is shared** (#142): `stepScript` runs on a `ScriptHost`
  (`engine/script-host.ts`) rather than on a `GameState`, `legacyHost` is that interface over the
  old state and `vm/host.ts` over the new one, so one `card_rules` row means one thing on both
  engines. What the rules engine reads a program *against* is `vm/program.ts` — the four readings
  `resolveSelector`, `resolveRef`, `amount`, `condHolds`, over declared attributes and the one
  filter adapter — and what outlives a step is `vm/effects.ts`: continuous effects with their
  `effect`/`effectEnded` beats, delayed effects at the five `DELAY_TIMINGS`, and a [Permanent]'s
  statics *read* rather than stored. A value is read through the layers its `DEFINE ATTRIBUTE`
  declares (`layers: [printed, rewrite, numeric]`, 9-9-1) and nowhere else. A running program is
  `state.programs`, a stack of frames the runner steps before any checkpoint (9-6-3), so a skill
  that stops to ask is storable mid-decision like everything else; the question is the contract's
  own `Prompt` and the answer arrives as the same `choose`/`chooseMode` action both engines take.
  What this engine has no half of — a KO, a play, a price, a battle — is a `NotYet` naming the
  issue that builds it, caught at the one program boundary in `flow.ts`.
  **The flag flips** (#149): `ENGINE_INFO.rules.available` is true and `playableEngine("rules")`
  no longer refuses. The plan's own exit bar for this — `arena:diff` clean over every saved game
  whose action log uses only Stage 5 actions, and over the harness and playthrough scripts — is
  the owner's to run and confirm against Neon; an agent session cannot (`arena:diff` needs the
  database this sandbox stays off), so it flipped the flag on the fuzzer and the engine-switch
  suite (`verify/vm.ts`) instead and said so in the PR rather than claiming the database check.
  What was a
  note-and-continue at the `NotYet` boundary above is now `endGame` with no winner: a card this
  engine cannot finish ends the *game*, not just that skill, because a note nobody reads is the
  wrong answer once a real player can reach it — the same `overReason` a concede or a win already
  puts on the board, so no `Snapshot` field moved for it. Not every mode: Claude's side of Sparring
  and Tournament (`ai/run.ts`, a hand and a deck read off `state.players[p]`) and a 1 v 1's
  hidden-hand masking (`beats.ts`'s `maskBeats`, `view.ts`'s `revealedTo`) both still read the
  legacy `GameState` field for field rather than either engine's shape generically, so `games.ts`'s
  `assertEngineForMode` and `matches.ts`'s `openMatch` refuse those combinations at creation — the
  rules engine plays **hot-seat only** for now, one level narrower than `playableEngine` alone
  answers. Outside the six engine calls the app was entirely legacy-shaped (`games.ts` read
  `state.turn`); most of it now reads only the field names the two state shapes share
  (`turn`/`phase`/`winner`/`overReason`/`prompt`/`cards`, plus `engines.ts`'s new `sideName` for
  `players[p].name`/`sides[p].name`), and `legacyState(value)` is the narrower seam left for the two
  reads above: a `rules` state reaching it throws `EngineMismatch` rather than being read field by
  field as `undefined`.
  **The battle is a sub-flow nested inside the Main Phase, not a phase of the turn**
  (`vm/battle.ts` + `dbs/battle.rules`, #150): `attack` sets `state.battle` and pushes a `battle`
  phase frame with the same `enterPhase` a turn phase uses, *without* answering the Main Phase's
  own question — the frame beneath keeps waiting exactly as `play`/`activate`'s `again: true`
  leaves it — and the moment the battle's nine steps (declare, the counter:attack window, the
  blocker window, offense, the offense combo offer, defense, the defense combo offer, damage, end)
  run out, `flow.ts`'s existing fallback for a phase with no declared successor and a frame still
  beneath it resumes reading "main", unchanged for that half. `battle` is declared but is
  deliberately **not** one of `DEFINE GAME`'s turn `phases:` — a battle is not the Main Phase's
  successor, it nests inside it — so `verify/rulesets.ts`'s phase completeness excludes it from
  the legacy `PHASES` comparison the same way the zone one excludes `under`/`play`.
  **`attack`, `block`, `counter` and `combo` are native rather than `DEFINE ACTION`s**: every other
  declared move is a player and at most one card (`vm/actions.ts`'s own limit), and an attack is a
  player and *two*; `block` and `counter`'s `Prompt` shapes (the legacy engine's own,
  `{kind:"blocker",candidates}` and `{kind:"counter",window,candidates}`) freeze a candidate list
  onto the question the moment it opens, which a live `FOR` selector does not do. `vm/flow.ts`'s
  `Work.run` gained its one addition for this (`"wait"`, a native step setting `state.prompt`
  itself instead of the declarative `step.prompt`/`PROMPT_ASKS` table), and `vm/index.ts`'s
  `apply()`/`legalActions()`/`rejectedActions()` merge the four in beside the declared moves —
  `promptAnswers`'s own precedent for chooseFirst/mulligan/payCost, extended rather than
  duplicated. A repeated combo offer clears the battle frame's own `asking` before asking again,
  standing in for `again:` at a prompt no declaration owns; a counter or combo that stops to ask
  which energy to rest is put back by `restoreNativePrompt` rather than the shared `payCost`
  re-entry's own `run()`-replays-`top.asking` trick, which only works for a declared move's.
  **What #150 built of damage, KO and combo, and what #151 still owns**: `dealDamage`/`koCard`
  are the generic primitives a battle needs — the declared `life` zone's top card to the hand, a
  card to its owner's Drop with the `ko` moment fired for both roles — named and shaped, not a
  stub, for #151's own `damage(side, n)` to extend; a spent combo card goes straight to the Drop at
  the end of the battle, since the Z-Energy it may become instead is #151's own
  `zEnergyFromCombo` (`NotYet` in `vm/index.ts`'s `DECLARED_BY`). Neither reads a keyword —
  [Critical], [Strike], [Indestructible], [Victory Strike], [Blocker] as a macro rather than a bare
  `hasKeyword` check, are Stage 7's. `vm/program.ts`'s `attacker`/`guard` `SpecialTarget`s and the
  `inBattle` condition read `state.battle` now (`case "redirectAttack"`/`case "negateAttack"` in
  the shared interpreter, and `vmHost`'s `battle()`/`setGuard()`/`negateAttack()`, were already
  primitive cases waiting only for a battle to read); `battled` (8-1-2-2's per-copy memory that
  outlives the battle, BT3-103's own trigger) is the one piece left in `NARROWER`, since `VmCard`
  carries no field for it yet. Two real bugs `arena-fuzz --engine rules` and a new `verify/vm.ts`
  §23 (staged against the same `E-NEGATE`/`V1`/`V-BLUE`/`BLOCKER` fixtures `battles.ts` uses, board
  fact matched against the legacy engine) found and fixed: a [Counter] played from an Extra card
  double-charged its price (`vm/activate.ts`'s `boundFor` already folds an Extra-in-hand's own play
  cost into a skill line's, 12-2-2's "using is playing" — a counter is never "played" that way, so
  it reads a skill's own orbs directly instead, `playCost(id) + orbTotals(id, sk)`'s shape); and a
  negated attack's jump to `battleEnd` (8-1-6-1) landed one step past it, leaving the battle open
  forever, because the runner's own fallthrough does `top.index++` immediately after a step's
  `run` returns without waiting — the jump lands one short of the target index now, so that
  increment lands exactly on it.
  **#151, on damage, life and Z-Energy: three of the four build items were already done, one gap
  was real and is now closed.** Combo's power reaching the fight is #150's own, already, and §23
  above already asserts the card's own contribution lands in `view.battle.contributions` on both
  engines — nothing to add. Z-Energy from a spent combo card is #146/#149's `playZ`, paying
  `dbs/costs.rules`'s `DEFINE COST zEnergy` (5-4), per the one comment on issue #151 itself ("PR
  #266 … brought this issue's third build item forward … the rest of this issue is untouched") —
  confirmed, not rebuilt. `damage`/`addLife`/`lifeDownTo` are not new primitives either:
  `stepScript` (`engine/script.ts`) has carried a full `case` for each since #142, and `vmHost`
  implements every `ScriptHost` method those cases call — none of them `NotYet` — so a card's own
  skill program reaching one of these ops was already possible before this issue, through the same
  shared interpreter the battle sub-flow's `dealDamage`/`koCard` do not even call (they move cards
  directly). **What was real**: `vm/flow.ts`'s `checkWins` only ran beside a *step's* own native
  work (`STEP_WORK[name].run`, which is what made the battle-native `dealDamage` path work
  correctly, checked directly rather than trusted) and once at `run`'s own opening — never beside a
  *program* draining through `stepProgram`, the path every [Auto]/[Activate]/[Counter] skill's `DO`
  block takes. A hand-staged board at 1 life with a queued `damage` op, `run` called once, showed
  it empirically: `state.winner` stayed `null` and the Main Phase's own question came back — the
  "compiles and reads plausibly, changes nothing" shape this programme has paid for before, this
  time at a checkpoint rather than in the compiler. One line beside `stepProgram`'s own call fixes
  it. **What stays out, on purpose**: `ops.rules`'s own header table already names why
  `damage`/`addLife`/`lifeDownTo` carry no `DEFINE OP` row — a macro's body can only give a
  selector's `TOP $n`/`count` a bare `number` (`rulesets/holes.ts`), while these ops' own `n` is an
  `amount`, X included; declaring the row today would expand every fixed-number card correctly and
  throw a `MacroError` on the first X-priced one, exactly the silently-wrong shape the file's own
  opening paragraph warns against. No row in that file is declared "for the fixed case, refused for
  X" — every row is either fully declared or not there at all — so there is no local precedent for
  a partial declaration, and #122 ("a selector that can count by an expression") is squarely where
  the fix belongs. `verify/vm.ts` §24 is the section for all of this: the WIN checkpoint checked by
  hand for both the battle-native and the program-driven path, `addLife`/`lifeDownTo` exercised the
  same way, and one assertion that the macro row really is still absent today so a future partial
  declaration fails loud rather than passing quietly wrong.
- **The rules language** (`src/lib/arena/lang/`, `docs/arena-rules-language.md`, since 9 Sep
  2026): one closed grammar for a card's rule — WHEN / COST / IF / THEN — printed and parsed
  from `OP_SCHEMA`/`COND_SCHEMA` plus the `SELECTOR_FIELDS`/`FILTER_FIELDS` tables in
  `lang/ast.ts`, so **adding an operation is still one interpreter case and one schema row**
  and the grammar follows. Client-safe; the workbench's *Show as text* imports it into the
  browser. The promise it rests on is an equality — `parse(print(x))` is `x`, over every op,
  condition, selector, filter, keyword, every compiled program and every drafter record, and
  the doc's own examples (`scripts/verify/lang.ts`, in `npm test`) — so the printer never has
  a choice of forms and the parser is the generous one. A filter is printed in its own words
  only when `parseFilter` reads them back *equal*; otherwise field by field. The `DEFINE …`
  grammar for `rulesets/*.rules` is in (eleven kinds, §3b of the doc); the referee's answers are
  a later stage, and the language is shared, not dialected.
- **A game is files, not code** (`src/lib/arena/rulesets/`, since 12 Sep 2026): `loadRuleset(files)`
  reads a game's `.rules` declarations into one `GameDefinition` — every name resolved against
  another declaration (a phase's steps, an action's price, a trigger's or a program's zone, a
  keyword's hook point), the schema's defaults applied (the printer drops none), and a `Vocabulary`
  of the closed word lists the language is checked against. Pure and **client-safe**: the text
  arrives as a generated constant (`dbs/files.ts`, written by `npm run arena:rulesets` from the
  `.rules` files beside it), so nothing reads a file at request time.
  `docs/arena-ruleset-spec.md` §3 says what each file declares and what the loader refuses.
  A zone's `place:` (default true) is what lets an interpreter build a side from the declarations
  without knowing a name: DBS declares `play` (the word for the three in-play areas, 9-1-3-1) and
  `under` (the pile hanging off one card, 23-2-2-2) as `place: false`, and programs still name both.
  `expandMacros` (`rulesets/expand.ts`) is the other half of the plan's second decision: a
  program written in the ops the cards use, lowered through the game's own `DEFINE OP`
  declarations to the primitives an interpreter runs — an op with no declaration passes
  through untouched, and the round-trip promise stays over the macro's *name*, never its
  expansion. `dbs/ops.rules` declares 20 of the thirty-one so far — its header says what
  each of the rest waits on (#137); `modifyAttr` reaches a card, a player and the battle
  in progress (#275).
  **The game's words are the only words** (`rulesets/words.ts`, since 12 Sep 2026): the
  language's parser, the workbench's chip editor (`optionsFor`), the referee's prompt
  (`effectLanguage`) and `validateRule` read the areas, durations, sides, keyword names and
  the moments a WHEN may name off that `Vocabulary` rather than each keeping a copy, so a zone
  deleted from `zones.rules` is gone from all of them at once — which is what
  `scripts/verify/rulesets.ts` asserts, by deleting one. `script-schema.ts` keeps its arrays as
  the **legacy engine's** side of the same list, which #136's completeness suite holds it to.
  `whenMoments()` is the game's triggers less the five counter windows: a `CounterWindow` is
  what a [Counter] answers in, and those five are the only names in `triggers.rules` a record's
  WHEN never says. `SPECIAL_TARGETS` is the one list with no `Vocabulary` field and no `DEFINE`
  kind that could declare it. `lang/index.ts` is where `parseRule`'s default vocabulary is
  bound, and the loader imports `lang/parse` directly — the one module that must not ask for
  the words it produces.
- **The specified-cost baseline is a column a person writes** (`cards.specified_cost`, issue #255,
  owner's decision of 13 Sep 2026): the deckplanet feed carries no cost orbs at all, so the coloured
  half of an X-cost card's price is entered by hand in the language's orb notation (`{u}{u}` = two
  blue) from the rules record on the workbench, or seeded by a migration on a ruling (0034 enters
  BT19-039 as `{u}{u}`). `cardDefFrom` reads it onto `CardDef.specifiedCost` through
  `parseSpecifiedCost` (`src/lib/arena/specified-cost.ts`), and nothing else in the engine changed.
  **The hazard:** `sync:catalog` upserts every card column, so the upsert `coalesce`s this one like
  `image_url` — remove that line and the next sync erases every entry. An entry has no feed to be
  checked against, so `staleSpecifiedCosts` gives it the check it can have at sync time (the card
  still prints an X cost and a specified-cost clause). Unknown stays unknown, said rather than
  filled: `specifiedCostUnknown` drives the record's *Incomplete — specified cost unknown* box, the
  probe's assumption, and `npm run arena:specified`'s per-card source (entered / ruling on file /
  still unknown). Only an X-cost card takes an entry; a fixed cost's orbs are filled by convention.
- **The record's WHEN is the engine's WHEN** (`skillAnswersTo` in `engine/triggers.ts`): an
  [Auto] skill's moment comes off `card_rules.trigger` (carried on `Script.trigger` by
  `rulesFor`), and only a skill with *no* record falls back to reading the printed text. The
  same precedent as the price of 8 Sep 2026, and the reason the text view's WHEN does
  anything at all. A keyword's own moments (§22) stay the engine's rule. The text view is the
  only editor for WHEN and COST — the chips have none and are not getting one — and the
  printed skill tag is read-only.
- **Arena UI** (`/arena`, `src/components/arena/`, `src/lib/arena/{games,view}.ts`): phone-first
  board, hot-seat or 1 v 1. A game is one `arena_games` row holding the seed, the action log (the
  reproducible source) and a state snapshot; `applyToGame` is the only writer, and it writes
  `WHERE version = <what it read>` so two devices racing cannot lose a move — the loser gets
  `StaleGame` and re-reads. The board is drawn
  from `boardView`, which hides what the player may not see (3-1-3), and every tappable thing comes
  from the engine's `legalActions`, so the UI knows no rules. `npm run arena:playthrough` plays a
  whole game through the database, and `npm run arena:coverage` reports how much card text the
  compiler reads. The board is `src/components/arena/stage/` — motion-first, cards fly between zones
  on `layoutId`, and a whole opponent turn is *played back* from the beat stream rather than
  arriving as a jump. Everything it renders comes from one `Snapshot`
  (`src/lib/arena/session.ts` + `snapshot.ts`), which `/api/v1` serves to the planned Android app as
  well, so no client ever evaluates a rule. **`docs/arena-client-contract.md`** is that contract and
  is read first; `docs/arena-ui-motion-spec.md` records the web board and
  `docs/arena-android-spec.md` briefs the Android app, which is not built.
  `docs/arena-battle-staging-spec.md` — the duel band and takeover battle stagings,
  the in-fight card inspector, and triggered combo/counter skills.
  `docs/arena-workflow-spec.md` is the current work brief for making every rule a
  visible workflow — read it before touching `legalActions` or the `Snapshot` shape.
  Phases 1–3 of it are built: `rejectedActions` beside `legalActions` (a `whyNot*` twin per
  predicate, never an edit to one), `taps.whyByCard`, `view.you.choices` for a search of a
  hidden zone, `prompt.min/max/step/cost`, `owner` on the `skill` beat — and on the web board the
  card action sheet, the refusal line, the search sheet, the step chip and the narration ribbon.
  **One rejection per card per action type — except an activation, which is one per skill line**
  (§3.2, amended 8 Sep 2026): a card prints up to nine of them and one being on the menu says
  nothing about the others. The two places that promise is asserted are
  `scripts/verify/harness.ts` and `scripts/arena-playthrough.mts`; they must say the same thing.
  `docs/arena-refusals-spec.md` is the brief that measured it, and holds what is still unworded.
  `src/lib/arena/wording.ts` is the only place a `Requirement` becomes a sentence,
  `src/lib/arena/narration.ts` the only place a beat does, and `src/lib/arena/effects.ts` the only
  place a rule in force (a continuous effect or a [Permanent]'s static) becomes a label and a
  duration — the card's `effects`/`permanents`, the `effect`/`effectEnded` beats and the side's
  `rules` all read from it. All three are pure and under `npm test`.
  `docs/arena-compiler-workflow-review.md` is the review that added the effect and [Permanent]
  surfaces, with the fixes it found; read it before changing what a card says about itself.
  **Skins** (`docs/arena-skin-spec.md`): the whole app has two, `anime` (default) and `night`,
  chosen by the `arenaSkin` cookie (Settings → Look, or the board's toggle) and applied as
  `data-skin` on `<html>` by the root layout; `?skin=` on a game page pins one board for one load.
  A skin is paint only: the theme's `--color-*` tokens are redefined under that attribute in
  `globals.css`, so every Tailwind utility follows. Keep it that way — no colour literals in
  components (the arena's are named classes painted from tokens), no size or logic behind a skin
  check, and card faces keep the night palette under both.
  **Pace** (`src/lib/arena/pace.ts`): how fast a turn plays back is a remembered preference —
  slow (default), normal, or step (tap *Next* between beats); while it plays, the prompt bar's
  headline is the narration sentence and a card from a hidden pile flies in as a ghost.
  **Whose move** (`docs/arena-hud-spec.md`, §1/§1.1/§2.1 built): `TurnStrip` states it full width
  above the ask, in colour, words and position at once. One rule holds it together — **everything
  the board says about who is acting reads `live.waiting`, never the `snapshot` prop**. The prop is
  used for exactly one thing, `useLiveGame`'s `active` argument, because a value read from `live`
  could go false before the first poll returned; collapsing those two expressions back into one is
  the bug that made the board say "Claude is thinking…" over the player's own prompt. The invariant
  is asserted in `npm test` and on every move of `arena:playthrough`. §2.2–§2.6 of that spec (merging
  the ribbon into the ask, ghost buttons for declines, the hint's own line, the settings behind `⋯`,
  the collapsed empty Battle Area) are **not** built.
  **Turn presence** (`src/lib/arena/lighting.ts`, `docs/arena-turn-presence-spec.md`): whose turn
  it is, readable at arm's length. The acting leader grows and gets a ring, the idle one dims, and
  the room takes the acting leader's **printed** colour — never one sampled from its art, so both
  clients derive the same room from `colors[0]` with no image pipeline. `turnVars` is the only
  place a turn becomes a colour; everything below it is CSS on the `.arena` root, and no snapshot
  field was added. Two rules to keep: the light is **never the only signal** (Settings → Turn
  lighting → *Off* must still leave the board unambiguous — that is the test, not a feature), and
  `.arena` must **not** become a stacking context, or the card sheet falls behind the app header —
  the room sits at `z-index: 0` and children are lifted at zero specificity instead.
- **1 v 1** (mode `versus`, `src/lib/arena/matches.ts`, `docs/arena-client-contract.md` §3.3): two
  people, two devices, one game. It needs two `app_users` logins — the seats are
  `arena_games.p1_user`/`p2_user` and `seatOf` reads `currentUser()`. Because each player picks
  their own deck and they are not at one keyboard, a 1 v 1 is opened as an `arena_matches` row and
  the *second* deck is what calls `startGame`, so there is never a half-built game. Three things
  this mode is the first to need, all now true of every mode: `buildSnapshot` takes an explicit
  `viewer` (the same game is drawn twice and each device stays in its own chair); `waitingFor`
  reads against that viewer, so `"opponent"` covers a person and the board's existing long-poll
  animates their turn with no change to it; and **`maskBeats` strips `Beats.art` to what
  `revealedTo` allows** — a real leak, since the queue carried the face of every card drawn. Only
  the face goes, never the beat, so the card still flies face-down. A 1 v 1 belongs to its two
  seats and to nobody else, over as well as playing (owner's decision, 7 Sep 2026): the board, the
  debug page and every `/api/v1` route answer `not_found` to anyone else. **With the app running
  open there is no identity and `seatOf` lets everything through** — the same hole `proxy.ts` has,
  no wider, and what keeps local dev and `arena:playthrough` working. The referee is on, as in
  Sparring and Tournament; there is no Claude opponent, and `aiPlayerOf` now *names* the two AI
  modes rather than excluding hot-seat, so a future mode cannot inherit one by accident.
- **Claude as the arena opponent** (`src/lib/arena/ai/`): `view.ts` builds what Claude may see —
  its own hand and decklist plus public state; your hand, life and decklist are never in the
  request. `opponent.ts` picks a number from the engine's legal-move list, so an answer can be
  wrong but never illegal, and takes the decisions that cannot go wrong (one legal move, the coin
  flip, the mulligan, which card to charge) without an API call at all. Two tiers, the owner's
  choice: Sparring on Haiku 4.5, Tournament sending the Main Phase and counter windows to Opus 5.
  The same module holds the **referee**, which answers with a program in the effect language when
  a card's text defeats the compiler. `run.ts` drives Claude's side and totals what it spent onto
  the game row. Caching note: the cached prefix is ~3,200 tokens, over Opus 5's 512-token minimum
  but under Haiku 4.5's 4,096, so Tournament games cache and Sparring games do not.
  **#162 put the "cannot go wrong" shortcuts on both engines.** `chooseMove`'s `freeChoice`/
  `chargeChoice`/`mulliganChoice` now read the board through the `zoneOf`/`catalogDefOf`/`leaderOf`
  seam (`engine-state.ts`, the same one `#161`'s probe uses) instead of `GameState`'s own shape, so
  a rules-engine game's coin flip, mulligan and charge decide themselves exactly as a legacy one's
  do — proven against a real `VmState` in `scripts/verify/ai-vm.ts`. A real Main Phase decision is
  not: `stateText`/`decklistText` still read `GameState` directly, so `chooseMove` refuses one by
  name (`"Claude's own move is not built on the rules engine yet (#162)"`) the moment the
  shortcuts run out, rather than reading `undefined` off `.players` several calls deeper — the
  same discipline `#161`'s `opening()` applies. `games.ts`'s `assertEngineForMode` now refuses only
  `versus` on the rules engine (the 1 v 1 hidden-hand masking is still legacy-only); Sparring and
  Tournament are let through, since a game that cannot yet make a real decision still ends
  correctly — `run.ts`'s `advance` catches the refusal the same way it catches any other AI error
  and reports it to the player rather than crashing. `arena_decisions` does not carry its own
  `engine` column (a schema migration this sandbox could not write without touching the shared
  Neon database Claude Code on the web is configured against here) — `/arena/[id]/debug` shows the
  game's own `engine` instead, which is exactly as much as the column would ever have said, since a
  game never changes engine.
- **Arena debug** (`src/lib/arena/ai/debug.ts`): every decision the server takes is
  written to `arena_decisions` — the prompt kind, the whole menu offered, what was chosen, whether a
  rule or Claude decided it, the model, tokens, cost and latency, plus the exact prompt text when
  the game has `debug` on. `/arena/[id]/debug` reads it back. What the compiler cannot read is
  **not** a second list: it is `card_rules.unread` on the rule itself, grouped at
  `/arena/rules/patterns` (`card_text_notes` was folded in and dropped, migration 0030). The
  referee bumps `times_seen` on the rule when the text actually comes up, and the program it
  produced is that rule's Claude draft, so the worked example is the record.
- **Rules are records** (`docs/arena-rules-workbench-spec.md`, phases 1-3 built 8 Sep 2026): the
  engine plays from `card_rules` — one row per skill per card face with the program, trigger,
  cost, hoisted condition, provenance (`compiler | claude | user`), state (`open | draft |
  confirmed | corrected`), unread clauses, plain reading and version — and **never compiles
  card text at game time**. That last claim became true of the *price* too on 8 Sep 2026: the
  cost before the colon is read off `card_rules.cost` (carried on `Script.price`, filled by
  `rulesFor` from the row and by `compileCard` from the text), so a skill with no record has an
  **unknown** price rather than a free one. `src/lib/arena/rules-store.ts` is the only module that touches the
  table; `src/lib/arena/draft.ts` is the only one that calls the compiler in production
  (`draftCards`, and `reviewOpenRules`, which asks Claude about what the compiler left open,
  within the `arena.reviewBudget` setting). A row a person confirmed or corrected is never
  rewritten by a script: the compiler's newer reading lands beside it as `compiler_diff`. The
  effect language is defined once, in `OP_SCHEMA` and `COND_SCHEMA` (`engine/script-schema.ts`): the
  validator, the plain reading, the referee's prompt and the workbench's chip editor read them, so
  a new operation or condition kind is one interpreter case and one row. The workbench has three
  worklists over the same records: `/arena/rules` the cards in the decks the arena can play,
  `/arena/rules/all` the whole catalog (filtered by set, source, mechanism, pattern or text, 200
  rows a page), `/arena/rules/patterns` the same rules grouped by the wording that produced them.
  The record is WHEN / COST / IF / DO as chips — reorderable, nested programs, modal options and
  conditions included — with a JSON view of the same program, Confirm / Correct by hand / Explain
  to Claude / does nothing, and history. **Confirm all drafts in view** confirms exactly what the
  *filter* matches (not the rows on screen); the rows it moved are kept on the `arena_feedback`
  row as `{id, version}` pairs so **Undo** puts back exactly those and leaves anything edited since
  alone. `npm run arena:draft` fills the table; the catalog sync drafts every new or changed card.
  A rule with no steps and a `keyword:` pattern is not blank — the keyword is the rule the engine
  plays, and the record says which, from `glossary.ts`.
- **The probe** (`src/lib/arena/probe.ts`, the record's right-hand pane, phase 3 of the same
  brief): a record says what the engine *will* play, a probe says what it *does*.
  `probe(rule, scenario)` builds a game with `createGame` and two minimal decks, stages the one
  board that rule's moment needs, plays the move under test, answers every prompt by a fixed
  policy, and reports **Input / Applied rule / Result / Assumptions** with a digest over the
  conclusion. Pure — no database, no network, and **no compiler**: the cards it stages around the
  rule carry hand-written programs, so `draft.ts` stays the only module that compiles text. It
  invents no wording either: the log is `toBeats` → `narrate`, a refusal is `wording.sentence`, a
  question is `view.ts`'s own `questionFor`, and an *assumption* is only ever a `note` in the
  program, a note the engine logged, a clause the compiler could not read, or the glossary's
  `engine` line for a keyword it plays only partly. Ten families (`familyOf`) cover the catalog's
  shapes with two or three edge boards each — no legal target, skills negated, the opponent's
  turn, the card in hand; the rules whose moment the engine does not know get `none`, whose
  honest answer is that sentence. **The board is built in the card's favour and says so**: the
  Leader shares the card's colours, characters and traits, a keyword gets a body its own
  description matches, and each of those is a line in Input. A [Permanent] and a keyword are
  *read* rather than resolved — power with and without the rule, the keywords in force, and
  whether the opponent's KO skill was offered the card at all. Confirming a rule keeps its probe
  on the row (`card_rules.probe`), so `npm run arena:reprobe` after an engine change lists the
  rules whose answer moved: the regression suite the rules never had. `npm run arena:probe --all`
  sweeps the catalog in ~70 s.
- **Explaining a card** (`src/lib/arena/ai/clarify.ts`, from any record on the workbench): you say
  what a card does in plain words; Claude returns a program in the effect language, saved as the
  card's **draft** rule (`source: claude`, for you to confirm), and a markdown work item for
  teaching `compile.ts` the *wording*, kept as `card_rules.brief` and shown on the record and on
  its Patterns group. The referee's mid-game rulings land the same way, so nothing Claude decides
  is invisible. The program fixes one card; the work item is what fixes every card phrased the
  same way. The two are not the same fix and the page says so.
  **A ruling that arrives in conversation goes to the same row, not into a commit message**:
  `npm run arena:rule -- <cardId> [--skill N] [--clause "…"] "<the ruling>"` writes it to
  `card_rules.explanation` (`--list` reads them all back). Unlike the page's box it asks
  Claude for nothing — it records what the owner said, and the code change is then made
  deliberately against every card sharing the wording. Owner's instruction, 7 Sep 2026: when a
  ruling is given in chat, store it there first, then wait to be asked for the code change.
