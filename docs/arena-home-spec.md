# Arena home: Play and the Rules Workbench

Owner's brief, 30 Sep 2026. The Arena's pages outside the board had grown to ten routes, one per
PR, and no longer read as a product. This brief narrows them to **two jobs, two doors**: *play a
game* and *fix a card*. The board itself is out of scope here; that is
`docs/arena-board-redesign-spec.md` (milestone M16).

**Design frames:** the "DBS Arena Redesign" canvas (the same one M16 uses), in two new rows:
- "The phone is the Arena": `PlayPhone`, `MatchPhone`, `GamesPhone`, `GameOverPhone`.
- "On the computer": `PlayDesktop`, `RulesDesktop`.

The canvas is private to the owner, so ask for a share link or screenshots. The frames are the
reference; this file is the brief.

**Milestone:** Arena M17 — Arena home: Play and Rules Workbench (`docs/arena-backlog/ah-*.md`).

## 1. Owner's decisions (30 Sep 2026)

1. **Two doors.** `/arena` is **Play**, `/arena/rules` is **Rules**. Both share one Arena header
   with a Play | Rules switch and a ⋯ menu (Games, Report a problem / feedback, Settings → Arena
   engine, and, for `ARENA_ADMINS`, the admin tools from #350/#351).
2. **Claude up front.** The opponent choice is *Claude · Sparring* (the default), *Claude ·
   Tournament*, and *A friend*. *A friend* covers 1 v 1 on two devices and pass-and-play (today's
   hot-seat) on one.
3. **A deck with an open rule cannot be played.** On the rules engine an `open` row plays as
   blank, so a game with one is not the game on the cards. Play is replaced by **Fix N cards to
   play**, which opens Rules filtered to exactly those cards. The server refuses the same thing,
   for **both** decks: the player's, Claude's, and a 1 v 1 joiner's at join. Drafts do **not**
   block. They play, and the home shows how many are unchecked.
4. **The engine is not a question.** The Engine fieldset leaves the Play form. `defaultEngine()`
   and `engineForMode()` decide, as they already do server-side (#166). The way back to legacy stays
   in Settings. A game on the legacy engine keeps its muted badge in Games.
5. **Delete, don't hide.** `/arena/backlog` is removed. `/arena/rules/all` and
   `/arena/rules/patterns` become scopes and groupings of the one queue at `/arena/rules`, and
   their URLs redirect there.
6. **The phone is the Arena** (owner, 30 Sep 2026: "the phone is really only there for playing").
   On a phone, everything around a game is designed for the phone:
   - landing, deck choice with a look at the cards, opponent, play;
   - continue, games, invitations and joining a friend;
   - game over and rematch;
   - board settings.

   The Rules Workbench, decks, collection and the rest of the app are **made for the computer**.
   On a phone they only have to work (no horizontal scroll, controls reachable); they are not
   redesigned. So on a phone:
   - the Arena gets its own shell, without the app header and tab bar;
   - Rules is not in the Arena's switch, but under ⋯ → *Rules, decks and collection*;
   - a locked deck says *fix it on the computer* and offers **Pick a ready deck** instead of a
     Rules link;
   - the preselected deck is the last-played **ready** deck.
7. **Deck ownership doesn't matter to Rules.** A rule is per card, so the queue and its counts
   cover every deck. The scope is called *All decks*, not *My decks* (#364). Play keeps listing
   the viewer's own decks, as #279 made it.

## 2. What exists and what changes

| Today | Fate | Issue |
|---|---|---|
| `/arena`: one long form (two deck selects, four mode radios, two engine radios, a debug checkbox), then a coverage list with five links, then open matches, then 20 games | **Rebuilt** as Play: deck carousel (phone) or grid (desktop), readiness, opponent, one Play button. Games move behind a Continue strip and a Games list | ah-02, ah-03, ah-05 |
| "First player's deck" / "Second player's deck (ignored in a 1 v 1)" | **Gone.** *Your deck*, plus *Claude plays* when the opponent is Claude | ah-02 |
| Engine fieldset | **Removed** (decision 4) | ah-02 |
| "Record what Claude was shown…" checkbox (default on, shown to everyone) | **Removed from the form.** Recording is on for everyone, and the reading is admin-only (#350) | ah-02 |
| "What the engine reads in each deck": *N put to Claude when they resolve* | **Replaced** by the readiness strip. The old copy is wrong on the rules engine, where an open row plays as blank (`vm/flow.ts`) | ah-03 |
| Game over: stats and "Ask Claude what to learn" | **Adds** Rematch (primary), Change deck, and "N draft rules fired this game" into Rules | ah-04 |
| `/arena/rules` (My decks), `/arena/rules/all`, `/arena/rules/patterns` | **One queue**: *Cards in* (a deck · all my decks · whole catalog · fired in my last game), state (open · draft · confirmed · corrected), *Group by* (nothing · same wording · reason · set) | ah-06 |
| Record: seven buttons of equal weight | **One sticky bar**: the state's primary action, Edit as text, Skip, then an overflow. Three panes and keys `j k c e s /` on the computer; on a phone it only has to work | ah-07 |
| `/arena/rules/keywords`, `/game`, `/language`, "How to fix a card" | **Reference drawer** from the header. `/game` and `/language` are linked from nowhere today | ah-08 |
| `/arena/backlog` | **Deleted.** Nothing links to it. It hard-codes engineering streams that point at closed issues #177, #93 and #107 | ah-09 |
| `/arena/feedback` | Stays. It moves from the Rules tabs to the ⋯ menu | ah-01 |
| Phone chrome on `/arena`: the app header (four 12 px secondary links) and a tab bar with no Arena tab | **Arena shell** on phones. Outside it, the first phone tab is Arena | ah-11 |
| No way to see a deck's cards from the Arena on a phone | **See the cards** sheet, with each card's rule state | ah-12 |
| 1 v 1 guest told to "choose your own deck back on the arena page"; no link to send | **Invite and join** on `/arena/match/[id]`: Share link, deck picker for the guest | ah-13 |
| Board settings (sky/night, pace, staging, haptics) only inside a game | **Board settings** sheet from Play's ⋯ | ah-14 |

## 3. Readiness

A deck's readiness is the count of its **distinct cards** by the worst state among their
`card_rules` rows: open > draft > corrected > confirmed. It is computed in **one** query for all
the viewer's playable decks. Today `/arena` and `/arena/rules` each call `deckInputFor` once per
deck in a loop. The colours are the workbench's existing four, and each state also differs in
shape (a hollow ring for open, a half-filled dot for draft, a filled dot for confirmed), so the
bar never relies on hue alone.

## 4. Rulings since the first draft (30 Sep 2026)

- **Scope by owner** (#364): no. Rules covers every deck (decision 7).
- **Phone entry point** (#365): decided by design. The phone gets an Arena shell, and outside the
  Arena the phone tab bar's first tab is **Arena** (decision 6).
