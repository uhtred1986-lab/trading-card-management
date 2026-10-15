# Five-theme contrast fixes

Issue #909 repairs the contrast regression from the five-world design rollout.

## Changes

- Leader tiles, empty state, expanded filters and helper copy use opaque semantic surfaces.
- Neutral badges use raised fills independently of border colours. Existing translucent
  information panels and neutral controls outside live boards receive the same materials.
- Deck status, card flags, game-colour pills and recording actions use explicit pairs.
- Missing-image placeholders have a readable foreground/background pair in light themes.
- White-on-red badges and alerts use a darker red; card art and game rules are unchanged.

## Verification

Browser-computed colours were checked on the no-database leader fixture at 390px and
1440px in Anime Sky, Namek, Korin’s Tower, Tournament of Power and Ultra Instinct.
The checks cover status badges, neutral badges, six named colour pills, the danger action,
legacy neutral fills, white-on-red labels and missing-image placeholders. Every sampled
pair exceeds the 4.5:1 normal-text target. Lowest ratios per theme (same at both widths):

| Theme | Minimum sampled pair |
|---|---:|
| Anime Sky | 5.52:1 |
| Namek | 5.39:1 |
| Korin’s Tower | 4.81:1 |
| Tournament of Power | 6.51:1 |
| Ultra Instinct | 6.51:1 |

Neutral badges improved from 4.41:1/4.08:1 in the two dark themes to above 12:1.
Leader metadata now sits on the opaque base surface (muted text 8.52:1/9.56:1 in dark themes),
so scene brightness cannot reduce that contrast. Status colours remain labelled in text.
Expanded More filters was opened in each theme/viewport.

TypeScript, changed-component ESLint and production build pass. DATABASE_URL was unset;
no data writes, migrations or paid calls were made. The full gameplay/database suite was
omitted under the owner’s explicit minimal-testing instruction for this visual work.

This is targeted contrast verification, not an exhaustive accessibility certification.
Authenticated/live-data screens and every hover, focus or gameplay state were not rendered.
The compatibility styles deliberately exclude live-board descendants, whose materials
remain separately owned. Scenery remains visible between information panels.

Phone/desktop screenshots were compared with the pre-fix leader fixture. Layout structure
and controls remain aligned; opaque materials are the intended visual difference. Two
remaining automated screenshot flags were checked using individual text ranges after
fonts settled: phone navigation measured 10.87:1 and the Anime Sky placeholder 5.52:1.
The original flags sampled a transient development overlay or unrelated pixels inside
a multiline bounding box rather than the label background.
