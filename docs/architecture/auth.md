# Auth: Google for SLs, codes for players

*4 Oct 2026. Ported from gullet-cove-dm (`docs/architecture/auth.md` there). This page documents
what exists today; what is still to come is at the end.*

## Who gets in

- **SLs (admins) sign in with Google** at `/login`. The owners are the verified addresses in
  `SL_EMAILS` (comma-separated, trimmed, lower-cased); further SLs are rows in `sl_accounts`, added by
  an owner in Settings → Users & access. Anyone else is refused in words and nothing is stored about
  them. The session is checked against both on every request, so removing an SL signs them out on
  their next request (at once on the instance that removed them, within 30 seconds elsewhere).
- **Players join with a code.** An SL makes one in Settings → Users & access: six characters from
  `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, **single use, valid 24 h**, shown large with a QR of
  `/join?c=CODE`, "Send invite" (the share sheet, or copy) and "Copy link". **Only the code's SHA-256 is
  stored**; after a reload the row says a code is open, without the letters. A new code deletes the
  player's unused one. On the phone, `/join` shows "You are joining as *Name*"; only "Yes, that's me"
  (a form post to `/api/join`) spends the code and makes the device — one conditional UPDATE, so two
  phones racing on one code get one device. A wrong, spent or expired code all get the same sentence.
- **The device stays signed in for 180 days**, sliding (re-issued once a day old). "Disconnect" (the SL,
  or the player on `/me` for their other devices) and "Sign out of this device" revoke the device row;
  its next request is refused and it needs a new code. Removing a player deletes their codes and
  devices (cascade); their cards and decks stay, listed under Unassigned.
- **Basic Auth still works beside both** while everyone moves: the `BASIC_AUTH_USER` /
  `BASIC_AUTH_PASSWORD` pair is an SL; an `app_users` login is a player, or an SL when listed in
  `ARENA_ADMINS`. With Google set up, a signed-out page goes to `/login`, whose "Sign in with password"
  link is `/password-login` (a route that answers with the Basic popup until the credentials check out,
  then goes home — at the root because a browser re-sends Basic credentials only below the directory
  that asked). Migration 0042 copied every `app_users` login into `players` under the same owner name.
- **Local dev with nothing configured runs open**, and everyone is an SL with no owner name.

## Who sees what

| | SL | Player |
|---|---|---|
| Collection, cards, decks, add, scan, leaders, cart, wants, dashboard | everyone's (owner filter on the collection) | **their own only** |
| AI features (deck analysis, wizard, scan, "Build a deck with Claude", cart explainer) | yes | yes, on their own decks and cards |
| Arena: play, 1 v 1, report a bug | yes | yes, with their own decks; games whose first deck is theirs, and their 1 v 1 seats |
| Settings (sync, AI providers, locations, users & access), arena rules workbench, rule review, feedback, debug, set review, cart shipping settings | yes | no — `/me` instead of Settings |

**Owner names are the boundary.** Every lot, deck, scan batch and want carries an `owner` name. A
player's is `players.owner`; an SL's is their `sl_accounts.owner`, else `BASIC_AUTH_USER`, else their
address (`defaultSlOwner`). `currentScope()` is the looker's `OwnerScope`
(`src/lib/collection/scope.ts`): a player's owner name, or `undefined` (everyone's) for an SL. Every
collection, deck, reservation, location-count, leader and want read takes it; **a built deck reserves
only its owner's copies** (`collection-and-decks.md`). Lots and decks under a name nobody uses (or none)
are listed under **Unassigned** for SLs, with "Give to player…" (`reassignOwner`).

## The guards

The proxy is the first lock, not the only one: a Server Function is a public POST endpoint whose id is
in the JS, and a player has *a* session. So **default deny, on the server**:

- **Every exported function of every `"use server"` file** opens with `await requireSl()` or
  `await requireSignedIn()` (`src/lib/auth/index.ts`; both throw `AccessDenied`), and then, when it
  takes an id, `assertOwnLots` / `assertOwnDeck` / `assertOwnBatch` / `assertOwnScanItem` /
  `assertOwnSuggestion` / `canOpenGame` (`src/lib/auth/ownership.ts`). A player's new rows always
  carry their own owner name (`ownerFor`); re-owning lots is SL-only.
- **Every `page.tsx`** opens with `await requireSlPage()` (a player goes home, nobody to `/login`) or
  `await requireSignedInPage()`; every page under an SL-only path (`isSlOnlyPath`) uses the SL one.
- **Every route handler under `src/app/api`** opens with `routeViewer()` (401 nobody, 403 a player on an
  SL route); an arena game a player may not open answers `not_found`.
- **`scripts/verify/guards.ts`** (in `npm test`) fails on any of these missing. Its exemptions are named
  with their reason: `signOut`, `/login`, `/join`, the cron and agent-sdk routes (bearer secrets), the
  sign-in routes, `/api/join` (rate-limited, the code is the credential), `/api/v1/health` (no data) and
  `/password-login` (checks the credentials itself).

`getViewer()` is worked out once per request (React `cache`), from the cookies and headers — never
trusted from the proxy — and re-reads the device row (and touches `last_seen_at` once a minute).

## The pieces

| File | What it does |
|---|---|
| `src/lib/auth/core.ts` | The pure half: `SL_EMAILS`, sign/verify the SL session, flow and player cookies, sliding expiry, `isPublicPath`, `isSlOnlyPath`, `decide()` (the proxy's decision as data), `publicOrigin`, `defaultSlOwner`. Tested by `scripts/verify/auth.ts`. |
| `src/lib/auth/join-code.ts`, `join-url.ts` | Codes, device tokens, hashes, the rate limit's key and numbers, device labels, the invite URL. |
| `src/lib/auth/access.ts` | The database half: SL accounts, players, codes (issue, preview, redeem), devices (resolve, revoke, list), the admin overview, unassigned owners, `reassignOwner`, the rate limit. Tested on PGlite by `scripts/verify-access-db.mts`. |
| `src/lib/auth/index.ts` | `getViewer()`, `currentUser/Owner/Scope()`, `isArenaAdmin()`, and the guards. |
| `src/lib/auth/ownership.ts` | "Is this yours?" for ids from the browser, and `canOpenGame`. |
| `src/lib/auth/proxy-checks.ts` | The proxy's cached database checks (added SLs, live devices), 30 s per instance. |
| `src/lib/auth/google-oauth.ts` | Google on `openid-client`: PKCE S256, `state`, `nonce`, the ID token's claims, then the SL check. |
| `src/lib/auth/basic.ts` | The old Basic Auth check, for the proxy and `/password-login`. |
| `src/proxy.ts` | Runs `decide()` on every request; re-issues the SL and player cookies for sliding expiry (never on a Server Function call). |
| `src/app/login/`, `src/app/join/`, `src/app/me/` | The sign-in page and `signOut`; the join page; a player's own page. |
| `src/app/api/auth/*`, `src/app/api/join/route.ts`, `src/app/password-login/route.ts` | Google's start and callback; the code's redeem; the Basic popup on demand. |
| `src/app/settings/access/` + `src/components/settings/AccessAdmin.tsx` | Settings → Users & access. |

Libraries: `openid-client` 6, `jose` 6 and `uqr` (the QR, as SVG), the same as gullet-cove-dm. No OAuth,
JWT or QR code is written by hand.

## The cookies

- **`dbs-session`** (SL): a JWT (HS256, `AUTH_SECRET` of at least 32 characters) whose own claims are
  only `{ role: "sl", email }`. 30 days, re-issued once a day old.
- **`dbs-player`** (device): `{ role: "player", playerId, deviceId, tok }` with its own audience, so it
  can never pass as an SL session nor the reverse. `tok` is 32 random bytes; `player_devices.token_hash`
  holds only its SHA-256. 180 days, re-issued once a day old.
- **`dbs-oauth`**: the OAuth round trip's `state`, PKCE verifier and nonce, 10 minutes, `Path=/api/auth`.

All `HttpOnly`, `SameSite=Lax`, `Secure` in production.

## What the proxy does (`decide()`)

An SL session passes (`/login` and `/join` send it home). A player whose device is live passes, except
that an SL-only page sends them home and an SL-only API or action gets a 403. A Basic Auth header the old
checks accept passes. With nothing configured at all everything passes (local dev). The public paths
pass (`/login`, `/join`, `/api/join`, the Google routes, `/password-login`, the manifest, `/sw.js`,
`/icons/*`), but a **Server Function posted to a public path is refused**. Without Google the browser gets
the Basic popup; with Google a page redirects to `/login` and an API route or Server Function call gets a
401. The matcher skips static files, `/api/sync/*` and exactly `/api/ai/agent-sdk`; a second entry sends
every request carrying `Next-Action` through the proxy, whatever its path.

## The join rate limit

`/join`'s lookup and `/api/join`'s redeem each record a row in `join_attempts` keyed by an HMAC of the
caller's IP (`x-real-ip`, else the first `x-forwarded-for`; the address is never stored) and refuse over
**10 a minute or 50 an hour**; rows older than an hour are pruned on every write. It fails closed.

## Environment

`AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SL_EMAILS` — all four, or Google sign-in
stays off (`/login?error=config` says so). Player codes need only `AUTH_SECRET`. The Google OAuth client
(project `dbs-card-companion`) has the redirect URIs
`https://trading-card-management.vercel.app/api/auth/callback/google` and
`http://localhost:3000/api/auth/callback/google`. Keep `BASIC_AUTH_*` until every player has joined with
a code; an SL with no `sl_accounts` row acts under `BASIC_AUTH_USER`.

## Still to come

1. **Passkeys** for SLs (`sl_passkeys`, `@simplewebauthn`), as in gullet-cove-dm.
2. **Basic Auth removed**, with `app_users`, `/password-login`, `/settings/users` and `ARENA_ADMINS`,
   once every player has a device.
