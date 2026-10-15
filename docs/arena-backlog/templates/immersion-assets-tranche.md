# Immersion character asset tranche request

Use one issue per reviewed tranche. Put the candidate sheets under `public/arena/characters/` before import.
The candidate JSON uses version 1 with `sources`, `characters`, and `mappings` arrays; every source records
`kind`, `provenance`, and `license`. Keep changes limited to `public/arena/characters/`,
`src/lib/arena/immersion/characters.json`, `src/lib/arena/immersion/pack-validation.ts`,
`scripts/import-arena-character-pack.mts`, and this validator if its rules need extending.

## Source and provenance

- Prototype/source repository and exact asset directory:
- Rights/licence and redistribution terms, with evidence:
- For each original sheet: source filename, SHA-256, pixel dimensions, frame order, and pose labels:
- Confirm assets are copied unchanged. Record any approved processing separately and retain the original.

## Reviewed catalog mappings

For every proposed mapping, include one exact row from the Masters catalog, its printed face, and the inspected card artwork URL/hash with a written form-level visual comparison to the sprite sheet:

| Card number | Face (`front` / `back`) | Exact printed face name | Catalog character field | Sheet id | Card-art URL + SHA-256 | Visual form review |
|---|---|---|---|---|---|---|
| | | | | | | |

Mappings are exact triples of card number, face, and printed face name. Do not add a broad
character-name rule, aliases, substring matching, or inferred forms. Leave unreviewed cards and
faces on the `null` fallback. A mapping for a back face requires that the catalog has that exact
back name and character evidence. Inspect the card art itself: catalog character tags alone do not
prove a form match. Keep transformations or ambiguous forms pending with no mapping.

## Validation

Run the focused validator against the checked-in catalog snapshot:

```sh
npx tsx scripts/verify/immersion-assets.mts
npx tsx scripts/verify/immersion-assets.mts --catalog work/masters-catalog.json
```

The validator checks asset hashes, PNG alpha, the 3:1 sheet ratio, frame metadata, safe unique paths,
exact catalog face/name evidence when a catalog is supplied, mapping uniqueness, and mapping coverage.
Dry-run merge by default, then use `--write` only after reviewing the report:

```sh
npx tsx scripts/import-arena-character-pack.mts candidate.json
npx tsx scripts/import-arena-character-pack.mts --write candidate.json
```

Record the validator/import command and result here:

- Result:
- Any mappings intentionally deferred and why:
