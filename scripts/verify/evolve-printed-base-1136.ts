/**
 * #1136 (owner ruling, 20 Oct 2026, follow-up to #1097): the energy cost an [Evolve] base is
 * matched against is the PRINTED cost. A 20-21 reduction or a [Permanent] increase changes only
 * what is paid.
 *
 * Real card text: BT6-014's [EX-Evolve] names "Red <Gogeta: Br> card with an energy cost of 6"
 * for its base (catalog input of #897). The code matches the base through the stored
 * `evolution.base.filter` (costMin = costMax = 6) with `energyCost` = max(printed, specified orbs).
 * The bases here are synthetic Gogeta: Br cards; the increase is the BT3-005 [Permanent] wording.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cardDefFrom } from "../../src/lib/arena/load";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { attrsNow } from "../../src/lib/arena/vm/program";
import { CTX, DEFS, card, fifty } from "./harness";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const catalog = JSON.parse(readFileSync("docs/arena-backlog/evidence/897/selected-pair-inputs-2026-10-19/catalog.json", "utf8")).cards;
const PERM = "[Permanent] When your life is at 4 or less, increase the energy cost of this card in your Battle Area by 2.";
const defs: Record<string, CardDef> = {
  ...DEFS,
  LE1136: card("LE1136", { type: "LEADER", traits: ["Saiyan"] }),
  RED1136: card("RED1136", {}),
  PRINT6: card("PRINT6", { energyCost: 6, characters: ["Gogeta: Br"] }),
  PRINT8: card("PRINT8", { energyCost: 8, characters: ["Gogeta: Br"] }),
  PRINT4: card("PRINT4", { energyCost: 4, characters: ["Gogeta: Br"], skill: PERM }),
  FLOOR1136: card("FLOOR1136", { energyCost: 5, specifiedCost: { Red: 6 }, characters: ["Gogeta: Br"] }),
};
defs["BT6-014"] = cardDefFrom(catalog.find((c: CardDef) => c.id === "BT6-014"));
assert.match(defs["BT6-014"].skill ?? "", /energy cost of 6/i, "the real card names a cost for its base");
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" }) as unknown as RuleRow));
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const apply = (s: VmState, a: Action): VmState => RULES.apply(ctx, roundtrip(s), a).state as VmState;

function board(seed: number, baseCard: string): { s: VmState; source: string; base: string } {
  let s = RULES.createGame(ctx, { seed, p1: { name: "One", leader: "LE1136", main: fifty("V1") }, p2: { name: "Two", leader: "LE1136", main: fifty("V1") } }).state as VmState;
  s = apply(s, { type: "chooseFirst", player: s.chooser, first: "p1" });
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) s = apply(s, { type: "pass", player: (s.prompt as { player: PlayerId }).player });
  assert.equal(s.prompt.kind, "main");
  const put = (def: string, area: string): string => {
    const id = s.sides.p1.zones.deck.find((i) => s.cards[i].cardId === "V1");
    assert.ok(id); s.cards[id].cardId = def;
    assert.ok(moveCard(s, game, id, area, { owner: "p1" }).ok);
    return id;
  };
  const source = put("BT6-014", "hand"); const base = put(baseCard, "battle"); put("RED1136", "hand"); put("RED1136", "hand");
  return { s, source, base };
}
const offered = (s: VmState, source: string) => RULES.legalActions(ctx, roundtrip(s)).some((l) => l.action.type === "activate" && l.action.card === source && l.action.skill === 0);

// Control: a printed 6 is the base the card names.
{ const { s, source } = board(1136_1, "PRINT6"); assert.ok(offered(s, source), "printed 6 qualifies"); }
// A reduction changes only what is paid: printed 6 reduced to 4 still qualifies.
{
  const { s, source, base } = board(1136_2, "PRINT6");
  addEffect(s, [], { target: base, kind: "cost", value: 2, until: "turn", master: "p1" });
  assert.equal(attrsNow(ctx, game, s, base).costOf, 4, "the reduction applies to what is paid");
  assert.ok(offered(s, source), "printed 6, reduced to 4: still a base for 'energy cost of 6'");
}
// A printed 8 reduced to 6 is not a base (the current cost no longer counts).
{
  const { s, source, base } = board(1136_3, "PRINT8");
  addEffect(s, [], { target: base, kind: "cost", value: 2, until: "turn", master: "p1" });
  assert.equal(attrsNow(ctx, game, s, base).costOf, 6);
  assert.ok(!offered(s, source), "printed 8, reduced to 6: not a base");
}
// A [Permanent] increase: printed 4 at life 4 has costOf 6 and is not a base.
{
  const { s, source, base } = board(1136_4, "PRINT4");
  while (s.sides.p1.zones.life.length > 4) assert.ok(moveCard(s, game, s.sides.p1.zones.life[0], "drop", { owner: "p1" }).ok);
  const attrs = attrsNow(ctx, game, s, base);
  assert.equal(attrs.costOf, 6, "the [Permanent] +2 applies to what is paid");
  assert.equal(attrs.energyCost, 4);
  assert.ok(!offered(s, source), "printed 4, increased to 6: not a base");
}
// The specified orbs still floor the matched number: printed 5, six specified orbs reads as 6.
{ const { s, source } = board(1136_5, "FLOOR1136"); assert.ok(offered(s, source), "specified orbs keep flooring the printed cost"); }
