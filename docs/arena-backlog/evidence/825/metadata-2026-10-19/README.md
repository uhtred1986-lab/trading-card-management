# #825: approved metadata application — 19 October 2026

The eight previously delivered #825 programs exist in the current readback, but
lacked the typed metadata required by today's runtime. The owner explicitly
approved the exact digest and the guarded eight-row application completed. It does not
rewrite #834, establish whole-card/deck coverage or claim whole-deck readiness.

## Preserved delivery and exact scope

[#834](https://github.com/uhtred1986-lab/trading-card-management/pull/834), merged
as `66fc0964`, implemented the qualified Cooler watcher, Trunks self movement,
own-turn cleanup Autos and explicit Great Ape evolution. Its [existing receipt](../validation.md)
records the runtime/corpus review. The specific
[17 October application receipt](https://github.com/uhtred1986-lab/trading-card-management/issues/907#issuecomment-6235968236)
already names BT29-029 back #0; the later [repo-only audit](https://github.com/uhtred1986-lab/trading-card-management/issues/825#issuecomment-6241581216)
missed it. That dated audit is not evidence that today's programs are absent.

The coordinator's 19 October curated readback identifies these exact records.
All have readable triggers/effects; missing typed metadata is a separate boundary.

| Card / face / skill | Rule ID | Before version | Status retained | Applied version |
|---|---:|---:|---|---:|
| BT29-029 / back / 0 | 8932 | 6 | draft | 7 |
| BT3-090 / front / 0 | 4054 | 7 | draft | 8 |
| BT3-096 / front / 10 | 12431 | 7 | **confirmed** | 8 |
| BT3-098 / front / 10 | 10565 | 7 | **confirmed** | 8 |
| BT3-112 / front / 10 | 12988 | 2 | draft | 3 |
| BT7-040 / front / 10 | 12685 | 6 | draft | 7 |
| BT7-083 / front / 10 | 12960 | 6 | draft | 7 |
| BT7-086 / front / 10 | 8230 | 6 | draft | 7 |

The proposal adds the explicit zero Auto payment record, usage-v1 and
validity-v1; the six combo-end Autos additionally receive typed own-turn cleanup
qualifications. Cooler retains Once per turn. No new effect, invented price or
hand-only Combo requirement is introduced.

Only `cost`, `usage`, `validity`, `combo`, `version` and `updated_at` may be written.
Both confirmed programs and all eight conditions, operations, triggers, printed
sources, readings, patterns, statuses, compiler ownership and private review
fields are preserved. The guarded writer compares all eight raw rows and current
catalog identity atomically. A stale row/catalog must refuse the entire write;
replay must not increment versions again. Default CLI behavior is dry-run;
offline snapshots cannot apply. Public preview contains metadata and digests,
while full snapshots/private payloads stay outside the repository.

## Official source confirmation

All eight official Masters card pages returned HTTP 200 on 19 October at
14:50:35–37 UTC. [Exact card receipts](official-card-receipts.json) include URLs,
retrieval time, bytes and SHA-256. The same-day official manual v4.00, card FAQ and
errata were reused from the 13:07 retrieval and rehashed; [shared receipts](official-shared-receipts.json)
retain their original URL/time/hash. Full HTML/PDF bytes remain outside the repo.
No access limit occurred. No community ruling was needed because direct official
answers confirmed the relevant readings; absence of a community search is not
rules evidence.

[FAQ excerpts](faq-excerpts.txt) and [manual excerpts](manual-excerpts.txt) support:

- **Cooler:** original Battle-Area information/holder matters (9-6-9-1-2),
  including original negation/Hidden Mode exclusions (9-6-9-2/-3). Both blue
  alternatives and the successful-play follow-up remain as delivered.
- **Trunks:** official Q2 explicitly permits return after an opponent's skill
  sends it to Warp; do not invent an own-skill restriction. Over Realm's separate
  Drop payment is not the printed source area; 22-15-6 supplies end-turn movement.
- **Tora/Fasha:** Q1 confirms no ordinary energy cost for skill play. Explicit
  evolution uses 22-5-2-3/-5, preserving the chosen base and carried mode/power.
- **No Openings Son Goku:** Q2 permits Combo from an active Battle Card in your
  Battle Area. Q4 permits the Life-to-hand tail with a non-yellow Leader. The
  existing row correctly guards only the play with Yellow and leaves Life
  outside that IF; preserve this grouping.
- **Kale/Caulifla/Frost:** official FAQs exclude a copy returned from Combo to
  hand early. Their printed play-on-top effects do not acquire invented Evolve
  identity; Frost retains its explicit switch-to-Active tail.
- **All six cleanup Autos:** 8-5-8/9/10-1 requires the actual Combo copy to reach
  Drop during cleanup. Generic battleEnd, Combo entry, early departure and wrong
  turn are different occurrences.

[Exact-ID FAQ/errata searches](faq-errata-index.json) found seven card-specific
FAQ sections, none for BT29-029, and no exact-ID errata entry for any of the eight.
This is a scoped search result, not proof that no general ruling can apply.
BT3-112's official page also carries an official-tournament deck/side-deck
restriction note; that separate format fact does not silently change this app's
existing casual rules or deck policy.

## Verification/application boundary

Worker implementation commits `1e3df41c` and `e838c13d` have completed independent
read-only review. The worker reports these essential checks passed at the final
source; the later actual application/readback is recorded below:

- `scripts/verify/metadata-825.mts`: PGlite proves eight-row metadata-only writes,
  private-field preservation, catalog changes before/after the verified read,
  stale-row atomic refusal, both confirmed statuses and replay/no-op behavior.
- `scripts/verify/qualified-movement-evolve-825.ts --stored-targets <proposed-rows>`:
  exactly eight mandatory target overrides pass the actual loader, all original
  assertions remain, and 11 added cases execute the other four target rows.
  These include Son Goku's non-yellow Life tail and BT7 cleanup/early-exit/turn
  counterexamples with paid Combo, base stacking and mode checks.
- Targeted lint passed. No full suite/build or production database was used for
  these worker checks.

Other lines/cards remain explicitly compiled support fixtures. This preparation proof used proposed
stored-target execution. The separate post-write actual-export proof is recorded
below; neither establishes whole-deck qualification. No runtime effect/compiler implementation was changed.

## Approved application and actual readback

The owner explicitly approved digest
`8284223ff78d2ced9cfa6aafa9f71919194bb041294010412c16cf57922dbcf5`.
The coordinator applied exactly eight rows and read them back at 15:32:07 UTC.
[Application receipt](application-receipt.json), [safe actual export](actual-stored-export.json)
and [preflight](preflight.json) retain the approved scope and source pins.
Independent offline comparison confirms every other raw field and all catalog
identities remained exact; both confirmed statuses and private review fields
were preserved. No program replacement or human confirmation occurred.

The actual-export `qualified-movement-evolve-825.ts --stored-targets` proof
passed all original assertions plus 11 stored cases. Exactly eight named target
rows came from the actual readback; other card lines remain explicit compiled
support fixtures. This completes the bounded #825 reconciliation, not whole-deck
qualification. No VM/compiler implementation or rule interpretation changed.

## Named-deck readiness: recorded, still blocked

The coordinator's read-only 19 October 15:12 UTC audit covers four existing
named-deck variants, 71 distinct cards and 135 stored rows. Only the
[public aggregate projection](named-deck-admission-preview.json) is included;
private deck lists, names and raw rules remain outside the repository.

All 135 rows were rejected by the normalizer for missing/malformed typed
validity-v1. This describes the metadata rejection, not physically missing rows
or proof that every effect program is wrong. Four of the eight target lines
occur in these variants; applying the proposed metadata in memory makes those
four target lines admit. No database write occurred.

| Anonymous variant | Blocked skills before | After proposed target metadata |
|---|---:|---:|
| 1 | 42 | 41 |
| 2 | 38 | 36 |
| 3 | 43 | 43 |
| 4 | 40 | 39 |

All four variants remain blocked, with separate native Evolve/Over Realm/Swap
text dependencies also recorded by the coordinator. This completes the bounded
readiness-reporting step; it does not qualify any deck or authorize a general
135-row refresh. The exact eight-row application and actual-target proof are complete; this
readiness report remains explicitly blocked and does not authorize a general
refresh.
