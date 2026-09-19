# Continuing the arena rules programme

Written 9 Sep 2026, after Stage 1, fourteen increments of Stage 2 and three
rounds of parallel work merged; §1a's module map refreshed 14 Sep 2026. It
assumes no knowledge of the sessions that came before and no particular
tooling — any coding client can pick this up.

Read `CLAUDE.md` first for the app as a whole. This document is only the arena
compiler and engine.
For the short state-of-the-world snapshot and doc-status convention, read
`docs/arena-CURRENT.md` first.

Progress against the plan is now tracked as GitHub milestones and issues, not
in this file: `docs/arena-backlog.md` §2 lists the milestones, and §5 is the
mandatory rule for filing new work.

---

## 1. What the arena is, in one paragraph

The arena plays Dragon Ball Super Card Game games from the printed text of real
cards. `src/lib/arena/engine/compile/` reads a card's skill into a program in a
small effect language, with `compile.ts` kept as its stable public barrel; the
engine runs it; anything the compiler cannot read
goes to a referee. **The engine never compiles card text at game time** — rules
live as rows in `card_rules`, drafted offline. `src/lib/arena/glossary.ts` is
the written record of what the compiler understands, and it is part of the
compiler rather than documentation about it: change what the engine reads, and
that file changes in the same commit.

## 1a. Current module map (refreshed 14 Sep 2026)

Written at file-and-module grain rather than line numbers on purpose — a line number is exactly
what goes stale first (`docs/arena-backlog/_README.md` and issue #281 are the record of that
lesson). For depth beyond this, read `docs/arena-code-map.md` (the full arena narrative moved out
of `CLAUDE.md` by issue #282, kept current in the same commit as any change to what the engine
understands or does) and, for what the engine reads today, `src/lib/arena/glossary.ts`
(`/arena/rules/keywords`).

- **Two engines** (`src/lib/arena/engines.ts`): `legacy` (`src/lib/arena/engine/`, frozen —
  bug fixes only) and `rules` (`src/lib/arena/vm/`, the programme this file used to be the only
  account of). `engineFor(id)` is the one switch both `games.ts`/`snapshot.ts` and the scripts go
  through.
- **The effect language's tables**: `src/lib/arena/engine/script-schema.ts` (`OP_SCHEMA`,
  `COND_SCHEMA`, the closed word lists) — `engine/script.ts` re-exports them, so existing imports
  still work.
- **The rules language**: `src/lib/arena/lang/` (`parse.ts`/`print.ts`/`validate.ts`/`ast.ts`,
  table-driven from the schema above), since 9 Sep. `DEFINE …` grammar for a game's own
  declarations (`docs/arena-rules-language.md` §3b) since 12 Sep.
- **A game is files, not code**: `src/lib/arena/rulesets/<game>/*.rules`, read by
  `loadRuleset` into one `GameDefinition`; `npm run arena:rulesets` regenerates the generated
  `files.ts` constant from the `.rules` files. `docs/arena-ruleset-spec.md` is the interpreter
  contract. `ops.rules` declares 20 of the 31 macro rows; `modifyAttr` reaches a card, a
  player (`energyMarkers`, its `side` field) and the battle in progress (`guard`, its
  `target` field read as a value) — `modifyAttrAs` (`engine/script-schema.ts`) reads each of
  the nine short spellings this unblocked back as the primitive (spec §2.5-1/§2.5-3, #275).
- **`vm/` built so far**: zones and attributes off the declarations, `flow.ts` (a turn as a
  program over `DEFINE PHASE`/`STEP`), `events.ts`/`triggers.ts` (a moment is an event pattern),
  `program.ts`/`effects.ts` (the shared interpreter, continuous/delayed effects), `actions.ts` +
  `dbs/actions.rules` (charge/pass/concede, the play family, `activate`), `costs.ts` (energy,
  marker, life, rest, payWith prices as declarations, with cost-reduction layers — including
  20-19's own `payWith` cost item since #149, bound the same way an activation's marker and life
  already were). What is not yet built throws `NotYet` naming the stage/issue that builds it,
  which since #149 (14 Sep 2026) ends the game rather than noting the gap and playing on —
  `ENGINE_INFO.rules.available` is true and `playableEngine("rules")` allows a new **hot-seat**
  game; Sparring, Tournament and a 1 v 1 are still refused (`games.ts`'s `assertEngineForMode`),
  since Claude's side and a 1 v 1's hidden-hand masking both still read the legacy `GameState`
  directly.
- **Tests**: `scripts/verify-arena.ts` runs (in order) `text, setup, battles, compiler, keywords,
  readings, wordings, workflow, contract, deck-api, language, lang, rulesets, probe, vm` — a new
  suite is one `import "./verify/<name>"` line there. `scripts/verify/vm.ts` is the rules-engine
  suite; `scripts/verify/rulesets.ts` checks a ruleset's declarations against the legacy engine's
  own unions.

**The gate, every commit** (unchanged): `npm run typecheck && npm run lint && npm test && npm run
build`, then `npx tsx --env-file-if-exists=.env.local scripts/arena-fuzz.mts 40` (0 crashes; add
`--engine rules` once a change touches it). A schema row, a harness card or what the referee is
told also needs `npm run contract:emit`, reviewed (the fixtures are LF, checked out CRLF — confirm
with `git diff --stat`, then `git checkout -- contract/` on pure whitespace). Touching what the
engine understands means `src/lib/arena/glossary.ts` in the same commit.

## 2. Where it stands

```
cards 6493, fully compiled 4678 (72.0 %)
unread clauses 3455 over 2416 distinct shapes
```

**Take your own baseline. Do not trust that number, including here.**

```
npm run arena:tally -- --misses 100000 > gap-before.txt   # ~11 s, needs network
npm run arena:readings > read-before.txt                  # ~8 s, needs nothing
```

`arena:tally` fetches the live catalog and **fails transiently** — a result of
about fourteen lines is a fetch error, and three separate work streams have been
fooled by an intermediate run whose deltas did not reproduce. Re-run before
believing a surprise.

## 3. The one thing that matters

**The failure mode is not a clause that fails to compile. It is a clause that
compiles and reads wrongly.** No coverage number catches it and no test knows to
ask. Fourteen increments of evidence:

- A board wipe that cleared only its own side.
- A KO offered every card on the board, because "Rest Mode Battle Cards" was
  read only when the words came *after* the noun.
- A [Counter] charged half its printed price.
- 149 skills that happened whether or not their condition held.
- A card that played itself from hand for free with no requirement.
- Seven cards that searched the opponent's deck for cards the text takes from
  their own, because a *destination* phrase at the end of the sentence decided
  where the *search* happened.
- A token that arrived with 5000 power where its reminder printed 15000.
- A contraction — "there's" where the parser knew only "there is" — that cost
  five whole skills their condition.

Every one of those compiled cleanly and reported a plausible-looking reading.

### The discipline that finds them

1. Snapshot **both** measurements before touching anything (§2).
2. Make the change.
3. **Diff the gap set.** Shapes that appear matter as much as shapes that vanish.
   A coverage number that *falls* is often the change working.
4. **Diff the readings and sign off every line that moved**, keyed by card:
   ```
   awk '/^[A-Z0-9]/{k=$0} /^  reads:/{print k" || "$0}' read-after.txt | sort
   ```
   Where many lines move, prove a **property** instead of reading them all —
   "every moved line differs only by the phrase I added", "every surviving
   reading is a strict prefix of the one it replaced". Both have been used and
   both caught real problems. **Then still check one named card by hand**: an
   instrument can be blind to the change it is measuring. One field compiled
   correctly but had no words in `describeSelector`, so its first readings diff
   came back clean *by accident*.
5. **Prefer unread to wrongly read.** A gap costs tokens; a wrong reading loses
   games. Refusing a family outright is a good outcome, and reducing the
   fully-compiled count can be the right answer — twelve cards left it in round
   three, every one of which had counted as complete only because a wrong
   reading hid a gap.
6. **Touch the compiler, update `glossary.ts`** in the same commit. That
   includes a family you decide to refuse.

### The gate, every commit

```
npm run typecheck && npm run lint && npm test && npm run build
npx tsx --env-file-if-exists=.env.local scripts/arena-fuzz.mts 40   # 0 crashes
```

Changing a harness card, an `OP_SCHEMA` row or what the referee is told also
needs `npm run contract:emit`, and **review that diff** — expect exactly the
cards you touched. The fixtures are written LF and checked out CRLF, so a
`contract:emit` reporting twelve modified files with empty diffs is noise:
confirm, then `git checkout -- contract/`.

## 4. What to do next, in priority order

### (a) Keep hunting wrongly-read clauses — the best value per hour

Two systematic passes have run and both paid. The method: take every regex in
`engine/compile/` and `filters.ts` that anchors on a literal phrase and grep the
catalog for **near-misses** — contractions, reversed word order, singular
against plural, passive against active, synonyms. Two of the best finds were a
word order ("25000 or less power" against "25000 power or less", 41 lines with
only 3 read) and a contraction. Also compare printed text against reading for a
measure present in one and absent in the other, and watch for side or area
leakage — a reading that says "opponent" where the text never does.

**Verify every count against the readings dump before reporting it.** One audit
claimed 25+ skills for a bug whose real figure was 4, and offered as a correct
*control* a card that was itself broken.

### (b) The side test — a structural fix with a document waiting

`docs/arena-side-scope.md`. `parseTarget` decides whose cards a phrase means by
scanning the **whole clause** for a possessive, so a possessive belonging to a
destination, a measure or a name sets the side for the source. **Three bugs have
come from this**, each fixed by stripping the offending phrase, and the third
needed two guards to avoid colliding with the first two. The document sets out
the real fix — decide the side from the phrase that names the area — and says
why it is its own piece of work. It names a fourth instance nobody has touched:
DB1-059 and EX08-06 read "an energy cost greater than or equal to your
opponent's energy" as an *area to search*.

### (c) Known-wrong and unfixed, each measured

- **`parseConditionClause` merges "green X *or* yellow Y" as an AND across
  fields** rather than a disjunction — wider than printed. Found while fixing
  something else and deliberately not fixed there.
- **The specified-cost baseline is hand-entered, and six cards are still
  waiting for theirs.** The feed carries no cost orbs, so an X-cost card's
  coloured requirement comes from `cards.specified_cost` (issue #255: the
  workbench record's *specified cost* box, `coalesce`d by the catalog upsert).
  BT19-039 is entered as `{u}{u}` on the ruling of 9 Sep 2026; BT19-040,
  BT15-063, BT20-118, P-673, P-600 and BT25-004 read their reducer correctly
  and change nothing until the owner enters their orbs from the cards — the
  record says *Incomplete* on each, and `npm run arena:specified` lists them.
- **Cost-reduction sub-family A** (71 clauses, "reduce the skill cost by {o}")
  stays unread for two reasons: `orbTotals` is a pure function of the parsed
  skill with eleven call sites, and — worse — the *scoping* half of those
  sentences is itself unread, 45 clauses over 40 shapes. Compile the discount
  without the scope and every skill on the board gets a permanent, unlimited,
  untargeted discount.
- **`[Empower XY/ZY]`** (two colours, 22-45-3-1) cannot be parsed. No card
  prints it; theoretical until one does.

### (d) The `move()` refactor — built, in the two places it could be

`docs/arena-move-replacement-scope.md` §5. **Done (#107), and not by rebuilding
`move()`.** `move()` is still synchronous at 46 of its 48 call sites; what
changed is that the two that are *not* — `stepScript`'s `moveTo` and `ko` loops
— decide the replacement before calling it, and run a substitute's program as a
frame on the flow, where a question can be asked and answered. 9-10-2's
mandated choice, 9-10-3's "you may", and the "by an opponent's skill" narrowing
19 cards print all read now: 46 of the family's 89 skills carried an unread
clause, 26 do.

The safety argument the earlier note said does not hold still does not hold,
and is not relied on. Nothing gates on *reachability*: `replacementFor` — the
deterministic path all 46 sites take — simply skips a replacement it cannot put
a question about (an optional one, or a substitute whose program asks), so
those sites behave exactly as they did. Additive at two call sites, unchanged
at 46, which is what made the increment one lane's size.

What is left is in §6 of that document: BT10-031 and SD18-01, which replace a
**life** card's move rather than a Battle Area departure and so need a fourth
`replace` event before they need `opts.reveal` at all.

### (e) Markers, [Empower] and the board

`docs/arena-markers-stage-scope.md`. Its headline is that **most of this already
works** — an earlier note claiming otherwise was wrong, and the cost of
believing it would have been a rewrite around a bug that is not there. What is
left: the [Empower] beat does not name both cards, so the board cannot show
markers *moving* from the Unison being replaced. That is a `Snapshot` change and
therefore a contract change.

## 5. Running work in parallel

Three rounds have been run this way and it works, with one rule that is not
optional.

Give each stream its own checkout branched off `main`, and let each measure
itself. Then **merge them all into one integration branch and measure the
whole**, because a stream's own clean diff does not prove the merged result is
clean. In round one the parts summed to 3,500 unread clauses and the whole was
3,502 — one stream taught a cost reduction to read while another began refusing
the unreadable condition in front of it. In rounds two and three the parts
summed exactly. **Neither outcome was predictable**, and only the merged
measurement distinguishes them. Verify each stream's headline cards in the
*merged* tree, not in its own.

Expect conflicts in `engine/compile/` (different functions, usually additive),
`glossary.ts` (two streams appending to the same entry), and the generated
`contract/fixtures/*` — regenerate those with `contract:emit` rather than
merging them by hand.

## 6. Traps that cost an hour each

- **Never write engine source through `node -e`**: `\b` in a shell-quoted string
  becomes a backspace and silently kills a regex. There is no `python` here.
- `splitClauses` is the most load-bearing function in the compiler. Several
  fixed bugs came from changing how it cuts, and one attempt to generalise a
  guard silenced ~30 unrelated shapes. Scope changes to the family in hand.
- A test asserting the old behaviour is sometimes the bug rather than a
  description of it. Three have been rewritten for that reason; say why in the
  commit.
- `npm run typecheck` failing inside `.next/dev` is a stale generated directory:
  `rm -rf .next/dev`.
- Local dev sits behind Basic Auth on the owner's machine even though
  `CLAUDE.md` says it should not; anything needing a browser needs credentials.
- **A ruling given in conversation goes to the database first**:
  `npm run arena:rule -- <cardId> "<the ruling>"`, then the code change is made
  deliberately against every card sharing the wording. `--list` reads them back.
  Two rulings are recorded; one *corrected* its own first version, which is
  exactly why they are stored rather than left in a commit message. Check the
  rule manual (`docs/rules/rulemanual.txt`) and Bandai's Q&A before asking, and
  validate a ruling against them afterwards — both recorded rulings were.
