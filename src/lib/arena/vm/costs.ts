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
 * **Which number, and how far through the layers.** Which attribute a price is
 * read off is the *declaration's* to say — `amount: "costOf"` on `DEFINE COST
 * energy`, `amount: "zEnergyCostOf"` on `zEnergy` (#146) — so this module names
 * no cost field, and 20-21's reductions reach a play's price through the
 * declared `layers:` rather than through a second reading here. `amountOn`
 * reads that attribute through `attrsNow`, which is the one place a layered
 * value is computed on this engine.
 *
 * That seam is now closed, and it closed because a [Permanent] could finally be
 * in play (#146): a card could not be put on the table before there was a move
 * that played one, so wiring the layers earlier would have produced exactly the
 * "wired but inert" reducer `docs/arena-next-session-prompt.md` §4(c) records as
 * a trap. The four pieces #148 named are all built, and none of them is a line
 * in this file:
 *
 *  - `PRINTED_BASE` in `./cards.ts` pairs a derived price with the printed
 *    number it discounts, so `costOf` reads as a total rather than as nothing;
 *  - `LAYER_KINDS` in `./effects.ts` pairs an attribute's name with the effect
 *    `kind` a layer of it reads, because the attribute is `costOf` and the
 *    effect a skill puts in force says `cost`;
 *  - the `reduction` layer subtracts and **floors at zero** (20-21-2) rather
 *    than accumulating, which is why a layer is a function and not a sum;
 *  - `specifiedCost` declares `[printed, reduction, specified]` and carries a
 *    `colors` value through both, so the coloured half moves — one orb with
 *    each energy a flat reducer takes off, and on its own for a sentence that
 *    only relaxes a colour (the owner's BT19-039 ruling of 9 Sep 2026).
 *
 * One half of 20-21 is still out, and it is a **keyword** rather than a
 * reduction: 22-19's [Warrior of Universe 7] clears a ≪Universe 7≫ card's
 * specified cost outright, and a keyword's own body is a `DEFINE KEYWORD` hook
 * and Stage 7's (#153–#157). Reading that one keyword by name here would be the
 * branch this module exists to remove. `PRICE_LAYERS` says so in the log of any
 * game that asks how far the reading goes.
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
import { attrsNow } from "./program";
import { NotYet, RulesetBroken } from "./errors";
import { SETUP_ZONES, moved } from "./flow";
import { log } from "./events";
import type { VmState } from "./state";

/**
 * What this engine reads of a price today, said once so a game that asks can
 * log it: the attribute the `DEFINE COST` names, through that attribute's
 * declared layers — which come to the printed total, because no cost reducer
 * can be in force on this engine yet (see the header).
 */
export const PRICE_LAYERS = "the cost attribute the price declares, through the layers it declares — every cost reduction in force, flat and coloured, floored at zero (20-21); 22-19's [Warrior of Universe 7] is a keyword body and waits on Stage 7";

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
  /**
   * The card attribute this price's amount is read off (20-21), or null when
   * the declaration names none. `amount: "costOf"` is how a play's price reaches
   * every reduction in force through the declared `layers:` rather than through
   * a reading of its own.
   */
  amount: string | null;
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
  if (def.amount !== undefined && game.attributes[def.amount]?.of !== "card") {
    throw new RulesetBroken(game.id, `DEFINE COST ${JSON.stringify(name)} reads its amount off ${JSON.stringify(def.amount)}, which is not an attribute a card has`);
  }
  const from = poolOf(game, name, does);
  // A price that takes *so many* of something has to say how many, and the only
  // place the number can come from is the card being paid for. Without it the
  // amount would read as zero and the move would be taken for free, which is
  // the one outcome this whole module exists to prevent — so it is refused when
  // the game is made rather than the first time a card asks for it.
  if (def.amount === undefined && (def.consumes === "energy" || (def.consumes === "cards" && from))) {
    throw new RulesetBroken(game.id, `DEFINE COST ${JSON.stringify(name)} takes ${def.consumes} and names no amount:, so a move asking for it would be charged nothing`);
  }
  return { name, consumes: def.consumes, amount: def.amount ?? null, asks: def.asks ?? "nothing", from, does };
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
  /** 5-4: cards taken out of a declared pool — a Z-card's Z-Energy. One entry per price that takes them. */
  pooled: PooledPrice[];
  /** The price as printed, for a `consumes: unreadable` cost. Null when every half of the price is chargeable. */
  unreadable: string | null;
  /**
   * A price whose **amount** the card does not carry, by the name of the price
   * that asked for it. 1-2-2-2: an X cost has no total until its master names
   * one, and the value is an answer to a question rather than a fact about the
   * card — so the attribute is absent rather than zero (`vm/cards.ts`) and a
   * move asking for such a price is *refused* rather than charged as nothing.
   * Null when every amount is known.
   */
  unpriced: string | null;
}

/** One price paid out of a declared place: which cards, and how many (5-4). */
export interface PooledPrice {
  /** The `DEFINE COST` that takes them, so the charge does to them what that declaration's `DO` says. */
  cost: string;
  side: string;
  area: string;
  n: number;
}

/** A price of nothing — what a move with no `COST` costs, and the value every reading is built up from. */
export const freePrice = (): Price => ({ energy: 0, orbs: {}, either: [], markers: 0, life: 0, rest: false, payers: [], pooled: [], unreadable: null, unpriced: null });

/**
 * The amounts a move's prices are **bound** to, when they come from the thing
 * being paid for rather than from an attribute of the card (#147).
 *
 * `ACTION play COST [energy]` passes no arguments, so the number comes off the
 * card through the declaration's `amount:` — that is a price paid *for a card*,
 * and the card carries what it costs. An activation is a price paid for **a
 * skill line**, and no attribute of the card says what one line charges: the
 * orbs are printed in front of that line and everything else is on the line's
 * own `card_rules` record. So the interpreter that knows which line is being
 * paid for hands the amounts in, by the `consumes:` word of the price they
 * answer — never by a declaration's name, which is the rule this whole module
 * is written to.
 *
 * A kind left out is a price still read off the card, so one binding does not
 * silently zero the others; `unreadable` is the one that reads `null` as an
 * answer, because "this price is chargeable after all" is a thing an activation
 * has to be able to say about the declared `text` price.
 */
export interface BoundAmounts {
  /** `consumes: energy` — the total, its coloured half (1-2-3) and its either-orbs (22-13). `total: null` is a price nobody has named (1-2-2-2). */
  energy?: { total: number | null; orbs: Partial<Record<Color, number>>; either: Color[][] };
  /** `consumes: markers` — 13-4's marker cost, negative to remove that many. */
  markers?: number;
  /** `consumes: life` — 21-3. */
  life?: number;
  /**
   * `consumes: cards` with no declared pool — 20-19's `payWith`: the cards this
   * *line's own price* names as payers, already resolved against the board and
   * carrying what each counts as (colours of its own, or the one orb named).
   * This is the same shape `Price.payers` carries and `planCost`/`chargeCost`
   * already read (§17's own test builds one by hand); what was missing is
   * something to fill it in from a record rather than from nothing. An
   * activation reads it off the record's own `payWith` (`vm/activate.ts`'s
   * `boundFor`), scoped to the skill whose price carries it — never off a
   * [Permanent]'s standing grant, which is `DEFERRED_STATICS`' `payWith` and a
   * wider reading `permanents` does not make yet. Absent (not an empty array)
   * is "nothing bound this price", which is what leaves the `unread` `NotYet`
   * for a caller that names `payWith` and binds nothing.
   */
  payers?: Payer[];
  /** `consumes: unreadable` — the printed price, or `null` for a price this engine can charge after all. */
  unreadable?: string | null;
}

/**
 * What an action asks of this candidate, read off the prices it names.
 *
 * Where each amount comes from is the declaration's business and then the
 * caller's: `amount:` names the card attribute a price paid *for a card* is
 * read off, and `bound` is what a caller paying for something smaller than a
 * card — a skill line — hands in instead (#147). A price with neither is
 * refused **by name** rather than charged as nothing, because a declared price
 * with no amount would be a move taken for free, which is the one outcome this
 * module exists to prevent.
 */
export function priceFor(ctx: EngineContext, game: GameDefinition, state: VmState, def: ActionDef, card: string | null, bound?: BoundAmounts): Price {
  const price = freePrice();
  if (!def.cost?.length) return price;
  const charges = chargesOf(game);
  for (const name of def.cost) {
    const charge = charges[name];
    if (!charge) throw new RulesetBroken(state.game, `${def.name} asks for a price called ${JSON.stringify(name)}, which nothing declares`);
    switch (charge.consumes) {
      case "energy": {
        const read = bound?.energy ?? (card === null ? null : amountOn(ctx, game, state, charge, card));
        if (read && read.total === null) price.unpriced = charge.name;
        price.energy += read?.total ?? 0;
        for (const [colour, n] of Object.entries(read?.orbs ?? {}) as [Color, number][]) price.orbs[colour] = (price.orbs[colour] ?? 0) + n;
        if (bound?.energy) price.either.push(...bound.energy.either);
        break;
      }
      // 5-4: cards out of a declared place. The pool is the op's own target, so
      // the planner knows where to take them from and the charge knows what to
      // do with them, without either naming this price.
      case "cards": {
        if (!charge.from) {
          // 20-19's payers: cards the price was *handed*, rested where they
          // stand. An activation binds them from the record's own `payWith`
          // (`vm/activate.ts`'s `boundFor`, the #147 precedent); a caller that
          // names this price and binds nothing is refused by name rather than
          // charged as nothing — the [Permanent] standing-grant reading
          // (`DEFERRED_STATICS`' wider `payWith`) is still such a caller.
          if (!bound?.payers) {
            throw new NotYet(`charge the price ${name}, whose cards are named by the skill asking for it and have nothing to bind them to`, "#149");
          }
          price.payers.push(...bound.payers);
          break;
        }
        const read = card === null ? null : amountOn(ctx, game, state, charge, card);
        if (read && read.total === null) price.unpriced = charge.name;
        if (read?.total) price.pooled.push({ cost: charge.name, side: charge.from.side, area: charge.from.area, n: read.total });
        break;
      }
      case "mode":
        price.rest = true;
        break;
      case "unreadable":
        // The one price whose *absence* is an answer: an action that names it
        // and binds `null` is saying this candidate's printed price is one the
        // engine can charge after all, which is what an activation says about
        // a skill whose orbs are the whole of its cost.
        price.unreadable = bound?.unreadable !== undefined ? bound.unreadable : charge.name;
        break;
      case "markers":
        if (bound?.markers === undefined) throw new NotYet(`charge the price ${name}, whose amount is on the card's own record and has nothing to bind it to`, "#149");
        price.markers += bound.markers;
        break;
      case "life":
        if (bound?.life === undefined) throw new NotYet(`charge the price ${name}, whose amount is on the card's own record and has nothing to bind it to`, "#149");
        price.life += bound.life;
        break;
      default:
        throw new NotYet(`charge the price ${name}, whose amount is on the card's own record and has nothing to bind it to`, "#149");
    }
  }
  return price;
}

/**
 * What one declared price asks of one card: the amount its `amount:` names,
 * read **through the declared layers**, and the coloured half beside it.
 *
 * `null` for the total is the honest answer to an X cost: 1-2-2-2 says the
 * value is named by the card's master at the moment of payment, so the
 * attribute is absent rather than zero (`vm/cards.ts`) and this returns absence
 * rather than a number nobody chose. `priceFor` turns that into `unpriced`, and
 * `whyNot` into the `unread` requirement the legacy engine gives for a price it
 * cannot read.
 */
function amountOn(ctx: EngineContext, game: GameDefinition, state: VmState, charge: Charge, card: string): { total: number | null; orbs: Partial<Record<Color, number>> } {
  const inst = state.cards[card];
  const def = inst && ctx.defs[inst.cardId];
  if (!def) return { total: 0, orbs: {} };
  // The layers the declaration names (9-9-1, 20-21). `costOf` has no printed
  // face of its own and `PRINTED_BASE` pairs it with the `energyCost` it
  // discounts, so the reading below is the printed total less every reduction
  // in force — standing from a [Permanent] or put there for the turn by a skill
  // that resolved, which are one list to `valueOf` as they are to `playCost`.
  const now = charge.amount ? attrsNow(ctx, game, state, card) : {};
  const named = charge.amount ? now[charge.amount] : undefined;
  const total = charge.amount === null ? 0 : typeof named === "number" ? named : null;
  const orbs: Partial<Record<Color, number>> = {};
  // The other half, read through its own layers like the first: `specifiedCost`
  // declares `[printed, reduction, specified]`, so a flat reducer takes an orb
  // off with each energy it takes off the total (20-21-2) and a "reduce the
  // specified cost by {u}" relaxes the colour without moving the total at all.
  // Only an energy price has one — cards taken out of a pool have no colour.
  if (charge.consumes === "energy") {
    const specified = (charge.amount ? now : attrsNow(ctx, game, state, card)).specifiedCost;
    if (Array.isArray(specified)) for (const colour of specified as Color[]) orbs[colour] = (orbs[colour] ?? 0) + 1;
  }
  return { total, orbs };
}

/**
 * The price of playing this card, as this engine reads one: the energy price
 * the game declares, read off the attribute that declaration names.
 *
 * The total floors at 0 where the card has no amount to give, which is the
 * legacy `playCost(ctx, s, id)` reading with `x` unchosen and is what keeps the
 * two engines comparable card for card (`verify/vm.ts` §17). A *move* asking
 * for such a price is not charged that 0 — `priceFor` marks it `unpriced` and
 * the planner refuses it — because "nobody has named X" and "this card is free"
 * are different claims.
 */
export function cardPrice(ctx: EngineContext, game: GameDefinition, state: VmState, card: string): { total: number; orbs: Partial<Record<Color, number>> } {
  const charge = Object.values(chargesOf(game)).find((c) => c.consumes === "energy");
  if (!charge) return { total: 0, orbs: {} };
  const read = amountOn(ctx, game, state, charge, card);
  return { total: read.total ?? 0, orbs: read.orbs };
}

/**
 * The legal values of an X-cost candidate's price, one per row the menu
 * offers (issue #270) — the legacy engine's own X loop (`legalActions`' play
 * and Unison branches), read generically off the declaration rather than a
 * branch per card shape. Empty for a card whose cost is not X (`cardPrice`
 * already has a total): the caller's ordinary single-candidate path is for
 * that card, and empty too for an action that does not declare `x: true` —
 * enumerating is opt-in per move, not a fact about the card alone.
 *
 * The floor is the coloured requirement alone (`specifiedCost`'s orb count):
 * 1-2-3 demands at least that many energy whatever X is chosen, never the
 * total itself, which is exactly the number nobody has named yet. The
 * ceiling is what this player could pay in full — every energy this price
 * reads from (`activeEnergy`) plus their markers. Every value in between is
 * offered only when `planCost` actually agrees it can be paid, because a
 * total between the two but short of one particular colour is still short.
 */
export function xValues(ctx: EngineContext, game: GameDefinition, state: VmState, def: ActionDef, player: PlayerId, card: string): { values: { x: number; price: Price }[]; unaffordable: Requirement[] } {
  if (!def.x) return { values: [], unaffordable: [] };
  const charge = Object.values(chargesOf(game)).find((c) => c.consumes === "energy");
  if (!charge) return { values: [], unaffordable: [] };
  const read = amountOn(ctx, game, state, charge, card);
  if (read.total !== null) return { values: [], unaffordable: [] };
  const floor = Math.max(def.xMin ?? 0, Object.values(read.orbs).reduce((n: number, c) => n + (c ?? 0), 0));
  const ceiling = activeEnergy(game, state, player).length + Number(state.sides[player].attrs.energyMarkers ?? 0);
  const priceAt = (x: number) => priceFor(ctx, game, state, def, card, { energy: { total: x, orbs: read.orbs, either: [] } });
  const values: { x: number; price: Price }[] = [];
  for (let x = floor; x <= ceiling; x++) {
    const price = priceAt(x);
    if (planCost(ctx, game, state, player, price, card).ok) values.push({ x, price });
  }
  // 1-2-2-2-1: nothing affordable at all — the smallest X that could satisfy
  // the coloured requirement is the price the refusal is worded against, the
  // same floor `whyNotPlayFromHand` refuses an X-cost card with.
  let unaffordable: Requirement[] = [];
  if (!values.length) {
    const plan = planCost(ctx, game, state, player, priceAt(floor), card);
    if (!plan.ok) unaffordable = plan.why;
  }
  return { values, unaffordable };
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
  if (!price.energy && !Object.keys(price.orbs).length && !price.markers && !price.life && !price.rest && !price.either.length && !price.pooled.length) return undefined;
  const bits: string[] = [];
  if (price.energy) bits.push(`${price.energy} energy${orbWords(price.orbs)}`);
  // 5-4: the Z-Energy half, named by the place it comes out of, so the row says
  // "2 Z-Energy" because the game declares a zone of that name.
  for (const pooled of price.pooled) bits.push(`${pooled.n} ${pooled.area}`);
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
  /** 5-4: the cards each pooled price takes, in the order they are taken. */
  pooled: { cost: string; cards: string[] }[];
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
    // 5-4: the Z-Energy is spent from the end of the pile, one at a time, which
    // is the order the legacy `payZEnergy` takes it in and therefore the order
    // the Drop Area ends up in.
    pooled: price.pooled.map((p) => ({ cost: p.cost, cards: poolCards(state, player, p).slice(-p.n).reverse() })),
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
  // 1-2-2-2: an X cost, whose value is an answer to a question this engine has
  // no way to carry on a menu entry — a candidate is a card and nothing else
  // (`DECLARABLE_ACTIONS`). The same `unread` a skill whose price the compiler
  // could not read is refused with, and for the same reason: a price nobody
  // has settled is not a price of nothing.
  if (price.unpriced !== null && card !== null) return [{ kind: "unread", card }];
  if (price.unpriced !== null) return [{ kind: "other", detail: `the amount of the price ${price.unpriced} has not been named` }];

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
  // 5-4-2: a Z-card may not be played with less Z-Energy than it asks for. The
  // place is the declaration's, so the sentence names the zone the game
  // declares rather than a word this module chose.
  for (const pooled of price.pooled) {
    const have = poolCards(state, player, pooled).length;
    if (have < pooled.n) why.push({ kind: "other", detail: `needs ${pooled.n} in your ${pooled.area} (${have} there)` });
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
  for (const pooled of payment.pooled) if (pooled.cards.length) parts.push(`${pooled.cards.length} ${pooled.cost}`);
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
      case "energy": {
        const mode = modeOf(charge);
        for (const id of payment.rest) setMode(state, ev, id, mode);
        if (payment.energyMarkers) {
          state.sides[player].attrs.energyMarkers = Number(state.sides[player].attrs.energyMarkers ?? 0) - payment.energyMarkers;
          log(ev, { type: "energyMarker", player, delta: -payment.energyMarkers });
        }
        break;
      }
      case "cards": {
        // The two `cards` prices are told apart the way every price is — by
        // reading the `DO`, never the name. A target that names a **place** is
        // a pool the cards come out of (5-4's Z-Energy), and they go where the
        // op says; a target that names cards the price was handed is 20-19's
        // payers, rested where they stand.
        if (!charge.from) {
          const mode = modeOf(charge);
          for (const id of payment.rest) setMode(state, ev, id, mode);
          break;
        }
        const to = (charge.does as { to?: string } | null)?.to;
        if (!to) throw new RulesetBroken(state.game, `the price ${name} takes cards out of the ${charge.from.area} and says nowhere to put them`);
        for (const id of payment.pooled.find((x) => x.cost === name)?.cards ?? []) moved(ctx, game, state, ev, id, to, { owner: player, asPlay: false });
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
        // Nothing: the half of a printed price no engine charges itself is
        // charged by nobody. A price that really *is* unreadable never reaches
        // here — `planCost` refuses the move with `unread` before anything is
        // taken — so an action naming this price and getting this far is one
        // whose candidate bound the price away as chargeable after all (#147,
        // an activation whose whole cost is orbs).
        break;
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

/**
 * The cards one pooled price could be paid out of, in the order they lie.
 *
 * The place and the side are the declaration's — the price's `DO` named them —
 * so this is the same reading `activeEnergy` makes of the energy price, with
 * nothing named here.
 */
export function poolCards(state: VmState, player: PlayerId, pooled: PooledPrice): string[] {
  const side = pooled.side === "opponent" ? other(player) : player;
  return (state.sides[side].zones[pooled.area] ?? []).slice();
}

/** 1-14-2: an energy marker pays one energy of the Leader's colours, so the Leader is read for them and nothing else. */
function leaderColors(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId): Color[] {
  const leader = (state.sides[player].zones[SETUP_ZONES.leader] ?? [])[0];
  return leader ? cardColors(ctx, game, state, leader) : [];
}

/**
 * A card's colours, by declared attribute (2-2).
 *
 * Exported so `vm/activate.ts`'s own `payWith` reading can settle a payer's
 * colours the same way this module does everywhere else it names one — the
 * "one energy of its own colours" half of 20-19 (`AS energy`) is this reading
 * and no other.
 */
export function cardColors(ctx: EngineContext, game: GameDefinition, state: VmState, id: string): Color[] {
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
