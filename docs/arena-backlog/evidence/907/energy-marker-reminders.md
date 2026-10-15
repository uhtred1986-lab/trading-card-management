# Energy Marker reminder classification — #907

Owner approved this fix on 15 October 2026 after reviewing the repeated Energy
Marker reminder text. Energy Markers remain catalog accessories; their reminder
text is outside the playable-card skill review scope.

## Rules basis and existing implementation

[Official Masters rule manual, version 4.00](https://www.dbs-cardgame.com/pdf/rulemanual.pdf?ver_4.00):
1-14-1/2/3 and 6-2-1-11. The second player starts with one Energy Marker. A player
can remove a marker instead of switching one energy matching the Leader's color
to Rest Mode when paying energy, combo or skill costs. Markers are neither cards
nor energy. This general game mechanic is independent of Heroic. No card-specific
Q&A ruling is required for these identical global reminders; this change does
not interpret any Battle/Extra card's own marker-related skill.

The shipped `src/lib/arena/rulesets/dbs/game.rules` declares `setupEnergyMarker`;
`src/lib/arena/rulesets/dbs/costs.rules` and `src/lib/arena/vm/costs.ts` already
support marker payments. Existing setup and VM cost proofs cover that behavior.
No new engine behavior or compiler effect is introduced.

## Delivered behavior

- Normalize the catalog card type and exclude only `ENERGY MARKER` accessories
  from skill drafting and skill-review counts, worklists, groups and approvals.
- Keep the catalog entries and every historical rule row unchanged, including
  compiler-open/draft, user-confirmed/corrected and Claude-draft interpretations.
  Filtering occurs before drafting iterates cards, so its stale-skill cleanup
  cannot delete an accessory's legacy rows.
- Exclude reminder rows from automatic Claude review and stale direct review IDs;
  they cannot be approved individually, in guided review or through bulk wording
  confirmation. Genuine Battle/Extra card skills mentioning Energy Markers keep
  their ordinary interpretation and review requirements.
- Low-level `loadRules` continues to expose stored historical records. This is
  classification, not a database cleanup, empty program or silent approval.

## Census interpretation

The 15 October snapshot remains a dated raw database census: 1,963 unread stored
skills across 1,694 catalog entries, including 40 Energy Marker accessories.
This fix does not rewrite that snapshot or the live database. Applying the new
review scope to that snapshot gives **1,923 unread playable-card skills across
1,654 non-marker cards**. These are derived scope-adjusted counts, not a fresh
live read or a claim that the other cards are implemented.

The forty entries below all share the same global reminder scope; each has one
unread front-face skill at index 0 in the original audit. All are addressed by
the card-type guard, with catalog/history preserved. Raw source:
`docs/rules-audit-2026-10-15/audit.json` (the planning audit).

| Catalog entry | Classification outcome |
|---|---|
| BT31-EM03 | Game-rule reminder; excluded from playable skill review |
| BT31-EM05 | Game-rule reminder; excluded from playable skill review |
| M-01 | Game-rule reminder; excluded from playable skill review |
| M-03 | Game-rule reminder; excluded from playable skill review |
| M-04 | Game-rule reminder; excluded from playable skill review |
| M-07 | Game-rule reminder; excluded from playable skill review |
| M-09 | Game-rule reminder; excluded from playable skill review |
| M-10 | Game-rule reminder; excluded from playable skill review |
| M-11 | Game-rule reminder; excluded from playable skill review |
| M-12 | Game-rule reminder; excluded from playable skill review |
| M-14 | Game-rule reminder; excluded from playable skill review |
| M-17 | Game-rule reminder; excluded from playable skill review |
| M-19 | Game-rule reminder; excluded from playable skill review |
| M-20 | Game-rule reminder; excluded from playable skill review |
| M-22 | Game-rule reminder; excluded from playable skill review |
| M-23 | Game-rule reminder; excluded from playable skill review |
| M-24 | Game-rule reminder; excluded from playable skill review |
| M-26 | Game-rule reminder; excluded from playable skill review |
| M-27 | Game-rule reminder; excluded from playable skill review |
| M-28 | Game-rule reminder; excluded from playable skill review |
| M-29 | Game-rule reminder; excluded from playable skill review |
| M-30 | Game-rule reminder; excluded from playable skill review |
| M-31 | Game-rule reminder; excluded from playable skill review |
| M-32 | Game-rule reminder; excluded from playable skill review |
| M-33 | Game-rule reminder; excluded from playable skill review |
| M-34 | Game-rule reminder; excluded from playable skill review |
| M-35 | Game-rule reminder; excluded from playable skill review |
| M-36 | Game-rule reminder; excluded from playable skill review |
| M-38 | Game-rule reminder; excluded from playable skill review |
| M-39 | Game-rule reminder; excluded from playable skill review |
| M-40 | Game-rule reminder; excluded from playable skill review |
| M-41 | Game-rule reminder; excluded from playable skill review |
| M-42 | Game-rule reminder; excluded from playable skill review |
| M-43 | Game-rule reminder; excluded from playable skill review |
| M-45 | Game-rule reminder; excluded from playable skill review |
| M-49 | Game-rule reminder; excluded from playable skill review |
| M-50 | Game-rule reminder; excluded from playable skill review |
| M-51 | Game-rule reminder; excluded from playable skill review |
| M-52 | Game-rule reminder; excluded from playable skill review |
| M-53 | Game-rule reminder; excluded from playable skill review |

## Verification

`verifyMarkerReminders` in `scripts/verify-rule-review-db.mts`, executed by
`scripts/verify-db.mts` and `npm test`, seeds legacy marker records of every
ownership category, including normalized card types and an accessory with no
rule. It checks queue/worklist/pagination/status/group/sibling exclusion; stale
direct-ID refusal; individual, guided, explanation and bulk approval guards;
zero Claude review requests; no new reminder rows; and exact field-for-field
preservation of all raw marker rules after regular and only-open drafting.
A genuine Battle Card that creates an Energy Marker still compiles to the
existing `energyMarker` operation, appears in review and can be approved.

No UI component, layout, schema, dependency or production configuration changed.
Counts and queue content derive from these stores; no new screenshots are
appropriate for this data-classification change. The glossary explains the
existing game-rule support in its current reading-rules list.

Final local validation is recorded in the pull request. No live database writes,
sync, migrations or paid API calls were run.
