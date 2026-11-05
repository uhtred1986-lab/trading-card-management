/** R-443 / 22-46-3-1: the payer chooses the order of Z-Energy and skill cost. */
import type { Action, Area, CardOccurrence, PoolPaymentSelection, EngineContext, GameEvent, PlayerId, Requirement } from "../types";
import type { GameDefinition } from "../rulesets";
import { boundFor, scopedPayersSpent, zAwakenBindings, type ActivationLine } from "./activate";
import { isCompetingZAwakenPrice } from "./activation-price-support";
import { automaticPriceHost, AutoPaymentFailed, canFinishAutomaticPrice } from "./auto-costs";
import { IllegalAction } from "./common";
import { chargeCost, chargesOf, freePrice, planCost, priceFor, type Price, type VmPayment } from "./costs";
import { NotYet } from "./errors";
import { chooseFramePools, pooledPaymentVariants, primeFramePools, requirePoolOccurrence } from "./pooled-costs";
import { stepScript, type Op, type ScriptFrame } from "./script";
import type { VmState } from "./state";
type Group = "zEnergy" | "skill";
type Choice = {
    price: Price;
    payment: VmPayment;
    label: string;
};
export interface ZAwakenCost {
    price: Price;
    stage: "order" | "resources" | "steps" | "done";
    order?: Group[];
    offeredOrders?: Group[][];
    next: number;
    choices?: Choice[];
    selected?: number;
    payment?: VmPayment;
    requestedEnergy?: CardOccurrence[];
    requestedPools?: PoolPaymentSelection;
}
export const isOrderedZAwaken = (line: Pick<ActivationLine, "keyword" | "script">): boolean => line.keyword?.name === "Z-Awaken" && isCompetingZAwakenPrice(line.script?.price?.ops ?? []);
export function zAwakenCost(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, line: ActivationLine): ZAwakenCost {
    return { price: priceFor(ctx, game, state, game.actions.activate, line.card, boundFor(ctx, game, state, player, line)), stage: "order", next: 0 };
}
export function retainZAwakenSelection(state: VmState, cost: ZAwakenCost, action: Action): void {
    if ("pay" in action && action.pay !== undefined) {
        if (!Array.isArray(action.pay)) throw new IllegalAction("invalid explicit Z-Awaken energy payment");
        cost.requestedEnergy = action.pay.map(card => ({ card, epoch: state.cards[card]?.zoneEpoch ?? 0 }));
    }
    if ("payPools" in action && action.payPools !== undefined)
        cost.requestedPools = structuredClone(action.payPools);
}
function groupPrice(full: Price, group: Group): Price {
    const ze = full.pooled.filter(p => p.side === "you" && p.area === "zEnergy");
    return group === "zEnergy" ? { ...freePrice(), pooled: ze } : { ...full, pooled: full.pooled.filter(p => !ze.includes(p)) };
}
function names(game: GameDefinition, group: Group): string[] {
    const charges = chargesOf(game);
    return (game.actions.activate.cost ?? []).filter(name => {
        const charge = charges[name];
        const ze = charge?.consumes === "cards" && charge.from?.side === "you" && charge.from.area === "zEnergy";
        return group === "zEnergy" ? ze : !ze;
    });
}
function plans(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame, full: Price, group: Group): Choice[] {
    const price = groupPrice(full, group), requested = frame.keywordCost?.zAwaken;
    if (group === "skill" && requested?.requestedEnergy?.some(p => !state.cards[p.card] || (state.cards[p.card].zoneEpoch ?? 0) !== p.epoch))
        return [];
    const explicit = group === "skill" ? requested?.requestedEnergy?.map(p => p.card) : undefined;
    const pools = group === "zEnergy" ? requested?.requestedPools : undefined;
    const plan = planCost(ctx, game, state, frame.master, price, frame.card, explicit, pools);
    if (!plan.ok)
        return [];
    const candidates = explicit === undefined && plan.asks && plan.options.length > 1 ? plan.options.map(option => planCost(ctx, game, state, frame.master, price, frame.card, option.rest, pools)) : [plan];
    return candidates.flatMap(p => p.ok ? [{ price, payment: p.payment, label: p.describe }] : []);
}
/** Physical pool departures use the strict interpreter in both proof and play. */
function nativeSteps(game: GameDefinition, state: VmState, frame: ScriptFrame, payment: VmPayment, group: Group): Op[] {
    const charges = chargesOf(game), ops: Op[] = [];
    for (const name of names(game, group)) {
        const charge = charges[name], pool = payment.pooled.find(p => p.cost === name);
        if (!pool?.cards.length)
            continue;
        const to = (charge.does as {
            to?: string;
        } | null)?.to;
        if (!charge.from || !to)
            throw new IllegalAction("this Z-Awaken pool has no declared departure");
        for (const [i, id] of pool.cards.entries()) {
            const alias = `§zAwaken:${name}:${i}`;
            frame.vars[alias] = [id];
            frame.vars[`${alias}@epoch`] = [`${id}@${state.cards[id]?.zoneEpoch ?? 0}`];
            ops.push({ op: "moveTo", target: { sel: { fromVar: alias, side: "you", area: charge.from.area as Area } }, to: to as Area, cause: "cost" });
        }
    }
    return ops;
}
function chargeNonPools(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], frame: ScriptFrame, payment: VmPayment, group: Group): void {
    const charges = chargesOf(game), costs = names(game, group).filter(name => charges[name]?.consumes !== "cards");
    const spent = scopedPayersSpent(ctx, game, state, frame.master, frame.keywordCost!.line);
    chargeCost(ctx, game, state, ev, frame.master, payment, frame.card, costs);
    spent(payment.rest);
}
function paymentVariants(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame, choice: Choice, group: Group): Iterable<VmPayment> {
    const prefix = group === "zEnergy" ? frame.keywordCost?.zAwaken?.requestedPools : undefined;
    return pooledPaymentVariants(ctx, game, state, frame, choice.price, choice.payment, prefix, { symmetry: false });
}
function remaining(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame, full: Price, order: Group[], at: number): boolean {
    if (at >= order.length)
        return true;
    for (const choice of plans(ctx, game, state, frame, full, order[at])) {
        for (const payment of paymentVariants(ctx, game, state, frame, choice, order[at]))
            if (paymentFinishes(ctx, game, state, frame, full, order, at, payment))
                return true;
    }
    return false;
}
function paymentFinishes(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame, full: Price, order: Group[], at: number, payment: VmPayment): boolean {
    const board = structuredClone(state), paying = structuredClone(frame), group = order[at];
    try {
        chargeNonPools(ctx, game, board, [], paying, payment, group);
        paying.ops = [...nativeSteps(game, board, paying, payment, group), ...(group === "skill" ? paying.keywordCost!.line.script?.price?.ops ?? [] : [])];
        paying.ip = 0;
        delete paying.awaiting;
        delete paying.moveLoop;
        return canFinishAutomaticPrice(ctx, game, board, paying, { complete: (s, f) => remaining(ctx, game, s, f, full, order, at + 1) });
    }
    catch (err) {
        if (err instanceof NotYet)
            throw err;
        if (err instanceof IllegalAction || err instanceof AutoPaymentFailed)
            return false;
        throw err;
    }
}
function initialFrame(state: VmState, player: PlayerId, line: ActivationLine): ScriptFrame {
    return { card: line.card, master: player, skillIndex: line.skillIndex, viaKeyword: "Z-Awaken", ops: line.script?.price?.ops ?? [], ip: 0, vars: zAwakenBindings(state, player, line.card), keywordCost: { key: `${line.card}:${line.skillIndex}`, line, moments: [] } };
}
export function orderedZAwakenRefusals(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, line: ActivationLine, action?: Action): Requirement[] {
    const frame = initialFrame(state, player, line), saved = zAwakenCost(ctx, game, state, player, line), full = saved.price;
    if (action)
        retainZAwakenSelection(state, saved, action);
    frame.keywordCost!.zAwaken = saved;
    return remaining(ctx, game, state, frame, full, ["zEnergy", "skill"], 0) || remaining(ctx, game, state, frame, full, ["skill", "zEnergy"], 0) ? [] : [{ kind: "other", detail: "its complete Z-Energy and skill cost cannot be paid" }];
}
export function stepZAwakenCost(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], frame: ScriptFrame): "paid" | "wait" {
    const cost = frame.keywordCost!, saved = cost.zAwaken!;
    if (saved.stage === "order") {
        const orders: Group[][] = [["zEnergy", "skill"], ["skill", "zEnergy"]];
        const allowed = orders.filter(order => remaining(ctx, game, state, frame, saved.price, order, 0));
        if (!allowed.length)
            throw new AutoPaymentFailed("Z-Awaken costs cannot be completed");
        if (frame.awaiting !== "zAwakenOrder") {
            frame.awaiting = "zAwakenOrder";
            state.programs.unshift(frame);
            state.prompt = { kind: "chooseMode", player: frame.master, reason: "Choose the Z-Awaken cost order", options: allowed.map(order => order[0] === "zEnergy" ? "Pay Z-Energy first" : "Pay the skill cost first") };
            // Persist the offered order mapping; a changed board cannot repurpose an answer.
            saved.offeredOrders = allowed;
            return "wait";
        }
        const at = state.lastMode;
        if (at === null || at < 0 || !Number.isInteger(at))
            throw new IllegalAction("no such Z-Awaken cost order");
        const order = saved.offeredOrders?.[at] ?? [];
        if (order.length !== 2 || !remaining(ctx, game, state, frame, saved.price, order, 0))
            throw new IllegalAction("that Z-Awaken cost order is no longer payable");
        saved.order = order;
        delete saved.offeredOrders;
        state.lastMode = null;
        delete frame.awaiting;
        saved.stage = "resources";
    }
    while (saved.next < 2) {
        const group = saved.order![saved.next];
        if (saved.stage === "resources") {
            saved.choices ??= plans(ctx, game, state, frame, saved.price, group).filter(choice => {
                for (const payment of paymentVariants(ctx, game, state, frame, choice, group))
                    if (paymentFinishes(ctx, game, state, frame, saved.price, saved.order!, saved.next, payment))
                        return true;
                return false;
            });
            if (!saved.choices.length)
                throw new AutoPaymentFailed("Z-Awaken resources cannot be paid");
            if (group === "zEnergy" && saved.requestedPools && !frame.poolPayment)
                frame.poolPayment = { selection: structuredClone(saved.requestedPools) };
            primeFramePools(game, state, frame, saved.choices[0].price);
            if (saved.selected === undefined) {
                if (saved.choices.length > 1 && frame.awaiting !== "zAwakenResources") {
                    frame.awaiting = "zAwakenResources";
                    state.programs.unshift(frame);
                    state.prompt = { kind: "chooseMode", player: frame.master, reason: "Pay the Z-Awaken skill cost", options: saved.choices.map(p => p.label) };
                    return "wait";
                }
                saved.selected = saved.choices.length > 1 ? state.lastMode ?? -1 : 0;
                state.lastMode = null;
                delete frame.awaiting;
            }
            const choice = saved.choices[saved.selected];
            if (!choice)
                throw new IllegalAction("no such Z-Awaken resource payment");
            if (chooseFramePools(ctx, game, state, frame, choice.price, choice.payment, payment => paymentFinishes(ctx, game, state, frame, saved.price, saved.order!, saved.next, payment), { symmetry: false }) === "wait")
                return "wait";
            const current = planCost(ctx, game, state, frame.master, choice.price, frame.card, choice.payment.rest, frame.poolPayment?.selection);
            if (!current.ok || JSON.stringify(current.payment) !== JSON.stringify(choice.payment) || !paymentFinishes(ctx, game, state, frame, saved.price, saved.order!, saved.next, choice.payment))
                throw new IllegalAction("that Z-Awaken payment cannot complete");
            chargeNonPools(ctx, game, state, ev, frame, choice.payment, group);
            saved.payment = choice.payment;
            frame.ops = [...nativeSteps(game, state, frame, choice.payment, group), ...(group === "skill" ? cost.line.script?.price?.ops ?? [] : [])];
            frame.ip = 0;
            saved.stage = "steps";
        }
        requirePoolOccurrence(state, frame);
        // A selector that lost its stamped payer must not become an empty move.
        // Completed earlier departures are intentionally outside this suffix.
        for (const op of frame.ops.slice(frame.ip))
            if (op.op === "moveTo" && "sel" in op.target && op.target.sel.fromVar?.startsWith("§zAwaken:")) {
                const key = op.target.sel.fromVar, id = frame.vars[key]?.[0];
                if (!id || !state.cards[id] || frame.vars[`${key}@epoch`]?.[0] !== `${id}@${state.cards[id].zoneEpoch ?? 0}` || !state.sides[frame.master].zones.zEnergy.includes(id))
                    throw new IllegalAction("that unpaid Z-Energy occurrence is no longer available");
            }
        const complete = (s: VmState, f: ScriptFrame) => remaining(ctx, game, s, f, saved.price, saved.order!, saved.next + 1);
        if (!(frame.awaiting === "replaceMove" && state.lastMode !== null) && !canFinishAutomaticPrice(ctx, game, state, frame, { complete }))
            throw new IllegalAction("that Z-Awaken choice cannot complete all costs");
        const result = stepScript(automaticPriceHost(ctx, game, state, ev), frame);
        if (result === "wait") {
            if (state.prompt.kind === "chooseCards")
                state.prompt.choice.candidates = state.prompt.choice.candidates.filter(id => { const clone = structuredClone(state); clone.lastChoice = [id]; return canFinishAutomaticPrice(ctx, game, clone, frame, { complete }); });
            return "wait";
        }
        saved.next++;
        saved.stage = "resources";
        delete saved.choices;
        delete saved.selected;
        delete saved.payment;
        delete frame.poolPayment;
        frame.ops = [];
        frame.ip = 0;
    }
    saved.stage = "done";
    return "paid";
}
