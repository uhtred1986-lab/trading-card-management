/** #907: compiler improvements never authorize replacing protected physical rows.
 * Frozen BT6-015 text -> stored JSON -> live static predicates, both seats. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cardDefFrom } from "../../src/lib/arena/load";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { forbids, permissions } from "../../src/lib/arena/vm/program";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { CTX, DEFS, card, fifty } from "./harness";
import { parseFilter, matches } from "../../src/lib/arena/text/filters";
import type { CardDef, EngineContext } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const frozen = JSON.parse(readFileSync("docs/arena-backlog/evidence/897/selected-pair-inputs-2026-10-19/catalog.json", "utf8")).cards;
const target = cardDefFrom(frozen.find((c: CardDef) => c.id === "BT6-015"));
const blocked = skillRecords(cardDefFrom(frozen.find((c: CardDef) => c.id === "BT6-001"))).find(r => r.side === "back" && r.skillIndex === 10)!;
assert.ok(blocked.unread.length, "BT6-001's incompletely read compound guard remains refused");
const defs = { ...DEFS, [target.id]: target,
  MONO907: card("MONO907", { type: "LEADER", colors: ["Red"], traits: ["Saiyan"] }),
  MULTI907: card("MULTI907", { type: "LEADER", colors: ["Red", "Blue"], traits: ["Saiyan"] }),
  BLUE907: card("BLUE907", { type: "LEADER", colors: ["Blue"], traits: ["Saiyan"] }),
  EARTH907: card("EARTH907", { type: "LEADER", colors: ["Red"], traits: ["Earthling"] }),
};
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const rows = Object.values(defs).flatMap(d => skillRecords(d).map(r => ({ ...r, status: "draft", source: "compiler" } as RuleRow)));
const rec = rows.find(r => r.cardId === target.id && r.skillIndex === 20)!;
assert.deepEqual(rec.unread, []);
assert.ok(Array.isArray(rec.ops));
assert.deepEqual(rec.ops.map((o: { op: string }) => o.op), ["forbid", "forbid", "permit"]);
const ctx: EngineContext = clone({ ...CTX, defs, scripts: rulesFromRows(clone(rows), defs) });
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
for (const seat of ["p1", "p2"] as const) for (const [leader, refused] of [["MONO907", false], ["MULTI907", true], ["BLUE907", true], ["EARTH907", true]] as const) {
  const s = clone(RULES.createGame(ctx, { seed: 907, p1: { name: "One", leader: seat === "p1" ? leader : "L-RED", main: fifty("V1") }, p2: { name: "Two", leader: seat === "p2" ? leader : "L-RED", main: fifty("V1") } }).state as VmState);
  const id = s.sides[seat].zones.deck[0]; s.cards[id].cardId = target.id;
  for (const area of ["hand", "drop", "battle"] as const) {
    assert.ok(moveCard(s, game, id, area, { owner: seat }).ok);
    for (const bySkill of [false, true]) assert.equal(forbids(ctx, game, clone(s), "play", { player: seat, card: id, bySkill }), refused, `${seat}/${leader}/${area}/${bySkill}: only mono-red Saiyan permits playing`);
  }
  assert.equal(forbids(ctx, game, clone(s), "beKOd", { card: id }), true, "independent KO immunity retained");
  assert.ok(permissions(ctx, game, clone(s), "attackActive").some(p => p.target === id && p.filter?.type === "BATTLE"), "active Battle attack permission retained");
}
for (const inserted of ["and draw 1 card", "and you send 1 card to your Warp"]) {
  const malformed = { ...target, skill: target.skill!.replace("card and it is red", `card ${inserted} and it is red`) };
  const row = skillRecords(malformed).find(r => r.skillIndex === 20)!;
  assert.ok(row.unread.length, "unrecognized action within leader identity cannot become readable");
}
const noOther = parseFilter("red and no other color Battle Card");
assert.equal(matches(card("R", { colors: ["Red"] }), noOther), true);
assert.equal(matches(card("RU", { colors: ["Red", "Blue"] }), noOther), false);
assert.equal(parseFilter("<Red and No Other Color>").monoColor, false, "character names do not create color constraints");
console.log("protected-grammar-907: same-leader mono-red predicate, all 3 effects, 2 seats; BT6-001 remains blocked; no DB writes");
