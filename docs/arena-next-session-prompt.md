# Prompt for the next arena session

Paste the block below into a fresh session. It is written to be handed over
without editing; everything it needs to find is in the repo.

Rewritten 9 Sep 2026, after Stage 1 and the first five increments of Stage 2
of the rules-language programme merged.

---

Continue the arena rules-language programme. The plan the owner approved on
9 Sep 2026 has ten stages; **Stage 0** (two engines and the switch), **Stage 1**
(the language, and an editable WHEN) and the **first five increments of Stage
2** are merged into `main`. Read, in this order:

1. `docs/arena-rules-worklist.md` — the last seven entries are Stages 0, 1 and the
   five Stage 2 increments, with the numbers and the reasoning. Start at the
   bottom.
2. `docs/arena-rules-language.md` — the grammar, the round-trip promise, and
   what Stage 1 deliberately left out.
3. `CLAUDE.md`, the arena bullets — "the rules language", "the record's WHEN is
   the engine's WHEN", "two engines, chosen per game".

Branch fresh off `main`; there is nothing in flight. The only unmerged remote
branch is `wip/compiler-uncommitted`, which is old — leave it alone.

## Where the last increment got to

**The instrument is fixed.** The readings are the only check on a clause that
compiles and *reads* wrongly, and they could not be signed off on 145 of the
13,563 skills because the sentence contained the word `undefined`, nor trusted
on any filter carrying one of ten measures `describeFilter` never printed. Both
are now printed. **The gap set did not move** — fully compiled cards stay at
4,625, unread clauses at 3,133 over 2,267 shapes, `contract:emit` no change —
and 587 readings did, all but six of them a sentence gaining words.

- A selector with no count of its own is every card it finds; it says "all", and
  `take` says "the top 3" rather than a number to pick. `inBattle` and `battled`
  say "any of" (they are `.some`), and `every` says "every card in … is also …"
  instead of "all of all in …".
- The ten measures — `notColors`, `notCharacters`, `notTraits`, `notNames`,
  `keywords`, `notKeywords`, `skillKind`, `noKeywords`, `notToken`, `powerRel` —
  print in the wordings `parseFilter` reads back, so `printFilter` keeps more
  filters in their own words. Two bounds were also *wider than the filter*: both
  bounds set printed only the ceiling, and an exact cost or power printed as "or
  less". Both are ranges and exact values now.
- The bug the doc named went in with it: **"from it" after a look or a reveal**
  is the pool being held out, the rule "among them" already had. BT16-005 was
  discarding one of **your own** cards; six readings fixed (BT16-005, BT4-124,
  BT9-100b, P-134, BT10-004, P-147), and BT13-024's pool variable — the literal
  `"looked"`, which a *reveal* never binds — is bound at last.

**Two compiler bugs the new words exposed, deliberately not fixed here** — the
commit had to leave the gap set still. Take them first if you want a short one:

- **BT7-129** prints "non-black cards in areas **other than** your deck, hand,
  or life" and reads "in your **deck**". The area is inverted, not missing.
- **BT16-088** prints "non-<Zamasu> **and** non-<Goku Black>" and reads only the
  first; "for the game" also reads as "for the turn".

Both printed as the bare word "card" until this increment, which is the whole
argument for having done it first.

## Then, the rest of Stage 2 — the families, re-measured

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
