# Arena — the client contract

**Status: planned, not built (5 Sep 2026).** The one thing two arena clients share.

The arena is getting a second client: a native Android app (`docs/arena-android-spec.md`) alongside
the web board (`docs/arena-ui-motion-spec.md`). This document is what stops them becoming two
different games. Read it before touching either.

---

## 1. The rule this document exists to enforce

**There is one rules engine and it runs on the server.** Neither client knows a rule. Both are given
the same three things and may do nothing else:

- `view` — what the board looks like from one player's side, with what that player may not see
  already removed (3-1-3).
- `legal` — every move the engine will accept right now. If it is not in this list it cannot be
  sent, and the server will refuse it if it is.
- `beats` — what happened since you last acted, in order, so the client can animate it.

A client that computes a legality, a power figure, or what a card does has broken the contract. The
symptom is always the same and always weeks later: the app says an attack is legal and the server
says it is not.

## 2. One source, two transports

The contract is enforced at the **function** boundary, not the HTTP boundary. Two modules hold it,
split by whether they touch anything outside themselves:

```
src/lib/arena/snapshot.ts     pure: no database, no SDK, no network
  buildSnapshot(input)             → Snapshot
  viewerFor(input) / waitingFor(input)

src/lib/arena/session.ts      the database and Claude
  snapshotOf(db, gameId, viewer?)          → Snapshot | null
  snapshotOfGame(db, game, viewer?)        → Snapshot      // for a caller holding the game
  applyAction(db, gameId, action, viewer?) → Snapshot      // wraps applyToGame
  advanceSession(db, gameId, viewer?)      → { snapshot, error }
  waitForBeats(db, gameId, since, timeoutMs, viewer?) → Snapshot | null
                               // viewer: the asking player's seat in a 1 v 1 (§3.3);
                               // null everywhere else, and derived as it always was
```

The split is what lets `npm test` build a real snapshot and compare it against a golden fixture
without a database — see §7. `aiPlayerOf` lives beside the Anthropic client, so the pure half takes
Claude's side as an input rather than importing it.

- The **web board** calls these from its existing server actions in `src/app/arena/actions.ts`. It
  keeps server actions: for a client that ships with the server, an extra HTTP hop and a second auth
  path would be pure cost.
- The **Android app** calls them through thin route handlers under `/api/v1/`.

Both therefore render from a byte-identical `Snapshot`. Adding a field to the snapshot benefits both
clients on the same commit, and no endpoint can quietly grow a rule.

## 3. `Snapshot`

```ts
export interface Snapshot {
  /** Bumped only on a breaking change; see §7. */
  contract: 1;
  game: {
    id: number;
    mode: "hotseat" | "sparring" | "tournament" | "versus";
    status: "playing" | "over" | "abandoned";
    turn: number;
    p1Name: string;
    p2Name: string;
    /** Which chair this board was drawn for; `view.you` is this player. §3.3 */
    you: "p1" | "p2";
    /** The login in each seat. Null outside a 1 v 1. */
    p1User?: string | null;
    p2User?: string | null;
  };
  /** src/lib/arena/view.ts — unchanged, already carries per-card art. */
  view: BoardView;
  /** src/lib/arena/engine — unchanged. The only moves that exist. */
  legal: LegalAction[];
  /** src/lib/arena/view.ts — legal indexed by the card each move names. */
  taps: Tappable;
  /**
   * The moves the asked player might reach for that are not in `legal`, each
   * with its reasons (`docs/arena-workflow-spec.md`). Only when the viewer is
   * the player being asked — never for Claude — and absent when empty.
   */
  rejected?: RejectedAction[];
  /** §4. Null when nothing has happened since the client last looked. */
  beats: Beats | null;
  spotlight: (Spotlight & { imageUrl: string | null }) | null;
  /** The tail of the readable log, newest last. */
  log: string[];
  /** Who the game is waiting on. `null` once it is over. */
  waiting: "you" | "opponent" | "referee" | null;
  /** What Claude has cost this game. */
  spend: { calls: number; input: number; output: number; cached: number; micros: number };
  over: { winner: "p1" | "p2" | null; reason: string } | null;
}
```

`view`, `legal` and `taps` already exist and are already exactly this shape. The snapshot is mostly
an envelope around code that is written, which is why this is a small piece of work rather than a
platform.

### 3.1 The rejection side (added 6 Sep 2026, `docs/arena-workflow-spec.md` Phase 1)

`legal` says only what the server will accept, so a card the player cannot play is silent. The
additions below make the *reason* part of the payload — all of them optional, so the contract did
not bump (§7):

```ts
/** Why a move the player might expect is not on the menu. A closed vocabulary; the client words it. */
export type Requirement =
  | { kind: "energy"; need: number; have: number }              // active energy + markers
  | { kind: "energyColour"; colour: string; need: number; have: number }
  | { kind: "mode"; card: string; mode: "active" | "rest" }     // it is resting
  | { kind: "timing"; window: string }                          // when it *would* work: main, battle, defense, nextTurn
  | { kind: "oncePerTurn"; what: string }                       // charge, skill, Over Realm, marker skill, Z-Awaken
  | { kind: "zone"; card: string; area: Area }                  // where it would have to be
  | { kind: "cardType"; card: string; needs: string }           // "a Battle Card with a combo cost"
  | { kind: "target"; reason: string }                          // nothing legal to point at
  | { kind: "forbidden"; by: string | null }                    // a rule in play; `by` names the card
  | { kind: "unread"; card: string }                            // the compiler cannot read the text
  | { kind: "condition"; text: string }                         // a printed condition not met yet
  | { kind: "other"; detail: string };                          // the pressure valve

export interface RejectedAction {
  action: Action;        // the move the player was reaching for, opaque to a client like `legal[i].action`
  label: string;         // what the label would have been
  why: Requirement[];    // most decisive first; never empty
}

export interface Tappable {
  // …unchanged…
  whyByCard?: Record<string, Requirement[]>;   // rejections indexed by the card, once each
}

export interface SideView {
  // …unchanged…
  /** Cards the current prompt names that no zone draws (deck, Drop below the top, Warp, face-down
   *  life, Z-Deck, under a card). Only on the side of the player being asked, and only for that
   *  player's view: a search of your deck reveals those cards to you and to nobody else. */
  choices?: CardView[];
}

// BoardView.prompt gains, all optional:
//   min?: number; max?: number;                          // from a `chooseCards` prompt; min 0 needs a "Choose none" button
//   step?: { index: number; count: number; label: string }; // from the engine's flow; count 0 = total unknown
//   cost?: string;                                       // `payCost` / `optionalCost`'s describe, unflattened
```

### 3.2 Rules in force (added 6 Sep 2026, `docs/arena-compiler-workflow-review.md` §3.3–3.5, §3.8)

A rule in force — a "+5000 power for the turn", a "can't attack until the start of your next
turn", a [Permanent]'s aura — used to reach a client only as a different number. These additions
make each one a *thing* with a label, a duration and a source. All optional; the contract did not
bump (§7). `src/lib/arena/effects.ts` is the one place a rule becomes these words.

```ts
/** One rule in force on a card or a player. */
export interface EffectView {
  kind: "power" | "comboPower" | "keyword" | "negate" | "forbid" | "permit" | "cost" | "other";
  label: string;                 // "+5,000 power", "[Critical]", "can't attack", "skills negated", "costs 1 less"
  until: Duration | "permanent"; // "permanent" = while the source card's [Permanent] skill is valid
  source: string | null;         // the card whose skill made it (instance id), or null for the rules' own
  sourceName: string | null;     // captured now; the card may leave the board
  by: PlayerId | null;           // whose skill made it — the two turn-relative durations read against this
  keyword?: string;              // for kind "keyword": which one, so the glyph can be marked granted
}

/** One [Permanent] skill of a card and whether it is doing anything right now. */
export interface PermanentView {
  index: number;                 // the engine's skill index
  text: string;                  // the printed line without its tag
  state: "on" | "off" | "inert" | "unread";
  reading: string;               // the engine's reading, without a duration
}

export interface CardView {
  // …unchanged…
  referee: boolean;              // now never true for a [Permanent]: it never resolves, so the referee is never asked
  basePower?: number;            // the printed power, present only when `power` is not it
  effects?: EffectView[];        // every rule in force on this card now, its own [Permanent]'s included
  permanents?: PermanentView[];  // this card's own [Permanent] skills
}

export interface SideView {
  // …unchanged…
  rules?: EffectView[];          // rules in force on the *player* — "can't attack with Battle Cards"
}

export interface LegalAction {
  action: Action;
  label: string;
  cost?: { energy: number; orbs?: Partial<Record<Color, number>>; markers?: number; describe: string }; // skills and counters
}

// Requirement gains, all optional:
//   { kind: "forbidden"; by; until?: Duration | "permanent" } // how long the rule holds, for the remedy
//   { kind: "oncePerTurn"; what; limit?: number }             // the printed [Limit X], when that is the rule
//   { kind: "mode"; card; mode; locked?: boolean }            // a rule keeps it from standing up next Charge Phase
```

Three properties, the server's job:

- **`effects` and `rules` are read from the engine's state, never inferred from numbers.** A
  client that subtracts `basePower` from `power` and guesses the rest has broken §1.
- **A [Permanent]'s state is measured, not compiled.** `on` means the static layer is emitting
  something from it at this moment on this board; `off` means it compiles and emits but its
  condition does not hold or nothing matches; `inert` means it compiles to ops the static layer
  has no kind for, so it does nothing — which the compile figures could never show.
- **`rejected` now covers the counter window, a `chooseCards` prompt and the blocker prompt** as
  well as charge, main and combo; a one-card `choose` is keyed by the card it names.

Three properties, all the server's job:

- **`rejected` is computed for the viewer only, and only when the prompt is theirs.** It is the
  answer to "why can't I", which only the player asking can ask; it is never computed for Claude's
  side. At most one entry per card per action type, and never a move that `legal` offers for that
  card — `npm test` and `arena:playthrough` both assert `legal ∩ rejected = ∅` and that no `why` is
  empty.
- **The reasons come from the engine, never from a client.** Each gate in `legalActions` has a
  `whyNot*` twin beside it in `engine.ts` that runs the same tests in the same order; the
  predicates themselves are untouched.
- **A client words a `Requirement`; it never computes one.** `other` is a sentence the client cannot
  style or translate; the playthrough audit counts them, and a growing number is the signal to add
  a kind.

The Android app does not exist yet; `Snapshot.kt` carries every field above from day one, so it
inherits the workflow model rather than retrofitting it.

### 3.3 Two people, two devices (added 7 Sep 2026)

`versus` is a 1 v 1 between two human beings on two phones. It is the first
mode where **the same game is rendered twice**, and that is the only thing that
makes it different from hot-seat — the engine, the flow and the legal-move list
are untouched.

Three properties, all the server's job:

- **A snapshot is built for a stated viewer.** `buildSnapshot` takes an optional
  `viewer`; `snapshotOfGame`/`snapshotOf`/`applyAction`/`advanceSession`/
  `waitForBeats` all pass it through. A 1 v 1 passes the asking login's seat.
  Everything else passes nothing and `viewerFor` derives one exactly as before:
  against Claude the human is p1, hot-seat follows whoever is being asked.
  `game.you` is what it settled on, so a client never works out its own chair.
- **`waiting` is read against the viewer, not against Claude.** `"opponent"` now
  means the other player, human or not. Nothing else changed: against Claude the
  viewer is p1 and the prompt p2, so it still reads `"opponent"`; hot-seat's
  viewer *is* the asked player, so it still reads `"you"`.
- **`beats` are masked per viewer** (`maskBeats`). This was a real leak, not a
  precaution: `Beats.art` carries the true name and picture of every card a beat
  names, drawn cards included, and `damage` names the Life cards taken — which go
  to hand unrevealed. Only the *face* is removed; the beat and its instance id
  stay, so the card still flies, face-down. The rule is `revealedTo`'s in
  `view.ts`, the same one `sideView`/`cardView` draw by, asked of the board as it
  stands — a card drawn and then played is public, so its beat is not masked.
  **A client must never reconstruct a masked face**, from a previous snapshot or
  anywhere else; that is §1 in the one place it now costs a real secret.

Seats live on `arena_games.p1_user`/`p2_user` (`app_users.username`, null in
every other mode). A 1 v 1 belongs to its two seats and to nobody else, over as
well as playing (owner's decision, 7 Sep 2026): every `/api/v1` route resolves
the seat with `seatFor` and answers `not_found` to anyone else, and a move whose
prompt belongs to the other seat is `not_your_turn`. Two devices can also write
at once — a blocker or counter prompt belongs to the player whose turn it is not
— so `applyToGame` now writes `WHERE version = <what it read>` and a losing race
gets `stale`, the same answer a failed `basedOn` gets.

There is deliberately **no** endpoint that creates a `versus` game: it takes two
decks chosen at two moments by two people, so it is opened as a match
(`src/lib/arena/matches.ts`) and `newGameSchema` still refuses the mode.
### 3.4 What a battle contains (added 7 Sep 2026, `docs/arena-battle-staging-spec.md` §3.1)

A DBS attack is an attacker, a guard and a chain of combo and counter cards added in order. The
board could see *that* a fight happened and not *what* decided it: a counter is only a `move` to
the Drop, so no client could tell one played into a battle from any other discarded card, and a
total climbing was the only sign a skill had fired. Two additive fields on `BoardView.battle` fix
both. Optional, so the contract did not bump (§7).

```ts
export interface BattleView {
  attacker: string;
  guard: string;
  step: string;
  attackPower: number;
  guardPower: number;
  /**
   * The counter cards played into THIS battle, in play order, while it is
   * open. Built from the battle's own record (`Battle.counters` in the
   * engine), never by inspecting the Drop. Absent when none were played.
   *
   * `after` is how many combo cards that player had already added when this
   * one was played, so one side's counters and combo cards merge into a
   * single numbered chain in true play order rather than a guessed one.
   */
  counters?: { card: CardView; by: PlayerId; after: number }[];
  /**
   * Card instance id → the power that card is putting into the fight now.
   *
   * The attacker, the guard and every combo card add up exactly: attacker +
   * that side's combo = `attackPower`. A counter's figure is the part of the
   * *guard's* number that came from it — a counter moves a power rather than
   * standing beside it — so it is a breakdown of a figure already counted,
   * never an extra term.
   */
  contributions?: Record<string, number>;
}
```

A client may draw these and nothing else with them. Working out which cards are in a battle, what
each contributes, or whether a skill fired is the engine's job — inferring a trigger from a power
figure changing is the exact failure §1 is about.
## 4. `Beats` — the animation stream

The engine's own comment on `GameEvent` says *"Append-only log; the UI animates from these"*. Today
those events die inside `apply()`. The contract is where they finally get out.

The built shape, `src/lib/arena/beats.ts`:

```ts
export type Beat =
  | { t: "phase"; phase: string; player: PlayerId; turn: number }
  | { t: "draw"; player: PlayerId; card: string | null }
  | { t: "move"; card: string; from: Area; to: Area; owner: PlayerId }
  | { t: "mode"; card: string; mode: "active" | "rest" }
  | { t: "flip"; card: string }
  | { t: "markers"; card: string; delta: number; total: number }
  | { t: "token"; card: string; owner: PlayerId }
  | { t: "attack"; attacker: string; target: string }
  | { t: "block"; guard: string; by: string }
  | { t: "clash"; attacker: string; guard: string; attackPower: number; guardPower: number; hit: boolean }
  | { t: "damage"; player: PlayerId; amount: number; critical: boolean; cards: string[] }
  | { t: "ko"; card: string }
  | { t: "negated" }
  | { t: "skill"; card: string; label: string; text: string; unread: boolean; owner: PlayerId; inBattle: boolean }
  | { t: "effect"; card: string | null; player: PlayerId | null; kind: EffectKind; label: string; until: Duration | "permanent"; source: string | null; owner: PlayerId }
  | { t: "effectEnded"; card: string | null; player: PlayerId | null; kind: EffectKind; label: string; source: string | null }
  | { t: "say"; text: string }
  | { t: "over"; winner: PlayerId | null; reason: string };

/** Beats are numbered, not counted: a client replays every `n > lastPlayed`. */
export type NumberedBeat = Beat & { n: number };

export interface Beats {
  /** The highest `n` in `list`. Monotonic for the life of the queue. */
  seq: number;
  list: NumberedBeat[];
  /** Face and name for every card a beat names — see below. */
  art: Record<string, { cardId: string; name: string; imageUrl: string | null }>;
}
```

Four things the build settled that the first draft of this section had wrong:

- **`token` is its own beat.** The engine pushes a token straight into a Battle Area with no `move`
  event, so without this a token appears out of nowhere between two snapshots.
- **Beats are numbered rather than counted.** Position in `list` is not enough once the queue has
  been capped; `n` survives that, so a client replays exactly what it has not seen.
- **`clash` names both cards** and **`damage` carries the life cards taken**, because the storyboard
  animates at the guard and flies specific life cards, and both were already in the events.
- **A leader turning back does not get a `flip` beat.** Only the awakening does; there is no moment
  to show for the other direction.
- **`ko` carries `owner`.** Added while building the ghost layer: a KO'd card is gone from the board
  by the time anyone looks, so without it a client cannot tell which side it should fly out of.
  `null` only if the card left the game entirely.
- **`skill` carries `owner`** (6 Sep 2026, workflow spec §3.4): whose ability resolved, so the
  opponent-turn narration can say *"Claude uses 《Union-Absorb》"* rather than a card sliding by.
- **`effect` and `effectEnded` are beats** (6 Sep 2026, review §3.3): a rule coming into force and
  the same rule wearing off, so a "+10000 power" before a clash and the number dropping back at
  the end of the turn each have a moment and a sentence. The engine writes an `effectEnded` event
  wherever it expires an effect, which is what the second beat is made from. A source or target
  no longer in the game is left out of the beat rather than named without a face.
- **One `skill` beat per activation.** A text [Activate] used to emit two (review §3.2).

Three properties the clients depend on, all of which are the server's job:

- **A beat names an instance id**, the same id `view` uses. The web board already writes
  `data-arena-card={id}` into the DOM and Android will key its composables the same way, so a beat
  can always be aimed at a real rectangle.
- **Beats carry their own faces.** A card KO'd during Claude's turn is gone from the `view` the
  server renders, so a client cannot look it up. `art` is resolved server-side from the same query
  the page already runs.
- **`toBeats` is exhaustive over `GameEvent`.** Adding an engine event becomes a compile error in
  `src/lib/arena/beats.ts`, so the UI cannot silently stop showing something the rules do. Events
  with no picture (`stack`, `hidden`, `note`, `delayed`) map to nothing, deliberately.

Storage: one `beats jsonb` column on `arena_games` (`0024_grey_la_nuit.sql`), beside the existing
`spotlight` precedent and nullable like it — the queue is an object, so an `'[]'` default would have
been the wrong shape, and `null` already means "nothing to play". Appended by `applyToGame`, capped
at the last 300, and **cleared when you act**, so the queue holds exactly one story: your move, then
everything the server did in reply.

The **counter survives that clearing** even though the beats do not, so `n` climbs for the whole
life of the game. Found by watching a real game: with a per-queue counter the numbers ran 24 → 0 →
17, and a client following the rule above would have judged the new turn already played and sat
still through it.

## 5. Endpoints — `/api/v1/`

Only the Android app uses these; the web board calls §2 directly.

| Method | Path | Body / query | Returns |
|---|---|---|---|
| `GET` | `/api/v1/health` | — | `{ contract, minClient, latestClient, serverTime }` |
| `GET` | `/api/v1/decks` | `?game=dbs` | deck list: id, name, leader art, built/virtual, legality, playable |
| `GET` | `/api/v1/decks/{id}` | — | deck detail: zones, counts, per-card flags — **read-only** |
| `GET` | `/api/v1/games` | `?limit=20` | game list, as `/arena` shows it |
| `POST` | `/api/v1/games` | `{ p1DeckId, p2DeckId, mode, debug }` | `{ id }` — `mode` excludes `versus`, §3.3 |
| `GET` | `/api/v1/games/{id}` | `?sinceBeat=N&wait=25` | `Snapshot` — §6 |
| `POST` | `/api/v1/games/{id}/actions` | `{ index, basedOn? }` | `Snapshot` — your move only |
| `POST` | `/api/v1/games/{id}/advance` | — | `Snapshot` once Claude has finished deciding |
| `POST` | `/api/v1/games/{id}/abandon` | — | `Snapshot` |
| `GET` | `/api/v1/app/version` | — | `{ versionCode, versionName, sha256, notes }` |
| `GET` | `/api/v1/app/apk` | — | the signed APK, behind the same auth |

**A client picks a move by index into `legal`, never by describing one.** This is §1's rule made
structural rather than merely checked: there is no way to write down a move the engine did not
offer, so a forged request cannot be expressed at all, and the API validates a two-field object
instead of restating the whole `Action` union in Zod — the very duplication this document exists to
prevent. `basedOn` is the `beats.seq` the client drew its board from; when it no longer matches, the
game has moved on and the same index now means a different move, so the tap is refused (`stale`)
rather than guessed at.

The deck endpoints are **not built yet** — nothing consumes them until the Android app exists, and
an endpoint without a consumer rots. Everything else in the table is live.

There are deliberately **no** endpoints for editing decks, the collection, prices, scanning or the
cart. The Android app is arena plus read-only decks; anything else is a deep link into the web app.

Card art is **not** proxied. Both clients fetch it straight from the three CDN hosts already listed
in `next.config.ts`, which are public and need no credentials.

## 6. Watching Claude think

A Tournament turn can take Claude most of a minute, and today the web board simply holds a pulsing
dot for all of it and then jumps. The contract fixes that for both clients with one mechanism:

- `POST .../actions` applies **your** move and returns immediately, with the beats your move
  produced. It does not wait for Claude.
- `POST .../advance` runs Claude's decisions. `advance()` already writes each `applyToGame` to the
  database as it goes, so the work becomes visible while it is still happening.
- `GET .../games/{id}?sinceBeat=N&wait=25` **long-polls**: it returns the moment `beats.seq > N`, or
  after `wait` seconds with `{ beats: null }`. The client re-issues.

So a client fires `advance` on one connection and long-polls on another, and Claude's charge, plays,
attack and combo arrive as they are decided rather than as one lump. Long-poll rather than SSE
because it survives a phone changing networks mid-turn and needs nothing from the proxy.

Cost note: a long-poll holds a Vercel function for up to `wait` seconds. For one user this is
irrelevant; if it ever is not, the knob is `wait`.

**The web board uses this too**, through `stage/useLiveGame.ts` — the one place either client
reaches `/api/v1` rather than the functions behind it. `act()` still runs the whole opponent turn
before it returns, but `advance` commits each of Claude's moves as it makes them, so polling the row
shows them arriving instead of a pulsing dot for a minute and then everything at once. Verified: a
20-second poll returned in 4.1 s when an action landed, carrying exactly the beats numbered above
the client's mark.

## 7. Versioning and drift

Every payload carries `contract: 1`. It is bumped **only** when a field is removed or its meaning
changes; adding an optional field is not a bump.

- **6 Sep 2026 — additive, no bump.** `docs/arena-workflow-spec.md` Phase 1 added `rejected`,
  `taps.whyByCard`, `SideView.choices`, `prompt.min/max/step/cost` and `owner` on the `skill` beat
  (§3.1, §4). Every one is optional or has a default on the Kotlin side, an older app decodes the
  new payload leniently, and the fixtures were re-emitted (`search.json` is new — a deck search
  mid-skill, so both clients decode the shape a search sheet is built from).

- **7 Sep 2026 — additive, no bump.** 1 v 1 play (§3.3) added `versus` to `mode`,
  `game.you` (required, and the only non-optional addition — a client that
  ignores it behaves as before), `game.p1User`/`p2User`, and the `not_your_turn`
  error code. `waiting`'s vocabulary is unchanged; `"opponent"` simply now covers
  a person. **`beats.art` is now viewer-filtered**, which is a narrowing of what
  a payload carries rather than a change of shape — the field is the same field
  and an older client renders a missing face as a card back. `GameInfo` in
  `Snapshot.kt` grew the three fields and the fixtures were re-emitted, with
  `versus.json` new: a board drawn for p2 with p1's hand hidden and p1's draw
  beat carrying no face.

- `GET /api/v1/health` returns `minClient`, the oldest Android `versionCode` the server will still
  talk to. Below it the app refuses to play and offers the update (`docs/arena-android-spec.md` §8).

**Golden fixtures are the anti-drift mechanism**, not a generated schema. The first draft of this
section proposed defining the payload in Zod and emitting JSON Schema; building it showed that to be
the wrong trade. `BoardView`, `LegalAction` and `Tappable` are large existing TypeScript types —
`LegalAction` is a union over the whole `Action` union — and restating them in Zod would create a
second definition to keep in step, which is exactly the failure this document exists to prevent.
Zod is used for the one thing that genuinely arrives from a network client: the two-field body of
`POST .../actions`.

So instead:

- `contract/fixtures/*.json` hold real snapshots — a card played, a KO, an attack declared, a game
  over — built by the **pure** `buildSnapshot` from the synthetic cards in `scripts/verify-arena.ts`.
  No database, no network, no card art.
- **`npm test` re-emits them in memory and fails on any difference**, naming the file and telling
  you to run `npm run contract:emit` if the change was deliberate. A shape change then shows up as a
  readable diff in review rather than at runtime on a phone.
- The Android build reads these same committed fixtures and asserts its `kotlinx.serialization`
  classes round-trip them. A server change that breaks the app breaks the app's build, not a game.

If Kotlin codegen is ever wanted, `ts-json-schema-generator` can be added then. It is not needed to
hold the line.

## 8. Errors

```json
{ "error": { "code": "illegal_action", "message": "that card is already rested" } }
```

`illegal_action` · `not_your_turn` · `game_over` · `not_found` · `stale` · `contract_mismatch` ·
`ai_error`. `not_your_turn` is a 1 v 1 answer: the move is real and the board is
current, but it belongs to the other seat. `IllegalAction` from the engine maps to `illegal_action` with the engine's own
message, which is written to be read by a person — a client shows it and re-syncs, never guesses.

## 9. Auth

The whole app is behind HTTP Basic Auth in `src/proxy.ts`, whose matcher exempts only
`/api/sync/*`. **`/api/v1/*` is therefore protected already** and must stay that way — do not add it
to the matcher's exemption list for any reason.

The Android app sends the same `Authorization: Basic …` header. That is deliberate: `currentUser()`
in `src/lib/auth/index.ts` reads it, `app_users` rows keep working, and no second auth surface is
invented for one user. What the app owes in return is in `docs/arena-android-spec.md` §9 —
Keystore-backed storage and an optional biometric gate.

If per-device revocation is ever wanted, the bounded step is a `device_tokens` table checked in
`proxy.ts` alongside `app_users`. Not now.

Since 1 v 1 (§3.3) the login is no longer only a door: `currentUser()` decides
which chair a request sits in. **With the app running open — no `BASIC_AUTH_*`,
no `app_users` rows — there is no identity, and `seatOf` deliberately lets
everything through**, because refusing would lock the owner out of his own
laptop and stop `npm run arena:playthrough` dead. That hole is exactly as wide
as the open-dev hole in `proxy.ts` and no wider: with either credential source
configured, a 1 v 1 is closed to everyone but its two seats.

## 10. Latency — measure before optimising anything

The Android app is a thin client, so every tap is a round trip. **Settled:** Neon is in
`eu-central-1` (AWS Frankfurt) and `vercel.json` now pins functions to `fra1`, which is co-located
with it. That pin previously lived only in the Vercel dashboard, where nothing in the repo recorded
it and nothing would catch it drifting back to the `iad1` default — which would have put the
Atlantic in the middle of every database round-trip.

Budget to hold, once regions agree: **one round trip per action**, snapshot returned by the same
`POST`. Never two.
