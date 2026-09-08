# Task for Claude Code — branch `feature/arena-rules-records`

You are on a branch that contains only documents. Nothing here is implemented yet.

Read, in this order:

1. `docs/arena-rules-workbench-spec.md` — the brief. It is the contract.
2. `docs/arena-rules-workbench-prototype.html` — open it in a browser. It is the UX target for
   `/arena/rules`; do not copy its code, match its layout, states and wording.
3. `docs/arena-rules-worklist.md` and `docs/arena-design-proposal.md` §14 — what exists today
   and why. The interpreter, flow, keywords and triggers are kept; read those sections before
   assuming what has to change.

Then:

- Plan first. Show me the plan before editing: the `OP_SCHEMA` table (§3.2) as an actual TypeScript
  literal for every current `Op`, the migration (§3.4), and the removal list (§3.8) checked
  against the real files — name anything in §3.8 that does not exist or is used somewhere the
  brief did not expect.
- Implement **phase 1** (§3) only, commits in the order §3.8 prescribes. Phases 2 and 3 are later
  sessions.
- This is a slimming pass as much as a feature: `src/lib/arena` must end with fewer lines than on
  `main`. Every commit message carries the numbers (rows drafted, tests, lines in/out).
- Nothing merges to `main`. When §3.9 is met: rebase on `main`, run `npm test`, `lint`,
  `typecheck`, `arena:fuzz 100`, and open the PR with the cleanup ledger as its description.

Stop and ask when:

- `engine.ts` would need a change beyond §3.5 to read rules from rows.
- `card_scripts` contains a row the migration in §3.4 cannot classify.
- the sync entry point in §3.7 is not where the brief guesses; say where it is and proceed there.
