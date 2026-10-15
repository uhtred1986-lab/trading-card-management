# Arena and landing migration

This workstream applies the five-world presentation contract to the real-data landing and the
Arena entry, setup, history, and support surfaces. It preserves the existing server reads, guards,
forms, readiness decisions, and game board layouts.

## Routes

| Route | Status | Behavior and visual changes |
|---|---|---|
| `/` | Migrated | The live collection dashboard now has a themed heading and direct Collection and Arena actions. The empty state links to card entry and catalog. Existing valuation, spend, gain/loss, copy counts, movers, and by-game/set/rarity breakdowns remain backed by their original queries. |
| `/meta` | Migrated | Added shared heading, filter summary, and empty state; retained the live leaderboard, game filter, placement rows, and decklist purchase links. |
| `/meta/news` | Migrated | Added shared heading, filter summary, empty state, and panels; retained catalog-backed cards grouped by set and official news links. |
| `/arena` | Migrated | Added themed entry heading and real Play, Games, Learn, and On this device links. Games remains the existing query-backed history view; current matches, invitations, testing-deck toggle, deck readiness, opponent choices, and cost confirmation are preserved. |
| `/arena/match/[id]` | Migrated | The host waiting view and guest invitation/deck-selection view use the shared heading and panel surfaces. Join and cancel actions, visibility, and deck readiness checks are unchanged. |
| `/arena/feedback` | Migrated | Added themed page heading while retaining the existing admin guard, status filters, feedback rows, and synchronization actions. |
| `/arena/setup-preview` | Migrated | Fixture-only setup previews now have a themed heading. The development-only guard and no-write behavior remain unchanged. |
| `/arena/tutorial/phone` | Migrated | The phone tutorial preview uses the shared heading and panel; iframe dimensions and tutorial route remain unchanged. |
| `/arena/[id]` | Preserved | Live gameplay remains full-bleed. No stage, engine, game action, or gameplay presentation files were changed. |
| `/arena/local` | Preserved | Continues to render the device-local arena. The page stays full-bleed; theme parsing and its `LocalArena` component are coordinator-owned. |
| `/arena/offline` | Preserved | The static offline shell continues rendering the device-local arena full-bleed. No viewer, cookie, or database behavior changed. |
| `/arena/tutorial` | Preserved | The guided practice experience remains immersive and retains its existing cookie-backed board settings. |
| `/arena/preview` | Preserved | Fixture gameplay remains full-bleed and development/admin gated. |
| `/arena/rules` and descendants | Excluded | Rules workbench, rule review, redirects, and their previews belong to the admin workstream. |
| `/arena/review` | Excluded | Admin match review belongs to the admin workstream. |
| `/arena/testing` and descendants | Excluded | Testing portal and run details belong to the admin workstream. |
| `/arena/[id]/debug` | Excluded | Engine diagnostics belong to the admin workstream. |

## Components

- `MatchSetup` adopts themed panel surfaces for the deck, opponent, and review steps. It retains the
  phone modal, desktop form, step validation, focus handling, and only-submit-on-review behavior.
- `PlayPicker`, `GamesList`, `ContinueStrip`, `Invitations`, `MatchWaiting`, `LocalMatchSetup`,
  `OfflinePreparation`, `Tutorial`, `LocalArena`, and preview stage components keep their existing
  behavior and data contracts. Their consumers receive the new page shells where appropriate.
- `ArenaHeader` remains unchanged; its existing Play, Rules, Testing, Games, and options links stay
  available alongside the new Arena section destinations.
- `SkinToggle`, `BoardSettingsSheet`, and `session/LocalArena.tsx` are deliberately excluded for the
  coordinator's theme parsing and board settings work. Gameplay mechanics, actions, database reads,
  schema, and engine code were not modified.

## Remaining presentation gaps

The immersive tutorial, offline shell, local board, fixture board, and live board keep their bespoke
full-bleed layouts. Their routes expose no shared page wrapper because adding one would change the
gameplay viewport. A full visual review across all five theme palettes remains part of the
coordinator's integrated review.
