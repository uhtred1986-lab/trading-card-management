/** R495 Stage A: native execution provenance; cleanup remains unchanged. */
import assert from 'node:assert/strict';
import fixtures from './fixtures/applied-effect-receipt-5.json';
import { card, fifty } from './harness';
import { RULES } from '../../src/lib/arena/vm';
import { rulesetFor } from '../../src/lib/arena/rulesets';
import { skillRecords } from '../../src/lib/arena/draft';
import { rulesFromRows, type RuleRow } from '../../src/lib/arena/rules-store';
import { freshAppliedEffectRoot, captureAppliedEffectMove, settleAppliedEffectMove } from '../../src/lib/arena/vm/applied-effect-receipt';
import { vmHost } from '../../src/lib/arena/vm/host';
import { moveCard } from '../../src/lib/arena/vm/zones';
import type { Action, Area, EngineContext, GameEvent, PlayerId } from '../../src/lib/arena/types';
import type { ScriptFrame } from '../../src/lib/arena/vm/script';
import type { VmState } from '../../src/lib/arena/vm/state';
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const loaded = rulesetFor('dbs');
assert.ok(loaded.ok);
const game = loaded.definition;
const other = (p: PlayerId): PlayerId => p === 'p1' ? 'p2' : 'p1';
let checks = 0;
for (const v of Object.values(fixtures)) {
  assert.deepEqual(copy(skillRecords(v.def as EngineContext['defs'][string])), v.records);
  checks++;
}
function setup(p: PlayerId) {
  const defs: EngineContext['defs'] = { L: card('L', { type: 'LEADER', colors: ['Green'], traits: ['Universe 6'], skill: '[Activate: Main] Draw 1 card.' }), F: card('F', {}), T: card('T', { colors: ['Blue'], traits: ['Universe 6'], power: 10000, energyCost: 2 }), E: card('E', { colors: ['Blue', 'Green', 'Yellow', 'Black'] }), A: card('A', { power: 10000 }), G: card('G', { power: 20000 }), COUNTER: card('COUNTER', { energyCost: 0, skill: '[Counter: Play] Play this card.' }) };
  for (const [id, v] of Object.entries(fixtures))
    defs[id] = v.def as EngineContext['defs'][string];
  const c: EngineContext = { defs, scripts: rulesFromRows(Object.values(defs).flatMap(skillRecords).map((r, id) => ({ ...r, id, status: 'draft', source: 'compiler' }) as unknown as RuleRow), defs) };
  c.scripts!.L.bySkill[0].ops = [{ op: 'choose', sel: { side: 'you', area: 'hand', count: 1 }, as: 'play' }, { op: 'play', target: { var: 'play' } }];
  let s = RULES.createGame(c, { seed: 495, p1: { name: 'One', leader: 'L', main: fifty('F') }, p2: { name: 'Two', leader: 'L', main: fifty('F') } }).state as VmState;
  const events: GameEvent[] = [];
  const snapshots: VmState[] = [];
  const take = (a: Action) => {
    const saved = copy(s), before = JSON.stringify(saved), r = RULES.apply(c, saved, a);
    assert.equal(JSON.stringify(saved), before);
    s = r.state as VmState;
    events.push(...r.events);
    snapshots.push(copy(s));
    assert.equal(s.outcome, undefined, JSON.stringify(s.outcome));
  };
  take({ type: 'chooseFirst', player: s.chooser, first: p });
  take({ type: 'mulligan', player: p, redraw: false });
  take({ type: 'mulligan', player: other(p), redraw: false });
  take({ type: 'charge', player: p, card: null });
  const stage = (owner: PlayerId, id: string, area: Area) => {
    const n = s.sides[owner].zones.deck.at(-1)!;
    s.cards[n].cardId = id;
    assert.ok(moveCard(s, game, n, area, { owner }).ok);
    s.cards[n].mode = 'active';
    return n;
  };
  const drain = () => {
    for (let n = 0; n < 40; n++) {
      const a = RULES.legalActions(c, s).map(x => x.action).find(a => a.type === 'payCost' || a.type === 'counter' && a.card === null || a.type === 'block' && a.card === null);
      if (!a)
        return;
      take(a);
    }
    throw Error('drain overflow');
  };
  const play = (id: string) => {
    take({ type: 'activate', player: p, card: s.sides[p].zones.leader[0], skill: 0 });
    drain();
    take({ type: 'choose', player: p, cards: [id] });
    drain();
  };
  return { c, get s() {
      return s;
    }, take, stage, drain, play, events, snapshots };
}
for (const p of ['p1', 'p2'] as const)
  for (const paid of [false, true]) {
    const b = setup(p), source = b.stage(p, 'DB1-043', 'hand'), targets = [b.stage(p, 'T', 'drop'), b.stage(p, 'T', 'drop')];
    if (paid) {
      for (let n = 0; n < 3; n++)
        b.stage(p, 'E', 'energy');
      b.take({ type: 'play', player: p, card: source });
      b.drain();
    }
    else
      b.play(source);
    assert.equal(b.s.prompt.kind, 'chooseCards', JSON.stringify(b.s.prompt));
    for (const target of targets) {
      b.take({ type: 'choose', player: p, cards: [target] });
      b.drain();
    }
    for (const target of targets) {
      assert.ok(b.s.sides[p].zones.battle.includes(target));
      const fx = b.s.effects.filter(e => e.target === target);
      assert.ok(fx.some(e => e.kind === 'negateSkills'));
      assert.ok(fx.some(e => e.kind === 'power' && e.value === 5000));
      const tags = fx.map(e => b.s.appliedEffectOwnership?.[e.id]).filter(x => x !== undefined);
      assert.equal(tags.length, 2);
      assert.equal(tags[0].anchor, tags[1].anchor);
      assert.equal(tags[0].root.source.card, source);
      assert.deepEqual(tags.map(t => t.application.area), ['drop', 'battle']);
      assert.ok(tags.every(t => t.current?.area === 'battle' && t.current.epoch === b.s.cards[target].zoneEpoch));
      checks++;
    }
  }
for (const p of ['p1', 'p2'] as const)
  for (const id of ['EX21-15', 'BT13-096']) {
    const b = setup(p), source = b.stage(p, id, 'hand'), target = b.stage(other(p), 'T', 'battle');
    b.stage(p, 'COUNTER', 'hand');
    b.stage(other(p), 'COUNTER', 'hand');
    b.play(source);
    for (let n = 0; n < 6 && b.s.prompt.kind === 'chooseCards'; n++) {
      const q = b.s.prompt.choice;
      const chosen = q.candidates.includes(target) ? [target] : q.min === 0 ? [] : [q.candidates[0]];
      b.take({ type: 'choose', player: b.s.prompt.player, cards: chosen });
      b.drain();
    }
    assert.ok(b.s.sides[other(p)].zones.warp.includes(target), JSON.stringify(b.s.prompt));
    const oldAnchors = Object.values(b.s.appliedEffectOwnership ?? {}).map(t => t.anchor);
    for (let n = 0; n < 80 && !b.s.sides[other(p)].zones.battle.includes(target); n++) {
      const q = b.s.prompt;
      if (q.kind === 'chooseCards') {
        b.take({ type: 'choose', player: q.player, cards: q.choice.min ? [q.choice.candidates[0]] : [] });
        continue;
      }
      const a = RULES.legalActions(b.c, b.s).map(x => x.action).find(a => a.type === 'endMain' || a.type === 'charge' && a.card === null || a.type === 'counter' && a.card === null || a.type === 'pass' || a.type === 'payCost');
      assert.ok(a, JSON.stringify(q));
      b.take(a);
    }
    assert.ok(b.s.sides[other(p)].zones.battle.includes(target));
    const neg = b.events.filter(e => e.type === 'effect').map(e => e.effect).findLast(e => e.target === target && e.kind === 'negateSkills');
    assert.ok(neg);
    const tag = b.snapshots.map(s => s.appliedEffectOwnership?.[neg.id]).find(t => t?.current?.area === 'battle');
    assert.ok(tag);
    assert.equal(tag.root.kind, 'delayed');
    assert.equal(tag.application.area, 'warp');
    assert.equal(tag.current?.area, 'battle');
    assert.equal(oldAnchors.includes(tag.anchor), false);
    if (id === 'BT13-096') {
      assert.ok(b.s.sides[p].zones.battle.includes(source));
      const self = b.events.filter(e => e.type === 'effect').map(e => e.effect).findLast(e => e.target === source && e.kind === 'negateSkills');
      assert.ok(self);
      assert.ok(b.snapshots.some(s => s.appliedEffectOwnership?.[self.id]?.anchor === tag.anchor));
    }
    checks++;
  }
for (const p of ['p1', 'p2'] as const) {
  const b = setup(p);
  for (const a of [{ type: 'endMain', player: p }, { type: 'charge', player: other(p), card: null }, { type: 'endMain', player: other(p) }, { type: 'charge', player: p, card: null }] as Action[])
    b.take(a);
  const source = b.stage(p, 'BT15-057', 'battle'), target = b.stage(p, 'T', 'drop'), attacker = b.stage(p, 'A', 'battle'), guard = b.stage(other(p), 'G', 'battle');
  b.stage(p, 'E', 'energy');
  b.s.cards[guard].mode = 'rest';
  b.take({ type: 'attack', player: p, attacker, target: guard });
  b.drain();
  assert.equal(b.s.prompt.kind, 'combo');
  b.take({ type: 'activate', player: p, card: source, skill: 20 });
  b.drain();
  assert.equal(b.s.prompt.kind, 'chooseCards');
  b.take({ type: 'choose', player: p, cards: [target] });
  b.drain();
  assert.ok(b.s.sides[p].zones.combo.includes(target));
  const created = b.events.filter(e => e.type === 'effect').map(e => e.effect).filter(e => e.target === target);
  assert.ok(created.some(e => e.kind === 'negateSkills'));
  const power = created.find(e => e.kind === 'comboPower' && e.value === -5000);
  assert.ok(power, JSON.stringify(created));
  const tag = b.s.appliedEffectOwnership?.[power.id];
  assert.ok(tag);
  assert.equal(tag.root.source.card, source);
  assert.equal(tag.root.kind, 'activate');
  assert.equal(tag.application.area, 'combo');
  // The actual full record produces both effects AFTER the Combo arrival.
  const neg = created.find(e => e.kind === 'negateSkills')!;
  assert.equal(tag.anchor, power.id);
  assert.equal(b.s.appliedEffectOwnership?.[neg.id].anchor, tag.anchor);
  assert.equal(b.s.appliedEffectOwnership?.[neg.id].application.area, 'combo');
  assert.ok(b.s.effects.some(e => e.id === neg.id));
  checks++;
}
// Identical source/master/line/occurrence does not identify an execution.
for (const p of ['p1', 'p2'] as const) {
  const b = setup(p), target = b.stage(p, 'T', 'drop'), source = b.s.sides[p].zones.leader[0];
  b.c.scripts!.L.bySkill[0].ops = [{ op: 'choose', sel: { side: 'you', area: 'drop', count: 1 }, as: 'target' }, { op: 'power', target: { var: 'target' }, amount: 1000, until: 'game' }, { op: 'chooseMode', modes: [{ label: 'Play', ops: [{ op: 'play', target: { var: 'target' } }] }, { label: 'Keep', ops: [] }] }];
  const start = () => {
    b.take({ type: 'activate', player: p, card: source, skill: 0 });
    if (b.s.prompt.kind === 'chooseCards')
      b.take({ type: 'choose', player: p, cards: [target] });
    assert.equal(b.s.prompt.kind, 'chooseMode');
  };
  start();
  const first = b.s.effects.find(e => e.target === target && e.kind === 'power')!;
  // This save has already produced an effect. Missing or corrupt history must
  // refuse explicitly, never initialize an empty receipt or rediscover by source.
  for (const corrupt of ['missing', 'root', 'source', 'master', 'entry'] as const) {
    const saved = copy(b.s), f = saved.programs.find(f => f.card === source && f.appliedEffects)!;
    if (corrupt === 'missing') {
      delete f.appliedEffects;
      delete f.appliedPaymentEffects;
    }
    if (corrupt === 'root')
      f.appliedEffects!.root = null as never;
    if (corrupt === 'source')
      f.appliedEffects!.root.source = null as never;
    if (corrupt === 'master')
      f.appliedEffects!.root.master = other(p);
    if (corrupt === 'entry')
      f.appliedEffects!.entries[0].target.cardId = 'forged';
    const before = JSON.stringify(saved), result = RULES.apply(b.c, saved, { type: 'chooseMode', player: p, index: 0 });
    assert.equal(JSON.stringify(saved), before);
    assert.ok(JSON.stringify(result.state).includes('R495'));
    assert.equal((result.state as VmState).sides[p].zones.battle.includes(target), false);
    checks++;
  }
  b.take({ type: 'chooseMode', player: p, index: 1 });
  start();
  const second = b.s.effects.filter(e => e.target === target && e.kind === 'power').at(-1)!;
  assert.notEqual(first.id, second.id);
  b.take({ type: 'chooseMode', player: p, index: 0 });
  b.drain();
  assert.ok(b.s.sides[p].zones.battle.includes(target));
  assert.equal(b.s.appliedEffectOwnership?.[first.id].current, null);
  assert.equal(b.s.appliedEffectOwnership?.[second.id].current?.area, 'battle');
  assert.notEqual(b.s.appliedEffectOwnership?.[first.id].anchor, b.s.appliedEffectOwnership?.[second.id].anchor);
  checks++;
}
// Direct native host adapter: two independent roots share an area-carry target.
// This is a mechanism fixture, not admission of a printed nested-move card.
for (const p of ['p1', 'p2'] as const) {
  const b = setup(p), target = b.stage(p, 'T', 'battle'), source = b.s.sides[p].zones.leader[0];
  const parent = freshAppliedEffectRoot<ScriptFrame>(b.s, { ops: [], ip: 0, vars: {}, card: source, master: p }, 'activate');
  const child = freshAppliedEffectRoot<ScriptFrame>(b.s, { ops: [], ip: 0, vars: {}, card: source, master: p }, 'invoke');
  vmHost(b.c, game, b.s, b.events, parent).addEffect({ target, source, master: p, kind: 'power', value: 1000, until: 'game' });
  vmHost(b.c, game, b.s, b.events, child).addEffect({ target, source, master: p, kind: 'power', value: 2000, until: 'game' });
  const own = parent.appliedEffects!.anchor!, otherId = child.appliedEffects!.anchor!;
  vmHost(b.c, game, b.s, b.events, child).move(target, 'combo', p, { carry: true });
  assert.equal(b.s.appliedEffectOwnership?.[own].current?.area, 'combo');
  assert.equal(b.s.appliedEffectOwnership?.[otherId].current?.area, 'combo');
  const saved = copy({ s: b.s, parent, child });
  vmHost(b.c, game, saved.s, [], saved.parent).move(target, 'battle', p, { carry: true });
  assert.equal(saved.s.appliedEffectOwnership?.[own].current?.area, 'battle');
  assert.equal(saved.parent.appliedEffects!.entries[0].target.area, 'battle');
  vmHost(b.c, game, saved.s, [], saved.child).move(target, 'warp', p);
  assert.equal(saved.s.effects.some(e => e.id === own), false);
  assert.equal(saved.parent.appliedEffects!.entries[0].effect, own);
  checks++;
}
// Ownership is private saved engine state. Actual public effect objects and
// their already-emitted beats remain byte-for-byte unchanged by stamping.
for (const p of ['p1', 'p2'] as const) {
  const b = setup(p);
  b.c.defs.PRIVATE_SOURCE = card('PRIVATE_SOURCE', { name: 'Unique private source R495' });
  b.c.defs.PRIVATE_TARGET = card('PRIVATE_TARGET', { name: 'Unique private target R495' });
  const source = b.stage(p, 'PRIVATE_SOURCE', 'hand'), target = b.stage(p, 'PRIVATE_TARGET', 'hand');
  const frame = freshAppliedEffectRoot<ScriptFrame>(b.s, { ops: [], ip: 0, vars: {}, card: source, master: p }, 'activate');
  const events: GameEvent[] = [];
  vmHost(b.c, game, b.s, events, frame).addEffect({ target, source, master: p, kind: 'power', value: 1000, until: 'game' });
  const baseline = copy(b.s);
  delete baseline.appliedEffectOwnership;
  const originalEvents = JSON.stringify(events);
  for (const viewer of ['p1', 'p2'] as const) {
    const view = RULES.boardView(b.c, copy(b.s), viewer, {});
    assert.deepEqual(view, RULES.boardView(b.c, baseline, viewer, {}));
    assert.equal(JSON.stringify(view).includes('appliedEffectOwnership'), false);
    if (viewer !== p) {
      assert.equal(JSON.stringify(view).includes('Unique private source R495'), false);
      assert.equal(JSON.stringify(view).includes('Unique private target R495'), false);
    }
    checks++;
  }
  assert.deepEqual(RULES.toBeats(b.c, copy(b.s), copy(events)), RULES.toBeats(b.c, baseline, copy(events)));
  assert.equal(JSON.stringify(events), originalEvents);
  assert.equal(originalEvents.includes('application'), false);
  checks++;
  // Mechanism corruption control: native hand moves force ownership, so use
  // an explicit holder-mutated save to exercise the occurrence adapter itself.
  const movement = captureAppliedEffectMove(b.s, target);
  b.s.sides[p].zones.hand = b.s.sides[p].zones.hand.filter(id => id !== target);
  b.s.sides[other(p)].zones.hand.push(target);
  b.s.cards[target].zoneEpoch = (b.s.cards[target].zoneEpoch ?? 0) + 1;
  settleAppliedEffectMove(b.s, movement);
  assert.equal(b.s.appliedEffectOwnership?.[frame.appliedEffects!.anchor!].current, null);
  checks++;
}
// Explicit mechanism fixture using the admitted negative-self-power Auto price.
for (const p of ['p1', 'p2'] as const) {
  const b = setup(p);
  b.c.defs.PAY = card('PAY', { power: 20000, skill: '[Auto] This card gets -1000 power for the turn: When this card is played, this card gets +2000 power for the turn.' });
  b.c.scripts!.PAY = rulesFromRows(skillRecords(b.c.defs.PAY).map((r, id) => ({ ...r, id, status: 'draft', source: 'compiler' }) as unknown as RuleRow), b.c.defs).PAY;
  const source = b.stage(p, 'PAY', 'hand');
  b.play(source);
  if (b.s.prompt.kind === 'optionalCost')
    b.take({ type: 'optionalCost', player: p, pay: true });
  else if (b.s.prompt.kind === 'chooseMode')
    b.take({ type: 'chooseMode', player: p, index: 0 });
  b.drain();
  const cost = b.s.effects.find(e => e.target === source && e.kind === 'power' && e.value === -1000), body = b.s.effects.find(e => e.target === source && e.kind === 'power' && e.value === 2000);
  assert.ok(cost);
  assert.ok(body);
  const payment = b.s.appliedEffectOwnership?.[cost.id], effect = b.s.appliedEffectOwnership?.[body.id];
  assert.ok(payment);
  assert.ok(effect);
  assert.equal(payment.root.kind, 'tax');
  assert.equal(effect.root.kind, 'auto');
  assert.notEqual(payment.anchor, effect.anchor);
  checks++;
}
console.log(JSON.stringify({ checks, scope: 'R495 native applied-effect receipts' }));
