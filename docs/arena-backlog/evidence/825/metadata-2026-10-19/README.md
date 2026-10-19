# #825: additive metadata proposal — 19 October 2026

The eight previously delivered #825 programs exist in the current readback, but
lack the typed metadata required by today's runtime. This slice proposes a
metadata migration. **Application and owner approval are pending.** It does not
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

| Card / face / skill | Rule ID | Current version | Status retained | Proposed version |
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
source; coordinator integration/readback remains separate:

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

Other lines/cards remain explicitly compiled support fixtures. This is proposed
stored-target execution, not post-write actual-export proof or whole-deck
qualification. No runtime effect/compiler implementation was changed.

No production write, confirmation change, owner approval digest or post-write
actual-export result is claimed here. After a reviewed preview and approval,
record the atomic application/readback and actual-target replay separately.
Affected-deck readiness remains a separate check; these eight records do not
qualify an entire deck or certify every printed skill.
