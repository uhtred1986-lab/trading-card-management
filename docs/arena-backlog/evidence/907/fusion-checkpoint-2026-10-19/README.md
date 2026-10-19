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

## Separate progress measures for the reference export

| Measure | Evidence and limit |
| --- | --- |
| Parsed | All 11 refreshed required records have no unread compiler clauses; native Deflect is separate. |
| Stored/loaded | All 11 records are present, source-current, payment-v1 valid and accepted by the actual loader. |
| Fully authoritative admission | Four stored skills retain explicit runtime-text dependencies: BT11-013/front/10, BT3-070/front/0, P-360/front/10 and P-360/back/20. The strict corpus gate still blocks them. |
| Human reviewed | 0 confirmed by this operation; all 11 remain compiler drafts. |
| Verified/exercised | Named payment and interaction scenarios only. Loading a record does not prove all its semantics. |
| Deck-qualified | No additional deck qualified by this increment; the selected BT6 pair still needs its recorded repairs and inputs. |

The next single action under #907 is to carry **Fusion's material selection
contract** through compilation, storage, loading and replay, including the
existing granted-Fusion permission. Preserve distinct Potara/Absorb procedures
and the delivered Counter/source behavior. Trigger predicates/bindings, use
limits, Counter's resource path and remaining indexed Union scenarios retain
their explicit ownership and are not silently included in this bounded repair.

## Reproduction

Offline commands require no database credentials:

```sh
env -u DATABASE_URL npx tsx scripts/verify/typed-payment-907.ts --reference-records docs/arena-backlog/evidence/907/fusion-checkpoint-2026-10-19/reference-records.json
env -u DATABASE_URL npx tsx scripts/verify/keyword-action-costs-926.ts
env -u DATABASE_URL npx tsx scripts/verify/union-counter-929.ts
env -u DATABASE_URL npx tsx scripts/verify/union-sources-930.ts
env -u DATABASE_URL npx tsx scripts/arena-corpus-freeze.mts --mode compiler --check --pairs 4 --max-moves 3000 --seed-base 897000 --out /tmp/fusion-starters.json
python3 docs/arena-backlog/evidence/907/fusion-checkpoint-2026-10-19/compare-controls.py /tmp/fusion-starters.json /tmp/fusion-preservation.json
```

The reference-records option replaces the BT11-013 fixture with the exact
exported catalog definition and its three stored records; other synthetic
interaction/control fixtures remain labeled. It does not refresh or confirm
anything. The application receipt records the guarded write already performed;
re-running an application is separate from reproducing these offline proofs.

## Review and expectation ledger

- **Exposed old misread:** energy-before-materials assertions in #926/#907 are
  explicitly replaced by the official material-first sequence. The old evidence
  artifacts remain unchanged.
- **Exposed old misread:** the new saved Burst redirect scenario found that the
  mover ignored an already-selected cost replacement from Deck. The narrow fix
  honors the supplied cost route; automatic replacement discovery is unchanged.
- **Pre-merge implementation regression prevented:** independent review found
  that the first deferred-cost implementation omitted X at its new checkpoint.
  The final path carries and charges X, with both-seat positive/negative proof.
- **Intentional compatibility retirement:** the existing Aegis #595 check failed
  on starting main too, in its explicitly legacy `oldAdditional` resume block.
  The owner's no-legacy decision replaces that single expectation with an
  explicit rebuild refusal and unchanged rejected-state assertion. All current
  Aegis behavior assertions are retained and pass. No compatibility fallback or
  runtime Aegis rewrite was added.
- #929/#930 runners now answer the deferred resource `chooseMode` prompt; their
  existing outcome assertions remain unchanged.
- Old pending Fusion frames without the new payment cursor require rebuilding.
  Resources cannot be silently paid twice or charged using the former ordering.

Implementation/review used the cheaper workhorse agents; source research used
Luna. Independent review supplied the X and obsolete-save corrections. The
source note needed a coordinator clarification distinguishing the FAQ's movement
wording from the controlling manual and spelling out the printed Red3 cost.
No worker ran a full test suite, build or database command.

Known limits remain explicit: Fusion action-price programs touching the player's
own material areas are still refused by #926's `materialIndependent` boundary;
a material/payment search beyond 4096 steps produces a #907 unsupported diagnostic.
The existing Counter windows are preserved, not recertified against every FAQ
formulation. This is a payment-order repair, not a whole Union rewrite.

Integrated code revision: `fd8ac39d04602ea52f095566333c8e4ccbaf3c5c`.
Focused #907 (including exact exported BT11-013 rows), #926, #929, #930 and
Aegis #595 checks passed on the coordinator's integrated tree; Auto #549 passed
on the worker's same implementation. Typecheck and lint passed, with only the
five unchanged prototype lint warnings. The refresh-tool proof passed before
application. No full suite/build was run, as the owner requested.

Changed #897/#907/#923 metadata and source paths were checked against the live
open issues using the repository parser. The global check's previously recorded
`917.md` missing-stage problem is unrelated; no global pass is claimed.

The [frozen starter pack](starter-compiler-pack.json) completed **16/16** games:
A–A 4/4, A–B both seats 8/8, B–B 4/4; zero illegal, interrupted, limited,
crashed or other outcomes. [Exact comparison](control-preservation.json) preserves
all complete game records/trace hashes, all 75 executable programs and manifests,
catalog/definitions, lists, seeds, move cap, policy, ruleset and errata against
#1066's pack. No expectation was rebaselined. The tested runtime is the integrated
revision above; subsequent changes are evidence/documentation only. The controls
remain compiler-mode evidence, not a claim about all production stored programs
or per-skill exercise. The selected BT6 pair remains unqualified.
