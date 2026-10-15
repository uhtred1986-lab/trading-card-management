/** #826 numeric/keyword-only synthetic fixtures; compiler-built rules and real
 * engine response windows. No card text/rulings are invented for real cards. */
import type { CardDef } from "../../src/lib/arena/types";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { DBS_FILES } from "../../src/lib/arena/rulesets/dbs";
import { makeReplayBundle } from "../../src/lib/arena/replay-core";
import { applyMove, type PinnedMatch } from "../../src/lib/arena/browser";
import { mainPhaseMatch, stage, type Layout } from "./arena-policy-main-fixture";

export const STRATEGY_REVISION = "a826000000000000000000000000000000000826";
export const STRATEGY_SEED = 826;
const card = (id: string, power: number, extra: Partial<CardDef> = {}): CardDef => ({ id,name:id,type:"BATTLE",colors:["Red"],energyCost:1,zEnergyCost:null,
  power,comboCost:0,comboPower:5000,skill:null,characters:[id],traits:[],...extra });
const cards = [card("S-L10",10000,{type:"LEADER",energyCost:null,comboCost:null,comboPower:null}),
  card("S-L20",20000,{type:"LEADER",energyCost:null,comboCost:null,comboPower:null}), card("S-5",10000),
  card("S-10",15000,{energyCost:3,comboCost:1,comboPower:10000}), card("S-15",15000), card("S-25",25000),
  card("S-CRIT",10000,{skill:"[Critical]"}), card("S-DS25",25000,{skill:"[Double Strike]"})];
export async function strategyBundle() {
  const defs = Object.fromEntries(cards.map((c) => [c.id,c]));
  const compiled = rulesFromCompiler(defs);
  const scripts = Object.fromEntries(cards.map((c) => [c.id,compiled[c.id]]));
  for(const c of cards) if(!scripts[c.id]?.complete) throw new Error(`strategy fixture ${c.id} unsupported`);
  const base = await makeReplayBundle({ defs,scripts,art:Object.fromEntries(cards.map((c) => [c.id,{front:`/art/${c.id}.png`,back:null}])),rulesetFiles:DBS_FILES,runtime:STRATEGY_REVISION });
  const main = Array.from({length:50},(_,i) => cards[2+i%6].id);
  return { ...base,decks:{p1:{name:"Strategy attacker",leader:"S-L10",main},p2:{name:"Strategy defender",leader:"S-L10",main}} };
}
export async function strategyOpening(bundle: Awaited<ReturnType<typeof strategyBundle>>) {
  return mainPhaseMatch(bundle,STRATEGY_SEED,STRATEGY_REVISION);
}
export function layout(opening: PinnedMatch, p1: Layout, p2: Layout, p2Leader="S-L10") {
  const match=stage(opening,{p1,p2});
  match.state.cards[match.state.sides.p2.zones.leader[0]].cardId=p2Leader;
  // Test setup owns actual Life identities. Policy receives only its restricted
  // observation; Life-to-hand proof compares engine zones after the battle.
  for(const p of ["p1","p2"] as const) for(const id of match.state.sides[p].zones.life) match.state.cards[id].cardId="S-5";
  return match;
}
export function declare(match: PinnedMatch, cardId: string) {
  const attacker=match.state.sides.p1.zones.battle.find((id) => match.state.cards[id].cardId===cardId)!;
  return applyMove(match,{type:"attack",player:"p1",attacker,target:match.state.sides.p2.zones.leader[0]}).match;
}
