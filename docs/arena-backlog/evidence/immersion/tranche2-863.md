# Immersion tranche 2.01 (#863): Android 17, Android 18, Ba, Bardock, Beerus, Belmod, Borgos

Contact sheet: `tranche2-863-contact-sheet.jpg` (all ten new sheets on a checkerboard, so the transparency is visible).
Candidate pack as imported: `tranche2-863-candidate.json`.

## Source and provenance

- **Generator:** Google Gemini `gemini-3-pro-image` (`/v1beta/interactions`, 21:9, 2K, JPEG out), one call per sheet.
- **Inputs per sheet:** a written character description; `goku.png` (this repo, composited on green) as the style and
  layout reference; one Dragon Ball wiki picture for the character's likeness, used as a reference only. **No card art
  was uploaded**, and no third-party image is included in a sheet.
- **Processing:** the model drew on a flat key colour chosen so it doesn't appear on that character (magenta, green or blue).
  The background was keyed out locally (distance-to-key alpha plus a despill band). The three poses were separated by
  connected components, given one common scale, bottom-aligned and centred in equal 724 px thirds of a 2172×724
  RGBA PNG. No background-removal model was used. The raw outputs are kept outside the repo.
- **Generations:** 10 billed calls, one per sheet. Each was accepted first time, with no regeneration. Two earlier calls on a
  free-tier key were refused with a 429 before generating anything, so they weren't billed.
- **IDs:** the validator only allows `[a-z0-9-]`, so the planned `bardock_ss`, `bardock_xeno` and `bardock_xeno_ss3` are
  `bardock-ss`, `bardock-xeno` and `bardock-xeno-ss3`.

| Sheet | Size | SHA-256 |
|---|---|---|
| android17 | 0.82 MiB | see `characters.json` |
| android18 | 0.75 MiB | 〃 |
| ba | 1.08 MiB | 〃 |
| bardock | 0.99 MiB | 〃 |
| bardock-ss | 0.83 MiB | 〃 |
| bardock-xeno | 0.86 MiB | 〃 |
| bardock-xeno-ss3 | 1.12 MiB | 〃 |
| beerus | 0.84 MiB | 〃 |
| belmod | 0.81 MiB | 〃 |
| borgos | 1.17 MiB | 〃 |

All sheets are 2172×724 RGBA, with frames attack, guard and hit, and each is under the 2 MiB budget.

## Reviewed catalog mappings (15)

Catalog rows come from deckplanet's public `dbs_masters_cards` API, the same source `sync:catalog` uses. No database
was read. Every face's art was downloaded from `storage.googleapis.com/deckplanet_card_images/<ID>.png` (`_b` for a
back face) and hashed. The hashes and written reviews are in the candidate JSON.

| Card | Face | Printed name | Catalog character | Sheet |
|---|---|---|---|---|
| EX03-17 | front | Limitless Energy Android 17 | Android 17 | android17 |
| BT9-031 | front | Android 18, Steadfast Technique | Android 18 | android18 |
| TB1-055 | front | Infinite Energy Android 18 | Android 18 | android18 |
| BT6-069 | front | Ties that Bind Ba | Ba: Br | ba |
| BT3-082 | front | Bardock | Bardock | bardock |
| BT3-086 | front | Striker Bardock | Bardock | bardock |
| BT3-084 | front | Desperate Warrior Super Saiyan Bardock | Bardock | bardock-ss |
| BT3-082 | back | Unwavering Justice Bardock | Bardock | bardock-ss |
| SD5-02 | front | Power Charge Bardock | Bardock | bardock-ss |
| BT3-110 | front | Awakened Warrior Bardock | Bardock: Xeno | bardock-xeno |
| BT3-109 | front | SS3 Bardock, Power Unleashed | Bardock: Xeno | bardock-xeno-ss3 |
| SD3-01 | back | Bardock, Unbound by Darkness | Bardock: Xeno | bardock-xeno-ss3 |
| SD8-10 | front | Godly Destruction Beerus | Beerus: Br | beerus |
| EX03-24 | front | Clownish Destruction Belmod | Belmod | belmod |
| BT3-101 | front | Unwavering Solidarity Borgos | Borgos | borgos |

## Exceptions (neutral fallback, reviewed)

- **BT1-078** Overflowing Bio Warrior Army: the art shows a group, not one figure, so there's no single fighter to draw.
- **BT3-085** Great Protector, Great Ape Bardock: a giant ape doesn't fit the human-scale three-pose layout.

## Deferred (left unmapped)

- **BT28-121**, **BT31-126** and **BT27-095**: their card art returns HTTP 404 from deckplanet's image store, so the face
  can't be reviewed.
- **SD3-01 front** (The Masked Saiyan): not listed in #863.

Face count: 15 mapped (all new sheets, no reuse), 2 excepted, 4 deferred.

## Validation

- `npx tsx scripts/import-arena-character-pack.mts --dry-run <candidate> --catalog <rows>`: 10 characters and 15 mappings
  added, validated. Then the same with `--write`: the manifest was updated atomically.
- `npx tsx scripts/verify/immersion-assets.mts` (also run with `--catalog`): 18 sheets and 28 exact mappings verified.
- `npx tsx scripts/verify/arena-immersion.mts`: pass.
- `npm run typecheck`: clean. `npm run lint`: 0 errors; the 5 warnings are pre-existing, in `docs/arena-redesign/prototype/`.
- Not run: the per-layout render smoke. Every new sheet uses the existing three-pose layout, and `src/components/arena/**`
  was left untouched as instructed.
