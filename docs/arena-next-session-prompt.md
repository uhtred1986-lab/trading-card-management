# Prompt for the next arena session

Paste the block below into a fresh session. It is written to be handed over
without editing; everything it needs to find is in the repo.

Rewritten 9 Sep 2026, after Stage 1 and the first **eleven** increments of
Stage 2 of the rules-language programme merged.

---

Continue the arena rules-language programme. The plan the owner approved on
9 Sep 2026 has ten stages; **Stage 0** (two engines and the switch), **Stage 1**
(the language, and an editable WHEN) and the **first eleven increments of Stage
2** are merged into `main`. Read, in this order:

1. `docs/arena-rules-worklist.md` — the entries for Stages 0, 1 and the Stage 2
   increments, with the numbers and the reasoning. Start at the bottom.
2. `docs/arena-rules-language.md` — the grammar, the round-trip promise, and
   what Stage 1 deliberately left out.
3. `CLAUDE.md`, the arena bullets — "the rules language", "the record's WHEN is
   the engine's WHEN", "two engines, chosen per game".

Branch fresh off `main`; there is nothing in flight. The only unmerged remote
branch is `wip/compiler-uncommitted`, which is old — leave it alone.

## The measurements to diff against

Take your own baseline; do not trust a number written in a document, this one
included. As of the eleventh increment:

```
cards 6493, fully compiled 4634 (71.4 %)
unread clauses 3553 over 2464 distinct shapes
```

`npm run arena:tally` fetches the live deckplanet catalog, so it needs the
network and fails transiently: a "gap set" that comes back as fourteen lines is
a fetch error, not a catastrophe. `npm run arena:readings` needs neither
network nor database.

## Where the last six increments got to

All six were the same kind of bug — a clause that **compiles and reads
wrongly** — and not one of them would have been found by a coverage number.
Five of the six moved the fully-compiled count by two cards in total.

- **Sixth.** BT16-088's "you can't play non-\<Zamasu\> **and** non-\<Goku
  Black\> Battle Cards for the game" was split at the "and", so the ban was on
  the wrong cards and expired at the end of the turn: a negated name is a name.
  BT7-129's "in areas other than your deck, hand, or life" read as "in your
  deck" — the complement is now written out area by area.
- **Seventh.** Eleven cards let a [Counter] go off for half its price. The
  whole-sentence read that exists to prevent exactly that stripped only "you
  can", and ten of the eleven open with a condition.
- **Eighth.** Nine board wipes cleared only the caster's own side. Five said so
  themselves via "ignoring [Barrier]" (22-16-2); the other four are the owner's
  ruling of 9 Sep 2026, recorded on their rows.
- **Ninth.** "Rest Mode Battle Cards" in front of the noun was never read, only
  "Battle Cards in Rest Mode" — so sixty removal skills written for a card that
  had already attacked were offered anything on the board.
- **Tenth.** The exclusion run stopped at its first item, its possessive was
  read as the chooser's side, and **"25000 or less power" was a word order the
  compiler had never read** — 41 lines print it and only 3 carried a bound.
  TB1-015 had all four wrong at once and KO'd precisely the cards it spared.
- **Eleventh, and the largest.** A clause opening with "if" is a condition
  whether or not the compiler can read it, and everything after it hangs on it.
  Refused alone, the clauses it governed happened **always**: 149 skills, among
  them two cards that played themselves from hand for free with no requirement
  and a board wipe offered every turn. 430 clauses entered the gap set and the
  fully-compiled count did not move by one card, because every affected skill
  was on a card that already had a gap. That is the argument for the readings
  in a single number.

## What is known-wrong and not yet fixed

Measured, reproducible, and left for a deliberate commit:

- **"Hidden Mode" is not a measure the grammar has.** 152 printed lines say it;
  `Selector` has `mode` for active/rest but nothing for hidden, and
  `state.ts:426` excludes a hidden card from any *filtered* selection, so
  "choose 1 Hidden Mode card" is offered every card instead. Adding it is a
  `Selector` field with the round-trip obligations that carries
  (`SELECTOR_FIELDS` in `lang/ast.ts`, `print.ts`, `parse.ts`, `verify/lang.ts`).
  BT28-124's [Counter] price is the case that shows it.
- **Two leading conditions the compiler *can* read are still dropped** — the
  eleventh increment left them; they are a plumbing bug rather than a grammar
  gap, and the scan that finds them is four lines of `parseConditionClause`
  over the readings dump.
- **BT19-096** drops "with power less than or equal to the chosen card's power"
  entirely: `powerRel` measures against *this* card, and this phrase measures
  against a card the same skill chose.
- **EX25-35** reads its second half as a fragment whose possessive stayed in the
  first, so a rest-lock aimed at the opponent reads as one aimed at you. Left
  narrow deliberately; the fix is in `splitClauses`, not in the side test.

## Then, the rest of Stage 2 — the families, re-measured

**Each family was scoped against the live catalog on 9 Sep 2026, and the table
below it is wrong in specific ways. Read these corrections first; they are the
measurement, the table is the plan.**

- **Cost reduction is a wording gap, not a missing primitive.** `costReduction`
  already exists (`script.ts:283`), `playCost` and `comboCostOf` already consume
  it, `staticEffects` already scans the Z-Deck, and the op is compiled 339 times
  — but only **one regex** ever emits it, at `compile.ts:2353`. Widening that
  one pattern to accept *decrease*, the passive "is reduced by", the possessive
  "this card's … cost", the plural "costs", a bare "cost" with no "energy",
  "for every N" as a divisor and `z-deck` targets takes **~40 of the 145
  clauses with no new op, no new `StaticEffect` kind and no engine change**.
  Five of the seven combo-cost clauses are the same `splitClauses` "and" bug the
  sixth increment fixed for names, which also answers the open question at
  `docs/arena-next-stage-spec.md:590`.
  **Leave sub-family A (71 clauses, "reduce the skill cost by {o}") alone**, for
  a reason the plan does not mention: its *scoping* half is itself unread —
  "the next time you activate [Arrival] on a \<Beerus\> card … during this turn"
  is a separate unread clause, and there are 45 such over 40 shapes. Compile the
  discount without the scope and you have a permanent, unlimited, untargeted
  discount on every skill on the board.
  **Leave sub-family D (8 "specified cost" clauses) until the owner rules**:
  `glossary.ts:401` treats the specified cost as the colour part alone, while
  `costReduction` with an orb amount lowers total *and* colour.
  The plan's "46" for this family exists nowhere: `arena-next-stage-spec.md:467`
  totals 42, `arena-design-proposal.md:592` says 74 cards, the measurement says
  145 over 84 shapes.

- **"Instead": the wording half pays first, not the event and subject.** 16 of
  the plan's own 21 headline clauses are wording gaps in the existing
  primitive — ten Warp clauses fail only on the passive "it's sent to its
  owner's Warp", and six remove-from-game clauses fail only because
  `parseWouldLeave` (`compile.ts:1213`) demands the literal " would " where they
  print "is removed". The subject is not new either: `replaceLeave` already
  carries `target`, and BT19-100 and BT30-016b ship it in production readings.
  **And no replacement can prompt at all today.** `move()` (`state.ts:819`) is
  synchronous with 48 call sites, has no frame and no `"wait"` path, so
  assigning `s.prompt` inside it is silently lost; the point of no return is
  `state.ts:852`, `detach(s, id)`, after which the card is in no area and no
  prompt could serialise. That puts all 13 "you may … instead" clauses (9-10-3)
  out of reach, and makes `replacementFor`'s comment that 9-10-2's mandated
  choice is "one prompt away" optimistic — it is a refactor away.

- **`immune` needs a fourth field.** Four of its thirteen cards filter the
  *source* card, which `target`/`from`/`until` cannot say: BT18-019
  `non-\<Gogeta: GT\>`, BT23-140 "cards other than Battle Cards", EX23-36
  non-Extra, BT19-019 "red ≪Saiyan≫ with 20000 power or less". Add
  `fromFilter: CardFilter`, mirroring the `side` + `filter` pair `forbid`
  already carries. BT18-019 names no owner, so `from` is **both**. Put it in
  `STATIC_OPS` (`state.ts:653`) or the eleven [Permanent]s compile, read
  correctly and do nothing. Do not count the 19 `[Deflect]` reminder skills.

- **"For each marker" is not "5 unread" — it is 1 unread and 4 wrong.**
  BT27-003/004/005/006 read "For each marker on this card, this card gets +5000
  power" as a **flat +5000 with no markers on the board**. And the owner's
  ruling of 9 Sep 2026 (recorded on BT27-003, read it with `arena:rule --list`)
  makes this family much larger than an `Amount`: markers are counters on a
  Unison equal to the **specified energy paid** for its X cost, tokens are real
  Battle Cards and must not be conflated with them, and **[Empower \<colour\>
  N]** carries up to N markers from a Unison already in play — old one to the
  Drop, inherited markers added on top of the ones the energy bought. The owner
  asked for full arena support including animation. None of it exists.
  When the `Amount` is added, note that `state.ts:733` drops a static whose
  amount is not a number or a `count` — leave that line alone and the whole
  family compiles, reads correctly and does nothing on the board — and that
  `verify/lang.ts:65` samples only `1` and `count(…)`, so **`sumPower` and
  `handUpTo` have no round-trip coverage today** and a new shape would get none
  either.

- **Alternative costs: half the family is a wording gap, half is not.**
  BT18-088 "by paying {1} instead of its energy cost" needs a `pay:"energy"`
  that does not exist; BT11-033 needs `target` and `until` on `altCost`;
  BT20-044 and P-396 need a selector for cards under a *named* host; BT31-135,
  BT31-069 and the five [Spirit Boost] cards need `canPayCostProgram`
  (`state.ts:1176`) to admit `moveTo to:"under"`, `flip` and `removeMarker`.


Counted on the live catalog on 9 Sep 2026, after the fourth increment (the fifth
moved no gap, so these still stand):

- **The cost-reduction family is 145 unread clauses over 84 shapes**, not the 46
  the plan's table says — "reduce the skill cost by {o}" is only the largest of
  them, beside "reduce the energy cost of this card in your hand", "reduce the
  combo cost", "reduce the Z-Energy cost", "reduce the specified cost". They are
  not one primitive: some reduce a *named skill's* cost by coloured orbs once,
  some reduce a card's own energy cost while it sits in a hand or a Z-Deck. The
  consumer is `orbTotals` and the payment planner, in the frozen legacy engine.
  Scope it before starting, and say which of the four it covers.
- **The "instead" family is 75 clauses**, the biggest single shapes being
  "remove it from the game instead" (11), "it's sent to its owner's Warp
  instead" (10 across two spellings) and "add it to your hand instead" (4). The
  destination-only subset is what `replaceLeave` already does; what pays is
  widening the **event** (leaving the Combo Area, leaving Life, a card being
  played) and the **subject** (not just this card). 9-10 replacement happens
  inside `move()`, which is synchronous and called from everywhere, and a
  replacement block can prompt — say plainly where it stops.
- **"isn't affected by your opponent's skills" is 13 clauses** over seven
  shapes: `immune(target, from, until)`, genuinely new and contained. The
  smallest of the three, and the one most likely to fit in one sitting.
- **"for each marker on this card" (5)** — `Amount` → expression, the start of
  the `expr` work Stage 2 lists.
- **Alternative costs** ("you can activate this card's [Counter] from your hand
  by X instead of paying its energy cost", 7+): `altCost` with `pay: "program"`
  already says this. **Wording gap**, not a primitive.

Two smaller things the readings diff turned up earlier and left alone, both
honest gaps rather than wrong readings: **"choose all Battle Cards"** with no
possessive is read as your own (BT7-110 — the "other" fix narrowed the
both-sides default to phrases saying "other", deliberately), and **"original
energy cost"** is read as the current one.

## How to do it safely — this is the part that matters

The failure mode here is not a clause that fails to compile. It is a clause that
**compiles and reads wrongly**, which no coverage number catches and no test
knows to ask about.

1. **Snapshot both measurements before you touch anything:**
   `npm run arena:tally -- --misses 100000 > gap-before.txt` and
   `npm run arena:readings > read-before.txt`.
2. Make the change.
3. **Diff the gap set** (strip the counts, sort, `diff`). Shapes that *appear*
   are as important as shapes that vanish, and a coverage number that *falls* is
   usually the change working.
4. **Diff the readings and sign off every line that moved.**
   `npm run arena:readings` prints the printed text beside `describeScript` for
   all 13,563 skills, with no database; `-- --grep "<a wording>"` narrows it to
   one wording and `--unread` adds the clauses that did not read. Key the diff
   by card and skill (`awk '/^[A-Z0-9]/{k=$0} /^  reads:/{print k" || "$0}'`,
   sorted) rather than diffing the files line by line. The gap-set diff *was*
   clean on the day three cards were being read wrongly; this is the check that
   catches that, and it is not optional.
5. Prefer unread to wrongly read (ground rule 5). If you leave a rule out, leave
   the comment in, naming the cards.

Also useful: `arena:tally -- --show "<a wording>"` prints the actual cards behind
a shape count. Read it before believing any row of the plan's gap table — the
first increment measured the table against the cards and found it half wrong.

## The gate, every commit

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`,
`npx tsx --env-file-if-exists=.env.local scripts/arena-fuzz.mts 40` (0 crashes
required). A compiler change also needs the gap-set **and readings** diffs above.
A change to what the referee is told, or to a harness card, needs
`npm run contract:emit` — **review that diff**, and expect the probe digests to
change by exactly the cards you added.

## Things that cost an hour each to relearn

- **Never write engine source through `node -e`** — `\b` in a shell-quoted
  string becomes a backspace and silently kills a regex. Use the Edit tool.
  There is no `python` on this machine either.
- **The repo stores LF and Windows checks it out as CRLF** (`core.autocrlf` is
  on globally here, and there is no `.gitattributes`). Two consequences worth
  knowing before losing time to either: anything reading a repo file and
  matching on `\n` has to normalise first (`verify/lang.ts` did not, and `npm
  test` failed on the language doc for reasons unrelated to any change), and
  `npm run contract:emit` rewrites the fixtures with LF, so `git status` shows
  twelve modified files whose diff is empty — `git checkout -- contract/` after
  confirming the diff really is empty.
- **`npm run typecheck` can fail inside `.next/dev`** with unterminated string
  and regex errors in `routes.d.ts` / `validator.ts`. That is a stale generated
  directory from a dev server, not your code: `rm -rf .next/dev` and run again.
- **A Vercel deploy that fails with a `0ms` build, no duration and no
  retrievable logs is almost certainly `npm run db:migrate` failing, not your
  code** — `vercel.json` runs it before `next build`, and the CLI cannot show
  logs for a deployment that never reached READY. On 9 Sep 2026 three
  deployments failed this way; running the same migration locally cleared it and
  every deploy since has been green. Check the code separately with a clean
  `npm run build` before believing it is yours.
- **`vercel build --yes` creates a new Vercel project** if the directory is not
  linked, and connects it to the GitHub repo. Do not run it in a worktree
  without intending that; remove the project afterwards.
- **`arena:fuzz 40` really does run 40 games now** — the argument used to be
  dropped when `--engine` was absent.
- The owner's `.env.local` carries `BASIC_AUTH_USER`, so **local dev sits behind
  Basic Auth on this machine** even though `CLAUDE.md` says it should not.
  Anything that needs the browser needs credentials from the owner.
- Ask about a rule only after the manual, Bandai's Q&A pages and the forums have
  come up empty — and when they have not settled it, say so in the note beside
  the rule. A ruling given in chat goes to the row first
  (`npm run arena:rule -- <cardId> "<the ruling>"`), and the code change waits to
  be asked for.

## Still open from Stage 1

The workbench's text view was never opened in a browser — the machine's Basic
Auth blocked it. Worth doing by hand once: open a corrected record, **Show as
text**, add a second trigger to WHEN, save, and check the probe pane's `attack`
scenario reports *fired*.
