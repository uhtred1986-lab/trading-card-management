# The arena's instruments — what each one proves, and how to use it

Written 9 Sep 2026. Companion to `docs/arena-next-session-prompt.md`, which says
*what* to work on; this says *how to know whether you broke something*.

There is **no test framework**. Every check is a plain `assert` script run with
`tsx`. That is deliberate and worth preserving: a check is a paragraph of prose
followed by an assertion, and the prose is the point — most of these scripts
read as an argument about the rules with the assertion as its full stop. Extend
them in the same style.

---

## 1. The two measurements

These are not tests. They are **instruments**: they tell you what the compiler
currently reads, so you can see what your change did. Nothing else in the
project answers that question.

### `npm run arena:readings`

Prints, for all ~13,500 skills in the catalog: the **printed** card text and
what the compiler **reads** it to mean, in words. No database, no network, ~8 s.

```
BT7-110#0 counter:play
  printed: [Counter: Play] … choose all Battle Cards with energy costs of 2 or less …
  reads:   … choose all card with an energy cost of 2 or less in each player's battle …
```

`-- --grep "<wording>"` narrows to one wording; `--unread` adds the clauses that
did not read at all.

**This is the only check on a clause that compiles and reads wrongly**, which is
the failure mode that matters (see §3 of the next-session document). Coverage
numbers cannot see it: a clause that reads the wrong thing is still a clause
that compiled.

**How to diff it.** Key by card and skill, never line by line — the file is
40,000 lines and any insertion shifts everything after it:

```
key() { awk '/^[A-Z0-9]/{k=$0} /^  reads:/{print k" || "$0}' "$1" | sort; }
diff <(key read-before.txt) <(key read-after.txt)
```

**How to sign it off.** Every moved line, by hand, against the printed text —
until there are too many, at which point prove a **property** and then still
check one named card by hand. Properties that have been used and have caught
real problems:

- *"Every moved line differs from its predecessor only by the phrase I added."*
  Strip that phrase from both sides and assert equality. Used for a change that
  moved 120 lines; it found none of them had changed in any other way.
- *"Every surviving reading is a strict prefix of the one it replaced."* Used
  for a change that refused the tail of 270 skills; 268 held, and the two that
  did not were modal options where a *branch* lost its tail — the same property
  one level down.

**The trap.** An instrument can be blind to the change it is measuring. A new
`Selector` field once compiled correctly but had no words in `describeSelector`,
so the first readings diff came back clean *by accident*. If your diff is
suspiciously empty, check that the reading can express your change at all.

### `npm run arena:tally -- --misses 100000`

The gap set: every clause shape the compiler could **not** read, with counts,
plus headline coverage.

```
cards 6493, fully compiled 4678 (72.0 %)
unread clauses 3455 over 2416 distinct shapes
```

`-- --show "<a wording>"` prints the actual cards behind a shape — **use it
before believing any count**, including one in a document. Needs the network
(it fetches the live catalog) and **fails transiently**: a result of about
fourteen lines is a fetch error. Three separate work streams have been fooled by
an intermediate run whose deltas did not reproduce on a clean re-fetch.

**How to diff it.** Strip the counts so a shape that merely changed frequency
does not look like a new one:

```
strip() { sed -E 's/^ *[0-9]+ +//' "$1" | sort; }
diff <(strip gap-before.txt) <(strip gap-after.txt)
```

Shapes that **appear** matter as much as shapes that vanish — an appearing shape
is usually a clause you correctly refused. A falling coverage number is often
the change working.

---

## 2. `npm test` — what it actually runs

Three scripts, in order. All three must pass; none needs the network.

| script | needs | proves |
|---|---|---|
| `scripts/verify-rules.ts` | nothing | the pure rules helpers (deck legality, reservations, scan matching) |
| `scripts/verify-arena.ts` | nothing | the arena — fourteen suites, below |
| `scripts/verify-db.mts` | nothing (PGlite in memory) | the migrations apply, and the reservation rules hold against real SQL |

`verify-arena.ts` imports fourteen suites from `scripts/verify/`, each on its
own, and reports **pass / skipped / failed per suite** rather than stopping at
the first — only a real failure exits non-zero. Knowing which one failed (or
skipped) tells you what you broke:

- **`harness.ts`** — the foundation the others build on: synthetic cards, a
  staged game, and the assertion helpers. Not a suite of its own so much as the
  vocabulary. **Read this first** if you are writing a new check. Since #152 it
  is two vocabularies in one file: `game()`/`arena()`/`play()`/`find()`/
  `labels()` still read `GameState` directly and still narrow every suite that
  imports them (through `legacyState`) to legacy-only — that half is unchanged,
  and every suite below except `battles`/`workflow` still uses it. Beside it is
  the **state interface**: `arenaG`/`playG`/`findG`/`labelsG`/`gameG`/
  `assertDisjointG`/`addEffectG`/`placeUnderG`/`powerOfG`/`rejectedActionsG`, and
  the field-level seam `zoneOf`/`leaderOf`/`unisonOf`/`energyMarkersOf` for the
  one thing the two engines keep under a different shape (`players[p][area]`
  against `sides[p].zones[area]`; a scalar Leader/Unison against a single-entry
  zone). Everything else — `prompt`, `battle`, `winner`, `overReason`, `phase`,
  `turn`, `turnPlayer`, `effects`, and `cards[id].{mode,markers,under,flipped,
  faceUp,hidden,battledThisTurn}` — is the same field on both `GameState` and
  `VmState` and is read directly off `EngineState`, no seam needed. Only
  `battles.ts` and `workflow.ts` use the `G` half today; a third suite reaching
  for it finds the vocabulary already there rather than growing its own copy of
  `verify/vm.ts`'s original local `stage`/`atMain` (§23/§24, still there,
  unchanged — the two are allowed to diverge in staging *strategy*, see the
  state-interface section's own header comment: the legacy branch of `arenaG`
  is `arena()` unchanged, real `move()` and all; the rules branch is a raw
  relabel-and-splice, no moment fired, the same simplification `vm.ts`'s own
  `stage` always was).
- **`text.ts`** — how card text is read before any game exists: the skill
  parser, keyword recognition, the errata corrections.
- **`setup.ts`** — the seed and game setup (§6-2). A failure here usually means
  determinism broke, which invalidates every other suite.
- **`battles.ts`** — combos, blockers, counters, the keywords that decide a
  battle. **Runs on both engines since #152.** On `--engine rules` every case
  is a real assertion except the ones a Stage 7 keyword body still owns
  ([Awaken], [Critical], [Dual Attack], [Indestructible], [Revenge], [Unique],
  [Evolve], [Z-Stack]) — each prints `skipped case` by name, citing the
  `docs/arena-backlog/s7-*.md` hook-group doc that builds it, and the suite
  still reports `ok`. Proves, on the rules engine as much as the legacy one:
  combo power deciding a battle and combo cards reaching the Drop, [Blocker]
  redirecting an attack and resting, [Counter: Attack] negating one before the
  Offense Step, what `view.battle` says about counters and contributions,
  8-1-2-1/8-1-2-2's memory of having battled (`VmCard.battledThisTurn`, #152),
  Unison play/growth/the missing Defense Step against one, 23-2's placing a
  card under another including the two piled-card cases (23-2-5/23-2-6, also
  #152 — see `vm/zones.ts`'s `moveCard` and `vm/host.ts`'s `placeUnder`), and
  the WIN checkpoint on battle damage, deck-out and concession. `verify/vm.ts`
  §23/§24 remain the place a *new* rules-engine battle fact is proven first,
  against the oracle, before a suite meant to run unchanged on both engines
  takes it for granted.
- **`compiler.ts`** — the largest: what a printed line becomes, and what the
  interpreter does with it. Most compiler changes that break something break
  here.
- **`keywords.ts`** — the §22 keywords as engine rules, and a good deal of
  general §9/§20 mechanism besides. **Runs on both engines since #158**,
  through the same state-interface layer `battles.ts`/`workflow.ts` use
  (`arenaG`/`playG`/`findG`/`labelsG`/`actsG`/`canActivateG`/
  `rejectedActionsG`, `zoneOf`/`leaderOf`/`unisonOf`). Two readers this suite
  needed that neither of those had reached for yet are on `harness.ts`
  alongside them: `hasG`/`skillNegatedG` (a keyword or a skill in force,
  off `vm/program.ts`'s `hasKeyword` and `vm/effects.ts`'s `skillNegated`)
  and `masterOfG` (3-1-6, bound to the `GameDefinition` the way `powerOfG`
  already is); `stageMoveG` is a new test-only fixture rig beside
  `stageOnRules`'s own, for relocating a card into a zone as pure setup
  (no event, no moment) where `move(CTX, …)`'s reason and event log are not
  what the case is testing. Four gate functions name what is still skipped
  on `--engine rules`, each printing the reason rather than doing nothing:
  `keywordGap` (a keyword's own `DEFINE KEYWORD` carries no `HOOK` body for
  what the case needs — most of the 39, `docs/arena-backlog/s7-0{2,3,4,5}-
  *.md`), `staticGap` (a [Permanent] reads to a static kind
  `vm/effects.ts`'s own `DEFERRED_STATICS` names as unread — `altCost`,
  `payWith`, `immune`), `replaceGap` (the 9-10 family: `vm/host.ts`'s
  `replacementsFor` answers `[]` unconditionally until #146 gives a
  skill-driven KO something to replace), and `notYetGap` for everything else
  found empirically rather than guessed at from a doc — a skill-driven KO
  (`h.ko`, #146), the `addSkip` queue (#145), an X price on a skill line
  (`actions.rules`'s own gap), and several real, individually-diagnosed
  gaps this porting pass turned up and none of the other suites had reason
  to exercise: [Spirit Boost]'s own keyword-shaped marker amount not
  reaching the cost planner though the price grammar is declared; two
  trigger-moment wordings ("switched to Rest Mode by one of your skills",
  "when you use a card in a combo") that do not yet pend on this engine;
  `copySkills` granting a keyword and an [Auto] but not the copied
  [Permanent] itself (20-18); an [Activate: Battle] skill not reaching the
  menu from hand during the combo step; `control` (20-9) not preserving a
  card's markers across the move; and a [Permanent]'s live per-step skip
  condition (`stepSkippedByPermanent`, distinct from `addSkip`) not read by
  the battle sub-flow at all. Every one of these was found by running the
  ported case and reading what actually happened, not by trusting a claim
  already on file — one of them (Spirit Boost) contradicted an earlier
  note that it needed no hook at all. The suite still reports `ok` on both
  engines; what moved is *how much of it* is a real assertion on `rules`
  today, printed at the top of the run.
- **`readings.ts` / `wordings.ts`** — the wordings learned after the keywords.
  Together ~3,000 lines, and the closest thing to a regression corpus for the
  compiler.
- **`workflow.ts`** — every rule as a visible workflow: what is refused and why,
  in the words a client shows. Asserts the "one rejection per card per action
  type" promise. **Runs on both engines since #152**, mostly — three cases are
  Stage 7 keyword gaps ([Unique], [Swap], [Barrier], `keywordGap`), and the
  porting pass found four gaps that are not keyword-shaped at all, each named
  at its own call rather than hidden beside the keyword ones: `combo`/
  `counter`/`block` are native moves (`vm/battle.ts`) and `rejectedActions`
  never grew their `attackRejectedActions` twin (`nativeRejectionGap`); a
  counted prohibition's `uses` budget is read but never spent on this engine
  (20-14, `forbidUsesGap`); `vmBoardView` does not build `you.choices` for a
  deck-search prompt or `them.rules` for a turn-scoped prohibition yet
  (`viewGap`, Stage 8's "primer/prompts/view"); and one case (`PRICED`)
  regression-tests a legacy-only historical bug fix with no rules-engine
  analogue at all (`legacyHistoryOnly`). Every exact **label** string
  (`"Play BIG (5)"`, a `LegalAction.cost.describe`) is checked on the legacy
  engine only (`assertLabelOnLegacy`) — the rules engine's own labels are a
  generic builder over `actions.rules`' declared `label:`, and matching the
  legacy engine's bespoke wording word for word is Stage 8's, not this suite's.
  The suite still reports `ok` on both engines; what moved is *how much of it*
  is a real assertion on `rules` today, printed at the top of the run.
- **`contract.ts`** — the beats and the snapshot both clients render.
- **`language.ts`** — the effect language as one table, the drafter's records.
- **`lang.ts`** — the round-trip promise: `parse(print(x)) === x` over every op,
  condition, selector, filter and the language document's own examples.
- **`rulesets.ts`** — the loader's own guarantees (a dangling reference, a
  duplicate declaration, an unknown hook point, each a pointed `LangError`)
  and, once the DBS `.rules` files exist, that the ruleset declares exactly
  what the legacy engine's unions declare — a zone, a phase, a trigger, a
  keyword or a card attribute the definition forgot (or invented) fails here,
  by name, before Stage 4 ever fails to play the card that needed it. Every
  completeness check prints `skipped: … not yet written` and passes trivially
  while its file is still empty, so this suite stays green through #133–#135
  landing one at a time.
- **`probe.ts`** — a rule tried on a board built for it, compared against stored
  digests. That comparison needs every earlier suite to have added its own
  cards to `DEFS`, so it only runs when `ENGINE` is `legacy` — see below.
- **`vm.ts`** — the engine switch itself: `engineFor` resolves both ids, the
  rules engine deals the same opening board as the legacy one from the same
  seed, and every call it cannot make yet throws `NotYet` naming the issue that
  builds it. It is also where the rules engine is held to the older one move for
  move, because the harness's own fixtures cannot stage a rules game yet
  (`EngineMismatch`, below): §16 the turn and the declared moves, §17 the
  prices against `planPayment`, §18 the play family — the same board built on
  both engines, then the same play, Unison play and Z-card play asserted event
  for event, and every play refusal compared by `Requirement` *and* by the
  sentence `wording.ts` makes of it — and §19 the activation, which is the same
  comparison one level down: a card's skill *lines*, each offered or refused on
  its own, the same first `Requirement` per line on both engines, three lines
  answered three times, and `contract/fixtures/activate.json`'s own board played
  to the same events and the same rules in force. Runs the same regardless of
  `--engine`, on purpose (below).

### `--engine legacy|rules` and `npm run test:rules`

`scripts/verify/harness.ts` reads `--engine` off the command line (default
`legacy`) and exports the resolved `ENGINE`. `npm test` never passes it, so
`legacy` is what it has always run. `npm run test:rules` is
`tsx scripts/verify-arena.ts --engine rules` — the same fourteen suites, on
the rules engine.

`vm.ts` and `rulesets.ts` name `legacy` and `rules` explicitly rather than
reading `ENGINE` (it is the suite proving the switch, so it cannot depend on
which side of the switch happens to be selected; `rulesets.ts` touches no game
at all) and both run the same, and are expected to pass, whichever engine
`--engine` names.

**Two suites, `battles.ts` and `workflow.ts`, run for real on `rules` since
#152** — see their own entries above — through `harness.ts`'s state-interface
half (`arenaG`/`playG`/… ). What a case in either of them cannot yet prove on
`rules` is a `skipped case`, printed by name with why, rather than a whole
suite reading `skipped`; the suite itself still reports `ok` as long as
nothing it *can* prove fails.

Every other suite still builds its board through the legacy-only
`game()`/`arena()`, so on `--engine rules` it hits one of two named errors
immediately rather than crashing partway through an assertion: `NotYet` (a
call the rules engine does not implement yet, e.g. `apply`, per
`src/lib/arena/vm/index.ts`) or `EngineMismatch` (`game()`/`arena()`/`play()`
narrow every state through `legacyState`, so a state the rules engine dealt is
named rather than read as `undefined`). `verify-arena.ts` prints either as
`skipped`, with the reason, and keeps going. What "green on rules" means
therefore changes stage by stage — there is nothing to fix by making a suite
"pass" before its dependency lands, and porting a suite past `EngineMismatch`
is each suite's own issue to take up, the way #152 took up these two:

| stage | what's built | `test:rules` today |
|---|---|---|
| through #151 (Stage 6, the rules engine plays a battle) | zones/attributes, the turn, costs, the play family, the battle sub-flow, damage/life/Z-Energy/WIN | `vm`, `rulesets`, `text`, `deck-api` pass; `probe`'s fixture digest is skipped (needs every suite's cards); everything else is `skipped` with `EngineMismatch` |
| #152 (this doc's own build item) | the state-interface half of `harness.ts` | `battles`, `workflow` pass too, real assertions with named `skipped case`s for what Stage 7's keywords still own (plus a handful of real, non-keyword gaps `workflow.ts`'s own entry above names) |
| #158 | `keywords` ported onto the same state interface | `keywords` passes too, real assertions with named `skipped case`s — most of them Stage 7 keyword gaps, the rest real gaps this porting pass found and diagnosed on its own (`keywords.ts`'s own entry above names each) |
| Stage 7 (`docs/arena-backlog/s7-*.md`) | keyword bodies over four hook groups | the `keywordGap` cases in `battles`/`workflow`/`keywords` close one by one; `readings`/`wordings` are the suites most of Stage 7's own remaining value lands in, and are candidates to port next |
| Stage 8 | words from config, `primer`/`prompts`/`view` | `workflow.ts`'s `assertLabelOnLegacy`/`viewGap` cases close; `contract` becomes portable |
| Stage 9 (#165) | the rules engine is the default | `test:rules` folds into `npm test`, or vice versa |

Making a suite actually pass on `rules` before its stage lands is out of
scope for the tooling itself — `test:rules` exists to say honestly which
suites do and which do not, not to make them.

### Two things that will bite you

**A failing test is sometimes the bug, not a description of it.** Three
assertions have been rewritten this year because they encoded the *old*,
incorrect behaviour — each expected an effect to survive its own refused
condition. If a test fails and the new behaviour is more faithful to the printed
card, change the test and **say why in the commit**.

**`lang.ts` samples, it does not enumerate.** Adding a new shape to a union
(`Amount`, `Selector`, an `Op` field) gets **no round-trip coverage unless you
add it** — `sumPower` and `handUpTo` sat uncovered for months for exactly this
reason. A change can pass typecheck, lint, test and build while the new shape
has never been printed or parsed once.

---

## 3. `contract:emit` — the generated fixtures

`npm run contract:emit` regenerates `contract/fixtures/*` and
`contract/probe-digests.json`. These are the contract the planned Android client
reads, and the probe digests are a regression corpus for card rules.

Run it when you change a harness card, an `OP_SCHEMA` row, or what the referee
is told. **Review the diff** — expect exactly the cards you touched. One digest
of ~145 changing is normal for a single card's behaviour; twelve files changing
with *empty* diffs is the CRLF artifact (fixtures are written LF, checked out
CRLF): confirm the content is unchanged, then `git checkout -- contract/`.

In a merge, do **not** hand-merge these files — take either side and re-run
`contract:emit` on the merged tree.

---

## 4. The engine checks

### `arena-fuzz.mts` — the crash net

```
npx tsx --env-file-if-exists=.env.local scripts/arena-fuzz.mts 40
```

Plays N random complete games and reports crashes. **40 is the standing gate**;
use 200 for anything touching the movement, payment or flow machinery. It proves
only that nothing threw — it says nothing about correctness — but it is the
cheapest possible check that the engine still runs to completion, and it has
caught real breakage. Takes `--engine legacy|rules` (default `legacy`). On
`rules` it plays whole games through that engine's own menu and checks the same
invariant after every move (every card in exactly one place, 3-1); the moves it
has are `pass`, `endMain` and `concede` (#140), so every game ends the way a
game of nothing but passing ends — on a deck-out, around turn 72. A run that
reports games *dealt* rather than won is a run on a build from before #140.

### `arena:diff` — the oracle

Replays a saved game's action log from its seed and compares with the stored
row. This is the strongest correctness check available, because a game is
reproducible from seed plus actions: if a replay diverges, behaviour changed.
Use it for **any engine change**. It is not part of `npm test` because it needs
a database and real saved games. Takes `--engine legacy|rules` to replay on an
engine other than the one the game row was played on — the oracle check between
the two engines (`npm run arena:diff -- <gameId> [--engine legacy|rules] | --all`).

### `arena:probe` / `arena:reprobe`

A probe builds a game around one card's rule, stages the board its moment needs,
plays the move, and reports Input / Applied rule / Result / Assumptions with a
digest over the conclusion. `arena:reprobe` re-runs every stored probe and lists
the rules whose answer *moved* — the regression suite the rules never had.
Both take `--engine legacy|rules` (default `legacy`), threaded into
`src/lib/arena/probe.ts`'s own `engineFor` switch; `probe()` never throws, so a
rule tried on an engine that cannot yet stage or play it comes back with
outcome `error` rather than crashing the sweep — which is what running either
of these on `rules` mostly reports today, and is itself the honest reading.

**Its blind spot is worth knowing**: the staged board is built in the card's
favour, and it only stages what it has been taught to stage. It staged no
markers at all until someone added that, so it could not distinguish a working
marker rule from a broken one. If you add a mechanism, ask whether `stage()`
knows how to set it up.

### `arena:playthrough`, `arena:coverage`, `arena:draft`, `arena:vs`

`playthrough` plays a whole game through the database (integration, needs a DB)
and, like `arena-fuzz.mts` and `arena-diff.mts`, takes `--engine legacy|rules`
(default `legacy`) to choose which engine plays the game — through
`startGame`, so since #149 `--engine rules` plays a **hot-seat** game rather
than refusing outright; `arena:vs`'s default `sparring` tier still refuses
(`assertEngineForMode`, `games.ts`) because Claude's side is not built for the
rules engine yet — pass `hotseat` as its tier to run it there. Both scripts'
own board-inspection helpers (`boardView`, the audits) still read the legacy
`GameState` directly rather than through `engineFor`, narrowed with
`legacyState` for exactly that reason — a rules-engine game past what
`startGame` allows is a clear `EngineMismatch`, not a crash inside `boardView`.
`coverage` reports how much card text the compiler reads; it accepts and
validates `--engine` for consistency with the rest of the tooling, but it
never creates a game, so the flag changes nothing about its output — the
compiler it measures is the one either engine's rows come from (`draft.ts`).
`draft` compiles the catalog offline into `card_rules` drafts — **the only
module that calls the compiler in production is `draft.ts`**; the engine
reads rows.

### `arena:specified` — what the feed does not say

```
npm run arena:specified            # the report, loudest cards first
npm run arena:specified -- --all   # every X-cost card with no baseline
```

Needs the network; the database is optional and changes what it can say. A play's price has two halves — the total, and
the **specified cost**, meaning how much of that total must be paid in a named
colour. The engine fills a fixed cost's orbs by convention (`specifiedCostOf`:
one per colour, capped by the total) and **refuses to invent them for an X
cost**, because the catalog carries none: this script is that refusal, checked
rather than asserted. It reads the deckplanet feed the catalog sync imports,
prints every distinct value of the cost field so the claim can be seen, and
lists the cards left without a baseline — the seven printing a specified-cost
clause first, since those have a rule that reads correctly and changes nothing
(BT19-039, BT19-040, BT15-063, BT20-118, P-673, P-600, BT25-004). Run it before
believing a specified-cost rule is inert for any other reason, and run it again
if a future feed starts spelling orbs in the cost field, which is the one thing
that would turn this refusal back into a parsing job.

**Where a baseline is known, it was entered by hand** (issue #255, owner's
decision of 13 Sep 2026): `cards.specified_cost`, one column on `cards`, in the
language's orb notation (`{u}{u}` = two blue), written from the rules record on
the workbench (`/arena/rules` → the record's *specified cost* box, which reads
*Incomplete — specified cost unknown* on every X-cost card without one) or
seeded by a migration on a ruling (0034 enters BT19-039 as `{u}{u}`). The
column reaches the engine through `cardDefFrom` → `parseSpecifiedCost`
(`src/lib/arena/specified-cost.ts`) onto `CardDef.specifiedCost`; nothing else
was taught anything. **The hazard the column carries:** `sync:catalog` upserts
every card column, so the upsert `coalesce`s this one like `image_url` — an
entry survives a sync by that line and nothing else, and the sync warns about
an entry whose card no longer prints an X cost or a specified-cost clause
(`staleSpecifiedCosts`, the self-check errata's `unmatchedCorrections` cannot
be here, since the feed has nothing to compare against). With `DATABASE_URL`
set (`.env.local` is read), the report says per card where its baseline
stands — *entered* with the orbs and their reading, *ruling on file* when a
rule of the card carries an explanation mentioning the specified cost
(`npm run arena:rule`), or *still unknown* — and lists the stale entries.
Without it, it says so and reports the feed alone.

The probe has the matching board: a [Permanent] that relaxes its *own*
specified cost from hand (BT19-039 and the six phrased like it) gets a
`permanent:reduced` scenario — the card in hand, the condition's card staged,
and one energy of each colour the relaxed requirement still demands — whose
reading says whether the play is legal with the rule *and* whether it would
have been refused without it, naming the colour. On a card whose baseline is
unknown every board of every rule carries the assumption that the engine
demands no colour for it, so a lenient price is never mistaken for the card's.

---

## 5. Recording a ruling

```
npm run arena:rule -- <cardId> "<the ruling>"      # writes card_rules.explanation
npm run arena:rule -- --list                        # read them all back
```

When a rules question is settled in conversation, **it goes here first** and the
code change is made afterwards, deliberately, against every card sharing the
wording. This is not bookkeeping: one recorded ruling *corrected its own first
version*, and only the row shows that. Check `docs/rules/rulemanual.txt` and
Bandai's Q&A before asking a human, and validate the answer against them
afterwards — both recorded rulings were, and the manual confirmed one and
sharpened the other.

---

## 6. Best practices, learned the expensive way

1. **Measure before you edit.** Both instruments, every time. A change whose
   readings diff you did not take is a change you cannot defend.
2. **Prefer unread to wrongly read.** A gap costs tokens; a wrong reading loses
   games. Refusing a family is a legitimate outcome, and the coverage number
   going *down* can be correct.
3. **Prove a property when the diff is large, then check one card by hand.**
   Neither alone is enough — the property can be satisfied by a broken change,
   and one card cannot speak for 270.
4. **Verify a claim before repeating it**, including from a colleague's report
   and including your own earlier documents. Counts have been overstated by 6×;
   a card offered as a *control* was itself broken; a scope document once said a
   feature did not exist when most of it did.
5. **Scope guards narrowly.** `splitClauses` is the most load-bearing function
   in the compiler; several fixed bugs came from changing how it cuts, and one
   attempt to generalise a stale-antecedent guard silenced ~30 unrelated shapes.
6. **When a mechanism produces its third bug, stop patching it.** Write the
   structural fix up as its own piece of work — `docs/arena-side-scope.md` is
   that document for the side test, written at exactly that point.
7. **Never write engine source through `node -e`**: `\b` in a shell-quoted
   string becomes a backspace and silently kills a regex.
8. **Touch the compiler, update `glossary.ts`.** Including when what you did was
   *refuse* a family — `glossary.ts` is part of the compiler, not documentation
   about it, and a description that has quietly become untrue is worse than no
   description.
