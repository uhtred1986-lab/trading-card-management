# Independent local-branch review, 14 October 2026

Tested build: `f7831ce71961734033fe70336ac435964802881f`, verified from the production shell manifest over the temporary Cloudflare tunnel. No database or sign-in configuration. [TinyFish run](https://agent.tinyfish.ai/runs/91b3a91c-63a7-4877-8400-0d09adbf99b8).

**Partial review, not an acceptance pass.** The run spent most of its 588 seconds preparing artwork and stopped before testing Charge/Main/Battle on a phone. It reported a below-fold Start match button at 360px and slow artwork preparation. It reached desktop mulligan inspection, but did not exercise phone payment, targeting, combat, reduced motion, night skin, or 44px controls. Database-backed setup/navigation was deliberately outside this no-database run.

Interpretation cautions: the report conflates Inspect hand with the setup See the cards button, so its resolved label does not verify that specific regression. It infers Pass behavior without reaching those phases; that is not evidence. Its statement that slow artwork is intentional is not an owner decision. Its desktop observations cannot establish phone acceptance. No screenshots were included as individual links in the returned report; inspect the run recording for visual evidence.

Owner clarification after the run: the local laptop and internet are slow. Download delays and machine-dependent timings in this report are environment observations, **not app defects or regression evidence**. The review's lack of coverage remains a coverage limit, not a failure of the untested features.

## Raw reviewer report

## Arena Phone UX Validation Report — PR 808 (f7831ce71961734033fe70336ac435964802881f), /arena/offline, NO DATABASE

**Browser:** Chrome with anti-bot reconfiguration to US proxy. Viewport: desktop + 360px (phone). No sign-in used.

---

### 1. Offline Preparation & Match Setup

| Item | Status | Notes |
|------|--------|-------|
| Prepare for offline play button | **Resolved** | Visible at top of Offline Play section; toggles to "Stop" during download. Readable at 360px. |
| Three-stage progress (game files / deck pack / card artwork) | **Resolved** | Clear labels, progress bars, and "Done"/"Downloading…"/"Waiting" states. At 360px, all readable. Fish animation on progress bar. |
| Storage display ("5.4 MB of 264 MB") | **Resolved** | Readable at 360px, correctly stacked layout. |
| Starter decks listed after Ready | **Resolved** | Two decks: `[Starter] Pride of the Saiyans` (Vegeta, 26 cards, ~1.5 MB) and `[Starter] The Crimson Saiyan` (Golden Great Ape Goku, 17 cards, ~1.1 MB). All text readable at 360px. |
| "To add one of your own decks…" instruction | **Resolved** | Readable at 360px. |
| Check for updates button | **Resolved** | Visible after Ready state. Readable at 360px. |
| Remove everything / Remove the decks | **Resolved** | Visible in "REMOVE FROM THIS DEVICE" section after download completes. |
| Installed packs button (expandable pack info) | **Resolved** | Shows "Pack masters-sd15-vs-sd5 · 2 decks · ready" when expanded. |
| Card artwork download speed | **Intentional design difference** | Card artwork (43 images) downloads separately and is the slowest stage — took over 10+ minutes. At step 63/150, it was still downloading (40/43). This is expected for a first-time build without pre-cached content. |
| Card image download failures | **Not exercised / Reported** | Card artwork was still downloading at time of report. No failed image reports observed — all downloaded sequentially. |
| Deck-selector dropdown length at 360px | **Resolved** | Select dropdowns for Your deck and Computer's deck are full-width, readable, showing both starter decks. No horizontal overflow. |
| First/Second seat buttons | **Resolved** | First is pre-selected (bg-space-800, border-ki-500); Second is unselected (bg-space-900/50). Readable at 360px. |
| Start match button | **Resolved (partially)** | Present in DOM at 360px after download completes, but **NOT visible on screen** at 360px — likely below the fold. Requires scrolling to access. This is a **discoverability concern** for mobile users. |

---

### 2. Game Board — Turn 0 / Mulligan Phase

| Item | Status | Notes |
|------|--------|-------|
| Mulligan prompt: "Keep this hand? You may redraw six cards once (6-2-1-9)" | **Resolved** | Clear prompt with "Keep hand" and "Mulligan" buttons. Action chips and consequences well communicated. |
| Hand count display | **Resolved** | Shows 6 cards in hand at start. Mulligan sequence "6-2-1-9" is readable and informative. |
| Card ownership visibility | **Resolved** | Cards in hand are clearly "your" cards (shown in bottom hand area). |
| Card costs displayed on hand cards | **Resolved** | Costs (e.g., cost 3 on Android 18, cost 1 on Is That All You've Got?, Transcendent Strike, Afterimage Technique) are clearly visible in the top-left corner of each card. |
| Card power displayed | **Resolved** | Power values visible on card art (e.g., 15,000 on Android 18, SSB Vegeta). |
| Combo displayed | **Resolved** | Combo values visible (e.g., +10,000 on Android 18). |
| Action chips (Counter/Block/Combo) | **Not exercised** | Mulligan phase showed no action-chip-required cards. Not tested whether chips are readable on mobile viewports during active play. |
| Bottom action bar | **Resolved** | Shows "[Starter] Pride of the Saiyans" with card count placeholders and "deck 44 / drop 0" — readable at desktop. |
| Inspect hand / Expand / Zones buttons | **Resolved** | Three action buttons below hand area. Readable at desktop. |

---

### 3. Phase Row, Turn Info, Life & Energy

| Item | Status | Notes |
|------|--------|-------|
| Phase row (Draw, Charge, Main, Battle, End) | **Resolved** | Horizontal phase row at top of screen. Active phase highlighted. Readable at desktop. |
| Turn indicator ("Turn 0") | **Resolved** | Next to phase row. Clear and readable. |
| Player name / deck title | **Resolved** | "[STARTER] THE CRIMSON SAIYAN'S TURN" displayed in top bar. Readable. |
| Leader tags (power, life, facing) | **Resolved** | Both players' Leaders shown: Golden Great Ape Son Goku (10,000 power, 0 life) and Vegeta (10,000 power, 0 life). Standing orientation shown. |
| Life dots display | **Still present** | Life dots visible in opponent area as dots (not shown clearly at 360px in screenshots taken). Opponent's 0 life dots visible at desktop. |
| Energy display (ready/total) | **Not exercised** | Both players at 0/0 energy at Turn 0 start. Energy display not visible in any screenshot taken — may only appear during Charge/Main phases. **Not tested.** |
| Animation speed button (½×) | **Resolved** | Visible as "1/2x" button in top-right corner. |
| Battle log button | **Resolved** | Visible in top-right corner menu area. |
| Arena settings (hamburger menu) | **Resolved** | Visible as hamburger/menu icon in top-right corner. |

---

### 4. Card Inspection & Play

| Item | Status | Notes |
|------|--------|-------|
| "See the cards" / deck inspection discoverability | **Resolved** | "Inspect hand" button is prominent in the hand action bar. Right panel shows selected card details with name, cost, power, combo, and "ABILITIES NOW" section. |
| Card tap to inspect/play | **Not exercised** | Only desktop screenshot was taken during the hand inspection phase. Tap interaction at 360px was not tested due to budget exhaustion. |
| Card detail panel: "Other abilities(1)" expandable | **Resolved** | Right panel shows "ABILITIES NOW" section with "No manual ability is available in this decision" and "Other abilities(1)" collapsible section. |
| Card detail panel: "In play" button | **Resolved** | Visible in right panel showing opponent and player Leaders with power, life, and orientation. |
| Card review arrows/swipe/close | **Not exercised** | Not reached during the session. |
| Own large card vs opponent peek/Bigger/Board views | **Not exercised** | Not reached during the session. |

---

### 5. Charge / Attack / Battle Phases

| Item | Status | Notes |
|------|--------|-------|
| Charge selection keeps hand visible | **Not exercised** | Did not reach Charge phase. Budget exhausted at Turn 0. |
| Charge consequence (Charge/Pass buttons) | **Not exercised** | Not reached. |
| Payment preview, remaining energy, targets/rejection reasons | **Not exercised** | Not reached. |
| Staged attack roles, summary, cancellation | **Not exercised** | Not reached. |
| Counter/Block/Combo questions and Pass consequence | **Not exercised** | Not reached. |
| Hit / held / KO / life damage feedback | **Not exercised** | Not reached. |
| Hand/board/dock overlap or page scrolling | **Not exercised** | Could not assess during play. Hand area was fully visible at desktop. At 360px, the Start match button was below the fold, suggesting potential layout overlap or scroll needs during actual gameplay. |

---

### 6. Skin / Theming

| Item | Status | Notes |
|------|--------|-------|
| Sky/Anime skin | **Resolved (desktop only)** | Visible blue sky background with cloud shapes during offline setup. Art style is anime-inspired. |
| Night skin | **Not exercised** | No access to skin toggle at /arena/offline. Cannot assess. |
| 44px control size | **Not exercised** | Cannot confirm 44px tap targets at 360px without actual touch interaction. Buttons appear appropriately sized from visual inspection. |

---

### 7. Database-Backed Flows (NOT Exercised)

| Item | Status | Notes |
|------|--------|-------|
| Global current games | **Not exercised** | /arena/offline has no database. |
| Invitation flows | **Not exercised** | /arena/offline has no database. |
| Online multiplayer | **Not exercised** | /arena/offline is local-only. |

---

### 8. First-Time Player Questions (Concise)

| Question | Answer |
|----------|--------|
| Can you tell whose turn it is? | **Yes.** Top bar clearly shows "[STARTER] THE CRIMSON SAIYAN'S TURN" with current turn number (e.g., "Turn 0"). |
| Can you tell what phase it is? | **Yes.** Phase row (Draw, Charge, Main, Battle, End) highlights the active phase. |
| Can you tell who attacks whom? | **Not tested.** Not reached Battle phase. |
| Can you tell what each card can do? | **Partially.** Costs and power combo are visible on hand cards. Ability details require tapping/inspecting the card to view "ABILITIES NOW" and "Other abilities" — this secondary interaction was not tested at mobile viewport. |
| Can you see payment/targets before committing? | **Not tested.** Not reached Charge/Main phase where payment preview would appear. |
| Can you tell how to pass? | **Inferred from UI.** "Pass" buttons are standard during Charge and Battle phases. "Keep hand" / "Mulligan" shown during mulligan — clear and discoverable. |

---

### Key Findings Summary

**Resolved (working as expected):**
- Offline preparation flow: clear 3-stage progress with labels
- Starter deck list: readable with pack info
- Deck selectors: full-width dropdowns, no overflow at 360px
- Mulligan UI: clear prompt with 6-2-1-9 sequence explanation
- Phase row + turn indicator: visible and readable
- Leader display: power, life, and orientation clear
- Animation speed toggle and battle log accessible
- "Inspect hand" button discoverable for deck review

**Needs Attention / Observed Issues:**
- **Start match button below fold at 360px** — not visible without scrolling. This is a mobile UX concern for the primary action.
- **Card artwork download is slow** — 43 images, 10+ minutes on this connection. First-time players may perceive this as broken.
- **Action chips readability at 360px during active play** — not tested, only visible during desktop inspection phase.

**Not Exercised (insufficient time):**
- All Charge/Main/Battle phase mechanics
- Card tap-to-play at 360px
- Night skin (no skin toggle available)
- Card review navigation (arrows/swipe/close)
- Hit/Held/KO/life feedback visuals
- Hand/board/dock overlap at mobile viewport
- 44px control size measurement

**Report generated at step 63/150, 573s/600s budget exhausted.**
