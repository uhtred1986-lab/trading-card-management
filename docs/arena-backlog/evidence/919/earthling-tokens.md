# Earthling Token support (#919)

## Printed context and official basis

Reviewed 15 October 2026. All eight official cardlist entries fetched and compared with the public fixture (the HTML extraction omits keyword/orb images). Public full card definitions in
`scripts/verify/fixtures/earthling-tokens-919.json`; eight cards only, no owner collection/deck data.
Bandai calls BT23 **ZENKAI Series: PERFECT COMBINATION**.

- [Trunks & Mai / SS Trunks & Mai, Saviors of Hope](https://www.dbs-cardgame.com/us-en/cardlist/index.php?free=BT23-071&search=true), BT23-071: green dual-character Leader; fetches green Mai: Future cards costing1; alternative Awaken at three Earthling Tokens; awakened Permanent grants Earthling Tokens Barrier if a green Saiyan is in play. The awakened Leader itself is a green Saiyan, so normally satisfies that condition.
- [Mai, Earthling Support](https://www.dbs-cardgame.com/us-en/cardlist/index.php?free=BT23-074&search=true), BT23-074: **Z-Battle**, not a Leader fetch target. Its play Auto creates an Earthling Token if the Leader is green and has both Trunks: Future and Mai: Future characters.
- [BT23-087 Mai, Link of Hope](https://www.dbs-cardgame.com/us-en/cardlist/index.php?free=BT23-087&search=true) / [BT23-088 Mai, Protector of the People](https://www.dbs-cardgame.com/us-en/cardlist/index.php?free=BT23-088&search=true): Battle cards costing1; their qualified Activate:Main/Limit1 skills rest the Mai to create a token. Tokens have1000 power,0 combo cost,0 combo power.
- [SSB Son Goku, Humanity’s Hope](https://www.dbs-cardgame.com/us-en/cardlist/index.php?free=BT23-078&search=true), BT23-078; [SSB Vegeta, Humanity’s Hope BT23-080](https://www.dbs-cardgame.com/us-en/cardlist/index.php?free=BT23-080&search=true); [SS Trunks, Humanity’s Hope BT23-082](https://www.dbs-cardgame.com/us-en/cardlist/index.php?free=BT23-082&search=true); [Surprise Attack BT23-096](https://www.dbs-cardgame.com/us-en/cardlist/index.php?free=BT23-096&search=true) share the counted hand reducer. The three Battle cards’ attack Autos rest a token; resting does not remove it. Surprise Attack is an Extra/Counter:Attack.
- [Official manual](https://www.dbs-cardgame.com/pdf/rulemanual.pdf?ver_4.00):19-1-1/2 tokens are Battle Cards with the creation effect’s information;19-1-3 default own Battle Area;19-1-4 printed name includes “Token”;19-1-7 leaving Battle/Combo removes the token;20-1-2-2 an unspecified token reference means Battle Area;20-21 cost layers.
- [Official card FAQ](https://www.dbs-cardgame.com/us-en/rule/card_faq.php) and [errata](https://www.dbs-cardgame.com/us-en/rule/errata-cards.php) fetched. No specific entries for these eight IDs located. No extra ruling invented.

## What existed and what was broken

The VM already creates independent token instances, encodes their definition into the card ID, stores their owner/mode, renders them on the board and decodes them after reload. There is no need for a Leader-specific numeric counter.

Two real gaps:

1. The leading count was split away. The compiler emitted a flat reduction of1 plus an unread “For each…” fragment. It now keeps the count with its reducer, counts actual own Battle tokens and explicitly scopes the self target to hand. Failed joined token wording stays unread without a flat discount.
2. Creation names a token “Earthling Token”, while existing stored token-kind filters name it “earthling”. Pure and VM matchers now accept the suffix-free alias **only when the filter requires type TOKEN**. Ordinary exact card-name references stay exact. This also repairs existing cleanly compiled Leader/support checks using the same token filters; it does not create tokens merely because a matching Leader is selected.

## Acceptance proof

`scripts/verify/earthling-tokens-919.ts` is included in the arena suite. It serializes drafted skill records and loads them through production `rulesFromRows` before VM play. It verifies:

- All four full Permanents:0 tokens gives printed cost4;3 tokens gives1; removing/moving tokens changes the live price; floor0; cost restored outside hand.
- Opposing tokens, other names, regular Earthling-trait cards and tokens in Combo do not count. Own Rest tokens still count.
- Standard total/specified cost layers remain in charge; no specified-cost catalog values were guessed or written. Tests explicitly label the existing fallback orb convention.
- Three Battle cards actually play with zero available energy at the reduced cost. Surprise Attack’s actual Counter:Attack is offered and activates with four tokens and zero energy.
- Created identity/power/combo stats/owner/mode; JSON reload, board `isToken`/Rest mode/1000 power; removal changes the count.
- Actual Mai087 Activate:Main pays its rest cost, creates one token, and cannot create another that turn. Existing Mai token programs allow green dual-character Leader, reject wrong Leader, missing character and wrong color; existing three-token Awaken threshold works at8 life, counts Rest tokens, and disables after losing the third token. Barrier works on tokens and requires the green Saiyan condition.
- Token-kind aliases across Earthling, Ghost, Chilled’s Army, Clone, Cell Jr. and Multi-Form, while an ordinary `{Earthling}` reference does not match `{Earthling Token}`.

This is engine/record support, not a claim of a full Trunks & Mai deck campaign or browser interaction test. Board view fields are exercised; no UI layout changed, so screenshots are not applicable.

## Corpus delta and other Leaders

Offline Masters-only snapshot:6,552 catalog entries,17,327 skill entries; unread clauses3,354→3,350. Exactly the four target Permanent readings change; every one was inspected. `corpus-delta.json` retains the before/after scripts and sampled Leader gaps. This compiler metric differs from persisted-skill census counts. Production rows were not refreshed or approved.

| Leader family | Inspected cards | Existing shared behavior / remaining boundary |
|---|---|---|
| Trunks & Mai / Earthling | BT23-071 plus074/087/088 | Creation, token checks, Barrier and cost count proved. Back attack Auto’s combined ten Battle Card bonus remains unread; Mai088’s on-play search remains unread. |
| Chilled / Chilled’s Army | BT2-102, BT13-062 | Numeric token creation in BT2 compiles; token-kind selection uses repaired matcher. BT13’s singular “play a … Token with10000 power” stays unread on both faces; trait grants are not proof that creation works. |
| Gotenks / Ghost | BT11-061, SD19-01 | Named token matching shares the repair; SD19 compiles. BT11 back still has an unread `{g}` fragment. Neither full deck is certified by this narrow change. |
| Android21 / Clone | BT8-024 | Both faces compile and consume opposing Clone tokens through existing generic paths; full deck/Field setup not played here. |
| Cell / Cell Jr. | XD3-01 | Both faces compile; token creation and filters reuse generic instances. Separate consume-per-token card XD3-07 still has unread removal-dependent effects; not a standing count. |
| Tien Shinhan / Multi-Form | EB1-24 | Both faces compile; named token selector covered. Full Leader playthrough not run. |

No generic tracker schema, automatic Leader-generated count, database mutation, migration or paid model call was added.

## Validation receipt

Node24: typecheck passed; lint passed with the five existing prototype warnings. Focused proof passed; all npm-test entries passed, including arena92/92. An executor transport restart interrupted the command after local-storage; the continuation reran local-ownership inclusively and completed every remaining entry with no assertion failures. Production build exited0. Coordinator must still integrate and fully gate latest main before merging.

No database-backed fuzz, production write, migration, browser interaction run or Snapshot/contract shape change.
