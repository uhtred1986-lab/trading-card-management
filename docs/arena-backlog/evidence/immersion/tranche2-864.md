# Immersion tranche 2.02 (#864): Brianne, Broly, Bulma, Burter, Cabba, Caulifla, Cell, Cell Jr.

Contact sheet: `tranche2-864-contact-sheet.jpg` (all 18 new sheets on a checkerboard). Candidate pack as imported:
`tranche2-864-candidate.json`.

## Source and provenance

- **Generator:** Google Gemini `gemini-3-pro-image`, one call per sheet. The inputs are a written description, the
  project's `goku.png` as the style and layout reference, and one Dragon Ball wiki picture for likeness where a
  fitting one existed (Broly ×2, Burter, Cabba, Caulifla, Brianne, Cell Jr.). The three Bulma costumes and the
  Imperfect and Semi-Perfect Cell forms were drawn from text alone, because the wiki pictures showed a different costume or
  another character. **No card art was uploaded**, and no third-party image is in a sheet.
- **Processing:** same as #863. The background was keyed out locally, the poses separated by connected components and set in
  equal 724 px thirds of a 2172×724 RGBA PNG. All sheets are 0.8–1.3 MiB.
  - The model drew `caulifla` on white, not on the requested key colour. It was keyed on white with a flood fill from the
    border, so enclosed whites such as her eyes stay opaque, rather than regenerated.
- **Generations:** 19 billed, 18 first-time sheets plus one regeneration, against a cap of 24.
  - The regeneration was `cell-semi-perfect`: the first output was a slim Perfect Cell.
  - The second output is bulkier and has the stinger tail, but its head crest is still close to Perfect Cell's, so
    **the owner should judge whether BT31-130 keeps this sheet or goes to the neutral fallback**.
- **Card art:** deckplanet's bucket returns 404 for all of BT30 and BT31. Those faces were reviewed and hashed from
  Bandai's own card list (`https://www.dbs-cardgame.com/images/cardlist/cardimg/<ID>.png`), the source the catalog sync
  already uses for leader faces. The same source probably covers the three faces #863 deferred (BT28-121, BT31-126,
  BT27-095).

## Reviewed catalog mappings (32: 29 to new sheets, 3 reusing `cell`)

| Card | Face | Printed name | Sheet |
|---|---|---|---|
| BT1-057 | front | Broly | broly-z |
| BT1-076 | front | Broly, Dawn of the Rampage | broly-z |
| BT1-057 | back | Broly, The Legendary Super Saiyan | broly-z-lss |
| BT1-073 | front | Broly, The Rampaging Horror | broly-z-lss |
| EX03-16 | front | Deathless Warrior Broly | broly-z-ss |
| BT6-062 | front | Broly, Berserker Origins | broly-br |
| BT6-063 | front | Broly, Unrealized Ambition | broly-br |
| SD8-01 | front | Broly | broly-br |
| SD8-01 | back | Broly, Evil Unleashed | broly-br-fpss |
| SD8-02 | front | Broly, the Ravager | broly-br-fpss |
| SD8-03 | front | Broly, Rushing Forth | broly-br-ss |
| BT3-095 | front | Youthful Bulma | bulma-youthful |
| BT5-107 | front | Dragon Ball Seeker Bulma | bulma-seeker |
| BT6-011 | front | Bulma, from the Sidelines | bulma-br |
| BT10-080 | front | Burter, Fastest in the Universe | burter |
| BT1-014 | front | Saiyan Cabba | cabba |
| BT7-082 | front | Cabba, Brimming with Spirit | cabba |
| XD1-01 | front | Cabba | cabba |
| BT7-081 | front | Cabba, Undisguised Rage | cabba-ss |
| XD1-06 | front | Cabba, Saiyan of Universe 6 | cabba-ss |
| BT7-085 | front | Caulifla, the Bold Sister | caulifla |
| XD1-07 | front | Caulifla, Troublemaker of Universe 6 | caulifla-ss |
| BT30-097 | front | Formation!! Brianne De Chateau | brianne |
| BT30-098 | front | Brianne De Chateau, Hope of the Multiverse | brianne |
| BT31-116 | front | Cell | cell-imperfect |
| BT31-119 | front | Cell, Creeping Terror | cell-imperfect |
| BT31-131 | front | Cell, Ominous Android | cell-imperfect |
| BT31-130 | front | Cell, Absorbed Form | cell-semi-perfect |
| BT31-133 | front | Cell Jr., the Fiendish | cell-jr |
| BT31-129 | front | Cell, Perfect Form | cell (reused) |
| BT31-128 | front | Cell, Ultimate Form | cell (reused; Cell attacks a Super Saiyan Vegeta in the art) |
| BT31-116 | back | Cell, Perfect Power | cell (reused; Androids 17 and 18 stand behind Cell) |

## Exceptions (neutral fallback, reviewed)

- **BT30-082 front** (Brianne De Chateau, leader): the art shows three people (the Maiden Squadron trio), not one figure.
- **XD1-01 back** (Vegeta & Cabba, Master & Pupil): two characters.
- **BT1-074** (Rampaging Lifeform Bio-Broly): a dripping sludge mass rising from liquid, with no stance to pose.
- **BT31-132** (Cell, Ominous Larva): a beetle-like larva on six legs; no attack, guard or hit stance.

Face count: 36 listed faces → 29 to new sheets, 3 reusing `cell`, 4 excepted, 0 deferred.

## Validation

- Importer `--dry-run` then `--write`, both with `--catalog` (live deckplanet rows for all 62 mapped cards): 18
  characters and 32 mappings added.
- `scripts/verify/immersion-assets.mts`, with and without `--catalog`: 36 sheets and 66 exact mappings verified.
- `scripts/verify/arena-immersion.mts`: pass. `npm run typecheck`: clean. `npm run lint`: 0 errors (5 pre-existing
  warnings, all in `docs/arena-redesign/prototype/`).
- Not run: the per-layout render smoke. Every sheet uses the existing three-pose layout.
