# BT31-141 Cell Jr. Summon: proposed replacement program (for #942, not applied)

Status: **proposal only**. This PR writes no database row. The stored owner-approved override for BT31-141 selects every Cell Jr. Token you control after creating, which also gives Blocker to tokens already in play (shown as a negative control in `scripts/verify/cell-binding-938-939.ts`). Its exact stored JSON is in the database and was not read.

Printed skill (front face, skill index 0, kind `activate:main/battle`):

> [Activate: Main/Battle] Play 2 Cell Jr. Tokens and they gain [Blocker] for the turn. (Cell Jr. Tokens have 10000 power, 0 combo cost, and 5000 combo power.)

Compiler output (`skillRecords`, zero unread clauses), as rules language:

```
WHEN [activate:main/battle]
THEN
  token(name: "Cell Jr. Token", power: 10000, comboCost: 0, comboPower: 5000, colors: [], n: 2, as: "t0")
  grant(target: $t0, keyword: [Blocker], until: turn)
```

As record JSON (`ops`; `trigger: []`, `cost: null`, `cond: null`):

```json
[
  {"op":"token","as":"t0","name":"Cell Jr. Token","power":10000,"comboCost":0,"comboPower":5000,"colors":[],"n":2},
  {"op":"grant","target":{"var":"t0"},"keyword":{"name":"Blocker"},"until":"turn"}
]
```

Guard requirements for whoever applies it (#942):
- Only after this PR is deployed: before it, the `token` op has no `as` and the validator would refuse the row.
- Exact guard: card `BT31-141`, front face, skill index 0, `printed` text equal to the line above; refuse if the stored row no longer matches the one reviewed.
- Preserve ownership: it replaces an owner-approved override, so the owner confirms the replacement; do not bulk-refresh. Keep the old row's JSON in the change note so it can be restored.
- After applying, run the workbench reading of the row and play one Main activation with a Cell Jr. Token already in play: only the two new tokens may show Blocker.
- The Cell Leader (BT31-116) nested invocation and any whole-deck readiness are separate and not claimed here.
