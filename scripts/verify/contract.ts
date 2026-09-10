/**
 * The client contract: the beats and the snapshot both clients render, whose
 * move it is, and whose room the board is (`docs/arena-client-contract.md`).
 *
 * Part of `npm test`; run from `scripts/verify-arena.ts`, which fixes the order.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isGhostAction } from "../../src/components/arena/shared";
import {
  CTX,
  DEFAULT_LIGHTING,
  LEADER_COLOURS,
  LIGHTING_VERSION,
  RIVAL,
  TONES,
  appendBeats,
  apply,
  arena,
  boardView,
  buildSnapshot,
  colourOf,
  encodeLighting,
  find,
  legalActions,
  lightingFrom,
  maskBeats,
  mix,
  play,
  toBeats,
  toneFor,
  turnVars,
  waitingFor,
} from "./harness";
import type { Beat, Beats, GameState, NumberedBeat, PlayerId, Snapshot } from "./harness";

// ── the client contract: beats, and the snapshot both clients render ───────
//
// `docs/arena-client-contract.md`. The fixtures below are the anti-drift
// mechanism: they are written by this file and checked by this file, so a
// change to the shape a client receives cannot land without showing up as a
// readable diff. Run `npm run contract:emit` to rewrite them on purpose.

{
  const ctx = CTX;

  // A charge is one card leaving the hand for the Energy Area.
  {
    let s = arena({ hand: ["V1"] });
    const card = find(s, "p1", "hand", "V1");
    s = play(s, { type: "endMain", player: "p1" });
    // p2's turn, then back to p1's charge prompt.
    s = play(s, { type: "charge", player: "p2", card: null }, { type: "endMain", player: "p2" });
    assert.equal(s.prompt.kind, "charge");
    const { state, events } = apply(ctx, s, { type: "charge", player: "p1", card });
    const beats = toBeats(ctx, state, events, 0);
    const moved = beats.list.find((b) => b.t === "move");
    assert.ok(moved && moved.t === "move" && moved.from === "hand" && moved.to === "energy", "charging is a move from hand to energy");
    assert.ok(beats.art[card], "a beat names its card, and carries the face it had at the time");
    assert.equal(beats.art[card].imageUrl, null, "art is filled in by session.ts, not here");
  }

  // Events with no picture collapse on purpose, and produce no beats at all.
  {
    const s = arena();
    const quiet = toBeats(
      ctx,
      s,
      [
        { type: "note", text: "anything" },
        { type: "hidden", card: s.players.p1.deck[0], hidden: true },
        { type: "energyMarker", player: "p1", delta: 1 },
      ],
      0,
    );
    assert.deepEqual(quiet.list, [], "note, hidden and energyMarker have nothing to draw");
    assert.equal(quiet.seq, 0, "and do not advance the numbering");
  }

  // A KO carries its own face, because the card is gone from any later view.
  {
    let s = arena({ hand: ["KILLER"], energy: ["V1"], oppBattle: ["V-BLUE"] });
    const victim = s.players.p2.battle[0];
    const r1 = apply(ctx, s, { type: "play", player: "p1", card: find(s, "p1", "hand", "KILLER") });
    s = r1.state;
    assert.equal(s.prompt.kind, "chooseCards", "KILLER asks which card to KO");
    const r2 = apply(ctx, s, { type: "choose", player: "p1", cards: [victim] });
    const beats = toBeats(ctx, r2.state, r2.events, 0);
    assert.ok(
      beats.list.some((b) => b.t === "ko" && b.card === victim),
      `the KO is a beat — events were ${r2.events.map((e) => e.type).join(", ")}`,
    );
    assert.ok(beats.art[victim]?.name, "and it brings the face of the card that died");
  }

  // A token is pushed straight into the Battle Area with no `move` event.
  {
    const s = arena({ hand: ["SPAWN"], energy: ["V1"] });
    const r = apply(ctx, s, { type: "play", player: "p1", card: find(s, "p1", "hand", "SPAWN") });
    const beats = toBeats(ctx, r.state, r.events, 0);
    assert.equal(beats.list.filter((b) => b.t === "token").length, 2, "both Saibamen get a beat of their own");
  }

  // Numbering climbs across batches, which is how one opponent turn — several
  // applies — replays in order and a client knows what it has not seen.
  {
    const s = arena({ hand: ["V1"], energy: ["V1"] });
    const r = apply(ctx, s, { type: "play", player: "p1", card: find(s, "p1", "hand", "V1") });
    const first = toBeats(ctx, r.state, r.events, 0);
    const second = toBeats(ctx, r.state, r.events, first.seq);
    assert.ok(first.seq > 0 && second.seq === first.seq * 2, "the second batch continues where the first stopped");
    assert.equal(second.list[0].n, first.seq + 1, "and every beat is numbered, not counted");
    const joined = appendBeats(first, second);
    assert.equal(joined.list.length, first.list.length + second.list.length);
    assert.equal(joined.seq, second.seq);

    // Emptying the queue keeps the counter (see `clearBeats`). A counter that
    // restarted would make the turn after a long one look already-played, and
    // a client would sit still through it.
    const emptied = { seq: joined.seq, list: [], art: {} };
    const afterClear = appendBeats(emptied, toBeats(ctx, r.state, r.events, emptied.seq));
    assert.equal(afterClear.list.length, first.list.length, "the beats go, so only the new turn replays");
    assert.ok(afterClear.list[0].n > joined.seq, "but every number is still above everything already played");
  }

  // ── golden fixtures ──────────────────────────────────────────────────────

  const snapshotFor = (state: GameState, beats: ReturnType<typeof toBeats> | null) =>
    buildSnapshot({
      id: 1,
      mode: "hotseat",
      status: state.phase === "over" ? "over" : "playing",
      p1Name: "You",
      p2Name: "Claude",
      ctx,
      state,
      legal: legalActions(ctx, state),
      log: [],
      beats,
      spotlight: null,
      spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 },
      ai: null,
      images: {},
    });

  const fixtures: Record<string, unknown> = {};

  {
    const s = arena({ hand: ["V1"], energy: ["V1"] });
    const r = apply(ctx, s, { type: "play", player: "p1", card: find(s, "p1", "hand", "V1") });
    fixtures.play = snapshotFor(r.state, toBeats(ctx, r.state, r.events, 0));
  }
  {
    let s = arena({ hand: ["KILLER"], energy: ["V1"], oppBattle: ["V-BLUE"] });
    const victim = s.players.p2.battle[0];
    s = apply(ctx, s, { type: "play", player: "p1", card: find(s, "p1", "hand", "KILLER") }).state;
    const r = apply(ctx, s, { type: "choose", player: "p1", cards: [victim] });
    fixtures.ko = snapshotFor(r.state, toBeats(ctx, r.state, r.events, 0));
  }
  {
    const s = arena({ battle: ["BIG"], oppBattle: ["V-BLUE"] });
    const r = apply(ctx, s, { type: "attack", player: "p1", attacker: s.players.p1.battle[0], target: s.players.p2.leader! });
    fixtures.attack = snapshotFor(r.state, toBeats(ctx, r.state, r.events, 0));
  }
  {
    const s = arena();
    const r = apply(ctx, s, { type: "concede", player: "p1" });
    fixtures.over = snapshotFor(r.state, toBeats(ctx, r.state, r.events, 0));
  }
  {
    // A search of the deck mid-skill: `choices`, `min`/`max` and `step` on the
    // prompt, so both clients decode the shape a search sheet is built from.
    const s = arena({ hand: ["SEARCH"], energy: ["V1"] });
    const r = apply(ctx, s, { type: "play", player: "p1", card: find(s, "p1", "hand", "SEARCH") });
    fixtures.search = snapshotFor(r.state, toBeats(ctx, r.state, r.events, 0));
  }
  {
    // A skill activation: exactly one `skill` beat (review §3.2), the two
    // effects it made as beats of their own with their source named (§3.3),
    // and the pumped card carrying `basePower` and `effects` (§3.3c).
    const s = arena({ battle: ["PUMPCRIT"], energy: ["V1"] });
    const pump = find(s, "p1", "battle", "PUMPCRIT");
    const r = apply(ctx, s, { type: "activate", player: "p1", card: pump, skill: 0 });
    const beats = toBeats(ctx, r.state, r.events, 0);
    assert.deepEqual(
      beats.list.map((b) => b.t),
      ["skill", "effect", "effect"],
      "one skill beat, then one beat per effect",
    );
    const fx = beats.list.filter((b): b is Extract<NumberedBeat, { t: "effect" }> => b.t === "effect");
    assert.deepEqual(
      fx.map((b) => [b.kind, b.label, b.until, b.source, b.owner]),
      [
        ["power", "+5,000 power", "turn", pump, "p1"],
        ["keyword", "[Critical]", "turn", pump, "p1"],
      ],
    );
    const snap = snapshotFor(r.state, beats);
    const cv = snap.view.you.battle.find((c) => c.id === pump)!;
    assert.equal(cv.power, 15000);
    assert.equal(cv.basePower, 10000, "the printed power travels with the changed one");
    assert.deepEqual(
      cv.effects?.map((e) => [e.kind, e.label, e.until, e.source, e.keyword ?? null]),
      [
        ["power", "+5,000 power", "turn", pump, null],
        ["keyword", "[Critical]", "turn", pump, "Critical"],
      ],
    );
    assert.equal(cv.effects?.[0].sourceName, "PUMPCRIT");
    fixtures.activate = snap;
    // The turn ending: the effects wear off, and each says so.
    const r2 = apply(ctx, r.state, { type: "endMain", player: "p1" });
    const ended = toBeats(ctx, r2.state, r2.events, beats.seq).list.filter((b) => b.t === "effectEnded");
    assert.equal(ended.length, 2, "one effectEnded beat per effect that expired");
    const after = boardView(ctx, r2.state, "p1", {}).you.battle.find((c) => c.id === pump)!;
    assert.equal(after.power, 10000);
    assert.equal(after.basePower, undefined, "back to the printed number, nothing to show");
    assert.equal(after.effects, undefined);
  }
  {
    // Standing rules on a board (review §3.5): an aura on another card, a
    // conditional [Permanent] that is off, a permanent nothing reads, one that
    // compiles to nothing the static layer applies, and a player-level rule.
    const s = arena({ battle: ["AURA", "RESTCOND", "ODDAURA", "INERTPERM", "V1"], oppBattle: ["V-BLUE"], energy: ["V1"] });
    const you = boardView(ctx, s, "p1", {}).you;
    const byId = (cardId: string) => you.battle.find((c) => c.cardId === cardId)!;
    assert.equal(byId("AURA").permanents?.[0].state, "on");
    assert.equal(byId("RESTCOND").permanents?.[0].state, "off", "its condition does not hold: the card is active");
    assert.equal(byId("ODDAURA").permanents?.[0].state, "unread");
    assert.equal(byId("ODDAURA").referee, false, "a [Permanent] is never the referee's: it never resolves");
    assert.equal(byId("INERTPERM").permanents?.[0].state, "inert", "compiles, but the static layer has no kind for a draw");
    const v1 = byId("V1");
    assert.equal(v1.basePower, 10000, "AURA's +5000 is on it, and the card says what the printed number was");
    assert.equal(v1.power, 15000, "RESTCOND is off (the card is active), so only AURA counts");
    assert.deepEqual(
      v1.effects?.map((e) => [e.kind, e.label, e.until, e.sourceName]),
      [["power", "+5,000 power", "permanent", "AURA"]],
    );
    fixtures.standing = snapshotFor(s, null);
  }

  {
    // ── 1 v 1: the same game, drawn for the other chair ────────────────────
    //
    // Everything above is drawn for p1, because that is who every other mode
    // shows. A versus game is the first time the server builds a board for p2,
    // and the three things that must then be true are all checked here.
    const s = arena({ hand: ["V1"], oppHand: ["KILLER", "BIG"], battle: ["V1"], oppBattle: ["V-BLUE"] });
    const mine = s.players.p1.hand[0];
    const theirs = s.players.p2.hand[0];
    const legal = legalActions(ctx, s);
    const versus = (viewer: PlayerId) =>
      buildSnapshot({
        id: 1,
        mode: "versus",
        status: "playing",
        p1Name: "Red aggro",
        p2Name: "Blue control",
        p1User: "patrick",
        p2User: "brother",
        ctx,
        state: s,
        legal,
        log: [],
        // A draw each, so the mask has something to bite on in both directions.
        beats: {
          seq: 2,
          list: [
            { t: "draw", player: "p1", card: mine, n: 1 },
            { t: "draw", player: "p2", card: theirs, n: 2 },
          ] as NumberedBeat[],
          art: {
            [mine]: { cardId: s.cards[mine].cardId, name: s.cards[mine].cardId, imageUrl: null },
            [theirs]: { cardId: s.cards[theirs].cardId, name: s.cards[theirs].cardId, imageUrl: null },
          },
        },
        spotlight: null,
        spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 },
        ai: null,
        viewer,
        images: {},
      });

    const forP1 = versus("p1");
    const forP2 = versus("p2");

    // 1. Each chair keeps its own side, whoever the engine happens to be asking.
    assert.equal(forP1.game.you, "p1");
    assert.equal(forP2.game.you, "p2");
    assert.equal(forP1.view.you.player, "p1", "the viewer is p1's own side, not the asked player's");
    assert.equal(forP2.view.you.player, "p2");
    assert.ok(forP1.view.you.hand, "you always see your own hand");
    assert.ok(forP2.view.you.hand, "and so does the other chair");
    assert.equal(forP1.view.them.hand, null, "and never the other player's");
    assert.equal(forP2.view.them.hand, null);
    assert.equal(forP1.view.them.handCount, s.players.p2.hand.length, "only how many");

    // 2. `waiting` names a person now, not just Claude. It is p1's prompt.
    assert.equal(s.prompt.kind, "main");
    assert.equal((s.prompt as { player: PlayerId }).player, "p1");
    assert.equal(forP1.waiting, "you");
    assert.equal(forP2.waiting, "opponent", "the other device is told to sit still and watch");
    assert.ok(!forP2.rejected?.length, "and is never told why it cannot move: the prompt is not its");

    // 3. The beat queue is one queue, but a face is only in the copy that may
    //    see it. Both beats survive in both — that a card moved is public —
    //    and the id is kept so it still flies; only the face goes.
    assert.equal(forP1.beats!.list.length, 2, "the story is the same on both screens");
    assert.equal(forP2.beats!.list.length, 2);
    assert.ok(forP1.beats!.art[mine], "your own draw shows its face");
    assert.ok(!forP1.beats!.art[theirs], "their draw does not");
    assert.ok(forP2.beats!.art[theirs], "and the same, the other way round");
    assert.ok(!forP2.beats!.art[mine]);

    fixtures.versus = forP2;
  }

  {
    // A card drawn and then *played* is public, so its beat is not masked —
    // the mask reads the board as it stands, not as it was.
    const s = arena({ hand: ["V1"], energy: ["V1"] });
    const card = find(s, "p1", "hand", "V1");
    const r = apply(ctx, s, { type: "play", player: "p1", card });
    const beats = toBeats(ctx, r.state, r.events, 0);
    assert.ok(beats.art[card], "the play put a face in the queue");
    assert.ok(maskBeats(r.state, beats, "p2")!.art[card], "and it is in the Battle Area, so the opponent sees it");
    assert.equal(maskBeats(r.state, beats, "p2"), beats, "nothing hidden means the very same queue back");
  }

  // Every fixture state: no move is both legal and rejected, and nothing is
  // rejected for no reason (`docs/arena-workflow-spec.md` §3.6).
  for (const [name, snap] of Object.entries(fixtures)) {
    const sn = snap as Snapshot;
    for (const r of sn.rejected ?? []) {
      assert.ok(r.why.length > 0, `${name}: "${r.label}" rejected for no reason`);
      assert.ok(!sn.legal.some((l) => JSON.stringify(l.action) === JSON.stringify(r.action)), `${name}: "${r.label}" is both legal and rejected`);
    }
  }
  {
    // One of every beat kind, in one snapshot, built by hand.
    //
    // No real game produces all of them: `arena:playthrough` over ~700 moves
    // has never yielded a token, a block, a marker, a negation or a word from
    // Claude, because those need a token card, a blocker, a Unison, a negated
    // attack and an opponent who talks. Without this, a client could get five
    // of the sixteen shapes wrong and nothing would notice — this fixture is
    // what the Kotlin round-trip tests decode to prove they do not.
    const s = arena({ battle: ["V1"], oppBattle: ["V-BLUE"] });
    const mine = s.players.p1.battle[0];
    const theirs = s.players.p2.battle[0];
    let n = 0;
    const at = (b: Beat): NumberedBeat => ({ ...b, n: ++n }) as NumberedBeat;
    const list: NumberedBeat[] = [
      at({ t: "phase", phase: "main", player: "p1", turn: s.turn }),
      at({ t: "draw", player: "p1", card: mine }),
      at({ t: "move", card: mine, from: "hand", to: "battle", owner: "p1" }),
      at({ t: "mode", card: mine, mode: "rest" }),
      at({ t: "flip", card: mine }),
      at({ t: "markers", card: mine, delta: 1, total: 2 }),
      at({ t: "token", card: theirs, owner: "p2" }),
      at({ t: "attack", attacker: mine, target: theirs }),
      at({ t: "block", guard: theirs, by: theirs }),
      at({ t: "clash", attacker: mine, guard: theirs, attackPower: 20000, guardPower: 10000, hit: true }),
      at({ t: "damage", player: "p2", amount: 1, critical: false, cards: [theirs] }),
      at({ t: "ko", card: theirs, owner: "p2" }),
      at({ t: "negated" }),
      at({ t: "skill", card: mine, label: "Auto", text: "When this card attacks, draw 1 card.", unread: false, owner: "p1", inBattle: true }),
      at({ t: "effect", card: mine, player: null, kind: "power", label: "+5000 power", until: "turn", source: mine, owner: "p1" }),
      at({ t: "effectEnded", card: mine, player: null, kind: "power", label: "+5000 power", source: mine }),
      at({ t: "say", text: "Let us see how you answer that." }),
      at({ t: "over", winner: "p1", reason: "no life left" }),
    ];
    const art: Beats["art"] = {};
    for (const id of [mine, theirs]) art[id] = { cardId: s.cards[id].cardId, name: s.cards[id].cardId, imageUrl: null };
    fixtures["all-beats"] = snapshotFor(s, { seq: n, list, art });

    // If a kind is ever added to the union, this fixture must grow with it.
    const covered = new Set(list.map((b) => b.t));
    assert.equal(covered.size, list.length, "every beat kind appears exactly once in the all-beats fixture");
  }

  // `npm test` runs from the repo root, which is what makes this path right.
  const dir = path.join(process.cwd(), "contract", "fixtures");
  const emit = process.argv.includes("--emit");
  if (emit) fs.mkdirSync(dir, { recursive: true });
  for (const [name, snapshot] of Object.entries(fixtures)) {
    const file = path.join(dir, `${name}.json`);
    const text = JSON.stringify(snapshot, null, 2) + "\n";
    if (emit) {
      fs.writeFileSync(file, text);
      continue;
    }
    assert.ok(fs.existsSync(file), `contract/fixtures/${name}.json is missing — run \`npm run contract:emit\``);
    assert.equal(
      fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n"),
      text,
      `the shape clients receive has changed (contract/fixtures/${name}.json). If that is deliberate, run \`npm run contract:emit\` and review the diff.`,
    );
  }
  if (emit) console.log(`verify-arena: wrote ${Object.keys(fixtures).length} contract fixtures`);

  // The bare-button tone on both clients (`docs/arena-hud-spec.md` §2.3): an
  // action that declines, skips, passes, ends or cancels is rendered as a
  // ghost button, and the contract fixtures prove the shapes clients receive.
  const expectedGhosts: Record<string, number> = {
    activate: 1,
    attack: 1,
    "all-beats": 1,
    ko: 1,
    over: 0,
    play: 1,
    search: 1,
    standing: 1,
    versus: 1,
  };
  for (const [name, snap] of Object.entries(fixtures)) {
    const sn = snap as Snapshot;
    const ghosts = sn.legal.filter((l) => isGhostAction(l.action));
    assert.equal(ghosts.length, expectedGhosts[name], `${name}: expected ${expectedGhosts[name]} ghost action(s), saw ${ghosts.map((l) => l.label).join(", ") || "none"}`);
  }
  assert.equal(isGhostAction({ type: "block", player: "p1", card: null }), true, "blocking with no card is a decline");
  assert.equal(isGhostAction({ type: "block", player: "p1", card: "p1#1" }), false, "a real blocker is an action");
  assert.equal(isGhostAction({ type: "counter", player: "p1", card: null }), true, "countering with no card is a decline");
  assert.equal(isGhostAction({ type: "counter", player: "p1", card: "p1#1" }), false, "a played counter stays filled");
  assert.equal(isGhostAction({ type: "optionalCost", player: "p1", pay: false }), true, "declining an optional cost is a ghost action");
  assert.equal(isGhostAction({ type: "optionalCost", player: "p1", pay: true }), false, "paying an optional cost stays filled");
}

// ── whose move it is (docs/arena-hud-spec.md §1.1) ─────────────────────────

{
  /**
   * The invariant that makes the stale-prop bug a class rather than an
   * incident: **if the prompt belongs to the viewer and the viewer has at
   * least one legal action, nothing on the board may state that the opponent
   * is acting.**
   *
   * The board now derives all of "is the opponent acting" from
   * `snapshot.waiting`, so this is the whole of it. The screenshot that
   * started the HUD spec was a board saying "Majin Buu is thinking…" over a
   * charge prompt that was offering eight moves.
   */
  const ctx = CTX;
  // A main phase belonging to p1 with real moves in it — the shape of the
  // charge step in that screenshot, which is where the contradiction showed.
  const s = arena({ hand: ["BIG"], energy: ["V1", "V1"] });
  const legal = legalActions(ctx, s);
  assert.ok(legal.length > 0, "the fixture's prompt has moves in it");
  assert.equal((s.prompt as { player: PlayerId }).player, "p1");
  assert.equal(waitingFor({ ai: null, state: s, status: "playing", viewer: "p1" }), "you", "a prompt that is the viewer's is never the opponent's move");

  // And the same read through a whole snapshot, which is what the board holds.
  const snap = buildSnapshot({
    id: 1,
    mode: "hotseat",
    status: "playing",
    p1Name: "You",
    p2Name: "Claude",
    ctx,
    state: s,
    legal,
    log: [],
    beats: null,
    spotlight: null,
    spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 },
    ai: null,
    images: {},
  });
  assert.ok(snap.legal.length > 0);
  assert.equal(snap.view.prompt.player, snap.view.you.player, "the fixture is in the state the invariant is about");
  assert.equal(snap.waiting, "you", "the prompt is the viewer's with moves in it — the board may not say the opponent is acting");
  // The other direction, so the assertion above cannot pass vacuously.
  assert.equal(waitingFor({ ai: null, state: { ...s, prompt: { ...s.prompt, player: "p2" } } as typeof s, status: "playing", viewer: "p1" }), "opponent");
}

// ── turn presence: whose room it is (docs/arena-turn-presence-spec.md) ──────

{
  const on = DEFAULT_LIGHTING;
  const art = "https://storage.googleapis.com/deckplanet_card_images/BT18-020.png";

  // The one thing a turn flip is allowed to move.
  const yours = turnVars({ colour: "Red", art, yours: true, mirror: false }, on);
  const theirs = turnVars({ colour: "Red", art, yours: false, mirror: false }, on);
  assert.equal(yours["--turn-y"], "88%");
  assert.equal(theirs["--turn-y"], "12%");
  assert.equal(yours["--turn-tint"], TONES.Red.tint, "the hue is the printed colour, not a sampled one");
  assert.deepEqual(
    Object.entries(yours).filter(([k, v]) => theirs[k] !== v),
    [["--turn-y", "88%"]],
    "position is the only thing that differs between the two turns of a non-mirror match",
  );

  // The dial is per colour: one master strength times the colour's own.
  for (const c of LEADER_COLOURS) {
    assert.equal(turnVars({ colour: c, art, yours: true, mirror: false }, on)["--turn-k"], (TONES[c].k / 100).toFixed(2));
  }

  // No art, no wash — never a broken or half-loaded one. Layer 2 carries it.
  const noArt = turnVars({ colour: "Blue", art: null, yours: true, mirror: false }, on);
  assert.equal(noArt["--turn-art"], "none");
  assert.equal(noArt["--turn-art-on"], "0");
  assert.equal(noArt["--turn-tint"], TONES.Blue.tint, "a leader with no art still owns the room");
  // Anything that would have to be escaped to be safe in `url()` is dropped.
  for (const bad of ["javascript:alert(1)", 'https://x/a").png', "http://insecure/a.png", "https://x/a b.png"]) {
    assert.equal(turnVars({ colour: "Blue", art: bad, yours: true, mirror: false }, on)["--turn-art"], "none", `refused: ${bad}`);
  }

  // A mirror match re-hues the *opponent*, never the active player: your own
  // room must not change colour depending on who moved last.
  const mine = turnVars({ colour: "Green", art, yours: true, mirror: true }, on);
  const rival = turnVars({ colour: "Green", art, yours: false, mirror: true }, on);
  assert.equal(mine["--turn-tint"], TONES.Green.tint);
  assert.equal(rival["--turn-tint"], RIVAL.tint);
  assert.notEqual(mine["--turn-tint"], rival["--turn-tint"], "the two turns of a mirror match must be tellable apart");
  const cooled = turnVars({ colour: "Green", art, yours: false, mirror: true }, { ...on, mirror: "cooled" });
  assert.equal(cooled["--turn-tint"], mix(TONES.Green.tint, "#64748b", 0.55));
  assert.equal(turnVars({ colour: "Green", art, yours: false, mirror: true }, { ...on, mirror: "off" })["--turn-tint"], TONES.Green.tint);

  // §2.5: the switch that has to exist for the ambient not to be the only
  // signal. Off is zero light — the scale, the ring and the strip carry it.
  assert.equal(turnVars({ colour: "Red", art, yours: true, mirror: false }, { ...on, mode: "off" })["--turn-mode"], "0");
  assert.equal(turnVars({ colour: "Red", art, yours: true, mirror: false }, { ...on, mode: "subtle" })["--turn-mode"], "0.5");

  // A leader with no colour at all lights nothing; White and Colorless are
  // real engine colours and fall back to the neutral tone rather than to dark.
  assert.equal(colourOf([]), null);
  assert.equal(colourOf(["White"]), "Black");
  assert.equal(colourOf(["Yellow", "Blue"]), "Yellow", "a multi-colour leader uses colors[0]");
  assert.equal(turnVars({ colour: null, art, yours: true, mirror: false }, on)["--turn-k"], "0");

  // The settings blob: tolerant of anything, and it stores only what was
  // tuned, so a future default change reaches a player who never touched it.
  assert.deepEqual(lightingFrom(null), DEFAULT_LIGHTING);
  assert.deepEqual(lightingFrom("not json"), DEFAULT_LIGHTING);
  assert.deepEqual(lightingFrom(JSON.stringify({ v: 99, mode: "off" })), DEFAULT_LIGHTING, "a blob from a future version is not half-read");
  assert.equal(lightingFrom(JSON.stringify({ v: 1, mode: "nope", mirror: "cooled" })).mode, "on");
  assert.equal(lightingFrom(JSON.stringify({ v: 1, mirror: "cooled" })).mirror, "cooled");
  assert.deepEqual(lightingFrom(JSON.stringify({ v: 1, tone: { Red: { tint: "oops", glow: "#ffffff", k: 50 } } })).tone, {}, "a malformed tone is dropped, not stored");
  const tuned = lightingFrom(JSON.stringify({ v: 1, tone: { Red: { tint: "#112233", glow: "#445566", k: 300 } } }));
  assert.deepEqual(tuned.tone, { Red: { tint: "#112233", glow: "#445566", k: 200 } }, "intensity is clamped, not trusted");
  assert.equal(toneFor("Red", tuned).tint, "#112233");
  assert.equal(toneFor("Blue", tuned).tint, TONES.Blue.tint, "an untuned colour keeps following the shipped default");
  assert.equal(JSON.parse(encodeLighting(tuned)).v, LIGHTING_VERSION);
  assert.deepEqual(lightingFrom(encodeLighting(tuned)), tuned, "the cookie round-trips");
}
