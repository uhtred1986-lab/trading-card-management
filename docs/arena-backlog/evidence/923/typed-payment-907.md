# Typed Union payment slice — #907 evidence for #923

This matrix tracks two printed payment paths selected for #907: Fusion on
BT11-013 and Absorb on BT3-070. It supplements the full card inventory; it does
not generalize coverage to the other Union cards. The baseline inventory calls
both rows `runtime-unproven`; later focused verifiers cover narrower contracts
listed below. #907 adds typed payment authority for BT11-013's stored Fusion
cost; it does not make either inventory row a blanket certification of the
card's full text or every Union variant.

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
| Fusion — BT11-013 with three red energy, qualifying equal-power materials, and at least two cards in deck | #926 covers the printed path, material choice, red energy, materials in Drop, draw after materials, one announcement, both seats, JSON state reload, and drawer-only visibility. | **Supported-with-proof for the typed payment contract:** `typed-payment-907.ts` constructs the versioned stored record from `skillRecords`, loads it through `rulesFromRows`, and runs legal offer, payment and play on both seats with executable context and VM state cloned at every step. The successful case pays three red energy and draws two. | This proves the stored payment authority used by the fixture record and loader. It does not establish whole-card authority, every material condition, or live database application. |
| Fusion — payment authority and display independence | #926 covers the original printed payment. | **Supported-with-proof:** changing only stored `CostRecord` from RRR/draw-two to R/draw-one makes the move payable at one energy and charges one draw; changing only `cost.text` changes no outcome; changing the live printed cost after loading to Blue/draw-99 neither replaces nor cheapens the stored Red/draw-two payment. | No runtime printed-text fallback is accepted for payment. This is limited to the typed payment fields exercised by the script. |
| Fusion — refusal and mid-payment failure | #926 covers fewer than three energy, one-card draw-two refusal, forged declaration, exact two-card deck, and the draw becoming impossible after declaration with no partial draw or announcement. | **Supported-with-proof:** the new contract refuses obsolete version, missing row, malformed negative orb, unreadable cost and invalid X; forged activations throw without state mutation. A saved continuation where the deck becomes too small after energy and material payment does not play the Fusion, draw partially or announce the skill; those payments remain paid. | The new script does not replace #926's per-card coverage of all printed material-filter negatives. |
| Fusion — checkpoint order | #926 proves draw payment occurs after materials reach Drop. It pays red spheres at declaration before material selection, and documents the log-order difference; #907's saved failure case confirms paid resources/materials remain paid if the later draw cannot complete. | **Supported-with-proof for the tested action-price continuation.** | Do not say every payment component occurs after material placement. Full Union material/activation authority remains a separate boundary. |
| Absorb — BT3-070 required pair | #930 covers the errata-corrected required Android 14 + Android 15 cost from Drop, one green orb, target Android 13 from deck, pair placed under the source and Android 13 played on top; both seats, each-name choice and state reload at each step. | **Preserved proof:** the unchanged #930 verifier passes against the new stored loader. | The #907 typed-payment script does not add a BT3-070 live-row application claim; this remains focused verifier evidence. |
| Absorb — negatives | #930 covers a missing member, duplicate Android 14 instead of one of each, pair only in hand, no green orb, forged activation, and wrong-name/wrong-area picks. | **Preserved proof:** unchanged #930 cases pass against the new stored loader. | No new #907 Absorb payment implementation is claimed. |
| Shared payment forms and granted Fusion | No BT11-013 / P-360 stored-price mutation in #926 or #930. | **Supported-with-proof:** the new verifier exercises typed either-color, marker, Burst and Spirit Boost costs and their shortfall refusals. It mutates the P-360 typed grant payment from red+blue+generic to one red orb and proves the granted activation uses that stored one-red price. | Does not prove every granted Union line or all support cards. |
| Serialization / stale record boundary | Prior #926/#930 proofs reload VM state and construct stored-row cases. | **Supported-with-proof within fixture scope:** new verifier clones the executable context and VM state at every step, replays the same actions, and compares final state/context and events. It explicitly refuses obsolete/missing/malformed/unreadable/invalid-X payment records instead of falling back to printed text. | Offline exports and saves outside these fixtures still need rebuilding under the current format; no compatibility fallback is promised. |
| Application / live rules | Not established by either verifier. | Not established by compiler or unit proof alone. | Keep compiler delivery, loaded/current stored-rule application, and production refresh receipts separate. Do not infer a current database row from the focused source tests. |

## Still outside this slice

| Remaining authority boundary | Current evidence |
| --- | --- |
| Counter cards with printed resource/action prices | Direct Counter payment authority is outside this slice. #929's window and failed-entry cases do not prove that typed payments govern a Counter's printed price. |
| Union material, trigger and full printed-text authority | Payment is typed, but Fusion/Absorb material procedure, Union activation/source identity and triggered effects are not made generally authoritative by these cases. Preserve #929/#930's narrow proofs; leave other indexed clauses unproven or blocked. |
| #897 starter final control | Pending coordinator's separate final README/evidence; this matrix does not qualify the selected starter pair. |

The focused #929 Counter/failed-entry, #930 source/grant, and relevant
rule-language roundtrip checks passed as preservation controls for this worker
slice. The coordinator also reports `auto-costs-549.ts` passed as an
integration control. These checks do not expand the payment authority claimed
above.

## Compatibility decision and repair path

Owner decision, 19 October 2026: this typed-record change has no backward
compatibility requirement. It may reject old stored records, generated offline
exports and serialized saves. The intended path is to rebuild those artifacts
using the new typed contract; there is no legacy fallback. The focused worker
and reviewer proof passed for the fixture cases below. The coordinator rerun
and #897 starter final control remain separate; this matrix does not claim that
external exports or saves have already been rebuilt.

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

Runtime implementation and frozen controls: `ecd3cfec2f5cd974358a95e5eedf7f9e25754ae8`.
The new scenario's current official source attributes were corrected in
`1ad23a12de4acce64c2948581be2cc525c39f713`; its payment expectations are unchanged.
Final focused verifier at `e1945ffac5a42422a61633f93aefda1510b975ba`;
`scripts/verify/typed-payment-907.ts` SHA-256: `a16be9a280502ab1e3ef791fd0ef66646ec6b2daa4370cf41d5d65eed1ceb82a`.
Worker/reviewer proof and coordinator reruns passed, including the corrected
reference. No database refresh or live application is included in that proof.

The [online check](../907/typed-payment-2026-10-19/online-sources.md) confirms
BT3-070's erratum and records official Fusion material-before-skill-cost timing.
At #1066, VM energy payment still preceded material selection: an explicit
preexisting procedural limitation, not certified by that typed-authority proof.
The #1067 follow-up below repairs that checkpoint. BT11-013's current printed
20,000 power, cost5/Red3 and Saiyan trait are in the new fixture; #926's historical
35,000 fixture remains a separate preservation control.

Current issue snapshots read for this matrix:

| Snapshot | SHA-256 | Relevant boundary |
| --- | --- | --- |
| `/workspace/rules-evidence/923-current.json` | `a6a0b157eddd3e593610113ca0b349f587a980448a35ce9262fcbb71774fe047` | #923 says existing inventory is dated syntax evidence and asks for runtime proof per case. |
| `/workspace/rules-evidence/929-current.json` | `0898e632f4b3ea3f142b7bdac1aab3d1dccb8edb2a38631f59a8522335628859` | #1017 Counter/failed-entry handling is delivered; its residual matrix remains an audit task. |
| `/workspace/rules-evidence/930-current.json` | `1fd0048b723b6f96c3ec26d392611fb54b72ae4b7479471aaf289c28cab9f058` | #1019 source/cost support is delivered; reconcile residual indexed clauses. |
| `/workspace/rules-evidence/907.json` | `a92ae66ef12764e6103b196d1d93f4fc370162df985471a1afc1d2c1d5902dd6` | 18 Oct receipt comment reports #1017's 52 Absorb lines and #1019's 8 refreshed / 16 already-current rows; it names no BT3-070 row identity. It is historical application evidence, not proof of today's loaded row. |

The #1019 receipt also notes BT4-018 unread and BT28-012 source correction.
Those facts do not establish whether BT3-070 was among refreshed or already
current rows. This matrix makes no BT3-070 production-row claim. The #897
starter control completed 16/16 with exact prior game records; see the
[preservation receipt](../907/typed-payment-2026-10-19/README.md). This does not
establish per-skill coverage or additional-pair qualification.

## #1067 follow-up: Fusion checkpoint and reference application

This section supersedes the earlier “current VM” and unverified-application
statements for the narrow cases below; it does not rewrite the dated inventory
or claim the remaining #929/#930 acceptance is complete.

| Case | Current evidence boundary |
| --- | --- |
| Fusion material/additional-cost order | Official §22-13-4-4/-4-1 disproves the old energy-at-declaration expectation; #1067 repairs the checkpoint. |
| Dynamic cost and pending material Autos | Both-seat stored-record scenarios cover discounts becoming true/false after materials and Autos waiting through payment, including failure. Synthetic support fixtures are engineering interaction probes, not invented catalog rulings. |
| X / saved resource selection | Typed X is charged at the checkpoint; stale saved resource choices cannot silently replan or become free. |
| Potara / Absorb / Counter | Existing #926/#929/#930 focused proofs remain the required preservation controls. No blanket claim of full printed-card coverage follows. |
| BT11-013 front #10/#20/#30 | All three actual rows refreshed as current payment-v1 compiler drafts; exported #10 payment exercised through the loader and replay. |
| BT3-070 front #0/#10 | Both actual rows refreshed as current payment-v1 compiler drafts. The old #0 ops already had onto-self; only its description omitted that binding. Prior Absorb scenario remains semantic evidence, separate from live row application. |
| P-360 front/back #0/#10/#20 | Six actual rows refreshed, including the typed back-face grant price. Front #10's any-of/rest behavior was already in its ops; the refreshed renderer makes it explicit. |
| Human review | All 11 applied rows remain unconfirmed. No protected record changed. |
| Fully authoritative stored admission | Union material contracts and once-per-turn fields still depend on runtime text and remain explicit blockers. |
| Deck qualification | The BT6 additional pair remains unqualified under #897. |

See the [#1067 receipt](../907/fusion-checkpoint-2026-10-19/README.md),
[exact reference exports and row hashes](../907/fusion-checkpoint-2026-10-19/application-receipt.json),
and [fresh official/forum source evidence](../907/fusion-checkpoint-2026-10-19/online-sources.md).
Next single implementation: typed Fusion material selection, including the
existing granted permission, under #907. Other residual matrix items remain open.
Integrated focused proofs, typecheck and lint passed; all 16 frozen starter
games and 75 executable programs match #1066 exactly.
