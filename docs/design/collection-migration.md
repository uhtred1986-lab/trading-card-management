# Collection and deck UI migration status

This workstream applies the shared theme primitives to collection, catalog, deck, cart and card-entry pages. Data loading, permission checks, writes, forms, query parameters and domain components remain the app's existing implementations.

## Routes

| Route | Status | Retained behavior / notes |
|---|---|---|
| `/collection` | Migrated header, navigation and progressive filters | Grid/copy views, game and facet filters, owner/location/deck filters, valuation, bulk actions and copy editing retained. Search and colour remain visible; other facets are disclosed, with active filters and result count visible. |
| `/collection/archived` | Migrated header and collection navigation | Archived rows and restore/delete behavior retained. |
| `/cards` | Migrated header, navigation and progressive filters | Both games, URL filters, view modes, pagination and card links retained. Search and colour remain visible; secondary facets are disclosed, with active filters and result count visible. |
| `/cards/[id]` | Migrated title and contextual navigation | Card faces, prices, lots, ownership controls, add-to-deck and marketplace content retained. |
| `/leaders` | Migrated via `LeaderLibrary` header, navigation and progressive filters | Owned leader data, filters, deck creation and catalog links retained. Search, game and colour remain visible; set and deck availability are disclosed, with active filters and result count visible. |
| `/decks` | Migrated header and deck navigation | Game/owner scope, built/virtual lists, discovery and creation actions retained. |
| `/decks/[id]` | Migrated deck title and contextual navigation | Full deck editor, zones, quantity/copy allocation, legality, AI, swaps, cart and offline controls retained. |
| `/add` | Migrated header and collection navigation | Open scan batches and entry-method destinations retained. |
| `/add/quick` | Migrated header and entry navigation | Camera capture, quantity, owner, location and deck selection retained. |
| `/add/scan` | Migrated header and entry navigation | Batch access, continuation/discard forms and review flow retained. |
| `/add/bulk` | Migrated header and entry navigation | Existing keyboard-entry table and save behavior retained. |
| `/cart` | Migrated header and collection/deck navigation | Want sources, reservation breakdown, optimizer, seller actions and settings retained. |

## Component scope

The routes continue to use the existing `CollectionList`, `CardList`, `DeckDiscovery`, `DeckBuilder`, `QuickCapture`, `ScanFlow`, `BulkEntry`, `VoiceEntry`, `LeaderLibrary`, `CartTools`, and `WantList` components. Their selection state, actions and domain-specific presentation were retained. `CardList`, `CollectionList`, `DeckBuilder`, and `QuickCapture` now use the shared `Panel` for their major table, builder, and capture surfaces. `DeckDiscovery` keeps its selection outside the filters, shows search and colour directly, discloses leader/type/readiness facets, and shows active facets and result count outside that disclosure. Capture and scan controls remain specialized to preserve their camera and batch workflows.

## Validation and behavior

The progressive filter controls retain their original GET names and existing query parsing. Data and mutation behavior remain owned by their existing pages/actions and client components. This UI-only pass does not change database behavior or add dependencies.
