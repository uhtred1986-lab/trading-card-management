# Continuing the arena rules programme

Written 9 Sep 2026, after Stage 1, fourteen increments of Stage 2 and three
rounds of parallel work merged. It assumes no knowledge of the sessions that
came before and no particular tooling — any coding client can pick this up.

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
- **The specified-cost reducer is wired but inert.** `playCost` gives every
  X-cost card an empty specified-cost *baseline*, because nothing in the catalog
  feed says a Unison's "2 blue" is 2 rather than 1 or 3. Six cards read
  correctly and change nothing on the board; see the comment in `state.ts`.
- **Cost-reduction sub-family A** (71 clauses, "reduce the skill cost by {o}")
  stays unread for two reasons: `orbTotals` is a pure function of the parsed
  skill with eleven call sites, and — worse — the *scoping* half of those
  sentences is itself unread, 45 clauses over 40 shapes. Compile the discount
  without the scope and every skill on the board gets a permanent, unlimited,
  untargeted discount.
- **`[Empower XY/ZY]`** (two colours, 22-45-3-1) cannot be parsed. No card
  prints it; theoretical until one does.

### (d) The `move()` refactor — the largest single unlock, and not urgent

`docs/arena-move-replacement-scope.md`. A replacement effect cannot ask a
question: `move()` is synchronous with ~48 call sites, no frame and no `"wait"`
path, so assigning `s.prompt` inside it is silently lost. The point of no return
is `detach(s, id)` in `state.ts` — after it the card is in no area and no prompt
could serialise. This blocks all 13 "you may … instead" clauses (9-10-3) and
9-10-2's mandated choice.

**Two things make it less urgent than it looks.** Those 13 cards are *correctly
refused* today — nothing reads wrongly, so this is a capability gap rather than
bleeding. And the obvious safety argument does not hold: `replacementFor`
discriminates only on `opts.reason`, and `reason: "effect"` is emitted both by
sites that can suspend and by five in `engine.ts` that cannot, so there is no
compile-time way to gate prompting on reachability. Read the document before
committing anyone to this.

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
