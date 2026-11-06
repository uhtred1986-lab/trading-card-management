import assert from 'node:assert/strict';
import { beginRoot, applyOwned, captureForMove, settleMove, validate, eligible, areaCarries, retireForRetarget, type Board, type Occurrence, type AppliedEffect, type Root, type Retention } from '../../src/lib/arena/vm/applied-effect-receipt';
const origin: Occurrence = { card: 'c', cardId: 'C', epoch: 3, hiddenCount: 0, holder: 'p1', area: 'drop' };
const arrived = { ...origin, epoch: 4, area: 'battle' };
const parent: Root = { kind: 'activate', master: 'p1', source: { ...origin, card: 'source', cardId: 'S', area: 'battle' }, skillIndex: 10 };
let checks = 0;
function fixture() {
  const board: Board = { effects: [], ownership: {} };
  let next = 10;
  const make = (target = 'c', kind: AppliedEffect['kind'] = 'negateSkills', value: AppliedEffect['value'] = 0) => {
    const e: AppliedEffect = { id: next++, target, kind, value, source: 'same-source', master: 'p1', until: 'game', createdTurn: 1, ownerTurn: 'p1' };
    board.effects.push(e);
    return e;
  };
  return { board, make };
}
const policy = (from: Occurrence, to: Occurrence): Retention => areaCarries(from.area, to.area, from.holder === to.holder) ? 'area' : ['leader', 'battle', 'unison', 'combo'].includes(to.area) ? 'sameSkill' : 'reset';
function move(receipt: ReturnType<typeof beginRoot>, board: Board, root: Root, from: Occurrence, to: Occurrence, retention = policy(from, to)) {
  const plan = captureForMove(receipt, board, root, from), allowed = eligible(plan, to, retention);
  // Stage C simulation only: real adapter will call its actual shared cleanup.
  if (retention !== 'area')
    board.effects = board.effects.filter(e => e.target !== from.card || allowed.includes(e.id));
  return settleMove(receipt, board, root, plan, { moved: true, from, to, retention });
}
for (const destination of ['leader', 'battle', 'unison', 'combo', 'hand', 'deck', 'warp', 'energy']) {
  const { board, make } = fixture(), old = beginRoot(parent), root = beginRoot(parent);
  const first = applyOwned(old, board, parent, origin, () => make())!, own = applyOwned(root, board, parent, origin, () => make())!;
  const saved = structuredClone({ board, root }), to = { ...arrived, area: destination }, ids = move(saved.root, saved.board, parent, origin, to);
  assert.deepEqual(ids, ['leader', 'battle', 'unison', 'combo'].includes(destination) ? [own.id] : []);
  assert.ok(!ids.includes(first.id));
  assert.equal(saved.root.entries.length, 1);
  assert.deepEqual(saved.root.entries[0].target, origin);
  if (ids.length)
    assert.deepEqual(saved.board.ownership[own.id].current, to);
  checks++;
}
// Deleted first anchor and legitimate partial copied-grant mutation.
{
  const { board, make } = fixture(), root = beginRoot(parent);
  const deleted = applyOwned(root, board, parent, origin, () => make())!, mutated = applyOwned(root, board, parent, origin, () => make('c', 'power', 1000))!;
  board.effects = board.effects.filter(e => e !== deleted);
  mutated.value = 500;
  validate(root, board, parent);
  const ids = move(root, board, parent, origin, arrived);
  assert.deepEqual(ids, [mutated.id]);
  assert.equal(board.effects[0].value, 500);
  assert.equal(root.entries.length, 2);
  checks++;
}
// Consecutive same-skill move then exact-area carry and later reset.
{
  const { board, make } = fixture(), root = beginRoot(parent), e = applyOwned(root, board, parent, origin, () => make())!;
  const combo = { ...arrived, epoch: 5, area: 'combo' }, battle = { ...arrived, epoch: 6 }, warp = { ...arrived, epoch: 7, area: 'warp' }, replayed = { ...arrived, epoch: 8 };
  for (const [from, to] of [[origin, arrived], [arrived, combo], [combo, battle]]) {
    assert.deepEqual(move(root, board, parent, from, to), [e.id]);
    assert.deepEqual(board.ownership[e.id].current, to);
    assert.deepEqual(root.entries[0].target, origin);
    checks++;
  }
  assert.deepEqual(move(root, board, parent, battle, warp), []);
  assert.equal(root.entries.length, 1);
  assert.deepEqual(move(root, board, parent, warp, replayed), []);
  assert.equal(board.effects.length, 0);
  checks++;
}
// Same-area control/retained-area movement then another qualifying move.
{
  const { board, make } = fixture(), root = beginRoot(parent), initial = { ...origin, area: 'battle' }, e = applyOwned(root, board, parent, initial, () => make())!;
  const controlled = { ...initial, holder: 'p2' }, combo = { ...controlled, area: 'combo', epoch: 4 }, unison = { ...combo, area: 'unison', epoch: 5 };
  assert.deepEqual(move(root, board, parent, initial, controlled), [e.id]);
  assert.deepEqual(move(root, board, parent, controlled, combo), [e.id]);
  assert.deepEqual(move(root, board, parent, combo, unison), [e.id]);
  assert.deepEqual(board.ownership[e.id].current, unison);
  assert.deepEqual(root.entries[0].target, initial);
  checks++;
  // Combo->Unison is SAME-SKILL, not an area-pair carry entitlement.
  assert.throws(() => eligible(captureForMove(root, board, parent, unison), { ...unison, area: 'hand' }, 'area'), /receipt/);
  checks++;
}
for (const kind of ['invoke', 'delayed', 'tax'] as const) {
  const { board, make } = fixture(), child: Root = { ...structuredClone(parent), kind }, a = beginRoot(parent), b = beginRoot(child), ea = applyOwned(a, board, parent, origin, () => make())!, eb = applyOwned(b, board, child, origin, () => make())!;
  assert.notEqual(a.anchor, b.anchor);
  assert.throws(() => captureForMove(a, board, child, origin), /receipt/);
  assert.deepEqual(captureForMove(a, board, parent, origin).effects, [ea.id]);
  assert.deepEqual(captureForMove(b, board, child, origin).effects, [eb.id]);
  checks++;
}
for (const mode of ['failed', 'stay', 'redirect', 'retarget', 'deletedAfterPlan']) {
  const { board, make } = fixture(), root = beginRoot(parent), e = applyOwned(root, board, parent, origin, () => make())!;
  const from = origin;
  if (mode === 'retarget') {
    retireForRetarget(board, e);
    e.target = 'other';
  }
  const plan = captureForMove(root, board, parent, from);
  if (mode === 'deletedAfterPlan')
    board.effects = [];
  const to = mode === 'stay' || mode === 'failed' ? from : mode === 'redirect' ? { ...arrived, area: 'warp' } : arrived;
  const ids = settleMove(root, board, parent, plan, { moved: mode !== 'failed', from, to, retention: policy(from, to) });
  assert.deepEqual(ids, []);
  assert.equal(root.entries.length, 1);
  checks++;
}
{
  const { board, make } = fixture(), root = beginRoot(parent), old = make();
  assert.throws(() => applyOwned(root, board, parent, origin, () => old), /receipt/);
  assert.equal(root.entries.length, 0);
  assert.equal(applyOwned(root, board, parent, origin, () => undefined), undefined);
  assert.equal(root.anchor, null);
  checks++;
}
for (const mode of ['tag', 'duplicate', 'forgedPlan', 'differentRoot', 'sourceEpoch', 'targetId', 'badPlan', 'badOccurrence', 'wrongPolicy', 'currentEpoch', 'application', 'copiedTag']) {
  const { board, make } = fixture(), root = beginRoot(parent), e = applyOwned(root, board, parent, origin, () => make())!, plan = captureForMove(root, board, parent, origin);
  let to = arrived, retention: Retention = 'sameSkill';
  if (mode === 'tag')
    board.ownership[e.id].anchor++;
  if (mode === 'duplicate')
    root.entries.push(structuredClone(root.entries[0]));
  if (mode === 'forgedPlan')
    plan.effects.push(999);
  if (mode === 'differentRoot')
    plan.anchor = (plan.anchor ?? 0) + 1;
  if (mode === 'sourceEpoch')
    plan.root.source.epoch++;
  if (mode === 'targetId')
    to = { ...arrived, cardId: 'other' };
  if (mode === 'badPlan')
    plan.effects = null as unknown as number[];
  if (mode === 'badOccurrence')
    plan.from = null as unknown as Occurrence;
  if (mode === 'wrongPolicy')
    retention = 'area';
  if (mode === 'currentEpoch')
    board.ownership[e.id].current!.epoch++;
  if (mode === 'application')
    board.ownership[e.id].application.cardId = 'wrong';
  if (mode === 'copiedTag') {
    board.effects.push({ ...e, id: 99 });
    board.ownership[99] = structuredClone(board.ownership[e.id]);
  }
  assert.throws(() => settleMove(root, board, parent, plan, { moved: true, from: origin, to, retention }), /receipt/);
  checks++;
}
// Parked parent keeps immutable applications; child area carry advances live tags.
for (const childReset of [false, true]) {
  const { board, make } = fixture(), child: Root = { ...structuredClone(parent), kind: 'invoke' }, a = beginRoot(parent), b = beginRoot(child), from = { ...origin, area: 'battle' };
  const ea = applyOwned(a, board, parent, from, () => make())!, eb = applyOwned(b, board, child, from, () => make())!;
  const childTo = { ...from, epoch: 4, area: childReset ? 'warp' : 'combo' };
  const saved = structuredClone({ a, b, board });
  assert.deepEqual(move(saved.b, saved.board, child, from, childTo), childReset ? [] : [eb.id]);
  assert.deepEqual(saved.a.entries[0].target, from);
  const parentTo = { ...childTo, epoch: 5, area: 'unison' };
  // Combo->Unison requires SAME-SKILL entitlement, so child's effect is not adopted.
  const carried = move(saved.a, saved.board, parent, childTo, parentTo);
  assert.deepEqual(carried, childReset ? [] : [ea.id]);
  if (!childReset) {
    assert.equal(saved.board.effects.length, 1);
    assert.equal(saved.board.effects[0].id, ea.id);
    assert.deepEqual(saved.board.ownership[saved.board.effects[0].id].current, parentTo);
  }
  assert.deepEqual(captureForMove(saved.b, saved.board, child, parentTo).effects, []);
  checks++;
}
// A retired live effect during Stage A is inert even though cleanup is unchanged.
{
  const { board, make } = fixture(), root = beginRoot(parent), e = applyOwned(root, board, parent, origin, () => make())!, to = { ...arrived, area: 'warp' };
  const plan = captureForMove(root, board, parent, origin);
  settleMove(root, board, parent, plan, { moved: true, from: origin, to, retention: 'reset' });
  assert.equal(board.ownership[e.id].current, null);
  assert.deepEqual(captureForMove(root, board, parent, to).effects, []);
  checks++;
}
// A stale authoritative tag is refused, rather than rediscovered by card id.
{
  const { board, make } = fixture(), root = beginRoot(parent);
  applyOwned(root, board, parent, origin, () => make());
  assert.throws(() => captureForMove(root, board, parent, { ...origin, epoch: 5 }), /receipt/);
  checks++;
}
// Copying a public effect to a new ID never copies private ownership.
{
  const { board, make } = fixture(), root = beginRoot(parent), e = applyOwned(root, board, parent, origin, () => make())!;
  board.effects.push({ ...e, id: 99 });
  assert.equal(board.ownership[99], undefined);
  assert.deepEqual(captureForMove(root, board, parent, origin).effects, [e.id]);
  const event = { type: 'effect', effect: e }, before = JSON.stringify(event);
  move(root, board, parent, origin, arrived);
  assert.equal(JSON.stringify(event), before);
  assert.equal(JSON.stringify(event).includes('application'), false);
  checks++;
}
// Identically named private areas with distinct holders are different areas.
{
  const { board, make } = fixture(), root = beginRoot(parent), from = { ...origin, area: 'hand' }, e = applyOwned(root, board, parent, from, () => make())!;
  const to = { ...from, holder: 'p2', epoch: 4 };
  assert.equal(areaCarries(from.area, to.area, false), false);
  assert.deepEqual(move(root, board, parent, from, to), []);
  assert.equal(board.effects.some(x => x.id === e.id), false);
  checks++;
}
console.log(JSON.stringify({ checks, scope: 'R495 production receipt-helper mechanisms; simulated cleanup only in these cases' }));
