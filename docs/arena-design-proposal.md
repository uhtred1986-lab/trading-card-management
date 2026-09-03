# Arena — play against Claude

**Status: design settled, build starting (3 Sep 2026).** The four open questions were answered by the
owner and are recorded in §12. This document is the brief for Claude Design (§11 is paste-ready) and
the plan phase 1 is built from. Mockups live in the Claude Design project "DBS Arena — play against
Claude".

Sources read for this, so the rules below are the official ones rather than memory:

- Official *Rule Manual* v4.00 (all 23 sections) — `docs/rules/rulemanual.txt`
- Official playsheet SD14 — `docs/rules/playsheet-sd14.pdf` (the board layout in §2 is traced from it)
- Keyword skills page and the beginner play manual

---

## 1. What we are building

A screen where you play a full game of the Dragon Ball Super Card Game against Claude:

- two decks from your collection face each other, you control one, Claude the other;
- the board is laid out like the official playsheet, cards animate as they are drawn, charged,
  played, rested, attacked with, comboed, countered, KO'd and awakened;
- **the rules are enforced by a deterministic engine, not by Claude.** Claude only ever chooses
  between moves the engine has already established are legal. That is what makes it both correct
  and cheap: Claude never spends tokens working out *what it may do*, only *what it wants to do*.
- **phone first.** The board is designed for a portrait phone held in one hand; the desktop layout
  is the second layout, not the other way round (§2, §12).

Not in scope for the first version: online play against other people, tournament formats, draft.

---

## 2. The board

### 2.1 Phone (primary) — portrait, 390 × 844 reference

The playsheet folded in half: Claude's side compressed at the top, yours full-size below, the two
Combo Areas meeting in a middle band that doubles as the power HUD during a battle. Your hand is a
bottom sheet that peeks above the safe area and drags up.

```
┌──────────────────────────────────────────┐
│ Charge · Main · End │ Attack · Offense …  │  ← phase strip, current step lit
├──────────────────────────────────────────┤
│ ● Claude · life 6 · hand 5 · deck 41     │  ← opponent strip (tap = expand its side)
│ [LDR] [UNI]  [b][b][b]     drop 9        │  ← its leader, unison, battle cards (small)
│  energy ▾▾▾▴▴  active 2 · rest 3          │
├──────────────────────────────────────────┤
│           25 000 ▲   vs   20 000          │  ← middle band: both combo areas + power HUD
│        [combo][combo]   ·   [combo]       │     (collapses to a thin line outside battle)
├──────────────────────────────────────────┤
│ [LEADER]  [UNISON]   [B] [B] [B] [B]  →  │  ← your leader, unison, battle area (scrolls)
│ life 8 ▮▮▮▮▮▮▮▮   deck 42 · Z 6 · drop 13 │
│ energy  [R][R][B][B̲][B̲]   active 3 rest 2│  ← upside-down, rest = rotated
├──────────────────────────────────────────┤
│  Combo? pick a glowing card, or pass      │  ← prompt bar: the one question being asked
├──────────────────────────────────────────┤
│ ╭──── H A N D (6) ────────────────────╮   │  ← bottom sheet, fanned; drag up for full view
│ │ [c] [c] [c] [c] [c] [c]             │   │
╰──────────────────────────────────────────╯
```

Interaction rules that replace hover:

- **Tap to select, tap the target to confirm.** Attack = tap your attacker (it lifts), then tap
  the opposing leader / battle card / unison. Legal targets glow; everything else dims.
- **Long-press any card = inspector** (full text + the engine's reading of it, §6). A second tap
  anywhere closes it.
- **The prompt bar is the only place a question is asked.** One line, at most two buttons
  (pass / confirm). Never a modal on the board.
- **Big targets.** Cards in the battle area are ≥ 48 px wide; hand cards ≥ 64 px; the prompt-bar
  buttons are 44 px tall (`tap` class, as everywhere in the app).
- The opponent strip expands with a tap to show its full side at the same scale as yours, for
  reading its board mid-turn.

### 2.2 Desktop (secondary) — landscape, 1440 × 900 reference

Both sides at full size, mirrored across the middle band, hand fanned along the bottom, event
log down the right edge, inspector on hover. Same components, different arrangement.

Traced from the official playsheet, one side as you see it:

```
 ┌────────┐ ┌────────┐ ┌──────────────────────────────────────────────┐ ┌──────┐
 │ LEADER │ │ UNISON │ │                BATTLE AREA                   │ │ DECK │
 │        │ │        │ │   [card] [card] [card] [card] [card] …        │ │ 42   │
 └────────┘ └────────┘ └──────────────────────────────────────────────┘ ├──────┤
 ┌──┐                                                                   │ Z    │
 │L │ ┌────────────────────────────────────────────────────────────────┐│ DECK │
 │I │ │                    COMBO AREA  (only during a battle)          │├──────┤
 │F │ │        [combo] [combo]        power  25 000 ▲ vs 20 000        ││ DROP │
 │E │ └────────────────────────────────────────────────────────────────┘│ 13   │
 │  │ ┌────────────────────────────────────────────────────────────────┐├──────┤
 │8 │ │                    ENERGY AREA   (cards face-up, upside-down)  ││ WARP │
 └──┘ │   [R] [R] [B] [B̲] [B̲]      active 3 · rest 2                   ││      │
      └────────────────────────────────────────────────────────────────┘└──────┘
                          ╭──────────────────────────────╮
                          │  H A N D  (fanned, 6 cards)  │
                          ╰──────────────────────────────╯
```

### 2.3 Rules of the layout (both), all from the manual

| Area | Cards | Visible to | Notes |
|---|---|---|---|
| Leader | 1 | both | front/back (awaken flips it). Rest Mode = rotated 90° |
| Unison | ≤ 1 | both | with marker chips |
| Battle | any | both | Active/Rest; stacked cards (Evolve/Union) show as a stack |
| Combo | any | both | exists only during a battle; empties into Drop at battle end |
| Energy | any | both | placed **face-up and upside-down** (the real game does this); Rest = rotated |
| Life | starts at 8 | **hidden** — count only | face-down stack; damage takes cards into *hand* (Drop if Critical) |
| Deck | 50–60 | count only | |
| Drop | any | both | top card visible, expandable |
| Warp | any | both | removed-but-visible pile; only shown when non-empty |
| Z-Deck / Z-Energy | ≤ 10 / any | own / both | only shown when the deck has Z-cards |
| Hand | any | own | Claude's is a face-down fan; its *count* is public |

Two things the physical game does that we keep because they make the board readable at a glance:
**Rest Mode is a 90° rotation**, and **energy sits upside-down** so it is never mistaken for a
Battle Card.

---

## 3. Flow

1. **Setup** — pick your deck (any legal deck: built or virtual), pick Claude's deck (one of
   yours, or "let Claude draft one against mine" using the existing deck builder), difficulty
   (§7), then a coin flip; the winner chooses who goes first (6-2-1-4). Both sides may mulligan
   once (6-2-1-9). Life 8, second player gets an energy marker (6-2-1-11).
2. **Arena** — the board. An **event log** (a sheet on the phone, a rail on desktop: every event,
   one line, scroll-back), the **card inspector** (long-press / hover: full text, and — important —
   the engine's own reading of its effects, see §6), and a **phase strip** showing Charge → Main →
   End and, during a battle, Attack → Offense → Defense → Damage.
3. **Prompts** — whenever the engine needs a decision from you it asks in place: legal cards
   glow, illegal ones are dimmed, and the prompt bar says what is being asked ("Combo? pick a card
   or pass"). When Claude is deciding, its leader pulses and the bar says so.
4. **End** — winner, turns, damage dealt, and the cost of the game in tokens/€ (everything goes
   through `ai_runs` like the rest of the app).

---

## 4. Animation and effects

Library: **Framer Motion** (`motion/react`) — a card is one element whose `layoutId` follows it
between zones, so moving a card is "change its parent, the library animates the flight". 3D flips
are CSS `rotateY` on a preserve-3d wrapper. Particles and impact flashes are a small canvas layer
on top of the board. Everything respects `prefers-reduced-motion` (crossfades instead of flights).
On the phone, motion is shorter (150–250 ms) and never blocks the next tap.

Storyboard — one line each, so Claude Design can draw the key frames:

| Moment | Motion |
|---|---|
| Draw | card lifts off the deck, arcs into the hand, the fan re-spaces |
| Charge energy | card leaves the hand, **rotates 180°** on the way, settles upside-down in Energy |
| Play a Battle Card | lift (scale 1.05, deeper shadow) → glide → land with a 4 px bounce and a brief edge glow |
| Rest / Active | 90° rotation, 200 ms, ease-out |
| Attack declared | attacker lunges 30 % of the way toward the target and snaps back; a targeting line draws from attacker to guard |
| Combo | card slides into the Combo Area; the **power HUD** in the middle band counts up (25 000 → 30 000) |
| Counter | card springs up out of the hand with a flash and a "COUNTER" stamp, then drops to Drop |
| Blocker | the blocker slides across in front of the original target, rotates to Rest |
| Damage | hit flash on the leader; a life card flips face-up and flies to the hand (to Drop with a red tint if Critical). Haptic tick on the phone, micro-shake on desktop |
| KO | card shudders, desaturates, slides to Drop |
| Awaken / Wish | leader does a full 3D flip with a ki burst; the back face is now the card |
| Unison markers | chips pop in / fall off |
| Claude plays a card | the face-down card flips face-up as it leaves its hand |
| Claude thinking | leader pulses softly; bar shows a short line. **Never streams reasoning** (tokens) |
| Turn change | the phase strip sweeps; a subtle light change on whichever side is active |

Sound is optional and cheap: the app already synthesises tones for voice entry (`src/lib/scan/cue.ts`);
the same approach gives draw/play/impact/KO cues with no audio assets.

---

## 5. The rules engine

`src/lib/arena/engine/` — pure TypeScript, no React, no database. A game is a **state** plus an
**append-only event log**; the state is the fold of the log, so a game can be resumed, replayed,
and stepped back when we find a bug. Random draws use a seeded RNG, so a game is reproducible.

**Scope is the whole manual from phase 1** (owner's decision, §12): Unison cards with markers and
growth, the Z-Deck, Z-Energy, Z-Awaken, Z-Stack, tokens, Hidden Mode. The engine models the manual
at the *structural* level rather than trying to be clever:

- **Turn structure** exactly as §7 of the manual: Charge (effects expire → pending → checkpoint →
  active all → checkpoint → draw (not on the first player's first turn) → checkpoint → charge 1 →
  checkpoint) → Main (free timing loop: play / activate / grow Unison / play Z-card / attack /
  end) → Main End → End Phase.
- **Checkpoints and counter timing** (§4): a pending queue for [Auto] skills, resolved at
  checkpoints, turn player first (4-2-2); counter windows on play, attack, skill activation and
  resolution, Unison growth and Z-Extra placement (4-3-2), with the counter-motion chain of 9-7.
- **Battle** exactly §8: attack declaration → [Blocker] pending → counter timing → checkpoint →
  Offense Step (turn player combos / battle skills) → Defense Step (non-turn player; skipped when the
  guard is a Unison) → Damage Step (add combo power, compare, damage / KO / marker removal) →
  Battle End (up to one combo card each into Z-Energy, combo cards to Drop, "for the battle"
  effects end).
- **Costs** §5: total cost + **specified cost** (colour), skill costs, combo costs, Z-Energy
  costs, energy markers, marker skill costs [X].
- **Keyword skills** hard-coded from §22: Awaken, Field, Blocker, Evolve/EX-Evolve/Xeno-Evolve,
  Critical, Double/Triple/Quadruple Strike, Dual/Triple Attack, Revenge, Counter (Play/Attack/Battle
  Card Attack/Counter), Once per turn, Indestructible, Union-Fusion/Potara/Absorb, Ultimate,
  Over Realm / Dark Over Realm / Wormhole, Barrier, Super Combo, Victory Strike, Warrior of
  Universe 7, Deflect, Bond, Swap, Wish, Sparking, Burst, Dragon Ball, Arrival, Aegis,
  Energy-Exhaust, Alliance, Offering, Revive, Heroic, Villainous, Invoker, Successor, Unique,
  Servant, Overlord, Rejuvenate, Spirit Boost, Limit, Empower, Z-Awaken, Z-Stack.
- **Rule processing** §21: loss judgment (no life / no deck), damage processing, invalid combo,
  power ≤ 0 → Drop, Unison marker removal and zero-marker Drop, Unique / Z-Extra / Unison count
  violations, Z-cards and tokens leaving play are removed, Leader flips carry power effects.
- **Legal-move generation.** For any state and player, the engine lists every legal action with
  its cost. This one function drives *both* the UI (what glows) and Claude (what it may pick from).

Tests in the existing `npm test` style (`scripts/verify-arena.ts`): scripted games, plus invariants
that every card is always in exactly one area, life never exceeds what was dealt, every checkpoint
terminates, and a replay of the event log reproduces the state.

---

## 6. Card effects — the hard part, and where the tokens go

There are 6,500 cards and their skills are free text. Nobody hand-codes that. Three layers, plus a
referee:

1. **Keywords** — hard-coded (above). The catalog's keyword list plus the leading-tag parser
   already in `src/lib/decks/cardRules.ts` tells us which a card carries.
2. **Compiled effects.** A small effect language (JSON) with a vocabulary of roughly forty
   primitives — *draw N*, *choose N cards matching a filter in an area*, *KO*, *±power for the
   battle / turn*, *play from hand/Drop/deck*, *switch mode*, *negate skills*, *deal damage*,
   *add to energy*, *look at top N*, conditions (*your leader is red*, *Bond 2*, *Sparking 5*),
   triggers (*when played*, *when attacking*, *when KO'd*, *at end of turn*) and costs.
   **Claude compiles a card's text into this language once**, and the result is stored in a
   `card_scripts` table (card id, text version, script, model, confidence, or an
   *unsupported* reason). Only the unique cards of the two decks in play need compiling —
   typically 20–30 per deck — and the result is reused for every future game until the card's
   text changes (errata). Estimated ~2,000 tokens per card ⇒ about **€0.02 per card, once**.
3. **Inspector honesty.** The card inspector shows the *engine's reading* of every card in plain
   words, rendered from the script ("When played: draw 1. Blocker."). If the compilation is
   wrong you see it before it matters, and can flag the card for re-compilation.
4. **The referee (owner's decision, §12).** When a card's text can't be expressed in the language,
   the game still starts and the card is played *with its skill*: whenever that skill would
   trigger, activate or apply, the engine hands Claude the card text, the relevant slice of state
   and a menu of primitive actions it may apply, and Claude adjudicates that one resolution. The
   referee is a separate, cached system prompt (the rules primer + the effect vocabulary), costs
   roughly 1–3k tokens per use, and is logged like every other call so a wrong ruling can be found
   afterwards. The inspector marks such cards "adjudicated by Claude at runtime", and the setup
   screen's coverage line shows how many the two decks contain, so you know before the game how
   much it will cost and where the risk sits.

---

## 7. Claude as the opponent — the token budget

Principles, in order: **the engine decides what is legal; Claude decides what is wise; nothing
is sent twice; trivial choices never reach Claude.**

- **System prompt, cached** (`cache_control`, paid at 10 % after the first call): a compact
  rules primer (~1.5k tokens) and both decklists with one-line card summaries (~5k). Claude sees
  its own list and yours — decklists are public knowledge between rivals; hands and life are not.
- **Per decision:** a ~300–600 token state snapshot (life counts, energy by colour and mode,
  both battle areas with power/mode, hand sizes, drop/warp counts, *its* hand) plus a numbered
  menu of legal actions from the engine. Output is structured: an index and at most one short
  line of table talk. **≤ 40 output tokens.**
- **Plan, don't poll.** For the Main Phase, Claude returns an *ordered plan* ("charge #3, play
  #7, attack leader with #2 then #5, end"). The engine executes it step by step while every step
  is still legal, and asks again only when reality diverged (an effect changed something).
  That turns ~6 Main-Phase calls into 1–2.
- **Heuristics for the trivial:** one legal option → take it; no legal combos → pass; charge
  phase → a rule (charge the least useful card by a fixed ranking) unless the hand is small.
- **Fair view:** the engine builds Claude's view; it physically cannot see your hand or life.
- **Two tiers (owner's decision, §12):** *Sparring* runs everything on Haiku 4.5; *Tournament*
  uses Opus 5 for the Main Phase plan and counter windows, Haiku for combos/blockers/targets.

Rough cost per game (15 turns each side, Tournament): ~15 Opus plans at ~7k cached-in /
~120 out + ~60 Haiku menus at ~2k / ~30 out ⇒ **roughly €0.20–0.40 per game**; Sparring around
€0.05. Referee calls (§6.4) come on top, per adjudicated card use. Every call is recorded in
`ai_runs`, so the end screen shows the real number.

---

## 8. Data

- `arena_games` — id, your deck, Claude's deck, seed, difficulty, status, winner, turn.
- `arena_events` — append-only (game, seq, actor, event JSON); snapshots every 50 events.
- `card_scripts` — card id, text hash, script JSON, model, confidence, unsupported reason.
- `arena_decisions` — per Claude call: game, seq, kind (move / plan / referee), menu shown,
  choice, tokens, cost (joins `ai_runs`) — so a bad decision or ruling can be inspected afterwards.

Server-authoritative: the state lives in the database, actions go through server actions, and
the browser only renders. A reload — or switching from the phone to the PC — lands you back in
the same game.

---

## 9. Gaps and risks — read this section

1. **Specified (colour) cost is missing from the catalog.** The source only has the total
   ("4"), not the coloured orbs, and paying costs needs them. Options: (a) a convention
   default — one orb of the card's colour, one per colour for multicolour — which is right for
   the large majority; (b) read it from the card image with vision **during the one-off compile
   in §6**, which is where it belongs; (c) both, (a) as the default and (b) to confirm.
   Recommendation: (c). Phase 1 ships with (a).
2. **Coverage.** Compiled effects will not cover every card on day one. The referee (§6.4) keeps
   every deck playable, but the UI has to make "this card is adjudicated at runtime" impossible
   to miss, and the setup screen has to say what it will cost.
3. **Unison and Z-cards** are in phase 1 by decision. They roughly double the engine surface;
   the build order inside phase 1 is core → Unison → Z, each with its own tests, so the core is
   playable hot-seat before the rest lands.
4. **Tokens** (cards created by effects) have their information defined by the creating
   effect — the compiler has to emit it.
5. **Card back.** The Bandai card back is theirs; we need an original design for face-down cards
   (life, deck, Claude's hand). That is a Claude Design task.
6. **Images** are hot-linked from deckplanet as today; a few 404 to the placeholder.

---

## 10. Build plan — each phase is usable on its own

| Phase | Delivers | Size |
|---|---|---|
| 0 | This proposal, Claude Design mockups (phone first), decisions in §12 | done / in progress |
| 1 | Engine with tests, no UI: setup, phases, costs with colour, play, attack, combo, damage, keywords, Unison, Z-cards, tokens, win/loss. Exercised by scripted hot-seat games | XL |
| 2 | Arena UI, **hot-seat** (you vs. you), phone layout first, then desktop: the board, legal-move highlighting, every animation in §4 | L |
| 3 | Effect compiler + referee + card inspector + a coverage line on the setup screen ("38 of 42 cards compiled, 4 adjudicated at runtime") | M |
| 4 | Claude opponent: view builder, menus, plans, two tiers, cost telemetry, end screen | M |
| 5 | Sounds, haptics, replay, event-log sheet polish | S |

Phases 1–2 are pure engineering with no AI cost. Phase 3 is the first that spends tokens.

---

## 11. Brief for Claude Design — paste as-is

> **Project:** "Arena" screen for an existing Dragon Ball Super Card Game companion app.
> Dark UI. Existing palette tokens: `space-950…50` (near-black navy through off-white),
> accent `ki-500` (#f28c0f orange, `ki-400` #ffa733, `ki-300` #ffc46b), card colours `dbs-red`
> #e5484d, `dbs-blue` #3b82f6, `dbs-green` #22c55e, `dbs-yellow` #eab308, `dbs-black` #6b7280,
> `gain` #34d399, `loss` #f87171. Rounded-xl panels with `border-space-700/70` on `bg-space-900/60`.
> Tailwind. System font stack.
>
> **Deliverables — phone first**
> 1. **Board layout** at 390×844 (primary) and 1440×900 (secondary): the folded layout in §2.1 —
>    opponent strip and compressed side at the top, the middle band with both Combo Areas and a
>    centred **power HUD** (attack 25 000 vs guard 20 000, the larger side lit), the human's
>    full-size side (Leader, Unison, Battle Area, Life, Deck/Z/Drop/Warp counts, Energy upside-down),
>    the **prompt bar**, and the **hand as a bottom sheet**. Show it **mid-battle**: an attacker
>    lifted with a targeting line to the opposing leader, two combo cards on one side and one on the
>    other.
> 2. **Card component** states: face-up active; face-up **rest (rotated 90°)**; face-down
>    (needs an **original card back** — not the Bandai one — dark, dragon-ball-adjacent motif,
>    readable at 40 px wide); energy card **upside-down**; stacked (Evolve) with a 6 px offset;
>    Unison with marker chips; leader **awakened back face**; dimmed (illegal) vs glowing (legal
>    to pick) vs selected (lifted); "adjudicated at runtime" badge.
> 3. **Prompt bar**: the one-line question the engine asks ("Combo? pick a card or pass"),
>    with pass/confirm (44 px), and the same bar in its "Claude is thinking…" state (leader
>    pulsing, no text stream).
> 4. **Phase strip**: Charge → Main → End, and the battle sub-steps Attack → Offense →
>    Defense → Damage, current step lit; compact enough for the phone header.
> 5. **Storyboard frames** (3 frames each) for: attack lunge + impact; damage (life card flips
>    and flies to hand; Critical variant to Drop with red tint); Counter card springing from
>    hand with a stamp; Awaken 3D flip with a ki burst; KO desaturate-and-slide.
> 6. **Setup screen** (phone): two deck pickers stacked (leader art, deck name, built/virtual
>    badge, coverage line), difficulty toggle Sparring / Tournament, coin flip, mulligan confirm.
> 7. **End screen**: winner, turns, damage dealt, and the game's cost in tokens and euros.
>
> **Tone:** it should feel like the table, not a dashboard — the middle band is a stage.
> Motion is fast and physical (150–350 ms), never floaty. Respect reduced motion. Everything
> tappable is ≥ 44 px.

---

## 12. Decisions (answered 3 Sep 2026)

1. **Rules scope for v1 — everything from the start.** Unison, Z-cards and tokens are in phase 1,
   not deferred. Build order inside the phase: core → Unison → Z.
2. **Unsupported card effects — ask Claude at runtime.** The referee in §6.4. Decks are never
   blocked; the cost and the risk are shown up front.
3. **Platform — prioritise the phone**, and consider whether a separate app in another
   language/stack would serve phones better while sharing the database. Assessment in §13.
4. **Opponent tiering — two tiers**, Sparring (Haiku) and Tournament (Opus for plans and counters).

Secondary, decidable later: sounds on by default? show Claude's table talk? allow "take back"
before an action resolves? which of your decks should be the reference pair for testing?

---

## 13. One app or two? — the phone question

The question was whether a native app (Swift / Kotlin / Flutter / React Native) would serve the
phone better than the web app, sharing the same Neon database.

**Recommendation: stay in Next.js and build the arena as a phone-first, installable web app.**
Reasons:

- **The engine is pure TypeScript with no React or database imports** (§5). It runs unchanged in
  the browser, on the server, in `npm test`, and — should a native app ever be needed — inside
  React Native, which is also TypeScript. Nothing built in phase 1 is thrown away by a later
  platform decision.
- **A native app now would force an API layer that doesn't exist.** The app's mutations are Next.js
  server actions behind HTTP Basic Auth; a second client would need REST/JSON endpoints, token
  auth, and versioning, before a single card is drawn. That is a month of plumbing with no
  gameplay in it.
- **What the phone actually needs is layout and touch, not a runtime.** A portrait board, tap-to-
  target, a bottom-sheet hand, haptics via `navigator.vibrate`, full-screen via the web-app
  manifest (`display: standalone`, installable on iOS and Android), and image caching via a
  service worker. All of that is available to the web app; none of it needs native code.
- **Animation is not the differentiator.** Framer Motion at 60 fps on a phone is fine for card
  flights and flips; the app doesn't need shaders or physics.
- **One codebase, one deploy, one auth.** The collection, decks, prices and scanner stay where
  they are; the arena links to them and they link to it.

What a native app would buy, honestly: better gesture fidelity (drag with velocity), true
background audio, App-Store presence, and a tighter camera loop for scanning. None of those is on
the arena's critical path. If they become important later, the path is React Native reusing the
engine and a thin JSON API in front of the existing server actions — a bounded step, not a rewrite.

Concretely for phase 2: ship a web-app manifest and icon so the arena can be installed to the home
screen and run without browser chrome, design the board at 390×844 first, test on the owner's phone
before the desktop layout is touched.
