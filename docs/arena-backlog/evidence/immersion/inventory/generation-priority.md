# Hero sheet generation priority (issue #850)

Derived from `inventory.json` (snapshot `4a1a3139f5c9`, generated 2026-10-18T09:58:23.122Z) after the deck-face mappings PR that maps six more faces to existing sheets. No image generation was done.

Coverage of the 333 card faces in the owner's current decks: 15 covered before, 21 after (+6); 312 missing (the inventory file itself is a dated snapshot and was not regenerated, because that needs the database).

Method: every `missing` single-character inventory entry that is not newly mapped, grouped by the catalog character label plus a form inferred from the card name (SS, SS2, SS3, SS4, SSB, SSG, Great Ape, stage names). Cards whose name does not state a form are grouped as "base / form unconfirmed": the depicted form must be confirmed from the art before a sheet is commissioned, and a group may split. "Faces" = distinct card faces a sheet could cover; ties are broken by deck appearances, then copies. Faces with no catalog character label (61 entries, mostly non-character cards such as Extra and Battle cards) are outside this list.

Art note: the deckplanet bucket does not hold BT27+ card art (BT27-095, BT28-121, BT29-065, BT30-019, BT31-xxx, BT31-126 returned 404), so the existing android17/android18/bardock/cell sheets could not be matched against those deck faces. Cell (7 BT31 faces) and the other BT31 cards need another art source, for example the app catalog's own `image_url`, which is database-backed and was out of scope here.

Already-mapped sheets that still lack deck matches because the art shows another form: Goku (Super Saiyan and Blue forms, children, Broly-movie parka), Vegeta (Super Saiyan forms, Broly-movie jacket), Gohan (purple-gi sheet vs. kid/Saiyaman/orange gi), Piccolo (sheet has no cape or turban; deck art does), Krillin (deck art is a suit-wearing civilian).

## Single-character faces (243)

| # | Character (catalog label) | Form | Faces | Deck appearances | Copies | Cards |
|---|---|---|---|---|---|---|
| 1 | Vegeta | base / form unconfirmed (art review needed) | 8 | 9 | 24 | BT1-064, BT2-009, BT29-065, BT3-036, BT31-012, BT31-070, BT31-071, SD15-01 |
| 2 | Majin Buu | base / form unconfirmed (art review needed) | 7 | 7 | 15 | BT2-027, BT3-031/back, BT3-047, BT3-048, BT3-049, BT3-050, EX03-05 |
| 3 | Trunks: Xeno | base / form unconfirmed (art review needed) | 6 | 10 | 22 | BT3-111, BT3-112, BT5-114, EX02-01, SD3-02, SD3-03 |
| 4 | Broly: Br | base / form unconfirmed (art review needed) | 6 | 6 | 14 | BT6-062, BT6-063, SD8-01, SD8-01/back, SD8-02, SD8-03 |
| 5 | Cabba | base / form unconfirmed (art review needed) | 6 | 6 | 14 | BT1-014, BT7-081, BT7-082, XD1-01, XD1-01/back, XD1-06 |
| 6 | Vegito | base / form unconfirmed (art review needed) | 6 | 6 | 11 | BT2-001, BT2-012, BT2-013, BT3-055, BT31-085, BT31-092 |
| 7 | Son Goku | base / form unconfirmed (art review needed) | 5 | 6 | 17 | BT2-072, BT31-008, BT31-009, EX03-14, SD15-03 |
| 8 | Broly | base / form unconfirmed (art review needed) | 5 | 5 | 15 | BT1-057, BT1-073, BT1-074, BT1-076, EX03-16 |
| 9 | Vegito | Super Saiyan Blue | 5 | 5 | 9 | BT3-055/back, BT31-085/back, BT31-090, BT31-091, BT31-150 |
| 10 | Son Goku: Childhood | base / form unconfirmed (art review needed) | 4 | 7 | 21 | BT30-019, BT4-079, BT5-004, SD7-05 |
| 11 | Cell | Cell stage | 4 | 4 | 16 | BT31-128, BT31-129, BT31-130, BT31-132 |
| 12 | Gogeta | Super Saiyan | 4 | 4 | 11 | BT31-003, BT31-014, BT31-015, BT31-149 |
| 13 | Brianne De Chateau | base / form unconfirmed (art review needed) | 4 | 4 | 10 | BT30-082, BT30-082/back, BT30-097, BT30-098 |
| 14 | Cell | base / form unconfirmed (art review needed) | 4 | 4 | 10 | BT31-116, BT31-116/back, BT31-119, BT31-131 |
| 15 | Cooler | base / form unconfirmed (art review needed) | 4 | 4 | 7 | BT29-029, BT29-029/back, BT29-031, BT29-032 |
| 16 | Son Goku: GT | base / form unconfirmed (art review needed) | 3 | 6 | 21 | BT3-006, BT4-005, BT4-081 |
| 17 | Pan | base / form unconfirmed (art review needed) | 3 | 5 | 17 | BT3-009, BT4-086, BT5-057 |
| 18 | Son Goku | Super Saiyan | 3 | 5 | 17 | BT14-006, BT3-058, BT4-077 |
| 19 | Vegeta: Br | base / form unconfirmed (art review needed) | 3 | 5 | 10 | BT11-011, BT6-009, SD8-08 |
| 20 | Vegito: Xeno | Super Saiyan 4 | 3 | 4 | 12 | BT27-093, BT31-093, BT31-094 |
| 21 | Yamcha | base / form unconfirmed (art review needed) | 3 | 4 | 11 | BT10-008, BT5-010, BT8-051 |
| 22 | Son Goku | Super Saiyan 3 | 3 | 3 | 5 | BT2-004, BT31-007, P-003 |
| 23 | Son Goku: Br | base / form unconfirmed (art review needed) | 3 | 3 | 5 | BT11-008, BT6-005, SD8-07 |
| 24 | Trunks: GT | base / form unconfirmed (art review needed) | 3 | 3 | 5 | BT3-010, BT3-011, BT4-012 |
| 25 | Son Goku: GT | Super Saiyan 4 | 2 | 7 | 13 | SD5-01/back, SD5-04 |
| 26 | Vegeta: GT | base / form unconfirmed (art review needed) | 2 | 3 | 9 | BT4-010, BT4-011 |
| 27 | Paragus: Br | base / form unconfirmed (art review needed) | 2 | 3 | 8 | BT6-065, SD8-04 |
| 28 | Masked Saiyan | base / form unconfirmed (art review needed) | 2 | 3 | 4 | SD3-01, SD3-04 |
| 29 | Bulma | base / form unconfirmed (art review needed) | 2 | 2 | 8 | BT3-095, BT5-107 |
| 30 | Frieza | Frieza early form | 2 | 2 | 8 | BT1-089, BT10-073 |
| 31 | Sanka Ku | base / form unconfirmed (art review needed) | 2 | 2 | 8 | BT30-100, BT30-101 |
| 32 | Su Roas | base / form unconfirmed (art review needed) | 2 | 2 | 8 | BT30-103, BT30-104 |
| 33 | Trunks: Future | base / form unconfirmed (art review needed) | 2 | 2 | 8 | BT29-098, BT3-062 |
| 34 | Salza | base / form unconfirmed (art review needed) | 2 | 2 | 7 | BT29-033, BT29-035 |
| 35 | Son Goku: GT | Super Saiyan | 2 | 2 | 7 | BT3-005, BT5-056 |
| 36 | Caulifla | base / form unconfirmed (art review needed) | 2 | 2 | 6 | BT7-085, XD1-07 |
| 37 | Dodoria | base / form unconfirmed (art review needed) | 2 | 2 | 6 | BT10-083, SD13-05 |
| 38 | Zarbon | base / form unconfirmed (art review needed) | 2 | 2 | 6 | BT10-085, SD13-04 |
| 39 | Dore | base / form unconfirmed (art review needed) | 2 | 2 | 5 | BT29-036, BT29-037 |
| 40 | Neiz | base / form unconfirmed (art review needed) | 2 | 2 | 5 | BT29-038, BT29-039 |
| 41 | Vegito | Super Saiyan | 2 | 2 | 5 | BT2-001/back, BT31-096 |
| 42 | Veku: Br | base / form unconfirmed (art review needed) | 2 | 2 | 5 | BT6-012, BT6-013 |
| 43 | King Vegeta | Great Ape | 2 | 2 | 4 | BT3-092, BT3-093 |
| 44 | Piccolo | base / form unconfirmed (art review needed) | 2 | 2 | 4 | BT5-061, DB2-004 |
| 45 | Son Gohan: Adolescence | base / form unconfirmed (art review needed) | 2 | 2 | 4 | BT5-032, SD15-04 |
| 46 | Gravy | base / form unconfirmed (art review needed) | 2 | 2 | 3 | BT4-113, BT4-114 |
| 47 | Vegeta | Super Saiyan Blue | 2 | 2 | 3 | SD15-01/back, SD15-05 |
| 48 | Dragon Ball | base / form unconfirmed (art review needed) | 2 | 2 | 2 | SD7-01, SD7-01/back |
| 49 | Jiren | base / form unconfirmed (art review needed) | 2 | 2 | 2 | EX03-19, EX03-19/back |
| 50 | Chi-Chi | base / form unconfirmed (art review needed) | 1 | 4 | 16 | BT4-089 |
| 51 | Son Goku | Super Saiyan Blue | 1 | 4 | 13 | SD5-03 |
| 52 | Son Gohan: Childhood | Super Saiyan 2 | 1 | 4 | 10 | SD5-05 |
| 53 | Son Gohan | base / form unconfirmed (art review needed) | 1 | 3 | 12 | BT4-091 |
| 54 | Son Gohan: Youth | base / form unconfirmed (art review needed) | 1 | 3 | 12 | BT4-084 |
| 55 | Son Goten | base / form unconfirmed (art review needed) | 1 | 3 | 12 | BT4-085 |
| 56 | Supreme Kai of Time | base / form unconfirmed (art review needed) | 1 | 3 | 11 | BT3-113 |
| 57 | Son Goku: GT | Great Ape | 1 | 3 | 3 | SD5-01 |
| 58 | Kami | base / form unconfirmed (art review needed) | 1 | 2 | 8 | BT5-108 |
| 59 | Kibito Kai | base / form unconfirmed (art review needed) | 1 | 2 | 6 | BT3-043 |
| 60 | Nappa: Adolescence | base / form unconfirmed (art review needed) | 1 | 2 | 6 | BT3-102 |
| 61 | Shun Shun | base / form unconfirmed (art review needed) | 1 | 2 | 6 | BT3-119 |
| 62 | Tora | base / form unconfirmed (art review needed) | 1 | 2 | 6 | BT3-097 |
| 63 | Vegeta: Xeno | base / form unconfirmed (art review needed) | 1 | 2 | 6 | SD7-03 |
| 64 | Vegeta: Youth | base / form unconfirmed (art review needed) | 1 | 2 | 6 | BT3-094 |
| 65 | Bulma: Br | base / form unconfirmed (art review needed) | 1 | 2 | 5 | BT6-011 |
| 66 | Haru Haru | base / form unconfirmed (art review needed) | 1 | 2 | 5 | BT3-120 |
| 67 | Son Goku: Xeno | base / form unconfirmed (art review needed) | 1 | 2 | 5 | SD7-02 |
| 68 | Jaco | base / form unconfirmed (art review needed) | 1 | 2 | 4 | BT5-088 |
| 69 | Uub | base / form unconfirmed (art review needed) | 1 | 2 | 4 | BT5-063 |
| 70 | Trunks: Youth: Br | base / form unconfirmed (art review needed) | 1 | 2 | 3 | BT6-010 |
| 71 | Android 17 | base / form unconfirmed (art review needed) | 1 | 1 | 4 | BT28-121 |
| 72 | Android 18 | base / form unconfirmed (art review needed) | 1 | 1 | 4 | BT31-126 |
| 73 | Bio Warrior | base / form unconfirmed (art review needed) | 1 | 1 | 4 | BT1-078 |
| 74 | Cell Jr. | base / form unconfirmed (art review needed) | 1 | 1 | 4 | BT31-133 |
| 75 | Cooler’s Armored Squadron | base / form unconfirmed (art review needed) | 1 | 1 | 4 | BT29-030 |
| 76 | Giru | base / form unconfirmed (art review needed) | 1 | 1 | 4 | BT3-013 |
| 77 | Gogeta: Br | base / form unconfirmed (art review needed) | 1 | 1 | 4 | BT6-015 |
| 78 | Gotenks | Super Saiyan | 1 | 1 | 4 | BT1-070 |
| 79 | Gotenks | base / form unconfirmed (art review needed) | 1 | 1 | 4 | BT1-071 |
| 80 | Magetta | base / form unconfirmed (art review needed) | 1 | 1 | 4 | BT7-089 |
| 81 | Master Roshi | base / form unconfirmed (art review needed) | 1 | 1 | 4 | BT6-110 |
| 82 | Oolong | base / form unconfirmed (art review needed) | 1 | 1 | 4 | BT5-014 |
| 83 | Paragus | base / form unconfirmed (art review needed) | 1 | 1 | 4 | BT1-077 |
| 84 | Ribrianne | base / form unconfirmed (art review needed) | 1 | 1 | 4 | BT30-095 |
| 85 | Son Goten: Br | base / form unconfirmed (art review needed) | 1 | 1 | 4 | BT6-006 |
| 86 | South Kai | base / form unconfirmed (art review needed) | 1 | 1 | 4 | BT5-042 |
| 87 | Tien Shinhan | base / form unconfirmed (art review needed) | 1 | 1 | 4 | BT14-010 |
| 88 | Evil Wizard Babidi | base / form unconfirmed (art review needed) | 1 | 1 | 3 | BT3-045 |
| 89 | Fasha | base / form unconfirmed (art review needed) | 1 | 1 | 3 | BT3-099 |
| 90 | Frieza: Xeno | base / form unconfirmed (art review needed) | 1 | 1 | 3 | BT10-087 |
| 91 | Gine | base / form unconfirmed (art review needed) | 1 | 1 | 3 | BT3-087 |
| 92 | Kakarot | base / form unconfirmed (art review needed) | 1 | 1 | 3 | BT3-091 |
| 93 | Kakunsa | base / form unconfirmed (art review needed) | 1 | 1 | 3 | BT30-099 |
| 94 | Kibito | base / form unconfirmed (art review needed) | 1 | 1 | 3 | BT3-042 |
| 95 | North Supreme Kai | base / form unconfirmed (art review needed) | 1 | 1 | 3 | BT3-041 |
| 96 | Rozie | base / form unconfirmed (art review needed) | 1 | 1 | 3 | BT30-102 |
| 97 | Shugesh | base / form unconfirmed (art review needed) | 1 | 1 | 3 | BT3-100 |
| 98 | South Supreme Kai | base / form unconfirmed (art review needed) | 1 | 1 | 3 | BT3-040 |
| 99 | Vegeta: Br | Super Saiyan Blue | 1 | 1 | 3 | BT6-007 |
| 100 | Vegeta: Br | Super Saiyan God | 1 | 1 | 3 | BT6-008 |
| 101 | Vegito: Xeno | Super Saiyan 3 | 1 | 1 | 3 | BT31-095 |
| 102 | West Supreme Kai | base / form unconfirmed (art review needed) | 1 | 1 | 3 | BT3-039 |
| 103 | Bardock | Great Ape | 1 | 1 | 2 | BT3-085 |
| 104 | Bardock | base / form unconfirmed (art review needed) | 1 | 1 | 2 | BT27-095 |
| 105 | Burter | base / form unconfirmed (art review needed) | 1 | 1 | 2 | BT10-080 |
| 106 | Cheelai: Br | base / form unconfirmed (art review needed) | 1 | 1 | 2 | SD8-05 |
| 107 | East Supreme Kai | base / form unconfirmed (art review needed) | 1 | 1 | 2 | BT3-038 |
| 108 | Evil Wizard Bibidi | base / form unconfirmed (art review needed) | 1 | 1 | 2 | BT3-046 |
| 109 | Fasha | Great Ape | 1 | 1 | 2 | BT3-098 |
| 110 | Ginyu | base / form unconfirmed (art review needed) | 1 | 1 | 2 | SD13-03 |
| 111 | Gogeta: Br | Super Saiyan Blue | 1 | 1 | 2 | BT6-014 |
| 112 | Grand Supreme Kai | base / form unconfirmed (art review needed) | 1 | 1 | 2 | BT3-037 |
| 113 | Hit | base / form unconfirmed (art review needed) | 1 | 1 | 2 | XD1-05 |
| 114 | Krillin | base / form unconfirmed (art review needed) | 1 | 1 | 2 | BT5-062 |
| 115 | Ledgic | base / form unconfirmed (art review needed) | 1 | 1 | 2 | BT3-015 |
| 116 | Lemo: Br | base / form unconfirmed (art review needed) | 1 | 1 | 2 | SD8-06 |
| 117 | Puar | base / form unconfirmed (art review needed) | 1 | 1 | 2 | BT5-013 |
| 118 | Raditz | base / form unconfirmed (art review needed) | 1 | 1 | 2 | BT7-003 |
| 119 | Shenron | base / form unconfirmed (art review needed) | 1 | 1 | 2 | SD7-04 |
| 120 | Son Goku: Br | Super Saiyan Blue | 1 | 1 | 2 | BT6-003 |
| 121 | Son Goku: Br | Super Saiyan God | 1 | 1 | 2 | BT6-004 |
| 122 | Son Goku: GT | Super Saiyan 3 | 1 | 1 | 2 | BT3-003 |
| 123 | Tora | Great Ape | 1 | 1 | 2 | BT3-096 |
| 124 | Trunks: Future | Super Saiyan 2 | 1 | 1 | 2 | BT3-061 |
| 125 | Vegeta | Super Saiyan | 1 | 1 | 2 | BT31-011 |
| 126 | Vegeta | Super Saiyan 2 | 1 | 1 | 2 | BT2-010 |
| 127 | Vegeta: GT | Super Saiyan | 1 | 1 | 2 | BT5-059 |
| 128 | Veku | base / form unconfirmed (art review needed) | 1 | 1 | 2 | BT31-013 |
| 129 | West Kai | base / form unconfirmed (art review needed) | 1 | 1 | 2 | BT5-043 |
| 130 | Whis: Br | base / form unconfirmed (art review needed) | 1 | 1 | 2 | SD8-09 |
| 131 | Broly | Super Saiyan | 1 | 1 | 1 | BT1-057/back |
| 132 | Demigra | base / form unconfirmed (art review needed) | 1 | 1 | 1 | P-048 |
| 133 | Frieza | base / form unconfirmed (art review needed) | 1 | 1 | 1 | SD13-01 |
| 134 | Frost | base / form unconfirmed (art review needed) | 1 | 1 | 1 | BT7-087 |
| 135 | Heles | base / form unconfirmed (art review needed) | 1 | 1 | 1 | BT30-083 |
| 136 | Saonel | base / form unconfirmed (art review needed) | 1 | 1 | 1 | BT7-090 |
| 137 | Son Goku: GT | Super Saiyan 2 | 1 | 1 | 1 | BT3-004 |

## Multi-character (fusion/pair) faces (17)

These cards name two characters (Son Goku & Vegeta pairs, Gogeta); they need a deliberate decision (a fusion sheet or an exception) rather than a per-character sheet.

| # | Character (catalog label) | Form | Faces | Deck appearances | Copies | Cards |
|---|---|---|---|---|---|---|
| 1 | Son Goku | base / form unconfirmed (art review needed) | 3 | 3 | 9 | BT31-001, BT31-010, BT31-088 |
| 2 | Vegeta | base / form unconfirmed (art review needed) | 3 | 3 | 9 | BT31-001, BT31-010, BT31-088 |
| 3 | Son Goku: Xeno | base / form unconfirmed (art review needed) | 1 | 1 | 4 | BT31-089 |
| 4 | Vegeta: Xeno | base / form unconfirmed (art review needed) | 1 | 1 | 4 | BT31-089 |
| 5 | Kakunsa | base / form unconfirmed (art review needed) | 1 | 1 | 3 | BT30-096 |
| 6 | Ribrianne | base / form unconfirmed (art review needed) | 1 | 1 | 3 | BT30-096 |
| 7 | Rozie | base / form unconfirmed (art review needed) | 1 | 1 | 3 | BT30-096 |
| 8 | Son Goku | Super Saiyan | 1 | 1 | 1 | BT31-001/back |
| 9 | Son Goku: Br | Super Saiyan Blue | 1 | 1 | 1 | BT6-001/back |
| 10 | Son Goku: Br | base / form unconfirmed (art review needed) | 1 | 1 | 1 | BT6-001 |
| 11 | Vegeta | Super Saiyan | 1 | 1 | 1 | BT31-001/back |
| 12 | Vegeta: Br | Super Saiyan Blue | 1 | 1 | 1 | BT6-001/back |
| 13 | Vegeta: Br | base / form unconfirmed (art review needed) | 1 | 1 | 1 | BT6-001 |
