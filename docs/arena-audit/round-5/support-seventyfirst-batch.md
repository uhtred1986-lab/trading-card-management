# Support checkpoint 71: standalone mixed-negation board adapters

Source `00f9e096` and registry `37d601c9` add the R513 board observer and synchronous transaction adapter. These remain unimported by gameplay; this checkpoint admits no additional cards.

The observer derives physical holders, owners, source records and battle roles from actual state. The transaction validates original history and arrival witnesses, then publishes mixed history and existing grant-deletion receipts together. Deleted copied/keyword grants stay deleted; ordinary Battle-only self-protection does not apply in Combo. Unsupported Permanent records, copied sources, specialized protection and departed battle roles remain explicit bounds.

The worker passed 44 staged-board adapter cases, 197 isolated contracts and 24 legacy transaction cases (265 distinct cases), plus typecheck and touched-source lint. Root reran the 44 adapter cases on the combined R512 head, checked metadata lint and whitespace, and generated/validated all 222 capability sites. Staged transfers are not native gameplay proof. No compiler, runtime census or browser rerun was needed for these unimported helpers; checkpoint 69's record counts and checkpoint 68's browser proof remain the latest evidence.

Full frozen catalog remains 6,597 cards / 13,965 records: 13,020 readable / 945 unread; runtime census remains 3 readable runtime gaps / 308 additional blocked records / 2,568 contextual unknowns. Those are record categories, not complete-card support counts.

Native Combo entry, battle-role changes, original cleanup-batch history and special Drop triggers remain R513 stage 2b work. R514's five Broly under-card Activate permissions continue independently. No database writes, dependencies, migrations, merge or deployment occurred. See [the mechanism receipt](combo-standing-contract.md).
