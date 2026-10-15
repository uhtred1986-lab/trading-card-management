# Component architecture audit

15 October 2026 · proposal based on the selected local source snapshot. See `design-system.md` for scope and revision provenance.

## Summary

The app already has substantial reuse. It needs a coherent foundation beneath its domain components, not wholesale replacement with a generic UI kit. Keep reusable domain behavior, extract repeated presentation, and preserve specialized arena interaction.

The structural inventory below enumerates every TSX file under `src/components` and every page route under `src/app`, including internal previews and admin tools. Export lists and route imports are mechanically extracted for traceability. Detailed review concentrates on the current theme, shared shell, card/deck patterns, forms, overlays and match setup; inventory inclusion alone does not mean each implementation was runtime-tested.

## Recommended ownership layers

| Layer | Proposed home | Owns | Must not own |
|---|---|---|---|
| Foundations | `components/ui/` | Button, Field, Surface, Badge, Dialog, Sheet, Popover, Feedback, layout primitives | Database queries, game rules, auth decisions, private data |
| Application shell | Existing shell + `components/navigation/` if useful | AppShell, HeaderNav, BottomTabs, menu, theme control, route-based layout | Independent duplicated route lists or security checks |
| Card/collection domain | `components/cards/`, `components/collection/` | Media, faces, tiles/rows, colour/game identity, quantities, lots | Arena scene timing and match mutations |
| Deck domain | `components/decks/` | Identity, discovery, facts, legality, built/virtual, readiness views | Recomputed reservations or inferred engine support |
| Arena domain | Existing `components/arena/` | Match setup, game state, scene, prompts, hand, local/online adapters, rules tools | A second unrelated design foundation |
| Capture/settings/AI domains | Existing feature modules | Camera, parsing, provider settings, access, mutations | Reimplemented generic dialog/field/button semantics |

Folders are recommended boundaries, not a mandatory mass rename. Move files only when it improves imports and ownership; preserve compatibility exports during migration if needed.

## What to centralize first

| Priority | Common component | Existing evidence | Boundary and decision |
|---|---|---|---|
| P0 | Semantic theme roles | Global palette remaps and anime selectors | Foundation aliases drive all new primitives; keep old names until callers migrate |
| P0 | Button + ButtonLink | Repeated button strings; SubmitButton only owns pending behavior | Centralize variant/size/focus/disabled styles; preserve server pending adapter |
| P0 | Field + Input/Select/Textarea | DeckDiscovery, ScanFlow, capture, AI, settings | Share appearance and label/hint/error association, not values or persistence |
| P0 | Surface + Page/SectionHeader | Inline rounded bordered panels and local headings across routes | Named surface roles and consistent spacing; avoid a universal overly configurable Card |
| P0 | Feedback + EmptyState + LoadingState | Capture success/error, AI unavailable, list empty, PageSpinner | Explicit status text and retry/reset; retain domain-specific copy and loading logic |
| P0 | Dialog/Sheet foundation | Native and role dialogs across arena/settings/rules | Single accessibility contract, independent domain body; do not alter board semantics |
| P1 | Badge + domain status adapters | DeckStatusBadge, readiness, scan labels, build state | Neutral visual primitive; legality/readiness/ownership stay separate adapters |
| P1 | DeckIdentity / DeckCard | DeckFacts, DeckDiscovery, PlayPicker, leader/deck previews | Share leader/name/game/colour/built data layout; selected/locked variants |
| P1 | ChoiceGroup styling | GameFilter, ViewToggle, mode chips, scan controls | Shared appearance only where semantics differ; links remain links, radios remain controls |
| P1 | SearchField presentation | LiveSearch, CardSearchInput, DeckDiscovery | Retain URL debounce, autocomplete and local filtering as different controllers |
| P1 | EntityPicker presentation | OwnerPicker, LocationPicker and lot/deck variants | Generic input/result shell; keep owner-specific mutations and constraints in wrappers |
| P1 | QuantityControl presentation | DeckCardControls, collection/copy editing, entry flows | Shared hit targets, bounds and pending appearance; distinct transactional domain logic |
| P1 | Metric / SummaryList / Table shell | Home Tile/Table, card and collection lists, marketplace | Share numeric typography/loading/overflow; do not merge incompatible column models |
| P2 | Shared user preferences control | SkinToggle, board options, settings | Consistent controls; theme cookie and board preferences retain current storage contract |

## What to retain and improve

- **CardImage** remains the authority for image rendering/fallback. CardFaces builds upon it; CardTile and CardRow compose it. Do not build a competing image component inside match selection.
- **CardFaces** already supports pair/flip and missing back artwork. Keep it; theme its surrounding frame.
- **ColorPill** remains the game-colour adapter. Add shared badge styling without changing game identity.
- **DeckDiscovery** already manages bounded results, filters and preserved hidden selection. Reuse and theme it; do not replace it with a new carousel that loses those behaviors.
- **DeckFacts / DeckDescription** are existing domain abstractions, not duplication to erase. Extract a smaller DeckIdentity if several views need the same header.
- **SubmitButton** keeps `useFormStatus` inside the form. Its visual implementation should call the common Button style contract.
- **GameFilter** preserves other query parameters and resets dependent set/page state. Theme its link chips without converting navigation to unrelated local state.
- **AppShell + navigation model** already distinguish ordinary pages, arena phone headers and full-bleed matches. Extend this model instead of adding separate theme-specific shells.
- **MatchSetup** retains phone wizard/desktop form behavior. Centralize its dialog mechanics only after preserving review-only submission and focus restoration.

## What stays specialized

ArenaStage, StageZones, Hand, StageCard, DuelBand, PromptPanel, turn lighting, combat motion and local/online session adapters are game components. They may consume shared surfaces, text and dialogs, but a single generic Card component should not absorb them.

Likewise ScanFlow, QuickCapture and BulkEntry have distinct workflows; they should share primitives, not be merged into an opaque universal form. AI generation/analysis and admin rule tools retain their domain state. Owner/lot/deck pickers share a visual shell but must not share arbitrary write behavior.

## Example contracts for future implementation

These describe proposed API intent, not code already committed to the app.

- `Button`: variant, size, disabled, pending, icon, accessible label. `ButtonLink`: equivalent appearance with href/navigation semantics.
- `Field`: id, label, hint, error, required and a control slot. Field itself does not fetch or write.
- `Dialog`: open, onOpenChange, title, description, initialFocus, returnFocus, children. `Sheet` chooses responsive presentation while preserving the same modal contract.
- `DeckIdentity`: deck name, leader media/name, game, colours, built/virtual and optional status. It renders passed facts rather than computing legality or readiness.
- `ReadinessSummary`: explicit domain readiness object + compact/expanded presentation; no generic `isValid` that merges rule support and deck legality.
- `CardTile`: card media/identity plus optional metadata/actions slots. Quantity, foil, price and reservation adapters remain domain-owned.
- `FilterBar`: compositional layout. Search debounce and query serialization remain in current domain controllers.

## Component and route state coverage

Core primitives need both-theme specimens for default, hover/focus, pressed, disabled, loading and invalid states. Domain patterns need realistic long names, unavailable art, empty results, stale/unknown prices, selected deck hidden by filters, locked rules, offline/unavailable modes and role-dependent actions.

Before centralizing an overlay, record its current focus entry/return, Escape behavior, outside-click behavior, scrolling, safe areas and board interaction constraints. A shared abstraction is only an improvement if it preserves these contracts.

## Structural inventory

The following tables are generated from the reviewed local checkout. “Keep/domain” means keep feature ownership while adopting foundations; it does not mean its current implementation needs no refinement.

### Component files (124)

| Existing file | Named exports (structural) | Recommendation |
|---|---|---|
| `AppShell.tsx` | AppShell | Retain shell/full-bleed contract |
| `ArchivedList.tsx` | ArchivedList | Keep/domain; consume shared primitives |
| `BottomTabs.tsx` | BottomTabs | Retain phone destinations and safe areas |
| `BuildDeckButton.tsx` | BuildDeckButton | Keep/domain; consume shared primitives |
| `BuiltToggle.tsx` | BuiltToggle | Keep/domain; consume shared primitives |
| `BulkEntry.tsx` | BulkEntry | Keep/domain; consume shared primitives |
| `CardDecks.tsx` | CardDecks | Keep/domain; consume shared primitives |
| `CardFaces.tsx` | CardFaces | Retain composed card-face variants |
| `CardImage.tsx` | CardImage | Retain shared card media authority |
| `CardList.tsx` | CardList | Shared table shell; keep card columns |
| `CardSearchInput.tsx` | CardSearchInput | Share SearchField; retain autocomplete |
| `CardTile.tsx` | CardTile | Retain; adopt common metadata/actions slots |
| `CartTools.tsx` | CartTools | Keep/domain; consume shared primitives |
| `CollectionList.tsx` | CollectionList | Shared table shell; keep lot domain |
| `ColorPill.tsx` | ColorPill, RarityBadge, TypeBadge | Retain game-colour adapter over Badge |
| `CopiesPopover.tsx` | CopiesPopover | Shared Popover; retain lot/owner domain |
| `DeckAI.tsx` | DeckAI | Keep/domain; consume shared primitives |
| `DeckBuilder.tsx` | DeckBuilder | Keep/domain; consume shared primitives |
| `DeckCardControls.tsx` | DeckCardControls | Keep/domain; consume shared primitives |
| `DeckDiscovery.tsx` | DeckDescription, DeckFacts, DeckDiscovery | Retain discovery; share DeckIdentity/Field |
| `DeckLocationPicker.tsx` | DeckLocationPicker | Domain wrapper around EntityPicker |
| `DeckPicker.tsx` | DeckPicker | Keep/domain; consume shared primitives |
| `DeckStatusBadge.tsx` | DeckStatusBadge, CardFlagBadge | Domain adapter over StatusBadge |
| `GameFilter.tsx` | GameFilter, GameSelect | Retain URL semantics; share chip appearance |
| `HeaderNav.tsx` | HeaderNav | Retain central navigation model |
| `LeaderLibrary.tsx` | LeaderLibrary | Keep/domain; consume shared primitives |
| `LiveSearch.tsx` | LiveSearch | Share SearchField; retain URL controller |
| `LocationPicker.tsx` | LocationPicker | Shared EntityPicker shell |
| `LocationsAdmin.tsx` | LocationsAdmin | Keep/domain; consume shared primitives |
| `LotFinishToggle.tsx` | LotFinishToggle | Keep/domain; consume shared primitives |
| `LotLocationPicker.tsx` | LotLocationPicker | Domain wrapper around EntityPicker |
| `LotOwnerPicker.tsx` | LotOwnerPicker | Domain wrapper around EntityPicker |
| `LotPrintPicker.tsx` | LotPrintPicker | Keep/domain; consume shared primitives |
| `MarketplacePanel.tsx` | MarketplacePanel | Keep/domain; consume shared primitives |
| `NewDeckFromCard.tsx` | NewDeckFromCard | Keep/domain; consume shared primitives |
| `NewDeckWithClaude.tsx` | NewDeckWithClaude | Keep/domain; consume shared primitives |
| `OwnerPicker.tsx` | OwnerPicker | Shared EntityPicker shell |
| `PageSpinner.tsx` | PageSpinner | Shared loading presentation |
| `PhoneAppMenu.tsx` | PhoneAppMenu | Retain role-aware menu; share menu primitives |
| `QuickCapture.tsx` | QuickCapture | Keep/domain; consume shared primitives |
| `ScanFlow.tsx` | ScanFlow | Keep/domain; consume shared primitives |
| `ServiceWorker.tsx` | ServiceWorker | Keep/domain; consume shared primitives |
| `SkillText.tsx` | SkillText | Keep/domain; consume shared primitives |
| `SubmitButton.tsx` | SubmitButton | Compose shared Button; retain form pending adapter |
| `SwapSuggestions.tsx` | SwapSuggestions | Keep/domain; consume shared primitives |
| `UsersAdmin.tsx` | UsersAdmin | Keep/domain; consume shared primitives |
| `ViewToggle.tsx` | ViewToggle | Shared segmented appearance |
| `VoiceEntry.tsx` | VoiceEntry | Keep/domain; consume shared primitives |
| `WantList.tsx` | WantList | Keep/domain; consume shared primitives |
| `arena/ArenaCard.tsx` | permanentState, ArenaCard | Keep/domain; consume shared primitives |
| `arena/ArenaHeader.tsx` | interpreted, ArenaHeader | Keep/domain; consume shared primitives |
| `arena/BoardSettingsSheet.tsx` | BoardSettingsSheet | Use shared Dialog; retain board preferences |
| `arena/DeckPreviewSheet.tsx` | DeckPreviewSheet | Use shared Dialog; retain deck fetch/content |
| `arena/DeviceDecks.tsx` | DeviceDecks | Keep/domain; consume shared primitives |
| `arena/FeelToggle.tsx` | FeelToggle | Keep/domain; consume shared primitives |
| `arena/GameOver.tsx` | GameOver | Keep/domain; consume shared primitives |
| `arena/GamesList.tsx` | moveLabel, ContinueStrip, GamesList | Keep/domain; consume shared primitives |
| `arena/Invitations.tsx` | Invitations | Keep/domain; consume shared primitives |
| `arena/InviteShare.tsx` | InviteShare | Keep/domain; consume shared primitives |
| `arena/MatchSetup.tsx` | MatchSetup | Retain wizard; share Dialog foundation |
| `arena/MatchWaiting.tsx` | MatchWaiting | Keep/domain; consume shared primitives |
| `arena/OfflineDeck.tsx` | DeckProgress, FailedNotice, BlockingList, othersProblem, OfflineDeck | Keep/domain; consume shared primitives |
| `arena/OfflinePreparation.tsx` | OfflinePreparation | Keep/domain; consume shared primitives |
| `arena/PaceToggle.tsx` | PaceToggle | Keep/domain; consume shared primitives |
| `arena/PlayPicker.tsx` | PlayPicker | Retain orchestration; share deck/mode/readiness views |
| `arena/RematchButton.tsx` | RematchButton | Keep/domain; consume shared primitives |
| `arena/ReportBug.tsx` | ReportBug | Keep/domain; consume shared primitives |
| `arena/ReviewScreen.tsx` | reviewHref, ReviewScreen | Keep/domain; consume shared primitives |
| `arena/SkinToggle.tsx` | SkinToggle | Share preference presentation; retain cookie contract |
| `arena/StagingToggle.tsx` | StagingToggle | Keep/domain; consume shared primitives |
| `arena/TurnLighting.tsx` | TurnLighting | Keep/domain; consume shared primitives |
| `arena/immersion/ArenaImmersion.tsx` | ImmersionSettings, ArenaImmersion | Keep/domain; consume shared primitives |
| `arena/immersion/CombatBanner.tsx` | CombatBanner | Keep/domain; consume shared primitives |
| `arena/immersion/SoundControls.tsx` | SoundControls | Keep/domain; consume shared primitives |
| `arena/rules/Blocks.tsx` | RuleBlocks | Keep/domain; consume shared primitives |
| `arena/rules/ConfirmAll.tsx` | ConfirmAll | Keep/domain; consume shared primitives |
| `arena/rules/FullRuleBuilder.tsx` | FullRuleBuilder | Keep/domain; consume shared primitives |
| `arena/rules/Groups.tsx` | Groups | Keep/domain; consume shared primitives |
| `arena/rules/ProbePane.tsx` | ProbePane | Keep/domain; consume shared primitives |
| `arena/rules/ReferenceDrawer.tsx` | ReferenceDrawer | Keep/domain; consume shared primitives |
| `arena/rules/RuleBuilder.tsx` | RuleBuilder | Keep/domain; consume shared primitives |
| `arena/rules/RuleExplanationPanel.tsx` | RuleExplanationPanel | Keep/domain; consume shared primitives |
| `arena/rules/RuleExplanationPreview.tsx` | PREVIEW_RULE, RuleExplanationPreview | Keep/domain; consume shared primitives |
| `arena/rules/RuleReading.tsx` | RuleReading | Keep/domain; consume shared primitives |
| `arena/rules/RuleRecord.tsx` | ACTION_BAR_ID, RuleRecord | Keep/domain; consume shared primitives |
| `arena/rules/RuleReview.tsx` | RuleReview | Keep/domain; consume shared primitives |
| `arena/rules/SelectLink.tsx` | SelectLink | Keep/domain; consume shared primitives |
| `arena/rules/TeachPanels.tsx` | InMyWords, InMyWordsView, LikeACard, LikeACardView, teachTabs | Keep/domain; consume shared primitives |
| `arena/rules/Workbench.tsx` | Glyph, Workbench, StateSegments, Choice, chipClass | Keep/domain; consume shared primitives |
| `arena/rules/WorkbenchKeys.tsx` | FIND_ID, WorkbenchKeys | Keep/domain; consume shared primitives |
| `arena/rules/tryit/TryItPanel.tsx` | TryItPanel, TryItBoards | Keep/domain; consume shared primitives |
| `arena/rules/tryit/sheets.tsx` | WrongSheet, BoardSheet | Keep/domain; consume shared primitives |
| `arena/session/LocalArena.tsx` | LocalArena | Keep/domain; consume shared primitives |
| `arena/session/LocalMatchSetup.tsx` | localDeckChoices, LocalMatchSetup | Keep/domain; consume shared primitives |
| `arena/session/OnlineArenaStage.tsx` | OnlineArenaStage | Keep/domain; consume shared primitives |
| `arena/shared-display.tsx` | Counter, cardsOnTable, StepBanner, SkillSpotlight, AttackBeam, CardPreview, StoryList, NarrationRibbon, DockedInspector, InPlayList, InspectorColumn | Keep/domain; consume shared primitives |
| `arena/shared-sheets.tsx` | CardDetail, Sheet, SheetDialog, StepChip, ActionRows, StatTiles, ChipRow, SWIPE_PX, CLOSE_PX, swipeOf, CardSheet, SearchSheet | Extract generic dialog/sheet foundation; keep card detail domain |
| `arena/shared.tsx` | Module / types / re-exports | Keep/domain; consume shared primitives |
| `arena/stage/AdminDrawer.tsx` | AdminShield, AdminDrawer | Keep/domain; consume shared primitives |
| `arena/stage/ArenaStage.tsx` | ArenaStage | Keep/domain; consume shared primitives |
| `arena/stage/BattleParts.tsx` | battleShape, firedInBattle, Count, ChainCard, Chain, Totals, TriggerLine, BattleVerdict, ClashBeam, ClashBackdrop, STEP_WORD | Keep/domain; consume shared primitives |
| `arena/stage/DuelBand.tsx` | DuelBand | Keep/domain; consume shared primitives |
| `arena/stage/FeedbackOverlay.tsx` | FeedbackOverlay | Keep/domain; consume shared primitives |
| `arena/stage/GameEnd.tsx` | GameEnd | Keep/domain; consume shared primitives |
| `arena/stage/GamePlanPanel.tsx` | GamePlanPanel | Keep/domain; consume shared primitives |
| `arena/stage/Ghosts.tsx` | Ghosts | Keep/domain; consume shared primitives |
| `arena/stage/Hand.tsx` | HAND_W, Hand | Keep/domain; consume shared primitives |
| `arena/stage/MarkerFlight.tsx` | MarkerFlight | Keep/domain; consume shared primitives |
| `arena/stage/PromptPanel.tsx` | PromptPanel | Keep/domain; consume shared primitives |
| `arena/stage/QuietNotice.tsx` | QuietNotice | Keep/domain; consume shared primitives |
| `arena/stage/SpeedButton.tsx` | SpeedButton | Keep/domain; consume shared primitives |
| `arena/stage/StageCard.tsx` | StageCard | Keep/domain; consume shared primitives |
| `arena/stage/StageZones.tsx` | LEADER_W, UNIT_W, MenuSection, ReferenceCounts, BattleRow, Lane, PlayerStrip, cardIdOf, refusalActionType | Keep/domain; consume shared primitives |
| `arena/stage/Takeover.tsx` | Takeover | Keep/domain; consume shared primitives |
| `arena/stage/TurnPresence.tsx` | turnWords, TurnBanner, TurnPill, PhaseChips, MatchColumn | Keep/domain; consume shared primitives |
| `arena/stage/anchors.tsx` | ZoneAnchor, anchorPoint, cardPoint | Keep/domain; consume shared primitives |
| `arena/testing/TestingPortal.tsx` | TestingPortal | Keep/domain; consume shared primitives |
| `arena/tutorial/AnnouncerPortrait.tsx` | AnnouncerPortrait | Keep/domain; consume shared primitives |
| `arena/tutorial/Tutorial.tsx` | Tutorial | Keep/domain; consume shared primitives |
| `settings/AccessAdmin.tsx` | AccessAdmin | Keep/domain; consume shared primitives |
| `settings/AiForm.tsx` | AiForm | Keep/domain; consume shared primitives |
| `settings/AiSettingsBlock.tsx` | AiSettingsBlock | Keep/domain; consume shared primitives |
| `settings/ModelSelect.tsx` | ModelSelect | Keep/domain; consume shared primitives |
| `settings/TestConnection.tsx` | TestConnection | Keep/domain; consume shared primitives |

### Page routes (47)

This includes internal previews and administration pages; these are not all proposed public navigation entries.

| Route | Direct component dependencies |
|---|---|
| `/add/bulk` | BulkEntry |
| `/add` | Inline/server composition; use common presentation on migration |
| `/add/quick` | QuickCapture |
| `/add/scan` | ScanFlow, SubmitButton |
| `/arena/[id]/debug` | Inline/server composition; use common presentation on migration |
| `/arena/[id]` | arena/session/OnlineArenaStage, arena/decklist-model, arena/GameOver, arena/shared-display |
| `/arena/feedback` | arena/ArenaHeader |
| `/arena/local` | arena/session/LocalArena |
| `/arena/match/[id]` | CardImage, SubmitButton, arena/ArenaHeader, arena/InviteShare, arena/MatchWaiting |
| `/arena/offline` | arena/session/LocalArena |
| `/arena` | arena/ArenaHeader, arena/PlayPicker, arena/GamesList, arena/Invitations |
| `/arena/preview` | Inline/server composition; use common presentation on migration |
| `/arena/review` | arena/ReviewScreen |
| `/arena/rules/all` | Inline/server composition; use common presentation on migration |
| `/arena/rules/build/[id]` | arena/rules/FullRuleBuilder |
| `/arena/rules/build/preview` | arena/rules/RuleBuilder, arena/rules/RuleRecord |
| `/arena/rules/game` | Inline/server composition; use common presentation on migration |
| `/arena/rules/keywords` | Inline/server composition; use common presentation on migration |
| `/arena/rules/language` | Inline/server composition; use common presentation on migration |
| `/arena/rules` | arena/rules/ConfirmAll, arena/ArenaHeader, arena/rules/Groups, arena/rules/SelectLink, arena/rules/WorkbenchKeys, arena/rules/Workbench |
| `/arena/rules/patterns` | Inline/server composition; use common presentation on migration |
| `/arena/rules/review` | arena/rules/RuleReview |
| `/arena/rules/review/preview` | arena/rules/RuleExplanationPreview |
| `/arena/setup-preview` | LeaderLibrary, arena/session/local-board |
| `/arena/testing` | arena/ArenaHeader, arena/testing/TestingPortal |
| `/arena/testing/runs/[id]` | arena/ArenaHeader |
| `/arena/tutorial` | arena/tutorial/Tutorial |
| `/arena/tutorial/phone` | Inline/server composition; use common presentation on migration |
| `/cards/[id]` | LotOwnerPicker, LotLocationPicker, CardDecks, CardFaces, LotFinishToggle, LotPrintPicker, ColorPill, SkillText, MarketplacePanel, DeckPicker, SubmitButton |
| `/cards` | GameFilter, CardTile, CardList, ViewToggle |
| `/cart` | WantList, CartTools, SubmitButton |
| `/collection/archived` | ArchivedList |
| `/collection` | GameFilter, CardTile, CollectionList, CopiesPopover, ViewToggle, LiveSearch |
| `/decks/[id]` | GameFilter, DeckStatusBadge, CardFaces, CardImage, ColorPill, DeckDiscovery, DeckBuilder, DeckAI, SwapSuggestions, DeckLocationPicker, BuiltToggle, DeckCardControls, SubmitButton, arena/OfflineDeck |
| `/decks` | GameFilter, NewDeckWithClaude, NewDeckFromCard, SubmitButton, DeckDiscovery |
| `/join` | Inline/server composition; use common presentation on migration |
| `/leaders` | LeaderLibrary |
| `/login` | Inline/server composition; use common presentation on migration |
| `/me` | Inline/server composition; use common presentation on migration |
| `/meta/news` | GameFilter, CardImage |
| `/meta` | GameFilter, CardImage, ColorPill |
| `/` | CardImage |
| `/sets/[code]/review` | CardImage, SubmitButton |
| `/settings/access` | settings/AccessAdmin |
| `/settings/locations` | LocationsAdmin |
| `/settings` | SubmitButton, arena/TurnLighting, settings/AiSettingsBlock |
| `/settings/users` | UsersAdmin |

### Cross-cutting non-component modules

Keep `src/lib/navigation.ts`, `src/lib/arena/skin.ts`, `src/lib/catalog/games.ts`, money formatters, deck discovery filtering and domain readiness models as their respective single sources of truth. Component centralization must not duplicate them. Hooks and pure models beside arena components remain outside this TSX inventory and retain domain ownership.

## Latest upstream delta reviewed

The default branch was two commits ahead of the selected checkout. The comparison adds `arena/stage/use-card-endpoints.ts` as a shared **arena-only geometry hook**, updates basic Charge/Attack placement above artwork, limits search sheets to prompt candidates, separates expiring passive notices from required choices, and improves compact tutorial coaching and scroll handling. None of the TSX component or page files in the inventory were newly added or removed.

Preserve these changes in any later consolidation: passive feedback must not become a blocking dialog; required choices must not auto-dismiss; shared card inspectors must retain action-before-art hierarchy; tutorial guidance must follow current legal choices; shared geometry belongs inside the arena rather than a general UI kit. Source diff review is not a new runtime verification of those changes.
