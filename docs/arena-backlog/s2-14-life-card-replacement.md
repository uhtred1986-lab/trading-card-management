---
title: Arena: replace(event: life) — a life card's move as the fourth replacement moment, and the reveal (BT10-031, SD18-01)
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, ready-for-agent, enhancement, area:arena-compiler, area:arena-engine, phase:rules-stage2, model:opus-5
stage: 2
issue: 272
status: closed
closed_at: 2026-09-14
---
**Source:** #107 (owner's decision of 13 Sep 2026: "own scope"); `docs/arena-move-replacement-scope.md` §2.7 (`opts.reveal`) and §6 (why these two cards are not a Battle Area departure); the `replace` op in `src/lib/arena/engine/script-schema.ts` (`event` is the closed list `leave`, `ko`, `play`); `replacementFor` and the two suspendable `move()` sites in `src/lib/arena/engine/state.ts`; `docs/arena-backlog/s2-06-replace-event.md`; rule manual 9-10, 20-11.

**Problem.** BT10-031 and SD18-01 print "During your opponent's turn, if you would add a card from your life to your hand or place it in your Drop Area, you may reveal it and add it to your hand instead." That replaces a **life** card's move, not a departure from the Battle Area, and `replace`'s `event` has no such moment. Both cards are correctly refused today; this is the capability gap, not a wrong reading.

**Build.**
1. **Measure first, in a scope document** — `docs/arena-life-card-replacement-scope.md`, in the shape of `docs/arena-move-replacement-scope.md` §1: every site that moves a card out of the life area (damage, `addLife`/`lifeDownTo`, "add a card from your life to your hand", the KO-to-life paths), which of them can suspend and which are among the 46 that cannot, and what the two cards need at each.
2. `event: life` on `replace`: a card leaving the life area with its destination (`hand` or `drop`) named on the moment; `replacementFor` discriminates on it, only the suspendable sites prompt (§1.4's rule: a subject that could leave by a non-script route is refused, not downgraded), and the beat says which.
3. `opts.reveal`: the substitute "reveal it and add it to your hand" — shown to both players (20-11-2, the `reveal` op's audience) and then moved; the `Beats.art` masking in `maskBeats` must let a revealed life card's face through to both seats.
4. Compile the wording for the two cards; `wording.ts`/`narration.ts` sentences; glossary reading rule; `card_rules` re-drafted for the two.

**Out of scope.** Rebuilding `move()` around a frame for the 48 sites; the 26 replacement skills still unread for ordinary compiler reasons (§6).

**Acceptance.**
- Gate; `npx tsx scripts/arena-fuzz.mts 200` 0 crashes (this touches `GameState`/`ScriptFrame`); `npm run arena:diff -- --all` no divergence; `npm run contract:emit` and `android:test` if a beat or `Prompt` changes.
- `scripts/verify/keywords.ts`: BT10-031's text on a synthetic card — during the opponent's turn, a life card headed for the Drop is revealed to both players and added to the hand when the player says yes, and goes to the Drop when they say no; during the player's own turn nothing is asked.
- `npm run arena:probe -- --card BT10-031` and `-- --card SD18-01` report the rule applied; `npm run arena:readings` diff is those two cards and nothing else; `arena:reprobe` 0 moved.
