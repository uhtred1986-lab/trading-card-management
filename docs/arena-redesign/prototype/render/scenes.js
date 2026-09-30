// Scene setups for the design references. Each builds a game state by hand and renders it.
function U(s, k, extra) { return Object.assign({ uid: s.n++, k, rested: false, fresh: false, anim: '', fx: '' }, extra || {}); }
function H(s, keys) { return keys.map((k) => ({ uid: s.n++, k, anim: '' })); }
function base(s) {
  s.turn = 3; s.active = 'you'; s.phase = 'main'; s.banner = null; s.aiStage = null; s.attacker = null;
  s.you.life = 3; s.ai.life = 2; s.you.energy = 4; s.you.used = 1; s.you.charged = true; s.you.chargeDone = true;
  s.ai.energy = 4; s.ai.used = 0;
  s.you.board = [U(s, 'storm'), U(s, 'guard', { fresh: true })];
  s.ai.board = [U(s, 'lancer', { rested: true }), U(s, 'sage')];
  s.you.hand = H(s, ['lancer', 'ember', 'sage', 'comet', 'storm']);
  s.ai.hand = H(s, ['ember', 'guard', 'comet', 'sage']);
  s.you.deck.length = 15; s.ai.deck.length = 14; s.you.drop = 2; s.ai.drop = 3;
  s.ribbon = { text: 'You play Iron Guardian — 17,000 power.', side: 'you', n: 3 };
  s.log = [
    { id: 1, turn: 3, side: 'you', text: 'You play Iron Guardian — 17,000 power.' },
    { id: 2, turn: 3, side: 'you', text: 'You charge Comet Dancer — 3 energy active.' },
    { id: 3, turn: 3, side: 'you', text: 'Your turn. You draw Nova Lancer.' },
    { id: 4, turn: 2, side: 'ai', text: 'Claude ends its turn.' },
    { id: 5, turn: 2, side: 'you', text: 'You hold — the attack is deflected.' },
    { id: 6, turn: 2, side: 'ai', text: 'Claude attacks your leader with Nova Lancer!' },
    { id: 7, turn: 2, side: 'ai', text: 'Claude plays Nova Lancer — 20,000 power.' }
  ];
  s.beats = [
    { i: 41, turn: 3, side: 'you', kind: 'play', detail: 'Iron Guardian (cost 2)', legal: '6', why: '' },
    { i: 40, turn: 3, side: 'you', kind: 'charge', detail: 'Comet Dancer → energy (4)', legal: '7', why: '' },
    { i: 39, turn: 3, side: 'you', kind: 'turn', detail: 'start of turn 3 · draw Nova Lancer', legal: '—', why: '' },
    { i: 38, turn: 2, side: 'ai', kind: 'end', detail: 'end turn', legal: '1', why: 'no ready attackers left' },
    { i: 37, turn: 2, side: 'you', kind: 'held', detail: '20,000 vs 25,000 → deflected', legal: '—', why: '' },
    { i: 36, turn: 2, side: 'you', kind: 'combo', detail: 'Azure Sage (+10,000)', legal: '—', why: '' },
    { i: 35, turn: 2, side: 'ai', kind: 'attack', detail: 'Nova Lancer (20,000) → your leader (15,000)', legal: '—', why: 'strongest ready attacker; leader is the win condition' },
    { i: 34, turn: 2, side: 'ai', kind: 'play', detail: 'Nova Lancer (cost 3)', legal: '4', why: 'highest cost it can afford' },
    { i: 33, turn: 2, side: 'ai', kind: 'charge', detail: 'Ember Vanguard → energy (4)', legal: '5', why: 'lowest-power card; keeps 2+ in hand' }
  ];
  s.flagged = [2];
}
const byK = (arr, k) => arr.find((x) => x.k === k);
window.SCENES = {
  '01-board-your-turn': { freeze: 1200, setup(s, L) { base(s); if (L === 'desk') s.hover = { zone: 'hand', side: 'you', uid: byK(s.you.hand, 'lancer').uid }; } },
  '02-turn-banner': { freeze: 520, setup(s) { base(s); s.active = 'ai'; s.phase = 'banner'; s.banner = { side: 'ai', text: "CLAUDE'S TURN", sub: 'Turn 3', n: 1 }; s.ribbon = { text: "Claude's turn. Claude draws a card.", side: 'ai', n: 4 }; } },
  '03-charge-phase': { freeze: 1200, setup(s, L) { base(s); s.you.charged = false; s.you.chargeDone = false; s.you.used = 0; s.you.energy = 3; s.you.board[1].fresh = false; s.ribbon = { text: 'Your turn. You draw Nova Lancer.', side: 'you', n: 5 }; } },
  '04-drag-to-play': {
    freeze: 1200, setup(s) { base(s); },
    post(L) {
      const r = DC.rect('.row.me .slot'); const lan = byK(comp.state.you.hand, 'lancer');
      DC.S((s) => { s.drag = { uid: lan.uid, x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2 + (L === 'desk' ? 40 : 30)), over: 'board' }; });
    }
  },
  '05-refusal-energy-short': {
    freeze: 1200, setup(s, L) {
      base(s); s.you.used = 2; const lan = byK(s.you.hand, 'lancer');
      s.refusal = { text: 'Nova Lancer costs 3 — 2 energy active, 1 short. Your rested energy stands back up next turn.', n: 2 };
      if (L === 'desk') { s.hover = { zone: 'hand', side: 'you', uid: lan.uid }; s.sel = { zone: 'hand', side: 'you', uid: lan.uid }; }
      else s.sel = { zone: 'hand', side: 'you', uid: lan.uid, inspect: true };
    }
  },
  '06-review-cards-in-play': {
    freeze: 1200, setup(s, L) {
      base(s); const sage = byK(s.ai.board, 'sage');
      if (L === 'desk') { s.hover = { zone: 'board', side: 'ai', uid: sage.uid }; s.tab = 'play'; }
      else s.sel = { zone: 'board', side: 'ai', uid: sage.uid, inspect: true };
    }
  },
  '07-clash-defend': {
    freeze: 1200, setup(s) {
      base(s); s.active = 'ai'; s.phase = 'defend'; s.aiStage = 'attack'; const lan = s.ai.board[0]; lan.rested = true;
      s.clash = { atkSide: 'ai', aRef: lan.uid, dRef: 'L', aK: 'lancer', dK: 'lead_you', aPow: 20000, dPow: 15000, combos: [], stage: 'defend', result: null };
      s.defendPick = [byK(s.you.hand, 'ember').uid];
      s.ribbon = { text: 'Claude attacks your leader with Nova Lancer!', side: 'ai', n: 6 };
    }
  },
  '08-clash-break-through': {
    freeze: 330, setup(s) {
      base(s); s.phase = 'clash'; const st = s.you.board[0]; st.rested = true;
      s.clash = { atkSide: 'you', aRef: st.uid, dRef: 'L', aK: 'storm', dK: 'lead_ai', aPow: 15000, dPow: 15000, combos: [], stage: 'result', result: 'hit' };
      s.flash = 1; s.ribbon = { text: "Storm Striker attacks Claude's leader!", side: 'you', n: 7 };
    }
  },
  '09-life-break': {
    freeze: 260, setup(s) {
      base(s); s.you.board[0].rested = true; s.ai.life = 1; s.ai.lostAt = 1; s.ai.leader.fx = 'boom'; s.shake = 1;
      s.float = { text: '−1 LIFE', side: 'ai', n: 9 }; s.ribbon = { text: 'Direct hit! Claude is down to 1 life.', side: 'you', n: 8 };
    }
  },
  '10-victory': { freeze: 900, setup(s) { base(s); s.ai.life = 0; s.winner = 'you'; s.phase = 'over'; s.turn = 5; s.ribbon = { text: 'Direct hit! Claude is down to 0 life.', side: 'you', n: 10 }; } },
  '11-admin-debug-drawer': { freeze: 1200, setup(s) { base(s); s.adminOpen = true; } },
  '12-night-skin': { freeze: 1200, setup(s, L) { base(s); s.skin = 'night'; if (L === 'desk') s.hover = { zone: 'board', side: 'you', uid: s.you.board[0].uid }; } }
};
