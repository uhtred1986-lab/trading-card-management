# DBS Card Companion — design system proposal

Version 0.6 · 15 October 2026 · **Proposal, not an approved production standard**

This package proposes five complete theme directions, a common component architecture and an interactive landing/match-selection prototype. It is a design handoff, not a production refactor. No application data, authentication, game engine or deployment settings were changed.

## Read this package

1. This document: evidence, visual principles, tokens, components and screen contracts.
2. [Component audit](component-audit.md): consolidation decisions plus a complete structural inventory of the current component files and page routes.
3. [Research](research.md): source-backed product findings and aesthetic interpretations.
4. [Handoff](handoff.md): implementation sequence, acceptance criteria and verification limits.
5. Open `index.html`: interactive Home, Arena, deck/collection layout studies and component specimens. Switch themes in the header. All collection figures and deck names are illustrative.

## Evidence and current state

Reviewed the selected local `trading-card-management` checkout at `57fbe43b`, and the GitHub default-branch tree returned at `e98d17b0ba6ecb5cbc9454527b7287fab91c196a`. Detailed source findings and inventory refer to the local snapshot; the differing remote revision is not represented as identical. The two-commit upstream delta was also reviewed: it changes arena card-action ordering, search candidates, beam geometry, passive notices and tutorial coaching. It does not change the shared shell/theme architecture or landing/match-selection components. A production migration must preserve those newer arena behaviors. No live authenticated app or private collection data was inspected.

The app is already a substantial companion, covering collection and valuation, catalog and card details, built/virtual decks and reservations, AI assistance, scanning and entry, meta/news, Masters arena play, offline sessions, tutorials, rules tooling and administration. The route and component inventories cover the whole local app structurally; detailed behavior review focused on the shared shell, themes, cards, discovery, inputs, overlays and match setup. This is not a claim of exhaustive runtime testing.

### Existing strengths to preserve

- `src/app/layout.tsx` reads the skin cookie on the server and applies `data-skin` to the root: both skins already extend across the app without a first-paint theme flash.
- `src/lib/arena/skin.ts` defines `anime` and `night`, with anime as the current default. Existing designs are Anime Sky and Night Table. These proposals refine that pair; they do not assume a missing light mode.
- `globals.css` already defines space, ki and card-colour tokens. Anime Sky deliberately uses sky, paper, ink and hard cel shadows, while Night Table uses blue-black surfaces and orange energy.
- `CardImage`, `CardFaces`, `CardTile`, `ColorPill`, `DeckDiscovery`, `DeckFacts`, `SubmitButton`, the app shell and navigation model are useful existing shared foundations.
- `MatchSetup` already has a phone wizard with focus restoration and a desktop form. `PlayPicker` already separates the user's deck, opponent and readiness.
- The app preserves full card proportions, provides mobile navigation and reserves the full screen for active play.

### Friction revealed by source inspection

| Finding | Evidence | Proposed response |
|---|---|---|
| Dark-oriented palette names act as semantic roles even in light mode | `text-space-*`, `bg-space-*` throughout pages; global anime remapping and selector overrides | Add semantic aliases and migrate shared controls first |
| Visual variants are repeated inline | Repeated rounded border/background/input strings in discovery, scan flows, capture, AI and lists | Shared Button, Field, Surface, Badge and Feedback components |
| Presentation and server pending behavior are separate but not consistently composed | `SubmitButton` has pending logic but accepts arbitrary class strings | Keep pending behavior and compose a shared visual Button |
| Overlay foundations are fragmented | Native dialogs in MatchSetup/DeckPreviewSheet/settings/shared sheets; role dialogs in rules/stage components | Centralize accessibility and layering; retain domain content and special board sizing |
| Useful primitives are trapped in pages or arena modules | Dashboard `Tile`/`Table`; `Sheet` in arena shared sheets | Extract a Metric and appropriate summary list; move generic dialog foundation out of arena |
| Color alone could blur unrelated domain concepts | Card colour pills, readiness, legality and collection gain/loss coexist | Separate game colour, action, financial status, legality and engine-readiness roles |

## Design intent

**Card art is the spectacle. The interface is the support system.** Use Dragon Ball energy in the hierarchy and a few graphic gestures, while keeping card text, quantities, prices and match decisions calm.

Shared signatures: a compact circular energy mark; warm orange action; clear blue wayfinding; strong condensed headings; leader-first deck identity; restrained concentric energy rings. A selected card can carry a crisp ring and checkmark. Avoid a glow around every surface, animated noise behind text, decorative unreadable glyphs, or franchise terminology replacing useful task labels.

### Light theme: Anime Sky

Pale blue technical canvas, white reading surfaces, dark ink, cobalt links and warm gi-inspired orange actions. Thin technical rules and circular radar geometry give a Capsule-style instrument feel without copying a logo. The intended mood is open, organized and optimistic.

Use broad breathing room around the hero and compact clean rows for actual card management. Keep full card art saturated. Avoid parchment, fantasy frames or copying Gullet Cove's aesthetic.

### Dark theme: Tournament Night

Deep navy canvas, distinct blue-gray layers, cool readable ink, ice-blue selection and warm gold-orange action. The intended mood is a focused evening table under arena lighting. Use restrained aura only around the featured leader, never glowing paragraphs or continuous flashing.

The theme does not change the route structure, spacing, card aspect ratio, interaction order, data or feature availability. It is a parallel design system with the same component contracts.

## Foundation tokens

The prototype CSS is the executable token reference. Production should expose role names through Tailwind/theme aliases rather than scatter these literals through components.

| Role | Anime Sky | Tournament Night | Usage |
|---|---|---|---|
| `canvas` | `#eaf7ff` | `#080f20` | Page background |
| `surface` | `#ffffff` | `#13213a` | Reading panels and header |
| `raised` | `#dceeff` | `#1b3152` | Selected cards, quiet information |
| `ink` | `#142133` | `#f0f5ff` | Primary text |
| `muted` | `#435973` | `#b0c2df` | Secondary text, never low-opacity text |
| `line` | `#94b2ce` | `#405b7c` | Decorative separators |
| `strong-line` | `#3e5974` | `#789bc3` | Input and control boundaries |
| `accent` | `#ffad32` | `#ffb33f` | Primary action fill |
| `accent-ink` | `#142133` | `#111c30` | Text on action fill |
| `link` | `#164bb3` | `#8cd5ff` | Links and structural accent |
| `focus` | `#1455d9` | `#8cdfff` | Keyboard focus and selection |
| `success` | `#14623c` | `#87e0b0` | Confirmed ready/success text |
| `success-bg` | `#e1f3e7` | `#143b31` | Success background |
| `warning` | `#7e4b09` | `#f3cb7e` | Needs attention |
| `warning-bg` | `#fff0ce` | `#3c301c` | Warning background |
| `danger` | `#b12436` | `#ff9bab` | Error/destructive semantics |
| `hero` | `#bce5ff` | `#123c65` | Bounded hero illustration field |

Keep `dbs-red`, `dbs-blue`, `dbs-green`, `dbs-yellow`, `dbs-black` and `dbs-white` as **game identity**, not state. Use readable text labels alongside swatches. Match the repository's existing game definitions and add new values centrally. Do not infer a deck's game from its colour.

### Typography

- Production recommendation: reuse existing Kanit italic 800/900 for major expressive headings, and Barlow Semi Condensed 500/600/700 for compact game labels. Neutral body/system text for longer forms and tables. No additional font dependency is required.
- The dependency-free prototype uses Impact / Arial Narrow for display and Trebuchet MS / Arial for body. This is a deliberate portable approximation, not exact typography proof; installed fonts vary by device.
- Display: 58–84px desktop hero, 43–58px mobile, line height 1.1. Do not use display uppercase for long sentences or card rules.
- Page title: 38–58px; section title 22–24px; card title 15–19px; body 14–16px / 1.5; helper 12–13px. Prototype tiny specimen and decorative labels may be 10–11px, never the only carrier of essential information.
- Prices, quantities and power use tabular numerals. Use existing money formatting; monetary storage remains integer cents.

### Space, shape and elevation

- Base spacing sequence: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64px.
- Page width up to 1440px; content padding 5% desktop, 20px phone.
- Controls: at least 44px hit area; primary buttons 46px. Inputs use a strong boundary, not only a pale background.
- Radii: control 6–8px; panel/deck 12px; hero 16px; circular motifs only for small identity marks and steps.
- Keep a clear border as the primary separation. Soft shadows are supplementary. Hero card shadows may be dramatic; form panels should not be.
- Card ratio: 63:88. Full card/media uses `object-fit: contain`. Cropping is permitted only for a separately labelled decorative portrait; never hide rules text in an inspection view.

### Motion and accessibility

- Use 120–180ms state transitions; 200–300ms optional sheet transition. Theme switch should be immediate or subtle. No looping background movement in this prototype.
- Respect reduced motion; disable decorative transforms/animations and smooth scrolling.
- Normal text target 4.5:1; large text 3:1; meaningful control borders and focus indicators 3:1. `line` is a decorative token, not sufficient alone for a control boundary.
- Selected state = contrast + border + check/text, not colour alone. Disabled = actual disabled semantics plus a visible reason nearby when blocked.
- Native dialogs: name, modal focus containment, Escape, sensible initial focus, return focus to trigger. Destructive actions require explicit wording. Background content must be inert while modal.
- Mobile safe areas and bottom-nav clearance are mandatory. Card grids remain two columns where readable; form fields stack before they become cramped.
- Persist theme without losing selections. In production, retain server cookie initialization and backwards compatibility with `anime`/`night`. Do not add a conflicting local preference alongside the existing cookie.

## Component contracts

All components must work in both themes with identical semantics. See the audit for specific source mapping and retention decisions.

| Component | Purpose and variants | State/behavior requirements |
|---|---|---|
| Button / ButtonLink | primary, secondary, quiet, danger; standard/compact/icon | hover, focus, pressed, disabled, pending; navigation stays a link |
| SubmitButton | server-action pending adapter | preserve existing form context; prevent duplicate submit; readable pending label |
| Field | label + control + hint/error; input/select/textarea | required, invalid, disabled, read-only; label association and `aria-describedby` |
| Surface | flat, raised, outlined | generic spacing and role tokens; do not make every surface clickable |
| Badge / StatusBadge | neutral, positive, warning, negative | text/icon meaning; domain adapters map real state |
| ChoiceGroup | radio-like exclusive choices, filter chips, segmented views | pressed/selected semantics; keyboard behavior appropriate to chosen element |
| Dialog / Sheet / Popover | desktop modal, phone sheet, anchored hint | centralize focus/escape/restore, stacking and scroll; domain content remains local |
| Feedback | inline info, validation, warning, success, empty/error/loading | meaningful recovery action and appropriate announcement |
| PageHeader / SectionHeader | eyebrow, title, context, actions | one dominant page action; no decorative content leaking into form labels |
| Metric / SummaryList | count/value/change and label/value rows | tabular figures, currency formatting, explicit unknown/stale state |
| AppShell / NavLink | desktop navigation, phone tabs/menu, focused/full-bleed | one route model, active state, access filtering, safe areas |
| CardMedia / CardFaces | front, paired, flip, missing-art | preserve source, accessible names, correct aspect ratio and inspection |
| CardTile / CardRow | catalog and collection presentations | optional ownership/foil/price slots; no implicit private-data fetch |
| GameBadge / CardColourPill | game and card identity | separate from success/error; include label |
| DeckIdentity / DeckCard | leader, name, game, colours, built/virtual | ready/locked/selected; open-rule reason; share across browse/setup/preview |
| DeckDiscovery | controlled selected deck, search and filters | keep selection outside filters visible; empty/reset/load-more; stable IDs |
| ReadinessSummary | open/draft/confirmed/runtime readiness | do not collapse legality or engine support into a single boolean claim |
| FilterBar / SearchField | list searches and facets | retain URL state where current behavior uses it; reset dependent filters |
| QuantityControl / EntityPicker | common control presentation | keep owner/lot/deck mutations and permissions in domain wrappers |
| MatchSetup / MatchSummary | deck → opponent → review | phone wizard/desktop columns; clear blockers, opponent deck, cost and final action |

### Required component state specimens

Every shared foundation needs default, hover, focus-visible, disabled, pending and error specimens where relevant. Every domain card needs long names, missing artwork, unknown value, zero quantity, selected, locked and loading variants. Show both themes and a narrow phone width. A specimen is not a fake second implementation of production behavior: import the actual shared component when migrating the app.

## Screens and navigation

### Landing / Home

The current `/` is a collection dashboard. The concept explores a more welcoming home with a leader/awakening hero, a direct Arena action, a Collection action, compact collection figures and recent decks. Treat this as a proposal for the top of Home, not permission to remove valuation tables, price provenance or the current empty-collection flow.

Returning users should get practical tasks quickly. In production the hero can be compact or dismissible; first-time users get Add cards / Browse catalog when empty. Do not invent live performance statistics.

### Match selection

1. Fixed Masters context. Do not offer Fusion World matches.
2. Own deck with leader identity, built/virtual state and readiness.
3. Opponent type and, where needed, opponent deck. Preserve Sparring, Tournament, online friend and same-device pass-and-play in production.
4. Review: own deck, opponent/mode, game, readiness, current cost information and one final action.

The prototype implements deck search, colour filtering, selected-state retention, mode choices, opponent deck selection, a locked-deck example and a modal review. It does not create a game, charge for AI, invite another user or simulate a game engine. The online friend preview is illustrative, not an assertion that an eligible friend is available.

Production phone behavior retains the existing three-step MatchSetup wizard and its validation. The prototype presents a scrollable phone sequence with numbered sections to make all design decisions inspectable quickly; this is an intentional fidelity limit, not a recommendation to discard the existing wizard.

Legality remains a warning/flag under existing app rules. Open engine rules may lock arena entry. Missing leader/minimum deck size and permission checks remain existing domain gates. A theme component must never invent or weaken these decisions.

### Wider website

| Destination | Shared composition | Domain-specific content |
|---|---|---|
| Collection and archive | Header, filters, grid/list, card media, empty state | Lots, ownership, prices, reservations and archive actions |
| Catalog / card detail | Search, game filter, CardTile/Row, inspector | Printed text, faces, variants, external marketplace links |
| Decks / deck detail / leaders | Discovery, DeckIdentity, status, media | Construction, legality, built reservations, AI analysis |
| Add / scan / quick / bulk | Field, Feedback, choices, progress | Camera, recognition, batch confirmation and private writes |
| Arena hub / waiting / history | AppShell or ArenaHeader, deck facts, match summaries | Invitations, readiness, local/offline availability |
| Active match | Full-bleed shell + shared overlays | ArenaStage, prompts, combat, hand and game-state timing |
| Meta / news / cart | Header, list/table, badge, source metadata | Price sources, optimization and metagame queries |
| Account / settings | Field, Button, Feedback, section grouping | Role restrictions, credentials, users, locations and sync |
| Rules / review / testing | Shared surfaces, fields, dialogs, feedback | Admin-only rule editor, runtime evidence and debugging |

Production navigation preserves the existing phone destinations: Arena, Collection, Cards, Decks, Add. Home remains on the wordmark. Desktop concept makes Arena visible beside Home, Collection and Decks, with catalog, leaders, meta, add and settings in the menu. This is a reviewable desktop proposal; route names, admin filtering and player Me behavior must continue to come from one navigation model. Full-bleed matches keep their current specialized navigation contract.

## Gullet Cove documentation pattern adopted

The reference is valuable for preparation: separate UI standards (behavior and layout), role tokens/components (appearance), interaction/copy rules, live specimens, and archived boards with provenance. Adopt its board-to-component and literal-to-token mapping. Do not copy its fantasy palette or domain rules.

This proposal keeps those concerns in a compact package. When accepted, move the normative decisions into the app's design documentation and retain this proposal with its status and superseded decisions. Future agents need an explicit approved reference, not screenshots silently competing with current code.

## Acceptance and status

See [handoff.md](handoff.md) for the migration plan and validation status. The prototype is a self-contained static artifact. The initial Sites creation error was resolved on an explicitly requested retry, after checking that the first attempt had created no site. The publication result is provided separately. Source syntax, assets, internal links and token contrast are checked separately in the handoff. Local browser rendering and the main prototype interactions have now been verified at desktop and phone widths. Live application behavior is outside this prototype.

## Revision 0.2 — owner feedback

The light direction now explicitly follows the existing Anime Sky character: blue sky and cloud washes, faint screentone, strong ink borders, hard offset cel shadows, italic impact headings, orange outlined headline lettering, directional energy rays and card-sticker framing. Tournament Night mirrors the same graphic language with a deep blue arena and restrained cyan aura. Both retain opaque reading surfaces.

The previous prototype failed in a real browser because a global function named `top` collided with a protected browser property. The app is now enclosed in a private scope and uses `pageHeading`; verified switching changes the actual theme and persists after reload. Asset URLs are versioned to refresh the fixed script.

The table above reflects the CSS v0.2 values: light canvas #eaf7ff, surface #ffffff, raised #dceeff, ink #142133, muted #435973, line #94b2ce, strong-line #3e5974, accent #ffad32, accent-ink #142133, link #164bb3, focus #1455d9, hero #bce5ff; dark canvas #080f20, surface #13213a, raised #1b3152, ink #f0f5ff, muted #b0c2df, line #405b7c, strong-line #789bc3, accent #ffb33f, accent-ink #111c30, link #8cd5ff, focus #8cdfff, hero #123c65. Success/warning/danger roles retain their previous values.

## Revision 0.3 — illustrated tournament world

The owner selected the classic Dragon Ball tournament grounds as the light-theme environment and Gullet Cove's illustrated screens as the compositional reference. The page now uses an original generated tournament-ground illustration as its world plate: bright sky, palms, mountain silhouettes, warm tiled courtyard and tournament gate. The hero's right side reveals the scene; quiet warm reading surfaces sit above it. The dark theme retains Tournament Night pending a separate scene selection.

Reference inspected: Gullet Cove Gazette desktop board (`docs/design/boards/gazette/exports/desktop/1-ausgabe.jpg`) plus its SceneBackdrop documentation. Adopt the full-page setting, focal-position control and readable panels; do not import the newspaper or fantasy decorations. The illustration is an original generated interpretation, not an official screenshot. No decorative looping movement is required to make the screen feel alive. Use controlled hover/selection feedback and visual depth.

The scene's light paper background is #fffdf7; the surrounding courtyard ground is #ede4d1. On phones use an offset crop that keeps the tournament gate and palms visible, with the card display below the heading. Keep a scene-free fallback colour.

## Revision 0.4 — sunlit panel materials

Owner feedback: heavy navy boxes clashed with the illustrated courtyard. Light-theme controls now use warm ivory #fffef9, pale sky selected surfaces #eaf5f7, softer slate outlines and low-opacity sandy shadows. Reading ink remains dark #273d49; secondary ink #506570. Saturated orange is reserved for primary actions. Dark-theme materials are unchanged. The light-theme CSS overrides are the latest executable token reference. This replaces v0.2's hard navy offset shadows on reading panels while preserving expressive card art and headings.


## Current theme collection — version 0.5

The header selector offers exactly five worlds. These replace the earlier two-choice concept. `dark` remains the persisted key for compatibility, now labelled Tournament of Power.

| Theme | Key | Scene | Panel material | Accent |
|---|---|---|---|---|
| Anime Sky | light | Classic sunlit tournament grounds | Warm ivory, sandy shadows | Golden orange |
| Namek | namek | Emerald sky, orange planet, blue trees | Pale mint, green outlines | Apricot |
| Family Sky | family | Friends in a bright Capsule-style city | Airy ivory, cool blue details | Warm orange |
| Tournament of Power | dark | Floating arena in a violet cosmic void | Plum charcoal | Sand gold and turquoise |
| Ultra Instinct | instinct | Goku with a blue-white aura | Deep blue | Ice blue and silver |

Each theme uses the same semantic roles and shared components. Never recolor game/card-color badges to match decoration. Anime Sky, Namek, Tournament of Power and Ultra Instinct use generated illustrations inspired by the user references. Family Sky uses the matching supplied-reference artwork retrieved from Yahoo/GameRevolution after group image generation was blocked; source: https://tech.yahoo.com/gaming/articles/dragon-ball-game-arriving-2027-184700726.html . Artwork remains owned by its respective rights holders. Social captions and overlay graphics are omitted. Decorative scenes do not convey game state. Source assets live in `assets/`. Keep readable opaque surfaces behind lists and controls, with scenery visible above and around them. Mobile crops prioritize the scene's focal subject.

Theme selection updates the URL `theme` parameter, saves locally, and works across routes. A valid explicit URL theme wins at initial load. The design-system specimen displays the active theme. Use native keyboard-accessible selection, preserve focus and the existing match choices, and retain Masters-only and locked-deck behavior.

Desktop and mobile browser checks cover all five theme choices, reload persistence, horizontal overflow and locked/ready match review. Core ink, muted text, links and primary-button text meet 4.5:1 against their semantic surfaces. These checks do not constitute exhaustive accessibility or production-app validation.


## Revision 0.6: calmer illustrated world and complete navigation
Family Sky is replaced by Korin’s Tower (the `family` key remains compatible). Use muted warm-ivory panels over the generated tower, forest and river landscape; keep decorative detail at the bottom on long pages. See [layout guide](layout-guide.md) for top navigation, settings sidebar, landing, secondary tabs and progressive filters; [route capability audit](route-capabilities.md) maps every current route with its access and proposed home. The prototype includes functional additional filters, removable chips, reset, counts and empty states. The capability view is searchable and separates screens from supporting handlers. Settings remains privileged; player Account remains separate.
