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

In order. All must pass; none needs the network. Since #165, `verify-arena.ts` runs **twice** —
once on the legacy engine (default) and once with `--engine rules` — so both engines are checked
on every `npm test`, not just on request.

| script | needs | proves |
|---|---|---|
| `scripts/verify-rules.ts` | nothing | the pure rules helpers (deck legality, reservations, scan matching) |
| `scripts/verify-arena.ts` | nothing | the arena — fourteen suites, below — on the legacy engine |
| `scripts/verify-arena.ts --engine rules` | nothing | the same suites again, on the rules engine, with named `skipped case`s where a stage hasn't landed yet (§ below) |
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
  battle. **Runs on both engines since #152**, and since #156 every case is
  a real assertion on `--engine rules` too: the keyword cases it used to skip
  by name are built ([Awaken], [Critical], [Double Strike], [Victory Strike],
  [Dual Attack] and [Revenge] by #156, [Indestructible] by #154, [Unique] and
  [Evolve] by #157, [Z-Stack] by #155, whose case stages its Z-Energy
  directly on `rules` because 8-5-2's Z-Energy offer is still #151's). Proves, on the rules engine as much as the legacy one:
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
  what the case is testing. Three gate functions name what is still skipped
  on `--engine rules`, each printing the reason rather than doing nothing:
  `keywordGap` (a keyword's own `DEFINE KEYWORD` carries no `HOOK` body for
  what the case needs — most of the 39, `docs/arena-backlog/s7-0{2,3,4,5}-
  *.md`; a fourth, `staticGap`, left with its last cases at #154, which reads
  a [Permanent]'s `immune` op as #148 reads `altCost` and `payWith`),
  `lifeGap` (9-10's `life` event, #272 — gone with REVEALER, its last case,
  once the rules engine's battle damage asked per life card; the rest of the
  9-10 family, `replaceGap`'s six cases, went on 1 Oct 2026), and
  `notYetGap` for everything else
  found empirically rather than guessed at from a doc — the `addSkip` queue
  (#145; a skill-driven KO, `h.ko`, was #146's until it landed), an X price on a skill line
  (`actions.rules`'s own gap), and several real, individually-diagnosed
  gaps this porting pass turned up and none of the other suites had reason
  to exercise: [Spirit Boost]'s own keyword-shaped marker amount not
  reaching the cost planner though the price grammar is declared (closed by
  #157: `DEFINE COST spiritBoost`); two
  trigger-moment wordings ("switched to Rest Mode by one of your skills",
  closed by #157's `modeSwitched(by: …)`, and "when you use a card in a
  combo", which does not yet pend on this engine);
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
  type" promise. **Runs on both engines since #152**, and on `rules` it skips
  one case and no more ([Unique] and [Swap], the keyword bodies it used to
  skip, are built since #157): the first half of `PRICED` — an action price (4-3-3),
  which `vm/activate.ts`'s `chargeablePrice` refuses and `vm/host.ts`'s
  `saveVars` gives to #149 (`actionPriceGap`). The four non-keyword gaps the
  porting pass found are closed: the combo, counter and blocker prompts have
  their rejected lists (`battleRejectedActions`, `vm/battle.ts`, with the combo
  prompt's [Activate: Battle] lines), and so does a `chooseCards` prompt
  (`vm/index.ts`); a counted prohibition spends its `uses` (`spendProhibitionUse`,
  `vm/program.ts`); and `vmBoardView` draws `you.choices` for a deck search,
  `them.rules` for a player-level prohibition, and a chooseCards prompt's own
  words, count and step. Every exact **label** string
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
`legacy`) and exports the resolved `ENGINE`. **Since #165, `npm test` runs
`verify-arena.ts` twice** — once with no flag (legacy) and once with
`--engine rules` — so both engines are checked on every ordinary test run,
not just on request. `npm run test:rules` still exists as a standalone
alias for just the second half (`tsx scripts/verify-arena.ts --engine
rules` — the same fourteen suites, on the rules engine alone), useful when
iterating on the rules engine without waiting for the legacy pass, `verify-db`
and `verify/backlog` too.

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
| through #151 (Stage 6, the rules engine plays a battle) | zones/attributes, the turn, costs, the play family, the battle sub-flow, damage/life/Z-Energy/WIN | `vm`, `rulesets`, `text`, `deck-api` pass; `probe`'s fixture digest is skipped under `--engine rules` (needs every suite's cards; the legacy pass also writes the cross-engine parity file); everything else is `skipped` with `EngineMismatch` |
| #152 (this doc's own build item) | the state-interface half of `harness.ts`, and the battle prompts' rejections, the board's choices and a counted prohibition's spending on `rules` | `battles`, `workflow` pass too, real assertions with named `skipped case`s for what Stage 7's keywords still own (plus `workflow.ts`'s one action-price case, #149) |
| #158 | `keywords` ported onto the same state interface | `keywords` passes too, real assertions with named `skipped case`s — most of them Stage 7 keyword gaps, the rest real gaps this porting pass found and diagnosed on its own (`keywords.ts`'s own entry above names each) |
| Stage 7 (`docs/arena-backlog/s7-*.md`) | keyword bodies over four hook groups | the `keywordGap` cases in `battles`/`workflow`/`keywords` close one by one; `readings`/`wordings` are the suites most of Stage 7's own remaining value lands in, and are candidates to port next |
| Stage 8 | words from config, `primer`/`prompts`/`view` | `workflow.ts`'s `assertLabelOnLegacy` cases close; `contract` becomes portable |
| #165 (done) | `verify-arena` on both engines folded into `npm test`; `arena:fuzz 200 --engine rules` clean | `npm test` runs both engines every time — `test:rules` remains as a standalone alias, no longer the only way to see the rules-engine run |
| Stage 9, remainder (#164, #165's own `arena:reprobe` bullet, #163's own flip) | every saved game replays on `rules`, `arena:reprobe --engine rules` at 0 moved, the `arena.engine` default flips | the table above still applies suite by suite until every row reads "pass" |

Making a suite actually pass on `rules` before its stage lands is out of
scope for the tooling itself — `test:rules` (now folded into `npm test`, and
still runnable alone) exists to say honestly which suites do and which do
not, not to make them.

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
use 200 for anything touching the movement, payment or flow machinery, and
**200 on `--engine rules` is #165's own gate** (0 crashes, checked into the
history archive). It proves only that nothing threw — it says nothing about
correctness — but it is the cheapest possible check that the engine still
runs to completion, and it has caught real breakage. Takes `--engine
legacy|rules` (default `legacy`). On `rules` it plays whole games through
that engine's own menu (`charge`, `play`/`playUnison`/`playZ`, `activate`,
the native `attack`/`block`/`counter`/`combo`, `pass`, `endMain`, `concede`)
and checks the same invariant after every move (every card in exactly one
place, 3-1); a card whose skill needs a mechanism the rules engine does not
build yet ends its game as a clean `NotYet` draw rather than a crash (`Abandon
this game …`, `vm/flow.ts`'s `stepProgram`) — that is expected and is not
counted against the 0-crashes gate.

### `arena:diff` — the oracle

Replays a saved game's action log from its seed and compares with the stored
row. This is the strongest correctness check available, because a game is
reproducible from seed plus actions: if a replay diverges, behaviour changed.
Use it for **any engine change**. It is not part of `npm test` because it needs
a database and real saved games. Takes `--engine legacy|rules` to replay on an
engine other than the one the game row was played on — the oracle check between
the two engines (`npm run arena:diff -- <gameId> [--engine legacy|rules] | --all`).

**Reading the `--all` report (#164).** A single `<gameId>` still prints one line, its own
verdict. `--all` does not: dumping one line per game buried the signal in fifty lines that mostly
say "same state", so it groups instead — `scripts/lib/arena-diff-report.ts` is the pure module
that does the grouping (covered by `scripts/verify/diff-report.ts` on synthetic outcomes, no
database needed to exercise the logic itself), `scripts/arena-diff.mts` only feeds it the
per-game outcomes its own `replay()` already computes.

1. **Games whose deck was edited since they were played come first, listed individually, never
   folded into a cause group.** Their shuffle differs from the one the game was actually dealt
   with, so any divergence there says nothing about the engine — `replay()`'s own `deckChanged`
   flag (comparing the deck's current card count against what the game's zones account for) is
   what decides this, not a guess from the divergence text.
2. **Every other divergence is clustered by its "why" text** — the first differing prompt or
   refused action `replay()` already reports for a single game (`refused: …`, `threw: …`, or
   `after every action, state.<path>: … against … on the row` when every action replayed clean
   but the final state still disagrees). Two games hitting the *same* bug produce the *identical*
   text, so grouping on it verbatim turns "38 divergent games" into "1 cause, 38 games" without
   guessing at what the cause actually is — the largest cluster is printed first, ties broken by
   the cause text so the order is stable across runs.
3. **The closing tally** (`N of M stable-deck games replay to the same state`) counts only the
   deck-unchanged games — a deck-changed game that happens to replay to the same state anyway is
   still reported in its own section, not folded into `N`.

Fixing what a cause group names is issue #164's own build step 2: one `vm/` fix (or a recorded
ruling plus a fix on both engines, when the *legacy* engine turns out to be the one that's wrong)
should collapse a whole cluster's game ids to zero on the next run — a cluster that shrinks by
fewer than its full count is the sign the fix did not cover every game it claimed to.

### `arena:probe` / `arena:reprobe`

A probe builds a game around one card's rule, stages the board its moment needs,
plays the move, and reports Input / Applied rule / Result / Assumptions with a
digest over the conclusion. `arena:reprobe` re-runs every stored probe and lists
the rules whose answer *moved* — the regression suite the rules never had.
Both take `--engine legacy|rules` (default `legacy`), threaded into
`src/lib/arena/probe.ts`'s own `engineFor` switch. Since #161 the staged board is built on either
engine (the rules board from the loaded definition, through `engine-state.ts`'s zone seam), so a
rules-engine probe plays the rule rather than refusing it. `probe()` never throws: a rule the
rules engine cannot play yet comes back as outcome `error` (a `NotYet`) or as a different
conclusion, and `arena:reprobe --engine rules` lists those as moved. The same comparison without a
database is `contract/probe-rules-parity.json`, written by `verify/probe.ts` beside
`probe-digests.json`: one row per harness card, both digests, and a named cause for each
difference (`npx tsx scripts/verify-arena.ts --explain` prints them).

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

## 5a. Seeing the board — `arena:shots` and `arena:contrast`

The redesign is visual, and development keeps off Neon, so neither needs a game
in the database. Both draw the real `ArenaStage` from a `contract/fixtures/*.json`
snapshot through **`/arena/preview`** (dev-only: `notFound()` when
`NODE_ENV === "production"`, so `npm run build` ships nothing reachable). The
route takes `?fixture=play|attack|ko|…`, `?skin=anime|night`, `?staging=` and
`?pace=step`; `?admin=0` draws the board as a player sees it (admin is the default, as with Basic Auth off) and `?referee=1` marks your first Battle Card as referee-ruled so the REF badge can be shot (#350); the board's two server actions are stubbed (`ArenaStage`'s
`server` prop), so a tap goes nowhere. Both scripts drive the installed Chrome
over the DevTools protocol (`scripts/lib/cdp.mts`, Node's built-in WebSocket) —
no Playwright dependency. Set `CHROME_PATH` if yours is somewhere unusual.

**Neither is in `npm test`**: both need `npm run dev` running and a browser.

### `npm run arena:shots`

Proves what the board *looks like*, for a review to set beside the frames in
`docs/arena-redesign/`. Shoots fixtures x {anime, night} x {phone 390x844 with
touch emulation, desk 1440x900} into `docs/arena-redesign/current/` (ignored by
version control), named like the reference frames: `phone-play-anime.jpg`,
`desk-ko-night.jpg`.

```
npm run arena:shots                                   # play, attack, ko
npm run arena:shots -- --fixtures play,over --skins anime --viewports phone
npm run arena:shots -- --all                          # every Snapshot fixture
npm run arena:shots -- --fixtures play --tap "[data-arena-card]" --tag review
npm run arena:shots -- --fixtures play --hover "[data-arena-card]" --tag hover   # desktop only
npm run arena:shots -- --fixtures play --rclick "[data-arena-card]" --tag pin     # right-click (pins the inspector)
npm run arena:shots -- --fixtures hand --drag '[aria-label="Your hand"] [data-arena-card]' --to '[data-arena-zone="p1:battle"]' --tag drag   # a drag held in progress
npm run arena:shots -- --full --base http://localhost:3001
```

`--drag "<selector>" --to "<selector>"` presses on the first match (a finger on the
phone, the mouse on desk), carries the pointer to the target's middle and **stays
down** for the shot (`--release` lets go instead). A target above the fold is chased the
way a hand would: the pointer goes to the top edge, where the board scrolls the page
under a dragged card. The preview's stubbed `act` records what the board sent in
`window.__arenaSent`, so a scripted drag can prove a drop played (one `play`) or was
refused (nothing). Two fixtures exist for it: `hand` (Main Phase, two energy active, a
hand with three cards you can afford and two you cannot) and `charge` (Charge Phase).

`--tap "<selector>"` taps the first match (touch on the phone, mouse on desk)
before shooting — a card's review, an opened sheet. `--hover` and `--rclick` do the same with the pointer on
desktop (a phone has none): the docked inspector filled, or pinned. `arena:contrast` takes `--hover` too,
so a state that exists only under the pointer can be audited. `--tag` is appended to the
file name so an opened state does not overwrite the plain one.

An effect caught mid-animation (rd-07): the preview takes a preview-only
`?fx=reveal|damage|damage-you|ko|attack|clash-hit|clash-ko|clash-held|over`, which mounts the fixture's
board without its beats and then delivers one beat (or, for `ko`, the fixture's own) so the beat
player walks it. Pair it with `--on "<selector>"` (wait until the effect is on the page),
`--freeze <ms>` (pause every animation and set each to that time) and a small `--settle 50`:
`--fixtures play --query fx=damage --on ".arena-boom" --freeze 250 --tag fx-boom`. The default
`?pace=step` holds on the beat, so the frame is deterministic. A fixture is one
moment; a state no fixture holds is added to `scripts/verify/contract.ts`, not
faked here. Card art is `null` in fixtures, so cards show their text face. The
skin is set both as `?skin=` (the board) and as the `arenaSkin` cookie (the page
behind it, which the root layout skins) — set both by hand if you open the URL
yourself.

### The preview, as a player sees it (#447)

`/arena/preview` is **full-bleed** like `/arena/<id>` (`isFullBleed`, `src/lib/navigation.ts`): no
app header, no bottom tabs, so a shot of it is the board a player gets. Four fixtures exist for
the design frames that had none, all written by `npm run contract:emit` from the harness:
`defend` (frame 07: Claude attacks you; you are asked to combo), `attack-life` (frame 09: an
unblocked attack takes a life, so a pip shatters), `refusal` (frame 05: a card you cannot
afford) and `empower` (a Unison replaced, its markers carried: the [Empower] flight; legacy
engine only, like the case it comes from). `?fx=defend|victory|finish` still work.

`?replay=1` plays a fixture's own beats from the start: the board mounts with an empty queue
and the beats are delivered 500 ms later, as a later snapshot would. Without it a fixture is a
still moment, its beats already seen. `?fx=` wins when both are given.

### `npm run arena:record`

The motion twin of `arena:shots`: a clip of `?replay=1` per fixture x skin x viewport, for a PR
that has to *show* an animation. Written to `docs/arena-redesign/clips/` (ignored by version
control) as `phone-attack-life-anime.webm`, named like the shots.

```
npm run arena:record                                   # attack-life, anime + night, phone + desk
npm run arena:record -- --fixtures attack-life --skins anime,night --viewports phone,desk
npm run arena:record -- --fixtures defend,empower --skins anime --duration 8000
npm run arena:record -- --fixtures play --query fx=reveal   # a preview effect instead of the replay
```

It drives the same CDP driver as `arena:shots` (`Page.startScreencast`, so no Playwright and no
new dependency) and encodes the frames with an ffmpeg it finds at run time: `FFMPEG_PATH`, then
`ffmpeg` on the PATH, then Playwright's own copy (`$PLAYWRIGHT_BROWSERS_PATH` or
`/opt/pw-browsers/ffmpeg-*/ffmpeg-linux`, which writes VP8 only, as the encoder here asks).
With none of them it stops and says where it looked. The clip starts when the board is up, so
the dev compile is not in it; `--duration` (default 12000 ms, a whole attack at normal pace) is how long it runs after that,
`--pace` defaults to `normal`. Like `arena:shots` it needs `npm run dev` running; neither touches
the database. To look at a clip, pass `--frames`: a JPEG every 250 ms lands in `<clip>-frames/`
(Playwright's ffmpeg decodes VP8 but has no image encoder, so extracting frames from the clip
afterwards only works with a full ffmpeg).

### `npm run arena:contrast`

Proves the board's text is **legible** (WCAG 1.4.3: 4.5:1, 3:1 for large text),
in both skins, phone and desk. axe-core cannot resolve a background through a
gradient and the anime sky is made of them, so this walks each text node's
ancestors, composites every translucent fill — and **every gradient stop**,
worst case — down from the first opaque ground, and reports the lowest ratio.
A card face carries an opaque dark ground (`docs/arena-skin-spec.md` decision
4), so text inside one is judged against the card, not the sky.

```
npm run arena:contrast                  # prints a table; writes current/contrast.json
npm run arena:contrast -- --strict      # exit 1 on any failure
npm run arena:contrast -- --fixtures play --skins anime --json /tmp/c.json
```

What a pass does **not** cover: text over photo art (judged against black and
white, flagged), `text-shadow`, `backdrop-filter`, pseudo-element fills; and
text with a `-webkit-text-stroke` of 1 px or more is judged by its outline
colour. Dimmed states (a card that is not a legal target, a disabled control)
are measured at their dimmed opacity and do show up; decide per finding whether
WCAG's inactive-component exemption applies. Animations are finished before the
measurement so an entrance fade is not read as low contrast.

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
