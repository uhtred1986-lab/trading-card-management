/** #910: public printed BT25/EX24 text; shared subject, real stored rows and VM. */
import assert from "node:assert/strict";
import printed from "./fixtures/shenron-910.json";
import { CTX, fifty, card } from "./harness";
import { compileSkill } from "../../src/lib/arena/compile";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { RULES } from "../../src/lib/arena/vm";
import { attrsNow } from "../../src/lib/arena/vm/program";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";

const loaded = rulesetFor("dbs"); assert.ok(loaded.ok);
const game = loaded.definition;
const defs = Object.fromEntries((printed as CardDef[]).map(d => [d.id, d]));
defs.CONTROL910 = card("CONTROL910", { type: "Z-UNISON", power: 20000, traits: ["Saiyan"], skill: null });
defs.IDENTITY910 = card("IDENTITY910", { type: "Z-UNISON", traits: ["Earthling"], characters: ["Bulma"], skill: "[Permanent] This card can’t attack and gains ≪Shenron≫ in all areas." });
defs.PAY910 = card("PAY910", { traits: ["Power Wish"], skill: null });
const rows = Object.values(defs).flatMap(d => skillRecords(d)).map((r, i) => ({ ...r, id: i+1, status: r.unread.length ? "open" : "draft", source: "compiler", version: 1 })) as unknown as RuleRow[];
const ctx: EngineContext = { defs: { ...CTX.defs, ...defs }, scripts: { ...CTX.scripts, ...rulesFromRows(JSON.parse(JSON.stringify(rows)), defs) } };
const wishIds = printed.filter(d => d.id.startsWith("BT25-")).map(d => d.id);
for (const id of wishIds) {
  const p = ctx.scripts![id].bySkill[0];
  assert.deepEqual(p.unsupported, [], id);
  assert.equal(p.ops.length, 2);
  assert.equal(p.ops[0].op, "forbid");
  assert.equal(p.ops[1].op, "gains");
  if (p.ops[1].op === "gains") {
    assert.deepEqual(p.ops[1].traits, ["shenron"]);
    assert.equal(p.ops[1].allAreas, true);
    assert.deepEqual(p.ops[1].target, { sel: { special: "self" } });
  }
}
const compile = (text: string) => compileSkill(parseSkills(`[Permanent] ${text}`)[0]);
// No cross-sentence or ambiguous antecedent inference, and no invented area.
for (const text of [
  "Your opponent's card can't attack and gains ≪Shenron≫ in all areas.",
  "This card and your Leader can't attack and gains ≪Shenron≫ in all areas.",
  "This card can't attack. Gains ≪Shenron≫ in all areas.",
  "This card can't attack and gains ≪Shenron≫ in your Z-Deck.",
]) assert.ok(compile(text).unsupported.length, text);
const differentSubject = compile("This card can't attack and your Leader gains ≪Shenron≫ in all areas.");
assert.ok(!differentSubject.ops.some(op => op.op === "gains" && op.target && "sel" in op.target && op.target.sel.special === "self"), "explicit Leader subject became self");
const ordinary = compile("This card can't attack and gains ≪Shenron≫.");
assert.deepEqual(ordinary.unsupported, []);
assert.ok(ordinary.ops.every(op => op.op !== "gains" || !op.allAreas));
assert.deepEqual(compile("This card cannot attack and gains ≪Saiyan≫ in all areas.").unsupported, [], "not hardcoded to Shenron");

function apply(s: VmState, action: Action): VmState { return RULES.apply(ctx, s, action).state as VmState; }
function board(): VmState {
  let s = RULES.createGame(ctx, { seed: 910, p1: {name:"P1",leader:"EX24-01",main:fifty("V1")}, p2:{name:"P2",leader:"L-BLUE",main:fifty("V-BLUE")} }).state as VmState;
  s = apply(s, {type:"chooseFirst",player:s.chooser,first:"p1"});
  for(let i=0;i<20 && s.prompt.kind!=="main";i++) s=apply(s,{type:"pass",player:(s.prompt as {player:PlayerId}).player});
  assert.equal(s.prompt.kind,"main");
  // Advance through both turns so attack refusal is not the first-turn ban.
  s=apply(s,{type:"endMain",player:"p1"});
  for(let i=0;i<30 && !(s.prompt.kind==="main" && s.prompt.player==="p1");i++) {
    const player=(s.prompt as {player:PlayerId}).player;
    s=apply(s,s.prompt.kind==="main" ? {type:"endMain",player} : {type:"pass",player});
  }
  assert.equal(s.turn,3);
  assert.equal(s.prompt.kind,"main");
  s.cards[s.sides.p1.zones.leader[0]].flipped=true;
  return s;
}
function stage(s: VmState, id: string, area: "unison" | "zDeck" | "zEnergy", player:PlayerId="p1"):string {
  const physical=s.sides[player].zones.deck[0]; assert.ok(physical);
  s.cards[physical].cardId=id;
  assert.ok(moveCard(s,game,physical,area,{owner:player}).ok);
  s.cards[physical].markers=2;
  return physical;
}
for (const id of wishIds) for (const area of ["zDeck","unison"] as const) {
  const s=board(); const target=stage(s,id,area);
  const a=attrsNow(ctx,game,s,target);
  assert.ok((a.traits as string[]).some(t=>t.toLowerCase()==="shenron"),`${id} ${area}`);
  assert.equal(a.type,defs[id].type);
  assert.equal(a.name,defs[id].name);
  for(const t of defs[id].traits) assert.ok((a.traits as string[]).includes(t));
  assert.deepEqual(ctx.defs[id],defs[id],"printed identity mutated");
  if(area==="unison") {
    assert.ok(!RULES.legalActions(ctx,s).some(l=>l.action.type==="attack" && l.action.attacker===target));
    assert.throws(()=>apply(s,{type:"attack",player:"p1",attacker:target,target:s.sides.p2.zones.leader[0]}));
  }
}
// Additive means existing traits/characters survive, including from secret areas.
{
  const s=board(); const target=stage(s,"IDENTITY910","zDeck");
  const a=attrsNow(ctx,game,s,target);
  assert.deepEqual(a.traits,["Earthling","shenron"]);
  assert.deepEqual(a.characters,["Bulma"]);
  assert.equal(a.name,"IDENTITY910");
}
// Real EX24-01 back activation, including its cost and optional target menu.
{
  let s=board();
  const target=stage(s,"BT25-138","unison");

  const foreign=stage(s,"BT25-139","unison","p2");
  const payment=stage(s,"PAY910","zEnergy");
  const wrongPayment=stage(s,"V1","zEnergy");
  const leader=s.sides.p1.zones.leader[0];
  const active=RULES.legalActions(ctx,s).find(l=>l.action.type==="activate" && l.action.card===leader && l.action.skill===10);
  assert.ok(active,"real back skill available with Power Wish cost");
  s=apply(s,active.action);
  assert.ok(s.sides.p1.zones.deck.includes(payment), "real activation paid its Power Wish cost");
  assert.equal(s.sides.p1.zones.deck.at(-1),payment,"payment goes to deck bottom");
  assert.ok(s.sides.p1.zones.zEnergy.includes(wrongPayment),"non-Power Wish card not paid");
  assert.equal(s.prompt.kind,"chooseCards");
  if(s.prompt.kind!=="chooseCards") throw new Error("missing marker target");
  assert.deepEqual(s.prompt.choice.candidates,[target],"only own Shenron Z-Unison eligible");
  assert.ok(!s.prompt.choice.candidates.includes(foreign));
  assert.throws(()=>apply(s,{type:"choose",player:"p1",cards:[foreign]}));
  s=apply(s,{type:"choose",player:"p1",cards:[target]});
  assert.equal(s.cards[target].markers,3);
  assert.equal(s.cards[foreign].markers,2);
}
{
  const s=board(); stage(s,"BT25-138","unison"); stage(s,"V1","zEnergy");
  assert.ok(!RULES.legalActions(ctx,s).some(l=>l.action.type==="activate" && l.action.card===s.sides.p1.zones.leader[0]),"no valid Power Wish cost refuses activation");
}
{
  let s=board(); const control=stage(s,"CONTROL910","unison"); stage(s,"PAY910","zEnergy");
  assert.ok(!(attrsNow(ctx,game,s,control).traits as string[]).includes("shenron"));
  assert.ok(RULES.legalActions(ctx,s).some(l=>l.action.type==="attack" && l.action.attacker===control),"unrestricted control Z-Unison can attack at this timing");
  s=apply(s,{type:"activate",player:"p1",card:s.sides.p1.zones.leader[0],skill:10});
  assert.equal(s.cards[control].markers,2,"non-Shenron Z-Unison never gains a marker");
  if(s.prompt.kind==="chooseCards") assert.ok(!s.prompt.choice.candidates.includes(control));
}
// The leave-Unison search and Pilaf's permission are proved in power-wish-910.ts; here only that they now read.
assert.deepEqual(rows.find(r=>r.cardId==="EX24-01" && r.side==="back" && r.skillIndex===0)!.unread,[],"leave-Unison search reads (#910 supporting effects)");
assert.deepEqual(rows.find(r=>r.cardId==="EX24-03" && r.skillIndex===10)!.unread,[],"Pilaf's Z-Deck permission reads (#910 supporting effects)");
console.log("  ok #910: seven real Permanents, stored rows, self/area boundaries, all-area identity, attack refusal, EX24 marker cost/targets; leave-search and Pilaf now read");
