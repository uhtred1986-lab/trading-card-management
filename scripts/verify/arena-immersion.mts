import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { actionCues, actionSequence, combatMoment, cueMarkers, CUE_WINDOW_MS, soundCue, SYNTH_FALLBACK } from '../../src/lib/arena/immersion/events';
import { ACTION_CUE_IDS, type ActionCueId } from '../../src/lib/arena/immersion/types';
import { ACTION_FIXTURES, fixtureCardOf } from '../../src/lib/arena/immersion/action-fixtures';
import { bannerDuration, bannerPlan, bannerPose, BANNER_MAX_MS } from '../../src/lib/arena/immersion/banner';
import { validateSoundCatalog, type SoundCatalog } from '../../src/lib/arena/immersion/sound-catalog';
import type { NumberedBeat } from '../../src/lib/arena/beats';
import type { CardView } from '../../src/lib/arena/view';
const card = {id:'blocker',cardId:'unknown',name:'Unmapped',hidden:false,flipped:false} as CardView;
const seen:string[]=[];const lookup=(id:string)=>{seen.push(id);return card};
assert.equal(combatMoment(7,{t:'block',n:1,guard:'original',by:'blocker'},lookup,{})?.outcome,'block');
assert.deepEqual(seen,['blocker']);
assert.equal(combatMoment(7,{t:'clash',n:2,attacker:'a',guard:'g',attackPower:1,guardPower:2,hit:false},lookup,{})?.outcome,'repelled');
assert.equal(combatMoment(7,{t:'attack',n:3,attacker:'a',target:'g'},()=>({...card,hidden:true}),{})?.character,null);
assert.equal(combatMoment(7,{t:'negated',n:4},()=>{throw Error('negate needs no identity')},{})?.character,null);
assert.equal(combatMoment(7,{t:'draw',n:5,player:'p1',card:null},lookup,{}),null);
assert.equal(soundCue({t:'over',n:6,winner:null,reason:'draw'},'p1'),null);
assert.equal(soundCue({t:'clash',n:7,attacker:'a',guard:'g',hit:true,attackPower:2,guardPower:1},'p1'),'hit');
console.log('Immersion: actual blocker, resolved result, hidden/unknown fallback and cue routing pass.');
assert.equal(combatMoment(7,{t:'clash',n:8,attacker:'a',guard:'g',hit:true,attackPower:2,guardPower:1},lookup,{})?.caption,undefined,'hit does not invent KO or damage');
assert.equal(combatMoment(7,{t:'damage',n:9,player:'p2',amount:2,critical:true,cards:[]},lookup,{})?.caption,'−2 LIFE · CRITICAL');
assert.equal(combatMoment(7,{t:'ko',n:10,card:'g',owner:'p2'},lookup,{})?.caption,'KO');

// ── #1103: the character-action sequence contract ─────────────────────────────────────────────
const fixture = (name: string) => ACTION_FIXTURES.find((f) => f.name === name)!;
type TechniqueOf = Parameters<typeof actionSequence>[2]['techniqueOf'];
const run = (name: string, durationMs = 1200, techniqueOf?: TechniqueOf) => {
  const f = fixture(name);
  return f.beats.map((beat) => actionSequence(9, beat, { cardOf: fixtureCardOf(f), art: f.art, viewer: f.viewer, durationMs, techniqueOf }));
};
for (const f of ACTION_FIXTURES) {
  assert.deepEqual(run(f.name).map((s) => s?.markers.map((m) => m.cue) ?? []), f.cues, `${f.name}: cues per beat`);
  // An attack never sounds a result; a result only comes from its own beat.
  const attackCues = actionCues(f.beats[0], f.viewer);
  assert.ok(!attackCues.some((c) => ['impact.hit', 'damage', 'ko', 'reaction.repel'].includes(c)), `${f.name}: attack infers nothing`);
}
// Consumed event key: match id + numbered beat, same as combatMoment.
assert.equal(run('attack-hit-ko')[1]?.key, '9:2');
// Face mapping: the reviewed leader front resolves its character; the face is exactly id + face + name.
const [hitAttack, hitClash, hitKo] = run('attack-hit-ko');
assert.equal(hitAttack?.character?.id, 'goku');
assert.deepEqual(hitAttack?.face, { cardId: 'BT1-056', name: 'Son Goku', face: 'front' });
assert.equal(hitAttack?.role, 'attacker');
assert.equal(hitAttack?.neutral, null);
assert.equal(hitClash?.character?.id, 'vegeta', 'hit stages the guard');
assert.equal(hitKo?.staging, 'combat');
assert.equal(hitKo?.character?.id, 'vegeta', 'the fixture board still shows the KO card');
// Block: the actual blocker, unmapped → neutral with its reason.
const block = run('block')[1]!;
assert.equal(block.subject, 'p2-blocker');
assert.equal(block.role, 'defender');
assert.equal(block.neutral, 'unmapped');
// Negate and damage name no character.
assert.equal(run('negate')[1]?.neutral, 'no-subject');
assert.equal(run('attack-hit-damage')[2]?.neutral, 'no-subject');
// Hidden source: no face, character, technique or identity string anywhere in the sequence.
let asked = 0;
const hidden = run('hidden-source', 1200, () => { asked++; return 'Kamehameha'; })[0]!;
assert.equal(hidden.neutral, 'hidden');
assert.equal(hidden.face, null);
assert.equal(hidden.character, null);
assert.equal(hidden.technique, null);
assert.equal(asked, 0, 'a hidden face never reaches the technique resolver');
assert.ok(!/BT1-056|Son Goku|goku|sheet/i.test(JSON.stringify(hidden)), 'hidden sequence carries no identity');
// Face changed since the event: captured art disagrees with the current face.
{
  const f = fixture('repel');
  const changed = actionSequence(9, f.beats[1], { cardOf: fixtureCardOf(f), art: { 'p2-vegeta': { cardId: 'BT1-038', name: 'Vegeta, Other Form', imageUrl: null } }, viewer: 'p1', durationMs: 1200 });
  assert.equal(changed?.neutral, 'face-changed');
  assert.equal(changed?.character, null);
}
// Technique override: only through the resolver, only for a visible mapped face.
assert.equal(run('attack-hit-ko', 1200, (face, character) => (face.cardId === 'BT1-056' && character.id === 'goku' ? 'Approved technique' : null))[0]?.technique, 'Approved technique');
assert.equal(run('attack-hit-ko')[0]?.technique, null, 'no resolver, no technique');
// Cancelled sequence: the attacker leaves; the move is a motion receipt with its real source and destination and no sound.
const [cancelAttack, cancelMove] = run('cancelled');
assert.deepEqual(cancelAttack?.markers.map((m) => m.cue), ['attack.buildup', 'attack.release']);
assert.equal(cancelAttack?.neutral, 'unknown-card', 'the departed attacker is neutral, never guessed');
assert.equal(cancelMove?.staging, 'motion');
assert.deepEqual(cancelMove?.motion, { from: 'battle', to: 'drop' });
assert.deepEqual(cancelMove?.markers, []);
// Timings: presentation-relative, bounded by the beat, compressed (never extended) when the beat is short.
const full = cueMarkers(['attack.buildup', 'attack.release'], 1200);
assert.deepEqual(full.map((m) => [m.startMs, m.stopMs]), [[0, 300], [300, 900]]);
const short = run('cancelled', 450)[0]!;
assert.equal(short.durationMs, 450);
assert.ok(short.markers.every((m) => m.startMs <= m.stopMs && m.stopMs <= 450), 'markers stay inside a short beat');
assert.deepEqual(short.markers.map((m) => [m.startMs, m.stopMs]), [[0, 150], [150, 450]]);
assert.ok(cueMarkers(['impact.hit'], 0).every((m) => m.stopMs === 0), 'skip/step at zero length plays nothing');
// Sound-only beats never look a card up (a draw stays concealed).
assert.equal(actionSequence(9, { n: 1, t: 'draw', player: 'p1', card: 'x' }, { cardOf: () => { throw Error('draw needs no identity'); }, art: {}, viewer: 'p1', durationMs: 400 })?.markers[0]?.cue, 'card.draw');
// Turn and match cues by viewer; abandoned games are silent.
assert.deepEqual(actionCues({ n: 1, t: 'phase', phase: 'charge', player: 'p2', turn: 3 }, 'p1'), ['turn.opponent']);
assert.deepEqual(actionCues({ n: 1, t: 'over', winner: null, reason: 'draw', kind: 'draw' }, 'p1'), ['match.draw']);
assert.deepEqual(actionCues({ n: 1, t: 'over', winner: null, reason: 'left', kind: 'abandoned' }, 'p1'), []);
assert.deepEqual(actionCues({ n: 1, t: 'skill', card: 'c', label: 'Union-Potara', text: '', unread: false, owner: 'p1', inBattle: false }, 'p1'), ['skill.union']);
assert.deepEqual(actionCues({ n: 1, t: 'move', card: 'c', from: 'hand', to: 'energy', owner: 'p1' }, 'p1'), [], 'energy.charge is not wired');
assert.deepEqual(actionCues({ n: 1, t: 'move', card: 'c', from: 'battle', to: 'warp', owner: 'p1' }, 'p1'), [], 'zone.* is not wired');
// The legacy synth routing is unchanged: soundCue is the first contract cue's tone.
const legacy: [NumberedBeat, string | null][] = [
  [{ n: 1, t: 'attack', attacker: 'a', target: 'g' }, 'attack'],
  [{ n: 1, t: 'block', guard: 'g', by: 'b' }, 'block'],
  [{ n: 1, t: 'clash', attacker: 'a', guard: 'g', attackPower: 1, guardPower: 2, hit: false }, 'repelled'],
  [{ n: 1, t: 'negated' }, 'negated'],
  [{ n: 1, t: 'draw', player: 'p1', card: null }, 'draw'],
  [{ n: 1, t: 'move', card: 'c', from: 'hand', to: 'battle', owner: 'p1' }, 'play'],
  [{ n: 1, t: 'move', card: 'c', from: 'battle', to: 'drop', owner: 'p1' }, null],
  [{ n: 1, t: 'phase', phase: 'charge', player: 'p2', turn: 2 }, 'turn'],
  [{ n: 1, t: 'phase', phase: 'main', player: 'p2', turn: 2 }, null],
  [{ n: 1, t: 'over', winner: 'p1', reason: 'life' }, 'victory'],
  [{ n: 1, t: 'over', winner: 'p2', reason: 'life' }, 'defeat'],
  [{ n: 1, t: 'damage', player: 'p2', amount: 1, critical: false, cards: [] }, null],
  [{ n: 1, t: 'ko', card: 'g', owner: 'p2' }, null],
  [{ n: 1, t: 'flip', card: 'l' }, null],
];
for (const [beat, tone] of legacy) assert.equal(soundCue(beat, 'p1'), tone, `legacy tone for ${beat.t}`);
console.log('Immersion: action-sequence contract fixtures (attack→hit, block, negate, repel, hidden source, cancelled) pass.');

// ── #1104: the sound cue catalog ──────────────────────────────────────────────────────────────
const catalog = JSON.parse(readFileSync(new URL('../../src/lib/arena/immersion/sound-catalog.json', import.meta.url), 'utf8')) as SoundCatalog;
assert.deepEqual(validateSoundCatalog(catalog), []);
const SEED = ['card.focus', 'card.draw', 'card.play', 'energy.charge', 'energy.pay', 'action.unavailable', 'attack.windup', 'attack.melee', 'attack.ki', 'power.buildup', 'power.loop', 'beam.release', 'beam.sustain', 'impact.light', 'impact.heavy', 'impact.energy', 'block', 'negate', 'repel', 'damage', 'ko', 'dodge', 'skill.activate', 'skill.swap', 'skill.union', 'skill.evolve', 'leader.awaken', 'zone.drop', 'zone.warp', 'zone.return', 'turn.yours', 'turn.opponent', 'match.start', 'match.victory', 'match.defeat', 'match.draw'];
assert.deepEqual(catalog.cues.map((c) => c.cueId).sort(), [...SEED].sort(), 'every seed row, nothing else');
for (const id of ['dodge', 'zone.drop', 'zone.warp', 'zone.return', 'energy.charge', 'match.start']) assert.equal(catalog.cues.find((c) => c.cueId === id)?.trigger, 'unsupported', `${id} is catalogued, not wired`);
// Every contract cue has at least one catalog sound; every supported catalog cue names a contract cue (validator).
const covered = new Set(catalog.cues.flatMap((c) => (c.contractCue ? [c.contractCue] : [])));
for (const cue of ACTION_CUE_IDS) assert.ok(covered.has(cue), `contract cue ${cue} has a catalog sound`);
assert.ok(Object.keys(SYNTH_FALLBACK).every((cue) => (ACTION_CUE_IDS as readonly string[]).includes(cue)));
assert.equal(Object.keys(CUE_WINDOW_MS).length, ACTION_CUE_IDS.length);
// The validator catches the mistakes it exists for.
const broken = structuredClone(catalog);
broken.cues[0] = { ...broken.cues[0], trigger: 'supported', contractCue: 'not.a.cue' as ActionCueId };
broken.cues[1] = { ...broken.cues[1], prompt: 'A card slide with music.' };
broken.cues[2] = { ...broken.cues[2], playback: { durationSec: 3, loop: false, stopAtMarker: false }, generatedDurationSec: 3 };
const problems = validateSoundCatalog(broken);
assert.ok(problems.some((p) => p.includes('card.focus') && p.includes('contract cue')), 'unknown contract cue');
assert.ok(problems.some((p) => p.includes('card.draw') && p.includes('speech')), 'prompt without exclusions');
assert.ok(problems.some((p) => p.includes('card.play') && p.includes('window')), 'clip longer than its window');
// The readable export repeats every cue and its exact prompt.
const doc = readFileSync(new URL('../../docs/arena-sound-prompts.md', import.meta.url), 'utf8');
for (const cue of catalog.cues) {
  assert.ok(doc.includes(`### \`${cue.cueId}\``), `docs/arena-sound-prompts.md lists ${cue.cueId}`);
  assert.ok(doc.includes(cue.prompt), `docs/arena-sound-prompts.md has ${cue.cueId}'s exact prompt`);
}
console.log(`Immersion: sound catalog (${catalog.cues.length} cues, ${catalog.cues.filter((c) => c.trigger === 'supported').length} supported) is valid and mirrored in the docs.`);

// ── #1105: the one character banner route, planned from the contract sequence ────────────────
{
  const plans = (name: string, durationMs = 1200, techniqueOf?: TechniqueOf) => {
    const f = fixture(name);
    return f.beats.map((beat) => bannerPlan(actionSequence(9, beat, { cardOf: fixtureCardOf(f), art: f.art, viewer: f.viewer, durationMs, techniqueOf }), beat));
  };
  // Attack: only the source is staged; it winds up until the buildup marker and releases on the release marker.
  const [atk, hit, ko] = plans('attack-hit-ko');
  assert.equal(atk?.kind, 'attack');
  assert.equal(atk?.role, 'attacker');
  assert.equal(atk?.pose, 'attack');
  assert.equal(atk?.character?.id, 'goku');
  assert.equal(atk?.durationMs, BANNER_MAX_MS, 'capped at 1100 ms');
  assert.deepEqual([atk?.windupMs, atk?.contactMs], [300, 300], 'buildup ends and release starts on the contract markers');
  // A short beat compresses the markers, never stretches the banner.
  const quick = plans('attack-hit-ko', 460)[0]!;
  assert.equal(quick.durationMs, 460);
  assert.deepEqual([quick.windupMs, quick.contactMs], [153, 153]);
  assert.ok(quick.markers.every((m) => m.stopMs <= 460));
  // Resolved hit: the guard recoils from its own clash beat; KO is its own beat.
  assert.deepEqual([hit?.kind, hit?.role, hit?.pose, hit?.character?.id, hit?.contactMs], ['hit', 'defender', 'hit', 'vegeta', 0]);
  assert.deepEqual([ko?.kind, ko?.pose, ko?.label], ['ko', 'hit', 'KO']);
  // Repel braces and never says HIT.
  const repel = plans('repel')[1]!;
  assert.deepEqual([repel.kind, repel.pose, repel.character?.id, repel.label], ['repelled', 'guard', 'vegeta', 'REPELLED']);
  // Block: the actual blocker reacts; unmapped → neutral with the contract's reason, no default character.
  const blocked = plans('block')[1]!;
  assert.deepEqual([blocked.kind, blocked.role, blocked.character, blocked.pose, blocked.neutral], ['block', 'defender', null, null, 'unmapped']);
  // Negate and damage name no card: neutral art and the exact receipt.
  const negated = plans('negate')[1]!;
  assert.deepEqual([negated.kind, negated.role, negated.character, negated.neutral, negated.label], ['negated', null, null, 'no-subject', 'NEGATED']);
  const damage = plans('attack-hit-damage')[2]!;
  assert.deepEqual([damage.kind, damage.neutral, damage.label], ['damage', 'no-subject', '−2 LIFE']);
  // Hidden source: neutral, and nothing in the plan names the card.
  const hiddenPlan = plans('hidden-source', 1200, () => 'Kamehameha')[0]!;
  assert.equal(hiddenPlan.neutral, 'hidden');
  assert.ok(!/BT1-056|Son Goku|goku|sheet|Kamehameha/i.test(JSON.stringify(hiddenPlan)), 'hidden plan carries no identity');
  // A departed attacker stays neutral; the move after it is motion staging, not a combat banner.
  const [gone, moved] = plans('cancelled');
  assert.equal(gone?.neutral, 'unknown-card');
  assert.equal(moved, null, 'motion is not a combat banner');
  // Leader and Battle Card attacks take the same route and the same pose rule.
  {
    const f = fixture('attack-hit-ko');
    const cabba = { id: 'p1-cabba', cardId: 'BT1-014', name: 'Saiyan Cabba', hidden: false, flipped: false } as CardView;
    const battle = bannerPlan(actionSequence(9, { n: 4, t: 'attack', attacker: cabba.id, target: 'p2-vegeta' }, { cardOf: (id) => (id === cabba.id ? cabba : fixtureCardOf(f)(id)), art: {}, viewer: 'p1', durationMs: 900 }), null)!;
    assert.deepEqual([battle.kind, battle.role, battle.pose, battle.character?.id], ['attack', 'attacker', 'attack', 'cabba']);
  }
  // Poses come only from the manifest: a sheet without the pose stays neutral, never a substitute pose.
  {
    const f = fixture('attack-hit-ko');
    const noAttack = bannerPlan(actionSequence(9, f.beats[0], { cardOf: fixtureCardOf(f), art: f.art, viewer: 'p1', durationMs: 900 }), f.beats[0], { posesOf: () => ['guard', 'hit'] })!;
    assert.deepEqual([noAttack.character, noAttack.pose, noAttack.neutral], [null, null, 'unmapped']);
  }
  // The defender never reacts to an attack declaration; the attacker never takes a reaction pose.
  assert.equal(bannerPose('attack', 'defender'), null);
  assert.equal(bannerPose('hit', 'attacker'), null);
  assert.equal(bannerPose('negated', null), null);
  // Technique labels only the attacker's mapped face.
  assert.equal(plans('attack-hit-ko', 1200, () => 'Approved technique')[0]?.label, 'Approved technique');
  assert.equal(plans('attack-hit-ko', 1200, () => 'Approved technique')[1]?.label, 'HIT!', 'a reaction keeps its own word');
  // Duration: the beat's own length, capped; a non-finite pace falls back.
  assert.equal(bannerDuration(5000, 460), 1100);
  assert.equal(bannerDuration(Number.NaN, 460), 460);
  assert.equal(bannerDuration(0, 460), 1);
  console.log('Immersion: banner plans (buildup/release markers, actual reactions, manifest poses, neutral reasons, one route) pass.');
}
