/**
 * What the table hears (#463): the narration is decisions and outcomes only,
 * and it never names a card the viewer cannot see.
 *
 * A scripted game on whichever engine `--engine` named, with every card in
 * both decks a different name — so a name in a sentence is one instance, and
 * "names a hidden card" is a plain string check rather than a guess about
 * which copy was meant. Told beat by beat to both seats, through `maskBeats`
 * against the board as it stood after each move, exactly as the board's
 * ribbon and `foldStory` tell it.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, IMPL, arenaG, card, findG, maskBeats, narrate, zoneOf } from "./harness";
import type { Action, Beat, Beats, EngineState, NumberedBeat, PlayerId } from "./harness";
import { secretNames, tableTalk } from "../../src/lib/arena/ai/table-talk";

const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");
const FULL = { full: true };

// Fifty names a side. Cheap vanilla cards so both players play and attack
// every turn, and one Extra each that draws — the Extra is the narration's
// "used, not discarded" case.
const names = (side: string) => Array.from({ length: 48 }, (_, i) => `NAR${side}-${String(i).padStart(2, "0")}`);
for (const side of ["A", "B"]) {
  names(side).forEach((id, i) => (DEFS[id] = card(id, { energyCost: 1 + (i % 2), power: 5000 + 5000 * (i % 3), colors: [side === "A" ? "Red" : "Blue"] })));
  DEFS[`NAR${side}-EX1`] = card(`NAR${side}-EX1`, { type: "EXTRA", energyCost: 1, power: null, comboCost: null, comboPower: null, colors: [side === "A" ? "Red" : "Blue"], skill: "[Activate: Main] Draw 1 card." });
  DEFS[`NAR${side}-EX2`] = card(`NAR${side}-EX2`, { type: "EXTRA", energyCost: 1, power: null, comboCost: null, comboPower: null, colors: [side === "A" ? "Red" : "Blue"], skill: "[Activate: Main] Draw 1 card." });
}
// The Extras near the top, so they are drawn and used in the first turns.
const deckOf = (side: string) => [`NAR${side}-EX1`, ...names(side).slice(0, 10), `NAR${side}-EX2`, ...names(side).slice(10)];

const made = IMPL.createGame(CTX, { seed: 7, p1: { name: "You", leader: "L-RED", main: deckOf("A") }, p2: { name: "Claude", leader: "L-BLUE", main: deckOf("B") } });
let s: EngineState = made.state;
/** Every beat of the game, uncapped — `BEAT_CAP` is the queue's business, not this count's. */
let all: Beats = IMPL.toBeats(CTX, s, made.events, 0);

/** The names `viewer` may not know: the other side's hand, deck and face-down life, and their own deck and face-down life. */
const secretTo = (st: EngineState, viewer: PlayerId): string[] => {
  const ids = [
    ...zoneOf(st, other(viewer), "hand"),
    ...zoneOf(st, other(viewer), "deck"),
    ...zoneOf(st, other(viewer), "life"),
    ...zoneOf(st, viewer, "deck"),
    ...zoneOf(st, viewer, "life"),
  ].filter((id) => !st.cards[id].faceUp);
  return ids.map((id) => st.cards[id].cardId);
};

const told: Record<"story" | "full", Record<PlayerId, string[]>> = { story: { p1: [], p2: [] }, full: { p1: [], p2: [] } };

/** Tell `fresh` to both seats as the board would right now, and check no line names a secret. */
const tell = (st: EngineState, fresh: NumberedBeat[]) => {
  for (const viewer of ["p1", "p2"] as PlayerId[]) {
    const masked = maskBeats(st, { ...all, list: fresh }, viewer)!;
    const secret = secretTo(st, viewer);
    const n = { viewer, them: viewer === "p1" ? "Claude" : "Goku", art: masked.art, ownerOf: (id: string) => st.cards[id]?.owner ?? null };
    for (const b of masked.list) {
      for (const [mode, opts] of [["story", {}], ["full", FULL]] as const) {
        const line = narrate(b, n, undefined, opts);
        if (!line) continue;
        told[mode][viewer].push(line);
        for (const name of secret) assert.ok(!line.includes(name), `${viewer} is told "${line}" (${mode}), which names ${name} — hidden from ${viewer}`);
      }
      // The skill beat's own words are a face too (#463).
      if (b.t === "skill" && !(b.card in masked.art)) assert.ok(b.text === "" && b.label === "Skill", `${viewer} gets the text of a skill on a card they cannot see`);
    }
  }
};
tell(s, all.list);

const act = (a: Action) => {
  const r = IMPL.apply(CTX, s, a);
  s = r.state;
  const next = IMPL.toBeats(CTX, s, r.events, all.seq);
  all = { seq: next.seq, list: [...all.list, ...next.list], art: { ...all.art, ...next.art } };
  tell(s, next.list);
};

// The opening: p1 goes first, p1 keeps, p2 redraws — the mulligan that once
// named p2's bottom-decked hand once those cards were drawn and played.
const first = IMPL.legalActions(CTX, s).find((l) => l.action.type === "chooseFirst" && (l.action as { first?: string }).first === "p1") ?? IMPL.legalActions(CTX, s)[0];
act(first.action);
for (let i = 0; i < 4 && s.prompt.kind === "mulligan"; i++) {
  const p = (s.prompt as { player: PlayerId }).player;
  act({ type: "mulligan", player: p, redraw: p === "p2" });
}

// A plain policy: charge, play, use an Extra, attack, and otherwise pass or end.
for (let step = 0; step < 400 && s.phase !== "over"; step++) {
  const legal = IMPL.legalActions(CTX, s);
  if (!legal.length) break;
  const pick =
    legal.find((l) => /^Charge /.test(l.label)) ??
    legal.find((l) => /^Play /.test(l.label)) ??
    legal.find((l) => /^Activate NAR.-EX/.test(l.label)) ??
    legal.find((l) => /^Attack /.test(l.label) && s.turn > 1) ??
    legal.find((l) => /End turn|Pass|No|Don|Skip|Decline|Take/i.test(l.label)) ??
    legal[0];
  act(pick.action);
}

const beatsTold = all.list.length;
for (const viewer of ["p1", "p2"] as PlayerId[]) {
  const story = told.story[viewer].length;
  const full = told.full[viewer].length;
  // Every beat had a sentence before #463; now the table hears about a quarter.
  assert.ok(full >= beatsTold * 0.9, `the full log still narrates (nearly) every beat: ${full} of ${beatsTold}`);
  assert.ok(story > 20, `${viewer} hears the game: ${story} lines`);
  assert.ok(story <= full * 0.35, `${viewer} hears ${story} lines of ${full} (${Math.round((100 * story) / full)} %) — the table is told decisions and outcomes, not the board restated`);
  const lines = told.story[viewer];
  assert.ok(lines.some((l) => / turn begins\.$/.test(l)), "a turn is told as it begins");
  assert.ok(lines.some((l) => / charges? /.test(l)), "a charge is told");
  assert.ok(lines.some((l) => / plays? /.test(l)), "a play is told");
  assert.ok(lines.some((l) => / attacks /.test(l)), "an attack is told");
  assert.ok(lines.some((l) => / hits — /.test(l)), "a hit is told as its damage, in one line");
  assert.ok(!lines.some((l) => /switches to|Phase\.$|draws? |wins the clash|wears off/.test(l)), "nothing the board already shows is restated");
  assert.ok(!lines.some((l) => /discards? /.test(l)), "an Extra is never told as discarded");
}
assert.ok(s.phase === "over" || s.turn >= 6, `the scripted game got somewhere (turn ${s.turn}, ${s.phase})`);

// ── an Extra, used (#463) ────────────────────────────────────────────────────
//
// Staged rather than left to the shuffle: one Extra that draws, and one whose
// only target is an opposing Battle Card when there is none.
DEFS["NAR-EKO"] = card("NAR-EKO", { type: "EXTRA", energyCost: 1, power: null, comboCost: null, comboPower: null, skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and KO it." });
{
  let st = arenaG({ hand: ["E-DRAW", "NAR-EKO"], energy: ["V1", "V1"], oppHand: ["BIG"] });
  const activate = (id: string) => {
    const r = IMPL.apply(CTX, st, { type: "activate", player: "p1", card: findG(st, "p1", "hand", id), skill: 0 });
    st = r.state;
    const beats = IMPL.toBeats(CTX, st, r.events, 0);
    const skill = beats.list.find((b): b is Extract<NumberedBeat, { t: "skill" }> => b.t === "skill");
    assert.ok(skill, `${id} fired a skill beat`);
    const said = beats.list.map((b) => narrate(b, { viewer: "p1", them: "Claude", art: beats.art })).filter(Boolean);
    return { skill, said, theirs: beats.list.map((b) => narrate(b, { viewer: "p2", them: "Rival", art: maskBeats(st, beats, "p2")!.art })).filter(Boolean) };
  };
  const drew = activate("E-DRAW");
  assert.equal(drew.skill.extra, true, "an Extra from the hand is flagged as used");
  assert.ok(!drew.skill.noEffect, "and it drew, so it did something");
  assert.deepEqual(drew.said, ["You use E-DRAW (Extra) — [Activate: Main] Draw 2 cards."], "one line: used, with its discard folded in and its draws unsaid");
  assert.deepEqual(drew.theirs, ["Rival uses E-DRAW (Extra) — [Activate: Main] Draw 2 cards."], "the other seat hears the same line, and not what was drawn");
  const fizzled = activate("NAR-EKO");
  assert.equal(fizzled.skill.extra, true);
  assert.equal(fizzled.skill.noEffect, true, "no Battle Card to choose: it did nothing");
  assert.deepEqual(fizzled.said, ["You use NAR-EKO (Extra) — no target, so nothing happens."]);
}

// ── the mask on a skill beat (#463) ──────────────────────────────────────────
//
// A skill firing from a card that stays hidden — staged directly, since no
// card here fires from a hand: its text and tag name it as surely as its face
// does, and both go for the seat that cannot see it.
{
  const st = arenaG({ oppHand: ["BIG"] });
  const hidden = findG(st, "p2", "hand", "BIG");
  const beat: NumberedBeat = { t: "skill", card: hidden, label: "Activate: Main", text: "[Activate: Main] Draw 1 card.", unread: false, owner: "p2", inBattle: false, n: 1 };
  const q: Beats = { seq: 1, list: [beat], art: { [hidden]: { cardId: "BIG", name: "BIG", imageUrl: null } } };
  const forP1 = maskBeats(st, q, "p1")!;
  const b1 = forP1.list[0] as Extract<Beat, { t: "skill" }>;
  assert.equal(b1.text, "", "p1 is not given the text of p2's hidden card");
  assert.equal(b1.label, "Skill", "nor its tag");
  assert.equal(narrate(b1, { viewer: "p1", them: "Claude", art: forP1.art }), "Claude uses a skill.");
  const forP2 = maskBeats(st, q, "p2")!;
  assert.equal(forP2, q, "nothing to hide from p2, who holds the card: the same queue comes back");
}

// ── Claude's table talk (#463) ───────────────────────────────────────────────
{
  const inHand = zoneOf(s, "p2", "hand")[0] ?? zoneOf(s, "p2", "deck")[0];
  const handName = s.cards[inHand].cardId;
  const lifeName = s.cards[zoneOf(s, "p2", "life").find((id) => !s.cards[id].faceUp) ?? zoneOf(s, "p2", "deck")[1]].cardId;
  const deckName = s.cards[zoneOf(s, "p2", "deck")[0]].cardId;
  const secret = secretNames(CTX, s, "p2").map((x) => x.toUpperCase());
  for (const x of [handName, lifeName, deckName]) assert.ok(secret.includes(x), `${x} is one of Claude's secrets`);
  assert.ok(!secret.includes("L-BLUE"), "a leader is no secret");
  assert.equal(tableTalk(CTX, s, "p2", `Wait until you see ${handName}!`), null, "a line naming a card in Claude's hand is dropped");
  assert.equal(tableTalk(CTX, s, "p2", `My life has ${lifeName.toLowerCase()} in it.`), null, "and one naming a face-down life card, in any case");
  assert.equal(tableTalk(CTX, s, "p2", `${deckName} is coming.`), null, "and one naming a card in the deck");
  assert.equal(tableTalk(CTX, s, "p2", "Your move."), "Your move.", "a line naming nothing is kept");
  assert.equal(tableTalk(CTX, s, "p2", "  "), null);
  const onBoard = [...zoneOf(s, "p1", "battle"), ...zoneOf(s, "p1", "energy"), ...zoneOf(s, "p2", "drop")][0];
  if (onBoard) assert.equal(tableTalk(CTX, s, "p2", `Nice ${s.cards[onBoard].cardId}.`), `Nice ${s.cards[onBoard].cardId}.`, "a public card may be talked about");
}

console.log(`verify/narration: story ${told.story.p1.length} / full ${told.full.p1.length} lines for p1 over ${beatsTold} beats, turn ${s.turn}`);
