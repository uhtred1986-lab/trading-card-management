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
  vocabulary. **Read this first** if you are writing a new check.
- **`text.ts`** — how card text is read before any game exists: the skill
  parser, keyword recognition, the errata corrections.
- **`setup.ts`** — the seed and game setup (§6-2). A failure here usually means
  determinism broke, which invalidates every other suite.
- **`battles.ts`** — combos, blockers, counters, the keywords that decide a
  battle.
- **`compiler.ts`** — the largest: what a printed line becomes, and what the
  interpreter does with it. Most compiler changes that break something break
  here.
- **`keywords.ts`** — the §22 keywords as engine rules.
- **`readings.ts` / `wordings.ts`** — the wordings learned after the keywords.
  Together ~3,000 lines, and the closest thing to a regression corpus for the
  compiler.
- **`workflow.ts`** — every rule as a visible workflow: what is refused and why,
  in the words a client shows. Asserts the "one rejection per card per action
  type" promise.
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
`legacy`) and exports the resolved `ENGINE`; `game()`, `arena()` and `play()`
create and play their games through it, so every suite built on them moves
with the flag with no changes of its own. `npm test` never passes it, so
`legacy` is what it has always run. `npm run test:rules` is
`tsx scripts/verify-arena.ts --engine rules` — the same fourteen suites, on
the rules engine.

`vm.ts` and `rulesets.ts` are the two exceptions: `vm.ts` names `legacy` and
`rules` explicitly (it is the suite proving the switch, so it cannot depend on
which side of the switch happens to be selected) and `rulesets.ts` touches no
game at all. Both run the same, and are expected to pass, whichever engine
`--engine` names.

Every other suite stages a board through `game()`/`arena()`, so on `--engine
rules` it hits one of two named errors immediately rather than crashing
partway through an assertion: `NotYet` (a call the rules engine does not
implement yet, e.g. `apply`, per `src/lib/arena/vm/index.ts`) or
`EngineMismatch` (the harness's fixtures read `GameState` fields directly —
`s.prompt`, `s.players`, `move()` — so a state the rules engine dealt is
named rather than read as `undefined`). `verify-arena.ts` prints either as
`skipped`, with the reason, and keeps going. What "green on rules" means
therefore changes stage by stage — there is nothing to fix by making a suite
"pass" before its dependency lands:

| stage | what's built | `test:rules` today |
|---|---|---|
| now (#139) | the rules engine deals the opening board | `vm`, `rulesets`, `text` pass; `probe`'s fixture digest is skipped (needs every suite's cards); everything else is `skipped` with `EngineMismatch` |
| #140 (a turn plays) | `apply`/`legalActions`/`rejectedActions` | suites built on `game()`+`play()` start reporting real pass/fail instead of a blanket skip; `NotYet` narrows to whatever #140 leaves out |
| #141–#142 (beats, effects in force) | `toBeats`, static effects | `contract`, `workflow`, `compiler`-adjacent suites become meaningful rather than skipped |
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
