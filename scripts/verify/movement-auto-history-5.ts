/** R499 native movement-history boundaries. Injected cleanup is a labeled future-cleanup mechanism, not production cleanup. */
import assert from 'node:assert/strict';
import fixtures from './fixtures/movement-auto-history-5.json';
import { card, fifty } from './harness';
import { RULES } from '../../src/lib/arena/vm';
import { rulesetFor } from '../../src/lib/arena/rulesets';
import { skillRecords } from '../../src/lib/arena/draft';
import { rulesFromRows, type RuleRow } from '../../src/lib/arena/rules-store';
import { moveCard } from '../../src/lib/arena/vm/zones';
import { moved } from '../../src/lib/arena/vm/flow';
import { addEffect, dropEffectsOn, skillsNegated } from '../../src/lib/arena/vm/effects';
import { koCard } from '../../src/lib/arena/vm/battle';
import { vmHost } from '../../src/lib/arena/vm/host';
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
function fresh(p: PlayerId) { let s = RULES.createGame(ctx, { seed: 499, p1: { name: 'One', leader: 'L', main: fifty('F') }, p2: { name: 'Two', leader: 'L', main: fifty('F') } }).state as VmState; for (const a of [{ type: 'chooseFirst', player: s.chooser, first: p }, { type: 'mulligan', player: p, redraw: false }, { type: 'mulligan', player: other(p), redraw: false }, { type: 'charge', player: p, card: null }] as Action[])
    s = RULES.apply(ctx, copy(s), a).state as VmState; return s; }
function stage(s: VmState, p: PlayerId, def: string, area: string) { const id = s.sides[p].zones.deck.findLast(id => s.cards[id].cardId === 'F')!; s.cards[id].cardId = def; assert.ok(moveCard(s, game, id, area, { owner: p }).ok); return id; }
const rows: object[] = [];
for (const p of ['p1', 'p2'] as const)
    for (const area of ['hand', 'deck', 'drop', 'warp', 'energy', 'zEnergy', 'combo'])
        for (const old of ['none', 'whole', 'line'])
            for (const reset of [false, true]) {
                const s = fresh(p), id = stage(s, p, 'BT28-043', area), watcher = stage(s, p, 'W', 'battle'), ev: GameEvent[] = [];
                if (old !== 'none')
                    addEffect(s, ev, { target: id, kind: old === 'whole' ? 'negateSkills' : 'negateSkill', value: 0, until: 'game' });
                const saved = copy(s);
                moved(ctx, game, saved, ev, id, 'battle', { owner: p, asPlay: true, beforeTriggers: reset ? () => dropEffectsOn(saved, ev, id) : undefined });
                const self = saved.pending.filter(x => x.card === id && x.skillIndex === 0).length, watch = saved.pending.filter(x => x.card === watcher).length, expected = old === 'none' ? 1 : 0;
                rows.push({ kind: 'printed-played', p, area, old, reset, classification: reset ? 'future-cleanup mechanism' : 'current native mover', self, expected, pass: self === expected, watcher: watch, freshNegated: skillsNegated(saved, id) });
                assert.equal(watch, 1); // source history must never suppress another index-0 watcher
            }
for (const p of ['p1', 'p2'] as const) {
    const s = fresh(p), id = stage(s, p, 'BT28-043', 'hand'), ev: GameEvent[] = [];
    moved(ctx, game, s, ev, id, 'battle', { owner: p, asPlay: true, beforeTriggers: () => { dropEffectsOn(s, ev, id); addEffect(s, ev, { target: id, kind: 'negateSkills', value: 0, until: 'turn' }); } });
    const n = s.pending.filter(x => x.card === id).length;
    rows.push({ kind: 'new-arrival-negation', p, actual: n, expected: 0, pass: n === 0 });
}
for (const p of ['p1', 'p2'] as const)
    for (const area of ['hand', 'deck', 'drop', 'warp', 'zEnergy', 'combo']) {
        const s = fresh(p), id = stage(s, p, 'BT18-052', area);
        addEffect(s, [], { target: id, kind: 'negateSkills', value: 0, until: 'game' });
        vmHost(ctx, game, s, []).move(id, 'energy', p);
        const n = s.pending.filter(x => x.card === id).length;
        rows.push({ kind: 'R493-Energy', p, area, actual: n, expected: 0, pass: n === 0 });
    }
// Actual copied departure body; creation is an explicitly synthetic grant mechanism.
for (const p of ['p1', 'p2'] as const) {
    const s = fresh(p), id = stage(s, p, 'F', 'battle'), rest = stage(s, other(p), 'F', 'energy');
    s.cards[rest].mode = 'rest';
    const grant = addEffect(s, [], { target: id, kind: 'copiedSkills', value: 0, until: 'game', copied: { cardId: 'BT10-153', side: 'front', skills: [30], from: id } })!;
    const index = copiedSkillIndex(grant.id, 30), showing = skillsShowing(ctx, s, id), skill = showing.skills.find(x => x.index === index)!;
    const capture = captureCopiedSkill(s, id, skill, showing.scripts.bySkill[index])!;
    assert.ok(capture);
    const ev: GameEvent[] = [];
    const before = JSON.stringify(s);
    assert.throws(() => vmHost(ctx, game, s, ev).move(id, 'warp', p, { actor: other(p), reason: 'effect', source: s.sides[other(p)].zones.leader[0] }), /original movement Auto body/);
    assert.equal(JSON.stringify(s), before);
    assert.equal(ev.some(e => e.type === 'move' || e.type === 'ko'), false);
    rows.push({ kind: 'copied-departure-preflight', p, pass: true });
    // The pre-existing captured-body facility still rehydrates this identity;
    // R499 deliberately does not invent an arrival/old-grant merge policy.
    const recovered = capturedSkillShowing(ctx, copy(s), id, index, copy(capture));
    assert.equal(recovered.skill?.index, index);
    assert.ok(recovered.script);
}
// Offering is an Auto keyword (RM22-33-1), including named keyword negation.
for (const p of ['p1', 'p2'] as const)
    for (const mode of ['none', 'whole', 'line', 'named', 'newNamed']) {
        const s = fresh(p), id = stage(s, p, 'BT8-135', 'hand'), ev: GameEvent[] = [];
        const offering = skillsShowing(ctx, s, id).skills.find(sk => sk.keyword?.name === 'Offering')!;
        assert.ok(offering);
        if (mode === 'whole' || mode === 'line')
            addEffect(s, ev, { target: id, kind: mode === 'whole' ? 'negateSkills' : 'negateSkill', value: mode === 'whole' ? 0 : offering.index, until: 'game' });
        if (mode === 'named')
            addEffect(s, ev, { target: id, kind: 'negateKeyword', value: 'Offering', until: 'game' });
        moved(ctx, game, s, ev, id, 'battle', { owner: p, asPlay: true, beforeTriggers: () => {
                dropEffectsOn(s, ev, id);
                if (mode === 'newNamed')
                    addEffect(s, ev, { target: id, kind: 'negateKeyword', value: 'Offering', until: 'game' });
            } });
        const n = s.pending.filter(x => x.card === id).length;
        assert.equal(n, mode === 'none' ? 1 : 0);
        rows.push({ kind: 'Offering-Auto-keyword', p, mode, pass: true });
    }
// Actual paid printed Battle play builds the root and its ordinary Counter windows.
for (const p of ['p1', 'p2'] as const)
    for (const mode of ['none', 'whole', 'line']) {
        let s = fresh(p);
        const id = stage(s, p, 'BT28-043', 'hand'), ev: GameEvent[] = [];
        for (let n = 0; n < 6; n++) {
            const e = stage(s, p, 'BT28-043', 'energy');
            s.cards[e].mode = 'active';
        }
        if (mode !== 'none')
            addEffect(s, [], { target: id, kind: mode === 'whole' ? 'negateSkills' : 'negateSkill', value: 0, until: 'game' });
        const take = (action: Action) => { const saved = copy(s), before = JSON.stringify(saved), out = RULES.apply(ctx, saved, action); assert.equal(JSON.stringify(saved), before); s = out.state as VmState; ev.push(...out.events); assert.equal(s.outcome, undefined, JSON.stringify(s.outcome)); };
        const play = RULES.legalActions(ctx, s).map(x => x.action).find(a => a.type === 'play' && a.card === id);
        assert.ok(play);
        take(play);
        for (let n = 0; n < 30 && s.prompt.kind !== 'main'; n++) {
            const a = RULES.legalActions(ctx, s).map(x => x.action).find(a => a.type === 'payCost' || a.type === 'counter' && a.card === null || a.type === 'pass');
            assert.ok(a, JSON.stringify(s.prompt));
            take(a);
        }
        assert.equal(s.prompt.kind, 'main');
        assert.ok(s.sides[p].zones.battle.includes(id));
        assert.equal(ev.filter(e => e.type === 'skill' && e.card === id && e.skill === 0).length, mode === 'none' ? 1 : 0);
        assert.equal(ev.filter(e => e.type === 'draw' && e.player === p).length, mode === 'none' ? 1 : 0);
        for (const viewer of ['p1', 'p2'] as const)
            assert.equal(JSON.stringify(RULES.boardView(ctx, s, viewer, {})).includes('movementHistory'), false);
        assert.equal(JSON.stringify(ev).includes('movementHistory'), false);
        rows.push({ kind: 'actual-paid-BT28-043', p, mode, pass: true });
    }
// Actual BT13-040 Counter: Attack, paid through its normal native window.
for (const p of ['p1', 'p2'] as const) {
    const turn = other(p);
    let s = fresh(turn);
    const ev: GameEvent[] = [];
    const take = (action: Action) => { const saved = copy(s), before = JSON.stringify(saved), out = RULES.apply(ctx, saved, action); assert.equal(JSON.stringify(saved), before); s = out.state as VmState; ev.push(...out.events); assert.equal(s.outcome, undefined, JSON.stringify(s.outcome)); };
    for (const action of [{ type: 'endMain', player: turn }, { type: 'charge', player: p, card: null }, { type: 'endMain', player: p }, { type: 'charge', player: turn, card: null }] as Action[])
        take(action);
    const id = stage(s, p, 'BT13-040', 'hand'), energy = stage(s, p, 'BT28-043', 'energy'), attacker = stage(s, turn, 'F', 'battle');
    s.cards[energy].mode = 'active';
    take({ type: 'attack', player: turn, attacker, target: s.sides[p].zones.leader[0] });
    const counter = RULES.legalActions(ctx, s).map(x => x.action).find(a => a.type === 'counter' && a.card === id);
    assert.ok(counter, JSON.stringify(s.prompt));
    take(counter);
    for (let n = 0; n < 30 && s.prompt.kind !== 'main'; n++) {
        const action = RULES.legalActions(ctx, s).map(x => x.action).find(a => a.type === 'payCost' || a.type === 'counter' && a.card === null || a.type === 'pass' || a.type === 'block' && a.card === null || a.type === 'zEnergyFromCombo' && a.card === null);
        assert.ok(action, JSON.stringify(s.prompt));
        take(action);
    }
    assert.ok(s.sides[p].zones.battle.includes(id));
    assert.equal(s.cards[energy].mode, 'rest');
    assert.equal(ev.filter(e => e.type === 'skill' && e.card === id && e.skill === 0).length, 1);
    rows.push({ kind: 'actual-paid-BT13-040-Counter', p, pass: true });
}
// Exact synchronous alias duplicates and a later true movement remain distinct.
for (const p of ['p1', 'p2'] as const) {
    const s = fresh(p), id = stage(s, p, 'DEPART', 'battle'), source = s.sides[other(p)].zones.leader[0], ev: GameEvent[] = [];
    const h = vmHost(ctx, game, s, ev);
    h.move(id, 'warp', p, { actor: other(p), reason: 'effect', source });
    assert.equal(s.pending.filter(x => x.card === id).length, 1);
    h.pend('removedByOpponent', id, source, [], p);
    assert.equal(s.pending.filter(x => x.card === id).length, 1);
    h.move(id, 'battle', p);
    h.move(id, 'warp', p, { actor: other(p), reason: 'effect', source });
    h.pend('removedByOpponent', id, source, [], p);
    assert.equal(s.pending.filter(x => x.card === id).length, 2);
    rows.push({ kind: 'exact-alias-and-later-departure', p, pass: true });
}
// A nonmatching copied attack line must not block movement. A retained area
// transition keeps the actual copied definition and can answer played there.
for (const p of ['p1', 'p2'] as const) {
    const s = fresh(p), id = stage(s, p, 'F', 'battle');
    addEffect(s, [], { target: id, kind: 'copiedSkills', value: 0, until: 'game', copied: { cardId: 'BT28-043', side: 'front', skills: [10], from: id } });
    vmHost(ctx, game, s, []).move(id, 'warp', p, { actor: other(p), reason: 'effect' });
    assert.ok(s.sides[p].zones.warp.includes(id));
    const retained = stage(s, p, 'F', 'battle');
    const e = addEffect(s, [], { target: retained, kind: 'copiedSkills', value: 0, until: 'game', copied: { cardId: 'BT28-043', side: 'front', skills: [0], from: retained } })!;
    vmHost(ctx, game, s, []).move(retained, 'combo', p);
    vmHost(ctx, game, s, []).move(retained, 'battle', p);
    moved(ctx, game, s, [], retained, 'battle', { owner: p, asPlay: true });
    assert.ok(s.effects.some(x => x.id === e.id));
    assert.equal(s.pending.filter(x => x.card === retained && x.skillIndex === copiedSkillIndex(e.id, 0)).length, 1);
    rows.push({ kind: 'copied-unrelated-and-retained', p, pass: true });
}
// KO preflight protects victim history without emitting a completed KO first.
for (const p of ['p1', 'p2'] as const) {
    const s = fresh(p), id = stage(s, p, 'F', 'battle'), ev: GameEvent[] = [];
    addEffect(s, [], { target: id, kind: 'copiedSkills', value: 0, until: 'game', copied: { cardId: 'KO', side: 'front', skills: [0], from: id } });
    const before = JSON.stringify(s);
    assert.throws(() => koCard(ctx, game, s, ev, id, s.sides[other(p)].zones.leader[0], undefined, 'skill'), /original movement Auto body/);
    assert.equal(JSON.stringify(s), before);
    assert.equal(ev.some(e => e.type === 'ko' || e.type === 'move'), false);
    assert.throws(() => koCard(ctx, game, s, ev, id, s.sides[other(p)].zones.leader[0], {to:'warp'}, 'skill'), /original movement Auto body/);
    assert.equal(ev.length, 0);
    assert.equal(JSON.stringify(s), before);
    const victim = stage(s, p, 'KO', 'battle');
    koCard(ctx, game, s, ev, victim, s.sides[other(p)].zones.leader[0], { to: 'warp' }, 'skill');
    assert.ok(s.sides[p].zones.warp.includes(victim));
    assert.deepEqual(ev.map(event=>event.type), ['ko','note','move']);
    assert.equal(s.pending.filter(x => x.card === victim && x.trigger === 'koed').length, 1);
    rows.push({ kind: 'KO-preflight-and-redirect', p, pass: true });
}
// Supplemental declaration facts are structural mechanisms, not new readers.
for (const p of ['p1', 'p2'] as const) {
  for (const spec of [
    {trigger:'droppedFromHandByFusion',from:'hand',facts:{version:1,union:'Fusion'}},
    {trigger:'revealedTopToDrop',from:'deck',facts:{version:1,revealedTop:true}},
    {trigger:'underLeaderToDropBySkill',from:'hand',facts:{version:1,fromPile:'leader'}},
  ] as const) {
    const c=copy(ctx);c.scripts!.DEPART.bySkill[0].trigger=[spec.trigger];
    for(const negated of [false,true]) {
      const s=fresh(p),id=stage(s,p,'DEPART',spec.from),source=s.sides[p].zones.leader[0];
      if(negated)addEffect(s,[],{target:id,kind:'negateSkill',value:0,until:'game'});
      const h=vmHost(c,game,s,[]);h.move(id,'drop',p,{actor:p,source,legacyMovement:spec.facts});
      assert.equal(s.pending.filter(x=>x.card===id).length,0);
      h.pend(spec.trigger,id,source,[0],p);
      assert.equal(s.pending.filter(x=>x.card===id).length,negated?0:1);
      rows.push({kind:'supplemental-alias-mechanism',p,trigger:spec.trigger,negated,pass:true});
    }
    const s=fresh(p),id=stage(s,p,'F',spec.from),source=s.sides[p].zones.leader[0];
    addEffect(s,[],{target:id,kind:'copiedSkills',value:0,until:'game',copied:{cardId:'DEPART',side:'front',skills:[0],from:id}});
    const before=JSON.stringify(s),ev:GameEvent[]=[];
    assert.throws(()=>vmHost(c,game,s,ev).move(id,'drop',p,{actor:p,source,legacyMovement:spec.facts}),/original movement Auto body/);
    assert.equal(JSON.stringify(s),before);assert.equal(ev.some(e=>e.type==='move'),false);
    rows.push({kind:'supplemental-copy-preflight-mechanism',p,trigger:spec.trigger,pass:true});
  }
  const s=fresh(p),id=stage(s,p,'F','battle');
  addEffect(s,[],{target:id,source:id,kind:'copiedSkills',value:0,until:'whileSourceInPlay',copied:{cardId:'BT10-153',side:'front',skills:[30],from:id}});
  const before=JSON.stringify(s);
  assert.throws(()=>vmHost(ctx,game,s,[]).move(id,'combo',p,{actor:other(p)}),/original movement Auto body/);
  assert.equal(JSON.stringify(s),before);
  rows.push({kind:'retained-area-ending-grant',p,pass:true});
}
for (const row of rows)
    assert.equal((row as {
        pass: boolean;
    }).pass, true, JSON.stringify(row));
console.log(`movement-auto-history-5: ${rows.length} cases passed`);
