# Arena — the animated board (web client)

**Status: built (6 Sep 2026).** All six phases. The motion board is the only board; `ArenaBoard.tsx`
is gone, and this is now the record of what the web client is rather than a plan for it.

§1 is what was true before the work, kept because it is the argument for it, with what each point
became. Each phase says what it actually turned out to need; §11 is the state.

⚠️ **The one thing nobody has done: play a game and watch it.** Every claim here is backed by
builds, types, lint, `npm test`, server-render checks and a beat audit across ~700 moves of real
games — not by a person seeing the board move. Phase F was taken on the owner's explicit
instruction, ahead of the game-on-a-phone gate §8 originally set for it.

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

**What each of those became**

1. Cards fly, because `layoutId` is the engine's instance id and a card changing zone is one element
   changing parent — `stage/StageCard.tsx`.
2. `toBeats` (`src/lib/arena/beats.ts`) translates the events into what a board can draw, and they
   are kept on `arena_games.beats` until you next act.
3. `useBeatPlayer` tells the turn beat by beat, and `useLiveGame` long-polls so it starts while
   Claude is still deciding the rest of it.
4. `AppShell` gives a game the whole screen; `manifest.ts`, an icon and `public/sw.js` make it
   installable — with the manifest, icons and worker exempted from Basic Auth, without which none of
   it is reachable.
5. `src/lib/arena/feel.ts` — vibration and synthesised tones, haptics on and sound off by default.
6. The tap answers on the frame it happens; the wait itself is unchanged, and honestly so
   (decision 3).

And the log now sits **above** the hand rather than instead of it.

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

**Pace (6 Sep 2026).** Watched on a phone, a turn at the table's durations went past faster than it
could be read, so the pace is now a remembered preference (`src/lib/arena/pace.ts`, beside buzz and
sound): **slow**, the default, stretches every beat 2.4× with an 800 ms floor; **normal** is the
table as written; **step** waits for a tap on *Next ▸* between beats. While the story plays the
prompt bar's headline is the narration sentence for the beat on screen and its hint says whose move
it is and "n of N". Two more things the follow-along needed: a card arriving from a pile with no
card of its own — the deck, or the opponent's hand — now flies in as a ghost from that pile
(`arrivesFrom` in `motion.ts`) instead of popping into place, and the skill spotlight is bound to
the `skill` beat on screen rather than the row's last skill, so every ability in a turn gets its
moment in order.

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

**Built.** As specified, plus one thing the spec had wrong:

- `src/app/manifest.ts`: `display: "standalone"`, `orientation: "portrait"`,
  `theme_color`/`background_color` `#090b15`, `start_url: "/arena"`, icons 192/512 plus maskable.
- Icon art: `src/app/icon.svg` — the card back the board already draws, which Next also serves as
  the favicon — rasterised by `scripts/make-icons.mts` (`npm run icons`) with **`sharp`, already a
  dependency**. The maskable variant insets the art to 72 % so Android's circular crop cannot cut
  it. No binary in the repo that cannot be regenerated from the SVG.
- `public/sw.js`: cache-first for card art from the five CDN hosts in `next.config.ts`, and
  **nothing** from the app's own origin — a cache of authenticated pages is a copy of the
  collection sitting in the browser profile, outliving any logout.

**What the spec got wrong: the manifest, its icons and the service worker cannot sit behind Basic
Auth.** The browser fetches all three without credentials, so they answered 401 and the app was
simply not installable — no amount of `crossorigin="use-credentials"` fixes the icon fetches, which
the OS makes. `src/proxy.ts` now exempts `icons/`, `manifest.webmanifest` and `sw.js` alongside the
`favicon.ico` it already exempted. What that gives away is a name, a picture and a list of public
image hosts. Verified by hand that the exemption is exactly those four assets: `/`, `/collection`,
`/arena`, `/arena/22`, `/api/v1/health` and `/api/v1/games` all still answer 401 without credentials.

The worker also answers a *failed navigation* with a small "no connection" page. That is not
caching anything authenticated — it is what makes the app meet the installability bar, which wants a
fetch handler that can still respond when the network cannot.

**Still to verify on the phone:** whether Chrome actually offers the install prompt. Everything up
to that point is checked.

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

**Built**, as `src/components/arena/stage/`:

| File | What it owns |
|---|---|
| `ArenaStage.tsx` | Composition root, and the layout: stage, battle rows, clash band, side rails, prompt bar, hand. |
| `StageCard.tsx` | `motion.div` with `layoutId={card.id}` around today's `ArenaCard` face. |
| `useBeatPlayer.ts` | The hook from A4: the queue, `suppressed`, `ghosts`, `skip`. |
| `Ghosts.tsx` | The overlay for cards that have already left. |
| `anchors.tsx` | `ZoneAnchor` and `anchorPoint` — rectangles for the piles that are only a number. |
| `motion.ts` | Every duration, which beat feels like what, and which beats bring a card in or take one away. |

Everything already worth keeping is carried over rather than re-earned — and the parts that are not
layout were *extracted* rather than copied, into `src/components/arena/shared.tsx`, which both
boards now import: the step banner, skill spotlight, attack beam, card preview, inspector, sheet,
`shortLabel` and `plainText`. Neither board can drift from the other on what a card says about
itself, and Phase F is a deletion rather than a salvage.

Three things the build settled:

- **`Hand.tsx` and `PromptBar.tsx` did not need to exist.** Both are a dozen lines inside the
  composition root, and splitting them out would have been filing rather than design. The hand
  becomes its own component when it becomes a bottom sheet, in Phase D.
- **Ghost positions are measured when the beat plays**, not when the ghost renders — reading the
  DOM during render is unsound, and the moment the card left is the honest answer to where it was.
- **The `ko` beat now carries `owner`.** Without it a client cannot know which side of the board a
  dead card should fly out of, and the card itself is gone by the time anyone asks. Contract §4.

The board is chosen by a `boardStyle` cookie, set from a control in the game's header, with
`?board=stage` / `?board=classic` overriding for one load.

---

## 6. Phase D — "easier", which is not the same as "animated"

Motion makes it engaging; these make it easier to play with one thumb. They are listed separately
because they are worth doing even if every animation is cut.

**Built**, except where noted.

1. **The hand opens.** `stage/Hand.tsx`: closed it is the 62 px strip, open the cards are 92 px,
   fanned and arced so they read as cards. Drag the handle or tap it. Not the fixed bottom sheet
   the spec imagined — an overlay would have had to fight the prompt bar for the bottom of the
   screen, and an expanding panel gets the same readable cards for none of that.
2. **The log stopped eating the hand** — done in Phase C. It sits above the cards rather than
   instead of them.
3. **The long press is visible.** A bar that fills across the card for exactly the 450 ms of the
   timer that opens the inspector. In `ArenaCard`, so the classic board gets it too. Deliberately
   *not* disabled under reduced motion: it is a progress indicator, and hiding it would put the
   gesture back in the dark.
4. **"What can I do?"** — the move count in the prompt bar, and after four idle seconds a soft rise
   and fall on every tappable card. The clock restarts on anything that changes what you could do,
   so it answers a beginner without nagging anyone else.
5. **Cancel** rather than "Back" while targeting, and it never scrolls away.
6. **The tap is acknowledged instantly** — haptic and a pending state, from Phase B. Latency cover,
   not a fix; the fix was declined in decision 3.

**Not built: drag-to-target.** Tap-then-tap already works, and drag would mean a gesture layer with
its own hit-testing against every card rectangle — a lot of surface for a second way to do something
that is not currently hard. Worth revisiting only if the tap flow proves fiddly in real games.

Explicitly **not** in scope: take-backs. Actions are applied and persisted server-side and the game
is reproducible from `seed + actions`; undo would mean truncating that list, which is a rules-level
decision, not a UI one. It stays on the proposal's open-questions list.

---

## 7. Phase E — the storyboard, wired

§4 of the proposal, with the beat that drives each and the mechanism. Durations are the phone's;
nothing exceeds 350 ms and nothing blocks the next tap.

Driven by **the beat on screen** (`playback.current`), not by whatever a re-render happens to
notice, so the moments play in the story's order. Every one runs on a *child* of the element the
layout animation projects — a transform on that element corrupts its measurement and the card flies
to the wrong place.

| Moment | Beat | Mechanism | ms | |
|---|---|---|---|---|
| Draw | `draw` | pops in where it lands | 220 | ✅ |
| Charge energy | `move` hand→energy | `layoutId` flight, landing upside-down | 260 | ◐ |
| Play a Battle Card | `move` hand→battle | `layoutId` glide, then `arena-pop` as it settles | 280 | ✅ |
| Rest / Active | `mode` | 90° rotation, already animated by `ArenaCard` | 200 | ✅ |
| Attack declared | `attack` | `arena-lunge-up`/`-down`, 18 % toward the target and back, with the SVG beam | 300 | ✅ |
| Combo | `move` →combo | slides in; the power figures **count up** (`Count`, over a motion value) | 250 | ✅ |
| Clash | `clash` | `arena-slam` on the figures, `arena-hit` flash and shake on the guard | 300 | ✅ |
| Counter | `move` hand→drop in a counter window | spring from hand, "COUNTER" stamp | 320 | ✗ |
| Blocker | `block` | blocker slides in front of the target | 280 | ✗ |
| Damage | `damage` | `arena-hurt` shakes the side that took it, with a red edge; haptic | 340 | ◐ |
| KO | `ko` | ghost desaturates and slides to the Drop anchor | 300 | ✅ |
| Awaken | `flip` | `arena-awaken`, a full 3D `rotateY` with a swell | 350 | ✅ |
| Unison markers | `markers` | `arena-chip`, popping in on a stagger | 180 | ✅ |
| Claude plays | `move` from a hidden hand | flies and pops like any other card | 300 | ◐ |
| Claude thinking | — | the pulse. **Never streams reasoning** | — | ✅ |
| Turn change | `phase` | the banner slams across the stage | 1500 | ✅ |

**◐ — less than the storyboard asked for, on purpose.** A charge lands upside-down but does not turn
over *during* the flight; a card Claude plays does not flip from its back on the way out; and damage
shakes the side that took it rather than flying a life card to the hand. That last one needs UI that
does not exist — life is a number and eight pips, not cards — so it is a piece of work, not a
keyframe.

**✗ — not built.** The counter stamp and the blocker sliding in front both need the board to tell
apart beats it currently cannot: a counter is only a `move` to the Drop, and `block` arrives after
the guard has already changed. Worth doing when the cards they belong to come up often enough that
their absence is felt.

---

## 8. Phase F — cutover

**Done.** `ArenaBoard.tsx` (482 lines) is deleted, the `boardStyle` cookie and its `chooseBoard`
action are gone, and `/arena/[id]` renders `ArenaStage` unconditionally. `ArenaCard`'s `drop` prop
went with it — the motion board says the same thing with an `arrive` beat.

The blocker check was run rather than assumed: every distinctive string in the old board was looked
for in the `stage/` tree. One real gap turned up — the hand's `hover:-translate-y-2` lift, which a
mouse gets and the motion board had never had — and it is now a `lifts` prop on `StageCard`, applied
below the layout element so a fanned hand still lifts under the pointer.

**This was taken ahead of its gate.** The paragraph here used to require a full Tournament game on
the owner's phone first, and that game has still not been played; the owner asked for the cutover
anyway. What that costs is the fallback: there is no second board to switch to if something is
wrong, and `git revert` is the way back.

---

## 9. Verification

No AI cost is added by any of this: it is client work, and a game costs exactly what it costs today.

- **`scripts/verify-arena.ts`** (part of `npm test`, so it must stay pure and database-free) gains
  `toBeats` tests: a known event batch maps to a known beat list; picture-less events collapse to
  nothing; a `ko` produces a beat carrying its own art key; the switch is exhaustive. The same run
  fails if the committed `contract/arena-v1.schema.json` no longer matches the Zod schemas — which
  is what keeps the Android app from finding out at runtime (contract §7).
- **`npm run arena:playthrough`** plays a whole game through the database, and now audits the beat
  stream on every move: numbering that only climbs, a queue inside its cap, `seq` equal to the
  highest beat, and a face carried for **every** card any beat names. This is the check that matters
  most, because it runs the real card pool — it is the only thing that exercises `toBeats` against
  the text real decks actually fire.

  Six games over four deck pairs (~700 moves) pass every assertion and produce **11 of the 16 beat
  kinds**, `ko` and `flip` among them, which are what drive the ghost layer and the awakening.
  Never yet produced by a real game: `token`, `block`, `markers`, `negated`, `say` — they need token
  cards, a blocker, a Unison, a negated attack, and an opponent who talks. Those paths are covered by
  `verify-arena.ts` with synthetic cards, but **no real game has drawn one**, which is worth knowing
  before trusting them.
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

| # | Phase | Ships on its own as | Status |
|---|---|---|---|
| 1 | A — beat stream (**shared**, contract §2–§6) | nothing visible; `npm test` covers it | **built** |
| 2 | B — phone shell | the *current* board, installable and full-bleed, with haptics | **built** |
| 3 | C — the motion board (was behind a cookie) | a board to play with, animated from beats | **built** |
| 4 | D — ergonomics | the hand that opens, the long-press bar, "what can I do?" | **built** |
| 5 | E — storyboard | the moments in §7, one at a time | **built** (three deferred, §7) |
| 6 | F — cutover | one board again | **built** |

Phase C is where `motion` finally gets installed; nothing before it needed a dependency.

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
