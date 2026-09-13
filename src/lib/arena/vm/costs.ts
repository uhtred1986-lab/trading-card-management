/**
 * What a move costs, and what paying it takes — one planner over the **declared**
 * prices.
 *
 * In the legacy engine payment is `planPayment` (`engine/state.ts`): one search
 * over the Energy Area with a branch inside it for the coloured orbs, for an
 * either-orb, for X, for the cards 20-19 lets stand in for energy, and for
 * [Warrior of Universe 7] clearing the colours outright. It plays this game
 * correctly, and it can only ever play this game: a second game with a
 * different resource has nowhere to say so, and DBS's own alternative payments
 * — markers, life, a card rested where it stands — are branches rather than
 * prices.
 *
 * Here a price is a `DEFINE COST` (`rulesets/dbs/costs.rules`) and this module
 * is the one planner over them. It switches on the declaration's **`consumes:`**
 * word and never on its name, so a second game's `DEFINE COST mana /
 * consumes: energy` is charged by the same search DBS's `energy` is; and it
 * reads the declaration's `DO` for two things at once — the **pool** a price is
 * paid out of (its op's `target`, when that names an area) and what paying
 * **does** to what was taken from it.
 *
 * Three promises hold it to the engine that has been playing, and each is
 * asserted rather than assumed (`scripts/verify/vm.ts` §17):
 *
 *  1. **The same `Requirement`.** A price that cannot be met answers with the
 *     shapes `src/lib/arena/wording.ts` already words — `energy`,
 *     `energyColour`, `mode`, `unread`, `other` — so "needs {r}{r}, you have
 *     {r}" is one sentence written once. No second wording table, which is the
 *     rule Stage 5 holds throughout.
 *  2. **The same payment prompt.** The options are legacy `Payment` values and
 *     the question is the existing `payCost` prompt: no new `Prompt` kind, no
 *     `Snapshot` change, so `contract/fixtures/*` are untouched.
 *  3. **The price shown is the price charged.** `priceFor` is the one
 *     evaluation; `actionCostOf` turns it into the `ActionCost` a row wears and
 *     `planCost` into the payment that is taken. A menu entry whose figure came
 *     from a second reading is the drift these shared readings exist to
 *     prevent — the legacy engine has lost that bet twice (`activationCost`'s
 *     header, "X = 3" reading "free").
 *
 * **The seam, and what is still on the far side of it.** `cardPrice` below is
 * the one place the price of a card is read, and today it reads the *printed*
 * cost: the `energyCost` and `specifiedCost` attributes off the catalog. The
 * reductions of 20-21 — the flat one, the coloured one, and [Warrior of
 * Universe 7] clearing the colours of a Universe 7 card — are the `costOf`
 * attribute's declared `layers:`, and #142 landed the machinery that reads an
 * attribute through its layers (`./effects.ts`'s `valueOf`, `./program.ts`'s
 * `attrsNow`). It did **not** land these two, and named them as this issue's:
 * `LAYERS` has no row for `reduction` or `specified`, and `DEFERRED_STATICS`
 * hands `costReduction`, `altCost` and `payWith` here.
 *
 * They are not wired, on purpose, and it is worth saying why rather than
 * leaving a reader to wonder. Four of the pieces are missing and each is a
 * decision about the layer machinery rather than about a price: `valueOf`
 * accumulates *numbers*, and 20-21-2's floor at zero is not additive; a derived
 * attribute has no printed base, and nothing maps `costOf` back onto the
 * `energyCost` it discounts; the coloured half is a `colors` value and
 * `specifiedCost` declares no `layers:` at all; and `VmStatic.kind` is the
 * three kinds a value is read through, which `cost` and `specifiedCost` are
 * not. The fifth is the one that settles it: **nothing can put a cost reducer
 * in force on this engine yet** — `permanents` refuses `costReduction` by name
 * — so wiring the layers today would change no board and produce exactly the
 * "wired but inert" reducer `docs/arena-next-session-prompt.md` §4(c) records
 * as a trap. One function, so pointing it at the layers when they exist is one
 * change and not a hunt; until then a rules-engine price is the printed one and
 * `PRICE_LAYERS` says so in the log of any game that asks.
 *
 * Pure and client-safe, like the rest of `vm/`: no database, no network,
 * nothing read at request time.
 */
import type { EngineContext, GameEvent, ActionCost, Payer, Payment } from "../engine";
import type { Color, PlayerId, Requirement } from "../engine/types";
import type { Op, Selector } from "../engine/script";
import type { CostAsks, CostConsumes } from "../lang";
import type { ActionDef, CostDef, GameDefinition } from "../rulesets";
import { attrsOf } from "./cards";
import { NotYet, RulesetBroken } from "./errors";
import { SETUP_ZONES, moved } from "./flow";
import { log } from "./events";
import type { VmState } from "./state";

/**
 * What this engine reads of a price today, said once so a game that asks can
 * log it: the printed cost, with none of 20-21's reductions applied, because
 * the attribute layers that carry them are #142's.
 */
export const PRICE_LAYERS = "the printed cost (20-21's reductions arrive with the attribute layers, #142)";

// ── a declaration, read ─────────────────────────────────────────────────────

/**
 * One `DEFINE COST`, as the planner reads it.
 *
 * `from` is the pool the price is paid out of and comes off the declaration's
 * one op — `switchMode(target: IN you.energy active, …)` says both that the
 * price is paid with cards in the Energy Area and that a card has to be active
 * to pay it. `does` is the op itself, which is what paying does to what was
 * taken. Neither is a count: how many is the price's own amount, and an action
 * asks for a price by name.
 */
export interface Charge {
  name: string;
  consumes: CostConsumes;
  asks: CostAsks;
  from: { side: string; area: string; mode?: string } | null;
  does: Op | null;
}

/**
 * Every declared price, read once and refused by name where it cannot be.
 *
 * Called by `createGame` as its load check and by the planner on every
 * enumeration — it is a pure function of the definition, and a definition is
 * read once per process.
 */
export function chargesOf(game: GameDefinition): Record<string, Charge> {
  const out: Record<string, Charge> = {};
  for (const [name, def] of Object.entries(game.costs)) out[name] = chargeOf(game, name, def);
  return out;
}

/** The declared prices whose `consumes:` this planner charges. A word outside this list is a price it refuses by name rather than guesses at. */
const CHARGED: CostConsumes[] = ["energy", "markers", "life", "mode", "cards", "unreadable"];

function chargeOf(game: GameDefinition, name: string, def: CostDef): Charge {
  if (!CHARGED.includes(def.consumes)) {
    throw new RulesetBroken(game.id, `DEFINE COST ${JSON.stringify(name)} consumes ${JSON.stringify(def.consumes)}, and this planner charges ${CHARGED.join(", ")}`);
  }
  if (def.if !== undefined) throw new NotYet(`read the IF on the price ${name} — a price with a condition of its own`, "#142");
  if (def.do.length > 1) throw new RulesetBroken(game.id, `DEFINE COST ${JSON.stringify(name)} does ${def.do.length} things, and paying a price is one`);
  const does = def.do[0] ?? null;
  if (does && !PAYING_OPS.includes(does.op)) {
    throw new NotYet(`pay a price by ${JSON.stringify(does.op)}, which ${name} does — this planner reads ${PAYING_OPS.join(", ")}`, "#142");
  }
  return { name, consumes: def.consumes, asks: def.asks ?? "nothing", from: poolOf(game, name, does), does };
}

/** The ops a price may be paid by: rest what was taken, move it, or change the paying card's markers. */
const PAYING_OPS = ["switchMode", "moveTo", "addMarker", "removeMarker"];

/** The pool a price is paid out of, read off its op's `target` — null when the target is the card itself rather than a place to look. */
function poolOf(game: GameDefinition, name: string, op: Op | null): Charge["from"] {
  if (!op) return null;
  const target = (op as { target?: { sel?: Selector; var?: string } }).target;
  const sel = target && "sel" in target ? target.sel : undefined;
  if (!sel || sel.area === undefined) return null;
  if (!game.zones[sel.area]) throw new RulesetBroken(game.id, `the price ${name} is paid out of ${JSON.stringify(sel.area)}, which nothing declares`);
  return { side: sel.side ?? "you", area: sel.area, ...(sel.mode === undefined ? {} : { mode: sel.mode }) };
}

// ── the price of one move ───────────────────────────────────────────────────

/**
 * The whole price of one move, in the terms the declared costs are charged in.
 *
 * One value rather than a bag per cost kind, because a price is paid *once*:
 * a play that charges energy and rests the card is one decision, and the
 * shortfall a player is owed is the whole of what is missing.
 */
export interface Price {
  /** Energy to rest, in total (5-3). */
  energy: number;
  /** The coloured half, one count per colour (1-2-3). */
  orbs: Partial<Record<Color, number>>;
  /** "{r}/{u}": one orb payable with any one of these (22-13). One entry per such orb. */
  either: Color[][];
  /** Markers added (+) or removed (−) on the card whose skill is being paid for (13-4). */
  markers: number;
  /** Cards to place from life in the Drop (21-3). */
  life: number;
  /** Does paying switch the card itself to Rest Mode? */
  rest: boolean;
  /** 20-19: cards outside the Energy Area this price may be paid with, each carrying what it counts as. */
  payers: Payer[];
  /** The price as printed, for a `consumes: unreadable` cost. Null when every half of the price is chargeable. */
  unreadable: string | null;
}

/** A price of nothing — what a move with no `COST` costs, and the value every reading is built up from. */
export const freePrice = (): Price => ({ energy: 0, orbs: {}, either: [], markers: 0, life: 0, rest: false, payers: [], unreadable: null });

/**
 * What an action asks of this candidate, read off the prices it names.
 *
 * The amounts come off the **card**, because `ACTION … COST [energy]` passes no
 * arguments: binding a price's `TAKES` parameters is #147's, where a skill's
 * own `card_rules.cost` record supplies them. So two kinds are readable today
 * and the other three are refused *by name* rather than charged as nothing —
 * a declared price with no amount to charge would be a move taken for free,
 * which is the one outcome this whole issue exists to prevent.
 */
export function priceFor(ctx: EngineContext, game: GameDefinition, state: VmState, def: ActionDef, card: string | null): Price {
  const price = freePrice();
  if (!def.cost?.length) return price;
  const charges = chargesOf(game);
  for (const name of def.cost) {
    const charge = charges[name];
    if (!charge) throw new RulesetBroken(state.game, `${def.name} asks for a price called ${JSON.stringify(name)}, which nothing declares`);
    switch (charge.consumes) {
      case "energy": {
        const card_ = card === null ? null : cardPrice(ctx, game, state, card);
        price.energy += card_?.total ?? 0;
        for (const [colour, n] of Object.entries(card_?.orbs ?? {}) as [Color, number][]) price.orbs[colour] = (price.orbs[colour] ?? 0) + n;
        break;
      }
      case "mode":
        price.rest = true;
        break;
      case "unreadable":
        price.unreadable = charge.name;
        break;
      default:
        throw new NotYet(`charge the price ${name}, whose amount is on the card's own record and has nothing to bind it to`, "#147");
    }
  }
  return price;
}

/**
 * The price of playing this card, as this engine reads one.
 *
 * **The seam.** Today: the printed total and the printed orbs, straight off the
 * declared `energyCost` and `specifiedCost` attributes. Later: the `costOf`
 * attribute through `attrsNow`, whose declared `layers:` are `printed`,
 * `reduction`, `specified` — 20-21-1's flat discount, 20-21-2's coloured one,
 * and 22-19's [Warrior of Universe 7] clearing a Universe 7 card's colours
 * outright. The module header says which pieces of that are still missing and
 * why they are not wired ahead of a board that could put one in force.
 *
 * An X cost has no total until someone names one (1-2-2-2), and the attribute
 * is absent rather than zero for exactly that reason — so it reads as nothing
 * here and the value is the player's to name, which is #146's `play` with its
 * `x`.
 */
export function cardPrice(ctx: EngineContext, game: GameDefinition, state: VmState, card: string): { total: number; orbs: Partial<Record<Color, number>> } {
  const inst = state.cards[card];
  const def = inst && ctx.defs[inst.cardId];
  if (!def) return { total: 0, orbs: {} };
  const attrs = attrsOf(def, game).attrs;
  const total = typeof attrs.energyCost === "number" ? attrs.energyCost : 0;
  const orbs: Partial<Record<Color, number>> = {};
  const specified = attrs.specifiedCost;
  if (Array.isArray(specified)) for (const colour of specified as Color[]) orbs[colour] = (orbs[colour] ?? 0) + 1;
  return { total, orbs };
}

// ── what a row says it costs ────────────────────────────────────────────────

/**
 * The price a menu row wears (`docs/arena-workflow-spec.md` Phase 2), built
 * from the same `Price` the charge is taken from.
 *
 * The words are `activationCost`'s in `engine/engine.ts`, part for part, so a
 * client showing "2 energy (1 red) · +1 marker" shows the same sentence
 * whichever engine dealt the game — and `priceOf` in `wording.ts` still
 * assembles a play's half of it, which is why the orbs are handed over
 * separately rather than folded into the words.
 */
export function actionCostOf(price: Price): ActionCost | undefined {
  if (!price.energy && !Object.keys(price.orbs).length && !price.markers && !price.life && !price.rest && !price.either.length) return undefined;
  const bits: string[] = [];
  if (price.energy) bits.push(`${price.energy} energy${orbWords(price.orbs)}`);
  if (price.markers) bits.push(price.markers > 0 ? `+${price.markers} marker${price.markers === 1 ? "" : "s"}` : `${-price.markers} marker${price.markers === -1 ? "" : "s"}`);
  if (price.life) bits.push(`${price.life} life`);
  if (price.rest) bits.push("rests it");
  return {
    energy: price.energy,
    ...(Object.keys(price.orbs).length ? { orbs: price.orbs } : {}),
    ...(price.markers ? { markers: price.markers } : {}),
    describe: bits.join(" · ") || "free",
  };
}

const orbWords = (orbs: Partial<Record<Color, number>>): string => {
  const parts = Object.entries(orbs)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([c, n]) => `${n} ${c.toLowerCase()}`);
  return parts.length ? ` (${parts.join(", ")})` : "";
};

// ── the plan ────────────────────────────────────────────────────────────────

/** What paying one price takes. The energy half is the legacy `Payment`, so the `payCost` prompt needs no second shape. */
export interface VmPayment {
  /** Cards switched to Rest Mode: energy, and the 20-19 payers the plan reached for. */
  rest: string[];
  /** Energy markers spent (1-14-2). */
  energyMarkers: number;
  /** Markers added to (+) or removed from (−) the card being paid for (13-4). */
  markers: number;
  /** Cards taken from life, topmost first (21-3). */
  life: string[];
  /** Does paying switch the card itself to Rest Mode? */
  restsSelf: boolean;
}

export type CostPlan =
  | {
      ok: true;
      payment: VmPayment;
      /** The genuinely different ways to pay the energy half (3-8-2). One entry means the choice cannot matter and nothing is asked. */
      options: Payment[];
      /** The chosen payment in words, for the prompt: "2 Red, 1 Blue". */
      describe: string;
      /** Does this price put a question, or is it settled? Read off the declarations' `asks:`. */
      asks: boolean;
    }
  | { ok: false; why: Requirement[] };

/**
 * Can this player pay this price, and how.
 *
 * The energy search is `planPayment`'s, port for port: the specified colours
 * first from a mono-colour card and then from any card carrying the colour,
 * energy markers standing in for the Leader's colours (1-14-2), the rest spent
 * from whatever there is most of, and 20-19's payers tried only once the Energy
 * Area alone has failed — because 20-19 is a permission and resting a Battle
 * Card to pay for something the energy could have covered is a cost the player
 * never agreed to.
 */
export function planCost(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, price: Price, card: string | null, explicit?: string[]): CostPlan {
  const why = whyNot(ctx, game, state, player, price, card);
  if (why.length) return { ok: false, why };

  const energy = payEnergy(ctx, game, state, player, price, explicit);
  if (!energy) return { ok: false, why: [{ kind: "other", detail: "the active energy cannot cover the colours of the cost" }] };
  const lifeZone = state.sides[player].zones[SETUP_ZONES.life] ?? [];
  const payment: VmPayment = {
    rest: energy.rest,
    energyMarkers: energy.markers,
    markers: price.markers,
    // 3-9-4: any card in life may be chosen when one leaves, and the topmost is
    // the one damage takes — the same end the legacy engine deals from.
    life: price.life ? lifeZone.slice(0, price.life) : [],
    restsSelf: price.rest,
  };
  const charges = chargesOf(game);
  const asks = Object.values(charges).some((c) => c.asks === "choice" && (c.consumes === "energy" ? price.energy > 0 : c.consumes === "cards" && price.payers.length > 0));
  return { ok: true, payment, options: paymentOptions(ctx, game, state, player, price), describe: describePayment(ctx, game, state, payment), asks };
}

/**
 * Why this price cannot be paid, as requirements rather than as a plan — the
 * `whyNotPay` twin, in the same shapes and the same order.
 *
 * Empty when it can be paid. The count is the honest part: what is active plus
 * markers against the total, then each specified colour against the active
 * energy carrying it, then the halves that are not energy at all.
 */
function whyNot(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, price: Price, card: string | null): Requirement[] {
  const why: Requirement[] = [];
  // A price the engine cannot charge itself is refused before anything is
  // counted: an `unread` requirement naming the card, which is the answer the
  // legacy engine gives for a skill whose cost the compiler could not read.
  if (price.unreadable !== null && card !== null) return [{ kind: "unread", card }];
  if (price.unreadable !== null) return [{ kind: "other", detail: `the price ${price.unreadable} is the one as printed, which no engine charges itself` }];

  const active = activeEnergy(game, state, player);
  const extra = price.payers.filter((x) => !active.includes(x.id));
  const colours = new Map(extra.map((x) => [x.id, x.colors]));
  const pool = extra.length ? [...active, ...extra.map((x) => x.id)] : active;
  const markers = Number(state.sides[player].attrs.energyMarkers ?? 0);
  const leader = leaderColors(ctx, game, state, player);
  const colorsOf = (id: string) => colours.get(id) ?? cardColors(ctx, game, state, id);

  const have = pool.length + markers;
  if (have < price.energy) why.push({ kind: "energy", need: price.energy, have });
  const haveColour = (c: Color) => pool.filter((id) => colorsOf(id).includes(c)).length + (leader.includes(c) ? markers : 0);
  for (const c of Object.keys(price.orbs) as Color[]) {
    const need = price.orbs[c] ?? 0;
    if (need > 0 && haveColour(c) < need) why.push({ kind: "energyColour", colour: c, need, have: haveColour(c) });
  }
  for (const orb of price.either) {
    if (!orb.some((c) => haveColour(c) > 0)) why.push({ kind: "energyColour", colour: orb.join("/"), need: 1, have: 0 });
  }

  // 13-4: a marker price is paid with the markers on the card, and a card
  // cannot be taken below none. The words are the legacy engine's.
  if (price.markers < 0 && card !== null) {
    const on = state.cards[card]?.markers ?? 0;
    if (on + price.markers < 0) why.push({ kind: "other", detail: `needs ${-price.markers} markers (${on} on it)` });
  }
  if (price.life > 0) {
    const on = (state.sides[player].zones[SETUP_ZONES.life] ?? []).length;
    if (on < price.life) why.push({ kind: "other", detail: `needs ${price.life} life (${on} left)` });
  }
  // 1-10-1: a card already in Rest Mode has nothing left to rest. The
  // requirement is the one a client already draws as "resting".
  if (price.rest && card !== null && state.cards[card]?.mode === "rest") why.push({ kind: "mode", card, mode: "rest" });

  if (!why.length && !payEnergy(ctx, game, state, player, price)) {
    why.push({ kind: "other", detail: "the active energy cannot cover the colours of the cost" });
  }
  return why;
}

/**
 * The energy half of a plan: `planPayment` over the declared board.
 *
 * An either-orb is settled by trying each assignment and letting the ordinary
 * specified search answer the question it already knows how to answer — the
 * legacy engine's own trick, exact because no printed skill carries more than
 * one such orb.
 */
function payEnergy(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, price: Price, explicit?: string[]): Payment | null {
  if (price.either.length) {
    let assignments: Color[][] = [[]];
    for (const orb of price.either.slice(0, 3)) {
      const next: Color[][] = [];
      for (const soFar of assignments) for (const c of orb) next.push([...soFar, c]);
      assignments = next;
    }
    for (const pick of assignments) {
      const orbs = { ...price.orbs };
      for (const c of pick) orbs[c] = (orbs[c] ?? 0) + 1;
      const got = payEnergy(ctx, game, state, player, { ...price, orbs, either: [] }, explicit);
      if (got) return got;
    }
    return null;
  }
  // A price cannot demand more orbs than it charges energy: the planner fills
  // the colours first and tops up to the total, so a larger requirement would
  // hand back a payment *bigger* than the price asked for.
  if (orbCount(price.orbs) > price.energy) return null;

  const energy = activeEnergy(game, state, player);
  const extra = price.payers.filter((x) => !energy.includes(x.id));
  const colours = new Map(extra.map((x) => [x.id, x.colors]));
  const all = extra.length ? [...energy, ...extra.map((x) => x.id)] : energy;
  const markersLeft = Number(state.sides[player].attrs.energyMarkers ?? 0);
  const leader = leaderColors(ctx, game, state, player);
  const colorsOf = (id: string) => colours.get(id) ?? cardColors(ctx, game, state, id);

  if (explicit) {
    if (explicit.some((id) => !all.includes(id))) return null;
    const markers = Math.max(0, price.energy - explicit.length);
    if (markers > markersLeft) return null;
    if (explicit.length + markers !== price.energy) return null;
    const need = { ...price.orbs };
    for (const id of explicit) {
      for (const c of colorsOf(id)) {
        if ((need[c] ?? 0) > 0) {
          need[c]!--;
          break;
        }
      }
    }
    let m = markers;
    for (const c of leader)
      while (m > 0 && (need[c] ?? 0) > 0) {
        need[c]!--;
        m--;
      }
    if (Object.values(need).some((n) => (n ?? 0) > 0)) return null;
    return { rest: explicit, markers };
  }

  const attempt = (from: string[]): Payment | null => {
    const chosen: string[] = [];
    const pool = from.slice();
    const need = { ...price.orbs };
    for (const c of Object.keys(need) as Color[]) {
      for (let n = need[c] ?? 0; n > 0; n--) {
        let pick = pool.find((id) => colorsOf(id).length === 1 && colorsOf(id)[0] === c) ?? pool.find((id) => colorsOf(id).includes(c));
        if (!pick && leader.includes(c) && markersLeft > chosen.filter((x) => x === MARKER).length) pick = MARKER;
        if (!pick) return null;
        chosen.push(pick);
        if (pick !== MARKER) pool.splice(pool.indexOf(pick), 1);
      }
    }
    while (chosen.length < price.energy) {
      if (pool.length === 0) {
        if (markersLeft > chosen.filter((x) => x === MARKER).length) {
          chosen.push(MARKER);
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
    return { rest: chosen.filter((x) => x !== MARKER), markers: chosen.filter((x) => x === MARKER).length };
  };
  return attempt(energy) ?? (extra.length ? attempt(all) : null);
}

/** The stand-in an energy marker takes in the chosen list, so one search covers cards and markers at once. */
const MARKER = "#marker";

/** How much energy a coloured requirement alone accounts for. */
export const orbCount = (orbs: Partial<Record<Color, number>>): number => Object.values(orbs).reduce((a: number, b) => a + (b ?? 0), 0);

/**
 * The genuinely different ways to pay (3-8-2). Two payments resting the same
 * combination of colours are the same choice and are folded together; when one
 * survives, the choice cannot matter and the caller pays it without asking.
 */
export function paymentOptions(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, price: Price, limit = 8): Payment[] {
  const markersLeft = Number(state.sides[player].attrs.energyMarkers ?? 0);
  const leader = leaderColors(ctx, game, state, player);
  const energy = activeEnergy(game, state, player);
  const extra = price.payers.filter((x) => !energy.includes(x.id));
  const colours = new Map(extra.map((x) => [x.id, x.colors]));
  const colorsOf = (id: string) => colours.get(id) ?? cardColors(ctx, game, state, id);
  const byColors = new Map<string, string[]>();
  for (const id of energy) {
    const k = colorsOf(id).join("/");
    byColors.set(k, [...(byColors.get(k) ?? []), id]);
  }
  // 20-19: each card that may stand in for energy is its own group, never
  // folded into the energy of the same colour — resting a Battle Card is a
  // different choice from resting an energy card that happens to match.
  for (const x of extra) byColors.set(`payer:${x.id}`, [x.id]);
  const keys = [...byColors.keys()].sort();
  const out: Payment[] = [];
  const seen = new Set<string>();

  const covers = (picked: string[], markers: number): boolean => {
    const need = { ...price.orbs };
    for (const id of picked) {
      for (const c of colorsOf(id)) {
        if ((need[c] ?? 0) > 0) {
          need[c]!--;
          break;
        }
      }
    }
    let m = markers;
    for (const c of leader)
      while (m > 0 && (need[c] ?? 0) > 0) {
        need[c]!--;
        m--;
      }
    return !Object.values(need).some((n) => (n ?? 0) > 0);
  };

  const take = (i: number, left: number, picked: string[], counts: (number | string)[]): void => {
    if (out.length >= limit) return;
    if (left === 0) {
      if (!covers(picked, 0)) return;
      const sig = counts.join(",");
      if (seen.has(sig)) return;
      seen.add(sig);
      out.push({ rest: picked.slice(), markers: 0 });
      return;
    }
    if (i >= keys.length) {
      if (left <= markersLeft && covers(picked, left)) {
        const sig = [...counts, `m${left}`].join(",");
        if (!seen.has(sig)) {
          seen.add(sig);
          out.push({ rest: picked.slice(), markers: left });
        }
      }
      return;
    }
    const pool = byColors.get(keys[i])!;
    for (let n = Math.min(pool.length, left); n >= 0; n--) take(i + 1, left - n, [...picked, ...pool.slice(0, n)], [...counts, n]);
  };
  take(0, price.energy, [], []);
  return out;
}

/** A short label for one payment, for the prompt: "2 Red, 1 Blue". The legacy engine's wording, card for card. */
export function describePayment(ctx: EngineContext, game: GameDefinition, state: VmState, payment: VmPayment): string {
  const counts = new Map<string, number>();
  const named: string[] = [];
  const energyZone = Object.values(chargesOf(game)).find((c) => c.consumes === "energy")?.from?.area ?? null;
  for (const id of payment.rest) {
    // 20-19: a card rested from outside the Energy Area is named rather than
    // counted — the player is being asked whether to rest a Battle Card, and
    // the card's name is the whole question.
    if (zoneOf(state, id) !== energyZone) {
      named.push(cardName(ctx, state, id));
      continue;
    }
    const k = cardColors(ctx, game, state, id).join("/") || "Colourless";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const parts = [...counts.entries()].map(([k, n]) => `${n} ${k}`);
  parts.push(...named);
  if (payment.energyMarkers) parts.push(`${payment.energyMarkers} energy marker${payment.energyMarkers === 1 ? "" : "s"}`);
  if (payment.markers) parts.push(payment.markers > 0 ? `+${payment.markers} marker${payment.markers === 1 ? "" : "s"}` : `${-payment.markers} marker${payment.markers === -1 ? "" : "s"}`);
  if (payment.life.length) parts.push(`${payment.life.length} life`);
  if (payment.restsSelf) parts.push("rests it");
  return parts.join(", ") || "nothing";
}

// ── taking it ───────────────────────────────────────────────────────────────

/**
 * Charge the plan, doing to each thing taken what its price's `DO` says.
 *
 * The events are the legacy engine's, event for event, which is what
 * `arena:diff` compares: a `mode` per card rested, one `energyMarker` for the
 * markers spent, a `markers` for the card's own, and a `move` per life card.
 */
export function chargeCost(
  ctx: EngineContext,
  game: GameDefinition,
  state: VmState,
  ev: GameEvent[],
  player: PlayerId,
  payment: VmPayment,
  card: string | null,
  costs: string[],
): void {
  const charges = chargesOf(game);
  for (const name of costs) {
    const charge = charges[name];
    if (!charge) throw new RulesetBroken(state.game, `there is no price called ${JSON.stringify(name)} to charge`);
    switch (charge.consumes) {
      case "energy":
      case "cards": {
        const mode = modeOf(charge);
        for (const id of payment.rest) setMode(state, ev, id, mode);
        if (payment.energyMarkers) {
          state.sides[player].attrs.energyMarkers = Number(state.sides[player].attrs.energyMarkers ?? 0) - payment.energyMarkers;
          log(ev, { type: "energyMarker", player, delta: -payment.energyMarkers });
        }
        break;
      }
      case "markers": {
        if (card === null || !payment.markers) break;
        const inst = state.cards[card];
        inst.markers = Math.max(0, inst.markers + payment.markers);
        log(ev, { type: "markers", card, delta: payment.markers, total: inst.markers });
        break;
      }
      case "life": {
        const to = (charge.does as { to?: string } | null)?.to;
        if (!to) throw new RulesetBroken(state.game, `the price ${name} takes cards from life and says nowhere to put them`);
        for (const id of payment.life) moved(ctx, game, state, ev, id, to, { owner: player, asPlay: false });
        break;
      }
      case "mode":
        if (card !== null && payment.restsSelf) setMode(state, ev, card, modeOf(charge));
        break;
      case "unreadable":
        throw new RulesetBroken(state.game, `the price ${name} is the one as printed and was charged anyway`);
    }
  }
}

/** The mode a price switches what it took into — the declaration's, never a word this module chose. */
function modeOf(charge: Charge): string {
  const mode = (charge.does as { mode?: string } | null)?.mode;
  if (!mode) throw new Error(`the price ${charge.name} rests what it takes and says no mode`);
  return mode;
}

/** 0-2-4-1: a card already in that mode does not switch, and an event for a change that did not happen is a beat the board plays over nothing. */
function setMode(state: VmState, ev: GameEvent[], id: string, mode: string): void {
  const inst = state.cards[id];
  if (!inst || inst.mode === mode) return;
  inst.mode = mode;
  if (mode === "active" || mode === "rest") log(ev, { type: "mode", card: id, mode });
}

// ── reading the board ───────────────────────────────────────────────────────

/**
 * The energy this player could rest right now: the cards in the zone the
 * `energy` price is paid out of, in the mode its declaration says they have to
 * be in.
 *
 * Both come off `costs.rules` rather than from a name here — which is the one
 * thing that makes this a planner over *declared* prices and not a second copy
 * of `planPayment` with the zone spelled differently.
 */
export function activeEnergy(game: GameDefinition, state: VmState, player: PlayerId): string[] {
  const charge = Object.values(chargesOf(game)).find((c) => c.consumes === "energy");
  if (!charge?.from) return [];
  const side = charge.from.side === "opponent" ? other(player) : player;
  const ids = state.sides[side].zones[charge.from.area] ?? [];
  if (charge.from.mode === undefined) return ids.slice();
  return ids.filter((id) => state.cards[id]?.mode === charge.from!.mode);
}

/** 1-14-2: an energy marker pays one energy of the Leader's colours, so the Leader is read for them and nothing else. */
function leaderColors(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId): Color[] {
  const leader = (state.sides[player].zones[SETUP_ZONES.leader] ?? [])[0];
  return leader ? cardColors(ctx, game, state, leader) : [];
}

/** A card's colours, by declared attribute (2-2). */
function cardColors(ctx: EngineContext, game: GameDefinition, state: VmState, id: string): Color[] {
  const inst = state.cards[id];
  const def = inst && ctx.defs[inst.cardId];
  if (!def) return [];
  const colors = attrsOf(def, game).attrs.colors;
  return Array.isArray(colors) ? ([...colors] as Color[]) : [];
}

const cardName = (ctx: EngineContext, state: VmState, id: string): string => {
  const inst = state.cards[id];
  return (inst && ctx.defs[inst.cardId]?.name) || inst?.cardId || id;
};

/** Which zone a card is in, on either side. */
function zoneOf(state: VmState, id: string): string | null {
  for (const side of Object.values(state.sides)) {
    for (const [zone, ids] of Object.entries(side.zones)) if (ids.includes(id)) return zone;
  }
  return null;
}

const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");
