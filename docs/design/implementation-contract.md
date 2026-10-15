# Implementation contract — five worlds

User-authorized single consolidated delivery PR for tracking #890 / milestone 29. Workstream issues #891–894 track acceptance within it. Minimal checks override historical full-suite/per-page screenshot defaults for this UI-only change. No database writes/migrations or new dependencies.

Shared imports from `@/components/ui`:
- `PageHeader({title, eyebrow?, description?, actions?, children?})`: semantic H1 and readable themed heading surface.
- `Panel({children, className?, ...HTMLAttributes<HTMLElement>})`: reusable section material.
- `SectionTabs({items:[{href,label,active?}],label?})`: real existing routes or query destinations only.
- `FilterBar({children,more?,active?,summary?})`: common controls always visible, optional controls in native disclosure, active filters outside, result count.
- `EmptyState({title,children?,action?})`.

CSS class hooks available: ds-page-header, ds-panel, ds-tabs, ds-button, ds-button-secondary, ds-actions, ds-eyebrow, ds-settings-layout, ds-settings-sidebar, ds-page, ds-hero. Existing Tailwind space tokens are bridged to theme semantic materials while migrating pages; domain color pills must retain game meaning.

Theme keys remain `anime` and `night` for compatibility plus `namek`, `korin`, `instinct`. Shared `SKIN_LABELS` maps to Anime Sky / Tournament of Power / Namek / Korin’s Tower / Ultra Instinct. Theme is cookie-backed and initialized by RootLayout. Keep board roots and app root aligned. No game engine or data mutations for visual state.

Workers own disjoint page/component groups; coordinator owns UI primitives, globals.css/theme styles, AppShell, HeaderNav, PhoneAppMenu, navigation.ts, skin.ts, SkinToggle, BoardSettingsSheet, LocalArena theme parsing, assets, root layout. Workers don't touch those hot files, don't spawn agents and don't run expensive tests. Preserve server guards, reads, SQL, forms/actions, selection state, domain semantics. Migrate actual views rather than replacing them with mock data. Each worker records every assigned route and migration status, including redirect/resource exclusions. Commit in own branch; coordinator integrates and validates.
