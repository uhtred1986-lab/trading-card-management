# Union audit — 15 October 2026

Historical inventory and initial coverage matrix. Several gaps below were later
implemented. Read [the reconciled #923 body](../../923.md) for current delivery
and remaining acceptance; this snapshot must not redispatch completed fixes.

Source snapshot: all 6,552 Masters cards, compiler baseline `15487afd`. No live database writes or paid API calls.

229 cards / 233 faces mention a Union tag. 268 parsed skill records reference Union: **170 direct top-level activations** and 98 surrounding support/reference records. Activations: **63 Fusion, 51 Potara, 56 Absorb**. Of these 170, 168 have no unread clauses; two Absorb lines remain unread (BT17-077 and BT28-012). Two of the clean Potara records have their Union tag hidden behind another primary keyword, so **clean is not playable**.

[Complete exact-text index](cards.md) · [Machine-readable compiler inventory](inventory.json)

## Three different rules

- Fusion: activate the fusion card from hand, reveal one of each specified Battle character with equal power, send those materials to Drop as cost, then determine/pay additional skill cost and play it (22-13-4). Card text can expand material areas. The three Gogetas add Warp; each material can independently be hand/Warp. Materials from Warp go to Drop.
- Potara: activate from hand using the named Battle characters in Battle and place the new card on both, in chosen order; continuous power effects carry over (22-13-5). Expanded areas first move materials into Battle without movement-trigger pending or counter timing, then resolve normally. No blanket equal-power condition.
- Absorb: activate from Battle, pay the printed cost and follow its effect to play a specified card from the named area onto the activating card; position/power effects carry over (22-13-6). It is not a universal two-card Fusion recipe.

All three specify failed-entry Drop handling and an exception for explicit return-to-hand-instead effects. Ordinary printed-energy-cost play remains an alternative unless card text restricts it. For P-286: ordinary play costs6 with no Fusion materials; Union-Fusion costs3 plus the qualifying equal-power pair.

## Coverage matrix

| Concern | Established support | Remaining classification / tracking |
|---|---|---|
| Keyword family recognition | All3 variants parsed; hand Fusion/Potara and Battle Absorb declarations exist | Compound passive+Union lines EX25-16/40 are **known wrong**; #928 |
| Basic Fusion play | Generic hand pair→Drop→play tested in keywords.ts | Plain chooser accepts repeated same character; per-character qualifiers flattened; **known wrong**, #925 |
| BT31-001 expanded Fusion | Dedicated union-areas-541.ts tests exact named pair, equal printed power, mixed hand/Battle/Drop, destinations, stale picks, serialization | This proof does not certify every Union card |
| Gogeta Warp materials | Official FAQ for each of BT12-136/137/P-286 explicitly permits mixed hand/Warp | Self Permanent unread, **unsupported**, #924 |
| Action costs / cost order | Generic energy planner exists | Keyword action-price gate refuses these costs as unread; Fusion material/additional-cost staging **unsupported**, #926 |
| Potara source permissions | Ordinary Battle-only declaration | Under-Z-Unison/opponent Battle permissions unread; preselection/order, Active entry and both-material power carryover incomplete; #927 |
| Absorb printed effects | Existing readings.ts and generic keywords.ts cover narrower printed Absorb examples | BT17-077 source/onto order unread; BT28-012 typo clause unread; per-card effects **partial**, #930 |
| Counter:Play / failed entry | Generic play-window machinery exists, Evolve uses it | Fusion/Potara keyword plays omit counterWindow; full3variant failure behavior **unproven/incomplete**, #929 |
| Trigger provenance | keywordMomentNames announces Union plus variant; keywords.ts checks activation watchers | “played using Union” / material-cost triggers and nested Counter effects need complete per-family proof; #930/#929 |
| Cost reductions / granting / restrictions | General cost/keyword/filter primitives exist | Multiple surrounding records unread; do not certify ignored restrictions; #930 |
| Normal play alongside Union | General play and keyword activation are separate actions | P-286 dual-route regression belongs to #924; global prohibitions still require #930 |

Leader-only negative probe: a Black Leader with traits Saiyan and Earthling was incorrectly accepted by all three Gogeta costs requiring Saiyan-only. Wrong-color Leader is correctly refused. This pre-existing predicate gap is #932; #924 does not claim full card playability or closure while that dependency remains.

## Source review

Read full local comprehensive-rules22-13, including all subclauses; fetched official keyword page, card FAQ and errata on15October. [Manual](https://www.dbs-cardgame.com/pdf/rulemanual.pdf?ver_4.00), [keyword reference](https://www.dbs-cardgame.com/us-en/rule/keyword-skills.php), [card FAQ](https://www.dbs-cardgame.com/us-en/rule/card_faq.php), [errata](https://www.dbs-cardgame.com/us-en/rule/errata-cards.php).

Official Q1 for EACH BT12-136, BT12-137 and P-286 answers yes to using one material each from hand and Warp. The fetched errata page contains no entry for these three IDs. Official artworks for all3 were also inspected: Union costs are one Black orb for BT12-136/137 and generic3 for P-286; each normal printed total is6. The keyword page describes Potara entry as Active; the implementation's generic onto-host mode inheritance needs variant-specific review. [Official reference inventory](official-references.json) records 54 matching card-specific FAQ headings among these229cards and lists missing entries. Six cards have official errata: five retain outdated text (BT2-015, BT22-137, BT3-070, BT4-108, P-360; #934), while BT5-120 combo cost is already correct. Other FAQ entries are source evidence, not claims of executed tests. Full per-card errata/Q&A reconciliation remains a closure requirement of #923; this audit does not claim every interaction is tested.

## Order and hot files

Repair #925/#926/#927/#928/#929/#930 independently rather than one giant Union implementation. #924 is the current narrow implementation. Shared hot files: compile/index.ts, vm/program.ts, vm/effects.ts, keywords.rules and generated files.ts, script-schema.ts, types.ts, glossary.ts. Coordinator integrates and runs combined gates. No worker merges main or writes production rule records.
