# Arena — the animated board (web client)

**Status: planned, not built (5 Sep 2026).** The work brief for a second, motion-first arena board
in the web app, built for an Android phone and installed from the browser, not a store.

The arena has **two clients** now, built and improved in parallel:

| | |
|---|---|
| **`docs/arena-client-contract.md`** | What they share, and the rule neither may break. **Read it first.** |
| **this document** | The web board — Next.js, Framer Motion, installable PWA. |
| **`docs/arena-android-spec.md`** | The native Android app — Kotlin, Compose, thin client over `/api/v1`. |

Also: `docs/arena-design-proposal.md` — §4 is the storyboard **both** clients implement, and §13 is
the platform assessment the Android app deliberately overrules; `docs/arena-next-stage-spec.md` —
the rules-engine brief, which neither client touches.

---

## 1. What is being asked for, and what already exists

The board plays correctly and knows no rules: it is drawn entirely from `boardView` and every
tappable thing comes from the engine's `legalActions`. That contract is right and this plan keeps it
untouched. What is missing is everything *between* two states.

Verified in `src/components/arena/ArenaBoard.tsx` (729 lines), `ArenaCard.tsx` and `globals.css`:

**There already is** a step banner that slams on every phase change, a skill spotlight card, a power
slam when a battle resolves, a drop-in for cards arriving in a Battle Area, an SVG attack beam
measured from the DOM, a hover preview, a long-press inspector, `--arena` scaling from phone to
laptop, and `prefers-reduced-motion` honoured on all three keyframes.

**There is not:**

1. **Any motion that follows a card.** A card played from hand does not travel; it vanishes from the
   filmstrip and drop-fades into the Battle Area. Nothing is drawn, charged, KO'd, flipped or
   destroyed *on screen* — only before and after are.
2. **Anything to animate from.** `GameEvent` in `engine/types.ts` says in its own comment
   *"Append-only log; the UI animates from these"* — but the events live only for the length of one
   `apply()`. `applyToGame` reduces them to log strings and one `spotlight` row and throws the rest
   away. The intent was written down and never wired up.
3. **A watchable opponent turn.** `advance()` calls `applyToGame` in a loop until a decision is
   yours. Claude's whole turn — charge, two plays, an attack, a combo, damage — arrives as one
   snapshot jump. You cannot see how the position you are now in came about.
4. **A phone shell.** There is no `public/`, no manifest, no icons, no service worker, so the arena
   cannot be installed to the home screen; §13 of the proposal called for exactly that and it was
   never done. The game page also renders the global header *and* `BottomTabs`, which costs about
   114 px of a 844 px screen to navigation you cannot use mid-game.
5. **Any physical feedback.** No `navigator.vibrate`, no sound — even though `src/lib/scan/cue.ts`
   already synthesises tones with Web Audio and ships no assets.
6. **Latency cover.** Every tap is a server action, a Neon round-trip and a full re-render of a
   `force-dynamic` page. Nothing acknowledges the tap except a card dimming.

One ergonomics bug found while reading, worth fixing whichever board wins: opening the log
**replaces the hand** (`logOpen ? <ol> : <hand>` in the bottom section), so you cannot read what just
happened and look at your cards at the same time.

---

## 2. Decisions (5 Sep 2026)

1. **A second board behind a flag, not a rewrite in place.** `ArenaBoard` keeps playing games while
   the new one is built; the switch is a preference, and the old board is deleted only once the new
   one has played a full game against Claude. Both consume the **same props** — `view`, `legal`,
   `taps`, `log`, `spotlight`, and now `beats` — so `boardView` and `tappable` stay the single
   source and the two cannot drift on rules.
2. **Framer Motion** (`motion/react`), as §4 of the proposal chose. The reason it earns a
   dependency: a card *changes DOM parent* when it moves from hand to Battle Area to Drop, and
   `layoutId` keyed on the engine's instance id animates that flight for free. Doing it by hand is
   measure-clone-fly-settle for every zone pair. Banners, glows, slams and impact flashes stay as
   CSS keyframes, which cost nothing at runtime.
3. **Beat playback, no engine in the browser.** The engine's events are persisted per `apply` and
   replayed client-side as timed beats, so Claude's turn becomes watchable. The board is *not* run
   forward locally: a second code path that could disagree with the server about the rules is the
   one thing this app should not have.
4. **Installable web app, no store listing** (the owner's framing, and §13's recommendation
   already). Android is the target: `navigator.vibrate` and Wake Lock are both available there.
5. **One of two clients.** Everything the board is given — `view`, `legal`, `taps`, `beats` — is
   defined once in `docs/arena-client-contract.md` and produced by one module,
   `src/lib/arena/session.ts`. The web board reaches it through the existing server actions rather
   than over HTTP, but it renders the **same snapshot** the Android app does. A field added for one
   client lands on both in the same commit.

---

## 3. Phase A — the beat stream

The foundation. Nothing else in either client works without it, and it is pure data with no visual
risk. It is also the piece that is **shared**, so it is specified once, in the contract:

- **Contract §2** — `src/lib/arena/session.ts`, the one place a `Snapshot` is built.
- **Contract §3** — the `Snapshot` shape.
- **Contract §4** — `Beat`, `Beats`, `src/lib/arena/beats.ts`, the `beats jsonb` column on
  `arena_games` and its `0024_*` migration.
- **Contract §6** — long-polling, which is what finally makes Claude's turn arrive as it happens
  rather than as one jump after a minute of a pulsing dot.

Two things stay here because they are the web client's own, and the Android app solves them its own
way (`docs/arena-android-spec.md` §5.3):

### A3. Suppress-and-reveal — how playback stays honest

The server renders the *end* state. Playing beats over it would show a card in the Battle Area
before the beat that plays it. So the beat player owns two sets, and the board reads them:

- **suppressed**: instance ids not yet arrived. The board renders them `visibility: hidden` until
  their `move` beat fires, then hands them to Framer Motion, which flies them in from the source
  zone's anchor.
- **ghosts**: cards that left. Rendered in an overlay layer from the beat's own art, at the last
  place their id was seen (or the centre of the zone they left, if never seen), then shuddered,
  desaturated and slid to the Drop anchor.

**Zone anchors** are the primitive both need: an invisible `data-arena-zone="p1:deck"` element in
each zone — deck, drop, life, warp, energy, Z — so a card that comes from somewhere invisible has a
rectangle to come *from*. Six per side, a few lines each.

**What this honestly cannot do:** it shows the right beats in the right order at the right places,
not a fully re-simulated board. A card that is played, attacks, and is KO'd within one Claude turn
will fly in, lunge and fade — but the intermediate power figures during that turn are the end
state's, not each moment's. Getting those right needs the engine in the browser, which decision 3
declined. If it ever matters, the fix is bounded: replay `actions` client-side rather than write a
second rules implementation.

### A4. Playback control

`BeatPlayer` is a hook, not a component: it walks the list on a timer, exposes
`{ playing, suppressed, ghosts, current, skip }`, and locks the board's input while it runs
(`playable && !playing`). A **Skip** button in the prompt bar jumps to the end state instantly and is
the *same code path* as `prefers-reduced-motion`, so neither can rot while the other is used.
Durations live in one table in `src/components/arena/stage/motion.ts` — reduced motion sets them all
to zero rather than being a second branch in every component.

---

## 4. Phase B — the phone

Independent of everything else; shippable on its own, and improves the current board too.

### B1. Full-bleed game route

The global header and `BottomTabs` come from the root layout. Rather than a route group, the two
pieces of chrome hide themselves: `BottomTabs` already reads `usePathname`, and the header and the
`main` padding get a small `AppShell` client wrapper that does the same. Chromeless on
`/arena/<id>` only — the arena *list* keeps its navigation. That is ~114 px back on a 390 × 844
screen, which is most of a card.

### B2. Installable

- `src/app/manifest.ts` (typed, no `public/` needed for the file itself): `display: "standalone"`,
  `orientation: "portrait"`, `theme_color: "#090b15"`, `background_color: "#090b15"`,
  `start_url: "/arena"`, icons 192/512 plus a maskable variant.
- Icon art: one SVG in the repo (a ki-orange ring on `space-950`), rasterised to the PNG sizes by
  `scripts/make-icons.mts` using **`sharp`, which is already a dependency**. No new tooling, and no
  binary blob committed that cannot be regenerated.
- A minimal service worker whose **only** job is cache-first for card art from the three remote
  hosts in `next.config.ts`. It deliberately caches nothing from the app's own origin: the whole app
  sits behind HTTP Basic Auth and caching authenticated responses is not worth the surprise.
  **Risk to verify on the phone first:** service-worker registration under Basic Auth, and whether
  Chrome offers the install prompt with an art-only fetch handler.

### B3. Touch details that decide whether it feels like an app

- `overscroll-behavior: none` on the arena root — Android Chrome's pull-to-refresh firing mid-drag
  and reloading a game is the single worst thing that can happen on this screen.
- `touch-action: manipulation` to kill double-tap zoom on cards.
- `env(safe-area-inset-bottom)` on the prompt bar and the hand sheet; `viewport-fit=cover` is
  already set in the root layout and currently unused.
- **Wake Lock** (`navigator.wakeLock`) held while a game is `playing`, released on unmount. A
  Tournament turn can take Claude most of a minute and the screen should not sleep in the middle of
  it.
- **Haptics** — `src/lib/arena/haptics.ts`, Android's `navigator.vibrate`, a no-op elsewhere:
  `tap` 10 ms, `land` 20 ms, `illegal` two short, `impact` `[0,30,40,60]`, `damage` a longer pulse,
  `ko`. Off switch in the same place as sound.
- **Sound** — the same Web Audio approach as `src/lib/scan/cue.ts`, no assets: draw, charge, land,
  clash, ko, win. **Default off**, one toggle, remembered in `localStorage` (the proposal left this
  question open; a game that starts making noise unasked is the wrong default).

---

## 5. Phase C — the new board

`src/components/arena/stage/`, reached by a `boardStyle` cookie set from a link on `/arena`
("try the new board"), with `?board=classic` as an escape hatch. A cookie, not a column: it is read
server-side in `page.tsx`, survives reloads on the phone, and needs no migration.

| File | What it owns |
|---|---|
| `ArenaStage.tsx` | Composition root. Same props as `ArenaBoard`, plus `beats`. |
| `Card.tsx` | `motion.div` with `layoutId={card.id}`, wrapping today's `ArenaCard` face. |
| `Stage.tsx` | The two Battle Areas, the clash band, zone anchors. |
| `Hand.tsx` | The bottom sheet (§6). |
| `SideRail.tsx` | Leader, life, energy, counters — today's `SidePanel`, folded for the phone. |
| `PromptBar.tsx` | The one question, the primary actions, Skip while playing back. |
| `BeatPlayer.ts` | The hook from A4. |
| `Ghosts.tsx` | The overlay layer for cards that have left. |
| `motion.ts` | Every duration and easing, in one table. |

Everything already worth keeping is carried over rather than re-earned: the safe-centred hand, the
attack beam's DOM measurement, the long-press inspector, the `--arena` scale, the tap-then-target
flow, `shortLabel`, `plainText`, the report-a-bug button.

---

## 6. Phase D — "easier", which is not the same as "animated"

Motion makes it engaging; these make it easier to play with one thumb. They are listed separately
because they are worth doing even if every animation is cut.

1. **The hand becomes a bottom sheet.** Today it is a 62 px filmstrip in which a card's text is
   unreadable without a long press. Peek (a fanned edge) → drag up to a readable fan → tap a card to
   lift it → tap again to commit, with the legal zones lit while it is lifted. Big single win.
2. **The log stops eating the hand.** It becomes its own sheet, with the beats that just played
   highlighted, so "what just happened" and "what do I hold" are answerable at once.
3. **A visible affordance for the long press.** A ring that fills over the 450 ms, so the inspector
   stops being a secret.
4. **"What can I do?"** — the count of legal moves in the prompt bar, and after four idle seconds a
   soft pulse across every tappable card. This is the difference between learning the game and
   guessing at it.
5. **Targeting gets a Cancel that is always there**, and drag-to-target as an alternative to
   tap-then-tap (the tap flow stays; drag is added, not swapped).
6. **The tap is acknowledged instantly** — haptic, the card lifts, the prompt bar shows a pending
   state — even though the answer is a server round-trip away. This is latency cover, not a fix; the
   fix was declined in decision 3.

Explicitly **not** in scope: take-backs. Actions are applied and persisted server-side and the game
is reproducible from `seed + actions`; undo would mean truncating that list, which is a rules-level
decision, not a UI one. It stays on the proposal's open-questions list.

---

## 7. Phase E — the storyboard, wired

§4 of the proposal, with the beat that drives each and the mechanism. Durations are the phone's;
nothing exceeds 350 ms and nothing blocks the next tap.

| Moment | Beat | Mechanism | ms |
|---|---|---|---|
| Draw | `draw` | fly from the deck anchor, hand re-fans | 220 |
| Charge energy | `move` hand→energy | `layoutId` flight with a 180° rotation on the way | 260 |
| Play a Battle Card | `move` hand→battle | lift, `layoutId` glide, 4 px settle, edge glow | 280 |
| Rest / Active | `mode` | 90° rotation (today's transform, now animated) | 200 |
| Attack declared | `attack` | attacker lunges 30 % and snaps back; today's SVG beam draws | 300 |
| Combo | `move` →combo | slide in; the power HUD counts up rather than swapping | 250 |
| Clash | `clash` | today's `arena-slam` on the winning figure, impact flash at the guard | 300 |
| Counter | `move` hand→drop in a counter window | spring from hand, "COUNTER" stamp, then Drop | 320 |
| Blocker | `guardChanged` | blocker slides in front of the target and rotates to rest | 280 |
| Damage | `damage` | leader flash, a life card flips and flies to hand (red tint + Drop if Critical), haptic | 340 |
| KO | `ko` | ghost shudders, desaturates, slides to the Drop anchor | 300 |
| Awaken | `flip` | 3D `rotateY` on a preserve-3d wrapper, ki burst, back face lands | 350 |
| Unison markers | `markers` | chips pop in / fall off | 180 |
| Claude plays | `move` from a hidden hand | the face-down back flips face-up as it leaves | 300 |
| Claude thinking | — | today's pulse, kept. **Never streams reasoning** | — |
| Turn change | `phase` | today's banner, plus a light change on the active side | 1500 |

---

## 8. Phase F — cutover

The new board becomes the default only after it has played one full Tournament game against Claude
on the owner's phone, start to finish, without falling back. Then the cookie flips, `ArenaBoard.tsx`
and its private helpers are deleted in one commit, and this document's §1 is rewritten as what was
built. Any behaviour still only in the old board is a blocker for that commit, not a follow-up.

---

## 9. Verification

No AI cost is added by any of this: it is client work, and a game costs exactly what it costs today.

- **`scripts/verify-arena.ts`** (part of `npm test`, so it must stay pure and database-free) gains
  `toBeats` tests: a known event batch maps to a known beat list; picture-less events collapse to
  nothing; a `ko` produces a beat carrying its own art key; the switch is exhaustive. The same run
  fails if the committed `contract/arena-v1.schema.json` no longer matches the Zod schemas — which
  is what keeps the Android app from finding out at runtime (contract §7).
- **`npm run arena:playthrough`** already plays a whole game through the database — extended to
  assert every `apply` produces a well-formed `beats` entry and that `toBeats` never throws across a
  full game's events.
- **`npm run typecheck` / `npm run lint`** clean, as always, before anything is committed.
- **Phone checklist**, on the owner's Android device, not an emulator: install to home screen;
  portrait lock; safe areas top and bottom; pull-to-refresh cannot fire; double-tap does not zoom;
  haptics land on tap/impact/KO; wake lock holds through a Tournament turn; reduced motion produces
  a playable board with no animation; card art loads acceptably on a mobile connection; Skip during
  Claude's turn returns to a correct board.

---

## 10. Risks

- **Migration numbering.** One `0024`, generated. `db:migrate` runs against production before every
  Vercel build, so a duplicate number breaks all deploys, not just this feature.
- **Service worker under Basic Auth.** Verify registration on the phone before building anything on
  top of it. Fallback: no service worker — the app is still installable and everything else in this
  plan still works.
- **Two boards drifting.** Mitigated by the shared props contract, and bounded by Phase F being a
  deletion rather than a maintenance plan.
- **Bundle size.** `motion` is ~34 kB gzipped and lands only on the arena route. Acceptable for a
  screen that already ships an engine's worth of view code; worth measuring at Phase C.
- **`beats` growing the row.** Capped at 300, cleared on every human action. A row is already
  carrying a full `GameState`, so this is not the biggest thing in it.
- **Motion nausea on a small screen.** Every duration in one table, reduced motion honoured through
  the same path as Skip, and nothing floaty — 150–350 ms, physical.

---

## 11. Order of work

Phases A and B are independent and either can go first; A is the one everything else needs — and it
is also step 1 of the Android plan, so it is done once and both clients start from it.

| # | Phase | Ships on its own as |
|---|---|---|
| 1 | A — beat stream (**shared**, contract §2–§6) | nothing visible; `npm test` covers it |
| 2 | B — phone shell | the *current* board, installable and full-bleed, with haptics |
| 3 | C — new board behind the cookie | a board to play with, animated from beats |
| 4 | D — ergonomics | the hand sheet, the log sheet, "what can I do?" |
| 5 | E — storyboard | the moments in §7, one at a time |
| 6 | F — cutover | one board again |

## 12. Two clients, one game

The failure mode to watch is not either client being bad; it is the two drifting until a rule change
lands on one of them. Three things prevent it, and they are all mechanical rather than a promise:

1. **Neither client evaluates a rule** (contract §1). Both are handed `legal` and may only choose
   from it.
2. **One `Snapshot` builder** (contract §2). Server actions and `/api/v1` are two doors into the
   same function.
3. **Golden fixtures in `npm test` and in the Gradle build** (contract §7). A shape change that
   would break the app breaks a build first.

Where the clients are *allowed* to differ is feel: the web board uses Framer Motion and
`navigator.vibrate`, the app uses Compose shared elements and `VibrationEffect.Composition`. The
durations, though, come from the same table in §7 of each document, so the same game does not move
at two speeds.
