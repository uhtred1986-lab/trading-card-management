# Pokémon screens: design

Status: **updated with the owner's decisions, 14 Nov 2026** (`plan.md` §9). Companion to `plan.md`. Wireframes are 390 px phone
frames; desktop notes follow each. Copy is shown in German, the one assumption still to confirm (`plan.md` §9, 2). The user is 12 with
her own phone: plain language, but no need for a simplified child mode.
Tokens, type and components come from `docs/design/design-system.md`; nothing here adds a colour or
a font except one accent for the game mark.

## 1. Principles

1. **Pictures first.** A child recognises a card by its art, so every choice is a tap on a picture,
   never a line of text to read.
2. **One thumb.** Every action sits in the lower half of the phone; targets use the `tap` class
   (44 px), the main buttons 56 px.
3. **Three verbs everywhere:** *Hab ich* (I own it), *Wunsch* (I want it), *Ins Deck* (put it in a
   deck). The same three icons in the grid, the viewer and the search results.
4. **Never a dead end.** Voice or photo that is unsure shows candidates to tap; search stays one tap
   away.
5. **Nothing of Dragon Ball leaks in** for a user whose home game is Pokémon: no arena tab, no
   leaders, no meta. Prices are shown (Q 3).

## 2. Navigation

Bottom tabs for a Pokémon home user (five, as today):

```
┌──────────────────────────────────────┐
│                                      │
│              (screen)                │
│                                      │
├──────────────────────────────────────┤
│  Sammlung   Entdecken   ＋   Decks  Wünsche │
│    ▣          🔍       (●)    ▤      ♥    │
└──────────────────────────────────────┘
```

- **＋** is the raised centre button: it opens the add sheet (§5), the action she uses most.
- An SL with both games keeps today's tabs; the `GameFilter` chips gain a "Pokémon" chip and
  "Wünsche" lives in the cart.
- From `sm` up: the same five entries in `HeaderNav`.

## 3. Entdecken: live search and looking through cards

```
┌──────────────────────────────────────┐
│ 🔍 Glurak                      🎤  ✕ │
│ [Alle] [Feuer] [Wasser] [Pflanze] ›  │  type chips, scroll sideways
│ [Pokémon] [Trainer] [Energie]  Set ▾ │
├──────────────────────────────────────┤
│ ┌──────────────┐  ┌──────────────┐   │
│ │              │  │              │   │
│ │   card art   │  │   card art   │   │  2 columns, 5:7 tiles
│ │              │  │              │   │
│ │ ✓2        ♥  │  │           ♡  │   │  ✓n = owned count, heart = wish
│ └──────────────┘  └──────────────┘   │
│ Glurak-ex · 151    Glurak · PL4      │  name · set, one line
│ ┌──────────────┐  ┌──────────────┐   │
│ │              │  │              │   │
│        … endless scroll …            │
└──────────────────────────────────────┘
```

- Results come from `/api/pokemon/search` (TCGdex, cached a day). Typing waits 300 ms; the mic fills
  the same field.
- Grey skeleton tiles while loading; "Keine Karte gefunden. Sag den Namen noch einmal oder tippe
  ihn." when empty; "Die Kartensuche ist gerade nicht erreichbar. Deine Sammlung funktioniert
  weiter." when TCGdex is down.
- With an empty field the screen shows the newest sets as large logo tiles; a tap lists that set.
- Owned count and heart are overlaid from the local database, so she sees at a glance what she has.
- Her cards are German and English mixed: one search finds a card under either name ("Glurak" or
  "Charizard"), and the detail line carries the Cardmarket price ("ab 3,99 €").
- Desktop: 4 to 6 columns, filters in a left rail.

### The swipe viewer

A tap on any tile, anywhere, opens the card full screen. This is the "looking through cards" mode.

```
┌──────────────────────────────────────┐
│ ✕                           3 / 48   │
│                                      │
│   ┌──────────────────────────────┐   │
│   │                              │   │
│   │                              │   │
│   │        card, full width      │   │  swipe ← → next / previous
│   │        (high.webp)           │   │  double tap: zoom
│   │                              │   │  swipe ↓ : close
│   │                              │   │
│   └──────────────────────────────┘   │
│   Glurak-ex · 151 · 006/165          │
│   Feuer · KP 330 · Rang 2      ⓘ     │  ⓘ pulls up the detail sheet
│                                      │
│  ┌──────────┐┌──────────┐┌─────────┐ │
│  │ ✓ Hab ich ││ ♥ Wunsch ││ ▤ Deck  │ │  56 px
│  └──────────┘└──────────┘└─────────┘ │
└──────────────────────────────────────┘
```

- Built on CSS scroll snapping, so it needs no library and keeps native momentum. The next two
  images preload.
- **Hab ich** opens a small sheet: variant chips (Normal / Holo / Reverse), language chips
  (DE / EN) and − 1 +. One more tap
  saves and the viewer stays on the card.
- **Wunsch** toggles at once with a short pulse; no sheet.
- **Deck** lists her decks as big rows plus "Neues Deck mit dieser Karte" (§6).
- The detail sheet (ⓘ or swipe up) shows attacks, weakness, retreat, evolves from / into (each a
  tappable picture), her copies, and "Eigenes Foto" (§7).
- Desktop: the card left, the detail sheet as a fixed right column, arrow keys to move.

## 4. Sammlung

```
┌──────────────────────────────────────┐
│ Meine Sammlung            312 Karten │
│ [Alle] [Im Deck] [Neu] [DE] [EN]     │
│ Sortieren: Neueste ▾        ▦  ☰     │
├──────────────────────────────────────┤
│ ┌──────────────┐  ┌──────────────┐   │
│ │   card art   │  │   card art   │   │
│ │ ×3      ▤1   │  │ ×1           │   │  ×n owned, ▤n in built decks
│ └──────────────┘  └──────────────┘   │
│               …                      │
└──────────────────────────────────────┘
```

- Reads the local database only, so it is fast and works when TCGdex is down.
- A value line in EUR sits under the count. There is no trade list (Q 5).
- Tile tap opens the same swipe viewer, scoped to the filtered collection.
- Empty state: "Noch keine Karten. Tippe auf ＋ und lies deine erste Karte vor." with the ＋ button
  repeated large.
- For an SL the existing `/collection` gains the Pokémon chip and a value line in EUR.

## 5. Hinzufügen: voice and photo

The ＋ sheet offers three large tiles; the first two are the point.

```
┌──────────────────────────────────────┐
│  Karten hinzufügen                   │
│  ┌────────────────────────────────┐  │
│  │  🎤  Vorlesen                  │  │
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │  📷  Foto machen               │  │
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │  🔍  Suchen                    │  │
│  └────────────────────────────────┘  │
│  Ins Deck legen:  [ keins ▾ ]        │  the existing DeckPicker
└──────────────────────────────────────┘
```

### Vorlesen

```
┌──────────────────────────────────────┐
│ ✕  Vorlesen                  12 neu  │
│                                      │
│            ( ● )   hört zu …         │  pulsing mic, 96 px
│        „Glurak ex“                   │  what was heard, large
│                                      │
│  Welche ist es?                      │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌─────   │
│  │ art  │ │ art  │ │ art  │ │ art    │  candidates, scroll sideways
│  └──────┘ └──────┘ └──────┘ └─────   │
│   151      PL4     Promo    …        │
│                                      │
│  ── after a tap ──                   │
│  [Normal] [Holo] [Reverse]           │
│        (−)     2     (+)             │
│  ┌────────────────────────────────┐  │
│  │  ✓ Speichern und weiter        │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

- A DE / EN switch beside the mic sets the listening language. She may say a name, or the number at the bottom of the card ("sechs von hundertfünfundsechzig"),
  or both. One exact match skips the candidate row.
- "Speichern und weiter" saves and reopens the mic; a running count sits top right, and "Fertig"
  shows the session's list with undo per line.
- If the browser has no speech recognition, the tile says so and offers Suchen.

### Foto machen

- One card: the quick-capture loop that exists today (photo, result, ±, save, camera reopens).
- A binder page: "Ganze Seite" takes one photo of up to nine cards and shows a 3×3 result grid; each
  cell is confirmed, corrected by tapping (opens candidates) or skipped. This is the existing scan
  batch with a Pokémon prompt, so a page started on the phone can be finished on the PC.
- An unsure read is marked amber with "Bitte prüfen", never saved silently.

## 6. Decks

```
┌──────────────────────────────────────┐
│ ‹  Feuerdrachen-Deck         47 / 60 │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░   noch 13 Karten│  progress, the main feedback
│ [Pokémon 18] [Trainer 17] [Energie 12]│
├──────────────────────────────────────┤
│ ┌────┐ Glurak-ex            ×2  − +  │
│ └────┘ ✓ hast du 2                   │
│ ┌────┐ Glutexo              ×3  − +  │
│ └────┘ ⚠ hast du 1 · 2 fehlen   ♥    │  ♥ adds the missing copies as wishes
│ ┌────┐ Glumanda             ×4  − +  │
│ └────┘ ✓ hast du 4                   │
│               …                      │
├──────────────────────────────────────┤
│ ( ＋ Karte )      ( ♥ Fehlende wünschen ) │
└──────────────────────────────────────┘
```

- Legality is real and shown as plain flags, never a block (Q 7): "Noch 13 Karten", "Höchstens 4
  mit dem Namen Glutexo", "Du brauchst ein Basis-Pokémon", "Nicht mehr im Standard-Format erlaubt".
  The deck header carries a format chip (Standard / Erweitert) and one badge: legal, unfertig or
  nicht legal.
- **Mit Claude**: "Deck analysieren" and "Deck mit Claude bauen" are the same components the Dragon
  Ball decks use, fed by the Pokémon adapter (`plan.md` §7). Claude's suggestions are card pictures
  with the three verbs, so a suggestion becomes a wish or a deck line in one tap.
- "＋ Karte" opens Entdecken with a "Meine Karten zuerst" toggle on.
- **Neues Deck mit dieser Karte**: pick a favourite, and the app drafts the evolution line, matching
  Energy and Trainers she owns, then opens the deck for editing. Cards she lacks are listed with a
  heart.
- "Deck ist gebaut" keeps today's meaning and the one refusal: she cannot mark a deck built that
  needs more copies than she owns; the message names the cards.
- Desktop: the existing `DeckBuilder` two-pane layout with the Pokémon groups.

## 7. Eigenes Foto

In the detail sheet of a card she owns:

```
│  Eigenes Foto                        │
│  ┌────────┐   ( 📷 Foto aufnehmen )  │
│  │ thumb  │   ( ↺ Original zeigen )  │
│  └────────┘                          │
```

- The camera opens with a 5:7 frame overlay; the picture is cropped to the frame and shrunk in the
  browser before upload (about 100 KB).
- Her photo then replaces the catalog picture everywhere that card appears for her (and for SLs,
  Q 4). A small camera badge marks tiles that show an own photo.

## 8. Wünsche, and the owner's side

Her tab: a grid of hearted cards with a short reason line where one exists ("fehlt im
Feuerdrachen-Deck"), the price per card and a total (Q 3).

The owner, as SL, in `/cart`:

```
┌──────────────────────────────────────┐
│ Warenkorb                            │
│ Quelle: [Meine] [Wünsche von Mia ▾] [Deck ▾] │
│ Sprache: [DE] [EN]   Zustand: NM ▾   │
├──────────────────────────────────────┤
│ Glutexo ×2            ab 0,35 €      │
│ Glurak-ex ×1          ab 4,10 €      │
│ …                                    │
├──────────────────────────────────────┤
│ Beste Aufteilung: 2 Verkäufer 11,80 €│  the existing optimiser
│ ( In CardTrader öffnen )             │
└──────────────────────────────────────┘
```

- The name is a placeholder for the player's owner name.
- Bought cards arrive in her collection when the owner (or she) adds them; "Als gekauft markieren"
  can move a wish to a lot stamped with her name.

## 9. States every screen handles

| State | Behaviour |
|---|---|
| Loading | Skeleton tiles in the final layout, no spinner-only screens |
| Empty | One sentence and the one button that fixes it |
| TCGdex down | Search and deck picker say so; collection, decks and wishes still work |
| No signal | Collection shows what the browser has; add actions say "Kein Internet" and keep the entry in the form |
| Unsure voice or photo | Candidates or an amber "Bitte prüfen", never a silent save |
| Not hers | A deck or lot id of another player answers `not_found`, as today |

## 10. Accessibility and feel

- Contrast and focus as in `docs/design/contrast-fixes.md`; every icon button has a text label
  (visible under the icon in the tab bar, `aria-label` elsewhere).
- Images carry the card name as alt text.
- Motion: one 150 ms pulse on save and on wish; nothing loops; all of it off under
  `prefers-reduced-motion`.
- Text for a 12-year-old: short sentences, "du", no jargon ("Wunsch", not "Want-Liste").

## 11. Still open

Only the screen language (German assumed). A clickable phone prototype of §3 and §5 can be made
before any worker starts, if the owner wants to see it first.
