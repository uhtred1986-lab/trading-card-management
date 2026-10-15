# Collection and deck UI migration status

This workstream applies the shared theme primitives to collection, catalog, deck, cart and card-entry pages. Data loading, permission checks, writes, forms, query parameters and domain components remain the app's existing implementations.

## Routes

| Route | Status | Retained behavior / notes |
|---|---|---|
| `/collection` | Migrated header and collection navigation | Grid/copy views, game and facet filters, owner/location/deck filters, valuation, bulk actions and copy editing retained. Existing filter form has not yet been converted to progressive disclosure. |
| `/collection/archived` | Migrated header and collection navigation | Archived rows and restore/delete behavior retained. |
| `/cards` | Migrated header and catalog navigation | Both games, URL filters, view modes, pagination and card links retained. Existing filter form has not yet been converted to progressive disclosure. |
| `/cards/[id]` | Migrated title and contextual navigation | Card faces, prices, lots, ownership controls, add-to-deck and marketplace content retained. |
| `/leaders` | Migrated via `LeaderLibrary` header and navigation | Owned leader data, filters, deck creation and catalog links retained. Its filter form has not yet been converted to progressive disclosure. |
| `/decks` | Migrated header and deck navigation | Game/owner scope, built/virtual lists, discovery and creation actions retained. |
| `/decks/[id]` | Migrated deck title and contextual navigation | Full deck editor, zones, quantity/copy allocation, legality, AI, swaps, cart and offline controls retained. |
| `/add` | Migrated header and collection navigation | Open scan batches and entry-method destinations retained. |
| `/add/quick` | Migrated header and entry navigation | Camera capture, quantity, owner, location and deck selection retained. |
| `/add/scan` | Migrated header and entry navigation | Batch access, continuation/discard forms and review flow retained. |
| `/add/bulk` | Migrated header and entry navigation | Existing keyboard-entry table and save behavior retained. |
| `/cart` | Migrated header and collection/deck navigation | Want sources, reservation breakdown, optimizer, seller actions and settings retained. |

## Component scope

The routes continue to use the existing `CollectionList`, `CardList`, `DeckDiscovery`, `DeckBuilder`, `QuickCapture`, `ScanFlow`, `BulkEntry`, `VoiceEntry`, `LeaderLibrary`, `CartTools`, and `WantList` components. Their selection state, actions and domain-specific presentation were not rewritten. This pass does not claim those component interiors have been fully restyled to the prototype component specimens.

## Remaining work

Filter forms on `/collection`, `/cards`, and `/leaders` still show their existing controls directly. Converting them to the requested progressive `FilterBar` layout needs a follow-up that keeps common search/game/color controls visible and exposes selected hidden filters in an active summary. The current primitives are applied to page hierarchy and navigation only; deeper panel and component restyling remains incomplete.
