import { skillPriceProblem } from "./skill-payment";
/** Auto payment planning and its stored checkpoint continuation (#549). */
import type { EngineContext, GameEvent, PlayerId, Skill } from "../types";
import type { GameDefinition } from "../rulesets";
import { selectedCount, stepScript, type Op, type Ref, type Script, type ScriptFrame } from "./script";
import type { ScriptHost } from "./script-host";
import { vmHost } from "./host";
import { boundFor, queueTaxGate, scopedPayersSpent, type TaxGate } from "./activate";
import { IllegalAction, sideOf } from "./common";
import { NotYet, RulesetBroken } from "./errors";
import { describeScript } from "./script-schema";
import { activeEnergy, cardColors, chargeCost, payersFor, planCost, priceFor, spendSkillCostUses, type Price, type VmPayment } from "./costs";
import { log } from "./events";
import { hasPossibleReplacement, possibleAltPaymentReplacement, staticsNow } from "./program";
import type { VmState } from "./state";
import { skillsShowing } from "./triggers";
import { inPlayZones } from "./zones";
import { spendUse } from "./limits";
import { canCombo } from "../text/cards";

/** 5-8-4: a legal replacement failed an attempted payment. Retain the
 * already performed payment/replacement, then cancel activation. */
export class AutoPaymentFailed extends Error {}

/** 9-6-4: all costs are optional to pay; a condition alone is compulsory. */
export interface AutomaticCost {
  skill: Skill;
  effect: Op[];
  costs: string[];
  choices: { price: Price; payment: VmPayment; label: string; x?: number }[];
  stage: "offer" | "action";
  /**
   * #677: the 20-14 prices a rule puts on activating this [Auto], part of the
   * one cost its master pays in its entirety or not at all (9-6-4) — named on
   * the "Pay:" option, and charged once the printed price is paid, before the
   * skill is activated (`vm/activate.ts`'s `TaxGate`). Additive.
   */
  taxGate?: Omit<TaxGate, "guards">;
}

/** A supported action-price must complete every instruction (5-8-2-2). */
export function automaticPriceHost(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[]): ScriptHost {
  const host = vmHost(ctx, game, state, ev);
  const unpaid = () => { throw new IllegalAction("the Auto skill cost cannot be paid in its entirety"); };
  /** The interpreter's KO skips these cards silently (`stepScript`'s `ko`,
   * `koCard`'s 20-14 read); a skipped KO is no payment (5-8-2-2). */
  const koablePrice = (id: string, master: PlayerId): boolean => !!state.cards[id] && host.areaOf(id) === "battle"
    && !(host.hasKeyword(id, "Indestructible") && host.masterOf(id) !== master)
    && !host.forbids("beKOd", { card: id }) && !host.forbids("beKOdBySkill", { player: master, card: id });
  /** "Use 1 card from under this card in a combo" (BT29-030). The interpreter's
   * `comboFrom` skips a card when no battle has the master in it (5-7-1), and
   * a card already in a Combo Area; 5-7-2 admits only a Battle Card with a
   * combo cost and combo power, and a combo prohibition stops it. A skipped
   * or impossible combo is no payment (5-8-2-2). */
  const comboablePrice = (id: string, master: PlayerId): boolean => {
    const b = host.battle();
    return !!b && (host.masterOf(b.attacker) === master || host.masterOf(b.guard) === master)
      && !!state.cards[id] && host.areaOf(id) !== "combo" && canCombo(host.defOf(id))
      && !host.forbids("combo", { player: master, card: id });
  };
  /** "This card gets -15000 power for the turn" (DB2-011). Power is read in
   * battle (2-7-1) and may go below zero (2-7-2), so the change is always
   * performable on a card in the Battle or Leader Area; an effect left on a
   * card anywhere else changes nothing the game reads (3-1-4). */
  const poweredPrice = (id: string): boolean => !!state.cards[id] && ["battle", "leader"].includes(host.areaOf(id) ?? "");
  return {
    ...host,
    forbids: (what, opts) => {
      if (host.forbids(what, opts)) unpaid();
      return false;
    },
    // Paying is a cost, so a replacement limited to an effect or its actor
    // does not answer this departure (5-8-2-2 / causeMatches). A KO paid as
    // a cost is still a KO (5-12-2: the instruction says "KO"), so a
    // replacement of a KO answers it; one limited to an effect does not.
    replacementsFor: (id, reason, opts) => host.replacementsFor(id, reason === "ko" ? "ko" : "cost", { ...opts, actor: undefined }),
    resolveSelector: (f, sel) => {
      let found = host.resolveSelector(f, sel);
      // #716: a [Counter] declared from the hand is the card being activated;
      // it cannot also be one of the cards its own price picks out.
      if (f.counterCost && !sel.special) found = found.filter((id) => id !== f.card);
      const op = f.ops[f.ip];
      if (op?.op === "choose" && op.sel === sel) {
        const following = f.ops.slice(f.ip + 1).find((o) => (o.op === "switchMode" || o.op === "hidden" || o.op === "ko" || o.op === "comboFrom") && "var" in o.target && o.target.var === op.as);
        if (following?.op === "switchMode") found = found.filter((id) => host.modeOf(id) !== following.mode);
        if (following?.op === "hidden") found = found.filter((id) => host.isHidden(id) !== following.hidden);
        // 5-12-1: only a Battle Card in the Battle Area can be KO'd. "Your
        // <Vegeta> cards" also reads the Leader, which no KO can move.
        if (following?.op === "ko") found = found.filter((id) => koablePrice(id, f.master));
        if (following?.op === "comboFrom") found = found.filter((id) => comboablePrice(id, f.master));
        const next = f.ops[f.ip + 1];
        if (next?.op === "faceUp" && "var" in next.target && next.target.var === op.as && sel.side === "you" && sel.area === "life")
          found = found.filter((id) => host.areaOf(id) === "life" && host.isFaceUp(id) !== (next.faceUp ?? true));
        const picked = f.awaiting === op.as ? f.vars[op.as] ?? [] : [];
        const all = [...new Set([...found, ...picked])];
        if (!sel.upTo && op.atMost === undefined && selectedCount(sel, all, host.nameOf, undefined, (id) => host.defOf(id).characters) < (sel.minCount ?? sel.count ?? 1)) unpaid();
      }
      if (op?.op === "reveal" && op.sel === sel && selectedCount(sel, found, host.nameOf, undefined, (id) => host.defOf(id).characters) < (sel.count ?? 1)) unpaid();
      return found;
    },
    resolveRef: (f, ref) => {
      const found = host.resolveRef(f, ref);
      const op = f.ops[f.ip];
      // The ordinary effect interpreter skips Leader departures. A skipped
      // instruction cannot count as a completed cost.
      if (op?.op === "moveTo" && ref === op.target
        && found.some((id) => !state.cards[id] || host.areaOf(id) === "leader")) unpaid();
      if (op?.op === "moveTo" && op.to === "under" && ref === op.target) {
        const under = op.under ? host.resolveRef(f, op.under) : [f.card];
        if (under.length !== 1 || !state.cards[under[0]]) unpaid();
      }
      // The effect interpreter skips an unchanged face. For a price, every
      // named life card must actually turn over (5-8-2-2 / 3-9-2-1).
      if (op?.op === "faceUp" && ref === op.target) {
        // An earlier action can change a saved card's area. Only the exact
        // Life-area transition has a payment proof; other areas are unknown.
        if (found.some((id) => state.cards[id] && host.areaOf(id) !== "life"))
          throw new NotYet("pay face-up action price outside the Life Area", "#549");
        if (found.length !== 1 || found.some((id) => !state.cards[id] || host.isFaceUp(id) === (op.faceUp ?? true))) unpaid();
      }
      // A KO price names Battle Cards that can actually be KO'd now; the
      // interpreter would otherwise skip the rest without moving anything.
      if (op?.op === "ko" && ref === op.target && (!found.length || found.some((id) => !koablePrice(id, f.master)))) unpaid();
      if (op?.op === "comboFrom" && ref === op.target && (!found.length || found.some((id) => !comboablePrice(id, f.master)))) unpaid();
      // An empty target would add no effect at all: no payment.
      if (op?.op === "power" && ref === op.target && (found.length !== 1 || !poweredPrice(found[0]))) unpaid();
      // "Add 1 marker to this card": only a card still in play can carry it.
      if (op?.op === "addMarker" && ref === op.target
        && (found.length !== 1 || found.some((id) => !state.cards[id] || !inPlayZones(game).includes(host.areaOf(id) ?? "")))) unpaid();
      if ("var" in ref) {
        const chosen = f.ops.slice(0, f.ip).findLast((o) => o.op === "choose" && o.as === ref.var);
        if (chosen?.op === "choose" && !chosen.sel.upTo && chosen.atMost === undefined && selectedCount(chosen.sel, f.vars[ref.var] ?? [], host.nameOf, undefined, (id) => host.defOf(id).characters) < (chosen.sel.minCount ?? chosen.sel.count ?? 1)) unpaid();
      }
      // BT31-001: a complete Fusion pair can contain no hand cards. Its
      // hand partition is then empty, while the following instruction still
      // owes both outside cards to Warp. This is not an empty material cost.
      const emptyFusionHandPartition = op?.op === "moveTo" && op.to === "drop"
        && !!f.keywordPrice?.fusion && "var" in ref && ref.var === "pair" && ref.minus === "pairOutside"
        && f.vars.pair?.length === 2 && new Set(f.vars.pair).size === 2
        && f.vars.pairOutside?.length === 2 && f.vars.pair.every((id) => f.vars.pairOutside.includes(id));
      if (["moveTo", "switchMode", "hidden", "removeMarker"].includes(op?.op) && !found.length && !("var" in ref && f.vars[ref.var]?.length === 0) && !emptyFusionHandPartition) unpaid();
      return found;
    },
    amount: (f, amount) => {
      const n = host.amount(f, amount);
      const op = f.ops[f.ip];
      if ((op?.op === "mill" || op?.op === "draw") && sideOf(f.master, op.side).some((p) => host.zone(p, "deck").length < n)) unpaid();
      return n;
    },
    // #926 (5-1-1, 5-8-2-2): "draw N cards" as a price is paid only when N
    // cards actually go from the top of the deck to the hand. Only a family
    // that opts in reads a draw price at all (`readableAutomaticPrice`).
    draw: (p, n) => {
      if (host.zone(p, "deck").length < n) unpaid();
      const before = host.zone(p, "hand").length;
      const drawn = host.draw(p, n);
      if (drawn !== n || host.zone(p, "hand").length !== before + n) throw new AutoPaymentFailed("a draw paid as a cost did not complete");
      return drawn;
    },
    move: (id, to, owner, opts) => {
      if (host.areaOf(id) === to) unpaid();
      // A combo paid as a cost is still a combo (5-7-3-1), as a cost KO is a
      // KO; its arrival in the Combo Area is verified below (5-8-2-2-1-1).
      const actual = host.move(id, to, owner, { ...opts, reason: opts?.reason === "combo" && to === "combo" ? "combo" : "cost" });
      if (actual !== to || host.areaOf(id) !== to || (to === "deck" && opts?.position === "bottom" && host.zone(owner, "deck").at(-1) !== id)) {
        const replaced = opts?.replaced;
        if (replaced?.deferred && replaced.ops?.length) state.programs.unshift({ ops: replaced.ops, ip: 0, vars: {}, card: replaced.source ?? id, master: replaced.master ?? host.masterOf(id), subject: id, replacing: id, ...(replaced.skillIndex !== undefined ? { skillIndex: replaced.skillIndex } : {}), ...(replaced.optional ? { offered: true as const } : {}) });
        throw new AutoPaymentFailed("a replacement caused the Auto skill cost payment to fail");
      }
      return actual;
    },
    // 5-12-1 / 5-8-2-2-1-1: a KO price is paid only when the Battle Card
    // actually reaches its owner's Drop Area. A prohibition is no payment;
    // a replacement that keeps it or sends it elsewhere fails the attempt
    // after it was made (5-8-4), exactly like a diverted cost move.
    ko: (id, by, opts) => {
      if (!state.cards[id] || host.areaOf(id) !== "battle" || host.forbids("beKOd", { card: id })) unpaid();
      const owner = host.ownerOf(id);
      host.ko(id, by, opts);
      if (host.areaOf(id) !== "drop" || !state.sides[owner].zones.drop.includes(id)) {
        const replaced = opts?.replaced;
        if (replaced?.deferred && replaced.ops?.length) state.programs.unshift({ ops: replaced.ops, ip: 0, vars: {}, card: replaced.source ?? id, master: replaced.master ?? host.masterOf(id), subject: id, replacing: id, ...(replaced.skillIndex !== undefined ? { skillIndex: replaced.skillIndex } : {}), ...(replaced.optional ? { offered: true as const } : {}) });
        throw new AutoPaymentFailed("a replacement caused the Auto skill cost payment to fail");
      }
    },
    placeUnder: (id, top) => {
      if (id === top || !state.cards[id] || !state.cards[top] || state.cards[top].under.includes(id) || !host.placeUnder(id, top)
        || !state.cards[top].under.includes(id)) unpaid();
      return true;
    },
    setMode: (id, mode, by) => {
      if (host.modeOf(id) === mode || !host.setMode(id, mode, by)) unpaid();
      return true;
    },
    setHidden: (id, hidden, by) => {
      if (host.isHidden(id) === hidden) unpaid();
      host.setHidden(id, hidden, by);
      if (host.isHidden(id) !== hidden) unpaid();
    },
    setFaceUp: (id, faceUp) => {
      if (!state.cards[id] || host.isFaceUp(id) === faceUp) unpaid();
      host.setFaceUp(id, faceUp);
      if (host.isFaceUp(id) !== faceUp) unpaid();
    },
    // #716: a restriction printed as the price ("You can't activate the
    // [Counter: Play] skills of other cards for the turn", BT10-008) is paid
    // when the rule is actually in force afterwards (5-8-2-2).
    addEffect: (e) => {
      if (e.kind === "power" && (!e.target || !poweredPrice(e.target))) unpaid();
      const before = state.effects.length;
      const made = host.addEffect(e);
      if (e.kind === "forbid" && state.effects.length !== before + 1) unpaid();
      // The power change must be in force on the card afterwards (5-8-2-2).
      if (e.kind === "power" && (state.effects.length !== before + 1
        || !state.effects.some((x) => x.kind === "power" && x.target === e.target && x.value === e.value && x.until === e.until))) unpaid();
      return made;
    },
    // 3-1-4-3: "with its skills negated" is part of the combo action; the
    // negation must actually stand on the card.
    negateAll: (id) => {
      const before = state.effects.length;
      host.negateAll(id);
      if (state.effects.length !== before + 1 || !state.effects.some((x) => x.kind === "negateSkills" && x.target === id)) unpaid();
    },
    changeMarkers: (id, delta) => {
      if (delta < 0 && host.markersOf(id) < -delta) unpaid();
      const before = host.markersOf(id);
      const after = host.changeMarkers(id, delta);
      // An added marker must actually be on the card afterwards (5-8-2-2).
      if (delta > 0 && (after !== before + delta || host.markersOf(id) !== before + delta)) unpaid();
      return after;
    },
  };
}

/** One exact dead end, before expanding a hand choice. The only remaining
 * movement is of cards chosen from the hand to the Drop, so it cannot stand an
 * already-rested source up for the final mandatory self-rest. Keep this narrow:
 * an aliased choice, another destination, a replacement or a nested reference
 * can make the intervening movement affect the source. */
function mayReplacePriceMove(ctx: EngineContext, game: GameDefinition, state: VmState): boolean {
  if (state.effects.length) return true;
  for (const side of Object.values(state.sides)) {
    for (const zone of inPlayZones(game)) {
      for (const id of side.zones[zone] ?? []) {
        const showing = skillsShowing(ctx, state, id);
        for (const skill of showing.skills) {
          if (skill.kind !== "permanent") continue;
          const program = showing.scripts.bySkill[skill.index];
          if (program && hasPossibleReplacement(program.ops)) return true;
        }
      }
    }
  }
  return possibleAltPaymentReplacement(game) || staticsNow(ctx, game, state).some((effect) => effect.kind === "replaceLeave");
}

function cannotRestSourceAfterHandPrice(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame): boolean {
  const [choose, move, rest, ...extra] = frame.ops.slice(frame.ip);
  if (extra.length || choose?.op !== "choose" || move?.op !== "moveTo" || rest?.op !== "switchMode") return false;
  if (rest.mode !== "rest" || Object.keys(rest).some((key) => !["op", "target", "mode"].includes(key))) return false;
  if (!("sel" in rest.target) || rest.target.sel.special !== "self" || Object.keys(rest.target.sel).length !== 1) return false;
  if (move.to !== "drop" || !("var" in move.target) || move.target.var !== choose.as || Object.keys(move.target).length !== 1) return false;
  const source = state.cards[frame.card];
  const host = vmHost(ctx, game, state, []);
  if (!source || frame.moveLoop || frame.replacing || game.zones.drop?.modes?.includes("rest")) return false;
  const origin = host.areaOf(frame.card);
  // A pure Drop move cannot make a rested source eligible for a new Rest:
  // it either stays rested in its area, or arrives in mode-less Drop. The
  // same holds for a source already in an area where Rest cannot be paid.
  if (source.mode === "rest" || !origin || !game.zones[origin]?.modes?.includes("rest"))
    return !mayReplacePriceMove(ctx, game, state);
  // A retained alias is necessarily moved even if the source has since left
  // Hand; its old Active mode cannot survive as a payable Drop-area Rest.
  return frame.awaiting === choose.as && !!frame.vars[choose.as]?.includes(frame.card)
    && !mayReplacePriceMove(ctx, game, state);
}

/** A pure hand payment immediately feeds a later named Drop payment. Count
 * only cards which could actually enter that Drop: already saved picks and at
 * most the slots left in the first choice. This is a necessary condition, not
 * a replacement for replaying the price. A replacement, computed filter,
 * different chooser, or saved card outside the hand falls back to the full
 * interpreter search. Candidate order is only a heuristic; no branch is
 * omitted on that account. */
function directNamedTransfer(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame, candidates: string[]): { enough: boolean; favored: Set<string> } | null {
  const [first, move, second, finish, ...extra] = frame.ops.slice(frame.ip);
  if (extra.length || first?.op !== "choose" || move?.op !== "moveTo" || second?.op !== "choose" || finish?.op !== "moveTo") return null;
  const simple = (value: object, allowed: string[]) => Object.entries(value).every(([key, field]) => field === undefined || allowed.includes(key));
  if (!simple(first, ["op", "sel", "as", "reason", "chooser"]) || !simple(first.sel, ["side", "area", "count", "upTo"])
    || first.sel.side !== "you" || first.sel.area !== "hand" || first.sel.upTo || !Number.isInteger(first.sel.count) || (first.sel.count ?? 0) < 1
    || !simple(move, ["op", "target", "to", "reveal"]) || move.to !== "drop" || !("var" in move.target) || move.target.var !== first.as || !simple(move.target, ["var"])
    || !simple(second, ["op", "sel", "as", "reason", "chooser"]) || !simple(second.sel, ["side", "area", "filter", "count", "upTo"])
    || second.sel.side !== "you" || second.sel.area !== "drop" || second.sel.upTo || !Number.isInteger(second.sel.count) || (second.sel.count ?? 0) < 1
    || !simple(finish, ["op", "target", "to", "reveal"]) || finish.to !== "warp" || !("var" in finish.target) || finish.target.var !== second.as || !simple(finish.target, ["var"])) return null;
  const filter = second.sel.filter;
  if (!filter?.names?.length || Object.entries(filter).some(([key, value]) => key !== "names" && value !== undefined && value !== null && value !== false && !(Array.isArray(value) && value.length === 0))) return null;
  const hand = new Set(state.sides[frame.master].zones.hand);
  const saved = frame.awaiting === first.as ? frame.vars[first.as] ?? [] : [];
  if (saved.some((id) => !hand.has(id)) || state.lastChoice?.some((id) => !hand.has(id)) || frame.moveLoop || frame.replacing || mayReplacePriceMove(ctx, game, state)) return null;
  // Even a Permanent with no replacement might make a selected card's
  // identity depend on the number of cards still in hand or Drop.
  const permanentSources = new Set(Object.keys(state.cards).filter((id) => skillsShowing(ctx, state, id).skills.some((skill) => skill.kind === "permanent")));
  if (permanentSources.size) {
    // Dynamic names cannot justify a negative bound. This only orders full
    // replay: favor already-matching cards, or preserve possible name sources.
    const current = new Set(vmHost(ctx, game, state, []).resolveSelector(frame, { ...second.sel, area: "hand" }));
    const matches = candidates.filter((id) => current.has(id));
    return { enough: true, favored: new Set(matches.length ? matches : candidates.filter((id) => !permanentSources.has(id))) };
  }
  // Ask the same selector that the later interpreter step will ask. Printed
  // names alone miss case folding, a shown back face and additional names.
  const now = vmHost(ctx, game, state, []);
  const fromDrop = now.resolveSelector(frame, second.sel).length;
  const matchingHand = new Set(now.resolveSelector(frame, { ...second.sel, area: "hand" }));
  const eligible = (id: string): boolean | null => {
    const card = state.cards[id];
    const def = card && ctx.defs[card.cardId];
    // A plain, skill-less front face keeps its printed name through this
    // hand departure. The selector still supplies its own case/alias rules.
    // Faces, added names and own-skill choice restrictions use projection.
    if (card && def && !card.flipped && !card.hidden && !def.back && !def.alsoNames?.length && !def.skill) return matchingHand.has(id);
    const projected = structuredClone(state);
    const host = vmHost(ctx, game, projected, []);
    if (host.replacementsFor(id, "cost", { actor: undefined, requestedTo: "drop" }).length) return null;
    try {
      if (host.move(id, "drop", host.ownerOf(id), { reason: "cost" }) !== "drop" || host.areaOf(id) !== "drop") return null;
    } catch (err) {
      if (err instanceof IllegalAction) return null;
      throw err;
    }
    return host.resolveSelector(frame, second.sel).includes(id);
  };
  const favored = new Set<string>();
  let fromSaved = 0;
  for (const id of new Set([...saved, ...candidates])) {
    const matches = eligible(id);
    if (matches === null) return null;
    if (matches) {
      if (saved.includes(id)) fromSaved++;
      else favored.add(id);
    }
  }
  const remaining = Math.max(0, (first.sel.count ?? 0) - saved.length);
  return { enough: fromDrop + fromSaved + Math.min(remaining, favored.size) >= (second.sel.count ?? 0), favored };
}

/** VM instance ids are `${player}#${n}` (`vm/index.ts`). A string holding one
 * inside other text (an occurrence key) still refers to that card. */
const INSTANCE_ID = /[A-Za-z0-9_]+#\d+/g;
/** Areas whose order the interpreter reads directly (top of deck, top Life). */
const ORDERED_ZONES = new Set(["deck", "life"]);

type Positional = Set<string>;
/** The areas some selector reads by position (`take`/`fromEnd`). A selector
 * on a saved variable or a named card reads no area order. */
function positionalAreas(value: unknown, out: Positional = new Set(), seen = new Set<object>()): Positional {
  if (!value || typeof value !== "object" || seen.has(value)) return out;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) positionalAreas(item, out, seen);
    return out;
  }
  const o = value as Record<string, unknown>;
  if ((o.take !== undefined && o.take !== null) || o.fromEnd) {
    if (!o.fromVar && !o.special) {
      const areas = Array.isArray(o.areas) && o.areas.length ? o.areas : [o.area ?? "battle"];
      for (const area of areas) out.add(typeof area === "string" ? area : "*");
    }
  }
  for (const field of Object.values(o)) positionalAreas(field, out, seen);
  return out;
}
const POSITIONAL_GAME = new WeakMap<GameDefinition, Positional>();
/** Every program a card in this game can show (both faces, copied skills) and
 * every keyword body. Card programs are read again per search: a context's
 * records are not frozen. */
function staticPositionalAreas(ctx: EngineContext, game: GameDefinition, state: VmState): Positional {
  const ids = new Set(Object.values(state.cards).map((card) => card.cardId));
  for (const effect of state.effects) if (effect.copied?.cardId) ids.add(effect.copied.cardId);
  const fromScripts: Positional = new Set();
  for (const id of ids) {
    positionalAreas(ctx.scripts?.[id], fromScripts);
    positionalAreas(ctx.scripts?.[`${id}#back`], fromScripts);
  }
  let fromGame = POSITIONAL_GAME.get(game);
  if (!fromGame) POSITIONAL_GAME.set(game, fromGame = positionalAreas(game.keywords));
  return new Set([...fromScripts, ...fromGame]);
}
function areaReads(game: GameDefinition, area: string, zone: string): boolean {
  if (area === "play") return inPlayZones(game).includes(zone);
  return area === zone || !(area in game.zones);
}
function selReads(game: GameDefinition, sel: unknown, zone: string): boolean {
  if (!sel || typeof sel !== "object") return false;
  const s = sel as { special?: unknown; fromVar?: unknown; area?: string; areas?: string[] };
  if (s.special || s.fromVar) return false;
  return (s.areas?.length ? s.areas : [s.area ?? "battle"]).some((area) => areaReads(game, area, zone));
}
/** A remaining instruction which resolves an area itself, rather than asking
 * for a choice, sees that area's order (a bulk move keeps it). Conditions and
 * amounts only count, so they are not instructions here. */
function bulkReads(game: GameDefinition, ops: unknown, zone: string): boolean {
  if (!ops || typeof ops !== "object") return false;
  if (Array.isArray(ops)) return ops.some((op) => bulkReads(game, op, zone));
  const o = ops as Record<string, unknown>;
  if (typeof o.op === "string" && o.op !== "choose") {
    const target = o.target as { sel?: unknown } | undefined;
    const under = o.under as { sel?: unknown } | undefined;
    if (selReads(game, o.sel, zone) || selReads(game, target?.sel, zone) || selReads(game, under?.sel, zone)) return true;
  }
  return Object.values(o).some((field) => bulkReads(game, field, zone));
}
function stableJson(value: unknown): string {
  if (!value || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

/**
 * Interchangeable candidates of one card prompt, each mapped to the first of
 * its class (#549). Two candidates are interchangeable when they stand in the
 * same zone of one side, their instances are identical apart from their id,
 * and nothing else in the state — saved variables, effects, pending records,
 * the lone answer, an occurrence key — names either of them. Renaming one to
 * the other is then a symmetry of the state, and the interpreter treats ids
 * as opaque, so both answers have the same continuations except for the two
 * cards' positions in that zone. Position is unobservable only when the zone
 * is not one the interpreter reads by its top (deck, Life), no program in the
 * game reads it by position, and no remaining price instruction resolves it
 * in bulk; otherwise every candidate stays its own class.
 */
export function interchangeableCandidates(ctx: EngineContext, game: GameDefinition, s: VmState, f: ScriptFrame, candidates: string[], fixed: Positional): Map<string, string> {
  const classes = new Map<string, string>();
  if (s.programs[0] !== f || candidates.length < 2) return classes;
  const referenced = new Set<string>();
  const positional = new Set(fixed);
  const note = (text: string) => {
    for (const token of text.match(INSTANCE_ID) ?? []) referenced.add(token);
  };
  const walk = (value: unknown): void => {
    if (typeof value === "string") return note(value);
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach(walk);
    for (const [key, field] of Object.entries(value)) {
      note(key);
      walk(field);
    }
  };
  for (const [key, field] of Object.entries(s)) {
    if (key === "cards") {
      for (const [id, card] of Object.entries(s.cards)) {
        for (const [prop, v] of Object.entries(card)) if (!(prop === "id" && v === id)) { note(prop); walk(v); }
      }
    } else if (key === "sides") {
      // Each id stands once in its own zone list; that is not a reference.
      for (const side of Object.values(s.sides)) {
        for (const [prop, v] of Object.entries(side)) if (prop !== "zones") { note(prop); walk(v); }
      }
    } else if (key === "prompt" && s.prompt.kind === "chooseCards") {
      for (const [prop, v] of Object.entries(s.prompt)) {
        if (prop !== "choice") { note(prop); walk(v); continue; }
        for (const [cprop, cv] of Object.entries(s.prompt.choice)) if (cprop !== "candidates") { note(cprop); walk(cv); }
      }
    } else {
      note(key);
      walk(field);
    }
    if (key === "programs" || key === "effects" || key === "delayed" || key === "pending") positionalAreas(field, positional);
  }
  const remaining = f.ops.slice(f.ip);
  positionalAreas(remaining, positional);
  const where = new Map<string, string>();
  for (const [p, side] of Object.entries(s.sides)) for (const [zone, ids] of Object.entries(side.zones)) for (const id of ids) where.set(id, `${p}\u0000${zone}`);
  const zoneSafe = new Map<string, boolean>();
  const representative = new Map<string, string>();
  for (const id of candidates) {
    const card = s.cards[id];
    const at = where.get(id);
    if (!card || !at || referenced.has(id) || id.match(INSTANCE_ID)?.[0] !== id) continue;
    const zone = at.split("\u0000")[1];
    let safe = zoneSafe.get(zone);
    if (safe === undefined) {
      safe = !ORDERED_ZONES.has(zone) && ![...positional].some((area) => areaReads(game, area, zone)) && !bulkReads(game, remaining, zone);
      zoneSafe.set(zone, safe);
    }
    if (!safe) continue;
    const signature = `${at}\u0000${stableJson({ ...card, id: undefined })}`;
    const first = representative.get(signature);
    if (first === undefined) representative.set(signature, id);
    else classes.set(id, first);
  }
  return classes;
}

/** Preflight on an isolated board, including earlier instructions and all
 * source/event/X bindings. No cost, trigger or prompt escapes this simulation.
 * Choices are single-card interpreter answers, so every branch is replayable;
 * an interchangeable candidate is represented by the first of its class. */
export function canFinishAutomaticPrice(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame, { symmetry = true }: { symmetry?: boolean } = {}): boolean {
  // Other price grammars can have order-dependent choices and replacements.
  // Keep an explicit unknown when their search is too large; never equate an
  // unfinished proof with an unaffordable price.
  let budget = 2000;
  const failed = new Set<string>();
  const fixedPositional = symmetry ? staticPositionalAreas(ctx, game, state) : null;
  const visit = (s: VmState, f: ScriptFrame): boolean => {
    if (--budget < 0) throw new NotYet("plan this Auto action price within the bounded choice search", "#549");
    if (cannotRestSourceAfterHandPrice(ctx, game, s, f)) return false;
    // The same exact board, stored aliases and answer cursor has the same
    // continuations. This caches only proven failures; chosen order is kept.
    const key = JSON.stringify([s, f]);
    if (failed.has(key)) return false;
    s.programs = [];
    try {
      const result = stepScript(automaticPriceHost(ctx, game, s, []), f);
      if (result === "done") return true;
      if (s.programs[0] !== f) return false;
      const prompt = s.prompt;
      const same = prompt.kind === "chooseCards" && fixedPositional ? interchangeableCandidates(ctx, game, s, f, prompt.choice.candidates, fixedPositional) : new Map<string, string>();
      const choices = prompt.kind === "chooseCards" ? [ ...(prompt.choice.min === 0 ? [[]] : []), ...prompt.choice.candidates.filter((id) => !same.has(id)).map((id) => [id]) ] : [];
      const modes = prompt.kind === "replaceMove" || prompt.kind === "chooseMode" ? prompt.options.map((_, index) => index) : [];
      const transfer = prompt.kind === "chooseCards" ? directNamedTransfer(ctx, game, s, f, prompt.choice.candidates) : null;
      if (transfer && !transfer.enough) return false;
      const ordered = transfer ? choices.sort((a, b) => Number(transfer.favored.has(b[0])) - Number(transfer.favored.has(a[0]))) : choices;
      for (const answer of [...ordered.map((cards) => ({ cards })), ...modes.map((index) => ({ index }))]) {
        const next = structuredClone(s);
        if ("cards" in answer) next.lastChoice = answer.cards;
        else next.lastMode = answer.index;
        if (visit(next, structuredClone(f))) return true;
      }
      failed.add(key);
      return false;
    } catch (err) {
      // NotYet is an IllegalAction too, but an incomplete search cannot
      // establish that the entire price is unaffordable.
      if (err instanceof NotYet) throw err;
      if (err instanceof IllegalAction || err instanceof AutoPaymentFailed) return false;
      throw err;
    }
  };
  return visit(structuredClone(state), structuredClone({ ...frame, autoCost: undefined }));
}

/** Refuse unimplemented instructions explicitly, rather than calling an
 * unsupported price unaffordable or letting its effect run for free. */
export function readableAutomaticPrice(ops: Op[], label = "Auto", owner = "#549", { draw = false }: { draw?: boolean } = {}): void {
  const pays = (branch: Op[]): boolean => branch.some((op) => op.op === "moveTo" || op.op === "discard" || op.op === "mill"
    || op.op === "switchMode" || op.op === "hidden" || op.op === "removeMarker" || op.op === "reveal" || op.op === "faceUp"
    || op.op === "ko" || op.op === "addMarker" || op.op === "forbid" || op.op === "comboFrom" || op.op === "power"
    || (op.op === "if" && !!op.else?.length && pays(op.then) && pays(op.else))
    || (op.op === "chooseMode" && op.modes.length > 0 && op.modes.every((mode) => pays(mode.ops))));
  /** A completed interpreter step of one of these shapes necessarily changed
   * a resource. An optional empty choice cannot establish this fact merely
   * because a `moveTo` instruction follows it. */
  const surelyPaid = (op: Op, prior: Op | undefined): boolean => {
    const mandatoryPick = (target: Ref): boolean => prior?.op === "choose" && "var" in target && target.minus === undefined
      && target.var === prior.as && Number.isInteger(prior.sel.count ?? 1) && (prior.sel.minCount ?? prior.sel.count ?? 1) > 0
      && !prior.sel.upTo && prior.atMost === undefined;
    if (op.op === "moveTo" && op.to !== "play") {
      if ("sel" in op.target) return true; // The strict host refuses no target or a failed departure.
      return mandatoryPick(op.target); // Every selected card must reach its named destination.
    }
    if (op.op === "discard" || op.op === "mill") return typeof op.n === "number" && Number.isInteger(op.n) && op.n > 0;
    if (op.op === "removeMarker") return typeof op.n === "number" && Number.isInteger(op.n) && op.n > 0 && "sel" in op.target;
    if (op.op === "switchMode" || op.op === "hidden") return "sel" in op.target || mandatoryPick(op.target);
    if (op.op === "reveal") return !op.sel.upTo && (op.sel.count ?? 1) > 0 && op.audience !== "you";
    if (op.op === "faceUp") return true; // The verified Life pair and strict face transition were checked below.
    return false;
  };
  const isSelf = (target: Ref): boolean => "sel" in target && Object.keys(target).length === 1
    && target.sel.special === "self" && Object.entries(target.sel).every(([key, value]) => key === "special" || value === undefined);
  /** "KO this card", or a compulsory own Battle-Area/in-play choice KO'd at
   * once ("Choose 1 of your <Vegeta> cards and KO it"). The strict host
   * offers only cards that can actually be KO'd and verifies each arrival in
   * its owner's Drop; any other KO shape stays typed unknown. */
  const verifiedKo = (op: Extract<Op, { op: "ko" }>, prior: Op | undefined): boolean => {
    if (isSelf(op.target)) return true;
    if (prior?.op !== "choose" || !("var" in op.target) || op.target.var !== prior.as || Object.keys(op.target).some((key) => key !== "var")) return false;
    const sel = prior.sel;
    return sel.side === "you" && (sel.area === "battle" || sel.area === "play") && !sel.areas?.length && !sel.special && !sel.fromVar
      && Number.isInteger(sel.count ?? 1) && (sel.minCount ?? sel.count ?? 1) > 0 && !sel.upTo && prior.atMost === undefined
      && (!prior.chooser || prior.chooser === "you");
  };
  /** "Add N markers to this card" with a printed positive N (BT31). */
  const verifiedAddMarker = (op: Extract<Op, { op: "addMarker" }>): boolean =>
    isSelf(op.target) && typeof op.n === "number" && Number.isInteger(op.n) && op.n > 0;
  /** A filter that narrows nothing, apart from the named keys. */
  const blankFilter = (filter: unknown, allowed: Record<string, unknown> = {}): boolean => !filter || (typeof filter === "object"
    && Object.entries(filter).every(([key, value]) => key in allowed ? value === allowed[key] || value === undefined || value === null || value === false
      : value === undefined || value === null || value === false || (Array.isArray(value) && value.length === 0)));
  /** The immediately preceding compulsory single pick of your own, saved as
   * the one variable this instruction names. */
  const singleOwnPick = (target: Ref, prior: Op | undefined, area: string, filter: Record<string, unknown> = {}): boolean => {
    if (prior?.op !== "choose" || !("var" in target) || target.var !== prior.as || Object.keys(target).some((key) => key !== "var")) return false;
    const sel = prior.sel;
    return sel.side === "you" && sel.area === area && sel.count === 1 && !sel.upTo && prior.atMost === undefined
      && (!prior.chooser || prior.chooser === "you") && blankFilter(sel.filter, filter)
      && Object.entries(sel).every(([key, value]) => value === undefined || ["side", "area", "count", "upTo", "filter"].includes(key));
  };
  /** "Flip 1 card in your life face up/down", and BT12-023's "flip 1 face-up
   * card in your life face down": a compulsory own-Life pick turned at once.
   * A face filter may only ask for the face the turn leaves. */
  const verifiedFaceTurn = (op: Extract<Op, { op: "faceUp" }>, prior: Op | undefined): boolean =>
    singleOwnPick(op.target, prior, "life", (op.faceUp ?? true) ? {} : { faceUp: true });
  /** "Use 1 card from under this card in a combo [with its skills negated]"
   * (BT29-030): a compulsory pick of one card from the source's own pile. */
  const verifiedCombo = (op: Extract<Op, { op: "comboFrom" }>, prior: Op | undefined): boolean => singleOwnPick(op.target, prior, "under");
  /** "This card gets -N power for the turn" (DB2-011): a printed loss on the
   * source itself, for the turn or the battle. */
  const verifiedPower = (op: Extract<Op, { op: "power" }>): boolean => isSelf(op.target)
    && typeof op.amount === "number" && Number.isInteger(op.amount) && op.amount < 0 && (op.until === "turn" || op.until === "battle");
  /** "You can't …" printed as the price: a rule the payer puts on themself
   * for a span (#716, BT10-008). Only the plain player form — no card target,
   * escape, price, budget or description — is known to be performable in
   * full every time; any other restriction shape stays typed unknown. */
  const verifiedRestriction = (op: Extract<Op, { op: "forbid" }>): boolean => op.side === "you" && !op.target && !op.filter
    && !op.unless && !op.unlessPay?.length && op.uses === undefined && !op.byTypes?.length && !op.turnPlayer && !op.sameNameAsSelf
    && op.bySkill === undefined && (op.until === "turn" || op.until === "battle");
  /** `paid` means every path to this point completed an action, not just
   * that an opcode named an action. `terminal` follows all ancestor tails. */
  const check = (steps: Op[], paid = false, terminal = true, nested = false): boolean => {
    for (const [index, op] of steps.entries()) {
      if (op.op === "note" && op.text.startsWith("\u0000probe-path:")) continue;
      if (op.op === "if") {
        if (!paid && (!op.else?.length || !pays(op.then) || !pays(op.else)))
          throw new NotYet(`pay ${label} conditional action price with an empty branch`, owner);
        const branchTerminal = terminal && index === steps.length - 1;
        const thenPaid = check(op.then, paid, branchTerminal, true);
        const elsePaid = check(op.else ?? [], paid, branchTerminal, true);
        paid = thenPaid && elsePaid;
        continue;
      }
      if (op.op === "chooseMode") {
        if (!op.modes.length || op.modes.some((mode) => !pays(mode.ops))) throw new NotYet(`pay ${label} modal action price with an empty option`, owner);
        const modeTerminal = terminal && index === steps.length - 1;
        paid = op.modes.map((mode) => check(mode.ops, paid, modeTerminal, true)).every(Boolean);
        continue;
      }
      if (op.op === "reveal" && surelyPaid(op, steps[index - 1])) {
        paid = true;
        continue;
      }
      // Only a compulsory own-Life pick immediately turned to the opposite
      // face has a complete payment proof. Other shapes stay typed unknown.
      if (op.op === "faceUp") {
        if (!verifiedFaceTurn(op, steps[index - 1])) throw new NotYet(`pay ${label} face-up action price outside the verified Life choice`, owner);
        paid = true;
        continue;
      }
      // #926: "draw N cards" printed as the price of a keyword move — your own
      // deck, a printed positive N. Opt-in: the other families keep it typed.
      if (draw && op.op === "draw" && typeof op.n === "number" && Number.isInteger(op.n) && op.n > 0 && (op.side ?? "you") === "you") {
        paid = true;
        continue;
      }
      if ((op.op === "ko" && verifiedKo(op, steps[index - 1])) || (op.op === "addMarker" && verifiedAddMarker(op)) || (op.op === "forbid" && verifiedRestriction(op))
        || (op.op === "comboFrom" && verifiedCombo(op, steps[index - 1])) || (op.op === "power" && verifiedPower(op))) {
        paid = true;
        continue;
      }
      // Preserve the original top-level adjunct admission for declared
      // dynamic payments. Nested adjuncts newly admitted here need the
      // stronger proof that every path has already performed a payment.
      if (op.op === "shuffle" && terminal && index === steps.length - 1 && !op.inspectedOnly
        && (paid || (!nested && pays(steps.slice(0, index))))) continue;
      if (!["choose", "discard", "mill", "switchMode", "hidden", "moveTo", "removeMarker"].includes(op.op)
        || (op.op === "moveTo" && op.to === "play")) {
        throw new NotYet(`pay ${label} action price containing ${op.op}`, owner);
      }
      if (surelyPaid(op, steps[index - 1])) paid = true;
    }
    return paid;
  };
  check(ops);
}

/**
 * The words on a "Pay: ..." option (#721). The planner describes only what the
 * orb/marker/Life plan takes, and says "nothing" when the price is a program
 * alone (a hand or Life-card price, a restriction); a real price must never be
 * labelled "nothing", so the program is named in words after the plan's part.
 */
export function automaticPriceLabel(plan: string | undefined, ops: Op[]): string {
  const parts: string[] = [];
  if (plan && plan !== "nothing") parts.push(plan);
  const program = ops.length ? describeScript(ops) : "";
  if (program) parts.push(program);
  return parts.join("; ") || "pay the skill cost";
}

/** Capture payment alternatives before asking; the Auto's master and source
 * stay on the frame even when its price moves the source (9-6 / 9-9). */
export function prepareAutomaticCost(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame, skill: Skill, script: Script): AutomaticCost {
  const paymentGap = skillPriceProblem(script.price);
  if (paymentGap) throw new NotYet(`read this Auto's typed skill cost (${paymentGap})`, "#549");
  const ops = script.price?.ops ?? [];
  readableAutomaticPrice(ops);
  const costs = game.actions.activate?.cost;
  if (!costs) throw new RulesetBroken(game.id, "automatic skill costs need the declared activation prices");
  const line = { card: frame.card, skillIndex: skill.index, skill, kind: skill.kind, script: { ...script, price: script.price ? { ...script.price, payWith: [] } : undefined } };
  const bound = boundFor(ctx, game, state, frame.master, line, false);
  for (const pw of script.price?.payWith ?? []) {
    for (const id of vmHost(ctx, game, state, []).resolveSelector(frame, pw.sel)) {
      (bound.payers ??= []).push({ id, colors: pw.as === "energy" ? cardColors(ctx, game, state, id) : [pw.as] });
    }
  }
  if (bound.unreadable) throw new NotYet("read this Auto's printed skill cost", "#549");
  const choices: AutomaticCost["choices"] = [];
  const x = script.price?.x;
  const min = x?.min ?? 0;
  const capacity = activeEnergy(game, state, frame.master).length + payersFor(ctx, game, state, frame.master, bound.payers).length + Number(state.sides[frame.master].attrs.energyMarkers ?? 0);
  const declaredMax = x?.max;
  if (!Number.isInteger(min) || min < 0 || (declaredMax !== undefined && (!Number.isInteger(declaredMax) || declaredMax < min))) throw new NotYet("read the bounds of this Auto's X cost", "#549");
  // A printed ceiling can be arbitrarily large; one unit of X consumes one
  // available resource, so this cap excludes no payable value.
  const max = x ? Math.min(declaredMax ?? capacity, capacity) : 0;
  for (let n = x ? min : 0; n <= max; n++) {
    const energy = bound.energy ?? { total: 0, orbs: {}, either: [] };
    const price = priceFor(ctx, game, state, game.actions.activate, frame.card, x ? { ...bound, energy: { ...energy, total: (energy.total ?? 0) + n } } : bound);
    const plan = planCost(ctx, game, state, frame.master, price, frame.card);
    if (!plan.ok) continue;
    const payments = plan.asks && plan.options.length > 1 ? plan.options.map((option) => planCost(ctx, game, state, frame.master, price, frame.card, option.rest)) : [plan];
    for (const paymentPlan of payments) {
      if (!paymentPlan.ok) continue;
      const clone = structuredClone(state);
      try {
        chargeAutomaticPayment(ctx, game, clone, [], frame, paymentPlan.payment, costs);
      } catch (err) {
        if (err instanceof IllegalAction) continue;
        throw err;
      }
      const paying = { ...frame, ops, ...(x ? { x: n } : {}) };
      if (!canFinishAutomaticPrice(ctx, game, clone, paying)) continue;
      choices.push({ price, payment: paymentPlan.payment, label: `${x ? `X = ${n}; ` : ""}${automaticPriceLabel(paymentPlan.describe, ops)}`, ...(x ? { x: n } : {}) });
    }
  }
  return { skill, effect: frame.ops, costs, choices, stage: "offer" };
}

/** Finish the activation only after the entire action price completed. */
export function finishAutomaticCost(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], frame: ScriptFrame & { autoRevealEpoch?: number }): void {
  const cost = frame.autoCost!;
  // #677: the printed price is paid; the rule's prices come next, and the
  // activation itself only once they are — this same frame, with nothing left
  // to pay, is what the gate lets through (or drops, if they can't be paid).
  if (cost.taxGate) {
    const gate = cost.taxGate;
    delete cost.taxGate;
    const paid: ScriptFrame & { autoRevealEpoch?: number } = { ...frame, ops: [], ip: 0 };
    delete paid.awaiting;
    state.programs.unshift(paid);
    queueTaxGate(state, gate, 1);
    return;
  }
  // 22-11-2 / 22-44-3 (#741): the paid Auto is activated — one use spent, on
  // the copy for [Once per turn] and across copies for [Limit X].
  spendUse(state, frame.master, frame.card, cost.skill);
  spendSkillCostUses(ctx, game, state, ev, frame.card, cost.skill);
  log(ev, { type: "skill", card: frame.card, skill: frame.skillIndex ?? cost.skill.index, master: frame.master, text: cost.skill.raw, inBattle: !!state.battle,
    ...(frame.autoRevealEpoch === undefined ? {} : { reveal: true as const, revealEpoch: frame.autoRevealEpoch }) });
  const effect = { ...frame, ops: cost.effect, ip: 0 };
  delete effect.autoCost;
  delete effect.awaiting;
  state.programs.unshift(effect);
}


/** Verify declared resource instructions completed too: Burst/life movement
 * replacements cannot turn a known price into a partial payment (5-8-2-2). */
function chargeAutomaticPayment(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], frame: ScriptFrame, payment: VmPayment, costs: string[]): void {
  for (const id of payment.rest) {
    if (state.cards[id]?.mode !== "active") throw new IllegalAction("this Auto payment is no longer payable");
  }
  chargeCost(ctx, game, state, ev, frame.master, payment, frame.card, costs);
  for (const pooled of payment.pooled) {
    const op = game.costs[pooled.cost]?.do[0];
    if (op?.op !== "moveTo") throw new NotYet("verify this Auto's pooled payment", "#549");
    for (const id of pooled.cards) {
      const where = Object.values(state.sides).some((side) => side.zones[op.to]?.includes(id));
      if (!where) throw new IllegalAction("the Auto's pooled skill cost was replaced and cannot be paid");
    }
  }
}

/** JSONB reload may reorder object keys; compare payment values, not encoding. */
function sameAutomaticPayment(a: VmPayment, b: VmPayment): boolean {
  const ids = (x: string[], y: string[]) => x.length === y.length && x.every((id, i) => id === y[i]);
  return a.energyMarkers === b.energyMarkers && a.markers === b.markers && a.restsSelf === b.restsSelf
    && ids(a.rest, b.rest) && ids(a.life, b.life)
    && a.pooled.length === b.pooled.length && a.pooled.every((p, i) => p.cost === b.pooled[i].cost && ids(p.cards, b.pooled[i].cards))
    && a.markersOff.length === b.markersOff.length && a.markersOff.every((p, i) => {
      const q = b.markersOff[i];
      return p.cost === q.cost && p.side === q.side && p.area === q.area && p.n === q.n && p.by === q.by;
    });
}

/** Set the paid cursor before running any action price; reload cannot charge
 * the same energy/marker/Burst/Spirit Boost payment a second time. */
export function beginAutomaticCost(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], frame: ScriptFrame, choice: AutomaticCost["choices"][number]): void {
  const cost = frame.autoCost!;
  const rechecked = planCost(ctx, game, state, frame.master, choice.price, frame.card, choice.payment.rest);
  if (!rechecked.ok || !sameAutomaticPayment(rechecked.payment, choice.payment)) throw new IllegalAction("this Auto payment is no longer payable");
  const clone = structuredClone(state);
  chargeAutomaticPayment(ctx, game, clone, [], frame, choice.payment, cost.costs);
  if (!canFinishAutomaticPrice(ctx, game, clone, { ...frame, ...(choice.x !== undefined ? { x: choice.x } : {}) })) throw new IllegalAction("this Auto's complete payment is no longer payable");
  const spent = scopedPayersSpent(ctx, game, state, frame.master, { card: frame.card, skillIndex: cost.skill.index, skill: cost.skill, kind: cost.skill.kind, script: undefined });
  cost.stage = "action";
  if (choice.x !== undefined) frame.x = choice.x;
  chargeAutomaticPayment(ctx, game, state, ev, frame, choice.payment, cost.costs);
  spent(choice.payment.rest);
}
