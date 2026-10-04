# Auth: Google for SLs, codes for players

*4 Oct 2026. Ported from gullet-cove-dm (`docs/architecture/auth.md` there). This page documents
what exists today; the plan for the remaining steps is at the end.*

## Who gets in (step 1)

- **SLs (admins) sign in with Google** at `/login`. Only verified addresses in `SL_EMAILS`
  (comma-separated, trimmed, lower-cased) get a session; anyone else is refused in words and nothing
  is stored about them. Removing an address from `SL_EMAILS` signs it out on its next request — the
  session is checked against the list every time, not only at sign-in.
- **Everyone else still uses Basic Auth** while join codes are built: the `BASIC_AUTH_USER` /
  `BASIC_AUTH_PASSWORD` pair, or a row in `app_users` (`/settings/users`). With Google set up, a
  signed-out page goes to `/login`, whose "Sign in with password" link is `/password-login`: a route
  that answers with the browser's Basic Auth popup until the credentials check out, then goes home.
  It sits at the root because a browser re-sends Basic credentials only below the directory that
  asked for them.
- **An SL acts under the name `BASIC_AUTH_USER`** (`slUsername` in `src/lib/auth/core.ts`): the owner
  used to sign in with that pair, so the cards, decks and games stamped with it stay theirs. Without
  the variable an SL is their address. This goes when SL accounts carry their own owner name.
- **An SL is an arena admin** (`isArenaAdmin()`), whatever `ARENA_ADMINS` says.

## The pieces

| File | What it does |
|---|---|
| `src/lib/auth/core.ts` | The pure half: `SL_EMAILS`, sign/verify the session and flow cookies, sliding expiry, `isPublicPath`, `decide()` (the proxy's decision as data), `publicOrigin`, `slUsername`. No `next/*` imports, so `npm test` runs it (`scripts/verify/auth.ts`). |
| `src/lib/auth/google-oauth.ts` | Google on `openid-client`: discovery (cached per process), `beginSignIn` (PKCE S256, `state`, `nonce`), `completeSignIn` (checks `state`, trades the code with the verifier, checks the ID token, then `SL_EMAILS`). |
| `src/lib/auth/basic.ts` | The old Basic Auth check, shared by the proxy and `/password-login`. |
| `src/lib/auth/index.ts` | What pages and actions call: `currentSession()`, `currentUser()`, `currentOwner()`, `isArenaAdmin()`. No page parses a cookie itself. |
| `src/proxy.ts` | Runs `decide()` on every request and re-issues the cookie for sliding expiry. |
| `src/app/api/auth/login/route.ts` | "Sign in with Google": a redirect to Google plus the flow cookie. |
| `src/app/api/auth/callback/google/route.ts` | Google's redirect back: sets the session cookie or sends the SL to `/login?error=…`. |
| `src/app/password-login/route.ts` | The Basic Auth popup on demand, for logins without Google. |
| `src/app/login/page.tsx`, `actions.ts` | The sign-in page (no app chrome, reads no data) and `signOut`, shown in Settings for a Google session. |

Libraries: `openid-client` 6 and `jose` 6, the same as gullet-cove-dm. No OAuth or JWT crypto is
written by hand. Login start and callback are routes, not Server Functions, because OAuth is a chain
of browser redirects and a signed-out browser may not call a Server Function.

## The cookies

- **`dbs-session`**: a JWT (HS256, `AUTH_SECRET` of at least 32 characters) whose own claims are
  only `{ role: "sl", email }`. `HttpOnly`, `SameSite=Lax`, `Secure` in production, 30 days, re-issued
  by the proxy once it is a day old (sliding). No database row: signing out drops the cookie.
- **`dbs-oauth`**: the OAuth round trip's `state`, PKCE verifier and nonce, signed, 10 minutes,
  `Path=/api/auth`, cleared by the callback either way. Neither cookie passes as the other.

## What the proxy does (`decide()`)

In order: a valid SL session passes (and `/login` sends it home); a Basic Auth header the old checks
accept passes; with nothing configured at all (no Google, no env pair, no `app_users` rows) everything
passes — local dev; the public paths pass (`/login`, `/api/auth/login`, the callback,
`/password-login`, the manifest, `/sw.js`, `/icons/*`), except that a **Server Function posted to a
public path is refused** (Next runs an action on whatever route it is posted to, and every action id
is in the public JS); without Google the browser gets the Basic popup, as before; with Google, a page
redirects to `/login` and an API route or Server Function call gets a 401.

The matcher skips static files, `/api/sync/*` (cron, `CRON_SECRET`) and exactly `/api/ai/agent-sdk`
(`AI_AGENT_SDK_SECRET`). A second matcher entry sends every request carrying `Next-Action` through
the proxy, whatever its path.

## Environment

`AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SL_EMAILS` — all four, or Google sign-in
stays off (`missingAuthConfig` names what is missing, never the values; `/login?error=config` says so).
The Google OAuth client (project `dbs-card-companion`) has the redirect URIs
`https://trading-card-management.vercel.app/api/auth/callback/google` and
`http://localhost:3000/api/auth/callback/google`. Keep `BASIC_AUTH_*` until the steps below land.

## Still to come

1. **Tables and guards**: `sl_accounts` (further SLs added in Settings, each with an owner name),
   `players`, `player_join_codes` (hash only), `player_devices`, `join_attempts`, `sl_passkeys`;
   `requireSl()` / `requireSignedIn()` and their page forms.
2. **Every page, action and route guarded**, with a test that fails the build on a missing guard;
   players see only their own lots; a built deck reserves only its owner's copies.
3. **Settings → Users & access**: players, join codes (6 characters, single use, 24 h, QR and share
   link), devices, SLs, passkeys, unassigned lots.
4. **Basic Auth removed**, with `ARENA_ADMINS`.
