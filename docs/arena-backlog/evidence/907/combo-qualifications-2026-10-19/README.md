# #907 typed combo qualifications

Combined [draft PR #1070](https://github.com/uhtred1986-lab/trading-card-management/pull/1070).

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

**Exposed old misread repaired:** BT6-066's compiler placed its return-and-shuffle
tail outside the optional exact-two selection. Declining alone advanced seeded
RNG from `936389962` to `48789504`, despite choosing no cards. The narrow shared
grammar repair keeps that joined shuffle tail inside the existing optional
offer; the draw still requires the complete exact-two choice. The failing
counterexample is retained in the focused proof. This corrects an unverified
decline behavior; no previously verified gameplay expectation is rebaselined.

**Stale validation fixtures reconciled:** the language suite still expected a
null free-Auto cost although #1066 (`04f0e21e`) already writes payment v1's exact
zero-price record. Its assertion now checks that complete record. The standalone
`language.ts --emit` also exposes two old fixture gaps: #1066's `UNREAD` price
syntax and #1068's (`ec22e423`) `FUSION` syntax plus granted-Union variant/price
fields. Only those 26 added/updated reference lines changed; the state-text
fixture is unchanged. Independent review traced these to the earlier commits.
No operation schema or Snapshot behavior changed in this reconciliation, and
the full contract-emission runner was not invoked.

## Integrated validation

Integrated runtime code: `4b0ce6cb48c695d8240a3fed24b900f965fc26bb`, cherry-picked
unchanged from independently reviewed worker commit `6833b982`. Later changes
are provenance test integration, the explicitly reviewed old language fixtures
and this evidence. No remaining code-review blocker was found.

- [36-case scenario receipt](scenario-receipt.json): actual frozen card text on
  both seats; positive/negative self, origin, turn, leader/life, exact payment,
  cleanup, pending-after-return, target and duration cases; stored qualification
  mutation, language/blocks, obsolete/malformed event/pending/frame refusal and
  deterministic saved-action replay.
- [Exact starter comparison](control-preservation.json) against #1068 and
  [integrated pack](starter-compiler-pack.json): **16/16 completed**, zero
  illegal/interrupted/limited/crashed/other; every full game/trace unchanged.
  Exactly six enumerated combo program migrations, 69 unchanged programs.
  No gameplay expectation was changed.
- [Frozen stored admission](stored-admission.json): same 28 catalog cards and
  67 physical rows, both decks refused, zero scheduled games and zero additional
  qualification. Missing combo/payment and other residual blockers stay explicit.
- [Four-record ledger](record-ledger.json): frozen source hashes, row identities/
  versions, old refused loaded hashes and new reloaded hashes. Each new reloaded
  record was independently asserted equal to the fresh typed compiler program;
  no database version or application is invented for the offline fixture.
- Provenance/admission, language, language round-trip, blocks (108 rules) and
  guarded PGlite refresh checks pass. The additive migration was exercised in
  PGlite; snapshot review proves it adds only nullable `combo`.
- Existing hand-combo #572, entry #672, qualified entry #907, battle-end
  follow-up #907 and optional-exact #538 scripts pass with their gameplay
  assertions retained. Their old compatibility/representation assertions now
  check the current typed contract and explicit old-record refusal.
- Typecheck passes. Full lint and the final changed-test lint pass with only
  the five existing prototype warnings in the full run. Whitespace review
  preserves the glossary's original CRLF format.

No full `npm test`, `verify-arena`, build, live fuzz or paid AI run was performed,
per the owner's essential-check instruction. No production migration/read/write,
deployment, human confirmation or Testing & stats import is claimed.

## Pending application

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

## Reproduction and separate measures

Run without the shared database variable:

```sh
env -u DATABASE_URL npx tsx scripts/verify/typed-combo-907.ts --out /tmp/combo-proof.json
env -u DATABASE_URL npx tsx scripts/verify/arena-corpus-provenance.mts
env -u DATABASE_URL npx tsx scripts/verify/reviewed-rule-refresh.mts
env -u DATABASE_URL npx tsx scripts/arena-corpus-freeze.mts --mode compiler --check --pairs 4 --max-moves 3000 --seed-base 897000 --out /tmp/combo-starters.json
python3 docs/arena-backlog/evidence/907/combo-qualifications-2026-10-19/compare-controls.py /tmp/combo-starters.json /tmp/combo-preservation.json
```

After actual guarded application, pass `--stored-rules <actual-public-export>`
to the same four-card proof. That mode must consume all four exact target rows;
it cannot substitute freshly compiled rows for a missing target. Keep private
exports private. An offline rebuilt fixture is never labeled an actual readback.

| Measure | Meaning and limit |
| --- | --- |
| Parsed | Four scoped skills emit typed combo qualifications; this is not a new catalog census. |
| Executable | Rebuilt records pass through the real match loader and VM; the frozen pre-migration rows remain blocked. |
| Reviewed | Independent code review and official semantic sources; zero human-confirmed database rows. |
| Verified/exercised | Explicit card/interaction scenarios on both seats, saved continuations and deterministic action replay; starter deck membership does not establish per-skill exercise. |
| Qualified | Zero additional decks; selected-pair admission still has other blockers. |

**Next single action:** review the combined draft PR, then deploy its migration
and engine before a guarded four-target compiler-draft refresh and actual-export
verification. Reconcile current source/status/version first; do not repeat any
earlier reference refresh or overwrite the four protected corrected rows.
