# Deck discovery and match setup validation (#828)

## Browser scenarios

`env -u DATABASE_URL npm run dev` and, in another terminal:

```
env -u DATABASE_URL npx tsx scripts/deck-setup-browser.mts --shots /tmp/deck-setup-review/after
env -u DATABASE_URL npx tsx scripts/deck-setup-browser.mts --skin night --shots /tmp/deck-setup-review/night
```

Both commands pass at **390 × 844** and **1440 × 900**. This is headless Chrome emulation,
not physical-phone evidence. The dev-only `/arena/setup-preview` route is SL-guarded and returns
404 in production. Fixtures exercise real components without a database or a real match start.

The scenario proves six initial choices, Show more, no-match/reset, a selected ID surviving a
filter that hides it, a locked own deck preventing Next, locked opponent choices being hidden
by default and disabled when shown, independent side filters, combined description/colour/type
search, phone Back, only final submission, exact `deck`/`opponent`/`claudeDeck` payloads, friend-on-
their-device mode, native modal Escape/focus restoration, and no horizontal overflow. It checks
library, builder, leader and local setup frames too. With browser networking disabled, local
setup chooses B/A and second seat through the actual controls and delivers those exact values.
The existing offline release probes now use those pickers; the phone runner supplies coordinate
taps instead of silently manipulating retired native selects.

## Screenshots

All paths below are relative to `docs/arena-backlog/evidence/828/`.

| Surface | Phone | Desktop |
| --- | --- | --- |
| Arena before, same 16-deck fixture on `origin/main` | `before/phone.png` | `before/desk.png` |
| Your deck / desktop setup | `after/phone-your-deck.png` | `after/desk-your-deck.png` |
| Opponent filters | `after/phone-opponent.png` | `after/desk-opponent.png` |
| Phone confirmation | `after/phone-review.png` | Desktop keeps both sides visible |
| Deck library component | `after/phone-library.png` | `after/desk-library.png` |
| Owned leader page component | `after/phone-leaders.png` | `after/desk-leaders.png` |
| Card builder filters | `after/phone-builder.png` | `after/desk-builder.png` |
| Device setup confirmation | `after/phone-local-review.png` | `after/desk-local-review.png` |
| Night skin | `night/phone-review.png` | `night/desk-your-deck.png` |

Compared the before and after Arena frames and inspected the library, builder and leader frames.
Names wrap, descriptions are readable/expandable, both desktop selections fit without the former
full grid, and phone setup owns the display with its footer available. The library preserves leader
thumbnails. Fixture artwork is deliberately absent, so these frames prove text/layout rather than
image delivery. Tiny Fish's production recording is the desktop before evidence for library,
leaders and deck detail; it could not resize to capture phone frames there. Database-backed full
page frames, especially deck detail with real cards/notes, were not captured locally. Compare
`/decks`, `/leaders`, and `/decks/<existing-id>` with the recording after deployment; local evidence
uses their actual shared components and does not claim a live-data or physical-device check.

## Data and automated checks

`env -u DATABASE_URL npx tsx scripts/verify/deck-discovery-828.mts` passes on PGlite. Twenty red
leaders precede a blue leader: blue/type/game filtering still finds the blue leader before the
result cap. It also checks mixed-colour/description/leader filtering, no mutation of input order,
scoped linked deck descriptions (Alice sees none of Bob's notes), and resolving a pack leader ID
through its card definitions. This proof is included in `npm test`.

`env -u DATABASE_URL npm run build` passes. The production `arena:local-browser` proof passes:
136 decisions to completion, final board and journal equal the uninterrupted reference through
reloads, worker termination, storage faults and two-tab takeover; no match/provider request.
The saved transcript is `docs/arena-backlog/evidence/828/local-browser.log`.

Final checks pass on Node 24: `npm run typecheck`, `npm run lint`, `npm test`, and
`npm run build`, with `DATABASE_URL` unset. Lint reports five existing warnings under
`docs/arena-redesign/prototype/` and no errors. The read-only backlog drift check also passes.
The full test, build and lint transcripts are saved beside the screenshots. A malformed pack's
metadata is refused before rendering, with a regression assertion in the new PGlite proof.
No migration, new dependency, Snapshot/engine change, live database access, paid AI call or
production configuration change is part of this work. Offline pack descriptions remain unavailable
and are labelled as such; no pack format or private-note export was added.
