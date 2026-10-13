/**
 * #757 U1-c shared fixtures: the real deck cards of the #649 audit snapshot
 * (`docs/arena-backlog/evidence/649/catalog-subset-2026-10-13.json`), compiled by the repo's compiler
 * and played on the rules engine (`RULES`). Unison specified costs are the owner's ruling
 * (`docs/arena-backlog/evidence/655/owner-specified-costs-2026-10-13.json`). Not a suite itself.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CTX, DEFS, card, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { cardDefFrom } from "../../src/lib/arena/load";
import { parseSpecifiedCost } from "../../src/lib/arena/specified-cost";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { attrsNow, hasKeyword, keywordsInForce } from "../../src/lib/arena/vm/program";
import { withTokens } from "../../src/lib/arena/vm/cards";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";

export const rules = RULES;
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
export const game = loaded.definition;

const snapshot = JSON.parse(readFileSync("docs/arena-backlog/evidence/649/catalog-subset-2026-10-13.json", "utf8")) as { cards: { id: string }[] };
const ownerCosts = (JSON.parse(readFileSync("docs/arena-backlog/evidence/655/owner-specified-costs-2026-10-13.json", "utf8")) as { specifiedCosts: Record<string, string> }).specifiedCosts;
export const printed = (id: string, extra: Partial<CardDef> = {}): CardDef => {
  const row = snapshot.cards.find((c) => c.id === id);
  assert.ok(row, `${id} is in the audit snapshot`);
  const def = cardDefFrom(row as Parameters<typeof cardDefFrom>[0]);
  return { ...def, ...(ownerCosts[id] ? { specifiedCost: parseSpecifiedCost(ownerCosts[id])! } : {}), ...extra };
};

export const defs: Record<string, CardDef> = { ...DEFS };
for (const c of snapshot.cards) defs[c.id] = printed(c.id);
// Synthetic fodder that only carries colour / traits, never a skill under test.
defs.RED757 = card("RED757", { colors: ["Red"], skill: null, characters: ["Fodder"], traits: ["Saiyan"], energyCost: 1, power: 10000 });
defs.BLUE757 = card("BLUE757", { colors: ["Blue"], skill: null, energyCost: 1, power: 10000 });
defs.BLUEBIG757 = card("BLUEBIG757", { colors: ["Blue"], skill: null, energyCost: 1, power: 30000 });
defs.YEL757 = card("YEL757", { colors: ["Yellow"], skill: null, energyCost: 1, power: 10000, traits: ["Goku's Lineage"] });
defs.EXTRA757 = card("EXTRA757", { type: "EXTRA", colors: ["Red"], skill: null, energyCost: 1, power: null, comboCost: null, comboPower: null });
defs.REMOVER757 = card("REMOVER757", { colors: ["Blue"], energyCost: 0, skill: "[Activate: Main] Choose up to 1 of your opponent's Unison Cards and place it in its owner's Drop Area." });
defs.REMOVER757B = card("REMOVER757B", { colors: ["Blue"], energyCost: 0, skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and place it in its owner's Drop Area." });
export const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromCompiler(defs) };

export const reload = (s: VmState): VmState => JSON.parse(JSON.stringify(s));
export type Out = { state: VmState; events: GameEvent[] };
export const apply = (s: VmState, action: Action): Out => rules.apply(ctx, reload(s), action) as Out;
export const legal = (s: VmState) => rules.legalActions(ctx, s);
export const zone = (s: VmState, p: PlayerId, z: string): string[] => (s.sides[p].zones as Record<string, string[]>)[z] ?? [];
export const kw = (s: VmState, id: string, name: string): boolean => hasKeyword(ctx, game, s, id, name as never);
/** Damage a [Strike] keyword in force would inflict: 1 without one, X with the largest [Strike X]. */
export const strikeX = (s: VmState, id: string): number => Math.max(1, ...keywordsInForce(ctx, game, s, id).filter((k) => k.name === "Strike").map((k) => (k as { x?: number }).x ?? 1));
export const cardOf = (s: VmState, id: string) => s.cards[id].cardId;
export const power = (s: VmState, id: string): number => Number(attrsNow(withTokens(ctx), game, s, id).power);

/** A game at p1's Main Phase (turn 1) with both hands and energy areas put back under the decks. */
export function mainPhase(opts: { leader1?: string; leader2?: string; seed?: number; turn?: 1 | 2 | 3 } = {}): VmState {
  let s = rules.createGame(ctx, { seed: opts.seed ?? 757, p1: { name: "P1", leader: opts.leader1 ?? "SD15-01", main: fifty("V1") }, p2: { name: "P2", leader: opts.leader2 ?? "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  s = apply(s, { type: "chooseFirst", player: (s.prompt as { player: PlayerId }).player, first: "p1" }).state;
  s = apply(s, { type: "mulligan", player: "p1", redraw: false }).state;
  s = apply(s, { type: "mulligan", player: "p2", redraw: false }).state;
  s = apply(s, { type: "charge", player: "p1", card: null }).state;
  // Turn 2 is p2's Main Phase; turn 3 is p1's second (the first player cannot attack on turn 1, 6-5-... first turn).
  if ((opts.turn ?? 1) >= 2) {
    s = apply(s, { type: "endMain", player: "p1" }).state;
    s = apply(s, { type: "charge", player: "p2", card: null }).state;
  }
  if (opts.turn === 3) {
    s = apply(s, { type: "endMain", player: "p2" }).state;
    s = apply(s, { type: "charge", player: "p1", card: null }).state;
  }
  assert.equal(s.prompt.kind, "main");
  for (const p of ["p1", "p2"] as const) {
    for (const id of s.sides[p].zones.hand.slice()) assert.ok(moveCard(s, game, id, "deck", { owner: p, position: "bottom" }).ok);
    for (const id of s.sides[p].zones.energy.slice()) assert.ok(moveCard(s, game, id, "deck", { owner: p, position: "bottom" }).ok);
  }
  return s;
}
export type Area = "battle" | "unison" | "hand" | "energy" | "drop" | "life" | "combo";
export function stage(s: VmState, p: PlayerId, cardId: string, area: Area, mode: "active" | "rest" = "active"): string {
  const id = s.sides[p].zones.deck[0];
  assert.ok(id, "deck has a card to stage");
  s.cards[id].cardId = cardId;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok, `could not stage ${cardId} into ${area}`);
  s.cards[id].mode = mode;
  s.pending = [];
  return id;
}
export const energy = (s: VmState, p: PlayerId, n: number, cardId = "RED757"): string[] => Array.from({ length: n }, () => stage(s, p, cardId, "energy"));
export function setLife(s: VmState, p: PlayerId, n: number): void {
  const life = s.sides[p].zones.life;
  while (life.length > n) assert.ok(moveCard(s, game, life[life.length - 1], "deck", { owner: p, position: "bottom" }).ok);
  while (life.length < n) stage(s, p, "BLUE757", "life");
}

export interface Drive { s: VmState; events: GameEvent[] }
type Pick = (s: VmState, options: Action[]) => Action | undefined | "stop";
/**
 * Answer prompts until `stop`. `pick` may return an action for the current prompt; otherwise optional
 * prices are paid, modes take index 0, a choice takes the first legal answer, and windows pass.
 */
export function drive(from: VmState, stop: (s: VmState) => boolean, pick?: Pick, log: GameEvent[] = []): Drive {
  let s = from;
  for (let i = 0; i < 80 && !stop(s); i++) {
    const options = legal(s).map((l) => l.action).filter((a) => a.type !== "concede");
    let a = pick?.(s, options);
    if (a === "stop") break;
    a ??=
      options.find((o) => o.type === "zEnergyFromCombo" && o.card === null) ?? // 8-5-2: leave the combo cards for the Drop Area
      options.find((o) => o.type === "optionalCost" && o.pay) ??
      options.find((o) => o.type === "chooseMode" && o.index === 0) ??
      options.find((o) => o.type === "choose") ??
      options.find((o) => o.type === "orderPending") ??
      options.find((o) => o.type === "pass") ??
      options.find((o) => o.type === "block" && o.card === null) ??
      options.find((o) => o.type === "counter" && o.card === null) ??
      options[0];
    assert.ok(a, `stopped at ${s.prompt.kind} with nothing to answer`);
    const r = apply(s, a);
    log.push(...r.events);
    s = r.state;
  }
  assert.ok(stop(s), `never reached the stop state (at ${s.prompt.kind})`);
  return { s, events: log };
}
export const atMain = (s: VmState) => s.prompt.kind === "main";
export const had = (ev: GameEvent[], t: (e: GameEvent) => boolean) => ev.some(t);

/** `player` attacks `target` (default: the opponent's Leader) with `attacker`, answering with `pick` until `stop`. */
export function attack(s: VmState, attacker: string, o: { player?: PlayerId; target?: string; stop?: (s: VmState) => boolean; pick?: Pick } = {}): Drive {
  const player = o.player ?? "p1";
  const target = o.target ?? s.sides[player === "p1" ? "p2" : "p1"].zones.leader[0];
  const first = apply(s, { type: "attack", player, attacker, target });
  return drive(first.state, o.stop ?? atMain, o.pick, [...first.events]);
}
export function activate(s: VmState, cardId: string, skill: number, o: { player?: PlayerId; stop?: (s: VmState) => boolean; pick?: Pick } = {}): Drive {
  const player = o.player ?? "p1";
  const options = legal(s).map((l) => l.action).filter((a) => a.type === "activate" && a.card === cardId && a.skill === skill);
  assert.ok(options.length, `${cardOf(s, cardId)} #${skill} is offered`);
  const first = apply(s, options[0]);
  void player;
  return drive(first.state, o.stop ?? atMain, o.pick, [...first.events]);
}
export { DEFS, card, fifty, moveCard };

/** The skills this suite family has played, as `CARD#index` (back face `CARDb#index`); the conditions suite checks them against the audit. */
export const played = new Set<string>();
export const mark = (...keys: string[]): void => keys.forEach((k) => played.add(k));
