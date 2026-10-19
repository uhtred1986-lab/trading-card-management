# #907 typed activated-payment slice

Starting main: `324d2a5e6e3dd8fddf444fcf138aec6cb90809b9` (#1065).
No later commit was present when this increment started. The #1065 Vercel status
was successful before beginning this next PR.

## Boundary and owner decision

The baseline showed that the match loader dropped typed resource fields and
activation obtained them again from printed text. This increment carries the
complete activated-payment contract through compilation, stored records, loading,
legal offers, payment and replay. Union is the reference family; it retains its
separate Fusion, Potara and Absorb procedures.

The owner clarified on 19 October: the app is in development and backward
compatibility is unnecessary. Old records/saves may require rebuilding. This
increment must use one current typed payment contract and explicit refusal of
obsolete shapes, rather than retaining a printed-cost fallback. No database write
or silent rewrite of protected records is authorized by that format decision.

The reference printed case is BT11-013 front skill 10, Gogeta, Fusion of the Gods:
`[union-fusion]{r}{r}{r}, draw 2 cards: Red <Son Goku: Br> and red <Vegeta: Br>.`
The existing BT3-070 Absorb cost cases and #929/#930 variant/source/Counter
proofs are preservation controls. P-360's granted Fusion support remains a
current supported feature: its typed payment must travel with the granting
permission, rather than use a legacy escape path.

Printed source and official-rule evidence belong to the [#923 payment matrix](../../923/typed-payment-907.md).
Payment authority does not establish complete Union material, timing or trigger
authority. Those residual boundaries remain visible in the corpus gate. The
selected BT6 pair stays blocked and unqualified under #897.

## Validation discipline

Use the focused typed-payment proof, #926 action payment, #929 Counter/failed
entry, #930 source/grant cases, relevant rule-language roundtrip checks, corpus
provenance proof and frozen starter controls. Typecheck and touched lint complete
the code gate. The owner requested essential checks only: no full `npm test` or
build. Compare frozen inputs; record new typed metadata separately from changed
behavior and never replace a failed expectation silently.

Compiler delivery and stored-row application are separate. This work does not
refresh a database, confirm a draft, import Testing & stats results or claim AI
strength or whole-deck qualification.

## Review findings and expectation ledger

- The first focused Auto-cost run exposed a true integration regression: missing
  payment metadata threw `IllegalAction` instead of the existing typed interrupted
  outcome. The Auto boundary now reports the rebuild diagnostic through its
  existing interruption path; the original assertion is retained.
- Full payment validation exposed old synthetic `all([])` predicates in the
  Auto-cost fixture. The authoring schema already refused empty conjunctions.
  Those fixture constants now use the equivalent valid predicate “Life count
  >= 0”; all payment/outcome assertions remain unchanged. This is fixture/schema
  drift, not a card ruling or a silently replaced expected outcome.
- The old #1065 “stored action program ignored for empty printed cost” expectation
  documented a defect. #907 replaces that blocker with a stored-authority proof;
  the historical baseline artifact remains unchanged.

## Delivered and checked

PR #1066 carries payment v1 (including explicit zero) through compiler/drafter,
loader, current rule authoring, activation offers, payment and JSON replay. The
record owns orbs, alternatives, markers, Burst, Spirit Boost, condition, action
program, X bounds and alternate payers. The loader and authoring share validation;
obsolete/null loaded costs refuse with rebuild guidance. P-360 grants carry a
typed price. No runtime compilation substitutes for a record.

Focused checks passed: `typed-payment-907.ts`, `keyword-action-costs-926.ts`,
`union-counter-929.ts`, `union-sources-930.ts`, `auto-costs-549.ts`, `lang.ts`, and
`arena-corpus-provenance.mts`; typecheck and lint passed (five unchanged prototype
warnings, no errors). The new proof is registered in the existing arena suite.
No full test suite/build, database access/write or paid provider call was run.

The two starter controls completed **16/16**, with zero illegal, interrupted,
limited or crashed games. [Frozen pack](starter-compiler-pack.json) pins tested
code `ecd3cfec2f5cd974358a95e5eedf7f9e25754ae8`. The
[comparison ledger](control-preservation.json) proves all complete game records
(including trace hashes) equal the #1065 baseline. Catalog/defs, lists, seeds,
move limits, policy, ruleset and errata are identical. All 75 program hashes
changed solely by adding typed `price.payment`; other price fields and non-price
program fields are identical. The final gameplay paths are unchanged from that pack. A later authoring-only
guard refuses NEW rows with omitted payment instead of inserting obsolete null;
its focused mock proof verifies refusal before any write. Later test changes also
correct the new scenario's source attributes. These differences are explicit;
the frozen pack is retained at its actual tested revision.

Reproduce the controls:

```sh
env -u DATABASE_URL npx tsx scripts/arena-corpus-freeze.mts --mode compiler --check --pairs 4 --max-moves 3000 --seed-base 897000 --out /tmp/payment-starters.json
```

Measures stay separate: 75/75 expected skills parse and pass compiler execution
admission in these controls; the named focused scenarios are verified/exercised.
The matches do not measure each skill's execution or certify every semantic
interaction. Production stored-rule review/application is unverified. The BT6
additional pair remains unqualified with its original lists and missing-input
blockers; #897 remains open.

## Online source check and next single action

See [online sources](online-sources.md), fetched after the owner's explicit request
to consult official guidance and forums. The current BT11-013 reference has
20,000 power, cost 5 with three red spheres, combo 0/+5000 and Saiyan trait.
The new #907 fixture uses those attributes. The historical #926 fixture's 35,000
power remains unchanged as a frozen preservation case; this source-attribute
drift changes no payment expectation and is not presented as an engine regression.

The official Fusion procedure places materials in Drop **before** determining and
paying the necessary skill cost (§22-13-4-4/-4-1). Existing #926/VM behavior pays
energy at declaration, then materials, then the action cost. This slice preserves
that behavior and proves data authority; it does **not** certify exact payment
checkpoint order. Full Union material/trigger authority and Counter's direct
printed-resource path also remain blockers. Trigger predicates follow separately.

**Next single action under #907:** repair Fusion's energy/skill-cost checkpoint to
follow material placement, with durable official-source scenarios for relevant
interactions and saved continuation failure. Preserve Potara/Absorb's distinct
procedures and the now-authoritative stored payment. Do not qualify the BT6 pair
or infer live rule application from this delivery.

The online forum cross-check reached indexed Reddit previews, but direct threads
and replies returned HTTP 403. No unavailable reply is treated as a ruling;
current official sources determine the recorded interpretations. This access
limit is pinned in the online receipt rather than reported as forum agreement.

Backlog verification: the global `sync-arena-backlog.mts --check` stops on
`917.md` lacking `stage`, already present on starting `origin/main`. The changed
#897/#907/#923 records passed the same parser, live open-state comparison and
source-path checks individually; local receipt links also resolve. No unrelated
backlog metadata was rewritten to hide that preexisting checker limitation.
