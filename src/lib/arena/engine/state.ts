/**
 * State helpers: where a card is, moving it (with the "new card" rules of
 * 3-1-4 and the removal rules for tokens and Z-cards), what its face says,
 * how much power it has, and paying costs. Everything mutates the state it
 * is given; `engine.ts` clones before calling.
 */
import { canCombo, hasKeyword, keywordOf, skillsOf, specifiedCostOf, isZ, baseType } from "./cards";
import type { Area, CardDef, CardFace, Color, ContinuousEffect, GameEvent, GameState, KeywordSkill, PlayerId, PlayerState, Skill } from "./types";
import { other } from "./types";

export interface GameContext {
  defs: Record<string, CardDef>;
}

export const LIFE_AT_START = 8;
export const OPENING_HAND = 6;

export function def(ctx: GameContext, s: GameState, id: string): CardDef {
  const inst = s.cards[id];
  if (!inst) throw new Error(`unknown card instance ${id}`);
  const d = ctx.defs[inst.cardId];
  if (!d) throw new Error(`no definition for ${inst.cardId}`);
  return d;
}

export function player(s: GameState, p: PlayerId): PlayerState {
  return s.players[p];
}

export interface Location {
  owner: PlayerId;
  area: Area;
  index: number;
}

/** Scan both players' areas for a card. Areas are small; a scan is fine. */
export function locate(s: GameState, id: string): Location | null {
  for (const p of ["p1", "p2"] as PlayerId[]) {
    const ps = s.players[p];
    if (ps.leader === id) return { owner: p, area: "leader", index: 0 };
    if (ps.unison === id) return { owner: p, area: "unison", index: 0 };
    for (const area of ["deck", "hand", "drop", "warp", "life", "battle", "combo", "energy", "zDeck", "zEnergy", "removed"] as const) {
      const i = ps[area].indexOf(id);
      if (i >= 0) return { owner: p, area, index: i };
    }
  }
  return null;
}

export function areaOf(s: GameState, id: string): Area | null {
  return locate(s, id)?.area ?? null;
}

export function inPlay(s: GameState, id: string): boolean {
  const a = areaOf(s, id);
  return a === "leader" || a === "battle" || a === "unison";
}

/** The side of a card that is up (10-1-3): a flipped leader shows its back. */
export function face(ctx: GameContext, s: GameState, id: string): CardFace {
  const inst = s.cards[id];
  const d = def(ctx, s, id);
  if (inst.hidden) return { name: "Hidden card", power: null, skill: null };
  if (inst.flipped && d.back) return { name: d.back.name, power: d.back.power, skill: d.back.skill };
  return { name: d.name, power: d.power, skill: d.skill };
}

export function skillsOfInstance(ctx: GameContext, s: GameState, id: string): Skill[] {
  const inst = s.cards[id];
  if (inst.hidden) return [];
  const d = def(ctx, s, id);
  return skillsOf(d, inst.flipped && d.back ? "back" : "front");
}

/** Keywords in force: printed (unless negated) plus granted by continuous effects. */
export function keywordsInForce(ctx: GameContext, s: GameState, id: string): KeywordSkill[] {
  const inst = s.cards[id];
  const out: KeywordSkill[] = [];
  if (!inst.hidden && inst.negated !== "all") {
    const d = def(ctx, s, id);
    const side = inst.flipped && d.back ? "back" : "front";
    for (const sk of skillsOf(d, side)) {
      if (inst.negated.includes(sk.index)) continue;
      if (sk.keyword) out.push(sk.keyword);
      // Keywords sharing the line with a typed skill ("[Auto][Blocker]") belong to that line.
      for (const tag of sk.tags) {
        const k = keywordOf(tag);
        if (k && k.name !== sk.keyword?.name && !out.some((o) => o.name === k.name)) out.push(k);
      }
    }
  }
  for (const e of s.effects) if (e.kind === "keyword" && e.target === id) out.push(e.value as KeywordSkill);
  return out;
}

export function has(ctx: GameContext, s: GameState, id: string, name: KeywordSkill["name"]): boolean {
  return keywordsInForce(ctx, s, id).some((k) => k.name === name);
}

export function keyword<N extends KeywordSkill["name"]>(ctx: GameContext, s: GameState, id: string, name: N): Extract<KeywordSkill, { name: N }> | null {
  return (keywordsInForce(ctx, s, id).find((k) => k.name === name) as Extract<KeywordSkill, { name: N }> | undefined) ?? null;
}

/**
 * Power as 9-9 computes it: printed face value, then non-numeric-rewrite
 * effects, then numeric ones. Combo power is added only in the Damage Step by
 * the battle code. Hidden cards and cards with no printed power count 0.
 */
export function powerOf(ctx: GameContext, s: GameState, id: string): number {
  const f = face(ctx, s, id);
  let p = f.power ?? 0;
  if (has(ctx, s, id, "Servant")) p += 10000;
  for (const e of s.effects) if (e.kind === "power" && e.target === id) p += e.value as number;
  return p;
}

export function comboPowerOf(ctx: GameContext, s: GameState, id: string): number {
  const d = def(ctx, s, id);
  let p = d.comboPower ?? 0;
  for (const e of s.effects) if (e.kind === "comboPower" && e.target === id) p += e.value as number;
  return p;
}

// ── moving cards ───────────────────────────────────────────────────────────

function list(ps: PlayerState, area: Area): string[] | null {
  if (area === "leader" || area === "unison") return null;
  return ps[area];
}

/** Take a card out of wherever it is. Returns where it was. */
export function detach(s: GameState, id: string): Location | null {
  const loc = locate(s, id);
  if (!loc) return null;
  const ps = s.players[loc.owner];
  if (loc.area === "leader") ps.leader = "";
  else if (loc.area === "unison") ps.unison = null;
  else {
    const l = list(ps, loc.area)!;
    l.splice(l.indexOf(id), 1);
  }
  return loc;
}

export interface MoveOptions {
  /** "top" is the default: new cards go on top of Drop/Warp/Life (3-4-3, 3-9-2, 3-10-2). Deck bottom is used by some skills. */
  position?: "top" | "bottom";
  /** Entering an open area from a secret one shows the card. */
  reveal?: boolean;
  /** Keep mode/markers/effects (3-1-4-1: battle→combo, combo→battle, gaining control). */
  carry?: boolean;
  /** A rule- or effect-caused move whose cause matters for triggers (KO). */
  reason?: "ko" | "effect" | "rule" | "cost" | "play" | "combo" | "damage" | "draw" | "charge";
}

/**
 * Move a card to an area. Applies: the card is new in its new area (3-1-4),
 * cards under it go to Drop when it leaves play (23-2-5), tokens leaving play
 * are removed (19-1-7), Z-cards leaving play are removed (14-1-4),
 * [Energy-Exhaust] enters energy in Rest Mode (22-31), [Ultimate] leaving
 * play is removed (22-14-3), and markers are dropped (5-13-3).
 * Returns the area the card actually ended in.
 */
export function move(ctx: GameContext, s: GameState, ev: GameEvent[], id: string, to: Area, toOwner: PlayerId, opts: MoveOptions = {}): Area {
  const inst = s.cards[id];
  const d = def(ctx, s, id);
  const from = locate(s, id);
  const wasInPlay = from?.area === "leader" || from?.area === "battle" || from?.area === "unison";
  const wasCombo = from?.area === "combo";
  const goesToPlay = to === "leader" || to === "battle" || to === "unison";
  const goesToCombo = to === "combo";

  // 19-1-7: tokens leaving battle/combo for anywhere else are removed.
  if (inst.isToken && (wasInPlay || wasCombo) && !goesToPlay && !goesToCombo) to = "removed";
  // 14-1-4 / 22-14-3: Z-cards and [Ultimate] cards leaving play are removed instead.
  if ((isZ(d) || hasKeyword(d, "Ultimate")) && (wasInPlay || wasCombo) && to !== "removed" && !goesToCombo && !goesToPlay) {
    to = "removed";
  }
  if (to === "removed") toOwner = inst.owner;
  // 3-1-6-1: only leader/battle/unison/combo may belong to the opponent.
  if (toOwner !== inst.owner && !goesToPlay && !goesToCombo) toOwner = inst.owner;

  detach(s, id);

  // 23-2-5: leaving play for a differently named area drops the cards underneath.
  if ((wasInPlay || wasCombo) && !goesToPlay && !goesToCombo && inst.under.length) {
    const under = inst.under.splice(0);
    for (const u of under) {
      const ud = ctx.defs[s.cards[u].cardId];
      const dest: Area = isZ(ud) ? "removed" : "drop";
      s.players[s.cards[u].owner][dest].unshift(u);
      ev.push({ type: "move", card: u, from: from!.area, to: dest, owner: s.cards[u].owner });
    }
  }

  const carry = !!opts.carry || ((wasInPlay || wasCombo) && (goesToPlay || goesToCombo));
  if (!carry) {
    inst.mode = "active";
    inst.markers = 0;
    inst.flipped = false;
    inst.hidden = false;
    inst.negated = [];
    inst.usedThisTurn = [];
    inst.extraAttacks = 0;
    s.effects = s.effects.filter((e) => e.target !== id);
  }
  if (goesToPlay || goesToCombo) inst.enteredTurn = s.turn;
  // 22-31: [Energy-Exhaust] enters the Energy Area rested.
  if (to === "energy" && hasKeyword(d, "Energy-Exhaust")) inst.mode = "rest";

  const ps = s.players[toOwner];
  if (to === "leader") ps.leader = id;
  else if (to === "unison") ps.unison = id;
  else {
    const l = list(ps, to)!;
    if (opts.position === "bottom") l.push(id);
    else if (to === "deck" || to === "drop" || to === "warp" || to === "life" || to === "removed") l.unshift(id);
    else l.push(id);
  }
  ev.push({ type: "move", card: id, from: from?.area ?? "removed", to, owner: toOwner, reveal: opts.reveal });
  return to;
}

export function draw(ctx: GameContext, s: GameState, ev: GameEvent[], p: PlayerId, n = 1): number {
  const ps = s.players[p];
  let drawn = 0;
  for (let i = 0; i < n; i++) {
    const id = ps.deck[0];
    if (!id) break;
    move(ctx, s, ev, id, "hand", p, { reason: "draw" });
    ev.push({ type: "draw", player: p, card: id });
    drawn++;
  }
  return drawn;
}

export function setMode(s: GameState, ev: GameEvent[], id: string, mode: "active" | "rest"): boolean {
  const inst = s.cards[id];
  if (inst.mode === mode) return false; // 0-2-4-1: already in that state
  inst.mode = mode;
  ev.push({ type: "mode", card: id, mode });
  return true;
}

export function addEffect(s: GameState, ev: GameEvent[], e: Omit<ContinuousEffect, "id" | "createdTurn" | "ownerTurn">): ContinuousEffect {
  const full: ContinuousEffect = { ...e, id: s.nextEffectId++, createdTurn: s.turn, ownerTurn: s.turnPlayer };
  s.effects.push(full);
  ev.push({ type: "effect", effect: full });
  return full;
}

export function endEffects(s: GameState, until: ContinuousEffect["until"], forPlayer?: PlayerId): void {
  s.effects = s.effects.filter((e) => !(e.until === until && (forPlayer == null || e.ownerTurn === forPlayer)));
}

// ── costs (5-3, 5-4, 5-6) ──────────────────────────────────────────────────

export function activeEnergy(s: GameState, p: PlayerId): string[] {
  return s.players[p].energy.filter((id) => s.cards[id].mode === "active");
}

export function leaderColors(ctx: GameContext, s: GameState, p: PlayerId): Color[] {
  const l = s.players[p].leader;
  return l ? def(ctx, s, l).colors : [];
}

export interface Payment {
  /** Energy cards to switch to Rest Mode. */
  rest: string[];
  /** Energy markers to remove (1-14-2). */
  markers: number;
}

/**
 * Find energy to pay `total` with the coloured orbs in `specified`. Explicit
 * choices are validated; otherwise the engine picks: specified colours from
 * mono-colour matches first, then the rest from whatever is most plentiful,
 * then energy markers. Returns null when the cost can't be paid (5-3-3).
 */
export function planPayment(ctx: GameContext, s: GameState, p: PlayerId, total: number, specified: Partial<Record<Color, number>>, explicit?: string[]): Payment | null {
  const active = activeEnergy(s, p);
  const ps = s.players[p];
  const leader = leaderColors(ctx, s, p);
  const colorsOf = (id: string) => def(ctx, s, id).colors;

  if (explicit) {
    if (explicit.some((id) => !active.includes(id))) return null;
    const markers = Math.max(0, total - explicit.length);
    if (markers > ps.energyMarkers) return null;
    if (explicit.length + markers !== total) return null;
    // Check the specified colours are covered by the chosen cards (+ markers as leader colour).
    const need = { ...specified };
    for (const id of explicit) {
      for (const c of colorsOf(id)) {
        if ((need[c] ?? 0) > 0) {
          need[c]!--;
          break;
        }
      }
    }
    let m = markers;
    for (const c of leader) while (m > 0 && (need[c] ?? 0) > 0) {
      need[c]!--;
      m--;
    }
    if (Object.values(need).some((n) => (n ?? 0) > 0)) return null;
    return { rest: explicit, markers };
  }

  const chosen: string[] = [];
  const pool = active.slice();
  const need = { ...specified };
  // Specified orbs: prefer a mono-colour card of that colour, then any card with it.
  for (const c of Object.keys(need) as Color[]) {
    for (let n = need[c] ?? 0; n > 0; n--) {
      let pick = pool.find((id) => colorsOf(id).length === 1 && colorsOf(id)[0] === c) ?? pool.find((id) => colorsOf(id).includes(c));
      if (!pick && leader.includes(c) && ps.energyMarkers > chosen.filter((x) => x === "#marker").length) pick = "#marker";
      if (!pick) return null;
      chosen.push(pick);
      if (pick !== "#marker") pool.splice(pool.indexOf(pick), 1);
    }
  }
  // Remaining generic cost: spend the colour we have most of, keep scarce colours.
  while (chosen.length < total) {
    if (pool.length === 0) {
      const markersUsed = chosen.filter((x) => x === "#marker").length;
      if (ps.energyMarkers > markersUsed) {
        chosen.push("#marker");
        continue;
      }
      return null;
    }
    const counts = new Map<string, number>();
    for (const id of pool) counts.set(colorsOf(id).join("/"), (counts.get(colorsOf(id).join("/")) ?? 0) + 1);
    let best = pool[0];
    for (const id of pool) if ((counts.get(colorsOf(id).join("/")) ?? 0) > (counts.get(colorsOf(best).join("/")) ?? 0)) best = id;
    chosen.push(best);
    pool.splice(pool.indexOf(best), 1);
  }
  return { rest: chosen.filter((x) => x !== "#marker"), markers: chosen.filter((x) => x === "#marker").length };
}

export function pay(s: GameState, ev: GameEvent[], p: PlayerId, payment: Payment): void {
  for (const id of payment.rest) setMode(s, ev, id, "rest");
  if (payment.markers) {
    s.players[p].energyMarkers -= payment.markers;
    ev.push({ type: "energyMarker", player: p, delta: -payment.markers });
  }
}

/** 5-4: Z-Energy costs are paid by moving that many Z-Energy cards to Drop. */
export function payZEnergy(ctx: GameContext, s: GameState, ev: GameEvent[], p: PlayerId, n: number): boolean {
  const ps = s.players[p];
  if (ps.zEnergy.length < n) return false;
  for (let i = 0; i < n; i++) move(ctx, s, ev, ps.zEnergy[ps.zEnergy.length - 1], "drop", p, { reason: "cost" });
  return true;
}

/** Total + specified cost of playing a card from hand, after cost-reducing effects (none modelled yet). */
export function playCost(ctx: GameContext, s: GameState, id: string, x = 0): { total: number; specified: Partial<Record<Color, number>> } {
  const d = def(ctx, s, id);
  const total = d.energyCost === "X" ? x : (d.energyCost ?? 0);
  const specified = d.energyCost === "X" ? {} : specifiedCostOf(d);
  const owner = s.cards[id].owner;
  // 22-19: [Warrior of Universe 7] on a card the player controls removes specified costs of Universe 7 cards.
  if (d.traits.some((t) => /universe 7/i.test(t)) && [s.players[owner].leader, ...s.players[owner].battle].some((c) => c && has(ctx, s, c, "Warrior of Universe 7"))) {
    return { total, specified: {} };
  }
  return { total, specified };
}

export function canAffordPlay(ctx: GameContext, s: GameState, p: PlayerId, id: string, x = 0): boolean {
  const c = playCost(ctx, s, id, x);
  const d = def(ctx, s, id);
  if (d.zEnergyCost != null && s.players[p].zEnergy.length < d.zEnergyCost) return false;
  return planPayment(ctx, s, p, c.total, c.specified) !== null;
}

export function canAffordCombo(ctx: GameContext, s: GameState, p: PlayerId, id: string): boolean {
  const d = def(ctx, s, id);
  if (!canCombo(d)) return false;
  return planPayment(ctx, s, p, d.comboCost ?? 0, {}) !== null;
}

// ── misc ───────────────────────────────────────────────────────────────────

export function opponent(s: GameState, p: PlayerId): PlayerId {
  return other(p);
}

export function isLeader(ctx: GameContext, s: GameState, id: string): boolean {
  return baseType(def(ctx, s, id)) === "LEADER" || areaOf(s, id) === "leader";
}

export function cardsInPlay(s: GameState, p: PlayerId): string[] {
  const ps = s.players[p];
  return [ps.leader, ...(ps.unison ? [ps.unison] : []), ...ps.battle].filter(Boolean);
}

export function note(ev: GameEvent[], text: string): void {
  ev.push({ type: "note", text });
}
