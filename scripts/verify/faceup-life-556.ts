/** Face-up Life transitions bind one public moment to the life card and its controller (#556). */
import assert from "node:assert/strict";
import { buildSnapshot, CTX, DEFS, ENGINE, IMPL, stagedG, zoneOf, findG, type EngineState, type CardDef } from "./harness";
import type { Action, GameEvent, PlayerId } from "../../src/lib/arena/types";

const fixtureIds = [
  "LIFE556_RED_SOURCE",
  "LIFE556_BLUE_SOURCE",
  "LIFE556_MOVE_SOURCE",
  "LIFE556_RED_LIFE",
  "LIFE556_BLUE_LIFE",
  "LIFE556_RED_WATCHER",
  "LIFE556_BLUE_WATCHER",
  "LIFE556_BIND_WATCHER",
  "LIFE556_OPP_RED_WATCHER",
];
const previousDefs = new Map(fixtureIds.map((id) => [id, DEFS[id]] as const));

try {
  const set = (id: string, overrides: Partial<CardDef>) => {
    DEFS[id] = { ...DEFS.V1, id, name: id, ...overrides };
  };
  set("LIFE556_RED_SOURCE", { skill: "[Auto] When you play this card, flip up to 1 card in your life face up." });
  set("LIFE556_BLUE_SOURCE", { colors: ["Blue"], skill: "[Auto] When you play this card, flip up to 1 card in your life face up." });
  set("LIFE556_MOVE_SOURCE", { skill: "[Auto] When you play this card, add 1 card from your life to your hand." });
  set("LIFE556_RED_LIFE", { skill: "[Auto] When this card in your life is flipped face up by one of your red card skills, draw 1 card." });
  set("LIFE556_BLUE_LIFE", { colors: ["Blue"], skill: "[Auto] When this card in your life is flipped face up by one of your blue card skills, draw 1 card." });
  set("LIFE556_RED_WATCHER", { skill: "[Auto] When a card in your life is flipped face up by one of your red card skills, draw 1 card." });
  set("LIFE556_BLUE_WATCHER", { colors: ["Blue"], skill: "[Auto] When a card in your life is flipped face up by one of your blue card skills, draw 1 card." });
  set("LIFE556_BIND_WATCHER", { skill: "[Auto] When a card in your life is flipped face up by one of your red card skills, add that card to your hand." });
  set("LIFE556_OPP_RED_WATCHER", { skill: "[Auto] When a card in your life is flipped face up by one of your red card skills, draw 1 card." });

  function apply(s: EngineState, action: Action): { state: EngineState; events: GameEvent[] } {
    const result = IMPL.apply(CTX, s, action);
    return { state: result.state as EngineState, events: result.events };
  }

  function putLifeCard(s: EngineState, side: PlayerId, cardId: string): string {
    const id = zoneOf(s, side, "life")[0];
    assert.ok(id, `${side} starts with a Life card`);
    s.cards[id].cardId = cardId;
    return id;
  }

  function snapshot(s: EngineState, viewer: PlayerId) {
    return buildSnapshot({
      id: 556,
      mode: "versus",
      engine: ENGINE,
      status: "playing",
      p1Name: "You",
      p2Name: "Opponent",
      ctx: CTX,
      state: s,
      legal: IMPL.legalActions(CTX, s),
      log: [],
      beats: null,
      spotlight: null,
      spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 },
      ai: null,
      viewer,
      images: {},
    });
  }

  function assertHiddenLifeMasked(s: EngineState, secretId: string, secretCardId: string) {
    for (const viewer of ["p1", "p2"] as const) {
      const snap = snapshot(s, viewer);
      const encoded = JSON.stringify(snap);
      assert.ok(!encoded.includes(secretId), `${viewer}'s snapshot never serializes the face-down Life instance id`);
      assert.ok(!encoded.includes(secretCardId), `${viewer}'s snapshot never serializes the face-down Life card identity`);
    }
  }

  function startFlip(source: string, lifeCard: string, oppLife = "LIFE556_BLUE_LIFE", withWatchers = true) {
    const s = stagedG({
      hand: [source],
      energy: [source.includes("BLUE") ? "V-BLUE" : "V1"],
      battle: withWatchers ? ["LIFE556_RED_WATCHER", "LIFE556_BLUE_WATCHER"] : [],
      oppBattle: withWatchers ? ["LIFE556_OPP_RED_WATCHER"] : [],
    });
    const target = putLifeCard(s, "p1", lifeCard);
    const hiddenOpponent = putLifeCard(s, "p2", oppLife);
    return { s, target, hiddenOpponent };
  }

  function chooseLife(s: EngineState, target: string) {
    assert.equal(s.prompt.kind, "chooseCards", "the source Auto asks which Life card to flip");
    const action: Action = { type: "choose", player: "p1", cards: [target] };
    return apply(s, action);
  }

  // Red source: the Life card's own Auto and its controller's matching watcher
  // resolve once each. Blue and opponent-side watchers do not answer.
  {
    const fixture = startFlip("LIFE556_RED_SOURCE", "LIFE556_RED_LIFE");
    const played = apply(fixture.s, { type: "play", player: "p1", card: findG(fixture.s, "p1", "hand", "LIFE556_RED_SOURCE") });
    assert.equal(played.state.prompt.kind, "chooseCards");

    // The prompt survives persistence and the other seat cannot learn hidden Life identities.
    const hiddenPrompt = JSON.parse(JSON.stringify(played.state)) as EngineState;
    assertHiddenLifeMasked(hiddenPrompt, fixture.hiddenOpponent, "LIFE556_BLUE_LIFE");
    const resumed = chooseLife(hiddenPrompt, fixture.target);
    const drawEvents = resumed.events.filter((event) => event.type === "draw");
    assert.equal(drawEvents.length, 2, "the in-Life Auto and one controller watcher draw once apiece");
    assert.ok(drawEvents.every((event) => event.type === "draw" && event.player === "p1"), "only the Life card's controller receives the matching Auto effects");
    assert.equal(resumed.state.cards[fixture.target].faceUp, true, "3-9-2-1 leaves the flipped card face up in Life");
    assert.ok(zoneOf(resumed.state, "p1", "life").includes(fixture.target), "face-up does not move the Life card");

    const p1 = snapshot(resumed.state, "p1");
    const p2 = snapshot(resumed.state, "p2");
    assert.ok(p1.view.you.lifeFaceUp.some((card) => card.id === fixture.target), "the controller sees the now-open Life card");
    assert.ok(p2.view.them.lifeFaceUp.some((card) => card.id === fixture.target), "the opponent also sees the now-open Life card");
    assertHiddenLifeMasked(resumed.state, fixture.hiddenOpponent, "LIFE556_BLUE_LIFE");
  }

  // Blue source and Blue-only Life Auto prove the source color is taken from
  // the skill that performed the transition, while Red watchers are excluded.
  {
    const fixture = startFlip("LIFE556_BLUE_SOURCE", "LIFE556_BLUE_LIFE");
    const played = apply(fixture.s, { type: "play", player: "p1", card: findG(fixture.s, "p1", "hand", "LIFE556_BLUE_SOURCE") });
    const resumed = chooseLife(played.state, fixture.target);
    assert.equal(resumed.events.filter((event) => event.type === "draw").length, 2, "the Blue life Auto and its matching Blue watcher resolve, while Red watchers are filtered out");
    assert.ok(resumed.events.filter((event) => event.type === "draw").every((event) => event.type === "draw" && event.player === "p1"));
  }

  // A watched Auto's bound subject is the Life card that changed, not the
  // source skill or the watcher. Its effect moves that exact card to hand.
  {
    const s = stagedG({ hand: ["LIFE556_RED_SOURCE"], battle: ["LIFE556_BIND_WATCHER"], energy: ["V1"] });
    const target = putLifeCard(s, "p1", "LIFE556_RED_LIFE");
    const played = apply(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", "LIFE556_RED_SOURCE") });
    const resumed = chooseLife(played.state, target);
    const movedSubject = resumed.events.filter((event) => event.type === "move" && event.from === "life" && event.to === "hand");
    assert.equal(movedSubject.length, 1, "the watching Auto resolves once against its event subject");
    assert.equal(movedSubject[0].type === "move" ? movedSubject[0].card : null, target, "the moved card is the Life card turned face up");
    assert.ok(zoneOf(resumed.state, "p1", "hand").includes(target));
  }

  // Asking to turn an already face-up card face up again is a no-op and emits
  // no second faceUpTurned moment.
  {
    const fixture = startFlip("LIFE556_RED_SOURCE", "LIFE556_RED_LIFE");
    fixture.s.cards[fixture.target].faceUp = true;
    const played = apply(fixture.s, { type: "play", player: "p1", card: findG(fixture.s, "p1", "hand", "LIFE556_RED_SOURCE") });
    const resumed = chooseLife(played.state, fixture.target);
    assert.equal(resumed.events.filter((event) => event.type === "draw").length, 0, "a repeated face-up value does not fire the Auto moment again");
    assert.equal(resumed.state.cards[fixture.target].faceUp, true);
  }

  // Moving a face-down Life card to hand is a different moment and must not
  // fire the face-up Auto. The card's unrelated movement still occurs.
  {
    const s = stagedG({ hand: ["LIFE556_MOVE_SOURCE"], energy: ["V1"] });
    const target = putLifeCard(s, "p1", "LIFE556_RED_LIFE");
    const played = apply(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", "LIFE556_MOVE_SOURCE") });
    assert.equal(played.state.prompt.kind, "chooseCards");
    const result = apply(played.state, { type: "choose", player: "p1", cards: [target] });
    assert.equal(result.events.filter((event) => event.type === "draw").length, 0, "a Life-to-hand move is not a face-up transition");
    assert.ok(zoneOf(result.state, "p1", "hand").includes(target));
    assert.equal(result.state.cards[target].faceUp, false, "movement clears face-up state with the new area");
  }
} finally {
  for (const id of fixtureIds) {
    const previous = previousDefs.get(id);
    if (previous) DEFS[id] = previous;
    else delete DEFS[id];
  }
}
