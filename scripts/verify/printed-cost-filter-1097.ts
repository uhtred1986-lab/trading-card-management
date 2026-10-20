/**
 * #1097 (owner ruling, 20 Oct 2026): a cost filter ("cost 3 or less", "an energy cost of N or
 * more") reads a card's PRINTED energy cost. A [Permanent] increase or a 20-21 reduction changes
 * only what is paid (`costOf`), never what a filter sees.
 *
 * BT3-005's printed text is not in the repo (the catalog lives in the database), so its skill is
 * reconstructed from the issue and the batch-3 receipt: "[Permanent] When your life is at 4 or
 * less, increase the energy cost of this card in your Battle Area by 2." Printed cost 3.
 * The KO is an Extra's [Activate: Main], the shape the receipt's engine proof used.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { withTokens } from "../../src/lib/arena/vm/cards";
import { attrsNow } from "../../src/lib/arena/vm/program";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";

const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;

const BT3_005 = "[Permanent] When your life is at 4 or less, increase the energy cost of this card in your Battle Area by 2.";
const KO3 = "[Activate: Main] Choose 1 of your opponent's Battle Cards with an energy cost of 3 or less and KO it.";

const defs: Record<string, CardDef> = {
  ...DEFS,
  KO1097: card("KO1097", { type: "EXTRA", colors: ["Red"], energyCost: 0, power: null, comboCost: null, comboPower: null, skill: KO3 }),
  GOKU1097: card("GOKU1097", { name: "Determined Super Saiyan Son Goku", colors: ["Red"], energyCost: 3, skill: BT3_005 }),
  PLAIN1097: card("PLAIN1097", { colors: ["Red"], energyCost: 3, skill: null }),
  BIG1097: card("BIG1097", { colors: ["Red"], energyCost: 5, skill: null }),
};
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" }) as unknown as RuleRow));
const ctx: EngineContext = withTokens({ ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) });
const apply = (s: VmState, a: Action): VmState => RULES.apply(ctx, roundtrip(s), a).state as VmState;

function board(seed: number): VmState {
  let s = RULES.createGame(ctx, { seed, p1: { name: "One", leader: "L-RED", main: fifty("V1") }, p2: { name: "Two", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  s = apply(s, { type: "chooseFirst", player: s.chooser, first: "p1" });
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) s = apply(s, { type: "pass", player: (s.prompt as { player: PlayerId }).player });
  assert.equal(s.turnPlayer, "p1");
  assert.equal(s.prompt.kind, "main");
  return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: "battle" | "hand"): string {
  const id = s.sides[p].zones.deck[0];
  assert.ok(id);
  s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (area === "battle") s.cards[id].mode = "active";
  return id;
}
/** Leave `n` cards in p2's life by dropping the rest. */
function lifeTo(s: VmState, n: number): void {
  while (s.sides.p2.zones.life.length > n) assert.ok(moveCard(s, game, s.sides.p2.zones.life[0], "drop", { owner: "p2" }).ok);
  assert.equal(s.sides.p2.zones.life.length, n);
}
/** p2 has BT3-005 and `others` in play at `life`; p1 activates the "cost 3 or less" KO. */
function koOffer(life: number, others: string[] = []): { s: VmState; goku: string; offered: string[]; others: string[] } {
  const s = board(1097_000 + life);
  const ko = stage(s, "p1", "KO1097", "hand");
  const goku = stage(s, "p2", "GOKU1097", "battle");
  const extra = others.map((d) => stage(s, "p2", d, "battle"));
  lifeTo(s, life);
  const line = RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === ko);
  assert.ok(line, "the KO Extra is offered");
  const t = apply(s, line.action);
  assert.equal(t.prompt.kind, "chooseCards");
  return { s, goku, offered: t.prompt.kind === "chooseCards" ? t.prompt.choice.candidates : [], others: extra };
}

// Life 5: no increase, costOf 3, a legal target.
{
  // A second target keeps the choice from being made for the player.
  const { s, goku, offered } = koOffer(5, ["PLAIN1097"]);
  assert.equal(attrsNow(ctx, game, s, goku).costOf, 3);
  assert.ok(offered.includes(goku), "life 5: printed 3, costOf 3, a legal target");
}
// Life 4: the +2 still applies to what is charged (costOf 5), but the filter reads the printed 3.
{
  const { s, goku, offered, others: [big, plain] } = koOffer(4, ["BIG1097", "PLAIN1097"]);
  const attrs = attrsNow(ctx, game, s, goku);
  assert.equal(attrs.costOf, 5, "the +2 still applies to what is charged");
  assert.equal(attrs.energyCost, 3, "the printed cost is untouched");
  assert.ok(offered.includes(goku), "life 4: a 'cost 3 or less' KO may still target BT3-005 (#1097 ruling)");
  assert.ok(offered.includes(plain), "a printed cost 3 is a target");
  assert.ok(!offered.includes(big), "a printed cost 5 is not");
}
