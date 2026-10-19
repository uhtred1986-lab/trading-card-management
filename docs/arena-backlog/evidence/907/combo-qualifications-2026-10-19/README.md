# #907 typed combo qualifications

Scope: BT6-006 front #10, BT6-010 front #0, BT6-066 front #0 and BT6-070
front #0, from the existing selected public BT6 pair. Starting main is
`1aa8e3c60a13a763d7282be91dcb6bfe45303060` (#1069).

The executable record carries a versioned combo qualification beside its trigger:
self identity, entry versus this battle's normal cleanup, allowed origins and
controller/opponent/either turn. The existing trigger language, loader, VM,
pending queue and replay machinery execute it. A changed stored qualification
controls behavior; display wording does not restore an older qualification.
Obsolete or malformed rows and saved contexts require rebuilding explicitly.

[Official online sources](online-sources.md) match the frozen card text. The
current manual and FAQ distinguish BT6-010's later battle-end trigger from
BT6-066's already-pending entry Auto after Jaco returns the card to hand.
No applicable errata or unresolved semantic conflict was found. Public forum
searches and their access limits are recorded separately from official authority.

## Scope and preservation

The existing [selected-pair catalog and 67 actual stored rows](../../897/selected-pair-inputs-2026-10-19/README.md)
remain frozen. Rebuilt offline programs demonstrate the new contract; they are
not an application receipt or human confirmation. The four corrected user rows
are untouched. No private decks/replays, database read/write, additional pair,
policy change or AI-strength work is part of this increment.

The shared compiler path also gives typed combo metadata to six existing
starter Auto programs. [The exact comparator](compare-controls.py) permits only
those enumerated migrations, including moving BT6-010's redundant effect-time
turn guard into event qualification. Every other executable field and gameplay
expectation must remain unchanged. The clean-main baseline completed all 16
games and exactly matched the #1068 control receipt before implementation.

## Deployment and application are separate

This work is prepared as one **draft PR**, as requested. Its additive nullable
`card_rules.combo` migration has not run against production. No engine deployment
or live stored-rule application is claimed. Existing combo rows need a guarded
rebuild after deployment; missing metadata must not be patched from runtime text.
Compiler drafts remain unconfirmed, and protected corrections require their own
reviewed migration rather than compiler replacement.

Other unread clauses, usage/sparking/native-identity metadata, remaining Union
variants and protected-record migration still block the selected pair. #897,
#907, #923, #929 and #930 remain open; #932 remains completed. A completed starter
match does not establish per-skill exercise or qualification of the selected pair.

**Next single action:** review the combined draft PR, then deploy its migration
and engine before a guarded four-target compiler-draft refresh and actual-export
verification. Reconcile current source/status/version first; do not repeat any
earlier reference refresh or overwrite the four protected corrected rows.
