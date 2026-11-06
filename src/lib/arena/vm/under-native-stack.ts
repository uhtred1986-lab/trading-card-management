import { standingWholeIntent } from "./standing-negation-bounds";
import type { EngineContext } from "../types";
import { hasMixedStandingPolicy } from "./standing-negation-mixed-observation";
import { nativeUnderDefinitions } from "./under-native-policy";
/** R528 replay of the existing stack-play material writer, distinct from placeUnder cleanup. */
import type { GameDefinition } from "../rulesets";
import type { VmState } from "./state";
import { findCard, moveCard, type MoveRecord } from "./zones";
import { retireAppliedEffectRetarget } from "./applied-effect-receipt";
import { preflightPlacedUnder } from "./placed-under-master";
import { refuseNativeUnder as fail } from "./under-native-observation";
export type NativeStackWrite = { route: "play"; card: string; host: string; extra: string[] } | { route: "top"; card: string; host: string };
export function requireDormantNativeStack(state: VmState): void {
    const history = state.underStandingNegationHistory;
    if (!history || history.active.length || history.observation.under.length
        || history.observation.area.candidates.some(candidate => candidate.source.policy === "otherBattleWholeV1"))
        return fail("review active standing source promotion before stack placement");
}
export function projectNativeStack(ctx: EngineContext, state: VmState, game: GameDefinition, write: NativeStackWrite): MoveRecord[] {
    requireDormantNativeStack(state);
    if (!write || (write.route === "play" ? Object.keys(write).sort().join() !== "card,extra,host,route"
        || !Array.isArray(write.extra) || new Set([write.card, write.host, ...write.extra]).size !== write.extra.length + 2
        : write.route !== "top" || Object.keys(write).sort().join() !== "card,host,route" || write.card === write.host))
        return fail("bind the exact original stack-play material list");
    const def = ctx.defs[state.cards[write.card]?.cardId];
    if (!def || standingWholeIntent(ctx, state, write.card) || state.battle && hasMixedStandingPolicy({ ...ctx, defs: { [def.id]: def } })
        || nativeUnderDefinitions(ctx, def.id, "front").length || def.back && nativeUnderDefinitions(ctx, def.id, "back").length)
        return fail("review standing source promotion before its incoming stack arrival");
    if (write.route === "top") return projectTop(state, game, write);
    const arrived = findCard(state, write.card), top = findCard(state, write.host);
    if (!arrived || !top || arrived.zone !== top.zone || arrived.owner !== top.owner)
        return fail("stack only after the incoming card's actual arrival");
    const to = top.zone, player = top.owner, slot = top.index, mode = state.cards[write.host].mode;
    const materials = [write.host, ...write.extra];
    for (const id of materials) {
        const at = findCard(state, id);
        if (!at || at.zone !== to || at.owner !== player) return fail("bind each original stack material area");
        preflightPlacedUnder(state, id, write.card);
    }
    const groups = materials.map(id => [id, ...state.cards[id].under]);
    const results: MoveRecord[] = [];
    const under = moveCard(state, game, write.host, to, { under: write.card });
    if (!under.ok) return fail("preflight the original stack base placement");
    results.push(under.move);
    const list = state.sides[player].zones[to];
    list.splice(list.indexOf(write.card), 1);
    list.splice(Math.min(Math.max(slot, 0), list.length), 0, write.card);
    if (mode !== undefined) state.cards[write.card].mode = mode;
    const placed = [write.host];
    for (const id of write.extra) {
        const result = moveCard(state, game, id, to, { under: write.card });
        if (result.ok) { placed.push(id); results.push(result.move); }
    }
    if (write.extra.length) {
        const order = groups.flat().filter(id => state.cards[write.card].under.includes(id));
        state.cards[write.card].under = [...order, ...state.cards[write.card].under.filter(id => !order.includes(id))];
    }
    const carried = new Set(groups.filter(group => placed.includes(group[0])).flat());
    for (const effect of state.effects) if (carried.has(effect.target) && effect.kind === "power") {
        retireAppliedEffectRetarget(state, effect); effect.target = write.card;
    }
    state.effects = state.effects.filter(effect => !carried.has(effect.target));
    if (state.battle && (state.battle.attacker === write.host || state.battle.guard === write.host)) {
        state.cards[write.card].battledThisTurn = true;
        if (state.battle.attacker === write.host) state.battle.attacker = write.card;
        if (state.battle.guard === write.host) state.battle.guard = write.card;
    }
    return results;
}

function projectTop(state: VmState, game: GameDefinition, write: Extract<NativeStackWrite, { route: "top" }>): MoveRecord[] {
    const incoming = state.cards[write.card], top = state.cards[write.host], at = findCard(state, write.host), seat = findCard(state, write.card);
    if (!incoming || !top || !at || incoming.hidden || top.hidden) return fail("bind the original visible top placement");
    const leader = at.zone === "leader", fromPile = top.under.includes(write.card);
    if (!fromPile && !(leader && seat?.zone === "zDeck" && seat.owner === at.owner)) return fail("bind the original top-placement origin");
    preflightPlacedUnder(state, write.host, write.card);
    const mode = top.mode, incomingPile = incoming.under.slice(), incomingBase = incoming.leaderBase;
    const up = moveCard(state, game, write.card, at.zone, { owner: at.owner, carry: fromPile, ...(leader ? { onto: write.host } : {}) });
    if (!up.ok) return fail("preflight the original incoming top movement");
    const down = moveCard(state, game, write.host, at.zone, { under: write.card });
    if (!down.ok) return fail("preflight the original covered top movement");
    if (leader && incoming.zCard) {
        incoming.under = [...incomingPile, ...incoming.under.filter(id => !incomingPile.includes(id))];
        if (top.leaderBase?.card === write.card) {
            if (incomingBase && incomingBase.card !== write.host) top.leaderBase = incomingBase;
            else { delete top.leaderBase; delete top.leaderStackVersion; }
        }
        incoming.leaderBase = { card: write.host, epoch: top.zoneEpoch ?? 0 };
        incoming.leaderStackVersion = 1;
    }
    const list = state.sides[at.owner].zones[at.zone];
    list.splice(list.indexOf(write.card), 1); list.splice(Math.min(at.index, list.length), 0, write.card);
    if (mode !== undefined && mode !== null) incoming.mode = mode;
    for (const effect of state.effects) if (effect.target === write.host && effect.kind === "power") {
        retireAppliedEffectRetarget(state, effect); effect.target = write.card;
    }
    state.effects = state.effects.filter(effect => effect.target !== write.host);
    if (state.battle && (state.battle.attacker === write.host || state.battle.guard === write.host)) {
        incoming.battledThisTurn = true;
        if (state.battle.attacker === write.host) state.battle.attacker = write.card;
        if (state.battle.guard === write.host) state.battle.guard = write.card;
    }
    return [up.move, down.move];
}
