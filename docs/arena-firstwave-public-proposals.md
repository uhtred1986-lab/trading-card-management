# First-wave public deck proposals

This document records ten newly authored quantity proposals for the Arena Testing portal. Each is a reviewable candidate for later simulation, not a copied owner list, an official list, or a claim that the app correctly executes its cards. All ten have 50 main-deck cards and pass the current app catalog legality check. Mechikabura, Piccolo, and Brianne also have four Z-Deck cards; Vegeta has one. The other six have no Z-Deck cards.

All recipes remain **Not run** and unqualified. Fresh compilation is a diagnostic of current compiler support. It does not establish whether the stored card program is correct or whether a recipe works strategically. The notes call out known missing inputs and interaction checks. Nothing in this artifact creates a deck or changes testing progress.

## Source snapshots and reproduction

The quantities and card text were audited against a read-only export of 6,552 public Masters CardDefs and the corresponding current app-catalog restriction snapshot captured at `2026-10-15T02:16:02.092Z`. The catalog SHA-256 is `bd5999f5ad806686686f0a07eaee030332a219c04e2919287d6be084fd506da1`; the restriction snapshot SHA-256 is `8dd6055eef4fea65c3b575982902e0990eb5c1245496cea1cde474b92f8cba69`. The restriction source explicitly says it is not independent official ban-list verification. The app check reports only what that catalog contained at capture time.

Regenerate both audit evidence and the portal artifact from the same local snapshots with:

```sh
./node_modules/.bin/tsx scripts/arena-firstwave-recipes.mts \
  --catalog /tmp/arena-public-catalog-current.json \
  --constraints /tmp/arena-public-constraints-current.json \
  --out /tmp/arena-firstwave-preparation.json \
  --portal-out src/lib/arena/testing/prepared-recipes.json
```

The tool does not query a database or network. It emits quantities, list hashes, app-catalog legality, relevant card checks, source hashes, and fresh-compiler gaps. A rerun needs the same snapshot files to reproduce the same input evidence.

## Candidate quantities and unresolved checks

| Recipe | Proposal and exact support checked | Fresh-compiler gaps or input blocker |
| --- | --- | --- |
| BT27 Mechikabura | 50 main, 4 Z. Black Demon Realm Race/Demon God search targets; Dark Over Realm support for the BT27-093 Z-Battle; recorded Z-Energy cost 3. BT27-099 is a Dark Over Realm blocker; BT27-095 is a Counter: Attack for a black Leader; mixed-release BT16-117 is a Demon God Dark Over Realm blocker/token effect. | BT27-092 back, BT27-105, BT27-093. Search, Dark Over Realm cost reduction, Z-Battle reduction, Triple Attack, and Deflect still need focused evidence. |
| BT30 Super Saiyans United | 50 main. The Leader and BT30-007/012 provide Spirit routes; BT30-004 recovers Spirit from Drop to Z-Energy; BT30-015 has a distinct under-Son-Goku effect. Two BT6-003 cards are mixed-release fillers. | BT30-001 back, BT30-007, BT30-010. The 4-cost and 4-Z-Energy plays have different requirements; neither is claimed to resolve. |
| BT5 Pilaf | 50 main. Exactly seven Dragon Ball cards; Shenron trait supports Oolong's Wish and World Peace; BT5-119 uses its current catalog erratum target of energy cost 3 or less. P-084 and P-176 are mixed-release support. | BT5-002 back, P-176, BT5-106, BT5-015, BT5-014, BT5-005, BT5-025. Wish/Desire resolution and the wrong-identity and six-versus-seven boundaries remain untested. |
| BT5 Black-Masked Saiyan | 50 main with at least 15 Saiyan cards for the named combined-Drop threshold; BT5-111 included. BT5-114 is the single four-copy Super Combo group. | BT5-111, BT5-106, BT13-147. Stage the opponent's contribution and 15-card Drop threshold before claiming the Leader Auto. |
| BT6 Gogeta: Br | 50 main. Red Son Goku: Br and Vegeta: Br Battle Cards support exact Veku materials; BT6-012/013 are included Union-Fusion targets. | BT6-001 back, BT6-012, BT6-013, BT6-015. Validate materials, targets, alternative prices, energy, and payoff conditions in scenarios. |
| BT6 Paragus | 50 main. BT6-062 is supported by a green Broly: Br cost-6 Battle Card, P-136; the list includes two-card payment fodder and a green Frieza's Army Leader. | BT6-053 front/back. The skill-removal or KO trigger, optional two-card payment, and target-in-hand timing remain unqualified. BT6-061/060 cost-8 text does not satisfy BT6-062's cost-6 target. |
| BT27 Piccolo | 50 main, 4 Z. The Leader has Namekian Revive targets at cost 4 or less. BT27-129 Nail costs 5 and is not counted as a Leader-playable target. BT27-048 is a mixed-purpose Z-Battle with recorded Z-Energy cost 2. | BT27-128. The current BT27-045 source text contains a malformed `o 4` token; compiler interpretation and manual rule basis need review before qualification. |
| BT29 Vegeta | 50 main, 1 Z. BT29-064 EX-Evolve and its yellow Vegeta cost-3 base BT29-065 are present; BT29-068 is yellow Frieza's Army; Formidable Ambition is in the Z-Deck. | BT29-057 back, BT29-063, BT29-081, BT29-071. **BT29-061 has no recorded Z-Energy cost**, so its Z-Deck payment remains an explicit source-data blocker. The EX-Evolve, Drop-recovery source, matching names, and awaken route need rule review. |
| BT30 Brianne | 50 main, 4 Z. BT30-103 Su Roas names BT30-102 Rozie; BT30-084 is a Z-Extra with recorded Z-Energy cost 1. The ten other slots are Delivery of Love x4, Son Goku, Ultra Technique x4, and SSB Vegeta, Accepted Fate x2. Their non-Universe-7-gated defense/removal is usable; their Universe 7 play modes are not counted as support. | BT30-099, BT30-101, BT30-104. Verify the host/played-card stack, target source area, opponent-energy condition, and activation cost. |
| BT31 Gogeta | 50 main. Red Son Goku and Vegeta materials and BT31-014 Union-Fusion are included; the Leader front has an awaken condition, and the back supplies additional red Veku/Gogeta Union material permission after awakening. BT31-149 is capped at one Ultimate. BT31-006 was omitted because the recipe has no red Z-Card. | No fresh-compiler gaps in this list. This is not a strategy pass: Union-Fusion, Revenge, costs, material areas, and payoff behavior still need scenario evidence. |

Catalog warnings are preserved in the generated JSON. Pilaf's red Leader therefore reports warnings for off-color blue/black cards; current Masters app semantics treat these as warnings, not deck illegality. The list hashes cover normalized leader, main, and Z-Deck quantities. `BT29-061`'s missing Z-Energy cost is preserved as an input gap rather than filled with an assumed value. The focused audit also checks that main-deck rows contain no Z-Cards, the Z-Deck contains only Z-Cards, pooled Super Combo totals are at most four, Ultimate totals at most one, and no card exceeds its captured per-card copy limit. The app legality change and focused tests cite Masters Rule Manual v4.00 §§6-1-3, 6-1-4, 14-1-3, 22-14-2, and 22-17-2.

## Scope limits

These drafts use public catalog card definitions and app restrictions only. They do not reproduce private saved deck quantities, claim official-list provenance, or infer an official ban-list status beyond the cited app snapshot. Quantities are authored starting points selected to make printed search, evolution, fusion, recovery, and support routes reviewable. Mixed-release support is explicit where used. No recipe is marked qualified, passed, or strategically sound based on this audit.
