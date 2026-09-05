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

The contract is enforced at the **function** boundary, not the HTTP boundary. A new module holds it:

```
src/lib/arena/session.ts
  snapshotOf(db, gameId)           → Snapshot
  applyAction(db, gameId, action)  → Snapshot      // wraps applyToGame
  advanceSession(db, gameId)       → Snapshot      // wraps ai/run.ts advance
  waitForBeats(db, gameId, since, timeoutMs) → Snapshot | null
```

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
    mode: "hotseat" | "sparring" | "tournament";
    status: "playing" | "over" | "abandoned";
    turn: number;
    p1Name: string;
    p2Name: string;
  };
  /** src/lib/arena/view.ts — unchanged, already carries per-card art. */
  view: BoardView;
  /** src/lib/arena/engine — unchanged. The only moves that exist. */
  legal: LegalAction[];
  /** src/lib/arena/view.ts — legal indexed by the card each move names. */
  taps: Tappable;
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

## 4. `Beats` — the animation stream

The engine's own comment on `GameEvent` says *"Append-only log; the UI animates from these"*. Today
those events die inside `apply()`. The contract is where they finally get out.

```ts
export type Beat =
  | { t: "phase"; phase: string; player: PlayerId; turn: number }
  | { t: "draw"; player: PlayerId; card: string | null }
  | { t: "move"; card: string; from: Area; to: Area; owner: PlayerId }
  | { t: "mode"; card: string; mode: "active" | "rest" }
  | { t: "flip"; card: string }
  | { t: "markers"; card: string; delta: number; total: number }
  | { t: "attack"; attacker: string; target: string }
  | { t: "block"; guard: string; by: string }
  | { t: "clash"; attackPower: number; guardPower: number; hit: boolean }
  | { t: "damage"; player: PlayerId; amount: number; critical: boolean }
  | { t: "ko"; card: string }
  | { t: "negated" }
  | { t: "skill"; card: string; label: string; text: string; unread: boolean }
  | { t: "say"; text: string }
  | { t: "over"; winner: PlayerId | null; reason: string };

export interface Beats {
  /** Monotonic. A client replays only what is above the seq it last played. */
  seq: number;
  list: Beat[];
  /** Face and name for every card a beat names — see below. */
  art: Record<string, { cardId: string; name: string; imageUrl: string | null }>;
}
```

Three properties the clients depend on, all of which are the server's job:

- **A beat names an instance id**, the same id `view` uses. The web board already writes
  `data-arena-card={id}` into the DOM and Android will key its composables the same way, so a beat
  can always be aimed at a real rectangle.
- **Beats carry their own faces.** A card KO'd during Claude's turn is gone from the `view` the
  server renders, so a client cannot look it up. `art` is resolved server-side from the same query
  the page already runs.
- **`toBeats` is exhaustive over `GameEvent`.** Adding an engine event becomes a compile error in
  `src/lib/arena/beats.ts`, so the UI cannot silently stop showing something the rules do. Events
  with no picture (`effect`, `stack`, `hidden`, `note`) map to nothing, deliberately.

Storage: one `beats jsonb` column on `arena_games`, beside the existing `spotlight` precedent,
appended by `applyToGame`, capped at the last 300, and **cleared when you act** — so the queue holds
exactly one story: your move, then everything the server did in reply. One migration, `0024_*`,
generated with `npm run db:generate` and never hand-numbered: `db:migrate` runs against production
before every Vercel build, so a duplicated number breaks all deploys.

## 5. Endpoints — `/api/v1/`

Only the Android app uses these; the web board calls §2 directly.

| Method | Path | Body / query | Returns |
|---|---|---|---|
| `GET` | `/api/v1/health` | — | `{ contract, minClient, latestClient, serverTime }` |
| `GET` | `/api/v1/decks` | `?game=dbs` | deck list: id, name, leader art, built/virtual, legality, playable |
| `GET` | `/api/v1/decks/{id}` | — | deck detail: zones, counts, per-card flags — **read-only** |
| `GET` | `/api/v1/games` | `?limit=20` | game list, as `/arena` shows it |
| `POST` | `/api/v1/games` | `{ p1DeckId, p2DeckId, mode, debug }` | `{ id }` |
| `GET` | `/api/v1/games/{id}` | `?sinceBeat=N&wait=25` | `Snapshot` — §6 |
| `POST` | `/api/v1/games/{id}/actions` | `{ action, sinceBeat }` | `Snapshot` |
| `POST` | `/api/v1/games/{id}/advance` | — | `Snapshot` once Claude has finished deciding |
| `POST` | `/api/v1/games/{id}/abandon` | — | `Snapshot` |
| `GET` | `/api/v1/app/version` | — | `{ versionCode, versionName, sha256, notes }` |
| `GET` | `/api/v1/app/apk` | — | the signed APK, behind the same auth |

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

## 7. Versioning and drift

Every payload carries `contract: 1`. It is bumped **only** when a field is removed or its meaning
changes; adding an optional field is not a bump.

- `GET /api/v1/health` returns `minClient`, the oldest Android `versionCode` the server will still
  talk to. Below it the app refuses to play and offers the update (`docs/arena-android-spec.md` §8).
- The shapes in §3 and §4 are defined once, as **Zod schemas** in `src/lib/arena/contract.ts` —
  `zod` is already a dependency and the AI code already parses with it. The TypeScript types are
  inferred from the schemas, so there is no second definition to forget.
- `scripts/emit-contract.mts` writes `contract/arena-v1.schema.json` and a set of golden fixtures
  (`contract/fixtures/*.json`) captured from `npm run arena:playthrough` — a real snapshot mid-battle,
  one with a KO, one mid-counter-window, one game over.
- **`npm test` fails if the committed schema differs from the emitted one.** That is the whole
  anti-drift mechanism: you cannot change a shape without the diff showing up in a review.
- The Android build reads the same committed fixtures and asserts its `kotlinx.serialization`
  classes round-trip them. A server change that breaks the app breaks the app's build, not a game.

## 8. Errors

```json
{ "error": { "code": "illegal_action", "message": "that card is already rested" } }
```

`illegal_action` · `not_your_turn` · `game_over` · `not_found` · `contract_mismatch` · `ai_error` ·
`unauthorized`. `IllegalAction` from the engine maps to `illegal_action` with the engine's own
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

## 10. Latency — measure before optimising anything

The Android app is a thin client, so every tap is a round trip. Before either client is tuned,
confirm where the time actually goes: **`vercel.json` sets no region**, so functions default to
`iad1` (US East) while Neon may well be in the EU. If so, every arena action crosses the Atlantic
twice, and `export const preferredRegion` on the `/api/v1/*` routes plus the arena pages is a
one-line change worth more than every animation in both specs.

Budget to hold, once regions agree: **one round trip per action**, snapshot returned by the same
`POST`. Never two.
