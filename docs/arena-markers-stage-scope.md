# Markers, tokens and [Empower] — what exists, what does not, what to build

Written 9 Sep 2026, after the owner's ruling of the same day and a read of the
rule manual. **The headline is that most of this already works.** An earlier note
in `docs/arena-next-session-prompt.md` said "none of it exists"; that was wrong,
taken from a scoping summary rather than from the engine, and this document
replaces it.

## 0. The three things that must not be conflated

The rules give three separate concepts and the engine keeps them apart. Any work
here has to keep doing so.

| | what it is | where it lives |
|---|---|---|
| **Markers** | counters on a Unison or Z-Unison tracking its status (1-11-1). Not cards. Tracked as a positive whole number (1-11-2). | `CardInstance.markers` |
| **Tokens** | real Battle Cards a skill puts on the board — Shadow Dragon, Clone, Earthling. | the `token` op, `isToken` on the instance |
| **Energy markers** | used *in place of* energy when paying a cost (1-14-1). In the Energy Area, but "aren't treated as cards or energy" (1-14-3). Removing one is equivalent to resting one energy card (1-14-2). | the `energyMarker` op, `pm.markers` |

The owner's ruling of 9 Sep 2026 draws the first two distinctions explicitly. The
third is the manual's and is the one most likely to be lost by accident, because
the word "marker" appears in all three.

## 1. Engine mechanics — what is already true

**Markers on play are correct, and match the manual and the ruling.**
`engine.ts:2615` plays a Unison with `markers: pm.rest.length + pm.markers` — the
number of energy cards switched to Rest Mode, plus energy markers spent, which
1-14-2 says are equivalent. That is 13-2-1-3 exactly: "The Unison Card enters play
with a number of markers on it equal to the number of energy cards switched to
Rest Mode to play the card." It is the **total** paid, not the specified part —
the owner's first note said "specified energy paid" and their second corrected it;
the manual agrees with the second.

**[Empower] works, with one stated approximation.** `resolvePlay`
(`engine.ts:626-641`) reads the keyword before the old Unison leaves — because
leaving clears its markers (5-13-3) — checks the colour (any colour when the
keyword names none, 22-45-3-2), carries `min(Y, old.markers)`, and adds them to
the markers bought with energy. That is 22-45-3 and 13-2-1-3-1.

**[Spirit Boost] works.** `engine.ts:992` gates the skill on the Unison having at
least X markers, `engine.ts:1003` removes them as the cost. 22-43.

**The rest of the marker economy exists**: growth and marker skill costs
(`engine.ts:1101`), a Unison at zero markers leaving play (`engine.ts:521-526`,
3-4-1), markers removed in battle including [Victory Strike] taking the guard's
count (`engine.ts:1245`), [Rejuvenate] paying with them (`engine.ts:2201`).

**The board already shows them.** `view.ts:38/335` carries `markers` into the
board view, `ArenaCard.tsx` renders it, `narration.ts` narrates the `markers`
beat, and `motion.ts` knows about them.

## 2. Where it actually breaks

Four gaps, none of them the foundational work the earlier note implied.

1. **"Up to Y" is not a choice.** 22-45-3 says you *may* add up to Y markers;
   the engine carries as many as it can (`Math.min`). The glossary already admits
   this in its `engine` line and rates [Empower] `partial`, which is the honest
   state — but it is a decision the rules give the player, and it can matter:
   a threshold skill ("if this card has 3 or more markers"), or wanting to leave
   the old Unison's markers behind rather than move them. Fixing it means a
   prompt inside `resolvePlay`, which is reachable from a flow step, so unlike
   the replacement problem in `move()` this one is buildable.
2. **`[Empower XY/ZY]` cannot be parsed.** `keywordOf` (`cards.ts:217`) reads
   `^empower(?: ([a-z]+))?(?: (\d+))?$`, so a two-colour form fails on the slash.
   22-45-3-1 defines it and says you choose one of the colours. **No card in this
   catalog prints it**, so this is theoretical until one does — worth a comment,
   not a build.
3. **The specified-cost reduction was unimplemented; it is built as of 12 Sep
   2026, bar its baseline** (issue #96, step A below). Per the owner's ruling of
   9 Sep 2026, "reduce the specified cost of this card in your hand by {u}"
   relaxes only the **colour requirement** (2 blue down to 1 blue); the total is
   X and the player chooses it. Markers then follow what was actually paid, so
   paying less means arriving with fewer — which is the interaction that makes
   this worth doing carefully rather than as a compiler one-liner. Seven clauses
   print it: BT19-039, BT19-040, BT15-063, BT20-118, P-673, P-600, BT25-004.
   `costReduction`'s `what: "specified"` and the `playCost` arithmetic that
   subtracts from the coloured requirement alone — the same shape the [Warrior of
   Universe 7] branch has — now run for real: the menus, `apply` and the `whyNot`
   twins read the coloured requirement instead of an assumed `{}`, and a Unison
   still arrives with markers equal to the total rested.

   What none of that can reach is **the printed baseline of an X cost**. The
   deckplanet feed carries no cost orbs on any card — `card_energy_cost` is a
   bare number, `"X"` or blank across all 6,493, and the orb images live only in
   skill text — so nothing says BT19-039's requirement is 2 blue rather than 1 or
   3. The fixed-cost convention (one orb per colour) would say 1 and the owner's
   ruling says 2, so it is refused rather than stretched: `specifiedCostOf`
   answers `{}` for an X cost unless the def carries `specifiedCost`, and
   `npm run arena:specified` re-checks the feed and lists the cards waiting. The
   price charged is therefore lenient on those seven, not wrong, and becomes
   exact the day a baseline exists to read.
4. **"For each marker" was fixed on 9 Sep 2026** (lane 3, merged) — BT27-003 to
   BT27-006 had been reading a flat +5000 with no markers on the board. Named
   here only so nobody re-finds it.

## 3. Board and animation

What exists: the count reaches the client and is drawn, and a `markers` beat is
narrated. What is missing is that **inheritance is not visibly inheritance** —
[Empower] emits one `markers` beat with the final total on the new card, and a
`move` of the old Unison to the Drop. Nothing says the markers came *from* the
card that just left, which is the whole feel of the keyword.

If this is built, the honest shape is a beat that names both cards, so the board
can fly the markers across rather than count them up in place. Note the two
constraints the arena's own specs impose: everything the board draws comes from
one `Snapshot` (`docs/arena-client-contract.md` is read first, and a `Snapshot`
shape change is a contract change), and `maskBeats` must not leak anything a
viewer may not see — marker counts on a Unison are public, so this is a small
change, but it is a contract change and belongs in `contract:emit`.

## 4. Cost and sequencing

Nothing here is a single stage, and none of it blocks the compiler work.

| step | what | size | independent? |
|---|---|---|---|
| A | `what: "specified"` on `costReduction` plus the `playCost` branch — 7 clauses. **Done 12 Sep 2026 except the baseline**, which the catalog cannot supply (see §2 item 3); a follow-up has to enter the orbs by hand or read them off Bandai's art | small | yes |
| B | the "up to Y" prompt in `resolvePlay` | small-medium | yes |
| C | an [Empower] beat naming both cards, and the board animating the carry | medium — touches `Snapshot`, so `contract:emit` and the Android contract | after B, ideally |
| D | `[Empower XY/ZY]` parsing | trivial | yes, and pointless until a card prints it |

Recommended order: **A**, because it is the owner's open ruling and the only one
with cards waiting on it; then **B**, which is a rules correctness fix; then **C**
if the board is worth the contract change. **D** when a card needs it. A is built
as of 12 Sep 2026 and the seven cards still wait — on their cost orbs, not on the
engine — so the next thing here is B.

What this document deliberately does not propose: rebuilding marker handling. It
works. The temptation to treat this as a greenfield stage came from a summary
that said it did not exist, and the cost of believing that would have been
rewriting `resolvePlay` around a bug that is not there.
