import { priceFromCostRecord } from "../../src/lib/arena/vm/skill-payment";
import type { CostRecord } from "../../src/lib/arena/vm/script";
/** R505 actual flow cleanup, same-execution effects and retained grant history. */
import assert from 'node:assert/strict';
import fixtures from './fixtures/movement-auto-history-5.json';
import standingFixture from './fixtures/standing-negation-observation-5.json';
import type { Script, ScriptFrame } from '../../src/lib/arena/vm/script';
import { assertStandingNegationSettled } from '../../src/lib/arena/vm/standing-negation-transaction';
import { card, fifty } from './harness';
import { RULES } from '../../src/lib/arena/vm';
import { rulesetFor } from '../../src/lib/arena/rulesets';
import { skillRecords } from '../../src/lib/arena/draft';
import { rulesFromRows, type RuleRow } from '../../src/lib/arena/rules-store';
import { moveCard } from '../../src/lib/arena/vm/zones';
import { moved, run } from '../../src/lib/arena/vm/flow';
import { addEffect, endEffects, skillsNegated } from '../../src/lib/arena/vm/effects';
import { vmHost, returnLoans } from '../../src/lib/arena/vm/host';
import { captureCopiedSkill, capturedSkillShowing, skillsShowing } from '../../src/lib/arena/vm/triggers';
import { copiedSkillIndex } from '../../src/lib/arena/vm/common';
import type { Action, EngineContext, PlayerId, GameEvent } from '../../src/lib/arena/types';
import type { VmState } from '../../src/lib/arena/vm/state';
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v)), other = (p: PlayerId): PlayerId => p === 'p1' ? 'p2' : 'p1';
const loaded = rulesetFor('dbs');
assert.ok(loaded.ok);
const game = loaded.definition;
const defs: EngineContext['defs'] = { L: card('L', { type: 'LEADER' }), F: card('F', {}), W: card('W', { skill: '[Auto] When you play a Battle Card, draw 1 card.' }) };
defs.DEPART = card('DEPART', { skill: "[Auto] When this card is removed from your Battle Area by an opponent's skill, draw 1 card." });
defs.KO = card('KO', { skill: "[Auto] When this card is KO'd, draw 1 card." });
for (const [id, v] of Object.entries(fixtures)) {
    defs[id] = v.def as EngineContext['defs'][string];
    assert.deepEqual(copy(skillRecords(defs[id])), v.records);
}
const ctx: EngineContext = { defs, scripts: rulesFromRows(Object.values(defs).flatMap(skillRecords).map((r, id) => ({ ...r, id, status: 'draft', source: 'compiler' }) as unknown as RuleRow), defs) };
function fresh(p: PlayerId) {
    let s = RULES.createGame(ctx, { seed: 499, p1: { name: 'One', leader: 'L', main: fifty('F') }, p2: { name: 'Two', leader: 'L', main: fifty('F') } }).state as VmState;
    for (const a of [{ type: 'chooseFirst', player: s.chooser, first: p }, { type: 'mulligan', player: p, redraw: false }, { type: 'mulligan', player: other(p), redraw: false }, { type: 'charge', player: p, card: null }] as Action[])
        s = RULES.apply(ctx, copy(s), a).state as VmState;
    return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: string) { const id = s.sides[p].zones.deck.findLast(id => s.cards[id].cardId === 'F')!; s.cards[id].cardId = def; assert.ok(moveCard(s, game, id, area, { owner: p }).ok); return id; }
// Official Bardock FAQ through native saved play; independent synthetic free-play mover.
let cases = 0;
for (const p of ['p1', 'p2'] as const) {
    const c = copy(ctx);
    c.defs.L.skill = '[Activate: Main] Draw 1 card.';
    c.scripts!.L = rulesFromRows(skillRecords(c.defs.L).map((r, id) => ({ ...r, id, status: 'draft', source: 'compiler' }) as unknown as RuleRow), c.defs).L;
    c.scripts!.L.bySkill[0].ops = [{ op: 'choose', sel: { side: 'you', area: 'energy', count: 1 }, as: 'target' }, { op: 'play', target: { var: 'target' } }];
    let state = RULES.createGame(c, { seed: 505, p1: { name: 'One', leader: 'L', main: fifty('F') }, p2: { name: 'Two', leader: 'L', main: fifty('F') } }).state as VmState;
    const events: GameEvent[] = [];
    const take = (a: Action) => { const saved = copy(state), before = JSON.stringify(saved), r = RULES.apply(c, saved, a); assert.equal(JSON.stringify(saved), before); state = r.state as VmState; events.push(...r.events); assert.equal(state.outcome, undefined, JSON.stringify(state.outcome)); };
    take({ type: 'chooseFirst', player: state.chooser, first: p });
    take({ type: 'mulligan', player: p, redraw: false });
    take({ type: 'mulligan', player: other(p), redraw: false });
    const incoming = stage(state, p, 'EX17-02', 'hand');
    take({ type: 'charge', player: p, card: incoming });
    assert.equal(skillsNegated(state, incoming), true);
    stage(state, p, 'F', 'energy');
    stage(state, p, 'F', 'energy');
    take({ type: 'activate', player: p, card: state.sides[p].zones.leader[0], skill: 0 });
    take({ type: 'choose', player: p, cards: [incoming] });
    for (let n = 0; n < 30 && state.prompt.kind !== 'main'; n++) {
        const a = RULES.legalActions(c, state).map(x => x.action).find(a => a.type === 'payCost' || a.type === 'counter' && a.card === null || a.type === 'pass');
        assert.ok(a, JSON.stringify(state.prompt));
        take(a);
    }
    assert.ok(state.sides[p].zones.battle.includes(incoming));
    assert.equal(skillsNegated(state, incoming), false);
    assert.equal(hasKeyword(c, game, state, incoming, 'Barrier'), true);
    assert.equal(events.filter(e => e.type === 'skill' && e.card === incoming && e.skill === 10).length, 1);
    assert.equal(events.filter(e => e.type === 'effectEnded' && e.effect.target === incoming && e.effect.kind === 'negateSkills').length, 1);
    cases++;
}
import { hasKeyword } from '../../src/lib/arena/vm/program';
import { freshAppliedEffectRoot } from '../../src/lib/arena/vm/applied-effect-receipt';
import { projectStandingNegationMoves } from '../../src/lib/arena/vm/standing-negation-projection';
// Actual shared mover: old execution resets, same execution survives only in
// qualifying destinations, and source duration ends independently of carry.
for (const p of ['p1', 'p2'] as const)
    for (const [from, to] of [['hand', 'battle'], ['energy', 'battle'], ['battle', 'hand'], ['battle', 'combo'], ['unison', 'combo'], ['combo', 'battle'], ['combo', 'drop'], ['battle', 'unison'], ['combo', 'unison'], ['battle', 'battle']]) {
        const s = fresh(p), id = stage(s, p, 'F', from), otherCard = stage(s, p, 'F', 'battle'), leader = s.sides[p].zones.leader[0];
        const prior = freshAppliedEffectRoot<ScriptFrame>(s, { ops: [], ip: 0, vars: {}, card: leader, master: p, skillIndex: 0 }, 'activate');
        vmHost(ctx, game, s, [], prior).addEffect({ target: id, kind: 'power', value: 5000, until: 'game' });
        const old = s.effects.at(-1)!;
        const frame = freshAppliedEffectRoot<ScriptFrame>(s, { ops: [], ip: 0, vars: {}, card: leader, master: p, skillIndex: 0 }, 'activate');
        vmHost(ctx, game, s, [], frame).addEffect({ target: id, kind: 'power', value: 1000, until: 'game' });
        const own = s.effects.at(-1)!;
        addEffect(s, [], { target: otherCard, source: id, kind: 'power', value: 3000, until: 'whileSourceInPlay' });
        const duration = s.effects.at(-1)!;
        const ev: GameEvent[] = [];
        moved(ctx, game, s, ev, id, to, { owner: p, appliedEffects: frame.appliedEffects, beforeTriggers: () => addEffect(s, ev, { target: id, kind: 'negateSkillKind', value: 'auto', until: 'turn' }) });
        const carry = from === to || ['battle', 'unison'].includes(from) && ['battle', 'unison', 'combo'].includes(to) || from === 'combo' && to === 'battle';
        const qualifies = ['leader', 'battle', 'unison', 'combo'].includes(to);
        assert.equal(s.effects.some(e => e.id === old.id), carry);
        assert.equal(s.effects.some(e => e.id === own.id), carry || qualifies);
        assert.equal(s.effects.some(e => e.id === duration.id), !(from === 'battle' && to !== 'battle'));
        assert.ok(s.effects.some(e => e.target === id && e.kind === 'negateSkillKind'));
        assert.equal(ev.filter(e => e.type === 'effectEnded' && e.effect.id === old.id).length, carry ? 0 : 1);
        cases++;
    }
// Retained copied definition, original pending capture, shared deletion bit,
// successive actual carries, and final reset without resurrecting a grant.
for (const p of ['p1', 'p2'] as const)
    for (const deleted of [false, true]) {
        const s = fresh(p), id = stage(s, p, 'F', 'battle');
        const grant = addEffect(s, [], { target: id, kind: 'copiedSkills', value: 0, until: 'game', copied: { cardId: 'BT28-043', side: 'front', skills: [0], from: id } })!;
        const index = copiedSkillIndex(grant.id, 0), showing = skillsShowing(ctx, s, id), skill = showing.skills.find(x => x.index === index)!;
        const captured = copy(captureCopiedSkill(s, id, skill, showing.scripts.bySkill[index])!);
        if (deleted)
            addEffect(s, [], { target: id, kind: 'negateSkills', value: 0, until: 'game' });
        moved(ctx, game, s, [], id, 'combo', { owner: p });
        moved(ctx, game, s, [], id, 'battle', { owner: p });
        assert.equal(capturedSkillShowing(ctx, copy(s), id, index, captured).deleted, deleted);
        assert.equal(skillsShowing(ctx, s, id).skills.some(x => x.index === index), !deleted);
        const receipt = s.resolvedGrantDeletions!.find(x => x.grant === grant.id)!;
        assert.equal(receipt.retainedOccurrences?.length, 2);
        assert.equal(receipt.deleted, deleted);
        const broken = copy(s);
        broken.resolvedGrantDeletions!.find(x => x.grant === grant.id)!.retainedOccurrences!.push({ ...receipt.retainedOccurrences![0] });
        const before = JSON.stringify(broken);
        assert.throws(() => moved(ctx, game, broken, [], id, 'combo', { owner: p }), /resolved skill-grant/);
        assert.equal(JSON.stringify(broken), before);
        moved(ctx, game, s, [], id, 'drop', { owner: p });
        assert.equal(s.effects.some(x => x.id === grant.id), false);
        assert.equal(capturedSkillShowing(ctx, copy(s), id, index, captured).deleted, deleted);
        moved(ctx, game, s, [], id, 'battle', { owner: p });
        assert.equal(skillsShowing(ctx, s, id).skills.some(x => x.index === index), false);
        cases++;
    }
for (const p of ['p1', 'p2'] as const) {
    const s = fresh(p), id = stage(s, p, 'F', 'battle'), ev: GameEvent[] = [];
    const grant = addEffect(s, [], { target: id, kind: 'copiedSkills', value: 0, until: 'game', copied: { cardId: 'BT28-043', side: 'front', skills: [0], from: id } })!;
    const index = copiedSkillIndex(grant.id, 0), showing = skillsShowing(ctx, s, id), skill = showing.skills.find(x => x.index === index)!;
    const captured = captureCopiedSkill(s, id, skill, showing.scripts.bySkill[index])!;
    s.pending.push({ card: id, master: p, skillIndex: index, trigger: 'played', copiedSkillCapture: captured });
    moved(ctx, game, s, ev, id, 'combo', { owner: p });
    const saved = copy(s);
    run(ctx, game, saved, ev);
    assert.equal(saved.outcome, undefined);
    assert.equal(ev.filter(e => e.type === 'draw' && e.player === p).length, 1);
    cases++;
}
// Only an affected payment-produced qualifying transition refuses, before move.
for (const p of ['p1', 'p2'] as const) {
    const s = fresh(p), id = stage(s, p, 'F', 'drop'), source = s.sides[p].zones.leader[0];
    const price = freshAppliedEffectRoot<ScriptFrame>(s, { ops: [], ip: 0, vars: {}, card: source, master: p, skillIndex: 0 }, 'tax');
    vmHost(ctx, game, s, [], price).addEffect({ target: id, kind: 'power', value: 1000, until: 'game' });
    const before = JSON.stringify(s), ev: GameEvent[] = [];
    assert.throws(() => moved(ctx, game, s, ev, id, 'battle', { owner: p, appliedEffects: price.appliedEffects }), /payment-produced/);
    assert.equal(JSON.stringify(s), before);
    assert.equal(ev.length, 0);
    moved(ctx, game, s, ev, id, 'warp', { owner: p, appliedEffects: price.appliedEffects });
    assert.ok(s.sides[p].zones.warp.includes(id));
    moved(ctx, game, s, ev, id, 'battle', { owner: p, appliedEffects: price.appliedEffects });
    assert.ok(s.sides[p].zones.battle.includes(id));
    assert.equal(s.effects.some(e => e.target === id), false);
    cases++;
}
for (const p of ['p1', 'p2'] as const) {
    const s = fresh(p), id = stage(s, p, 'F', 'combo');
    addEffect(s, [], { target: id, kind: 'power', value: 5000, until: 'game' });
    const projected = copy(s), actual = copy(s), before = JSON.stringify(s);
    projectStandingNegationMoves(ctx, game, projected, [{ id, to: 'drop', owner: p }], 'comboSubject');
    moved(ctx, game, actual, [], id, 'drop', { owner: p });
    assert.deepEqual(projected, actual);
    assert.equal(JSON.stringify(s), before);
    assert.equal(projected.effects.some(e => e.target === id), false);
    cases++;
}
// Resolved keyword grants carry with their deletion history, including
// same-execution prearrival application and a later whole-skill deletion.
for (const p of ['p1', 'p2'] as const) {
    const state = fresh(p), id = stage(state, p, 'F', 'drop'), source = state.sides[p].zones.leader[0];
    const frame = freshAppliedEffectRoot<ScriptFrame>(state, { ops: [], ip: 0, vars: {}, card: source, master: p, skillIndex: 0 }, 'activate');
    vmHost(ctx, game, state, [], frame).addEffect({ target: id, kind: 'keyword', value: { name: 'Barrier' }, until: 'game' });
    moved(ctx, game, state, [], id, 'battle', { owner: p, appliedEffects: frame.appliedEffects });
    assert.equal(hasKeyword(ctx, game, state, id, 'Barrier'), true);
    addEffect(state, [], { target: id, kind: 'negateSkills', value: 0, until: 'game' });
    moved(ctx, game, state, [], id, 'combo', { owner: p });
    state.effects = state.effects.filter(effect => !(effect.target === id && effect.kind === 'negateSkills'));
    assert.equal(hasKeyword(ctx, game, state, id, 'Barrier'), false, 'ending negation never recreates the deleted grant');
    cases++;
}
// Standing generation/subject projection parity uses the same real cleanup;
// the ordinary non-standing projection above is independently covered.
for (const p of ['p1', 'p2'] as const) {
    const c = copy(ctx);
    c.defs.N = card('N', { skill: standingFixture['DB1-066'].skill });
    c.scripts!.N = rulesFromRows(skillRecords(c.defs.N).map((r, id) => ({ ...r, id, status: 'draft', source: 'compiler' }) as unknown as RuleRow), c.defs).N;
    const row = standingFixture['DB1-066'].records[0];
    c.scripts!.N.bySkill[0] = { kind: row.kind, ops: row.ops, unsupported: row.unread, validity: row.validity, usage: row.usage, trigger: row.trigger, price: priceFromCostRecord(row.cost as CostRecord) } as Script;
    const state = RULES.createGame(c, { seed: 505, p1: { name: 'One', leader: 'L', main: fifty('F') }, p2: { name: 'Two', leader: 'L', main: fifty('F') } }).state as VmState;
    const id = stage(state, p, 'F', 'combo'), negator = stage(state, p, 'N', 'hand');
    const h = vmHost(c, game, state, []);
    h.move(negator, 'battle', p);
    h.addEffect({ target: id, kind: 'power', value: 5000, until: 'game' });
    const original = JSON.stringify(state), projected = copy(state), actual = copy(state);
    projectStandingNegationMoves(c, game, projected, [{ id, to: 'drop', owner: p }], 'comboSubject');
    moved(c, game, actual, [], id, 'drop', { owner: p });
    assert.deepEqual(projected, actual);
    assert.equal(JSON.stringify(state), original);
    assertStandingNegationSettled(c, projected);
    assert.equal(projected.effects.some(e => e.target === id), false);
    cases++;
    const source = stage(actual, p, 'F', 'hand');
    const a = vmHost(c, game, actual, []);
    a.move(source, 'battle', p);
    a.addEffect({ target: negator, source, kind: 'negateSkills', value: 0, until: 'whileSourceInPlay' });
    const generation = actual.standingNegationHistory!.nextSerial;
    moved(c, game, actual, [], source, 'hand', { owner: p });
    assertStandingNegationSettled(c, actual);
    assert.ok(actual.standingNegationHistory!.nextSerial > generation);
    assert.ok(actual.standingNegationHistory!.active.some(x => x.source.card === negator));
    cases++;
}
// Native attack/combo/end-battle flow reaches BOTH battle.ts subject branches.
// The generic trigger body is a labeled mechanism, with a choice preserving
// the original Combo board while its subject information comes from Drop.
for (const p of ['p1', 'p2'] as const)
    for (const standing of [false, true]) {
        const c = copy(ctx);
        c.defs.L.skill = '[Auto] When a card in your Combo Area is placed in your Drop Area, draw 1 card.';
        c.defs.G = card('G', { power: 100000 });
        c.scripts!.L = rulesFromRows(skillRecords(c.defs.L).map((r, id) => ({ ...r, id, status: 'draft', source: 'compiler' }) as unknown as RuleRow), c.defs).L;
        c.scripts!.L.bySkill[0].ops = [{ op: 'choose', sel: { area: 'combo', side: 'you', count: 1 }, as: 'target' }, { op: 'draw', n: 1 }];
        if (standing) {
            c.defs.N = card('N', { skill: standingFixture['DB1-066'].skill });
            const r = standingFixture['DB1-066'].records[0];
            c.scripts!.N = { bySkill: { 0: { kind: r.kind, ops: r.ops, unsupported: r.unread, validity: r.validity, usage: r.usage, trigger: r.trigger, price: priceFromCostRecord(r.cost as CostRecord) } as Script }, complete: true, unsupported: [] };
        }
        let state = RULES.createGame(c, { seed: 505, p1: { name: 'One', leader: 'L', main: fifty('F') }, p2: { name: 'Two', leader: 'L', main: fifty('F') } }).state as VmState;
        const events: GameEvent[] = [];
        const take = (action: Action) => { const saved = copy(state), before = JSON.stringify(saved), r = RULES.apply(c, saved, action); assert.equal(JSON.stringify(saved), before); state = r.state as VmState; events.push(...r.events); assert.equal(state.outcome, undefined, JSON.stringify(state.outcome)); };
        for (const action of [{ type: 'chooseFirst', player: state.chooser, first: p }, { type: 'mulligan', player: p, redraw: false }, { type: 'mulligan', player: other(p), redraw: false }, { type: 'charge', player: p, card: null }, { type: 'endMain', player: p }, { type: 'charge', player: other(p), card: null }, { type: 'endMain', player: other(p) }, { type: 'charge', player: p, card: null }] as Action[])
            take(action);
        const incoming = [stage(state, p, 'F', 'hand'), stage(state, p, 'F', 'hand')], attacker = stage(state, p, 'F', 'hand'), guard = stage(state, other(p), 'G', 'hand'), negator = standing ? stage(state, p, 'N', 'hand') : undefined;
        const h = vmHost(c, game, state, []);
        h.move(attacker, 'battle', p);
        h.move(guard, 'battle', other(p));
        if (negator)
            h.move(negator, 'battle', p);
        state.cards[guard].mode = 'rest';
        take({ type: 'attack', player: p, attacker, target: guard });
        const advance = () => {
            for (let n = 0; n < 60; n++) {
                if (state.prompt.kind === 'chooseCards' || state.prompt.kind === 'combo' && state.prompt.player === p)
                    return;
                const a = RULES.legalActions(c, state).map(x => x.action).find(a => a.type === 'counter' && a.card === null || a.type === 'pass' || a.type === 'block' && a.card === null || a.type === 'payCost' || a.type === 'zEnergyFromCombo' && a.card === null || a.type === 'orderPending');
                assert.ok(a, JSON.stringify(state.prompt));
                take(a);
            }
            throw Error('no next Combo/choice');
        };
        advance();
        for (const id of incoming) {
            take({ type: 'combo', player: p, card: id });
            advance();
        }
        for (const id of incoming)
            vmHost(c, game, state, []).addEffect({ target: id, kind: 'power', value: 7000, until: 'game' });
        take({ type: 'pass', player: p });
        for (let n = 0; n < 60 && state.prompt.kind !== 'chooseCards'; n++) {
            const a = RULES.legalActions(c, state).map(x => x.action).find(a => a.type === 'counter' && a.card === null || a.type === 'pass' || a.type === 'block' && a.card === null || a.type === 'payCost' || a.type === 'zEnergyFromCombo' && a.card === null || a.type === 'orderPending');
            assert.ok(a, JSON.stringify(state.prompt));
            take(a);
        }
        assert.equal(state.prompt.kind, 'chooseCards');
        assert.equal(state.battle?.endCombo?.stage, 'preDropCheckpoint');
        const frame = state.programs.find(f => f.subjectInfo && f.subject && incoming.includes(f.subject));
        assert.ok(frame);
        assert.equal(frame.subjectInfo!.power, c.defs.F.power);
        assert.ok(state.effects.some(e => e.target === frame.subject && e.kind === 'power'));
        assert.ok(state.sides[p].zones.combo.includes(frame.subject!));
        assert.equal(events.some(e => e.type === 'move' && incoming.includes(e.card) && e.to === 'drop'), false);
        for (const viewer of ['p1', 'p2'] as const)
            assert.equal(JSON.stringify(RULES.boardView(c, state, viewer, {})).includes('retainedOccurrences'), false);
        cases++;
    }
// Physical holder is part of area identity. This explicitly constructed
// private-holder boundary is a mechanism, not a new card route/admission.
for (const p of ['p1', 'p2'] as const) {
    const s = fresh(p), id = stage(s, p, 'F', 'hand');
    s.sides[p].zones.hand = s.sides[p].zones.hand.filter(x => x !== id);
    s.sides[other(p)].zones.hand.push(id);
    addEffect(s, [], { target: id, kind: 'power', value: 5000, until: 'game' });
    moved(ctx, game, s, [], id, 'hand', { owner: p });
    assert.ok(s.sides[p].zones.hand.includes(id));
    assert.equal(s.effects.some(e => e.target === id), false);
    cases++;
}
// Existing native control transfer followed by exact carried area pairs keeps
// its loan until expiry; the existing return procedure then restores its holder.
for (const p of ['p1', 'p2'] as const) {
    const s = fresh(p), id = stage(s, p, 'F', 'battle'), ev: GameEvent[] = [];
    vmHost(ctx, game, s, ev).move(id, 'battle', other(p));
    addEffect(s, ev, { target: id, kind: 'control', value: 0, until: 'turn', control: { from: p }, master: other(p) });
    addEffect(s, ev, { target: id, kind: 'power', value: 5000, until: 'game' });
    moved(ctx, game, s, ev, id, 'combo', { owner: other(p) });
    assert.ok(s.effects.some(e => e.target === id && e.kind === 'control'));
    moved(ctx, game, s, ev, id, 'battle', { owner: other(p) });
    assert.ok(s.sides[other(p)].zones.battle.includes(id));
    returnLoans(ctx, game, s, ev, endEffects(s, ev, 'turn'));
    assert.ok(s.sides[p].zones.battle.includes(id));
    assert.ok(s.effects.some(e => e.target === id && e.kind === 'power'));
    cases++;
}
// Refusals/stays do not consume old effects; redirects use the real route.
for (const p of ['p1', 'p2'] as const) {
    for (const route of ['stays', 'warp', 'combo', 'failed'] as const) {
        const state = fresh(p), id = stage(state, p, 'F', 'battle'), source = state.sides[p].zones.leader[0];
        const frame = freshAppliedEffectRoot<ScriptFrame>(state, { ops: [], ip: 0, vars: {}, card: source, master: p, skillIndex: 0 }, 'activate');
        vmHost(ctx, game, state, [], frame).addEffect({ target: id, kind: 'power', value: 3000, until: 'game' });
        const effect = state.effects.at(-1)!;
        const epoch = state.cards[id].zoneEpoch, ev: GameEvent[] = [];
        if (route === 'failed') {
            const before = JSON.stringify(state);
            assert.throws(() => moved(ctx, game, state, ev, id, 'not-a-zone', { owner: p, appliedEffects: frame.appliedEffects }), /cannot move/);
            assert.equal(JSON.stringify(state), before);
        }
        else
            moved(ctx, game, state, ev, id, 'hand', { owner: p, appliedEffects: frame.appliedEffects, replaced: route === 'stays' ? { ops: [{ op: 'draw', n: 1 }], source: id, master: p } : { to: route } });
        assert.equal(state.effects.some(e => e.id === effect.id), route !== 'warp');
        if (route === 'stays' || route === 'failed') {
            assert.equal(state.cards[id].zoneEpoch, epoch);
            assert.ok(state.sides[p].zones.battle.includes(id));
        }
        else
            assert.ok(state.sides[p].zones[route].includes(id));
        cases++;
    }
    // Cost provenance alone never blocks a valid area-carry transition.
    const state = fresh(p), id = stage(state, p, 'F', 'battle'), source = state.sides[p].zones.leader[0];
    const price = freshAppliedEffectRoot<ScriptFrame>(state, { ops: [], ip: 0, vars: {}, card: source, master: p, skillIndex: 0 }, 'tax');
    vmHost(ctx, game, state, [], price).addEffect({ target: id, kind: 'power', value: 1000, until: 'game' });
    moved(ctx, game, state, [], id, 'combo', { owner: p, appliedEffects: price.appliedEffects });
    assert.ok(state.effects.some(e => e.target === id));
    cases++;
}
console.log(`flow-placement-cleanup-5: ${cases} controls passed`);
