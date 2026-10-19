# Typed Union payment slice — #907 evidence for #923

This matrix tracks two printed payment paths selected for #907: Fusion on
BT11-013 and Absorb on BT3-070. It supplements the full card inventory; it does
not generalize coverage to the other Union cards. The baseline inventory calls
both rows `runtime-unproven`; later focused verifiers cover narrower contracts
listed below. The new #907 implementation's end-to-end result remains pending
until its exact proof run and artifact hashes are recorded here.

## Rules and printed sources

The relevant rules are the checked-in `docs/rules/rulemanual.txt`:

- Fusion declaration/materials: 22-13-4-2 requires one of each specified
  character with equal power; 22-13-4-4 places those materials in Drop as the
  Union cost; 22-13-4-4-1 then determines and pays any necessary skill cost.
- Absorb: 22-13-6-1 defines the skill cost and effect; 22-13-6-2 requires
  activation from Battle; 22-13-6-3 plays the specified Battle Card on top of
  the source.
- General skill payment: 5-8-1 through 5-8-4 require full payment, including
  complete performance of an action cost. Colored spheres switch matching
  energy to Rest Mode under 1-6-5-2.

Printed source text and applicable corrections:

| Card / face / skill | Exact current skill text relevant to payment | Provenance |
| --- | --- | --- |
| BT11-013 / front / 10 | `[union-fusion]{r}{r}{r}, draw 2 cards: Red <Son Goku: Br> and red <Vegeta: Br>.` | 15 Oct inventory and card index; `scripts/verify/keyword-action-costs-926.ts` carries this exact line in its fixture. |
| BT3-070 / front / 0 | `[union absorb] {g} , choose 1 each of <Android 14> and <Android 15> from your Drop Area and place them under this card: Choose up to 1 <Android 13> with an energy cost of 7 from your deck and play it on top of this card. Then, shuffle your deck.` | Official errata dated 2018-03-02 changes `choose up to 1 each` to `choose 1 each`; see `official-references.json` and `src/lib/catalog/errata.ts`. The 15 Oct inventory retains pre-errata wording, so it is not the runtime source of truth for that phrase. |

The official BT3-070 FAQ indexed in `official-references.json` addresses deck
search privacy only; it does not add a payment ruling. No card-specific payment
ruling is claimed here.

## Evidence matrix

Statuses distinguish existing focused verifier coverage from the new #907
typed-record path. A verifier's assertions are recorded as evidence of its
scope; this documentation task did not execute those scripts.

| Variant / exact case | Existing supported-with-proof scope | New #907 typed slice status | Remaining proof required |
| --- | --- | --- | --- |
| Fusion — BT11-013 with three red energy, two equal-power qualifying materials in hand, and at least two cards in deck | #926 verifier covers offer, material choice, all three red energy rested, both materials in Drop, draw two after materials, one skill announcement, both seats, JSON reload at every step, and the drawn card visible only to its owner. | Pending worker evidence. Existing #926 coverage does not certify the new authoritative typed record or its fresh persisted loader. | Show the compiled typed components survive storage/load exactly and drive the live offer/payment/replay path. Record source, stored-program and ruleset revisions/hashes. |
| Fusion — negatives | #926 covers fewer than three energy, a one-card deck refusing a draw-two price, a forged declaration refused without payment, exactly two deck cards as payable, and a deck that becomes too small after declaration: materials stay paid, partial draw does not occur, activation is not announced. | Pending worker evidence. | Preserve each result through the new record path. Include unequal-power, wrong-name/color or unavailable material refusal if the new implementation changes the material offer boundary. |
| Fusion — payment ordering | #926 proves the draw action occurs after both materials reach Drop. It pays the red spheres at declaration before the material selection; #926 documents this as a log-order difference with no energy-area interaction, while the draw is paid after Fusion materials per 22-13-4-4-1. | Pending worker evidence. | State the typed contract's exact checkpoints. Do not describe the test as proving that all cost components happen after material placement. |
| Absorb — BT3-070 required pair | #930 verifier covers the errata-corrected required Android 14 + Android 15 cost from Drop, one green orb, target Android 13 from deck, pair placed under the source and Android 13 played on top; both seats and JSON reload at each step. It checks each named material separately when duplicate candidates exist. | Pending worker evidence. | Prove cost components are in the typed stored record, loaded by the current runner, and paid through the same offer/payment/replay path. Verify target/source binding is preserved. |
| Absorb — negatives | #930 covers a missing member, two Android 14s instead of one of each, the pair only in hand, no green orb, a forged activation, and wrong-name/wrong-area card picks refused. | Pending worker evidence. | Preserve these exact refusals through the typed path; assert no partial cost or target movement when declaration is unavailable. |
| Serialization / stale record boundary | The #926 and #930 focused verifiers reload VM state at each prompt and construct stored-row cases. This establishes those test paths only. | Pending worker evidence. | Record the rejection condition. Prove a freshly rebuilt record executes and an old record/save fails closed with an actionable rebuild instruction. |
| Application / live rules | Not established by either verifier. | Not established by compiler or unit proof alone. | Keep compiler delivery, loaded/current stored-rule application, and production refresh receipts separate. Do not infer a current database row from the focused source tests. |

## Compatibility decision and repair path

Owner decision, 19 October 2026: this typed-record change has no backward
compatibility requirement. It may reject old stored records, generated offline
exports and serialized saves. The intended path is to rebuild those artifacts
using the new typed contract; there is no legacy fallback. The worker proof is
still pending, so this records the required contract rather than claiming the
rebuild path has been implemented or exercised.

For stored compiler rows, the guarded refresh tool supports a read-only
classification first. After reviewing the proposed rows, any write is a
separately authorized operation against the app database:

```sh
npm run arena:refresh-ids -- --ids "BT11-013#10,BT3-070#0"
npm run arena:refresh-ids -- --apply --ids "BT11-013#10,BT3-070#0"
```

The first command is the dry run; the second writes and must not be run without
separate authorization. `scripts/arena-refresh-ids.mts` and
`scripts/lib/refresh-ids.ts` show that normal refresh writes are limited to
compiler-owned `draft`/`open` rows and that confirmed, corrected or other
person-owned rows are excluded. If the new native activated-keyword record has
no stored row, `npm run arena:draft -- --card <CARD-ID>` is the existing catalog
draft path; `scripts/arena-draft.mts` writes to `card_rules` directly and has no
dry-run flag, so that too requires separate authorization. Neither path may
silently replace a confirmed/corrected interpretation. Such edits retain the
review/reopen process; owner or corrected rows are not compiler refresh
targets. This matrix task did not invoke either writer or database command.

## Receipt and version boundaries

Baseline branch revision: `324d2a5e6e3dd8fddf444fcf138aec6cb90809b9`.

Relevant source SHA-256 values at that revision:

| Artifact | SHA-256 |
| --- | --- |
| `docs/arena-backlog/evidence/923/inventory.json` | `133344b946883ab47be06bd1ddf1c1f6ec4f0abca1aec80fa13a56dad63fd3a3` |
| `docs/arena-backlog/evidence/923/cards.md` | `e728daa7a927f8f377bcfcf125716de8b7fe771cd8317368982f658c127698b1` |
| `docs/rules/rulemanual.txt` | `34fd22c890ad4ffbe873c18e302aae4ee6ec87dd7eef5dff61d64a245b91bd6e` |
| `scripts/verify/keyword-action-costs-926.ts` | `3ba768235eb45fba3d03b14f0b2c5741dd8b7b879930612c3ea5fa995dd1a4ba` |
| `scripts/verify/union-sources-930.ts` | `b76d4895294ba1e904632dcd7df398fcf79d59c43f33c21a59815e56dd13a191` |
| `src/lib/catalog/errata.ts` | `af5cc3129c9df4b0e28ed42caebc2a90645046b95cb1e2e1c1e518b3256632d0` |

Current issue snapshots read for this matrix:

| Snapshot | SHA-256 | Relevant boundary |
| --- | --- | --- |
| `/workspace/rules-evidence/923-current.json` | `a6a0b157eddd3e593610113ca0b349f587a980448a35ce9262fcbb71774fe047` | #923 says existing inventory is dated syntax evidence and asks for runtime proof per case. |
| `/workspace/rules-evidence/929-current.json` | `0898e632f4b3ea3f142b7bdac1aab3d1dccb8edb2a38631f59a8522335628859` | #1017 Counter/failed-entry handling is delivered; its residual matrix remains an audit task. |
| `/workspace/rules-evidence/930-current.json` | `1fd0048b723b6f96c3ec26d392611fb54b72ae4b7479471aaf289c28cab9f058` | #1019 source/cost support is delivered; reconcile residual indexed clauses. |
| `/workspace/rules-evidence/907.json` | `a92ae66ef12764e6103b196d1d93f4fc370162df985471a1afc1d2c1d5902dd6` | 18 Oct receipt comment reports #1017's 52 Absorb lines and #1019's 8 refreshed / 16 already-current rows; it names no BT3-070 row identity. It is historical application evidence, not proof of today's loaded row. |

The #1019 receipt also notes BT4-018 unread and BT28-012 source correction.
Those facts do not establish whether BT3-070 was among refreshed or already
current rows. This matrix makes no BT3-070 production-row claim. The #907
worker's test result, exact commit, and new source/program hashes should be
added above before anyone marks the new typed slice supported-with-proof.
