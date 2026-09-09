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
| `scripts/verify-arena.ts` | nothing | the arena — twelve suites, below |
| `scripts/verify-db.mts` | nothing (PGlite in memory) | the migrations apply, and the reservation rules hold against real SQL |

`verify-arena.ts` is a barrel importing twelve suites from `scripts/verify/`.
Knowing which one failed tells you what you broke:

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
- **`probe.ts`** — a rule tried on a board built for it, compared against stored
  digests.

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
caught real breakage.

### `arena:diff` — the oracle

Replays a saved game's action log from its seed and compares with the stored
row. This is the strongest correctness check available, because a game is
reproducible from seed plus actions: if a replay diverges, behaviour changed.
Use it for **any engine change**. It is not part of `npm test` because it needs
a database and real saved games.

### `arena:probe` / `arena:reprobe`

A probe builds a game around one card's rule, stages the board its moment needs,
plays the move, and reports Input / Applied rule / Result / Assumptions with a
digest over the conclusion. `arena:reprobe` re-runs every stored probe and lists
the rules whose answer *moved* — the regression suite the rules never had.

**Its blind spot is worth knowing**: the staged board is built in the card's
favour, and it only stages what it has been taught to stage. It staged no
markers at all until someone added that, so it could not distinguish a working
marker rule from a broken one. If you add a mechanism, ask whether `stage()`
knows how to set it up.

### `arena:playthrough`, `arena:coverage`, `arena:draft`

`playthrough` plays a whole game through the database (integration, needs a DB).
`coverage` reports how much card text the compiler reads. `draft` compiles the
catalog offline into `card_rules` drafts — **the only module that calls the
compiler in production is `draft.ts`**; the engine reads rows.

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
