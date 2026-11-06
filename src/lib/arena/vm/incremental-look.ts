/** R527: an authenticated private ordered prefix, never a filtered candidate list. */
import type { EngineContext, PlayerId, Skill } from '../types';
import type { Script, ScriptFrame, Op } from './script';
import type { VmState } from './state';
import { parseSkills } from '../text/cards';
import { programsOf } from './common';
import { withUsage } from './usage';
import { withValidity } from './validity';
import { recordedSkillIdentity } from './skill-identity';
import { canonicalTaxValue as key } from './tax-receipt';
import { zeroSkillPrice } from './skill-payment';
import { revealAs, validateProgram } from './script-schema';
import type { GameDefinition } from '../rulesets';
import { resolveSelector } from './program';
import { predicateOf } from './filters';
import { attrsOf } from './cards';
import { IllegalAction } from './illegal-action';
import { NotYet } from './errors';
export type LookOp = Extract<Op, {
    op: 'look';
}>;
export interface LookSource {
    version: 1;
    card: string;
    cardId: string;
    master: PlayerId;
    skillIndex: number;
    epoch: number;
    hiddenCount: number;
    flipped: boolean;
    skill: Skill;
    script: Script;
}
interface Occurrence {
    card: string;
    cardId: string;
    epoch: number;
    hiddenCount: number;
    owner: PlayerId;
    flipped: boolean;
    hidden: boolean;
    faceUp: boolean;
}
export interface LookExecution {
    source: LookSource;
    active?: true;
}
export interface IncrementalLook {
    version: 1;
    phase: 'looking' | 'complete';
    choices: Record<string, {
        ids: string[];
        candidates: Occurrence[];
    }>;
    definitions: Record<string, string>;
    mode?: {
        index: number;
        ip: number;
    };
    order?: string[];
    binding: string;
    opIndex: number;
    op: LookOp;
    originalOps: Op[];
    deckOwner: PlayerId;
    maximum: number;
    deck: Occurrence[];
    inspected: Occurrence[];
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
function fail(): never { throw new IllegalAction('rebuild the original private inspection (R527)'); }
export function incrementalLookIntent(v: unknown): boolean { if (!object(v) && !Array.isArray(v))
    return false; if (Array.isArray(v))
    return v.some(incrementalLookIntent); return v.op === 'look' && v.upTo === true || v.op === 'reveal' && v.incremental === true || Object.values(v).some(incrementalLookIntent); }
function requireOp(op: unknown): asserts op is LookOp { if (!object(op) || op.op !== 'look' || op.upTo !== true || typeof op.as !== 'string' || !op.as || !integer(op.n) || op.area !== undefined && op.area !== 'deck' || op.side !== undefined && !['you', 'opponent'].includes(String(op.side)) || op.from !== undefined && !['top', 'bottom'].includes(String(op.from)))
    fail(); }
function requireShape(skill: Skill, script: Script): void {
    if (!object(skill) || !object(script) || skill.kind !== 'auto' || script.kind !== 'auto' || skill.granted || skill.grants || typeof skill.cost !== 'string' || skill.cost.trim() || key(script.price) !== key(zeroSkillPrice()) || !Array.isArray(script.ops) || !script.ops.length || script.unsupported?.length)
        throw new NotYet('inspect incrementally through an unreviewed skill producer', 'R527');
    if (!validateProgram(script.ops))
        fail();
    const op = revealAs(script.ops[0]);
    requireOp(op);
    const choose = script.ops[1], move = script.ops[2], tail = script.ops[3];
    if (choose?.op === 'choose' && choose.sel.filter) {
        const f = choose.sel.filter;
        if (Object.entries(f).some(([k, v]) => !['characters', 'traits'].includes(k) && v !== null && v !== undefined && v !== false && !(Array.isArray(v) && v.length === 0))
            || (f.traits?.length ?? 0) > 1 || ((f.traits?.length ?? 0) > 0 && ((f.characters?.length ?? 0) > 0 || !f.traits[0].trim())))
            throw new NotYet('inspect using an unreviewed historical identity filter', 'R527');
    }
    if (choose?.op === 'choose' && Object.entries(choose.sel).some(([k, v]) => v !== undefined && !['side', 'filter', 'count', 'upTo', 'fromVar'].includes(k)))
        throw new NotYet('resolve an unreviewed private inspection selector', 'R527');
    if (script.ops.length !== 4 || choose?.op !== 'choose' || choose.sel.fromVar !== op.as || choose.sel.count !== 1 || choose.sel.upTo !== true || choose.chooser && choose.chooser !== 'you' || move?.op !== 'moveTo' || key(move.target) !== key({ var: choose.as }) || move.to !== 'hand' || !tail || !['shuffle', 'chooseMode'].includes(tail.op))
        throw new NotYet('resolve an unreviewed private inspection tail', 'R527');
    if (tail.op === 'chooseMode' && (tail.modes.length !== 2 || tail.modes.some(m => m.ops.length !== 1 || !(m.ops[0].op === 'moveTo' || m.ops[0].op === 'arrange') || m.ops[0].op === 'moveTo' && m.ops[0].to !== 'deck' || !['top', 'bottom'].includes(String(m.ops[0].position)) || key(m.ops[0].target) !== key({ var: op.as, minus: choose.as }))))
        throw new NotYet('resolve an unreviewed private inspection mode', 'R527');
    if (script.ops.slice(1).some(o => !object(o) || !['choose', 'moveTo', 'shuffle', 'chooseMode'].includes(o.op)))
        throw new NotYet('resolve an unreviewed private inspection tail', 'R527');
    if (script.ops.slice(1).some(incrementalLookIntent))
        throw new NotYet('resolve multiple private inspections in one skill', 'R527');
}
export function requireLookSource(ctx: EngineContext, state: VmState, s: LookSource | undefined, card: string, master: PlayerId, index: number | undefined): Script {
    if (state.game !== 'dbs' || !s || s.version !== 1 || typeof s.cardId !== 'string' || s.card !== card || s.master !== master || s.skillIndex !== index || !integer(s.skillIndex) || !integer(s.epoch) || !integer(s.hiddenCount) || typeof s.flipped !== 'boolean' || !s.skill || !s.script)
        fail();
    requireShape(s.skill, s.script);
    const def = ctx.defs[s.cardId], inst = state.cards[card];
    const stored = def && programsOf(ctx, def, s.flipped ? 'back' : 'front').bySkill[s.skillIndex];
    const parsed = def && parseSkills((s.flipped ? def.back?.skill : def.skill) ?? null).find(x => x.index === s.skillIndex);
    const actual = parsed && stored ? withValidity(withUsage(recordedSkillIdentity(parsed, stored), stored.usage), stored.validity) : undefined;
    if (!def || !inst || inst.cardId !== s.cardId || !integer(inst.zoneEpoch ?? 0) || (inst.zoneEpoch ?? 0) < s.epoch || key(stored) !== key(s.script) || key(actual) !== key(s.skill))
        fail();
    return s.script;
}
export function captureLookSource(ctx: EngineContext, state: VmState, card: string, master: PlayerId, skill: Skill, script: Script): LookSource {
    requireShape(skill, script);
    const c = state.cards[card];
    if (!c)
        fail();
    const source: LookSource = { version: 1, card, cardId: c.cardId, master, skillIndex: skill.index, epoch: c.zoneEpoch ?? 0, hiddenCount: c.hiddenCount ?? 0, flipped: c.flipped, skill: structuredClone(skill), script: structuredClone(script) };
    requireLookSource(ctx, state, source, card, master, skill.index);
    return source;
}
export function requireLookPending(ctx: EngineContext, state: VmState, source: LookSource | undefined, card: string, master: PlayerId, index: number): void {
    requireLookSource(ctx, state, source, card, master, index);
    const c = state.cards[card];
    if ((c.zoneEpoch ?? 0) !== source!.epoch || (c.hiddenCount ?? 0) !== source!.hiddenCount || c.flipped !== source!.flipped)
        throw new NotYet('declare a private inspection after an unreviewed source transition', 'R527');
}
export function activateLook(frame: ScriptFrame, taxed: boolean): void {
    if (!frame.lookExecution && !incrementalLookIntent(frame.ops))
        return;
    if (!frame.lookExecution || taxed || frame.autoCost || frame.copiedSkillCapture || frame.saveVarsAs)
        throw new NotYet('activate a private inspection through a specialized or taxed producer', 'R527');
    frame.lookExecution.active = true;
}
function occurrence(state: VmState, id: string): Occurrence { const c = state.cards[id]; if (!c || !integer(c.zoneEpoch ?? 0) || !integer(c.hiddenCount ?? 0))
    fail(); return { card: id, cardId: c.cardId, epoch: c.zoneEpoch ?? 0, hiddenCount: c.hiddenCount ?? 0, owner: c.owner, flipped: c.flipped, hidden: !!c.hidden, faceUp: !!c.faceUp }; }
function expectedOptions(look: IncrementalLook): string[] { return look.inspected.length >= look.maximum ? ['Continue'] : ['Look at next card', 'Stop looking']; }
function binding(frame: ScriptFrame, opIndex = frame.ip): string { const s = frame.lookExecution!.source; return key([s.card, s.master, s.skillIndex, s.epoch, s.hiddenCount, s.flipped, opIndex]); }
function expectedBody(ops: Op[], look: IncrementalLook | undefined): Op[] {
    if (look?.mode === undefined)
        return ops;
    const tail = ops.at(-1), mode = look.mode;
    if (!object(mode) || !integer(mode.index) || mode.ip !== ops.length - 1 || tail?.op !== 'chooseMode' || !tail.modes[mode.index])
        fail();
    return [...ops.slice(0, -1), ...tail.modes[mode.index].ops];
}
type InspectionChoose = Extract<Op, { op: 'choose' }>;
/** Caller authenticates original definitions/prefix; never reconstruct effective history. */
function frozenEligible(ctx: EngineContext, game: GameDefinition, look: IncrementalLook, op: InspectionChoose): Occurrence[] {
    return look.inspected.filter(c => {
        const def = ctx.defs[c.cardId];
        if (!def) fail();
        return !op.sel.filter || predicateOf(op.sel.filter, game)(attrsOf(def, game).attrs);
    });
}
function equivalentCandidates(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame, op: InspectionChoose): Occurrence[] {
    const eligible = frozenEligible(ctx, game, frame.incrementalLook!, op);
    if (key(resolveSelector(ctx, game, state, frame, op.sel)) !== key(eligible.map(c => c.card)))
        throw new NotYet('inspect through changed private-card characteristics', 'R527');
    return eligible;
}
export function requireIncrementalLook(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame): void {
    if (game.id !== state.game)
        fail();
    const ex = frame.lookExecution;
    if (!object(ex) || ex.active !== true || !Array.isArray(frame.ops) || !object(frame.vars) || !integer(frame.ip))
        fail();
    requireLookSource(ctx, state, ex.source, frame.card, frame.master, frame.skillIndex);
    if (frame.saveVarsAs || frame.autoCost || frame.taxGate || frame.copiedSkillCapture || frame.arrivalResume || frame.arrivalBatchResume || frame.retainedResume)
        fail();
    const sourceOps = ex.source.script.ops, first = revealAs(sourceOps[0]);
    requireOp(first);
    if (key(expectedBody(sourceOps, frame.incrementalLook)) !== key(frame.ops) || frame.ip > frame.ops.length)
        fail();
    const look = frame.incrementalLook;
    if (look === undefined) {
        if (frame.ip !== 0 || frame.awaiting || frame.vars[first.as] !== undefined)
            fail();
        return;
    }
    if (!object(look) || look.version !== 1 || !['looking', 'complete'].includes(look.phase) || !object(look.choices) || !object(look.definitions) || look.binding !== binding(frame, 0) || look.opIndex !== 0 || !integer(look.maximum) || !Array.isArray(look.deck) || !Array.isArray(look.inspected) || !Array.isArray(look.originalOps) || !['p1', 'p2'].includes(look.deckOwner))
        fail();
    requireOp(look.op);
    if (key(look.originalOps) !== key(sourceOps) || key(first) !== key(look.op) || look.maximum !== Math.min(Number(look.op.n), look.deck.length) || look.deckOwner !== (look.op.side === 'opponent' ? (frame.master === 'p1' ? 'p2' : 'p1') : frame.master))
        fail();
    for (const c of look.deck)
        if (!object(c) || typeof c.card !== 'string' || typeof c.cardId !== 'string' || !integer(c.epoch) || !integer(c.hiddenCount) || !['p1', 'p2'].includes(c.owner) || typeof c.flipped !== 'boolean' || typeof c.hidden !== 'boolean' || typeof c.faceUp !== 'boolean')
            fail();
    if (key(look.definitions) !== key(Object.fromEntries([...new Set(look.deck.map(c => c.cardId))].map(id => [id, key(ctx.defs[id])]))))
        fail();
    const ordered = look.op.from === 'bottom' ? [...look.deck].reverse() : look.deck;
    if (look.inspected.length > look.maximum || key(look.inspected) !== key(ordered.slice(0, look.inspected.length)) || new Set(look.deck.map(x => x.card)).size !== look.deck.length)
        fail();
    if (look.phase === 'looking') {
        if (look.mode !== undefined || look.order !== undefined || frame.ip !== 0 || Object.keys(look.choices).length || frame.vars[look.op.as] !== undefined || frame.awaiting !== `inspect:${look.op.as}`)
            fail();
        if (key(state.sides[look.deckOwner].zones.deck.map(id => occurrence(state, id))) !== key(look.deck))
            fail();
    }
    else {
        if (frame.ip === 0 || frame.awaiting === `inspect:${look.op.as}`)
            fail();
        const chosen: string[] = [];
        for (const [as, decision] of Object.entries(look.choices)) {
            if (!object(decision) || !Array.isArray(decision.ids) || !Array.isArray(decision.candidates))
                fail();
            const ids = decision.ids;
            const op = sourceOps.find(o => o.op === 'choose' && o.as === as && o.sel.fromVar === look.op.as);
            if (!op || ids.length > 1 || decision.candidates.some(c => !look.inspected.some(p => key(p) === key(c))) || new Set(decision.candidates.map(c => c.card)).size !== decision.candidates.length || ids.some(id => !decision.candidates.some(c => c.card === id)) || new Set(ids).size !== ids.length || ids.some(id => !look.inspected.some(p => p.card === id) || chosen.includes(id)) || key(frame.vars[as]) !== key(ids))
                fail();
            if (op.op !== 'choose')
                fail();
            const eligible = frozenEligible(ctx, game, look, op);
            if (key(decision.candidates) !== key(eligible))
                fail();
            chosen.push(...ids);
        }
        if (key(frame.vars[look.op.as]) !== key(look.inspected.map(x => x.card).filter(id => !chosen.includes(id))))
            fail();
        const originalChoose = sourceOps[1] as InspectionChoose;
        if (frame.ip === 1 && look.choices[originalChoose.as] === undefined)
            equivalentCandidates(ctx, game, state, frame, originalChoose);
        // Before the final placement, inspected cards still in the pool must be the
        // original deck occurrences, not cards returned to the deck after departure.
        if (frame.ip <= 3 && !frame.moveLoop)
            for (const c of look.inspected.filter(c => !chosen.includes(c.card))) {
                if (!state.sides[look.deckOwner].zones.deck.includes(c.card) || key(occurrence(state, c.card)) !== key(c))
                    fail();
            }
        if (frame.moveLoop) {
            const loop = frame.moveLoop, op = frame.ops[frame.ip];
            if (!object(loop) || op?.op !== 'moveTo' || frame.ip !== 2 || loop.kind !== 'moveTo' || !Array.isArray(loop.ids) || key(loop.ids) !== key(chosen) || !integer(loop.index) || loop.index > loop.ids.length || loop.to !== 'hand' || loop.position !== undefined || loop.reason !== 'effect' || loop.mode !== undefined || loop.faceUp !== undefined)
                fail();
            for (const id of loop.ids.slice(loop.index)) {
                const original = look.inspected.find(c => c.card === id);
                if (!original || key(occurrence(state, id)) !== key(original) || !state.sides[look.deckOwner].zones.deck.includes(id))
                    fail();
            }
        }
        if (look.order !== undefined) {
            if (!Array.isArray(look.order) || frame.ip !== 3 || frame.ops[3]?.op !== 'arrange' || look.mode === undefined || new Set(look.order).size !== look.order.length || look.order.some(id => !frame.vars[look.op.as].includes(id)) || key(frame.vars['arrange@3'] ?? []) !== key(look.order))
                fail();
        }
        else if (frame.vars['arrange@3'] !== undefined && key(frame.vars['arrange@3']) !== '[]')
            fail();
        if (frame.ip > 1 && look.choices[(sourceOps[1] as Extract<Op, {
            op: 'choose';
        }>).as] === undefined)
            fail();
        if (frame.ip <= 1 && look.mode !== undefined)
            fail();
    }
}
export function recordInspectionChoice(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame, op: Extract<Op, {
    op: 'choose';
}>, picked: string[]): void {
    const look = frame.incrementalLook;
    if (!look)
        return;
    if (look.phase !== 'complete' || op.sel.fromVar !== look.op.as || key(frame.ops[frame.ip]) !== key(op) || look.choices[op.as] !== undefined || picked.some(id => !look.inspected.some(p => p.card === id)))
        fail();
    // Called by the native chooser, before its variable/pool writes.
    requireIncrementalLook(ctx, game, state, frame);
    const eligible = equivalentCandidates(ctx, game, state, frame, op);
    if (picked.length > 1 || new Set(picked).size !== picked.length || picked.some(id => !eligible.some(c => c.card === id)))
        fail();
    look.choices[op.as] = { ids: [...picked], candidates: structuredClone(eligible) };
}
export function recordInspectionMode(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame, op: Extract<Op, {
    op: 'chooseMode';
}>, index: number): void {
    if (!frame.incrementalLook)
        return;
    requireIncrementalLook(ctx, game, state, frame);
    if (frame.incrementalLook.phase !== 'complete' || frame.incrementalLook.mode !== undefined || frame.ip !== 3 || !integer(index) || !op.modes[index] || key(frame.ops[frame.ip]) !== key(op))
        fail();
    frame.incrementalLook.mode = { ip: frame.ip, index };
}
export function recordInspectionOrder(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame, picked: string): void {
    if (!frame.incrementalLook)
        return;
    requireIncrementalLook(ctx, game, state, frame);
    const look = frame.incrementalLook;
    if (look.phase !== 'complete' || frame.ip !== 3 || frame.ops[3]?.op !== 'arrange' || look.mode === undefined || !frame.vars[look.op.as].includes(picked) || (look.order ?? []).includes(picked))
        fail();
    look.order = [...(look.order ?? []), picked];
}
export function requireInspectionPrompt(ctx: EngineContext, game: GameDefinition, state: VmState): ScriptFrame | undefined {
    for (const f of state.programs)
        if (f.lookExecution || f.incrementalLook !== undefined || incrementalLookIntent(f.ops))
            requireIncrementalLook(ctx, game, state, f);
    const pr = state.prompt;
    for (const frame of state.programs.filter(f => f.incrementalLook?.phase === 'complete')) {
        const op = frame.ops[frame.ip];
        if (op?.op === 'choose' && frame.awaiting === op.as) {
            const candidates = equivalentCandidates(ctx, game, state, frame, op).map(c => c.card);
            if (pr.kind !== 'chooseCards' || pr.player !== frame.master || pr.choice.continuation !== op.as || pr.choice.min !== 0 || pr.choice.max !== 1 || key(pr.choice.candidates) !== key(candidates) || pr.choice.blind || pr.choice.reason !== (op.reason ?? `${ctx.defs[frame.lookExecution!.source.cardId].name}: choose up to 1`))
                fail();
        }
        else if (op?.op === 'arrange' && frame.awaiting === 'arrange@3') {
            const pool = frame.vars[frame.incrementalLook!.op.as], order = frame.incrementalLook!.order ?? [], open = pool.filter(id => !order.includes(id));
            if (pr.kind !== 'chooseCards' || pr.player !== frame.master || pr.choice.continuation !== 'arrange@3' || pr.choice.min !== 1 || pr.choice.max !== 1 || key(pr.choice.candidates) !== key(open) || pr.choice.blind)
                fail();
        }
        else if (op?.op === 'chooseMode' && frame.awaiting === 'mode') {
            if (pr.kind !== 'chooseMode' || pr.player !== frame.master || pr.reason !== op.reason || key(pr.options) !== key(op.modes.map(m => m.label)) || key(frame.offeredModes) !== key(op.modes.map((_, i) => i)))
                fail();
        }
    }
    const frames = state.programs.filter(f => f.incrementalLook?.phase === 'looking');
    if (pr.kind !== 'chooseMode' || pr.inspection === undefined) {
        if (frames.length)
            fail();
        return;
    }
    if (typeof pr.inspection !== 'string' || frames.length !== 1)
        fail();
    const frame = frames[0];
    requireIncrementalLook(ctx, game, state, frame);
    const look = frame.incrementalLook!;
    if (pr.inspection !== look.binding || pr.player !== frame.master || key(pr.options) !== key(expectedOptions(look)) || pr.reason !== 'Look at cards from the deck')
        fail();
    return frame;
}
export function stepIncrementalLook(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame, op: LookOp): 'wait' | 'done' {
    requireOp(op);
    requireIncrementalLook(ctx, game, state, frame);
    if (frame.incrementalLook?.phase === 'complete')
        fail();
    let look = frame.incrementalLook;
    if (!look) {
        if (frame.ip !== 0 || key(frame.ops) !== key(frame.lookExecution!.source.script.ops))
            fail();
        const deckOwner = op.side === 'opponent' ? (frame.master === 'p1' ? 'p2' : 'p1') : frame.master;
        const deck = state.sides[deckOwner].zones.deck.map(id => occurrence(state, id));
        look = { version: 1, phase: 'looking', choices: {}, definitions: Object.fromEntries([...new Set(deck.map(c => c.cardId))].map(id => [id, key(ctx.defs[id])])), binding: binding(frame), opIndex: frame.ip, op: structuredClone(op), originalOps: structuredClone(frame.ops), deckOwner, maximum: Math.min(Number(op.n), deck.length), deck, inspected: [] };
        frame.incrementalLook = look;
        frame.awaiting = `inspect:${op.as}`;
    }
    else {
        const answer = state.lastMode;
        if (!integer(answer) || answer >= expectedOptions(look).length)
            fail();
        state.lastMode = null;
        if (look.inspected.length >= look.maximum || answer === 1) {
            frame.vars[op.as] = look.inspected.map(x => x.card);
            // Validate before the next chooser or its empty-candidate fast path.
            // Entry authenticated this looking frame; no fake decision is stored.
            equivalentCandidates(ctx, game, state, frame, look.originalOps[1] as InspectionChoose);
            look.phase = 'complete';
            delete frame.awaiting;
            return 'done';
        }
        const ordered = op.from === 'bottom' ? [...look.deck].reverse() : look.deck;
        look.inspected.push(structuredClone(ordered[look.inspected.length]));
    }
    state.programs.unshift(frame);
    state.prompt = { kind: 'chooseMode', player: frame.master, reason: 'Look at cards from the deck', options: expectedOptions(look), inspection: look.binding };
    return 'wait';
}
