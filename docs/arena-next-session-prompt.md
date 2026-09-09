# Prompt for the next arena session

Paste the block below into a fresh session. It is written to be handed over
without editing; everything it needs to find is in the repo.

Rewritten 9 Sep 2026, after Stages 1 and 2 (first increment) of the
rules-language programme merged.

---

Continue the arena rules-language programme. The plan the owner approved on
9 Sep 2026 has ten stages; **Stage 0** (two engines and the switch), **Stage 1**
(the language, and an editable WHEN) and the **first increment of Stage 2** are
merged into `main`. Read, in this order:

1. `docs/arena-rules-worklist.md` — the last three entries are Stages 0, 1 and
   2, with the numbers and the reasoning. Start at the bottom.
2. `docs/arena-rules-language.md` — the grammar, the round-trip promise, and
   what Stage 1 deliberately left out.
3. `CLAUDE.md`, the arena bullets — "the rules language", "the record's WHEN is
   the engine's WHEN", "two engines, chosen per game".

Branch fresh off `main`; there is nothing in flight. The only unmerged remote
branch is `wip/compiler-uncommitted`, which is old — leave it alone.

## The next piece of work, and why it is first

Stage 2 is "new primitives from the gap table". The first increment measured
the table against the cards and found the table half wrong: most of the "in all
areas" family is a **wording** gap, not a missing primitive, because `gains`
already has that scope. Read `arena:tally -- --show "<a wording>"` before
believing any row of the plan's table — it prints the actual cards behind a
shape count, with no database.

That increment also found the thing worth fixing next. It wrote a one-line rule
for "negate the skills **of** X", measured it, and **threw it away**: it read
three of the seven cards wrongly, and all three failures were in the *target
grammar* underneath it, not in the rule.

**Fix `parseTarget` (`src/lib/arena/engine/compile.ts`) for two shapes:**

| the card says | the grammar hears | should be |
|---|---|---|
| "your opponent's **Leader**", "your Leader" | any one card in that play area | the `special` target that already exists (`leader` / `opponentLeader`) |
| "all **other** Battle Cards" | all of *your own*, this card included | both sides, with the `notSelf: "card"` the filter already has a field for |

This is worth far more than the clause that found it: **every selector in the
catalog that says "leader" or "other" reads through the same code**, so the
blast radius is the whole compiled corpus. Treat it as the main event, not a
prerequisite — and expect it to *fix* readings that have been quietly wrong.

Then put the "negate the skills of X" rule back (the comment where it used to
be names all three failures and the two cards each), and re-measure.

## How to do it safely — this is the part that matters

The failure mode here is not a clause that fails to compile. It is a clause
that **compiles and reads wrongly**, which no coverage number catches and no
test knows to ask about. The protocol that caught it last time:

1. **Snapshot the whole gap set before you touch anything:**
   `npm run arena:tally -- --misses 100000 > /tmp/before.txt`.
2. Make the change.
3. **Diff the gap set** (strip the counts, sort, `diff`). Shapes that *appear*
   are as important as shapes that vanish: a shape appearing means something
   that used to read no longer does.
4. **Read back every new reading by hand.** A short script that prints
   `describeScript` beside the printed text for every card matching a wording
   is twenty lines and is the only thing that finds a wrong reading. Do not
   skip it because the diff looked clean — the diff *was* clean when three
   cards were being read wrongly.
5. Prefer unread to wrongly read (ground rule 5). Seven cards left alone beat
   three aimed at the wrong cards. If you leave a rule out, leave the comment
   in, naming the cards.

## The rest of Stage 2, re-ordered by the evidence

Measured on the live catalog, 9 Sep 2026 (`arena:tally`). The plan's table is
in the plan; this is what the cards actually print:

- **"reduce the skill cost by {o}" — 46 clauses, the largest single family.**
  A genuine primitive (`costModifier`), and the deepest: the cards reduce a
  *named skill's* cost ("the next time you activate a [Union] skill on a yellow
  <Vegito> card in your hand"), by **coloured orbs**, usually **once**. The
  consumer is `orbTotals` and the payment planner, in the frozen legacy engine.
  Scope it before starting; it is not a one-sitting job.
- **The "instead" family — a real `replace(event, with: block)`.** ~25 clauses.
  Note the hard part before you begin: 9-10 replacement happens *inside*
  `move()`, which is synchronous and called from everywhere, and a replacement
  *block* can prompt. The destination-only subset is what `replaceLeave`
  already does; the widening that pays is the **event** (leaving the Combo
  Area, leaving Life, a card being played) and the **subject** (not just this
  card). Say plainly where it stops.
- **Alternative costs** ("you can activate this card's [Counter] from your hand
  by X instead of paying its energy cost", 7+): `altCost` with `pay:
  "program"` already says this. **Wording gap**, not a primitive.
- **"isn't affected by your opponent's skills" (7)** — `immune(target, from,
  until)`, genuinely new and contained.
- **"for each marker on this card" (5)** — `Amount` → expression, the start of
  the `expr` work Stage 2 lists.

## The gate, every commit

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`,
`npx tsx --env-file-if-exists=.env.local scripts/arena-fuzz.mts 40` (0 crashes
required). A compiler change also needs the gap-set diff above. A change to
what the referee is told, or to a harness card, needs `npm run contract:emit` —
**review that diff**, and expect the probe digests to change by exactly the
cards you added.

## Things that cost an hour each to relearn

- **Never write engine source through `node -e`** — `\b` in a shell-quoted
  string becomes a backspace and silently kills a regex. Use the Edit tool.
- **A Vercel deploy that fails with a `0ms` build, no duration and no
  retrievable logs is almost certainly `npm run db:migrate` failing, not your
  code** — `vercel.json` runs it before `next build`, and the CLI cannot show
  logs for a deployment that never reached READY. On 9 Sep 2026 three
  deployments failed this way; running the same migration locally cleared it
  and every deploy since has been green. Check the code separately with a clean
  `npm run build` before believing it is yours.
- **`vercel build --yes` creates a new Vercel project** if the directory is not
  linked, and connects it to the GitHub repo. Do not run it in a worktree
  without intending that; remove the project afterwards.
- **`arena:fuzz 40` really does run 40 games now** — the argument used to be
  dropped when `--engine` was absent.
- The owner's `.env.local` carries `BASIC_AUTH_USER`, so **local dev sits
  behind Basic Auth on this machine** even though `CLAUDE.md` says it should
  not. Anything that needs the browser needs credentials from the owner.
- Ask about a rule only after the manual, Bandai's Q&A pages and the forums
  have come up empty — and when they have not settled it, say so in the note
  beside the rule. A ruling given in chat goes to the row first
  (`npm run arena:rule -- <cardId> "<the ruling>"`), and the code change waits
  to be asked for.

## Still open from Stage 1

The workbench's text view was never opened in a browser — the machine's Basic
Auth blocked it. Worth doing by hand once: open a corrected record, **Show as
text**, add a second trigger to WHEN, save, and check the probe pane's `attack`
scenario reports *fired*.
