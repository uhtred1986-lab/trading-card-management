class Component extends DCLogic {
  C = {
    lead_you: { name: 'Crimson Ascendant', cost: 0, power: 15000, combo: 0, hue: 22, g: 'sun', text: 'Your leader. Attacks once per turn; four life.' },
    lead_ai: { name: 'Void Tactician', cost: 0, power: 15000, combo: 0, hue: 252, g: 'ring', text: "Claude's leader. Attacks once per turn; four life." },
    ember: { name: 'Ember Vanguard', cost: 1, power: 10000, combo: 5000, hue: 12, g: 'flame', text: 'Cheap opener. Combo +5,000 when defending.' },
    comet: { name: 'Comet Dancer', cost: 1, power: 8000, combo: 10000, hue: 328, g: 'comet', text: 'Weak on the board, strong in a combo: +10,000.' },
    storm: { name: 'Storm Striker', cost: 2, power: 15000, combo: 5000, hue: 205, g: 'bolt', text: 'Matches a leader blow for blow. Ties go to the attacker.' },
    sage: { name: 'Azure Sage', cost: 2, power: 12000, combo: 10000, hue: 172, g: 'eye', text: 'Combo +10,000 — often worth more in hand than on the board.' },
    guard: { name: 'Iron Guardian', cost: 2, power: 17000, combo: 5000, hue: 42, g: 'shield', text: 'A sturdy body for the battle area.' },
    lancer: { name: 'Nova Lancer', cost: 3, power: 20000, combo: 5000, hue: 280, g: 'star', text: 'Top end. Breaks through any leader that does not combo.' }
  };
  P = {
    sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 1.5v3M12 19.5v3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M1.5 12h3M19.5 12h3M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1',
    ring: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM3 12h5M16 12h5',
    flame: 'M12 2.5c1 4 5.5 5.5 5.5 11a5.5 5.5 0 0 1-11 0c0-3.2 2-4.4 2.2-6.6 1 1.2 2 2 3.2 2.2.2-2.4-.8-4.4.1-6.6z',
    comet: 'M3.5 20.5 13 11M14.2 9.8a4 4 0 1 0 5.66-5.66 4 4 0 0 0-5.66 5.66zM4.5 13.5l4.5 1M10.5 19.5l-1-4.5',
    bolt: 'M13 2 4.5 13.5h6.5L10 22l8.5-11.5H12z',
    eye: 'M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    shield: 'M12 2.5l7.5 3v6c0 4.8-3.2 8.3-7.5 10-4.3-1.7-7.5-5.2-7.5-10v-6z',
    star: 'M12 2.5l2.8 6.3 6.9.6-5.2 4.6 1.6 6.8L12 17.3l-6.1 3.5 1.6-6.8-5.2-4.6 6.9-.6z'
  };
  POOL = ['ember', 'ember', 'ember', 'comet', 'comet', 'storm', 'storm', 'storm', 'sage', 'sage', 'guard', 'guard', 'guard', 'lancer', 'lancer', 'lancer'];
  timers = [];
  state = this.makeGame(20260930, (this.props && this.props.skin) || 'sky');

  // ---------- setup ----------
  makeGame(seed, skin) {
    const s = { seed, rng: seed | 0, n: 1, turn: 0, active: 'you', phase: 'start', speed: 1, skin: skin || 'sky', tab: 'play', hover: null, pressing: null, drag: null, sel: null, attacker: null, clash: null, banner: null, flash: 0, shake: 0, float: null, ribbon: { text: 'Match start — you go first.', side: 'sys', n: 0 }, refusal: null, log: [], beats: [], winner: null, menuOpen: false, adminOpen: false, logOpen: false, aiStage: null, defendPick: [], flagged: [] };
    s.you = this.makeSide(s, 'lead_you');
    s.ai = this.makeSide(s, 'lead_ai');
    return s;
  }
  rand(s) { s.rng = (s.rng + 0x6D2B79F5) | 0; let t = s.rng; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  makeSide(s, lead) {
    const deck = [];
    for (let i = 0; i < 22; i++) deck.push(this.POOL[Math.floor(this.rand(s) * this.POOL.length)]);
    const p = { leader: { k: lead, rested: false, fx: '' }, life: 4, lifeMax: 4, deck, hand: [], board: [], energy: 2, used: 0, charged: false, chargeDone: false, drop: 0, chipNew: null, lostAt: null };
    for (let i = 0; i < 5; i++) p.hand.push({ uid: s.n++, k: p.deck.pop(), anim: '' });
    return p;
  }
  componentDidMount() { this.later(500, () => this.startTurn('you', true)); }
  componentWillUnmount() { this.dead = true; this.timers.forEach((t) => clearTimeout(t)); }

  // ---------- plumbing ----------
  upd(fn) { this.setState((prev) => { const s = JSON.parse(JSON.stringify(prev)); fn(s); return s; }); }
  later(ms, fn) { const sp = this.state.speed; const d = sp === 0 ? 60 : ms / sp; this.laterRaw(d, fn); }
  laterRaw(ms, fn) { const t = setTimeout(() => { if (!this.dead) fn(); }, ms); this.timers.push(t); if (this.timers.length > 120) this.timers = this.timers.slice(-60); }
  fmt(n) { return Number(n).toLocaleString('en-US'); }
  say(s, side, text) { s.ribbon = { text, side, n: s.n++ }; s.log.unshift({ id: s.n++, turn: s.turn, side, text }); if (s.log.length > 40) s.log.length = 40; }
  beat(s, kind, side, detail, legal, why) { s.beats.unshift({ i: s.n++, turn: s.turn, side, kind, detail, legal: legal == null ? '—' : String(legal), why: why || '' }); if (s.beats.length > 80) s.beats.length = 80; }
  clearAnims(s) { ['you', 'ai'].forEach((k) => { s[k].hand.forEach((h) => { h.anim = ''; }); s[k].board.forEach((u) => { u.anim = ''; }); s[k].chipNew = null; }); }
  nameOf(s, side, ref) { const p = s[side]; if (ref === 'L') return this.C[p.leader.k].name; const u = p.board.find((b) => b.uid === ref); return u ? this.C[u.k].name : 'That card'; }

  // ---------- rules (player side) ----------
  moves(s) {
    if (s.active !== 'you' || s.phase !== 'main' || s.winner) return 0;
    const p = s.you; const av = p.energy - p.used; let n = 0;
    p.hand.forEach((h) => { if (this.C[h.k].cost <= av && p.board.length < 4) n++; });
    if (!p.charged && p.hand.length) n++;
    if (!p.leader.rested) n++;
    p.board.forEach((u) => { if (!u.rested && !u.fresh) n++; });
    return n;
  }
  whyNotPlay(s, uid) {
    const p = s.you; const h = p.hand.find((x) => x.uid === uid);
    if (!h) return 'That card is no longer in your hand.';
    const c = this.C[h.k];
    if (s.winner) return 'The match is over.';
    if (s.active !== 'you') return "It's Claude's turn — you can inspect cards, not play them.";
    if (s.phase !== 'main') return 'Wait for the current step to finish.';
    const av = p.energy - p.used;
    if (c.cost > av) return `${c.name} costs ${c.cost} — ${av} energy active, ${c.cost - av} short.` + (p.charged ? ' Your rested energy stands back up next turn.' : ' Charge a card to gain one.');
    if (p.board.length >= 4) return 'Your battle area is full — four cards is the limit.';
    return '';
  }
  chargePhase(s) { return s.active === 'you' && s.phase === 'main' && !s.winner && !s.you.charged && !s.you.chargeDone && s.attacker == null; }
  skipCharge() { if (!this.chargePhase(this.state)) return; this.upd((x) => { x.you.chargeDone = true; x.sel = null; this.say(x, 'you', 'You skip charging this turn.'); this.beat(x, 'charge', 'you', 'skipped', null); }); }
  whyNotCharge(s) {
    if (s.winner) return 'The match is over.';
    if (s.active !== 'you') return "It's Claude's turn.";
    if (s.phase !== 'main') return 'Wait for the current step to finish.';
    if (s.you.charged) return 'You have already charged this turn — once per turn.';
    return '';
  }
  refuse(text) {
    this.upd((x) => { x.refusal = { text, n: x.n++ }; });
    this.laterRaw(3200, () => this.upd((x) => { if (x.refusal && x.refusal.text === text) x.refusal = null; }));
  }

  // ---------- card review ----------
  isDesk() { return (this.props.layout ?? '__LAYOUT__') === 'desk'; }
  eatTap() { if (this.lpFired) { this.lpFired = false; return true; } return false; }
  kOf(s, r) { if (r.zone === 'hand') { const h = s.you.hand.find((x) => x.uid === r.uid); return h ? h.k : null; } const p = s[r.side]; if (r.uid === 'L') return p.leader.k; const u = p.board.find((b) => b.uid === r.uid); return u ? u.k : null; }
  seqOf(s, ref) {
    if (ref.zone === 'hand') return s.you.hand.map((h) => ({ zone: 'hand', side: 'you', uid: h.uid }));
    const a = [{ zone: 'board', side: 'ai', uid: 'L' }];
    s.ai.board.forEach((u) => a.push({ zone: 'board', side: 'ai', uid: u.uid }));
    a.push({ zone: 'board', side: 'you', uid: 'L' });
    s.you.board.forEach((u) => a.push({ zone: 'board', side: 'you', uid: u.uid }));
    return a;
  }
  nav(d) {
    this.upd((x) => { if (!x.sel) return; const seq = this.seqOf(x, x.sel); const i = seq.findIndex((r) => r.side === x.sel.side && r.uid === x.sel.uid && r.zone === x.sel.zone); if (i < 0 || !seq.length) return; const j = (i + d + seq.length) % seq.length; x.sel = Object.assign({}, seq[j], { inspect: true }); });
  }
  openReview() { this.upd((x) => { x.sel = { zone: 'board', side: 'ai', uid: 'L', inspect: true }; x.menuOpen = false; x.logOpen = false; }); }
  pressStart(ref, key, e) {
    if (this.isDesk() || (e && e.button === 2)) return;
    clearTimeout(this.lpT); this.lpFired = false;
    this.setState({ pressing: key });
    this.lpT = setTimeout(() => {
      if (this.dead) return;
      this.lpFired = true;
      this.upd((x) => { x.pressing = null; x.sel = Object.assign({}, ref, { inspect: true }); x.menuOpen = false; x.logOpen = false; });
      try { if (navigator.vibrate) navigator.vibrate(12); } catch (err) { }
    }, 420);
  }
  pressEnd() { clearTimeout(this.lpT); if (this.state.pressing != null) this.setState({ pressing: null }); }
  hoverOn(ref) { const h = this.state.hover; if (h && h.zone === ref.zone && h.side === ref.side && h.uid === ref.uid) return; this.setState({ hover: ref }); }
  pin(ref) { this.upd((x) => { x.sel = Object.assign({}, ref, { inspect: true }); x.hover = ref; }); }
  swStart(e) { this.swX = e.clientX; this.swY = e.clientY; }
  swEnd(e) {
    if (this.swX == null || this.isDesk()) return;
    const dx = e.clientX - this.swX, dy = e.clientY - this.swY; this.swX = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) { this.swipedAt = Date.now(); this.nav(dx < 0 ? 1 : -1); }
    else if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5) { this.swipedAt = Date.now(); this.closeSheet(); }
  }
  inspector(s, ref, desk) {
    const C = this.C; const f = (n) => this.fmt(n);
    const side = ref.side; const p = s[side]; if (!p) return null; const mine = side === 'you';
    const main = s.active === 'you' && s.phase === 'main' && !s.winner;
    const G = (fn) => () => { if (Date.now() - (this.swipedAt || 0) < 350) return; fn(); };
    let k; let owner = ''; const chips = []; let stats = []; let rule = ''; let ruleBad = false; const actions = []; let isL = false;
    if (ref.zone === 'hand') {
      const h = p.hand.find((x) => x.uid === ref.uid); if (!h) return null; k = h.k; const c = C[k];
      const why = this.whyNotPlay(s, h.uid); const chWhy = this.whyNotCharge(s); const av = p.energy - p.used; const short = c.cost - av;
      owner = 'Your hand';
      stats = [{ k: 'Cost', v: String(c.cost) }, { k: 'Power', v: f(c.power) }, { k: 'Combo', v: '+' + f(c.combo) }];
      if (s.phase === 'defend') chips.push({ label: `Combo +${f(c.combo)} now`, cls: 'chip blue' });
      else if (!why) chips.push({ label: 'Playable', cls: 'chip ok' });
      else if (s.active === 'you' && short > 0) chips.push({ label: `${short} energy short`, cls: 'chip bad' });
      else chips.push({ label: s.active === 'you' ? 'Not playable now' : "Claude's turn", cls: 'chip' });
      if (s.phase === 'defend') rule = 'Close this, then tap it in your hand to add its combo power to your defence.';
      else { rule = why || c.text; ruleBad = !!why; }
      if (s.phase !== 'defend') {
        actions.push({ label: 'Play it', note: why ? (short > 0 && s.active === 'you' ? `${short} short` : 'not now') : `−${c.cost} energy`, disabled: !!why, cls: 'act primary', run: G(() => this.doPlay(h.uid)) });
        actions.push({ label: 'Charge as energy', note: chWhy ? 'once per turn' : '+1 energy', disabled: !!chWhy, cls: 'act', run: G(() => this.doCharge(h.uid)) });
      }
    } else {
      isL = ref.uid === 'L'; const u = isL ? p.leader : p.board.find((b) => b.uid === ref.uid); if (!u) return null; k = u.k; const c = C[k];
      owner = (mine ? 'Your ' : "Claude's ") + (isL ? 'leader' : 'battle area');
      stats = isL ? [{ k: 'Power', v: f(c.power) }, { k: 'Life', v: `${p.life}/${p.lifeMax}` }, { k: 'Energy', v: `${p.energy - p.used}/${p.energy}` }] : [{ k: 'Cost', v: String(c.cost) }, { k: 'Power', v: f(c.power) }, { k: 'Combo', v: '+' + f(c.combo) }];
      chips.push({ label: u.rested ? 'Rested' : 'Standing', cls: 'chip' });
      if (!isL && u.fresh) chips.push({ label: 'Played this turn', cls: 'chip' });
      const ready = !u.rested && (isL || !u.fresh);
      if (mine && s.attacker === ref.uid) chips.push({ label: 'Attacking', cls: 'chip ok' });
      else if (mine && main && ready && s.attacker == null) chips.push({ label: 'Can attack', cls: 'chip ok' });
      if (!mine && main && s.attacker != null) chips.push(isL || u.rested ? { label: 'Valid target', cls: 'chip bad' } : { label: 'Not a target', cls: 'chip' });
      rule = c.text;
      if (mine && u.rested) rule = 'Rested — it already attacked. It stands back up at the start of your next turn.';
      else if (mine && !isL && u.fresh) rule = 'Played this turn — it can attack next turn.';
      else if (!mine && !isL && !u.rested) rule = c.text + ' Standing cards cannot be attacked.';
      if (mine && main && ready && s.attacker == null) actions.push({ label: 'Attack with it', note: 'then pick a target', disabled: false, cls: 'act primary', run: G(() => this.tapMine(ref.uid, true)) });
      if (mine && s.attacker === ref.uid) actions.push({ label: 'Cancel attack', note: '', disabled: false, cls: 'act', run: G(() => this.cancelAtk()) });
      if (!mine && main && s.attacker != null && (isL || u.rested)) actions.push({ label: 'Attack it', note: `with ${this.nameOf(s, 'you', s.attacker)}`, disabled: false, cls: 'act primary', run: G(() => this.tapOpp(ref.uid, true)) });
    }
    if (!desk) actions.push({ label: 'Close', note: 'or swipe down', disabled: false, cls: 'act ghost', run: G(() => this.closeSheet()) });
    const c = C[k];
    const seq = this.seqOf(s, ref); const idx = seq.findIndex((r) => r.side === ref.side && r.uid === ref.uid && r.zone === ref.zone);
    const strip = seq.map((r, i) => { const kk = this.kOf(s, r); const cc = C[kk] || c; return { cls: 'thumb ' + r.side + (i === idx ? ' on' : ''), art: `--h: ${cc.hue}`, path: this.P[cc.g], aria: `Review ${cc.name}`, go: G(() => this.upd((x) => { x.sel = Object.assign({}, r, { inspect: true }); })) }; });
    return {
      name: c.name, cost: c.cost, pw: f(c.power), path: this.P[c.g], art: `--h: ${c.hue}`, hasCost: !isL,
      owner, ownerCls: 'sh-own ' + side, chips, stats, rule, ruleCls: ruleBad ? 'rule bad' : 'rule', actions,
      pos: `${idx + 1} / ${seq.length}`, seqTitle: ref.zone === 'hand' ? 'Your hand' : 'In play', hasNav: seq.length > 1,
      prev: G(() => this.nav(-1)), next: G(() => this.nav(1)), strip
    };
  }

  // ---------- drag and drop from hand ----------
  dragDown(uid, e) {
    const s = this.state;
    if (s.winner || s.phase === 'defend' || (e && e.button === 2)) return;
    const el = e.currentTarget; const root = el && el.closest ? el.closest('.arena') : null; if (!root) return;
    this.dg = { uid, sx: e.clientX, sy: e.clientY, root, on: false, blocked: false };
    try { el.setPointerCapture(e.pointerId); } catch (err) { }
  }
  zoneAt(cx, cy) {
    const el = document.elementFromPoint(cx, cy); if (!el || !el.closest) return null;
    if (el.closest('.row.me')) return 'board';
    if (el.closest('.strip.me')) return 'energy';
    return null;
  }
  dragMove(e) {
    const d = this.dg; if (!d || d.blocked) return;
    if (!d.on) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 8) return;
      const s = this.state;
      if (s.active !== 'you' || s.phase !== 'main') { d.blocked = true; this.pressEnd(); if (s.active !== 'you') this.refuse("It's Claude's turn — you can review cards, not play them."); return; }
      d.on = true; this.pressEnd(); this.lpFired = false;
    }
    const r = d.root.getBoundingClientRect(); const sc = (r.width / d.root.offsetWidth) || 1;
    d.x = (e.clientX - r.left) / sc; d.y = (e.clientY - r.top) / sc; d.over = this.zoneAt(e.clientX, e.clientY);
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = null; const g = this.dg; if (g && g.on) this.setState({ drag: { uid: g.uid, x: Math.round(g.x), y: Math.round(g.y), over: g.over } }); });
  }
  dragUp(e) {
    const d = this.dg; this.dg = null;
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; }
    if (!d) return;
    if (d.blocked) { this.dragEndedAt = Date.now(); return; }
    if (!d.on) return;
    this.dragEndedAt = Date.now();
    const over = this.zoneAt(e.clientX, e.clientY);
    this.setState({ drag: null });
    if (over === 'board') { const why = this.whyNotPlay(this.state, d.uid); if (why) { this.refuse(why); this.snap(d.uid); } else this.doPlay(d.uid); }
    else if (over === 'energy') { const why = this.whyNotCharge(this.state); if (why) { this.refuse(why); this.snap(d.uid); } else this.doCharge(d.uid); }
    else this.snap(d.uid);
  }
  dragCancel() { const d = this.dg; this.dg = null; if (d && d.on) this.snap(d.uid); if (this.state.drag) this.setState({ drag: null }); }
  snap(uid) {
    this.upd((x) => { const h = x.you.hand.find((z) => z.uid === uid); if (h) h.anim = 'snap'; });
    this.laterRaw(500, () => this.upd((x) => { const h = x.you.hand.find((z) => z.uid === uid); if (h && h.anim === 'snap') h.anim = ''; }));
  }

  // ---------- player actions ----------
  tapHand(uid) {
    if (this.eatTap()) return;
    if (Date.now() - (this.dragEndedAt || 0) < 350) return;
    const s = this.state; if (s.winner) return;
    if (s.phase === 'defend') { this.upd((x) => { const i = x.defendPick.indexOf(uid); if (i >= 0) x.defendPick.splice(i, 1); else x.defendPick.push(uid); }); return; }
    if (!this.isDesk() && this.chargePhase(s)) { this.doCharge(uid); return; }
    this.upd((x) => { x.sel = (x.sel && x.sel.zone === 'hand' && x.sel.uid === uid) ? null : { zone: 'hand', side: 'you', uid }; x.hover = { zone: 'hand', side: 'you', uid }; x.attacker = null; x.menuOpen = false; x.logOpen = false; });
  }
  dblHand(uid) {
    const s = this.state; if (!this.isDesk() || s.phase === 'defend') return;
    const why = this.whyNotCharge(s); if (why) { this.refuse(why); return; }
    this.doCharge(uid);
  }
  closeSheet() { this.upd((x) => { x.sel = null; }); }
  doPlay(uid) {
    const why = this.whyNotPlay(this.state, uid); if (why) { this.refuse(why); return; }
    this.upd((x) => {
      const p = x.you; const i = p.hand.findIndex((h) => h.uid === uid); if (i < 0) return;
      const h = p.hand.splice(i, 1)[0]; const c = this.C[h.k];
      p.used += c.cost; p.chargeDone = true; p.board.push({ uid: h.uid, k: h.k, rested: false, fresh: true, anim: 'reveal', fx: '' });
      x.sel = null; x.flash = x.n++;
      this.say(x, 'you', `You play ${c.name} — ${this.fmt(c.power)} power.`);
      this.beat(x, 'play', 'you', `${c.name} (cost ${c.cost})`, this.moves(this.state));
    });
    this.later(950, () => this.upd((x) => { this.clearAnims(x); x.flash = 0; }));
  }
  doCharge(uid) {
    const why = this.whyNotCharge(this.state); if (why) { this.refuse(why); return; }
    this.upd((x) => {
      const p = x.you; const i = p.hand.findIndex((h) => h.uid === uid); if (i < 0) return;
      const h = p.hand.splice(i, 1)[0]; p.energy++; p.charged = true; p.chargeDone = true; p.chipNew = p.energy - 1; x.sel = null; x.float = { text: '+1 ENERGY', side: 'energy', n: x.n++ };
      this.say(x, 'you', `You charge ${this.C[h.k].name} — ${p.energy - p.used} energy active.`);
      this.beat(x, 'charge', 'you', `${this.C[h.k].name} → energy (${p.energy})`, this.moves(this.state));
    });
    this.later(900, () => this.upd((x) => { x.you.chipNew = null; if (x.float && x.float.side === 'energy') x.float = null; }));
  }
  tapMine(ref, fromPanel) {
    if (!fromPanel && this.eatTap()) return;
    const s = this.state; if (s.winner) return;
    const me = { zone: 'board', side: 'you', uid: ref };
    if (s.phase === 'defend') { this.refuse('Defend with cards from your hand — tap them to combo.'); return; }
    if (s.active !== 'you' || s.phase !== 'main') { this.pin(me); return; }
    if (s.attacker === ref) { this.upd((x) => { x.attacker = null; }); return; }
    const u = ref === 'L' ? s.you.leader : s.you.board.find((b) => b.uid === ref); if (!u) return;
    const nm = this.nameOf(s, 'you', ref);
    if (u.rested || u.fresh) {
      if (!this.isDesk()) { this.pin(me); return; }
      this.refuse(u.rested ? `${nm} is rested — it already attacked. It stands back up next turn.` : `${nm} was played this turn — it can attack next turn.`); return;
    }
    this.upd((x) => { x.attacker = ref; x.you.chargeDone = true; x.sel = null; x.hover = me; this.say(x, 'you', `${nm} is ready. Pick a target.`); });
  }
  tapOpp(ref, fromPanel) {
    if (!fromPanel && this.eatTap()) return;
    const s = this.state; if (s.winner) return;
    if (s.attacker != null && s.active === 'you' && s.phase === 'main') {
      if (ref !== 'L') { const u = s.ai.board.find((b) => b.uid === ref); if (u && !u.rested) { this.refuse(`${this.C[u.k].name} is standing — only rested cards can be attacked.`); return; } }
      this.startClash('you', s.attacker, ref); return;
    }
    this.upd((x) => { x.sel = { zone: 'board', side: 'ai', uid: ref, inspect: true }; x.hover = { zone: 'board', side: 'ai', uid: ref }; x.menuOpen = false; x.logOpen = false; });
  }
  cancelAtk() { this.upd((x) => { x.attacker = null; this.say(x, 'you', 'Attack cancelled.'); }); }
  endTurn() {
    const s = this.state; if (s.active !== 'you' || s.phase !== 'main' || s.winner) return;
    const left = this.moves(s);
    this.upd((x) => { x.sel = null; x.attacker = null; x.phase = 'ending'; this.say(x, 'you', 'You end your turn.'); this.beat(x, 'end', 'you', left ? `ended with ${left} move(s) unused` : 'end turn', left); });
    this.later(450, () => this.startTurn('ai'));
  }

  // ---------- turn flow ----------
  startTurn(side, first) {
    if (this.state.winner) return;
    this.upd((x) => {
      x.active = side; if (side === 'you') x.turn += 1;
      const p = x[side];
      p.leader.rested = false; p.leader.fx = '';
      p.board.forEach((u) => { u.rested = false; u.fresh = false; });
      p.used = 0; p.charged = false; p.chargeDone = false;
      let drew = '';
      if (!first && p.deck.length) { drew = p.deck.pop(); p.hand.push({ uid: x.n++, k: drew, anim: side === 'you' ? 'draw' : '' }); }
      x.banner = { side, text: side === 'you' ? 'YOUR TURN' : "CLAUDE'S TURN", sub: 'Turn ' + x.turn, n: x.n++ };
      x.phase = 'banner'; x.sel = null; x.attacker = null; x.defendPick = []; x.refusal = null;
      x.aiStage = side === 'ai' ? 'charge' : null;
      if (side === 'you') this.say(x, 'you', first ? (this.isDesk() ? 'You go first. Drag cards onto your battle area to play them; hover any card to review it.' : 'You go first. Drag a card up onto your board to play it. Hold any card to review it.') : `Your turn. You draw ${this.C[drew] ? this.C[drew].name : 'a card'}.`);
      else this.say(x, 'ai', "Claude's turn. Claude draws a card.");
      this.beat(x, 'turn', side, `start of turn ${x.turn}` + (drew ? ` · draw ${side === 'you' ? this.C[drew].name : '(hidden)'}` : ''), null);
    });
    this.later(1300, () => {
      this.upd((x) => { x.banner = null; x.phase = side === 'you' ? 'main' : 'ai'; x.you.hand.forEach((h) => { h.anim = ''; }); });
      if (side === 'ai') this.later(450, () => this.aiStep());
    });
  }

  // ---------- clash ----------
  startClash(atkSide, aRef, dRef) {
    const s = this.state; const defSide = atkSide === 'you' ? 'ai' : 'you';
    const aU = aRef === 'L' ? s[atkSide].leader : s[atkSide].board.find((b) => b.uid === aRef);
    const dU = dRef === 'L' ? s[defSide].leader : s[defSide].board.find((b) => b.uid === dRef);
    if (!aU || !dU) return;
    const aK = aU.k, dK = dU.k;
    this.upd((x) => {
      const A = x[atkSide];
      if (aRef === 'L') A.leader.rested = true; else { const u = A.board.find((b) => b.uid === aRef); if (u) u.rested = true; }
      x.clash = { atkSide, aRef, dRef, aK, dK, aPow: this.C[aK].power, dPow: this.C[dK].power, combos: [], stage: 'in', result: null };
      x.phase = 'clash'; x.attacker = null; x.sel = null; x.refusal = null; x.logOpen = false;
      const tName = dRef === 'L' ? (defSide === 'you' ? 'your leader' : "Claude's leader") : this.C[dK].name;
      this.say(x, atkSide, atkSide === 'you' ? `${this.C[aK].name} attacks ${tName}!` : `Claude attacks ${tName} with ${this.C[aK].name}!`);
      this.beat(x, 'attack', atkSide, `${this.C[aK].name} (${this.fmt(this.C[aK].power)}) → ${tName} (${this.fmt(this.C[dK].power)})`, null, atkSide === 'ai' ? (dRef === 'L' ? 'strongest ready attacker; leader is the win condition' : 'KO a rested card it out-powers') : '');
    });
    if (atkSide === 'you') this.later(1000, () => this.aiDefend());
    else this.later(900, () => this.upd((x) => { if (!x.clash) return; x.clash.stage = 'defend'; x.phase = 'defend'; x.defendPick = []; }));
  }
  aiDefend() {
    const s = this.state; const c = s.clash; if (!c) return;
    const gap = c.aPow - c.dPow;
    let pick = []; let why = '';
    if (gap < 0) why = 'no combo — already out-powers the attack';
    else {
      const hand = [...s.ai.hand].sort((a, b) => this.C[b.k].combo - this.C[a.k].combo);
      let sum = 0; for (const h of hand) { if (sum > gap) break; pick.push(h.uid); sum += this.C[h.k].combo; }
      const worth = c.dRef === 'L' ? (s.ai.life <= 2 || Math.random() < 0.55) : Math.random() < 0.4;
      if (sum <= gap) { pick = []; why = 'no combo — cannot reach the attack'; }
      else if (!worth) { pick = []; why = 'no combo — saving cards; the hit is affordable'; }
      else if (s.ai.hand.length - pick.length < 1) { pick = []; why = 'no combo — would empty its hand'; }
      else why = 'combo — it turns a hit into a hold';
    }
    if (pick.length) {
      this.upd((x) => {
        const names = []; let add = 0;
        pick.forEach((uid) => { const i = x.ai.hand.findIndex((h) => h.uid === uid); if (i < 0) return; const h = x.ai.hand.splice(i, 1)[0]; x.ai.drop++; add += this.C[h.k].combo; names.push(this.C[h.k].name); x.clash.combos.push({ k: h.k, v: this.C[h.k].combo }); });
        x.clash.dPow += add; x.clash.stage = 'combo';
        this.say(x, 'ai', `Claude combos ${names.join(' + ')} — +${this.fmt(add)}!`);
        this.beat(x, 'combo', 'ai', `${names.join(' + ')} (+${this.fmt(add)})`, null, why);
      });
      this.later(1050, () => this.resolveClash());
    } else {
      this.upd((x) => { this.beat(x, 'defend', 'ai', 'no combo', null, why); });
      this.later(250, () => this.resolveClash());
    }
  }
  lockIn() {
    const s = this.state; if (s.phase !== 'defend' || !s.clash) return;
    if (!s.defendPick.length) { this.takeHit(); return; }
    this.upd((x) => {
      const names = []; let add = 0;
      x.defendPick.forEach((uid) => { const i = x.you.hand.findIndex((h) => h.uid === uid); if (i < 0) return; const h = x.you.hand.splice(i, 1)[0]; x.you.drop++; add += this.C[h.k].combo; names.push(this.C[h.k].name); x.clash.combos.push({ k: h.k, v: this.C[h.k].combo }); });
      x.clash.dPow += add; x.clash.stage = 'combo'; x.phase = 'clash'; x.defendPick = [];
      this.say(x, 'you', `You combo ${names.join(' + ')} — +${this.fmt(add)}!`);
      this.beat(x, 'combo', 'you', `${names.join(' + ')} (+${this.fmt(add)})`, null);
    });
    this.later(950, () => this.resolveClash());
  }
  takeHit() {
    const s = this.state; if (s.phase !== 'defend') return;
    this.upd((x) => { x.phase = 'clash'; x.defendPick = []; this.say(x, 'you', 'You take it — no combo.'); this.beat(x, 'defend', 'you', 'no combo', null); });
    this.later(250, () => this.resolveClash());
  }
  resolveClash() {
    const c = this.state.clash; if (!c) return;
    const hit = c.aPow >= c.dPow;
    this.upd((x) => { if (!x.clash) return; x.clash.stage = 'result'; x.clash.result = hit ? 'hit' : 'held'; if (hit) { x.shake = x.n++; x.flash = x.n++; } });
    this.later(1200, () => this.applyClash());
  }
  applyClash() {
    const s = this.state; const c = s.clash; if (!c) return;
    const defSide = c.atkSide === 'you' ? 'ai' : 'you';
    const hit = c.result === 'hit';
    const leaderHit = hit && c.dRef === 'L';
    const willWin = leaderHit && s[defSide].life - 1 <= 0;
    const koUid = hit && c.dRef !== 'L' ? c.dRef : null;
    const aiNext = s.active === 'ai' && !willWin;
    this.upd((x) => {
      const D = x[defSide];
      x.clash = null; x.flash = 0; x.shake = 0;
      const vs = `${this.fmt(c.aPow)} vs ${this.fmt(c.dPow)}`;
      if (leaderHit) {
        D.life -= 1; D.lostAt = D.life; D.leader.fx = 'boom'; x.float = { text: '−1 LIFE', side: defSide, n: x.n++ }; x.shake = x.n++;
        this.say(x, c.atkSide, defSide === 'ai' ? `Direct hit! Claude is down to ${D.life} life.` : `Claude breaks through — you're down to ${D.life} life.`);
        this.beat(x, 'damage', c.atkSide, `${vs} → leader −1 (${D.life} left)`, null);
        if (D.life <= 0) x.winner = c.atkSide;
      } else if (koUid != null) {
        const u = D.board.find((b) => b.uid === koUid); if (u) u.fx = 'ko';
        this.say(x, c.atkSide, `${this.C[c.dK].name} is knocked out!`);
        this.beat(x, 'ko', c.atkSide, `${vs} → KO ${this.C[c.dK].name}`, null, c.aPow === c.dPow ? 'tie goes to the attacker' : '');
      } else {
        this.say(x, defSide, defSide === 'you' ? 'You hold — the attack is deflected.' : 'Claude holds — your attack is deflected.');
        this.beat(x, 'held', defSide, `${vs} → deflected`, null);
      }
    });
    this.later(820, () => {
      this.upd((x) => {
        const D = x[defSide];
        if (koUid != null) { const i = D.board.findIndex((b) => b.uid === koUid); if (i >= 0) { D.board.splice(i, 1); D.drop++; } }
        D.leader.fx = ''; D.lostAt = null; x.float = null; x.shake = 0;
        x.phase = x.winner ? 'over' : (x.active === 'you' ? 'main' : 'ai');
      });
      if (aiNext) this.later(550, () => this.aiStep());
    });
  }

  // ---------- Claude ----------
  aiStep() {
    const s = this.state; if (s.winner || s.active !== 'ai' || s.phase !== 'ai') return;
    const p = s.ai; const av = p.energy - p.used;
    if (s.aiStage === 'charge') {
      if (!p.charged && p.hand.length >= 3) {
        const h = [...p.hand].sort((a, b) => this.C[a.k].power - this.C[b.k].power)[0]; const nm = this.C[h.k].name;
        this.upd((x) => { const q = x.ai; const i = q.hand.findIndex((z) => z.uid === h.uid); if (i < 0) return; q.hand.splice(i, 1); q.energy++; q.charged = true; q.chipNew = q.energy - 1; x.aiStage = 'play'; this.say(x, 'ai', `Claude charges ${nm} into energy (${q.energy}).`); this.beat(x, 'charge', 'ai', `${nm} → energy (${q.energy})`, p.hand.length + 1, 'lowest-power card; keeps 2+ in hand'); });
        this.later(950, () => { this.upd((x) => { x.ai.chipNew = null; }); this.aiStep(); });
      } else { this.upd((x) => { x.aiStage = 'play'; }); this.later(120, () => this.aiStep()); }
      return;
    }
    if (s.aiStage === 'play') {
      const opts = p.hand.filter((h) => this.C[h.k].cost <= av).sort((a, b) => (this.C[b.k].cost - this.C[a.k].cost) || (this.C[b.k].power - this.C[a.k].power));
      if (opts.length && p.board.length < 4) {
        const h = opts[0]; const c = this.C[h.k];
        this.upd((x) => { const q = x.ai; const i = q.hand.findIndex((z) => z.uid === h.uid); if (i < 0) return; q.hand.splice(i, 1); q.used += c.cost; q.board.push({ uid: h.uid, k: h.k, rested: false, fresh: true, anim: 'reveal', fx: '' }); x.flash = x.n++; this.say(x, 'ai', `Claude plays ${c.name} — ${this.fmt(c.power)} power.`); this.beat(x, 'play', 'ai', `${c.name} (cost ${c.cost})`, opts.length + 1, 'highest cost it can afford'); });
        this.later(1150, () => { this.upd((x) => { this.clearAnims(x); x.flash = 0; }); this.aiStep(); });
      } else { this.upd((x) => { x.aiStage = 'attack'; }); this.later(300, () => this.aiStep()); }
      return;
    }
    if (s.aiStage === 'attack') {
      const atks = [];
      if (!p.leader.rested) atks.push({ ref: 'L', pow: this.C[p.leader.k].power });
      p.board.forEach((u) => { if (!u.rested && !u.fresh) atks.push({ ref: u.uid, pow: this.C[u.k].power }); });
      atks.sort((a, b) => b.pow - a.pow);
      if (atks.length && s.you.life > 0) {
        const a = atks[0];
        const prey = s.you.board.filter((u) => u.rested && this.C[u.k].power <= a.pow).sort((m, n) => this.C[n.k].power - this.C[m.k].power)[0];
        const tgt = (prey && Math.random() < 0.35) ? prey.uid : 'L';
        this.startClash('ai', a.ref, tgt);
      } else {
        this.upd((x) => { x.aiStage = 'end'; this.say(x, 'ai', 'Claude ends its turn.'); this.beat(x, 'end', 'ai', 'end turn', 1, 'no ready attackers left'); });
        this.later(750, () => this.startTurn('you'));
      }
    }
  }

  // ---------- chrome ----------
  restart() {
    this.timers.forEach((t) => clearTimeout(t)); this.timers = [];
    const g = this.makeGame((Date.now() % 1000000) | 0, this.state.skin); g.speed = this.state.speed; g.tab = this.state.tab;
    this.setState(g);
    this.laterRaw(400, () => this.startTurn('you', true));
  }

  renderVals() {
    const s = this.state; const C = this.C;
    const desk = (this.props.layout ?? '__LAYOUT__') === 'desk';
    const k = s.speed === 0 ? 0.05 : 1 / s.speed;
    const main = s.active === 'you' && s.phase === 'main' && !s.winner;
    const defend = s.phase === 'defend';
    const avail = s.you.energy - s.you.used;
    const face = (key) => { const c = C[key]; return { name: c.name, cost: c.cost, pw: this.fmt(c.power), combo: this.fmt(c.combo), path: this.P[c.g], art: `--h: ${c.hue}` }; };
    const dragH = s.drag ? s.you.hand.find((h) => h.uid === s.drag.uid) : null;
    const selHand = dragH || (s.sel && s.sel.zone === 'hand' ? s.you.hand.find((h) => h.uid === s.sel.uid) : null);
    let drag = null;
    if (dragH) {
      const c = C[dragH.k]; const why = this.whyNotPlay(s, dragH.uid); const chWhy = this.whyNotCharge(s); const short = c.cost - avail;
      const bad = (s.drag.over === 'board' && why) || (s.drag.over === 'energy' && chWhy);
      drag = Object.assign(face(dragH.k), {
        style: `--h: ${c.hue}; left: ${s.drag.x}px; top: ${s.drag.y}px`,
        cls: 'card hc dragghost' + (s.drag.over ? ' over' : '') + (bad ? ' bad' : ''),
        boardOk: !why, energyOk: !chWhy,
        boardLabel: why ? (short > 0 ? `${short} energy short` : (s.you.board.length >= 4 ? 'Battle area full' : 'Can’t play now')) : `Drop to play · −${c.cost} energy`,
        energyLabel: chWhy ? 'Already charged this turn' : 'Drop to charge · +1 energy',
        boardTag: 'droptag ' + (why ? 'no' : 'ok'), energyTag: 'droptag etag ' + (chWhy ? 'no' : 'ok') + (chWhy && s.drag.over !== 'energy' ? ' hide' : '')
      });
    }
        const inClash = (uid) => s.clash && (s.clash.aRef === uid || s.clash.dRef === uid);
    const hv = s.hover && this.kOf(s, s.hover) ? s.hover : null;
    const focusRef = desk ? (hv || s.sel) : s.sel;
    const isFocus = (zone, side, uid) => !!focusRef && focusRef.zone === zone && focusRef.side === side && focusRef.uid === uid;
    const hnd = (zone, side, uid) => {
      const ref = { zone, side, uid }; const key = `${zone}:${side}:${uid}`;
      return {
        down: (e) => this.pressStart(ref, key, e), up: () => this.pressEnd(), leave: () => this.pressEnd(),
        ctx: (e) => { if (e && e.preventDefault) e.preventDefault(); this.pressEnd(); if (desk) this.pin(ref); },
        hover: () => { if (desk) this.hoverOn(ref); },
        fx: (s.pressing === key ? ' pressing' : '') + (isFocus(zone, side, uid) ? ' peek' : '')
      };
    };

    const unitsOf = (side) => s[side].board.map((u) => {
      const f = face(u.k); const mine = side === 'you'; const H = hnd('board', side, u.uid);
      const canAtk = mine && main && !u.rested && !u.fresh && s.attacker == null;
      const isAtk = mine && s.attacker === u.uid;
      const tgt = !mine && main && s.attacker != null && u.rested;
      const cls = ['card', 'unit', u.rested ? 'rested' : '', canAtk ? 'can' : '', isAtk ? 'atk' : '', tgt ? 'tgt' : '', u.anim === 'reveal' ? 'reveal' : '', u.fx === 'ko' ? 'ko' : '', inClash(u.uid) ? 'inclash' : ''].filter(Boolean).join(' ') + H.fx;
      return Object.assign(f, H, { cls, boom: u.fx === 'ko', hasTag: mine && u.fresh && !u.rested, tag: 'NEW', tap: () => (mine ? this.tapMine(u.uid) : this.tapOpp(u.uid)), aria: `${f.name}, power ${f.pw}${u.rested ? ', rested' : ''}${mine ? '' : ', Claude'}` });
    });
    const leaderOf = (side) => {
      const p = s[side]; const f = face(p.leader.k); const mine = side === 'you'; const H = hnd('board', side, 'L');
      const canAtk = mine && main && !p.leader.rested && s.attacker == null;
      const isAtk = mine && s.attacker === 'L';
      const tgt = !mine && main && s.attacker != null;
      const cls = ['card', 'leader', p.leader.rested ? 'rested' : '', canAtk ? 'can' : '', isAtk ? 'atk' : '', tgt ? 'tgt' : '', p.leader.fx === 'boom' ? 'hurt' : ''].filter(Boolean).join(' ') + H.fx;
      return Object.assign(f, H, { cls, boom: p.leader.fx === 'boom', tap: () => (mine ? this.tapMine('L') : this.tapOpp('L')), aria: `${f.name}, leader, ${p.life} life` });
    };
    const chipsOf = (side) => {
      const p = s[side]; const av = p.energy - p.used; const out = []; let will = 0, miss = 0;
      if (side === 'you' && selHand) { const cost = C[selHand.k].cost; if (cost <= av) will = cost; else if (s.active === 'you') miss = cost - av; }
      for (let i = 0; i < p.energy; i++) { const on = i < av; out.push({ cls: 'ec' + (on ? '' : ' off') + (on && i >= av - will ? ' will' : '') + (i === p.chipNew ? ' pop' : '') }); }
      for (let i = 0; i < miss; i++) out.push({ cls: 'ec miss' });
      return out;
    };
    const livesOf = (side) => { const p = s[side]; const a = []; for (let i = 0; i < p.lifeMax; i++) a.push({ cls: 'lp' + (i < p.life ? '' : ' gone') + (i === p.lostAt ? ' shatter' : '') }); return a; };
    const sideOf = (side) => { const p = s[side]; const units = unitsOf(side); const slots = []; for (let i = units.length; i < 4; i++) slots.push({ i, cls: 'slot' + (side === 'you' && drag && drag.boardOk && i === units.length ? ' land' : '') }); return { life: p.life, lives: livesOf(side), chips: chipsOf(side), handN: p.hand.length, deckN: p.deck.length, dropN: p.drop, units, slots, leader: leaderOf(side), energyTxt: `${p.energy - p.used}/${p.energy}` }; };

    // hand
    const H = s.you.hand; const n = H.length;
    const hw = desk ? 112 : 84; const availW = desk ? 700 : 332;
    const step = n > 1 ? Math.min(hw + 8, (availW - hw) / (n - 1)) : 0;
    const picks = s.defendPick || [];
    const hand = H.map((h, i) => {
      const c = C[h.k]; const f = face(h.k);
      const playable = main && c.cost <= avail && s.you.board.length < 4;
      const picked = defend && picks.includes(h.uid);
      const isSel = s.sel && s.sel.uid === h.uid;
      const off = i - (n - 1) / 2; const rot = desk ? off * 2.4 : off * 3.4; const dy = Math.abs(off) * (desk ? 4 : 3.2);
      const style = `--h: ${c.hue}; margin-left: ${i === 0 ? 0 : (step - hw).toFixed(1)}px; transform: translateY(${(picked ? -26 : dy).toFixed(1)}px) rotate(${(picked || isSel ? 0 : rot).toFixed(1)}deg); z-index: ${isSel || picked ? 60 : i + 1}`;
      const cls = ['card', 'hc', playable ? 'can' : '', main && !playable ? 'dim' : '', main && c.cost > avail ? 'poor' : '', defend ? 'combo-ready' : '', picked ? 'picked' : '', isSel ? 'sel' : '', h.anim === 'draw' ? 'drawn' : '', h.anim === 'snap' ? 'snap' : '', this.chargePhase(s) ? 'chargeable' : '', s.drag && s.drag.uid === h.uid ? 'lifted' : ''].filter(Boolean).join(' ');
      const HX = hnd('hand', 'you', h.uid);
      return Object.assign(f, HX, { dbl: () => this.dblHand(h.uid), down: (e) => { this.dragDown(h.uid, e); HX.down(e); }, move: (e) => this.dragMove(e), up: (e) => { HX.up(); this.dragUp(e); }, leave: () => { if (!this.dg || !this.dg.on) HX.leave(); }, cancel: () => { HX.leave(); this.dragCancel(); } }, { cls: cls + HX.fx, style, tap: () => this.tapHand(h.uid), aria: `${f.name}, cost ${c.cost}, power ${f.pw}, combo plus ${f.combo}` });
    });

    // inspector (desktop panel: hover, zero clicks; phone: sheet with swipe)
    const insp = focusRef ? this.inspector(s, focusRef, desk) : null;

    // in play list (desktop)
    const inplay = ['ai', 'you'].map((side) => {
      const p = s[side]; const rows = [];
      const push = (uid, k, rested, fresh, isL) => {
        const c = C[k]; const ref = { zone: 'board', side, uid };
        const st = isL ? `Leader · ${p.life} life · ${rested ? 'rested' : 'standing'}` : (rested ? 'Rested' : fresh ? 'Played this turn' : (side === 'you' && main ? 'Ready to attack' : 'Standing'));
        rows.push({ name: c.name, pw: this.fmt(c.power), state: st, art: `--h: ${c.hue}`, path: this.P[c.g], cls: 'ip-row ' + side + (rested ? ' rested' : '') + (isFocus('board', side, uid) ? ' on' : ''), hover: () => this.hoverOn(ref), pin: () => this.pin(ref), aria: `Review ${c.name}` });
      };
      push('L', p.leader.k, p.leader.rested, false, true);
      p.board.forEach((u) => push(u.uid, u.k, u.rested, u.fresh, false));
      const tot = p.board.reduce((a, u) => a + C[u.k].power, 0);
      return { title: side === 'ai' ? 'Claude' : 'You', sum: p.board.length ? `${p.board.length} in battle · ${this.fmt(tot)} power` : 'battle area empty', rows };
    });

    // clash
    let clash = null;
    if (s.clash) {
      const c = s.clash;
      const pickSum = defend ? picks.reduce((a, uid) => { const h = s.you.hand.find((z) => z.uid === uid); return a + (h ? C[h.k].combo : 0); }, 0) : 0;
      const dPow = c.dPow + pickSum;
      const aiAtk = c.atkSide === 'ai';
      const aF = face(c.aK), dF = face(c.dK);
      const combos = c.combos.map((x) => ({ label: `+${this.fmt(x.v)} ${C[x.k].name}`, cls: 'cl-combo' }));
      const pend = defend ? picks.map((uid) => { const h = s.you.hand.find((z) => z.uid === uid); return h ? { label: `+${this.fmt(C[h.k].combo)} ${C[h.k].name}`, cls: 'cl-combo pending' } : null; }).filter(Boolean) : [];
      const defCombos = combos.concat(pend);
      const res = c.result;
      const youWin = res && ((res === 'hit') === (c.atkSide === 'you'));
      clash = {
        cls: `clash stage-${c.stage} ${aiAtk ? 'from-top' : 'from-bot'} ${res ? 'res-' + res : ''}`,
        top: Object.assign(aiAtk ? aF : dF, { pow: this.fmt(aiAtk ? c.aPow : dPow), role: aiAtk ? 'CLAUDE ATTACKS' : 'CLAUDE DEFENDS', combos: aiAtk ? [] : defCombos }),
        bot: Object.assign(aiAtk ? dF : aF, { pow: this.fmt(aiAtk ? dPow : c.aPow), role: aiAtk ? 'YOU DEFEND' : 'YOU ATTACK', combos: aiAtk ? defCombos : [] }),
        beam: !!res,
        boomTop: res === 'hit' && !aiAtk, boomBot: res === 'hit' && aiAtk,
        heldTop: res === 'held' && !aiAtk, heldBot: res === 'held' && aiAtk,
        verdict: res === 'hit' ? (c.dRef === 'L' ? 'BREAK THROUGH' : 'K.O.') : res === 'held' ? 'HELD!' : '',
        verdictCls: 'verdict ' + (youWin ? 'good' : (res === 'held' ? 'calm' : 'bad')),
        note: c.stage === 'defend' ? 'Tap hand cards to combo' : c.stage === 'combo' ? 'Combo!' : c.stage === 'in' ? (aiAtk ? 'Incoming attack' : 'Claude is deciding whether to combo…') : ''
      };
    }

    // prompt + buttons
    const mv = this.moves(s);
    let prompt = ''; let promptCls = 'prompt';
    let lockLabel = 'Combo'; let lockDisabled = true;
    if (s.winner) prompt = s.winner === 'you' ? 'You win. Rematch?' : 'Claude wins this one. Rematch?';
    else if (s.refusal) { prompt = s.refusal.text; promptCls = 'prompt bad ' + (s.refusal.n % 2 ? 'ra' : 'rb'); }
    else if (s.phase === 'banner') prompt = s.active === 'you' ? 'Your turn is starting…' : "Claude's turn is starting…";
    else if (defend && s.clash) {
      const sum = picks.reduce((a, uid) => { const h = s.you.hand.find((z) => z.uid === uid); return a + (h ? C[h.k].combo : 0); }, 0);
      const tot = s.clash.dPow + sum; const holds = tot > s.clash.aPow;
      prompt = holds ? `Holding at ${this.fmt(tot)} vs ${this.fmt(s.clash.aPow)}. Lock it in.` : `Beat ${this.fmt(s.clash.aPow)} to hold — you're at ${this.fmt(tot)}. Ties go to the attacker.`;
      lockLabel = sum ? `Combo +${this.fmt(sum)}` : 'Combo'; lockDisabled = !sum;
    }
    else if (s.phase === 'clash') prompt = 'Clash!';
    else if (s.active === 'ai') prompt = 'Claude is playing — watch the board.';
    else if (s.attacker != null) prompt = "Pick a target: Claude's leader, or one of Claude's rested cards.";
    else if (this.chargePhase(s)) prompt = desk ? 'Charge phase — double-click a hand card to charge it (+1 energy), or drag one straight onto the board.' : 'Charge phase — tap a card to charge it (+1 energy), or drag one onto the board.'
    else prompt = mv ? `${mv} move${mv > 1 ? 's' : ''} available — drag a glowing card up to play it, or tap a ready card to attack.` : 'Nothing left to do — end your turn.';

    // phases
    const order = ['Draw', 'Charge', 'Main', 'Battle', 'End'];
    let cur = 'Draw';
    if (s.phase === 'banner' || s.phase === 'start') cur = 'Draw';
    else if (s.phase === 'clash' || s.phase === 'defend') cur = 'Battle';
    else if (s.active === 'you') cur = s.phase === 'ending' ? 'End' : (s.attacker != null ? 'Battle' : (this.chargePhase(s) ? 'Charge' : 'Main'));
    else cur = s.aiStage === 'charge' ? 'Charge' : s.aiStage === 'play' ? 'Main' : s.aiStage === 'attack' ? 'Battle' : 'End';
    const ci = order.indexOf(cur);
    const phases = order.map((l, i) => ({ label: l, cls: 'ph ' + (i < ci ? 'done' : i === ci ? 'now' : '') }));

    const speedLabel = s.speed === 0 ? 'Instant' : s.speed + '×';
    const setSpeed = (v) => () => this.upd((x) => { x.speed = v; });
    const beatsView = s.beats.slice(0, 50).map((b) => ({ id: b.i, t: 'T' + b.turn, s: b.side === 'ai' ? 'CL' : b.side === 'you' ? 'YOU' : 'SYS', kind: b.kind, detail: b.detail + (b.legal !== '—' ? ` · legal ${b.legal}` : ''), why: b.why, hasWhy: !!b.why, cls: 'ab ' + b.side }));

    return {
      rootCls: ['arena', desk ? 'desk' : 'phone', s.skin === 'night' ? 'night' : 'sky', 'turn-' + s.active, s.shake ? 'shaking' : '', defend ? 'defending' : ''].filter(Boolean).join(' '),
      skinSeg: [{ label: 'Anime sky', v: 'sky' }, { label: 'Night', v: 'night' }].map((o) => ({ label: o.label, cls: s.skin === o.v ? 'on' : '', run: () => this.upd((x) => { x.skin = o.v; }) })),
      openReview: () => this.openReview(),
      insp, noInsp: !insp, sheetOpen: !desk && !!insp, sheetCls: 'sheet' + (insp ? ' open' : ''),
      swStart: (e) => this.swStart(e), swEnd: (e) => this.swEnd(e),
      inplay, inplayCls: 'inplay' + (s.tab === 'play' ? ' open' : ''),
      tabPlay: s.tab === 'play' ? 'on' : '', tabLog: s.tab === 'log' ? 'on' : '',
      showPlay: () => this.upd((x) => { x.tab = 'play'; }), showLog: () => this.upd((x) => { x.tab = 'log'; }),
      k: String(k),
      turn: s.turn, turnWho: s.active === 'you' ? 'YOUR TURN' : "CLAUDE'S TURN",
      speedLabel, cycleSpeed: () => this.upd((x) => { x.speed = x.speed === 1 ? 2 : x.speed === 2 ? 0 : 1; }),
      showShield: this.props.admin !== false,
      toggleAdmin: () => this.upd((x) => { x.adminOpen = !x.adminOpen; x.menuOpen = false; }),
      toggleMenu: () => this.upd((x) => { x.menuOpen = !x.menuOpen; }),
      toggleLog: () => this.upd((x) => { if (desk) { x.tab = 'log'; } else { x.logOpen = !x.logOpen; x.sel = null; } x.menuOpen = false; }),
      closeLog: () => this.upd((x) => { x.logOpen = false; }),
      menuOpen: s.menuOpen, adminOpen: s.adminOpen,
      seg: [{ label: '1×', v: 1 }, { label: '2×', v: 2 }, { label: 'Instant', v: 0 }].map((o) => ({ label: o.label, cls: s.speed === o.v ? 'on' : '', run: setSpeed(o.v) })),
      restart: () => this.restart(),
      phases,
      mrows: [
        { name: 'Claude', sub: 'AI opponent', av: 'C', avCls: 'av av-ai', life: s.ai.life, cls: 'mrow' + (s.active === 'ai' ? ' on' : ''), acting: s.active === 'ai' },
        { name: 'You', sub: 'Crimson Ascendant', av: 'Y', avCls: 'av av-you', life: s.you.life, cls: 'mrow' + (s.active === 'you' ? ' on' : ''), acting: s.active === 'you' }
      ],
      ai: sideOf('ai'), you: sideOf('you'),
      aiThinking: s.active === 'ai' && s.phase === 'ai' && !s.winner,
      ribbon: { text: s.ribbon.text, cls: `ribbon s-${s.ribbon.side} ${s.ribbon.n % 2 ? 'ra' : 'rb'}` },
      hand, drag,
      rowMeCls: 'row me' + (drag ? (drag.boardOk ? ' drop-ok' : ' drop-no') + (s.drag.over === 'board' ? ' drop-hot' : '') : ''),
      stripMeCls: 'strip me' + (drag ? (drag.energyOk ? ' drop-ok' : ' drop-no') + (s.drag.over === 'energy' ? ' drop-hot' : '') : ''),
      closeSheet: () => this.closeSheet(),
      logCls: 'log' + ((desk ? s.tab === 'log' : s.logOpen) ? ' open' : ''),
      logLines: s.log.map((l) => ({ id: l.id, turn: l.turn, text: l.text, cls: 'll ' + l.side })),
      clash,
      banner: s.banner ? { cls: 'banner ' + (s.banner.side === 'you' ? 'b-you' : 'b-ai'), text: s.banner.text, sub: s.banner.sub } : null,
      flash: !!s.flash,
      float: s.float ? { cls: 'float ' + (s.float.side === 'ai' ? 'f-ai' : s.float.side === 'energy' ? 'f-energy' : 'f-you'), text: s.float.text } : null,
      showSkip: this.chargePhase(s), skipCharge: () => this.skipCharge(),
      over: s.winner ? { cls: 'over ' + (s.winner === 'you' ? 'win' : 'lose'), title: s.winner === 'you' ? 'VICTORY' : 'DEFEAT', sub: s.winner === 'you' ? `Claude's leader falls on turn ${s.turn}.` : `Your leader falls on turn ${s.turn}.` } : null,
      prompt, promptCls,
      showEnd: main && s.attacker == null, endCls: 'btn ' + (mv ? 'ghost' : 'primary nudge'), endTurn: () => this.endTurn(),
      showCancelAtk: main && s.attacker != null, cancelAtk: () => this.cancelAtk(),
      showDefend: defend, lockIn: () => this.lockIn(), takeHit: () => this.takeHit(), lockLabel, lockDisabled,
      showWaiting: s.active === 'ai' && !defend && !s.winner,
      admin: {
        seed: String(s.seed), turn: `${s.turn} · ${s.active === 'you' ? 'player' : 'Claude'}`, phase: `${s.phase}${s.aiStage ? ' / ' + s.aiStage : ''}`, speed: speedLabel,
        aiHand: s.ai.hand.map((h) => C[h.k].name).join(', ') || '—', aiDeck: String(s.ai.deck.length), youDeck: String(s.you.deck.length),
        flagged: s.flagged.length ? s.flagged.map((t) => 'T' + t).join(', ') : 'none',
        flagLabel: s.flagged.includes(s.turn) ? `Unflag turn ${s.turn}` : `Flag turn ${s.turn}`,
        beats: beatsView
      },
      flagTurn: () => this.upd((x) => { const i = x.flagged.indexOf(x.turn); if (i >= 0) x.flagged.splice(i, 1); else x.flagged.push(x.turn); }),
      icons: {
        menu: 'M4 7h16M4 12h16M4 17h16', shield: 'M12 3l7 3v6c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6zM9.5 12l2 2 3.5-4', close: 'M6 6l12 12M18 6 6 18', log: 'M5 6h14M5 12h14M5 18h9',
        eye: 'M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', prev: 'M15 5l-7 7 7 7', next: 'M9 5l7 7-7 7'
      }
    };
  }
}
