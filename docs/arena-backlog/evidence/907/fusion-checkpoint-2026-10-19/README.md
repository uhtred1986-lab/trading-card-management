# #907 Fusion payment checkpoint and targeted rule application

Starting main: `04f0e21ef965725a36e51c3a7036958eedc32c88` (#1066), with Vercel
success verified before this increment. PR #1067 reports under #907; #897 and
#923 remain open. The owner authorized targeted database fixes and requested
essential checks only, with no legacy compatibility, full test suite or build.

## Boundary and rules basis

The prior engine paid Fusion energy at declaration, before selecting/moving its
materials. Official manual §22-13-4-4/-4-1 requires materials first, then
determination and payment of the additional skill cost. This is an **exposed old
misread**, not a new interpretation or a silently changed passing expectation.
[Fresh online evidence](online-sources.md) records the official manual, card
listings, FAQ, errata and public forum checks. Material-triggered Autos become
pending and wait for the next checkpoint; they cannot resolve between materials
and the rest of the payment. Continuous modifiers still apply at cost determination.

The implementation stays within Fusion payment. Potara and Absorb retain their
separate procedures; the delivered #929/#930 scenarios remain preservation
controls. Current authoritative stored payment remains the source of the charge.

## Authorized application, independent of the new engine change

[Application receipt](application-receipt.json) and
[public reference export](reference-records.json) pin three reference cards:
BT11-013, BT3-070 and both faces of P-360. This application used the already
deployed #1066 compiler; it does not claim deployment of the new Fusion order.
The app database was obtained through the documented Vercel project lookup,
verified as its Frankfurt pooled database and checked for `public.card_rules`.
No other app database, private list or private replay was accessed.

The supported guarded command refreshed **11 compiler-owned draft rows**;
0 created, 0 unread writes, 0 pending after recheck. Exact before/after row
versions, source/program/export hashes and the expected skill manifest are
pinned. All eleven printed sources were already current; six old payment shapes
were rejected during export validation and the five null-cost rows were
unsupported by the loader. Those are application-format drift, not missing
physical database rows or new source text.

All eleven now load with current typed payment v1 and remain **unconfirmed**.
No protected, confirmed, corrected, user or Claude row was changed. Native
Deflect accounts for the twelfth manifest entry and requires no stored row.
The prior BT3-070 program already had its onto-self binding; P-360 front #10
already selected alternative characters and moved the rest of the looked-at
cards. Their refreshed descriptions now expose those existing semantics.
P-360 back #0 gains #1066's typed grant price; this is an executable change.

The export retains all executable/source/review fields; unrelated operational
probe/history metadata is omitted. The receipt separately pins hashes of the
complete original readbacks and the published executable exports. Full catalog
source records are public card data. Database credentials remain private.

The guarded refresh-tool proof passed, and the actual exported BT11-013 rows
passed the #907 stored-payment/context-plus-state replay proof on the deployed
engine. This proves that export's tested payment paths, not every skill on the
three cards. The stricter corpus admission still reports Union material contracts
and once-per-turn fields obtained from printed text as blockers. Neither current
source nor an unconfirmed compiler draft is a human review or deck qualification.

## Remaining acceptance

The selected BT6 Gogeta / Br Fusion versus BT6 Paragus / Broly recovery lists
remain the one additional pair. No additional pair, AI-strength change or paid
provider work is included. #897 stays open until its complete inputs, semantic
coverage, stored-mode matches and qualification/application evidence are delivered.
