# Prompt for the next arena session

Paste the block below into a fresh session. It is written to be handed over
without editing; everything it needs to find is in the repo.

---

Continue the arena rules-engine work. Read `docs/arena-next-stage-spec.md`
first — §1 for the current numbers and the commands that produce them, §2 for
the ground rules, and **§6a for what the last stretch taught**, which changes
what is worth doing next. `docs/arena-rules-worklist.md` has the round-by-round
history and the reasoning behind each rule; read a section when you touch what
it describes.

**Before anything else, check where the work landed.** PR #22
(`feature/arena-compiler-next` → `main`) was opened on 6 Sep 2026 and may or may
not have been merged. If it merged, delete the merged remote branches
(`feature/arena-compiler-next`, and `feature/arena-counter-chains` if it is now
an ancestor of `main`) and branch fresh off `main`. If it did not, work on that
branch and leave the merge to the owner. Its Vercel check was red, as was every
other recent commit's — that is the known infrastructure failure, not the code;
`npm run build` passes locally.

## First: a quality check of the last stretch, before adding anything

That stretch was mostly **correctness fixes to clauses that already compiled**,
which means nothing in `arena:gaps` would have caught them and nothing will
catch a mistake in them either. Spend the first hour proving they are right,
and say plainly if one is not — finding a wrong fix is a better outcome than
finding none.

1. **Re-run the audits from §6a**, which are the cheapest broad check. Write
   probes that read what the compiler records — `reason` on a `choose`, `label`
   on a `delay` — and compare it with the compiled result: side, area, count,
   and every measure the filter should carry. They came back clean on 6 Sep;
   if they still do, that is one paragraph in the worklist and you move on.
   Expect the first run of a new probe to be mostly its own noise.
2. **Two changes were broad and are worth a second pair of eyes:**
   - *Colours now mean "either", not "all"* (`matches` in `filters.ts`). Check
     that `multiColor` is genuinely the only wording that means one card in
     both colours, and that nothing else relied on the old reading.
   - *Three guards stop `splitClauses` cutting lists* (`inList`,
     `andEndsAList`, `andJoinsTwoAreas`). The failure mode is the opposite of
     the one they fixed: two real instructions merged into one unreadable
     clause. Sample the clauses they now protect and check none of them is a
     sentence break.
3. **The turn-ownership work changes *when* things happen in every game**, so
   it deserves a played-out check rather than a unit test: `npm run
   arena:playthrough`, and read the log for effects firing on the wrong turn or
   twice.
4. **`subjectFilterOf` now gates skills** — a wrong filter there stops a skill
   that should happen, which is the failure the ground rules call worse than an
   over-fire. Sample the triggers it filters and confirm each filter is one the
   clause really states.
5. Run the full gate: `npm run typecheck`, `npm run lint`, `npm test`,
   `npm run build`, `npm run arena:fuzz 40` (0 crashes required).

## Then: continue

Take the next piece from `npm run arena:gaps -- --decks` — the owner's own
decks are the measure that matters for real games, and they are at 91.7 %
against a target of 95 %. The catalog-wide list is in `arena:gaps` without the
flag; §6.x of the spec lists the mechanisms still missing, with the evidence
for each.

Ground rules that are easy to forget and expensive to relearn: never write a
regex through `node -e` (it eats `\b`); a trigger regex that matches nothing
looks exactly like progress; check whether a new fuzz failure is yours before
fixing it, by restoring the changed files from `HEAD` and re-running the seed.

Ask about a rule only after the manual, Bandai's Q&A pages and the forums have
come up empty — and when they have not settled it, say so in the note beside
the rule.
