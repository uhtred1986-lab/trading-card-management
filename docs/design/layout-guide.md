# Companion layout and interaction guide

## The visual direction
An illustrated world surrounds the interface. The five options are Anime Sky, Namek, Korin’s Tower, Tournament of Power and Ultra Instinct. Korin’s Tower replaces Family Sky, retaining its `family` preference key for existing links. Its muted blue sky, warm clouds, sage forest and detailed lower landscape are paired with softened ivory surfaces. Keep scenery visible around panels throughout long pages; never fade the bottom into a large empty colour field. The landscape is decorative and never determines status or card colour.

## Navigation hierarchy
- **Top menu:** Home, Collection, Cards, Decks, Arena, Insights. These represent enduring user tasks. Theme selection and the account/settings menu sit at the right. On mobile the compact bottom navigation exposes frequent actions; the menu must expose all remaining primary destinations.
- **Settings side menu:** Appearance, Account & access, AI & integrations, Data & sync, Storage locations, Users & access, Administration. Authorization controls the visibility and execution of restricted tools. Within Settings, use a left sidebar on desktop and an overflowable section list on mobile. The global account menu also links to these destinations.
- **Secondary menu:** local tabs below the page heading. Arena: New match, Your games, Learn to play. Cards: All cards, Leaders. Collection: Overview, Add & scan, Find missing cards. Deck work distinguishes browsing, construction, recommendations, reservations and detail; see the route audit for precise existing homes.
- **Contextual routes:** card/deck/game details retain the parent top-level selection and show a back link or breadcrumb. Auth callbacks, image delivery and service endpoints are supporting routes, not navigation entries.
- **Design review:** Capability map, Layout guide and Component library are prototype review tools in the menu; they are not proposed end-user product destinations.

## Landing page
An illustrated hero offers Enter the arena and My collection. Follow with compact collection statistics, ready/recent deck tiles and discovery links. For signed-in production users, resume active games and unfinished collection tasks before general discovery. Prototype statistics remain explicitly illustrative. Keep the scene visible without compromising readable text surfaces.

## Core components
Centralize AppHeader, PrimaryNavigation, AccountDrawer, SettingsSidebar, SectionTabs, Breadcrumbs, PageHeading, FilterBar, AdditionalFilters, ActiveFilterChip, ResultCount, CardTile, DeckTile, GameBadge, ReadinessBadge, FormField, Dialog, EmptyState and Notice. Theme tokens control material and colour; game rules, eligibility, permissions and billing remain in their existing domain services. Card colour, game format, ownership and rules readiness must remain distinct.

## Progressive filtering example
The working Cards and Collection sample keeps search, game and card colour permanently visible. More filters reveals card type and ownership on demand. Applying an extra filter updates results immediately and creates a removable chip outside the disclosure. Closing the disclosure never hides the fact that a filter is active. Clear filters resets all choices; a live result count and explicit empty state explain the result. Keyboard users can open the native disclosure, change controls and remove chips.

The demo contains four Masters cards, with illustrative ownership. Choosing Fusion World deliberately returns a clearly labelled sample-data empty state; it does not imply lack of Fusion World support in production. Leaders adds a contextual Leader constraint. Future production facets can include set, rarity, cost and condition, provided they exist in that route's underlying data. Do not show irrelevant facets on every screen. The prototype filter choices persist during route navigation, not across reloads; production should encode shareable filters in the URL.

## Scope and route coverage
See [the capability audit](route-capabilities.md) and its machine-readable [inventory](route-capabilities.json). Every current route is assigned a home; a home is a proposed location, not a claim that its production workflow has been rebuilt. This prototype demonstrates landing, match selection, collection filters, settings navigation and an inspectable capability view. Operational features, authentication and admin actions stay in the existing application.

Current Settings is privileged; players retain My account (`/me`). The prototype demonstrates the privileged layout without changing permission policy. Storage locations and Users & access must remain discoverable. See the full audit for Arena offline, Collection archived/cart and all contextual destinations.
