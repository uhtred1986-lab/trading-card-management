# Arena rules engine — current work list

Rewritten 10 Sep 2026 to keep this file short and actionable. Use this file
for **current priorities only**. The round-by-round build notes, merged
increments and lessons learned now live in `docs/arena-history-lessons.md`.

## Start here

1. `docs/arena-next-session-prompt.md` — the live handover, current priority
   order and measurement discipline.
2. `docs/arena-tooling.md` — what each verification command proves.
3. `docs/arena-backlog.md` — the tracked issue list and stage table.
4. `docs/arena-history-lessons.md` — archived history and lessons; open it only
   when a current item needs earlier context.

## Current stage

- Stages 0 and 1 of the rules-language programme are done.
- Stage 2 (**Arena M1 — Rules correctness and parser coverage**) is the active
  compiler track.
- The standing rule remains: **prefer unread to wrongly read**, and update
  `src/lib/arena/glossary.ts` in the same commit as any change to what the
  compiler or engine understands.

## Priority order

1. **Run another wrongly-read clause audit** (`docs/arena-next-session-prompt.md`
   §4(a); backlog issue #93).
2. **Implement the structural side-parsing fix** in `parseTarget`
   (`docs/arena-side-scope.md`; backlog issue #94).
3. **Pay the remaining measured Stage 2 correctness debts**: specified-cost
   reducers (#96) and the skill-cost reduction family (#97).
4. **Continue the remaining Stage 2 primitives** from `docs/arena-backlog.md`
   once the items above are either merged or explicitly deferred.
5. **Keep capability-gap work separate** from wording commits: replacement
   prompting and marker/[Empower] follow-ups stay in
   `docs/arena-move-replacement-scope.md` and
   `docs/arena-markers-stage-scope.md`.

## Every increment

- Take fresh `arena:tally` and `arena:readings` baselines before editing.
- Diff the gap set **and** the readings; sign off moved readings by card.
- For code changes, keep the gate clean: `npm run typecheck`, `npm run lint`,
  `npm test`, `npm run build`, and
  `npx tsx --env-file-if-exists=.env.local scripts/arena-fuzz.mts 40`.
- Put durable lessons and completed-increment writeups in
  `docs/arena-history-lessons.md`, not back into this file.
