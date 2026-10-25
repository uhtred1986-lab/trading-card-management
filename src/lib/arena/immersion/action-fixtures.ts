/**
 * Small public fixtures for the character-action contract (#1103): masked numbered beats and the board
 * a viewer sees, with the contract cues each beat must sound. Used by `scripts/verify/arena-immersion.mts`
 * and free for a preview to replay. Synthetic presentation data, not rule evidence.
 */
import type { BeatArt, NumberedBeat } from "../beats";
import type { CardView } from "../view";
import type { PlayerId } from "../types";
import type { ActionCueId } from "./types";

type FixtureCard = Pick<CardView, "id" | "cardId" | "name" | "hidden" | "flipped">;
export interface ActionFixture {
  name: "attack-hit-damage" | "attack-hit-ko" | "block" | "negate" | "repel" | "hidden-source" | "cancelled";
  about: string;
  viewer: PlayerId;
  /** The viewer's current board by instance id; a missing id has left the board. */
  cards: Record<string, FixtureCard>;
  art: Record<string, BeatArt>;
  beats: NumberedBeat[];
  /** Contract cues per beat, in beat order. */
  cues: ActionCueId[][];
}

/** Goku's reviewed leader front (BT1-056) and Battle Cards Cabba (BT1-014) and Vegeta (BT1-038) are reviewed mappings. */
const goku: FixtureCard = { id: "p1-leader", cardId: "BT1-056", name: "Son Goku", hidden: false, flipped: false };
const vegeta: FixtureCard = { id: "p2-vegeta", cardId: "BT1-038", name: "Vegeta", hidden: false, flipped: false };
const cabba: FixtureCard = { id: "p1-cabba", cardId: "BT1-014", name: "Saiyan Cabba", hidden: false, flipped: false };
const blocker: FixtureCard = { id: "p2-blocker", cardId: "TEST-001", name: "Unmapped Blocker", hidden: false, flipped: false };
const board = { [goku.id]: goku, [vegeta.id]: vegeta, [blocker.id]: blocker };
const art = (...cards: FixtureCard[]): Record<string, BeatArt> => Object.fromEntries(cards.map((c) => [c.id, { cardId: c.cardId, name: c.name, imageUrl: null }]));
const attack: NumberedBeat = { n: 1, t: "attack", attacker: goku.id, target: vegeta.id };
const release: ActionCueId[] = ["attack.buildup", "attack.release"];

export const ACTION_FIXTURES: readonly ActionFixture[] = [
  {
    name: "attack-hit-damage",
    about: "Leader attacks the opposing leader, wins the clash, the defender takes 2 damage.",
    viewer: "p1",
    cards: board,
    art: art(goku),
    beats: [{ n: 1, t: "attack", attacker: goku.id, target: "p2-leader" }, { n: 2, t: "clash", attacker: goku.id, guard: "p2-leader", attackPower: 20000, guardPower: 15000, hit: true }, { n: 3, t: "damage", player: "p2", amount: 2, critical: false, cards: [], by: goku.id }],
    cues: [release, ["impact.hit"], ["damage"]],
  },
  {
    name: "attack-hit-ko",
    about: "Leader attacks a Battle Card and wins; the KO is its own beat, never implied by the hit.",
    viewer: "p1",
    cards: board,
    art: art(goku, vegeta),
    beats: [attack, { n: 2, t: "clash", attacker: goku.id, guard: vegeta.id, attackPower: 20000, guardPower: 10000, hit: true }, { n: 3, t: "ko", card: vegeta.id, owner: "p2" }],
    cues: [release, ["impact.hit"], ["ko"]],
  },
  {
    name: "block",
    about: "The attack is redirected: the actual blocker reacts, not the original target.",
    viewer: "p1",
    cards: board,
    art: art(goku, vegeta, blocker),
    beats: [attack, { n: 2, t: "block", guard: vegeta.id, by: blocker.id }],
    cues: [release, ["reaction.block"]],
  },
  {
    name: "negate",
    about: "The attack is negated; the negate names no character.",
    viewer: "p1",
    cards: board,
    art: art(goku),
    beats: [attack, { n: 2, t: "negated" }],
    cues: [release, ["reaction.negate"]],
  },
  {
    name: "repel",
    about: "The clash is lost: the guard repels, never a hit.",
    viewer: "p1",
    cards: board,
    art: art(goku, vegeta),
    beats: [attack, { n: 2, t: "clash", attacker: goku.id, guard: vegeta.id, attackPower: 10000, guardPower: 15000, hit: false }],
    cues: [release, ["reaction.repel"]],
  },
  {
    name: "hidden-source",
    about: "The attacker is concealed from this viewer. Even with a mapped face behind it, nothing reveals it.",
    viewer: "p2",
    cards: { ...board, [goku.id]: { ...goku, hidden: true } },
    art: art(goku),
    beats: [attack],
    cues: [release],
  },
  {
    name: "cancelled",
    about: "The attacker leaves the Battle Area before the battle resolves: no clash, so no hit, damage or KO.",
    viewer: "p1",
    cards: board,
    art: art(cabba),
    beats: [{ n: 1, t: "attack", attacker: cabba.id, target: vegeta.id }, { n: 2, t: "move", card: cabba.id, from: "battle", to: "drop", owner: "p1" }],
    cues: [release, []],
  },
];

/** The fixture's board as the `cardOf` a host passes. */
export function fixtureCardOf(fixture: ActionFixture): (id: string) => CardView | null {
  return (id) => (fixture.cards[id] as CardView | undefined) ?? null;
}
