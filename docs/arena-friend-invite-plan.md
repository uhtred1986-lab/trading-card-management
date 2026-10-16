# Plan: invite a friend to a 1 v 1 from the Arena, with a token-only login

Status: **built on branch `arena-friend-invite`** (16 Oct 2026; PR open, see the PR for what was and was not tested). Not yet a GitHub issue or an
`docs/arena-backlog/<id>.md` entry: file it per `docs/arena-backlog.md` §5 before building.
Owner's wording: from the Arena launch screen, invite a friend to a match; the friend needs a
login, so send a token-only login that is super easy; from the phone, send it over WhatsApp.
Owner's answer on decks (16 Oct 2026): the friend picks from decks the owner marks **shareable**.
Owner's answer on accounts (16 Oct 2026): an invited friend becomes a **full user** (a normal
player in Settings → Users), not a throwaway guest.

## What already exists (verified in the code, 16 Oct 2026)

| Piece | Where | Behaviour |
|---|---|---|
| Player + one-time code | `src/lib/auth/access.ts` `createPlayer`, `issueJoinCode` | 6-char code, SHA-256 stored, 24 h, single use, one open code per player |
| Join page | `src/app/join/page.tsx` | `GET /join?c=CODE` only **previews** the name (`previewJoinCode`); nothing is spent |
| Redeem | `src/app/api/join/route.ts` (POST) | "Yes, that's me" spends the code, makes a `player_devices` row, sets `dbs-player` cookie, **303 to `/`** |
| Link builder | `src/lib/auth/join-url.ts` `joinUrl(origin, code)` | `/join?c=CODE` |
| Settings flow | `src/app/settings/access/actions.ts` `createPlayerAction`, `newJoinCodeAction` | `requireSl()`; returns `{code, url, expiresAt}` |
| 1 v 1 | `src/lib/arena/matches.ts` `openMatch`, `joinMatch`; `src/app/arena/actions.ts` `startGameForm`, `joinMatchForm` | host opens a match and waits; guest picks a deck on `/arena/match/[id]` |
| Share UI | `src/components/arena/InviteShare.tsx` | `navigator.share`, else copy; link carries **no token** |
| Launch screen | `src/app/arena/page.tsx` | `canVersus`, `versusNote="Needs a second login: add one under Settings → Users."` |

So a friend can already play if an SL first creates a player in Settings, copies a code, sends it,
and then separately sends the match link. The work is joining those steps into one.

## Two things the owner did not ask about but that decide the design

1. **A player's identity is their `owner` string, and it is not unique.** `src/lib/auth/index.ts`
   sets a code-player's `login` and `owner` both to `players.owner`; `matches.host_user` /
   `guest_user`, deck visibility (`currentScope`) and `assertOwnDeck` all key on it. `createPlayer`
   does not check uniqueness. If an invited friend is typed in as "Pat" and `owner` defaults to the
   name, they would **see Pat's cards and decks**. The friend is a full user (owner's call), so the
   typed name stays as `owner`, but the invite must **refuse a name already in use** (compared
   case-insensitively) as a `players.owner`, `decks.owner` or `owned_cards.owner`, unassigned owners
   included, and ask for another (an initial is enough). **Check:** whether the board
   labels the opponent by `name` or by `login`; here both equal `owner`, so the friend shows up as
   their real name. Do not weaken the uniqueness check.
2. **Redeeming a code drops the friend on `/`, not in the match.** An already signed-in person
   opening `/join` is sent home by the proxy (`ProxyDecision "home"`), so the single link below is
   only for a **new** friend. Someone who already has a login keeps using the existing
   `/arena/match/[id]` link from `InviteShare`.



## Design

**One link, one tap, lands in the match.**

1. **Host (an SL) on the match waiting screen** (`src/app/arena/match/[id]/page.tsx`, the `mine`
   view; the launch screen's "A friend" already routes there): new button **Invite a friend by
   WhatsApp**. First time: asks the friend's name. Calls a new server action that, in one step,
   creates the player (the name must be free, see above), issues a join code and returns
   `/join?c=CODE&next=/arena/match/ID`. Later taps on the same match reuse the player and mint a
   fresh code (the old unused one is deleted by `issueJoinCode`).
2. **Share.** Client component next to `InviteShare`: `navigator.share({ text, url })` on phones, so
   WhatsApp is one tap in the share sheet. Fallback for desktop: `https://wa.me/?text=<encoded>`
   plus a Copy button. Text names the host, the time limit (24 h) and says it works once.
3. **Friend taps the link.** `/join` shows "You are joining as {name}" (existing). The hidden form
   carries `next`. `POST /api/join` redeems as today, then redirects to `next` **only if it matches
   `^/arena/match/\d+$`**, otherwise `/`. No open redirect.
4. **Deck pick.** The match page already lets a guest choose a deck. For a guest with no decks it
   shows the host's **shareable** decks (below) plus their own. `joinMatch` allows a deck the guest
   does not own only if `decks.shareable` is true **and** `decks.owner` equals the host's owner
   (SL-owned decks: to be confirmed). Their own decks stay private and unchanged.
5. **Shareable flag.** New `decks.shareable boolean not null default false` (additive migration via
   `npm run db:generate`; read the SQL; stop on anything destructive). A toggle on the deck page.
   Only the owner or an SL can set it.

## Files expected to change

- `src/db/schema.ts` and a generated `drizzle/00xx_*.sql` (one column).
- `src/lib/auth/access.ts`: `createInvitedPlayer` (refuses a taken owner name) and a combined invite helper.
- `src/lib/auth/join-url.ts`: optional `next`; `src/app/join/page.tsx`: pass `next` through;
  `src/app/api/join/route.ts`: validated redirect.
- `src/app/arena/actions.ts` (or a new `invite-actions.ts`): `inviteFriendAction(matchId, name)`,
  starting with `requireSl()` and checking the caller is the match host.
- `src/lib/arena/matches.ts` `joinMatch`: the shareable-deck exception. `src/lib/auth/ownership.ts`
  is **not** loosened; the exception lives only in `joinMatch`.
- `src/components/arena/WhatsAppInvite.tsx` (new); `src/app/arena/match/[id]/page.tsx`: render it
  and list host-shareable decks for the guest; the deck page: the toggle.
- `docs/architecture/auth.md` and `docs/architecture/arena.md`: one paragraph each. No glossary
  change (the engine does not change).

## Acceptance

- An SL on the waiting screen can create and share an invite in at most two taps after naming the
  friend once; on a phone the share sheet offers WhatsApp.
- A friend with no account taps the link, confirms once, and arrives on that match's deck picker
  already signed in on that phone.
- The friend sees only the host's shareable decks and their own, never another owner's cards, and
  never a non-shareable host deck. The server refuses a forged `deck` id for a non-shareable deck.
- `next` accepts only `/arena/match/<digits>`; anything else goes to `/`.
- A code still works once, for 24 h, and a link-preview fetch (`GET /join`) does not spend it.
- Inviting a friend under a name already in use is refused with a clear message, so nobody can
  see another owner's or the host's data.
- A player (not an SL) cannot call the invite action.

## Tests to write

- PGlite (`scripts/verify-db.mts` style, no Neon): create the invited player, taken-name refusal,
  redeem, `next` validation table, `joinMatch` with a shareable and a non-shareable host deck, and
  with a deck of a third owner. Add to the `npm test` chain.
- Browser (`scripts/lib/cdp.mts`, 390 px, touch): invite button, share fallback link text, guest
  deck picker showing only allowed decks. `npm test` currently stops at
  `scripts/verify/guards.ts` on `main` (16 Oct 2026); run the later steps individually.

## Risks and open questions

- **Rate limit and previews.** WhatsApp fetches links for its preview from its own servers;
  `joinAttemptAllowed` counts a `GET /join` per IP key, so a burst of previews could limit a real
  join. Probably harmless; verify `join-flow.ts` before relying on it.
- **Full users** (owner's call): the friend appears in Settings → Users like any player, keeps
  their own cards and decks, can be renamed or removed there, and gets a new code for a new phone
  from Settings. Nothing expires. Out of scope: a self-service way to re-link a lost phone.
- **Not yet checked:** where the deck toggle goes (the deck detail page file) and whether SL-owned
  decks count as the host's for the exception.
- **Production needs the migration**, which only a deploy of `main` runs
  (`scripts/vercel-build.mjs`); the owner decides when to merge. The column is additive.
- Everything above is unbuilt and untested. No code was changed for this plan.
