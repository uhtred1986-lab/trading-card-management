/**
 * The skill explainer (`docs/arena-skill-explainer.md`, the owner's decisions of 13 Nov 2026): every skill told
 * in three parts — the callout, its steps, the receipt — at the Explain pace, the default since.
 *
 * Four things are pinned here. The engine's half: a look, a search, a shuffle, a skill going on after a decision
 * and a card going under another are beats now, and each skill beat counts the beats it did in its own batch
 * (`relateBeats`). The grouping (`explain.ts`): trailing beats join their step, runs of one thing are one step held
 * on its last beat, the receipt goes on the moment's last beat. The words: first person from the opponent, "you"
 * for yours, the trigger split out, the keyword's meaning, Evolve's "on top of". The timing (`motion.ts`): the
 * Explain durations, and board-changing moves read as key moments at every pace.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, IMPL, card, findG, stagedG, zoneOf } from "./harness";
import type { Beat, NumberedBeat } from "./harness";
import { relateBeats } from "../../src/lib/arena/beats-core";
import { explainMoment, explainRoles, splitTrigger } from "../../src/lib/arena/explain";
import { narrate, narrateRun, type Narrator } from "../../src/lib/arena/narration";
import { EXPLAIN, SLOW_FACTOR, TIER, changesPlay, msFor } from "../../src/components/arena/stage/motion";

let n = 0;
const at = (b: Beat): NumberedBeat => ({ ...b, n: ++n }) as NumberedBeat;
const art = (ids: Record<string, string>) => Object.fromEntries(Object.entries(ids).map(([id, name]) => [id, { cardId: id, name, imageUrl: null }]));
const narrator = (a: Narrator["art"]): Narrator => ({ viewer: "p1", them: "Claude", art: a });

// ── relateBeats: a skill counts what it did in its own batch ──────────────────
{
  n = 0;
  const batch = [
    at({ t: "mode", card: "e1", mode: "rest" }),
    at({ t: "move", card: "c1", from: "hand", to: "battle", owner: "p2", reveal: true }),
    at({ t: "skill", card: "c1", label: "Auto", text: "When you play this card, draw 1 card.", unread: false, owner: "p2", inBattle: false }),
    at({ t: "move", card: "d1", from: "deck", to: "hand", owner: "p2" }),
    at({ t: "draw", player: "p2", card: "d1" }),
    at({ t: "phase", phase: "mainEnd", player: "p2", turn: 3 }),
    at({ t: "mode", card: "e2", mode: "rest" }),
  ];
  relateBeats(batch, "main");
  const skill = batch[2] as Extract<NumberedBeat, { t: "skill" }>;
  assert.equal(skill.steps, 2, "the draw and its marker are what the skill did; the phase after them is not");
  n = 0;
  const combo = [
    at({ t: "skill", card: "c1", label: "Auto", text: "At the end of the battle, draw 1 card.", unread: false, owner: "p1", inBattle: true }),
    at({ t: "move", card: "x", from: "combo", to: "drop", owner: "p1" }),
  ];
  relateBeats(combo, "main");
  assert.equal((combo[0] as { steps?: number }).steps, undefined, "a combo card going to the Drop after a battle is the battle's clean-up, not the skill's");
}

// ── explainRoles: callout, steps, holds and the receipt ──────────────────────
{
  n = 0;
  const list = [
    at({ t: "skill", card: "c1", label: "Auto", text: "When you play this card, draw 2 cards and place the top 3 cards of your deck in your Drop Area.", unread: false, owner: "p2", inBattle: false, steps: 7 }),
    at({ t: "move", card: "d1", from: "deck", to: "hand", owner: "p2" }),
    at({ t: "draw", player: "p2", card: "d1" }),
    at({ t: "move", card: "d2", from: "deck", to: "hand", owner: "p2" }),
    at({ t: "draw", player: "p2", card: "d2" }),
    at({ t: "move", card: "m1", from: "deck", to: "drop", owner: "p2", reveal: true }),
    at({ t: "move", card: "m2", from: "deck", to: "drop", owner: "p2", reveal: true }),
    at({ t: "move", card: "m3", from: "deck", to: "drop", owner: "p2", reveal: true }),
  ];
  const roles = explainRoles(list, "p1");
  assert.deepEqual(roles.get(1), { kind: "callout", mine: false, steps: 2 }, "the opponent's skill: a callout, then two steps");
  // Two draws are one step, held on the second card's flight; the three cards milled are one step, held on the last.
  assert.deepEqual([2, 3, 4, 5].map((k) => roles.get(k)), [
    { kind: "step", index: 1, of: 2, hold: false, receipt: false },
    { kind: "step", index: 1, of: 2, hold: false, receipt: false },
    { kind: "step", index: 1, of: 2, hold: true, receipt: false },
    { kind: "step", index: 1, of: 2, hold: false, receipt: false },
  ]);
  assert.deepEqual([6, 7, 8].map((k) => roles.get(k)), [
    { kind: "step", index: 2, of: 2, hold: false, receipt: false },
    { kind: "step", index: 2, of: 2, hold: false, receipt: false },
    { kind: "step", index: 2, of: 2, hold: true, receipt: true },
  ], "the run is held on its last card, after which the receipt is shown");

  const a = art({ c1: "Agent of Resurrection, Babidi", m1: "Dark Plot", m2: "Pan", m3: "Bardock" });
  const e = explainMoment(list, 8, narrator(a))!;
  assert.equal(e.at, 2);
  assert.equal(e.moment.headline, "I use 《Auto》", "the opponent speaks in the first person");
  assert.equal(e.moment.trigger, "When you play this card,");
  assert.deepEqual(e.moment.steps, ["Claude draws 2 cards.", "Dark Plot, Pan and Bardock go to the Drop."]);
  assert.equal(e.moment.receipt, "Done: 2 cards drawn, 3 cards in the Drop", "a skill type's own label is not repeated in the receipt");
  assert.equal(explainMoment(list, 99, narrator(a)), null, "a beat outside every skill is not explained");
}

// ── trailing and leading beats: a KO's trip to the Drop, life before damage ───
{
  n = 0;
  const list = [
    at({ t: "skill", card: "k1", label: "Activate: Main", text: "KO up to 1 of your opponent's Battle Cards with an energy cost of 3 or less, and deal 1 damage to your opponent.", unread: false, owner: "p2", inBattle: false, steps: 4 }),
    at({ t: "ko", card: "v1", owner: "p1" }),
    at({ t: "move", card: "v1", from: "battle", to: "drop", owner: "p1" }),
    at({ t: "move", card: "l1", from: "life", to: "hand", owner: "p1" }),
    at({ t: "damage", player: "p1", amount: 1, critical: false, cards: ["l1"] }),
  ];
  const roles = explainRoles(list, "p1");
  assert.deepEqual([...roles.values()].filter((r) => r.kind === "step").map((r) => r.kind === "step" && [r.index, r.hold]), [[1, true], [1, false], [2, false], [2, true]], "KO, its tail; the life card, then the damage it leads into");
  const e = explainMoment(list, 2, narrator(art({ k1: "Frieza", v1: "Buu Make You Cookie" })))!;
  assert.deepEqual(e.moment.steps, ["Your Buu Make You Cookie is KO'd.", "You take 1 damage."]);
  assert.equal(e.moment.receipt, "Done: Buu Make You Cookie KO'd, 1 damage");
}

// ── your own skill, a keyword, Evolve's "on top of", a card going under ──────
{
  n = 0;
  const list = [
    at({ t: "skill", card: "u1", label: "Ex-Evolve", text: "[EX-Evolve]{u}{u}{2}: <Majin Buu>", unread: false, owner: "p1", inBattle: false, steps: 1 }),
    at({ t: "move", card: "u1", from: "hand", to: "battle", owner: "p1", reveal: true, onto: "b1" }),
    at({ t: "skill", card: "b2", label: "Activate: Main", text: "Choose 1 of your Battle Cards and place it under this card.", unread: false, owner: "p1", inBattle: false, steps: 2 }),
    at({ t: "under", card: "x1", host: "b2", owner: "p1", from: "battle" }),
    at({ t: "under", card: "x2", host: "b2", owner: "p1", from: "battle" }),
  ];
  const a = art({ u1: "The Ultimate Evil, Majin Buu", b1: "Majin Buu", b2: "Majin Buu, Unleashed", x1: "Bodyguard", x2: "Babidi" });
  const evolve = explainMoment(list, 1, narrator(a))!;
  assert.equal(evolve.moment.headline, "You use 《Ex-Evolve》", "your own skills say you");
  assert.equal(evolve.moment.keyword?.name, "Ex-Evolve");
  assert.match(evolve.moment.keyword?.meaning ?? "", /play this card on top of it/, "the glossary's meaning of [Evolve]");
  assert.deepEqual(evolve.moment.steps, ["You play The Ultimate Evil, Majin Buu on top of Majin Buu."]);
  assert.equal(evolve.moment.receipt, "Ex-Evolve done: The Ultimate Evil, Majin Buu on top of Majin Buu");
  assert.deepEqual(explainRoles(list, "p1").get(1), { kind: "callout", mine: true, steps: 1 });
  const under = explainMoment(list, 4, narrator(a))!;
  assert.deepEqual(under.moment.steps, ["Bodyguard and Babidi go under Majin Buu, Unleashed."], "two cards under one host are one step");
  assert.equal(under.moment.receipt, "Done: 2 cards under Majin Buu, Unleashed");
  // A masked skill is told without its words: the board shows that something happened, not what.
  const masked = explainMoment([{ ...list[0], label: "Skill", text: "" } as NumberedBeat, list[1]], 1, narrator({}))!;
  assert.equal(masked.moment.headline, "You use a skill");
  assert.equal(masked.moment.keyword, null);
}

// ── a skill going on after a decision ───────────────────────────────────────
{
  n = 0;
  const first = [
    at({ t: "skill", card: "s1", label: "Swap 2", text: "[Swap 2] <<Goku's Lineage>> (Return this card to your hand and play a cost-2 Battle Card from your hand in its place.)", unread: false, owner: "p2", inBattle: false, steps: 1 }),
    at({ t: "mode", card: "e1", mode: "rest" }),
  ];
  const second = [
    at({ t: "resume", card: "s1", label: "Keyword", owner: "p2", steps: 2 }),
    at({ t: "move", card: "s1", from: "battle", to: "hand", owner: "p2" }),
    at({ t: "move", card: "g1", from: "hand", to: "battle", owner: "p2", reveal: true }),
  ];
  const list = [...first, ...second];
  const a = art({ s1: "Adoptive Father Son Gohan", g1: "Dependable Dynasty Son Goku", e1: "Energy" });
  const roles = explainRoles(list, "p1");
  assert.deepEqual(roles.get(3), { kind: "resume", mine: false, steps: 2 }, "no second callout");
  const e = explainMoment(list, 5, narrator(a))!;
  assert.equal(e.moment.label, "Swap 2", "named as it was announced, not by the resumed program's bare tag");
  assert.equal(e.moment.resumed, true);
  assert.deepEqual(e.moment.steps, ["Adoptive Father Son Gohan returns to Claude's hand.", "Claude plays Dependable Dynasty Son Goku."]);
  assert.equal(e.moment.receipt, "Swap 2 done: Adoptive Father Son Gohan in hand, Dependable Dynasty Son Goku in play");
  const swap = explainMoment(list, 1, narrator(a))!;
  assert.match(swap.moment.keyword?.meaning ?? "", /Return this Battle Card to your hand/, "[Swap]'s meaning from the glossary");
}

// ── the trigger words ───────────────────────────────────────────────────────
assert.deepEqual(splitTrigger("[Auto] When this card attacks, draw 1 card."), { trigger: "When this card attacks,", body: "draw 1 card." });
assert.deepEqual(splitTrigger("[Activate: Main] [Once per turn] Draw 1 card."), { trigger: null, body: "Draw 1 card." });
assert.deepEqual(splitTrigger("[Awaken] When your life is at 4 or less : Draw 2 cards."), { trigger: "When your life is at 4 or less :", body: "Draw 2 cards." });

// ── the sentences for the new beats ─────────────────────────────────────────
{
  const v = narrator(art({ h: "Majin Buu", u: "Bodyguard", g: "Son Goku", b: "Son Gohan" }));
  const say = (b: Beat) => narrate(b, v, undefined, { full: true });
  assert.equal(say({ t: "look", player: "p2", owner: "p2", area: "deck", count: 3, from: "top" }), "Claude looks at the top 3 cards of their deck.");
  assert.equal(say({ t: "look", player: "p1", owner: "p1", area: "deck", count: 1, from: "bottom" }), "You look at the bottom card of your deck.");
  assert.equal(say({ t: "look", player: "p2", owner: "p2", area: "deck", count: 40, search: true }), "Claude searches their deck.");
  assert.equal(say({ t: "look", player: "p2", owner: "p1", area: "hand", count: 6 }), "Claude looks at your hand.");
  assert.equal(say({ t: "shuffle", player: "p2", area: "deck" }), "Claude shuffles their deck.");
  assert.equal(narrate({ t: "shuffle", player: "p2", area: "deck" }, v), null, "a shuffle is not a decision: the ribbon keeps the sentence before it");
  assert.equal(say({ t: "under", card: "u", host: "h", owner: "p1", from: "battle" }), "Bodyguard goes under Majin Buu.");
  assert.equal(say({ t: "under", card: "u", host: "h", owner: "p2", from: "hand" }), "A card goes under Majin Buu.", "a card from a hand the viewer cannot see is not named");
  assert.equal(say({ t: "move", card: "g", from: "hand", to: "battle", owner: "p2", reveal: true, onto: "b" }), "Claude plays Son Goku on top of Son Gohan.");
  assert.equal(narrateRun([{ t: "mode", card: "g", mode: "rest" }, { t: "mode", card: "b", mode: "rest" }], v), "Son Goku and Son Gohan switch to Rest Mode.");
}

// ── timing ──────────────────────────────────────────────────────────────────
{
  const skill: Beat = { t: "skill", card: "c", label: "Auto", text: "", unread: false, owner: "p2", inBattle: false };
  const drawn: Beat = { t: "move", card: "d", from: "deck", to: "hand", owner: "p2" };
  assert.equal(msFor(skill, "explain", 0, null, { role: { kind: "callout", mine: false, steps: 1 } }), EXPLAIN.callout, "the opponent's callout");
  assert.equal(msFor(skill, "explain", 0, null, { role: { kind: "callout", mine: true, steps: 1 } }), EXPLAIN.calloutYours, "yours is shorter: you chose it");
  assert.equal(msFor(drawn, "explain", 0, null, { role: { kind: "step", index: 1, of: 1, hold: true, receipt: false } }), EXPLAIN.step, "a step is held at least long enough to read");
  assert.equal(msFor(drawn, "explain", 0, null, { role: { kind: "step", index: 1, of: 1, hold: true, receipt: true } }), EXPLAIN.step + EXPLAIN.receipt, "then the receipt");
  assert.equal(msFor(drawn, "explain", 0, null, { role: { kind: "step", index: 1, of: 2, hold: false, receipt: false } }), Math.round(TIER.bookkeeping * SLOW_FACTOR), "a beat leading into a step keeps its own rhythm");
  assert.equal(msFor(skill, "slow", 0, null, { role: { kind: "callout", mine: false, steps: 1 } }), Math.round(TIER.key * SLOW_FACTOR), "the roles are the Explain pace's alone");
  assert.equal(msFor(drawn, "explain"), Math.round(TIER.bookkeeping * SLOW_FACTOR), "outside a skill, Explain is Slow");
  assert.ok(EXPLAIN.callout >= 2400 && EXPLAIN.callout <= 3000 && EXPLAIN.step >= 1400 && EXPLAIN.receipt >= 1500, "the accepted numbers (13 Nov 2026)");

  // A card leaving play or changing hands is read, at every pace — a Swap's return to the hand above all.
  const move = (from: Extract<Beat, { t: "move" }>["from"], to: Extract<Beat, { t: "move" }>["to"], extra: Partial<Extract<Beat, { t: "move" }>> = {}): Extract<Beat, { t: "move" }> => ({ t: "move", card: "a", from, to, owner: "p2", ...extra });
  for (const m of [move("battle", "hand"), move("battle", "deck"), move("battle", "warp"), move("battle", "drop"), move("drop", "battle"), move("deck", "battle"), move("hand", "unison"), move("drop", "hand"), move("warp", "hand"), move("life", "hand", { reveal: true })]) {
    assert.ok(changesPlay(m), `${m.from} → ${m.to} changes what is in play or in hand`);
    assert.equal(msFor(m), TIER.key, `${m.from} → ${m.to} is a key moment`);
  }
  for (const m of [move("deck", "hand"), move("hand", "energy"), move("deck", "drop"), move("life", "hand"), move("combo", "drop")]) assert.equal(msFor(m), TIER.bookkeeping, `${m.from} → ${m.to} stays bookkeeping`);
  const ko: Beat = { t: "ko", card: "a", owner: "p2" };
  assert.equal(msFor(move("battle", "drop"), "normal", 0, null, { prev: ko }), TIER.bookkeeping, "a KO's own trip to the Drop is its tail: the KO was the moment");
  assert.equal(msFor({ t: "look", player: "p2", owner: "p2", area: "deck", count: 3 }), TIER.key, "a look is read");
}

// ── the engine: a real search, told across the decision ──────────────────────
{
  const s = stagedG({ hand: ["SEARCH"], energy: ["V1"] });
  const r1 = IMPL.apply(CTX, s, { type: "play", player: "p1", card: findG(s, "p1", "hand", "SEARCH") });
  const first = IMPL.toBeats(CTX, r1.state, r1.events, 0);
  const prompt = r1.state.prompt as Extract<typeof r1.state.prompt, { kind: "chooseCards" }>;
  const r2 = IMPL.apply(CTX, r1.state, { type: "choose", player: "p1", cards: [prompt.choice.candidates[0]] });
  const second = IMPL.toBeats(CTX, r2.state, r2.events, first.seq);
  const list = [...first.list, ...second.list];
  const roles = explainRoles(list, "p2");
  const kinds = list.map((b) => `${b.t}${roles.get(b.n) ? `(${roles.get(b.n)!.kind})` : ""}`);
  assert.deepEqual(kinds.slice(-5), ["skill(callout)", "look(step)", "resume(resume)", "move(step)", "shuffle(step)"], "from the other chair: the callout, the search, then the card taken and the shuffle");
  const told = explainMoment(list, list[list.length - 1].n, { viewer: "p2", them: "Claude", art: second.art })!;
  assert.deepEqual(told.moment.steps, ["Claude adds a card from the deck to hand.", "Claude shuffles their deck."], "the card taken stays a card: a search does not reveal it");
  assert.ok(zoneOf(r2.state, "p1", "hand").length >= 1);
}

// ── the engine: a card placed under another is a beat of its own ─────────────
{
  DEFS.UNDERHOST = card("UNDERHOST", { energyCost: 1, skill: "[Activate: Main] [Once per turn] Choose up to 1 of your other Battle Cards and place it under this card." });
  const s = stagedG({ battle: ["UNDERHOST", "V1"], energy: ["V1"] });
  const host = findG(s, "p1", "battle", "UNDERHOST");
  let r = IMPL.apply(CTX, s, { type: "activate", player: "p1", card: host, skill: 0 });
  let events = r.events;
  if (r.state.prompt.kind === "chooseCards") {
    const choice = (r.state.prompt as Extract<typeof r.state.prompt, { kind: "chooseCards" }>).choice;
    r = IMPL.apply(CTX, r.state, { type: "choose", player: "p1", cards: [choice.candidates[0]] });
    events = [...events, ...r.events];
  }
  const beats = IMPL.toBeats(CTX, r.state, events, 0).list;
  const under = beats.find((b): b is Extract<NumberedBeat, { t: "under" }> => b.t === "under");
  assert.ok(under, `a card placed under another is a beat (${beats.map((b) => b.t).join(" ")})`);
  assert.equal(under.host, host);
  assert.equal(under.from, "battle");
  assert.equal(r.state.cards[host].under.length, 1);
  delete DEFS.UNDERHOST;
}

// ── …and one placed under the card a play just put down is not that play's "on top of" ──
{
  // BT3-031's shape: the card is played, then its own skill puts a card under it. The play is not an Evolve.
  DEFS.PLAYUNDER = card("PLAYUNDER", { energyCost: 1, skill: "[Auto] When you play this card, choose up to 1 of your other Battle Cards and place it under this card." });
  const s = stagedG({ hand: ["PLAYUNDER"], battle: ["V1"], energy: ["V1"] });
  let r = IMPL.apply(CTX, s, { type: "play", player: "p1", card: findG(s, "p1", "hand", "PLAYUNDER") });
  let events = r.events;
  if (r.state.prompt.kind === "chooseCards") {
    const choice = (r.state.prompt as Extract<typeof r.state.prompt, { kind: "chooseCards" }>).choice;
    r = IMPL.apply(CTX, r.state, { type: "choose", player: "p1", cards: [choice.candidates[0]] });
    events = [...events, ...r.events];
  }
  const host = zoneOf(r.state, "p1", "battle").find((id) => r.state.cards[id].cardId === "PLAYUNDER")!;
  assert.equal(r.state.cards[host].under.length, 1, "the skill put a card under it");
  const beats = IMPL.toBeats(CTX, r.state, events, 0).list;
  const play = beats.find((b): b is Extract<NumberedBeat, { t: "move" }> => b.t === "move" && b.card === host && b.to === "battle");
  assert.ok(play && !play.onto, "the play is a plain play, not one on top of the card its skill placed later");
  assert.ok(beats.some((b) => b.t === "under" && b.host === host), `the card placed under it is its own beat (${beats.map((b) => b.t).join(" ")})`);
  delete DEFS.PLAYUNDER;
}

console.log("skill-explainer: grouping, words, timing and the engine's look, search, shuffle, resume and under beats — ok");
