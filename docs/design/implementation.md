# Five-world design implementation

Milestone: https://github.com/uhtred1986-lab/trading-card-management/milestone/29
Tracking: #890; foundation #891; collection #892; administration #893; arena/landing #894.

## Delivered structure
The app keeps its real routes, server queries, forms and domain components. The visual foundation now supplies five cookie-backed skins: `anime` (Anime Sky), `namek`, `korin` (Korin’s Tower), `night` (Tournament of Power), and `instinct` (Ultra Instinct). Existing anime/night preferences remain valid. RootLayout initializes the theme server-side; header and board selectors offer all five. The cached offline shell restores the device cookie on hydration and notifies LocalArena. Background artwork is decorative; a flat palette remains usable if an offline device has not cached it.

The global top menu is Home, Collection, Cards, Decks, Arena, Insights. The utility menu keeps capture, leaders, cart, archived copies and role-appropriate settings/account/admin destinations reachable. Phone navigation retains Arena, Collection, Cards, Decks, Add. Live games retain full-bleed phone/tablet/desktop layouts. Settings uses a sidebar with same-page anchors for Appearance/AI/Data and existing routes for Locations/Access; Rules uses active secondary tabs without duplicating redirect routes.

Shared presentation lives in `src/components/ui`, theme roles and composition in `src/app/design-system.css`, and names/accepted keys in `src/lib/arena/skin.ts`. Existing space utility tokens bridge to semantic surfaces so deep editor controls inherit all themes while retaining game-specific component behavior. Domain card colours and status meanings are preserved. Full-bleed game geometry and engines were not rewritten.

Card catalog, collection, leader and deck discovery retain their existing query/filter semantics with common controls visible and extra facets disclosed on demand. Applied facets remain visible; URL-based removable chips retain other parameters, repeated deck selections and view/game settings. Deck chips preserve the selected deck even outside filters. Real-data landing retains valuation, movers, costs and all breakdowns beneath the illustrated hero.

## Route coverage
The companion `implementation-coverage.json` covers every current page, route handler and manifest. See the three workstream migration documents for detailed changes. Backend endpoints and redirects retain their existing homes and implementations. Live boards and guided tutorial inherit the theme foundation and deliberately retain their interaction-specific layout. No capability was removed in order to make a generic design frame fit.

## Assets and cost
Five generated illustrations derived from the user-approved prototype are shipped as WebP, approximately 1.2 MB total; originals remain in the design workspace. No screenshot collage or social-media overlays are shipped. Three lowest-cost available workers performed disjoint collection, administration and arena UI migrations. Coordinator reviewed their diffs, requested a second pass where shell-only edits left acceptance gaps, and completed shared foundation/filter integration. No new dependencies or schema changes.

## Focused verification
User requested minimal testing and one consolidated PR, overriding the older full-suite/one-PR-per-issue defaults for this UI migration. Integrated production build and TypeScript check, changed-file ESLint, existing guard scan and fixture-based browser checks were used. Guard scan covers 155 server functions, 47 page source files and 23 route handlers. Five server-initialized themes, selector choices, phone/desktop overflow and filter disclosure were checked on existing no-write setup fixtures. Namek and Ultra Instinct board fixtures were visually inspected on phone and desktop. Final evidence is summarized in the PR.

No live database, paid AI, synchronization, migration or production action was run during validation. Authenticated real-data pages were reviewed statically; all live-data combinations are not claimed runtime-tested. The full engine suite was intentionally skipped because engine logic and contracts are unchanged.

### Contrast-safe information surfaces

Use `ds-surface` for opaque information backgrounds without changing padding or geometry;
use `ds-panel` for a complete panel. Keep scene art visible between panels, not through
small labels, leader metadata, or explanatory copy. `ds-card-placeholder` explicitly
pairs the raised surface with muted text even when legacy card-art rules apply.

Use `ds-badge-neutral` for neutral filled badges, with `--ds-neutral-fill` (raised surface)
and normal ink. `--ds-line` remains a border token, never a filled-control colour.
`ds-status-success`, `ds-status-warning`, and `ds-status-danger` supply opaque paired
foreground/background colours for deck legality and card flags. `ds-button-danger`
supplies a white-on-dark-red action pair, including hover. Labels still convey status
without relying on colour alone.

The compatibility bridge makes existing translucent `bg-space-900/*` information panels
opaque and maps `bg-space-700` fills to the neutral surface outside live boards. It does
not alter border utilities, game-colour identity, card artwork, or board materials.
New components should use semantic classes rather than adding more legacy utilities.

Game-colour pills use `ds-color-red/blue/green/yellow/black/white` opaque pairs;
colourless uses the neutral badge pair. Preserve the colour names and ring identity,
but do not place pastel foregrounds on translucent fills over scene art.

### Desktop arena focus and scale

On wide desktops (1280px and above), keep one decision panel between the battlefield
and the hand. The right column is for card inspection and details. Move the panel with
CSS grid placement so its focused controls and state are preserved; never render a
second prompt. Phone placement stays unchanged.

Use numeric `--arena` presets because hand overlap spacing reads this value. At a typical
1576×890 desktop, normal field cards are 20% larger than the previous scale and hand
cards approximately 21% larger. Larger monitors step up further; short viewports and
expanded energy/response states step down. Keep energy totals visible while idle detail
rows are collapsed. Tall decision states may scroll vertically, but must not cover the
field or hand. Preserve horizontal scrolling for crowded rows and long hands.

Verified for this change with fixture previews at 390×844, 1366×768, 1440×900,
1576×890 and 1920×1080, including normal play, response, mulligan and energy details.
No live-data games or exhaustive game states were tested. See the desktop arena sizing
and decision placement PR for measured card sizes and verification scope.
