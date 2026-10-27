/**
 * #930, BT4-018 front#0 — "[Union Absorb] Choose 1 of your Battle Cards and
 * place it under this card: If your Leader Card is a red ≪Machine Mutant≫,
 * choose up to 1 <Baby> with an energy cost of 4 or less **with the same
 * character name as the card you placed under this card** from your deck, and
 * play it on top of this card. Then, shuffle your deck."
 *
 * The price binds its choice (`choose … as c0`, then `moveTo under`); the
 * search's filter carries `sameCharacterAs: c0`, read in `resolveSelector`
 * against the placed card's **printed** character names. Owner's ruling of
 * 25 Oct 2026 (#930): once under this card the material is a new card (3-1-4),
 * so a character name it gained in the Battle Area does not count.
 *
 * Printed text -> skills -> stored-row JSON round trip -> the real VM, both
 * seats, every step reloaded. Source: docs/rules/rulemanual.txt 22-13-6,
 * 2-10-1-1, 3-1-4; BT4-018's official Q&A (searching the deck; no energy cost
 * for a skill play) — docs/arena-backlog/evidence/923/official-references.json.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { attrsNow } from "../../src/lib/arena/vm/program";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { describeScript } from "../../src/lib/arena/vm/script";
import { describeFilter } from "../../src/lib/arena/vm/script-schema";
import type { Action, CardDef, Color, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const BT4_018 = "[Union Absorb] Choose 1 of your Battle Cards and place it under this card: If your Leader Card is a red ≪Machine Mutant≫, choose up to 1 <Baby> with an energy cost of 4 or less with the same character name as the card you placed under this card from your deck, and play it on top of this card. Then, shuffle your deck.";

const bc = (id: string, characters: string[], o: Partial<CardDef> = {}) => card(id, { colors: ["Red"] as Color[], characters, traits: ["Machine Mutant"], power: 10000, energyCost: 2, skill: null, ...o });
const defs: Record<string, CardDef> = { ...DEFS,
  "BT4018": bc("BT4018", ["Baby"], { energyCost: 3, power: 15000, skill: BT4_018 }),
  "L-MM": card("L-MM", { type: "LEADER", colors: ["Red"], characters: ["Baby"], traits: ["Machine Mutant"], power: 0, energyCost: 0, skill: null }),
  // Materials.
  "M-BABY": bc("M-BABY", ["Baby"]),
  "M-VEG": bc("M-VEG", ["Vegeta"]),
  "M-GOKU": bc("M-GOKU", ["Son Goku"]),
  // Search targets: every one a <Baby>, so only the comparison tells them apart.
  "T-BABY": bc("T-BABY", ["Baby"], { energyCost: 4, power: 25000 }),
  "T-BABYVEG": bc("T-BABYVEG", ["Baby", "Vegeta"], { energyCost: 4, power: 25000 }),
  "T-BABY5": bc("T-BABY5", ["Baby", "Vegeta"], { energyCost: 5, power: 30000 }),
  "T-BABYVEGPART": bc("T-BABYVEGPART", ["Baby", "Vegeta: Xeno"], { energyCost: 4, power: 25000 }),
};

// ── 1. the reading ───────────────────────────────────────────────────────────
const rec = skillRecords(defs.BT4018)[0];
{
  assert.deepEqual(rec.unread, [], "BT4-018: nothing unread");
  const price = rec.cost?.program ?? [];
  assert.equal(describeScript(price), "choose 1 Battle Card in your Battle Area, move the chosen cards to under", "the price chooses one Battle Card and places it under this card");
  const bound = price.find((o) => o.op === "choose");
  assert.ok(bound && bound.op === "choose" && bound.as === "c0", "the price binds its card as c0");
  const search = rec.ops.find((o) => o.op === "choose");
  assert.ok(search && search.op === "choose", "the effect searches");
  if (search?.op !== "choose") throw new Error("unreachable");
  assert.equal(search.sel.area, "deck", "…the deck, not the cards under this one");
  assert.equal(search.sel.filter?.sameCharacterAs, "c0", "…for the price's card's character name");
  assert.notEqual(search.as, "c0", "the search does not rebind the name it compares against");
  assert.deepEqual([search.sel.filter?.characters, search.sel.filter?.costMax, search.sel.upTo], [["Baby"], 4, true], "<Baby>, cost 4 or less, up to 1 are kept");
  assert.match(describeScript(rec.ops), /^choose up to 1 <Baby> card with an energy cost of 4 or less with the same character name as the card you placed under this card in your deck, play the chosen cards through a \[Counter: Play\] window on top of this card, shuffle$/);
  assert.equal(rec.cond?.kind, "leaderMatches", "the Leader condition is kept");
  assert.match(describeFilter(search.sel.filter!), /with the same character name as the card you placed under this card/);

  // Not this price, nothing to compare with: unread, never a search against nothing.
  const unread = (text: string) => skillRecords(card("X", { skill: text }))[0];
  const ko = unread("[Activate: Main] Choose 1 of your Battle Cards and KO it: Choose up to 1 <Baby> with the same character name as the card you placed under this card from your deck and add it to your hand.");
  assert.ok(ko.unread.length > 0 && !JSON.stringify(ko.ops).includes("sameCharacterAs"), "a price that places nothing under this card leaves the comparison unread");
  const two = unread("[Union Absorb] Choose 2 of your Battle Cards and place them under this card: Choose up to 1 <Baby> with the same character name as the card you placed under this card from your deck, and play it on top of this card.");
  assert.ok(two.unread.length > 0, "two cards placed are not 'the card you placed'");
  // The sibling wording "…same name as the chosen card" is read only against a choice the effect itself made (P-440,
  // mechanism batch 2, `sameNameAs`); naming a price's choice it stays refused.
  const chosen = unread("[Activate: Main] Choose 1 of your Battle Cards and place it under this card: Choose up to 1 card with the same name as the chosen card from your deck and add it to your hand.");
  assert.ok(chosen.unread.length > 0, "'the same name as the chosen card' is still unread");
}

// ── 2. the VM ────────────────────────────────────────────────────────────────
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;

function take(s: VmState, action: Action): VmState {
  return roundtrip(RULES.apply(ctx, roundtrip(s), action).state as VmState);
}
function fresh(seat: PlayerId, seed: number): VmState {
  const leaders = { p1: seat === "p1" ? "L-MM" : "L-BLUE", p2: seat === "p2" ? "L-MM" : "L-BLUE" };
  let s = RULES.createGame(ctx, { seed, p1: { name: "First", leader: leaders.p1, main: fifty("V1") }, p2: { name: "Second", leader: leaders.p2, main: fifty("V-BLUE") } }).state as VmState;
  for (const action of [
    { type: "chooseFirst", player: s.chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null }, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null },
    ...(seat === "p1" ? [{ type: "endMain", player: "p2" }, { type: "charge", player: "p1", card: null }] : []),
  ] as Action[]) s = take(s, action);
  for (const p of ["p1", "p2"] as const) for (const area of ["hand", "energy"] as const) for (const id of s.sides[p].zones[area].slice()) assert.ok(moveCard(s, game, id, "deck", { owner: p }).ok);
  return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: string): string {
  const id = s.sides[p].zones.deck.at(-1)!; s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok); return id;
}
const unionIndex = parseSkills(BT4_018).find((sk) => sk.keyword?.name === "Union")!.index;
const offer = (s: VmState, c: string) => RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === c && l.action.skill === unionIndex);

/**
 * Declare BT4-018, pay with `material`, and answer the deck search with the
 * first offered card (or none). Returns the final state and what the search offered.
 */
function absorb(s0: VmState, seat: PlayerId, abs: string, material: string, takeOne = true): { s: VmState; offered: string[] | null } {
  const o = offer(s0, abs);
  assert.ok(o, `${seat}: BT4-018 is offered`);
  let s = take(s0, o.action);
  let offered: string[] | null = null;
  for (let i = 0; i < 20 && s.prompt.kind !== "main"; i++) {
    const q = s.prompt;
    if (q.kind === "chooseCards" && q.choice.candidates.includes(material)) s = take(s, { type: "choose", player: q.player, cards: [material] });
    else if (q.kind === "chooseCards") {
      offered = q.choice.candidates.map((c) => s.cards[c].cardId);
      s = take(s, { type: "choose", player: q.player, cards: takeOne && q.choice.candidates.length ? [q.choice.candidates[0]] : [] });
    } else if (q.kind === "payCost") s = take(s, { type: "payCost", player: seat, option: 0 } as Action);
    else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: q.player, index: 0 } as Action);
    else s = take(s, { type: "pass", player: (q as { player: PlayerId }).player } as Action);
  }
  assert.equal(s.prompt.kind, "main");
  return { s, offered };
}
const onTop = (s: VmState, seat: PlayerId, def: string) => s.sides[seat].zones.battle.find((c) => s.cards[c].cardId === def);

for (const seat of ["p1", "p2"] as const) {
  const board = (material: string, deck: string[], seed: number) => {
    const s = fresh(seat, seed);
    const abs = stage(s, seat, "BT4018", "battle");
    const mat = stage(s, seat, material, "battle");
    // Rewritten in place in the deck: the deck is searched, not added to.
    const targets = deck.map((d, i) => { const id = s.sides[seat].zones.deck[i]; s.cards[id].cardId = d; return id; });
    return { s, abs, mat, targets };
  };

  // The placed card prints <Baby>: a <Baby> of cost 4 is found and played on top.
  {
    const b = board("M-BABY", ["T-BABY", "T-BABY5"], 4180);
    const { s, offered } = absorb(b.s, seat, b.abs, b.mat);
    assert.deepEqual(offered, ["T-BABY"], `${seat}: the printed name of the placed card matches; the cost-5 copy is still refused`);
    const top = onTop(s, seat, "T-BABY");
    assert.ok(top, "the found <Baby> is played");
    assert.deepEqual(new Set(s.cards[top!].under), new Set([b.abs, b.mat]), "on top of this card, with the placed card in its pile");
  }

  // Several character names: a placed <Vegeta> finds a card that is both <Baby> and <Vegeta>, not one that is <Baby> only,
  // and not "Vegeta: Xeno" (2-10-1-1: another name).
  {
    const b = board("M-VEG", ["T-BABY", "T-BABYVEGPART", "T-BABYVEG"], 4181);
    const { s, offered } = absorb(b.s, seat, b.abs, b.mat);
    assert.deepEqual(offered, ["T-BABYVEG"], `${seat}: one shared printed character name is enough; a partial name is not one`);
    assert.ok(onTop(s, seat, "T-BABYVEG"));
  }

  // A name gained in the Battle Area does not count (owner's ruling, 25 Oct 2026): a <Vegeta>
  // treated as <Baby> as well is, once under this card, a <Vegeta> again.
  {
    const b = board("M-VEG", ["T-BABY"], 4182);
    addEffect(b.s, [], { kind: "gains", target: b.mat, value: { names: [], characters: ["Baby"], traits: [], colors: [] }, until: "turn", source: b.mat, master: seat });
    assert.deepEqual(attrsNow(ctx, game, b.s, b.mat).characters, ["Vegeta", "Baby"], "staged: in the Battle Area the material is a <Baby> too");
    const { s, offered } = absorb(b.s, seat, b.abs, b.mat);
    assert.ok(offered === null || offered.length === 0, `${seat}: the gained <Baby> is not the placed card's name`);
    assert.equal(onTop(s, seat, "T-BABY"), undefined, "nothing is played");
    assert.ok(s.sides[seat].zones.battle.includes(b.abs), "this card stays, the material under it");
    assert.ok(s.cards[b.abs].under.includes(b.mat), "the price stays paid");
    assert.ok(s.sides[seat].zones.deck.includes(b.targets[0]), "the <Baby> stays in the deck");
  }

  // No match: nothing found, nothing played, the deck is still shuffled and the price paid.
  {
    const b = board("M-GOKU", ["T-BABY", "T-BABYVEG"], 4183);
    const deckBefore = b.s.sides[seat].zones.deck.length;
    const { s, offered } = absorb(b.s, seat, b.abs, b.mat);
    assert.ok(offered === null || offered.length === 0, `${seat}: a placed <Son Goku> finds no <Baby>`);
    assert.equal(onTop(s, seat, "T-BABY") ?? onTop(s, seat, "T-BABYVEG"), undefined);
    assert.equal(s.sides[seat].zones.deck.length, deckBefore, "the deck keeps its cards");
    assert.ok(s.cards[b.abs].under.includes(b.mat), "the price stays paid");
  }

  // Up to 1: a match may be declined.
  {
    const b = board("M-BABY", ["T-BABY"], 4184);
    const { s, offered } = absorb(b.s, seat, b.abs, b.mat, false);
    assert.deepEqual(offered, ["T-BABY"]);
    assert.equal(onTop(s, seat, "T-BABY"), undefined, `${seat}: declined, nothing is played`);
  }

  // The Leader condition is the effect's, after the colon: without a red ≪Machine Mutant≫ Leader
  // the cost is still paid, and nothing is searched for or played.
  {
    const b = board("M-BABY", ["T-BABY"], 4185);
    b.s.cards[b.s.sides[seat].zones.leader[0]].cardId = "L-BLUE";
    const { s, offered } = absorb(b.s, seat, b.abs, b.mat);
    assert.equal(offered, null, `${seat}: no Machine Mutant Leader, no search`);
    assert.equal(onTop(s, seat, "T-BABY"), undefined, "nothing is played");
    assert.ok(s.cards[b.abs].under.includes(b.mat), "the price is paid");
  }
}

console.log("absorb-placed-name-930: BT4-018 'same character name as the card you placed under this card' — printed names, both seats");
