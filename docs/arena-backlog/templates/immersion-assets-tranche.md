# Immersion character asset tranche request

Use one issue per reviewed tranche. Keep changes limited to `public/arena/characters/`,
`src/lib/arena/immersion/characters.json`, and this validator if its rules need extending.

## Source and provenance

- Prototype/source repository and exact asset directory:
- Rights/licence and redistribution terms, with evidence:
- For each original sheet: source filename, SHA-256, pixel dimensions, frame order, and pose labels:
- Confirm assets are copied unchanged. Record any approved processing separately and retain the original.

## Reviewed catalog mappings

For every proposed mapping, include one exact row from the Masters catalog and its printed face:

| Card number | Face (`front` / `back`) | Exact printed face name | Catalog character field | Sheet id | Evidence / reviewer |
|---|---|---|---|---|---|
| | | | | | |

Mappings are exact triples of card number, face, and printed face name. Do not add a broad
character-name rule, aliases, substring matching, or inferred forms. Leave unreviewed cards and
faces on the `null` fallback. A mapping for a back face requires that the catalog has that exact
back name and character evidence.

## Validation

Run the focused validator against the checked-in catalog snapshot:

```sh
npx tsx scripts/verify/immersion-assets.mts work/masters-catalog.json
```

The validator checks asset hashes, dimensions, frame metadata, unique ids and paths, exact catalog
face/name evidence, mapping uniqueness, and coverage of every character in the tranche. Record the
command and result here:

- Result:
- Any mappings intentionally deferred and why:
