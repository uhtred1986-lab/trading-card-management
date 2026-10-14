/*
 * Issue #788 — a clickable phone prototype of the Arena.
 *
 * Not the engine: one scripted match between the two audited Masters decks (SD15 "Pride of the
 * Saiyans" vs SD5 "The Crimson Saiyan"), starting on your sixth turn, with just enough rules to make
 * each decision honest — energy, costs, rested/active, [Barrier], [Blocker], [Double Strike], combos,
 * the counter → block → combo order of a defence, and "ties go to the attacker" (vm/battle.ts).
 *
 * The markup reuses the app's own classes (app.css is the app's compiled CSS), so what is unchanged
 * looks as it does on /arena/local today. Everything new is a `proto-*` class in proto.css.
 *
 * Plain script, no build step, no dependencies.
 */
"use strict";
(() => {
  // ── Cards (texts from the audited catalog subset, docs/arena-backlog/evidence/649) ─────────────────
  const CARDS = {
    "SD15-01": { name: "Vegeta", type: "Leader", power: 10000, onAttack: { draw: 1, bonus: 5000 },
      text: "[Auto] When this card attacks, draw 1 card, then it gets +5000 power for the turn.\n[Awaken] When your life is at 4 or less or you have a red Unison Card with a specified cost of 2 in play: You may switch up to 2 of your energy to Active Mode, add cards from your life to your hand until you have 5 life left, choose up to 1 of your red Unison Cards with {Cabba} in its name and add a marker to it, then flip this card over." },
    "SD5-01": { name: "Golden Great Ape Son Goku", type: "Leader", power: 10000,
      text: "[Auto] When this card attacks a Leader Card, draw 1 card.\n[Awaken] When your life is at 4 or less: You may choose up to 2 of your energy, switch them to Active Mode, and flip this card over." },
    "BT11-008": { name: "Son Goku, Saiyan Youth", type: "Battle", cost: 1, power: 4000, combo: 5000, blocker: true,
      text: "[Blocker]\n[Auto] If you have a red Unison Card in play: When this card is played, draw 1 card." },
    "BT11-011": { name: "Vegeta, Saiyan Youth", type: "Battle", cost: 2, power: 10000, combo: 5000, onPlay: "unisonMarker",
      text: "[Auto] If your Leader Card is red: When this card is played from your hand, choose up to 1 of your red Unison Cards and add a marker to it." },
    "BT6-025": { name: "Transcendent Strike", type: "Extra", cost: 1, onPlay: "koUpTo20k",
      text: "[Activate: Main] If your Leader Card is red: Choose up to 1 of your opponent's Battle Cards with 20000 power or less and KO it." },
    "SD15-03": { name: "Son Goku, Spirit Boost Warrior", type: "Battle", cost: 4, power: 20000, combo: 5000, strike: 2,
      text: "[Deflect][Double Strike][Dual Attack]\n[Permanent] If this card is in Rest Mode and you have a red Unison Card with a specified cost of 2 in play, this card and your red Leader Card get +1000 power.\n[Auto][Limit 1][Spirit Boost 1] When this card is placed in your Drop Area from your Battle Area by an opponent's skill or KO'd, play this card from your Drop Area." },
    "BT14-010": { name: "Tien Shinhan, Universe 7 Challenger", type: "Battle", cost: 2, power: 15000, combo: 10000, superCombo: true,
      text: "[Super Combo]\n[Auto] If your Leader Card is red and your life is at 4 or less: When this card is used in a combo, draw 1 card." },
    "BT3-027": { name: "Unending Awakening", type: "Extra", cost: 1, counter: true,
      text: "[Counter: Attack] Negate the attack. Then, choose up to 1 of your red ≪Saiyan≫ Leader Cards. It gains +5000 power for the duration of the turn." },
    "BT14-006": { name: "Super Saiyan Son Goku", type: "Battle", cost: 2, power: 20000, combo: 5000, text: "" },
    "BT4-089": { name: "Dynasty's Solace Chi-Chi", type: "Battle", cost: 1, power: 5000, combo: 5000,
      text: "[Auto] When you play this card, look at up to 3 cards from the top of your deck, choose up to 1 ≪Goku's Lineage≫ from among them and add it to your hand, then shuffle your deck." },
    "BT4-085": { name: "Prodigal Dynasty Son Goten", type: "Battle", cost: 3, power: 15000, combo: 5000,
      text: "[Swap 4] {y}{y}: ≪Goku's Lineage≫ with an energy cost of 4. (Play the specified card from your hand, then return this card to your hand)\n[Auto] When you combo with this card, if one of your yellow Battle Cards is being attacked, this card gains +10000 combo power for the duration of the turn." },
    "SD5-03": { name: "SSB Son Goku, at the Apex", type: "Battle", cost: 5, power: 25000, combo: 10000, barrier: true, strike: 2,
      text: "[Swap 8] {y}{y}{y}{y}: ≪Goku's Lineage≫ with an energy cost of 8. (Play the specified card from your hand, then return this card to your hand)\n[Barrier] (This card can't be chosen by the skills of your opponent's cards)\n[Double Strike] (This card inflicts 2 damage instead of 1 when attacking)\n[Auto] When you play this card, if your Leader Card is ≪Goku's Lineage≫, choose up to 1 of your opponent's Battle Cards and KO it." },
    "BT4-084": { name: "Intrepid Dynasty Son Gohan", type: "Battle", cost: 2, power: 10000, combo: 5000, barrier: true,
      text: "[Swap 3] {y}{y}: ≪Goku's Lineage≫ with an energy cost of 3. (Play the specified card from your hand, then return this card to your hand)\n[Barrier] (This card can't be chosen by the skills of your opponent's cards)" },
  };
  // The two audited decklists (count, name, type, energy cost), from the offline pack (#655).
  const DECKS = {
    you: { name: "[Starter] Pride of the Saiyans", leader: "SD15-01", rows: [[2, "Master Roshi, Potential Unleashed", "Unison", null], [2, "SS Cabba, Spirit Resonance", "Unison", null], [2, "Cabba's Awakening", "Extra", "0"], [2, "Strategies of Universe 7", "Extra", "0"], [3, "Afterimage Technique", "Extra", "1"], [2, "Bulma, from the Sidelines", "Battle", "1"], [2, "Intensifying Power Trunks", "Battle", "1"], [2, "Is That All You've Got?", "Extra", "1"], [2, "Piccolo, Namekian Fortification", "Battle", "1"], [2, "Saiyan Cabba", "Battle", "1"], [2, "Son Goku, Saiyan Youth", "Battle", "1"], [2, "Transcendent Strike", "Extra", "1"], [2, "Unending Awakening", "Extra", "1"], [2, "Android 18, Steadfast Technique", "Battle", "2"], [2, "Niagara Drop", "Extra", "2"], [2, "Super Saiyan Son Goku", "Battle", "2"], [4, "Tien Shinhan, Universe 7 Challenger", "Battle", "2"], [2, "Vegeta, Saiyan Youth", "Battle", "2"], [2, "Infinite Energy Android 18", "Battle", "3"], [2, "Support Attack Trunks", "Battle", "3"], [1, "Yamcha, Merciless Barrage", "Battle", "3"], [2, "Son Goku, Spirit Boost Warrior", "Battle", "4"], [2, "Surprise Attack SSB Vegeta", "Battle", "4"], [2, "Surprise Attack Son Gohan", "Battle", "4"]] },
    opp: { name: "[Starter] The Crimson Saiyan", leader: "SD5-01", rows: [[2, "10x Kamehameha", "Extra", "1"], [4, "Adoptive Father Son Gohan", "Battle", "1"], [4, "Dynasty's Solace Chi-Chi", "Battle", "1"], [4, "Instant Transmission", "Extra", "1"], [4, "Dependable Dynasty Son Goku", "Battle", "2"], [4, "Intrepid Dynasty Son Gohan", "Battle", "2"], [2, "Unbroken Dynasty Son Goku", "Battle", "2"], [4, "Indomitable Dynasty SS Son Goku", "Battle", "3"], [2, "Power Charge Bardock", "Battle", "3"], [4, "Prodigal Dynasty Son Goten", "Battle", "3"], [2, "Ultimate Potential SS2 Son Gohan", "Battle", "3"], [4, "Dynasty Deferred Son Goku", "Battle", "4"], [4, "Plucky Dynasty Pan", "Battle", "4"], [2, "Reborn Might SS4 Son Goku", "Battle", "5"], [4, "SSB Son Goku, at the Apex", "Battle", "5"]] },
  };
  const OPP = "Claude";
  const art = (id) => `art/${id}.png`;
  const fmt = (n) => n.toLocaleString("en-US");
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
  const kfmt = (n) => (n % 1000 === 0 ? `${n / 1000}k` : fmt(n));

  // ── State ───────────────────────────────────────────────────────────────────────────────────────
  let S;
  let uidN = 0;
  const inst = (id, mode = "active") => ({ uid: `c${++uidN}`, id, mode, bonus: 0 });
  const C = (c) => CARDS[c.id];
  const power = (c) => (C(c).power ?? 0) + (c.bonus || 0);

  function fresh() {
    uidN = 0;
    const you = {
      key: "you", name: DECKS.you.name,
      leader: inst("SD15-01"),
      battle: [inst("BT11-008")],
      energy: 5, energyRested: 0,
      life: 6, deck: 31, drop: [],
      hand: ["BT11-011", "BT6-025", "SD15-03", "BT14-010", "BT3-027", "BT14-006"].map((id) => inst(id)),
    };
    const opp = {
      key: "opp", name: DECKS.opp.name,
      leader: inst("SD5-01"),
      battle: [inst("BT4-089", "rest"), inst("BT4-085"), inst("SD5-03")],
      energy: 6, energyRested: 6,
      life: 5, deck: 30, drop: [], handCount: 4,
    };
    return {
      screen: "board", turn: 6, turnOf: "you", phase: "Charge",
      you, opp,
      attacked: new Set(), oppComboLeft: 1,
      narration: { text: "Your turn 6 begins. You draw a card.", who: "you" },
      sheet: null, mode: null, banner: null, verdict: null, arrow: null, busy: false,
      fx: {}, recap: [],
      cardLayout: (() => { try { const v = localStorage.getItem("proto788.cardLayout"); if (v === "full" || v === "half") return v; } catch { /* storage may be blocked */ } return "full"; })(),
    };
  }

  const all = (side) => [side.leader, ...side.battle];
  const sideOf = (uid) => (all(S.you).some((c) => c.uid === uid) || S.you.hand.some((c) => c.uid === uid) ? S.you : S.opp);
  const find = (uid) => [...all(S.you), ...all(S.opp), ...S.you.hand].find((c) => c.uid === uid);
  const ready = (side) => side.energy - side.energyRested;
  const isLeader = (c) => C(c).type === "Leader";
  const roleWord = (c) => (isLeader(c) ? "Leader" : C(c).type === "Extra" ? "Extra Card" : "Battle Card");

  // ── Rules the prototype needs ────────────────────────────────────────────────────────────────────
  /** Battle Cards an effect "choose up to 1 of your opponent's Battle Cards with 20000 power or less" can choose. */
  function koTargets() {
    const valid = [], why = {};
    why[S.opp.leader.uid] = "Leader — not a Battle Card";
    for (const c of S.opp.battle) {
      if (C(c).barrier) why[c.uid] = "[Barrier] — your skills can't choose it";
      else if (power(c) > 20000) why[c.uid] = `${fmt(power(c))} — over 20,000`;
      else valid.push(c.uid);
    }
    return { valid, why };
  }
  /** What a hand card can do in the Main Phase, and why not. */
  function playability(c) {
    const d = C(c);
    if (d.counter) return { ok: false, tag: "counter", short: "Counter", why: "A Counter card: you use it when Claude attacks, not now." };
    if (ready(S.you) < d.cost) return { ok: false, tag: "short", short: `Need ${d.cost} ⚡`, why: `Costs ${d.cost} energy — you have ${ready(S.you)} ready.` };
    if (d.onPlay === "unisonMarker") return { ok: true, tag: "warn", short: "No target", why: "Its skill needs one of your red Unison Cards, and you have none in play." };
    if (d.onPlay === "koUpTo20k") {
      const t = koTargets();
      return t.valid.length ? { ok: true, tag: "play", short: `Play · ${t.valid.length} targets`, targets: t.valid.length } : { ok: true, tag: "warn", short: "No target", why: "No Battle Card of Claude's can be chosen." };
    }
    return { ok: true, tag: "play", short: "Play" };
  }
  /** Who the selected attacker may attack: the Leader, or a Battle Card in Rest Mode (8-1-1). */
  function attackTargets() {
    const valid = [S.opp.leader.uid], why = {};
    for (const c of S.opp.battle) {
      if (c.mode === "rest") valid.push(c.uid);
      else why[c.uid] = "Active — only rested Battle Cards can be attacked";
    }
    return { valid, why };
  }
  const canAttack = (c) => S.turnOf === "you" && S.phase === "Main" && c.mode === "active" && !S.attacked.has(c.uid) && all(S.you).includes(c);

  // ── Rendering ────────────────────────────────────────────────────────────────────────────────────
  const $app = document.getElementById("app");
  let skin = (() => {
    try { const s = localStorage.getItem("proto788.skin"); if (s === "anime" || s === "night") return s; } catch { /* storage may be blocked */ }
    const t = document.documentElement.getAttribute("data-theme");
    if (t === "dark") return "night";
    if (t === "light") return "anime";
    return matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "anime";
  })();

  function turnVars() {
    const yours = S.turnOf === "you";
    const lead = yours ? "SD15-01" : "SD5-01";
    return `--turn-y:${yours ? "88%" : "12%"};--turn-mode:1;--turn-k:${yours ? 0.95 : 0.88};--turn-art:url('${art(lead)}');--turn-art-on:1;--turn-tint:${yours ? "#e5484d" : "#e8c020"};--turn-glow:${yours ? "#ff7a6b" : "#ffe36b"};`;
  }

  /** One card, in the app's ArenaCard markup. `o.w` is the upright width in px. */
  function cardHTML(c, o = {}) {
    const d = C(c);
    const w = o.w ?? 58;
    const h = Math.round((w * 88) / 63);
    const rest = c.mode === "rest";
    const ring = o.ring ? ` ${o.ring}` : "";
    const p = d.power != null ? power(c) : null;
    const costBadge = d.cost != null && o.cost !== false
      ? `<span class="arena-cost absolute left-[2px] top-[2px] grid place-items-center rounded-full arena-num leading-none ${o.costClass ?? "bg-ki-500"} text-space-50 proto-cost" style="font-size:${Math.max(9, w * 0.14)}px;width:${Math.max(14, w * 0.22)}px;height:${Math.max(14, w * 0.22)}px">${d.cost}</span>` : "";
    const combo = o.combo && d.combo ? `<span class="absolute right-[2px] top-[2px] rounded-full bg-dbs-blue/90 px-[3px] arena-num leading-none text-space-50" style="font-size:${Math.max(8, w * 0.11)}px;padding-block:2px">+${kfmt(d.combo)}</span>` : "";
    return `<div data-arena-card="${c.uid}" data-uid="${c.uid}" class="relative flex shrink-0 items-center justify-center proto-cardbox${o.box ? " " + o.box : ""}" style="width:${rest ? h : w}px;height:${h}px">
      <button type="button" data-act="${o.act ?? "inspect"}" data-uid="${c.uid}" aria-label="${esc(d.name)}${p != null ? `, ${p} power` : ""}${rest ? ", rested" : ""}" class="arena-card absolute overflow-hidden rounded-[4px] border border-space-600 bg-space-800 text-left transition-all duration-200${ring}" style="width:${w}px;height:${h}px;transform:rotate(${rest ? 90 : 0}deg)">
        <img alt="" draggable="false" src="${art(c.id)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">
        ${p != null && o.power !== false ? `<span class="arena-power absolute inset-x-0 bottom-0 bg-space-950/85 px-[3px] py-[1px] text-center arena-num text-space-50${c.bonus > 0 ? " proto-pow-up" : ""}" style="font-size:${Math.max(9, w * 0.13)}px">${fmt(p)}</span>` : ""}
        ${costBadge}${combo}
      </button>${o.extra ?? ""}</div>`;
  }

  function tagHTML(text, kind, pos = "top") {
    return `<span class="proto-tag proto-tag-${kind} proto-tag-${pos}">${text}</span>`;
  }

  function stripHTML(side) {
    const them = side.key === "opp";
    const chips = Array.from({ length: side.energy }, (_, i) => {
      const off = i >= side.energy - side.energyRested;
      const will = !them && S.willPay && !off && i >= side.energy - side.energyRested - S.willPay;
      return `<i class="arena-ec block h-[14px] w-[9px] shrink-0${will ? " arena-will" : ""}"${them ? " data-them" : ""}${off ? " data-off" : ""}></i>`;
    }).join("");
    const lifeHurt = S.fx[`life-${side.key}`] ? " proto-hurt" : "";
    return `<div class="arena-pstrip relative flex min-w-0 items-center gap-2 px-2 text-xs proto-strip" data-side="${side.key}">
      <button type="button" class="proto-strip-name flex min-w-0 shrink items-center gap-1.5 font-bold text-space-50" data-act="zones" data-side="${side.key}" aria-label="${esc(side.name)}: deck, drop and decklist">
        <span class="arena-avatar grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full text-xs"${them ? " data-them" : ""} aria-hidden="true">${them ? "C" : "Y"}</span>
        <span class="truncate text-[13px]">${them ? OPP : "You"}</span>
      </button>
      <span class="proto-meter${lifeHurt}" role="img" aria-label="${side.life} life">
        <span class="proto-meter-k">Life</span><b class="arena-num proto-meter-n">${side.life}</b>
      </span>
      <button type="button" class="proto-meter proto-energy" data-act="zones" data-side="${side.key}" aria-label="${ready(side)} of ${side.energy} energy ready">
        <span class="proto-meter-k">⚡</span><b class="arena-num proto-meter-n">${ready(side)}<small>/${side.energy}</small></b>
        <span class="flex shrink-0 gap-[2px] proto-chips">${chips}</span>
      </button>
      <button type="button" class="proto-counts ml-auto" data-act="zones" data-side="${side.key}" aria-label="Hand, deck and drop">
        ${them ? `<span class="proto-count"><small>hand</small><b>${side.handCount}</b></span>` : ""}<span class="proto-count"><small>deck</small><b>${side.deck}</b></span><span class="proto-count"><small>drop</small><b>${side.drop.length}</b></span>
      </button>
    </div>`;
  }

  /** What every card on the board wears right now: ring class, a tag, and what a tap does. */
  function boardDecor(c, side) {
    const m = S.mode;
    const out = { ring: "", tag: "", act: "inspect", box: "" };
    if (S.sheet?.kind === "card" && S.sheet.uid === c.uid) out.box = "proto-inspected";
    if (!m) {
      if (side === S.you && canAttack(c) && !S.busy) { out.ring = "arena-ring-legal ring-2 ring-ki-400"; out.tag = `<span class="proto-canatk" aria-hidden="true">⚔</span>`; }
      return out;
    }
    if (m.kind === "attack") {
      if (c.uid === m.attacker) { out.ring = "arena-ring-attacker ring-2 ring-ki-300"; out.tag = tagHTML("Attacker", "atk", "bottom"); out.act = "noop"; return out; }
      if (side === S.opp) {
        const t = attackTargets();
        if (m.target === c.uid) { out.ring = "arena-ring-guard ring-2 ring-loss proto-target-on"; out.tag = tagHTML(`Target · ${roleWord(c)}`, "target", "top"); out.act = "noop"; }
        else if (t.valid.includes(c.uid)) { out.ring = "arena-ring-legal ring-2 ring-ki-400 proto-pick"; out.tag = tagHTML(isLeader(c) ? "Leader · tap" : "Rested · tap", "pick", "top"); out.act = "pickAttackTarget"; }
        else { out.ring = "proto-dim"; out.tag = tagHTML("✕ Active", "no", "top"); out.act = "inspect"; }
      } else if (side === S.you) out.ring = "proto-dim-soft";
      return out;
    }
    if (m.kind === "target") {
      if (side === S.opp) {
        if (m.picked === c.uid) { out.ring = "arena-ring-guard ring-2 ring-loss proto-target-on"; out.tag = tagHTML("KO this?", "target", "top"); out.act = "noop"; }
        else if (m.valid.includes(c.uid)) { out.ring = "arena-ring-legal ring-2 ring-ki-400 proto-pick"; out.tag = tagHTML("Tap to KO", "pick", "top"); out.act = "pickKoTarget"; }
        else { out.ring = "proto-dim"; out.tag = tagHTML(m.why[c.uid]?.split(" — ")[0] ?? "Can't be chosen", "no", "top"); }
      } else out.ring = "proto-dim-soft";
      return out;
    }
    if (m.kind === "defend") {
      if (c.uid === m.attacker) { out.ring = "arena-ring-attacker ring-2 ring-ki-300"; out.tag = tagHTML(`Attacker · ${fmt(m.atk)}`, "atk", "bottom"); }
      else if (c.uid === m.guard) { out.ring = "arena-ring-guard ring-2 ring-loss proto-target-on"; out.tag = tagHTML("Target", "target", side === S.you ? "bottom" : "top"); }
      else if (m.step === "block" && side === S.you && blockers().some((b) => b.uid === c.uid)) { out.ring = "arena-ring-legal ring-2 ring-ki-400 proto-pick"; out.tag = tagHTML("Blocker · tap", "pick", "top"); out.act = "block"; }
      else if (m.step === "combo" && side === S.you && comboCandidates().some((b) => b.uid === c.uid)) {
        const on = m.combos.includes(c.uid);
        out.ring = on ? "arena-ring-selected ring-2 ring-ki-300" : "arena-ring-legal ring-2 ring-ki-400 proto-pick";
        out.tag = tagHTML(on ? `✓ +${kfmt(C(c).combo)}` : `+${kfmt(C(c).combo)} · tap`, on ? "go" : "pick", "top"); out.act = "toggleCombo";
      }
      return out;
    }
    return out;
  }

  function rowHTML(side) {
    const them = side.key === "opp";
    const k = S.k * (S.mode && (S.mode.kind === "defend" || (S.mode.kind === "attack" && S.mode.target)) ? 0.86 : 1);
    const lw = Math.round(76 * k); let bw = Math.round(60 * k);
    const avail = (S.boardW || 360) - 16 - lw - 44;
    const need = side.battle.reduce((a, c) => a + (c.mode === "rest" ? bw * 88 / 63 : bw), 0) + 6 * Math.max(0, side.battle.length - 1);
    if (need > avail) bw = Math.floor(bw * avail / need);
    const lead = side.leader;
    const ld = boardDecor(lead, side);
    const on = S.turnOf === side.key;
    const leaderHTML = `<div class="relative mr-[3px] shrink-0 proto-leaderbay">
      <span class="arena-leader ${on ? "arena-leader-on" : "arena-leader-off"}" style="display:block;width:${lead.mode === "rest" ? Math.round(lw * 88 / 63) : lw}px;height:${Math.round(lw * 88 / 63)}px">
        ${cardHTML(lead, { w: lw, ring: ld.ring, act: ld.act, box: ld.box + (S.fx[lead.uid] ? " " + S.fx[lead.uid] : ""), extra: ld.tag })}
        ${on ? '<span class="arena-leader-ring" aria-hidden="true"></span>' : ""}
        <span class="arena-leader-tag" data-leader-label="${side.key}"${them ? " data-them" : ""}>Leader</span>
      </span></div>`;
    const cards = side.battle.map((c) => {
      const d = boardDecor(c, side);
      return cardHTML(c, { w: bw, ring: d.ring, act: d.act, box: d.box + (S.fx[c.uid] ? " " + S.fx[c.uid] : ""), extra: d.tag });
    }).join("");
    const slots = Array.from({ length: Math.max(0, 3 - side.battle.length) }, () => `<span class="arena-slot block proto-slot" aria-hidden="true" style="width:${bw}px;height:${Math.round(bw * 88 / 63)}px"></span>`).join("");
    return `<div class="arena-field relative proto-rowwrap" data-row="${side.key}">
      <div aria-label="${them ? "Claude's" : "Your"} Battle Area" class="arena-row ${on ? "arena-row-on " : ""}flex items-center proto-row">
        ${leaderHTML}
        <span class="proto-bayline" aria-hidden="true"></span>
        <div class="arena-battle-cards relative flex min-w-0 items-center proto-battle">${cards}${slots}</div>
      </div></div>`;
  }

  function laneHTML() {
    const m = S.mode;
    if (m && (m.kind === "attack" && m.target || m.kind === "defend")) return `<div class="arena-field arena-lane-battle proto-lane">${clashHTML()}</div>`;
    if (m && m.kind === "target") {
      return `<div class="arena-field arena-lane proto-lane"><div class="proto-instruct"><img src="${art("BT6-025")}" alt=""><div><b>Transcendent Strike</b><span>KO up to 1 of ${OPP}'s Battle Cards with 20,000 power or less. ${m.valid.length} can be chosen.</span></div></div></div>`;
    }
    const n = S.narration;
    return `<div class="arena-field arena-lane relative flex flex-1 items-center justify-center px-3 py-1.5 proto-lane">
      <div class="arena-lanepill relative z-[1] flex max-w-full items-center gap-2 rounded-full py-2 pl-3 pr-3 text-left text-sm font-semibold leading-snug proto-pill">
        <span class="arena-lanepill-dot h-[9px] w-[9px] shrink-0 rounded-full" ${n.who === "opp" ? "data-them" : "data-mine"} aria-hidden="true"></span>
        <span class="arena-drop line-clamp-2 min-w-0" aria-live="polite">${esc(n.text)}</span>
        ${S.busy && S.playback ? `<button type="button" class="proto-ff" data-act="fastForward" aria-label="Fast-forward the replay">⏩<span>Fast-forward</span></button>` : ""}
      </div></div>`;
  }

  /** The battle, as the lane shows it: who attacks whom, each side's power, and what happens. */
  function clashHTML() {
    const m = S.mode;
    let atkCard, guardCard, atkPow, guardPow, atkNote = "", guardNote = "", combos = [], pending = false, title;
    if (m.kind === "attack") {
      atkCard = find(m.attacker); guardCard = find(m.target);
      const bonus = m.bonusApplied ? 0 : C(atkCard).onAttack?.bonus ?? 0;
      atkPow = power(atkCard) + bonus; guardPow = power(guardCard);
      if (bonus) atkNote = `${fmt(power(atkCard))} +${fmt(bonus)} from its [Auto] when it attacks`;
      title = "Your attack";
    } else {
      atkCard = find(m.attacker); guardCard = find(m.guard);
      atkPow = m.atk; guardPow = power(guardCard) + comboTotal();
      combos = m.combos.map((u) => find(u)); pending = m.step === "combo";
      title = `${OPP} attacks`;
    }
    const hit = atkPow >= guardPow;
    const tie = atkPow === guardPow;
    const whose = (c) => (sideOf(c.uid) === S.you ? "Your" : `${OPP}'s`);
    const line = (c, pw, kind, note, extra = "") => `<div class="proto-cl" data-role="${kind}">
        <span class="proto-cl-role">${kind === "atk" ? "Attacker" : "Target"}</span>
        <span class="proto-cl-name"><b>${esc(C(c).name)}</b><small>${whose(c)} ${isLeader(c) ? "Leader" : "Battle Card"}</small></span>
        <span class="arena-clash-pow proto-pow">${fmt(pw)}</span>${note ? `<span class="proto-cl-note">${note}</span>` : ""}${extra}</div>`;
    const comboRow = combos.length && !pending ? `<span class="arena-clash-combos">${combos.map((c) => `<span class="arena-clash-combo${pending ? " arena-clash-combo-pending" : ""}">+${kfmt(C(c).combo)} ${esc(C(c).name.split(",")[0])}</span>`).join("")}${pending && !combos.length ? '<span class="arena-clash-combo arena-clash-combo-pending">+ combo?</span>' : ""}</span>` : "";
    const atkLine = line(atkCard, atkPow, "atk", atkNote);
    const defLine = line(guardCard, guardPow, "def", guardNote, comboRow);
    const atkIsYou = sideOf(atkCard.uid) === S.you;
    // Claude's side is on top of the board, so the clash keeps the same order: top line = Claude's card.
    const foot = `<div class="proto-clash-foot"><span class="proto-clash-verdict" data-hit="${hit}">${hit ? (tie ? "Tie → attacker wins" : "Gets through") : "Attack fails"}</span><span class="proto-clash-stakes">${stakesLine(atkCard, guardCard, atkPow, guardPow, true)}</span></div>`;
    return `<div class="proto-clash" data-hit="${hit}" data-dir="${atkIsYou ? "up" : "down"}" aria-label="${title}">
      ${atkIsYou ? defLine + atkLine : atkLine + defLine}${foot}
    </div>`;
  }

  function stakesLine(atk, guard, atkPow, guardPow, short = false) {
    const hit = atkPow >= guardPow;
    const dmg = C(atk).strike ?? 1;
    const gs = sideOf(guard.uid);
    const pre = short ? "" : "If nothing changes: ";
    if (!hit) return `${pre}nothing happens`;
    if (isLeader(guard)) return `${pre}${gs === S.you ? "you take" : `${OPP} takes`} ${dmg} damage${dmg > 1 ? " (Double Strike)" : ""} · life ${gs.life} → ${Math.max(0, gs.life - dmg)}`;
    return `${pre}${esc(C(guard).name.split(",")[0])} is KO'd`;
  }

  function handHTML() {
    const w = Math.round((S.mode?.kind === "defend" ? 66 : 84) * S.k2);
    const n = S.you.hand.length;
    // A big hand fans: every card stays on screen, overlapped, its cost and top edge showing.
    const fan = n > 6;
    const avail = (S.boardW || 360) - 24 - 64;
    const overlap = fan ? Math.max(0, Math.ceil((n * w - avail) / (n - 1))) : 0;
    const items = S.you.hand.map((c, i) => {
      let chip = "", cls = "", act = "inspect", costClass = "bg-ki-500", combo = false;
      const m = S.mode;
      if (S.turnOf === "you" && S.phase === "Charge" && !S.busy && !m) { cls = "arena-chargeable"; chip = `<span class="proto-hchip proto-hchip-charge">Charge</span>`; }
      else if (S.turnOf === "you" && S.phase === "Main" && !S.busy && !m) {
        const p = playability(c);
        if (!p.ok) { cls = "proto-hand-off"; costClass = p.tag === "short" ? "bg-loss" : "bg-space-500"; }
        else cls = "proto-hand-on";
        chip = `<span class="proto-hchip proto-hchip-${p.tag}">${p.tag === "play" ? "▲ " : p.tag === "warn" ? "⚠ " : p.tag === "short" ? "" : ""}${esc(p.short)}</span>`;
        if (p.ok && C(c).cost != null && C(c).cost > ready(S.you)) costClass = "bg-loss";
      } else if (m?.kind === "defend" && m.step === "combo" && C(c).combo) {
        combo = true;
        const on = m.combos.includes(c.uid);
        const blocked = !on && C(c).superCombo && m.combos.some((u) => C(find(u)).superCombo);
        cls = on ? "proto-hand-picked" : blocked ? "proto-hand-off" : "proto-hand-on";
        chip = `<span class="proto-hchip proto-hchip-${on ? "play" : blocked ? "counter" : "combo"}">${on ? "✓ " : "+"}${on ? kfmt(C(c).combo) : kfmt(C(c).combo)}${blocked ? " · 1 Super Combo" : ""}</span>`;
        act = blocked ? "inspect" : "toggleCombo";
      } else if (m?.kind === "defend" && m.step === "counter" && C(c).counter) {
        cls = "proto-hand-on"; chip = `<span class="proto-hchip proto-hchip-counter">Counter</span>`; act = "inspect";
      } else if (m || S.busy || S.turnOf !== "you") cls = "proto-hand-idle";
      const picked = S.sheet?.kind === "card" && S.sheet.uid === c.uid ? " proto-inspected" : "";
      if (fan) chip = `<i class="proto-hdot proto-hdot-${handTag(c)} proto-hdot-fan" aria-hidden="true"></i>`;
      return `<div class="phone-board-module__86_vIW__handCard relative shrink-0 proto-handcard ${cls}${picked}${fan ? " proto-fan" : ""}" data-uid="${c.uid}" style="z-index:${i + 1};${fan && i ? `margin-left:-${overlap}px` : ""}">
        ${cardHTML(c, { w, act, costClass, combo, ring: cls === "proto-hand-picked" ? "arena-ring-selected ring-2 ring-ki-300" : "" })}${chip}</div>`;
    }).join("");
    const tucked = S.mode?.kind === "defend" && (S.mode.step === "counter" || S.mode.step === "block");
    if (tucked) return `<section class="arena-field arena-hand relative proto-hand proto-hand-tucked" aria-label="Your hand"><button type="button" class="proto-tuck" data-act="inspect" data-uid="${S.you.hand[0]?.uid ?? ""}">Your hand · ${S.you.hand.length} cards — not needed for this answer</button></section>`;
    return `<section class="arena-field arena-hand relative proto-hand" aria-label="Your hand">
      <div class="proto-handbar"><span>Your hand · ${n}${fan && S.phase === "Main" && S.turnOf === "you" && !S.mode ? ` · ${S.you.hand.filter((h) => playability(h).ok).length} playable` : ""}</span><span class="proto-handhint">${fan ? "Tap a card to browse the hand" : handHint()}</span></div>
      <div class="proto-handrow">
        <div class="phone-board-module__86_vIW__handViewport proto-handscroll${fan ? " proto-handfan" : ""}" tabindex="0" aria-label="Hand cards">
          <div class="phone-board-module__86_vIW__handCards flex items-end proto-handcards">${items}</div>
        </div>
        ${fan ? `<button type="button" class="proto-handopen" data-act="inspect" data-uid="${S.you.hand[0].uid}" aria-label="Open the whole hand"><b class="arena-num">${n}</b><span>Open hand</span></button>` : ""}
      </div></section>`;
  }
  function handHint() {
    if (S.turnOf === "you" && S.phase === "Main" && !S.mode && !S.busy) return "Tap a card · or drag ▲ to play";
    if (S.turnOf === "you" && S.phase === "Charge" && !S.mode) return "Tap a card to charge it";
    if (S.mode?.kind === "defend" && S.mode.step === "combo") return "Tap cards to add combo power";
    return "Tap a card to read it";
  }

  function phasesHTML() {
    const order = ["Draw", "Charge", "Main", "Battle", "End"];
    const cur = order.indexOf(S.phase);
    return `<ol class="arena-phases flex items-center proto-phases" aria-label="Phase" data-turn="${S.turnOf}">
      ${order.map((p, i) => `<li class="arena-phase flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-bold uppercase tracking-[0.1em] ${i === cur ? "arena-phase-on" : ""} ${i < cur ? "proto-phase-done" : ""}"${i === cur ? ' aria-current="step"' : ""}><span class="arena-phase-dot h-1.5 w-1.5 shrink-0 rounded-full" aria-hidden="true"></span>${p}</li>`).join("")}
    </ol>`;
  }

  function topbarHTML() {
    const yours = S.turnOf === "you";
    return `<div class="arena-topbar flex min-w-0 items-center gap-1.5 pl-2.5 pr-0.5 proto-topbar">
      <div role="status" class="arena-turnpill inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full py-1.5 pl-2 pr-2.5" data-turn="${yours ? "you" : "them"}">
        <span class="arena-turnpill-dot h-2.5 w-2.5 shrink-0 rounded-full" aria-hidden="true"></span>
        <span class="arena-turnpill-who truncate px-px text-[15px] uppercase leading-none">${yours ? "YOUR TURN" : `${OPP.toUpperCase()}'S TURN`}</span>
        <span class="arena-turnpill-num shrink-0 whitespace-nowrap text-[13px] leading-none tabular-nums">Turn ${S.turn}</span>
      </div>
      <div class="ml-auto flex shrink-0 items-center gap-0.5">
        <button type="button" class="tap flex h-11 min-w-11 items-center justify-center" data-act="speed" aria-label="Animation speed"><span class="arena-speed grid place-items-center px-2.5 leading-none">${S.fast ? "2×" : "1×"}</span></button>
        <button type="button" class="arena-iconbtn tap flex h-11 w-11 items-center justify-center" data-act="inplay" aria-label="Review cards in play"><svg viewBox="0 0 24 24" class="h-[21px] w-[21px]" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"></path><circle cx="12" cy="12" r="3"></circle></svg></button>
        <button type="button" class="arena-iconbtn tap flex h-11 w-11 items-center justify-center" data-act="menu" aria-label="Open arena settings"><svg viewBox="0 0 24 24" class="h-[21px] w-[21px]" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"></path></svg></button>
      </div></div>`;
  }

  // ── The dock: one question, its consequence, and the buttons — Pass always last, always the same shape ──
  const P = (sub, act = "pass") => ({ label: "Pass", sub, act, kind: "pass" });
  function dock() {
    const m = S.mode;
    if (S.busy) {
      if (S.turnOf === "you" && S.phase === "Battle") return { eyebrow: "Battle · resolving", text: "Watch the battle play out.", wait: true, buttons: [] };
      if (S.turnOf === "you") return { eyebrow: `Your turn · ${S.phase} phase`, text: "Your turn is starting…", wait: true, buttons: [] };
      return { eyebrow: `${OPP}'s turn · ${S.phase} phase`, text: `${OPP} is playing. You'll be asked when you can respond.`, wait: true, buttons: [] };
    }
    if (m?.kind === "attack") {
      if (!m.target) return { eyebrow: "Main phase · attack", text: `Tap what ${esc(C(find(m.attacker)).name)} attacks.`, sub: `${OPP}'s Leader, or a Battle Card in Rest Mode (turned sideways). Active Battle Cards can't be attacked.`, buttons: [P("cancel the attack", "cancelMode")] };
      const t = find(m.target);
      return { eyebrow: "Main phase · confirm attack", text: `Attack ${esc(C(t).name)} (${roleWord(t)}) with ${esc(C(find(m.attacker)).name)}?`, sub: `${OPP} can still answer with a combo or a counter.`, buttons: [{ label: "Change target", act: "retarget", kind: "ghost" }, { label: "⚔ Attack", act: "confirmAttack", kind: "primary" }] };
    }
    if (m?.kind === "target") {
      if (!m.picked) return { eyebrow: "Transcendent Strike · choose up to 1", text: `Tap one of ${OPP}'s glowing Battle Cards to KO it.`, buttons: [P("KO nothing", "koNone")] };
      return { eyebrow: "Transcendent Strike · confirm", text: `KO ${esc(C(find(m.picked)).name)}?`, buttons: [{ label: "Back", act: "unpickKo", kind: "ghost" }, { label: "KO it", act: "confirmKo", kind: "primary" }] };
    }
    if (m?.kind === "defend") return defendDock(m);
    if (S.turnOf === "you" && S.phase === "Charge") return { eyebrow: "Charge phase · your turn", text: "Charge one card from your hand as energy? It becomes 1 more ⚡ for the rest of the game.", buttons: [P("don't charge")] };
    if (S.turnOf === "you" && S.phase === "Main") {
      const plays = S.you.hand.filter((c) => playability(c).ok).length;
      const atks = all(S.you).filter(canAttack).length;
      const parts = [];
      if (plays) parts.push(`${plays} card${plays > 1 ? "s" : ""} to play`);
      if (atks) parts.push(`${atks} card${atks > 1 ? "s" : ""} can attack`);
      return { eyebrow: "Main phase · your turn", text: parts.length ? `${parts.join(" · ")}.` : "Nothing left to do this turn.", sub: parts.length ? "Tap a card to see what it does." : "", buttons: [{ label: "End turn", sub: atks ? `${atks} can still attack` : `${OPP}'s turn next`, act: "endTurn", kind: "pass" }] };
    }
    return { eyebrow: "", text: "", buttons: [] };
  }

  function defendDock(m) {
    const steps = ["counter", "block", "combo"];
    const names = { counter: "Counter", block: "Block", combo: "Combo" };
    const stepper = `<ol class="proto-steps" aria-label="Your answers to this attack"><li class="proto-steps-k">Defend</li>${steps.map((s, i) => {
      const idx = steps.indexOf(m.step);
      const st = i < idx ? (m.skipped?.includes(s) ? "skip" : "done") : i === idx ? "on" : "next";
      return `<li data-st="${st}"><b>${i + 1}</b>${names[s]}${st === "skip" ? " <small>none</small>" : ""}</li>`;
    }).join("")}</ol>`;
    if (m.step === "counter") {
      const cards = S.you.hand.filter((c) => C(c).counter);
      const opts = cards.map((c) => {
        const ok = ready(S.you) >= C(c).cost;
        return `<button type="button" class="proto-opt${ok ? "" : " proto-opt-off"}" data-act="playCounter" data-uid="${c.uid}" ${ok ? "" : "disabled"}><img src="${art(c.id)}" alt="">
          <span class="proto-opt-body"><b>${esc(C(c).name)}</b><span>Cancels the attack, your Leader +5,000</span>
          <span class="proto-opt-cost">${ok ? `Costs ${C(c).cost} ⚡ · ${ready(S.you)} ready` : `Needs ${C(c).cost} ⚡ — 0 ready (spent on your turn)`}</span></span>
          <span class="proto-opt-go" aria-hidden="true">${ok ? "Play ›" : "✕"}</span></button>`;
      }).join("");
      return { stepper, text: "Cancel the attack with a Counter card?", options: opts, buttons: [P("don't counter")] };
    }
    if (m.step === "block") {
      const bl = blockers();
      const opts = bl.map((c) => `<button type="button" class="proto-opt" data-act="block" data-uid="${c.uid}"><img src="${art(c.id)}" alt="">
        <span class="proto-opt-body"><b>${esc(C(c).name.split(",")[0])} takes the hit</b><span>${fmt(power(c))} vs ${fmt(m.atk)}: ${power(c) > m.atk ? "it survives" : "it is KO'd"}</span><span class="proto-opt-cost">You lose no life</span></span>
        <span class="proto-opt-go" aria-hidden="true">Block ›</span></button>`).join("");
      return { stepper, text: "Let a [Blocker] take the hit instead?", options: opts, buttons: [P("Leader stays target")] };
    }
    // combo
    const guard = find(m.guard);
    const base = power(guard), add = comboTotal(), tot = base + add;
    const need = m.atk - tot + 1;
    const meter = `<div class="proto-meter-bar" role="img" aria-label="${fmt(tot)} against ${fmt(m.atk)}">
      <div class="proto-mb-track"><span class="proto-mb-base" style="width:${Math.min(100, (base / (m.atk * 1.4)) * 100)}%"></span><span class="proto-mb-add" style="width:${Math.min(100 - (base / (m.atk * 1.4)) * 100, (add / (m.atk * 1.4)) * 100)}%"></span><i class="proto-mb-line" style="left:${(m.atk / (m.atk * 1.4)) * 100}%"></i></div>
      <div class="proto-mb-words"><b class="arena-num">${fmt(base)}${add ? ` + ${fmt(add)} = ${fmt(tot)}` : ""}</b> vs <b class="arena-num">${fmt(m.atk)}</b> → ${tot > m.atk ? '<span class="proto-good">attack fails</span>' : tot === m.atk ? '<span class="proto-bad">tie: the attacker wins ties</span>' : '<span class="proto-bad">attack gets through</span>'}${tot <= m.atk ? ` · need ${fmt(Math.ceil(need / 5000) * 5000)} more` : ""}</div></div>`;
    const n = m.combos.length;
    return { stepper, text: `Add combo power to ${esc(C(guard).name.split(",")[0])}?`, options: meter, combo: true,
      buttons: [n ? { label: `Combo with ${n} card${n > 1 ? "s" : ""}`, act: "confirmCombo", kind: "primary" } : null, P(n ? "no combo" : "take the hit", "passCombo")].filter(Boolean) };
  }

  function dockHTML() {
    const d = dock();
    const btn = (b) => b.kind === "pass"
      ? `<button type="button" data-pass-action class="arena-btn tap proto-pass" data-act="${b.act}"><span class="proto-pass-label">${b.label}</span>${b.sub ? `<span class="proto-pass-sub">${esc(b.sub)}</span>` : ""}</button>`
      : `<button type="button" class="arena-btn tap proto-btn proto-btn-${b.kind}" data-act="${b.act}">${b.label}</button>`;
    return `<div class="phone-board-module__86_vIW__dock proto-dock">
      <section class="arena-bar flex flex-col gap-2 proto-bar" aria-live="polite" data-wait="${!!d.wait}">
        ${d.eyebrow ? `<div class="proto-eyebrow">${d.wait ? '<span class="proto-spin" aria-hidden="true"></span>' : ""}${d.eyebrow}</div>` : ""}
        ${d.stepper ?? ""}
        <div class="proto-barrow">
          <div class="proto-q"><p class="proto-q-text">${d.text}</p>${d.sub ? `<p class="proto-q-sub">${d.sub}</p>` : ""}</div>
          ${d.buttons.length === 1 && !d.options ? `<div class="proto-btns">${d.buttons.map(btn).join("")}</div>` : ""}
        </div>
        ${d.options ? `<div class="proto-optrow"><div class="proto-opts">${d.options}</div>${d.buttons.length === 1 ? `<div class="proto-btns">${btn(d.buttons[0])}</div>` : ""}</div>` : ""}
        ${d.buttons.length > 1 ? `<div class="proto-btns proto-btns-wide">${d.buttons.map(btn).join("")}</div>` : ""}
      </section></div>`;
  }

  // ── Sheets: card (with what you can do with it), zones/decklist, cards in play, menu ───────────────
  function sheetHTML() {
    const sh = S.sheet;
    if (!sh) return "";
    let body = "";
    if (sh.kind === "card") body = cardSheet(sh);
    else if (sh.kind === "zones") body = zonesSheet(sh.side);
    else if (sh.kind === "inplay") body = inPlaySheet();
    else if (sh.kind === "menu") body = menuSheet();
    return `<div class="proto-scrim" data-act="closeSheet" aria-hidden="true"></div>
      <div class="proto-sheet proto-sheet-${sh.kind}" role="dialog" aria-modal="true" aria-label="${sh.kind === "card" ? "Card" : sh.kind}">
        <div class="proto-grab" data-act="closeSheet" aria-hidden="true"></div>
        <button type="button" class="proto-x" data-act="closeSheet" aria-label="Close">×</button>
        ${body}</div>`;
  }

  function zoneOf(c) {
    if (S.you.hand.includes(c)) {
      const f = S.sheet?.filter ?? "all";
      const list = f === "play" ? S.you.hand.filter((h) => playability(h).ok) : f === "counter" ? S.you.hand.filter((h) => C(h).counter) : S.you.hand;
      return { side: "Your hand", list: list.includes(c) ? list : S.you.hand };
    }
    const side = sideOf(c.uid);
    const who = side === S.you ? "Your" : `${OPP}'s`;
    return { side: isLeader(c) ? `${who} Leader` : `${who} Battle Area`, list: [...all(S.opp), ...all(S.you)] };
  }

  /** The status of a hand card as a short tag (for the filmstrip dots and the fan). */
  function handTag(c) {
    if (S.turnOf === "you" && S.phase === "Charge" && !S.mode) return "charge";
    if (S.turnOf === "you" && S.phase === "Main" && !S.mode) return playability(c).tag;
    return "idle";
  }

  /**
   * The card view: the card itself, big, with what you can do with it right under it, then its text.
   * Two layouts to compare (#788 follow-up): the full card, or its top half (name and art) at full width.
   * In the hand, a filmstrip of every card and filter chips make a 10-card hand browsable.
   */
  function cardSheet(sh) {
    const c = find(sh.uid);
    if (!c) return "";
    const d = C(c);
    const z = zoneOf(c);
    const i = z.list.indexOf(c);
    const side = sideOf(c.uid);
    const inHand = S.you.hand.includes(c);
    const layout = S.cardLayout;
    const chips = [`<span class="proto-chip proto-chip-role" data-role="${d.type}">${roleWord(c)}</span>`];
    if (!inHand) chips.push(`<span class="proto-chip">${c.mode === "rest" ? "Rested" : "Active"}</span>`);
    if (d.barrier) chips.push(`<span class="proto-chip">Barrier</span>`);
    if (d.blocker) chips.push(`<span class="proto-chip">Blocker</span>`);
    if (d.strike === 2) chips.push(`<span class="proto-chip">Double Strike</span>`);
    const stats = [d.cost != null ? `<b>${d.cost} ⚡</b> cost` : null, d.power != null ? `<b>${fmt(power(c))}</b> power` : null, d.combo ? `<b>+${fmt(d.combo)}</b> combo` : null, isLeader(c) ? `<b>${side.life}</b> life` : null].filter(Boolean);
    const text = d.text ? d.text.split("\n").map((l) => `<p>${esc(l).replace(/\[([^\]]+)\]/g, '<span class="proto-kw">$1</span>')}</p>`).join("") : '<p class="proto-muted">No skill text.</p>';
    const strip = inHand && S.you.hand.length > 1 ? handStrip(c, z.list) : "";
    return `<div class="proto-cv" data-layout="${layout}">
      <div class="proto-cv-head">
        <p class="proto-cs-zone">${z.side} · ${i + 1} / ${z.list.length}</p>
        <div class="proto-seg" role="group" aria-label="Card view">
          <button type="button" data-act="cardLayout" data-layout="full" aria-pressed="${layout === "full"}">Full card</button>
          <button type="button" data-act="cardLayout" data-layout="half" aria-pressed="${layout === "half"}">Top half</button>
        </div>
      </div>
      ${strip}
      <div class="proto-cv-stage">
        <button type="button" class="proto-cv-nav" data-act="sheetPrev" ${i <= 0 ? "disabled" : ""} aria-label="Previous card">‹</button>
        <button type="button" class="proto-cv-card" data-act="zoom" data-uid="${c.uid}" aria-label="Enlarge ${esc(d.name)}"><img src="${art(c.id)}" alt="${esc(d.name)}" draggable="false"></button>
        <button type="button" class="proto-cv-nav" data-act="sheetNext" ${i >= z.list.length - 1 ? "disabled" : ""} aria-label="Next card">›</button>
      </div>
      <div class="proto-cv-name"><h3>${esc(d.name)}</h3><div class="proto-chips">${chips.join("")}</div><p class="proto-cv-stats">${stats.join(" · ")}</p></div>
      ${cardActions(c)}
      <details class="proto-cv-text"${layout === "half" || !cardActions(c) ? " open" : ""}><summary>Card text</summary><div class="proto-cs-text">${text}</div></details>
    </div>`;
  }

  /** Every card in hand as a thumbnail with its status, plus filters once the hand is big. */
  function handStrip(cur, list) {
    const f = S.sheet?.filter ?? "all";
    const n = S.you.hand.length;
    const plays = S.you.hand.filter((h) => playability(h).ok).length;
    const counters = S.you.hand.filter((h) => C(h).counter).length;
    const filters = n > 6 && S.phase === "Main" && S.turnOf === "you" ? `<div class="proto-filters" role="group" aria-label="Show">
        <button type="button" data-act="handFilter" data-filter="all" aria-pressed="${f === "all"}">All ${n}</button>
        <button type="button" data-act="handFilter" data-filter="play" aria-pressed="${f === "play"}">Playable ${plays}</button>
        <button type="button" data-act="handFilter" data-filter="counter" aria-pressed="${f === "counter"}">Counters ${counters}</button>
      </div>` : "";
    return `${filters}<div class="proto-film" aria-label="Your hand">${list.map((h) => `<button type="button" class="proto-film-card${h === cur ? " proto-film-on" : ""}" data-act="inspect" data-uid="${h.uid}" aria-label="${esc(C(h).name)}"${h === cur ? ' aria-current="true"' : ""}><img src="${art(h.id)}" alt=""><i class="proto-hdot proto-hdot-${handTag(h)}" aria-hidden="true"></i></button>`).join("")}</div>`;
  }

  /** What this card can do now — the action lives with the card, with its cost and its targets told before you commit. */
  function cardActions(c) {
    const d = C(c);
    const inHand = S.you.hand.includes(c);
    if (S.busy || (S.mode && S.mode.kind !== "defend")) return "";
    if (inHand && S.turnOf === "you" && S.phase === "Charge") {
      return `<div class="proto-act"><div class="proto-act-line">Charge it: it becomes energy (${S.you.energy} → ${S.you.energy + 1} ⚡) and leaves your hand.</div>
        <button type="button" class="arena-btn tap proto-btn proto-btn-primary proto-btn-block" data-act="charge" data-uid="${c.uid}">Charge as energy</button></div>`;
    }
    if (inHand && S.turnOf === "you" && S.phase === "Main") {
      const p = playability(c);
      if (!p.ok) return `<div class="proto-act proto-act-off"><div class="proto-act-line"><b>${p.tag === "counter" ? "Not now" : "Can't play yet"}</b> — ${esc(p.why)}</div></div>`;
      const left = ready(S.you) - d.cost;
      const pay = `<div class="proto-pay"><span class="proto-pay-k">Pay</span>${Array.from({ length: ready(S.you) }, (_, i) => `<i class="arena-ec proto-paychip${i < d.cost ? " proto-paychip-on" : ""}"></i>`).join("")}<span class="proto-pay-v"><b>${d.cost} ⚡</b> of ${ready(S.you)} ready → ${left} left${S.you.hand.some((h) => C(h).counter && h !== c) && left < 1 ? " · <span class='proto-bad'>none left for a Counter</span>" : ""}</span></div>`;
      let target = "";
      if (d.onPlay === "unisonMarker") target = `<div class="proto-warn" role="note"><b>⚠ No valid target.</b> Its skill adds a marker to one of your red Unison Cards — you have none in play, so the skill will do nothing. You still get a ${fmt(d.power)} Battle Card.</div>`;
      if (d.onPlay === "koUpTo20k") {
        const t = koTargets();
        target = t.valid.length
          ? `<div class="proto-note"><b>Can KO:</b> ${t.valid.map((u) => esc(C(find(u)).name.split(",")[0])).join(", ")}. <span class="proto-muted">Not ${Object.entries(t.why).map(([u, w]) => `${esc(C(find(u)).name.split(",")[0])} (${w.split(" — ")[1] ?? w})`).join(", ")}.</span></div>`
          : `<div class="proto-warn" role="note"><b>⚠ No valid target.</b> None of ${OPP}'s Battle Cards can be chosen — the card would be spent for nothing.</div>`;
      }
      const label = p.tag === "warn" ? `Play anyway · ${d.cost} ⚡` : d.onPlay === "koUpTo20k" ? `Play · ${d.cost} ⚡ · then choose` : `Play · ${d.cost} ⚡`;
      return `<div class="proto-act">${target}${pay}<button type="button" class="arena-btn tap proto-btn ${p.tag === "warn" ? "proto-btn-warn" : "proto-btn-primary"} proto-btn-block" data-act="play" data-uid="${c.uid}">${label}</button></div>`;
    }
    if (canAttack(c)) {
      const bonus = d.onAttack?.bonus;
      return `<div class="proto-act"><div class="proto-act-line">${esc(d.name)} is active and can attack ${OPP}'s Leader or a rested Battle Card.${bonus ? ` Its [Auto] adds +${fmt(bonus)} when it attacks.` : ""}</div>
        <button type="button" class="arena-btn tap proto-btn proto-btn-primary proto-btn-block" data-act="startAttack" data-uid="${c.uid}">⚔ Attack with ${esc(d.name.split(",")[0])}</button></div>`;
    }
    if (all(S.you).includes(c) && S.turnOf === "you" && S.phase === "Main" && c.mode === "rest") return `<div class="proto-act proto-act-off"><div class="proto-act-line">Rested — it already attacked this turn.</div></div>`;
    if (all(S.opp).includes(c) && S.turnOf === "you" && S.phase === "Main") {
      const t = attackTargets();
      return `<div class="proto-act proto-act-off"><div class="proto-act-line">${t.valid.includes(c.uid) ? "You can attack this card." : esc(t.why[c.uid])}.${C(c).barrier ? " [Barrier]: your skills can't choose it." : ""}</div></div>`;
    }
    return "";
  }

  function zonesSheet(key) {
    const side = S[key];
    const deck = DECKS[key];
    const rows = deck.rows.map(([n, name, type, cost]) => `<li><span class="arena-num">${n}×</span><span>${esc(name)}</span><span class="proto-muted">${type}${cost != null ? ` · ${cost}⚡` : ""}</span></li>`).join("");
    return `<div class="proto-zs"><p class="proto-cs-zone">${key === "you" ? "Your side" : `${OPP}'s side`}</p><h3>${esc(deck.name)}</h3>
      <dl class="proto-tiles proto-tiles-4"><div><dt>Life</dt><dd class="arena-num">${side.life}</dd></div><div><dt>Energy</dt><dd class="arena-num">${ready(side)}/${side.energy}</dd></div><div><dt>Deck</dt><dd class="arena-num">${side.deck}</dd></div><div><dt>Drop</dt><dd class="arena-num">${side.drop.length}</dd></div></dl>
      <p class="proto-zs-h">Drop</p>${side.drop.length ? `<div class="proto-droprow">${side.drop.map((id) => `<img src="${art(id)}" alt="${esc(CARDS[id].name)}" title="${esc(CARDS[id].name)}">`).join("")}</div>` : '<p class="proto-muted">Empty.</p>'}
      <p class="proto-zs-h">Decklist · ${deck.rows.reduce((a, r) => a + r[0], 0)} cards + Leader ${esc(CARDS[deck.leader].name)}</p>
      <ul class="proto-decklist">${rows}</ul></div>`;
  }

  function inPlaySheet() {
    const row = (c) => { const s = sideOf(c.uid); return `<li><button type="button" data-act="inspect" data-uid="${c.uid}"><img src="${art(c.id)}" alt=""><span><b>${esc(C(c).name)}</b><small>${roleWord(c)} · ${c.mode === "rest" ? "rested" : "active"}${isLeader(c) ? ` · ${s.life} life` : ""}</small></span><span class="arena-num">${fmt(power(c))}</span></button></li>`; };
    return `<div class="proto-zs"><p class="proto-cs-zone">Cards in play</p><h3>${OPP}</h3><ul class="proto-inplay">${all(S.opp).map(row).join("")}</ul><h3>You</h3><ul class="proto-inplay">${all(S.you).map(row).join("")}</ul></div>`;
  }

  const SCENES = [
    ["setup", "Setup: decks and start"], ["mulligan", "Mulligan"], ["charge", "1 · Charge phase (turn start)"], ["main", "1 · Main phase overview"],
    ["inspect", "2 · Inspect a card"], ["play", "4 · Play sheet: cost and energy"], ["notarget", "6 · No valid target, before you commit"],
    ["target", "5 · Choose a target"], ["attack", "7 · Declare an attack"], ["attackConfirm", "7 · Attacker → target"],
    ["oppturn", "9 · Claude's turn (replay)"], ["bighand", "Hand of 10: the fan"], ["bighandView", "Hand of 10: browse in the card view"], ["cardHalf", "Card view: top half"], ["counter", "8 · Counter"], ["block", "8 · Block"], ["combo", "8 · Combo"],
  ];
  function menuSheet() {
    return `<div class="proto-zs"><p class="proto-cs-zone">Arena</p><h3>Settings</h3>
      <div class="proto-menu">
        <button type="button" class="proto-menuitem" data-act="skin">Board style: <b>${skin === "anime" ? "Sky (anime)" : "Night"}</b> — switch</button>
        <button type="button" class="proto-menuitem" data-act="restart">Restart the match</button>
      </div>
      <p class="proto-zs-h">Prototype · jump to a state (issue #788)</p>
      <div class="proto-menu proto-scenes">${SCENES.map(([k, l]) => `<button type="button" class="proto-menuitem" data-act="scene" data-scene="${k}">${l}</button>`).join("")}</div>
      <p class="proto-muted proto-small">A scripted prototype on the app's own styles and real card art. Nothing is saved and no engine runs.</p></div>`;
  }

  // ── Overlays: banner, verdict, arrow ──────────────────────────────────────────────────────────────
  function overlaysHTML() {
    let h = "";
    if (S.banner) h += `<div class="proto-banner" aria-live="assertive"><p class="arena-banner arena-impact select-none font-black uppercase italic tracking-tight text-space-50">${S.banner.big}</p>${S.banner.small ? `<p class="proto-banner-sub">${S.banner.small}</p>` : ""}</div>`;
    if (S.verdict) h += `<div class="proto-verdict arena-verdict-${S.verdict.tone}" role="status"><p class="arena-verdict-word">${S.verdict.word}</p><p class="proto-verdict-line">${S.verdict.line}</p></div>`;
    if (S.zoom) h += `<div class="proto-zoom" data-act="unzoom" role="dialog" aria-label="Card art"><img src="${art(find(S.zoom).id)}" alt=""><span>Tap to close</span></div>`;
    return h;
  }

  function boardHTML() {
    return `<div id="board" class="phone-board-module__86_vIW__board arena arena-board relative flex w-full flex-col proto-board" data-skin="${skin}" data-mode="${S.mode?.kind ?? ""}" data-step="${S.mode?.step ?? ""}" style="${turnVars()}">
      <div class="arena-edge" aria-hidden="true"></div>
      ${topbarHTML()}
      ${phasesHTML()}
      <section class="arena-stage relative flex min-w-0 flex-1 flex-col proto-stage" aria-label="Battle Areas">
        <div class="arena-field relative proto-stripwrap">${stripHTML(S.opp)}</div>
        ${rowHTML(S.opp)}
        ${laneHTML()}
        ${rowHTML(S.you)}
        <div class="arena-field relative proto-stripwrap">${stripHTML(S.you)}</div>
        <svg class="proto-arrow" aria-hidden="true"><defs><marker id="proto-ah" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor"></path></marker></defs><path id="proto-arrow-path" d="" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" marker-end="url(#proto-ah)"></path></svg>
      </section>
      ${handHTML()}
      ${dockHTML()}
      ${overlaysHTML()}
      ${sheetHTML()}
    </div>`;
  }

  function setupHTML() {
    const deck = (k) => `<div class="proto-deckcard"><img src="${art(DECKS[k].leader)}" alt=""><div><p class="proto-cs-zone">${k === "you" ? "Your deck" : `${OPP} plays`}</p><b>${esc(DECKS[k].name)}</b><span class="proto-muted">Leader ${esc(CARDS[DECKS[k].leader].name)} · 50 cards</span>
      <button type="button" class="proto-linkbtn" data-act="deckList" data-side="${k}">View decklist</button></div></div>`;
    return `<div class="arena proto-board proto-setup" data-skin="${skin}" style="${turnVars()}">
      <div class="proto-setup-in">
        <p class="proto-cs-zone">Arena · local match</p>
        <h2 class="arena-impact proto-setup-title">Pick your fight</h2>
        <div class="proto-decks">${deck("you")}<div class="proto-vs arena-impact">VS</div>${deck("opp")}</div>
        <p class="proto-muted proto-small">Plays offline on this device. Masters rules. You can review either deck before you start.</p>
        <button type="button" class="arena-btn tap proto-btn proto-btn-primary proto-btn-block proto-btn-xl" data-act="start">Start match</button>
      </div>${S.sheet ? `<div class="proto-scrim" data-act="closeSheet"></div><div class="proto-sheet proto-sheet-zones" role="dialog" aria-modal="true"><button type="button" class="proto-x" data-act="closeSheet" aria-label="Close">×</button>${zonesSheet(S.sheet.side)}</div>` : ""}</div>`;
  }

  function mulliganHTML() {
    const hand = ["BT11-011", "BT6-025", "SD15-03", "BT14-010", "BT3-027", "BT14-006"];
    return `<div class="arena proto-board proto-setup" data-skin="${skin}" style="${turnVars()}">
      <div class="proto-setup-in">
        <p class="proto-cs-zone">Before the first turn</p>
        <h2 class="arena-impact proto-setup-title">Keep this hand?</h2>
        <div class="proto-mull">${hand.map((id) => `<img src="${art(id)}" alt="${esc(CARDS[id].name)}">`).join("")}</div>
        <p class="proto-muted proto-small">You may redraw six cards once (6-2-1-9).</p>
        <div class="proto-btns proto-btns-wide"><button type="button" class="arena-btn tap proto-btn proto-btn-ghost" data-act="keep">Redraw</button><button type="button" class="arena-btn tap proto-btn proto-btn-primary" data-act="keep">Keep hand</button></div>
        <p class="proto-muted proto-small">The prototype then skips ahead to your 6th turn.</p>
      </div></div>`;
  }

  function render() {
    S.k = S.short ? 0.84 : 1;
    S.boardW = document.querySelector(".proto-device")?.clientWidth || innerWidth;
    const shc = S.sheet?.kind === "card" ? find(S.sheet.uid) : null;
    S.willPay = shc && S.you.hand.includes(shc) && S.turnOf === "you" && S.phase === "Main" && playability(shc).ok ? C(shc).cost : 0;
    S.k2 = S.short ? 0.84 : 1;
    const scrollers = [...document.querySelectorAll(".proto-handscroll, .proto-sheet")].map((e) => e.scrollLeft + ":" + e.scrollTop);
    if (S.screen === "setup") $app.innerHTML = frame(setupHTML());
    else if (S.screen === "mulligan") $app.innerHTML = frame(mulliganHTML());
    else $app.innerHTML = frame(boardHTML());
    const hs = document.querySelector(".proto-handscroll");
    if (hs && scrollers[0]) hs.scrollLeft = +scrollers[0].split(":")[0];
    document.documentElement.setAttribute("data-skin", skin);
    requestAnimationFrame(drawArrow);
    S.fx = {};
  }
  const frame = (inner) => `<div class="proto-device">${inner}</div>`;

  function drawArrow() {
    const path = document.getElementById("proto-arrow-path");
    const board = document.querySelector(".proto-stage");
    if (!path || !board) return;
    const m = S.mode;
    let from = null, to = null;
    if (m?.kind === "attack" && m.target) { from = m.attacker; to = m.target; }
    if (m?.kind === "defend") { from = m.attacker; to = m.guard; }
    if (!from) { path.setAttribute("d", ""); return; }
    const b = board.getBoundingClientRect();
    const r = (u) => document.querySelector(`[data-arena-card="${u}"]`)?.getBoundingClientRect();
    const a = r(from), t = r(to);
    if (!a || !t) return;
    const ax = a.left + a.width / 2 - b.left, ay = a.top + a.height / 2 - b.top;
    const tx = t.left + t.width / 2 - b.left, ty = t.top + t.height / 2 - b.top;
    const dy = ty - ay;
    const sx = ax, sy = ay + Math.sign(dy) * a.height * 0.42;
    const ex = tx, ey = ty - Math.sign(dy) * t.height * 0.52;
    const cx = (sx + ex) / 2 + (Math.abs(ex - sx) < 30 ? 60 : 0), cy = (sy + ey) / 2;
    path.setAttribute("d", `M${sx} ${sy} Q${cx} ${cy} ${ex} ${ey}`);
    path.closest("svg").dataset.who = sideOf(from) === S.you ? "you" : "opp";
  }

  // ── Actions ───────────────────────────────────────────────────────────────────────────────────────
  const wait = (ms) => new Promise((r) => setTimeout(r, S.fast ? ms / 2.2 : ms));
  let ffToken = 0;
  async function beat(text, who, ms = 1300, fn) {
    if (fn) fn();
    S.narration = { text, who };
    render();
    const t = ffToken;
    await wait(t === ffToken ? ms : 0);
  }
  async function bannerShow(big, small, ms = 1100) {
    S.banner = { big, small };
    render();
    await wait(ms);
    S.banner = null;
  }
  async function verdictShow(tone, word, line, ms = 2200) {
    S.verdict = { tone, word, line };
    render();
    await wait(ms);
    S.verdict = null;
  }

  function payEnergy(side, n) { side.energyRested = Math.min(side.energy, side.energyRested + n); }

  async function act(name, el) {
    const uid = el?.dataset.uid;
    switch (name) {
      case "noop": return;
      case "inspect": S.sheet = { kind: "card", uid, filter: S.sheet?.kind === "card" ? S.sheet.filter : "all" }; S.zoom = null; return render();
      case "closeSheet": S.sheet = null; return render();
      case "zoom": S.zoom = uid; return render();
      case "cardLayout": S.cardLayout = el.dataset.layout; try { localStorage.setItem("proto788.cardLayout", S.cardLayout); } catch { /* fine */ } return render();
      case "handFilter": {
        S.sheet.filter = el.dataset.filter;
        const z = zoneOf(find(S.sheet.uid));
        if (z.list[0] && !z.list.includes(find(S.sheet.uid))) S.sheet.uid = z.list[0].uid;
        else if (z.list[0] && z.list !== S.you.hand) S.sheet.uid = z.list.includes(find(S.sheet.uid)) ? S.sheet.uid : z.list[0].uid;
        return render();
      }
      case "unzoom": S.zoom = null; return render();
      case "sheetPrev": case "sheetNext": {
        const c = find(S.sheet.uid); const z = zoneOf(c); const i = z.list.indexOf(c) + (name === "sheetNext" ? 1 : -1);
        if (z.list[i]) S.sheet = { ...S.sheet, uid: z.list[i].uid };
        return render();
      }
      case "zones": S.sheet = { kind: "zones", side: el.dataset.side }; return render();
      case "deckList": S.sheet = { kind: "zones", side: el.dataset.side }; return render();
      case "inplay": S.sheet = { kind: "inplay" }; return render();
      case "menu": S.sheet = { kind: "menu" }; return render();
      case "speed": S.fast = !S.fast; return render();
      case "skin": skin = skin === "anime" ? "night" : "anime"; try { localStorage.setItem("proto788.skin", skin); } catch { /* fine */ } return render();
      case "restart": S = fresh(); S.screen = "setup"; return render();
      case "scene": return scene(el.dataset.scene);
      case "start": S.screen = "mulligan"; S.sheet = null; return render();
      case "keep": S.screen = "board"; render(); return turnStart();
      case "fastForward": S.fast = true; ffToken++; return render();
      case "charge": {
        const c = find(uid); S.you.hand = S.you.hand.filter((h) => h !== c); S.you.energy++;
        S.sheet = null; S.narration = { text: `You charge ${C(c).name} as energy. ${S.you.energy} ⚡ this turn.`, who: "you" };
        return toMain();
      }
      case "pass": {
        if (S.phase === "Charge") { S.narration = { text: "You don't charge this turn.", who: "you" }; return toMain(); }
        return;
      }
      case "play": return play(find(uid));
      case "startAttack": S.sheet = null; S.mode = { kind: "attack", attacker: uid }; return render();
      case "pickAttackTarget": S.mode.target = uid; return render();
      case "retarget": S.mode.target = null; return render();
      case "cancelMode": S.mode = null; return render();
      case "confirmAttack": return yourAttack();
      case "pickKoTarget": S.mode.picked = uid; return render();
      case "unpickKo": S.mode.picked = null; return render();
      case "koNone": S.mode = null; S.narration = { text: "Transcendent Strike: you choose nothing to KO.", who: "you" }; return render();
      case "confirmKo": {
        const t = find(S.mode.picked); S.mode = null; S.fx[t.uid] = "proto-ko"; render();
        await wait(650);
        S.opp.battle = S.opp.battle.filter((c) => c !== t); S.opp.drop.push(t.id);
        S.narration = { text: `Transcendent Strike KOs ${C(t).name}.`, who: "you" };
        return render();
      }
      case "endTurn": return oppTurn();
      case "playCounter": return defendCounter(find(uid));
      case "block": return defendBlock(find(uid));
      case "toggleCombo": {
        const m = S.mode; const i = m.combos.indexOf(uid);
        if (i >= 0) m.combos.splice(i, 1);
        else if (!(C(find(uid)).superCombo && m.combos.some((u) => C(find(u)).superCombo))) m.combos.push(uid);
        return render();
      }
      case "confirmCombo": case "passCombo": if (name === "passCombo") S.mode.combos = []; return resolveDefence();
    }
    // "Pass" in a defence step moves to the next step.
  }

  async function turnStart() {
    S.busy = true; S.playback = false;
    await bannerShow("YOUR TURN", `Turn ${S.turn}`, 1200);
    S.phase = "Charge"; S.busy = false;
    S.narration = { text: `Your turn ${S.turn}: you draw a card, your energy is ready again.`, who: "you" };
    render();
  }
  async function toMain() {
    S.sheet = null; S.busy = true; render();
    await bannerShow("MAIN PHASE", "Play cards and attack", 900);
    S.phase = "Main"; S.busy = false; render();
  }

  async function play(c) {
    const d = C(c);
    S.sheet = null;
    payEnergy(S.you, d.cost);
    S.you.hand = S.you.hand.filter((h) => h !== c);
    if (d.type === "Battle") {
      S.you.battle.push(c); S.fx[c.uid] = "proto-in";
      S.narration = { text: `You play ${d.name} (−${d.cost} ⚡).`, who: "you" };
      render();
      if (d.onPlay === "unisonMarker") {
        await wait(900);
        S.narration = { text: `${d.name}'s skill: no Unison Card to mark, so it does nothing — as the play sheet said.`, who: "you" };
        render();
      }
      return;
    }
    // Extra card: to the drop, then its skill.
    S.you.drop.push(c.id);
    if (d.onPlay === "koUpTo20k") {
      const t = koTargets();
      if (!t.valid.length) { S.narration = { text: `${d.name} finds nothing it can choose. It goes to your Drop.`, who: "you" }; return render(); }
      S.mode = { kind: "target", valid: t.valid, why: t.why, picked: null };
      return render();
    }
    render();
  }

  async function yourAttack() {
    const m = S.mode; const a = find(m.attacker); const t = find(m.target);
    S.busy = true; S.playback = true; S.phase = "Battle";
    S.attacked.add(a.uid); a.mode = "rest";
    await beat(`${C(a).name} attacks ${C(t).name}.`, "you", 1000);
    if (C(a).onAttack) {
      await beat(`${C(a).name}'s [Auto]: you draw 1 card, it gets +5,000 → ${fmt(power(a) + 5000)}.`, "you", 1300, () => { a.bonus += 5000; m.bonusApplied = true; S.you.hand.push(inst("BT14-006")); S.you.deck--; });
    }
    const atkPow = power(a);
    let guardBonus = 0;
    if (S.oppComboLeft > 0 && isLeader(t) && atkPow >= power(t)) {
      S.oppComboLeft--; S.opp.handCount--; S.opp.drop.push("BT4-089");
      guardBonus = 5000; t.bonus += 5000;
      await beat(`${OPP} combos Dynasty's Solace Chi-Chi from hand: +5,000 → ${fmt(power(t))}.`, "opp", 1400);
    } else await beat(`${OPP} adds no combo and plays no counter.`, "opp", 1000);
    const gp = power(t);
    const hit = atkPow >= gp;
    if (hit && isLeader(t)) {
      const dmg = C(a).strike ?? 1;
      await verdictShow("good", "BREAK THROUGH!", `${fmt(atkPow)} vs ${fmt(gp)}${atkPow === gp ? " — a tie goes to the attacker" : ""}. ${OPP} takes ${dmg} damage: ${S.opp.life} → ${S.opp.life - dmg} life.`);
      S.opp.life -= dmg; S.opp.handCount += dmg; S.fx["life-opp"] = 1;
      S.narration = { text: `${OPP} loses ${dmg} life (the life card${dmg > 1 ? "s go" : " goes"} to their hand).`, who: "you" };
    } else if (hit) {
      await verdictShow("good", "KO!", `${fmt(atkPow)} vs ${fmt(gp)}: ${C(t).name} is KO'd.`);
      S.opp.battle = S.opp.battle.filter((c) => c !== t); S.opp.drop.push(t.id);
      S.narration = { text: `${C(t).name} is KO'd.`, who: "you" };
    } else {
      await verdictShow("calm", "GUARDED", `${fmt(atkPow)} vs ${fmt(gp)}: the attack fails. Nothing happens.`);
      S.narration = { text: `${C(a).name}'s attack fails (${fmt(atkPow)} vs ${fmt(gp)}).`, who: "you" };
    }
    t.bonus -= guardBonus;
    S.mode = null; S.busy = false; S.playback = false; S.phase = "Main"; S.fast = false;
    render();
  }

  // ── Claude's turn and your defence ────────────────────────────────────────────────────────────────
  const blockers = () => S.you.battle.filter((c) => C(c).blocker && c.mode === "active" && c.uid !== S.mode?.guard);
  function comboCandidates() {
    const m = S.mode;
    return [...S.you.hand.filter((c) => C(c).combo), ...S.you.battle.filter((c) => c.mode === "active" && c.uid !== m.guard && C(c).combo)];
  }
  const comboTotal = () => (S.mode?.combos ?? []).map(find).filter(Boolean).reduce((a, c) => a + (C(c).combo ?? 0), 0);

  async function oppTurn() {
    S.sheet = null; S.mode = null; S.busy = true; S.playback = true;
    S.phase = "End";
    await beat("You end your turn.", "you", 700);
    S.turnOf = "opp"; S.turn++; S.phase = "Draw";
    for (const c of all(S.opp)) c.mode = "active";
    S.opp.energyRested = 0;
    for (const c of all(S.you)) c.bonus = 0;
    await bannerShow(`${OPP.toUpperCase()}'S TURN`, `Turn ${S.turn}`, 1300);
    await beat(`${OPP} draws a card.`, "opp", 1000, () => { S.opp.handCount++; S.opp.deck--; });
    S.phase = "Charge";
    await beat(`${OPP} charges a card as energy (${S.opp.energy + 1} ⚡).`, "opp", 1100, () => { S.opp.handCount--; S.opp.energy++; });
    S.phase = "Main";
    await beat(`${OPP} plays Intrepid Dynasty Son Gohan (−2 ⚡).`, "opp", 1300, () => { const g = inst("BT4-084"); S.opp.battle.push(g); S.fx[g.uid] = "proto-in"; S.opp.handCount--; payEnergy(S.opp, 2); });
    S.phase = "Battle";
    const apex = S.opp.battle.find((c) => c.id === "SD5-03");
    apex.mode = "rest";
    S.mode = { kind: "defend", step: "counter", attacker: apex.uid, guard: S.you.leader.uid, atk: power(apex), combos: [], skipped: [] };
    await beat(`${OPP} attacks your Leader with SSB Son Goku, at the Apex.`, "opp", 1500);
    S.busy = false; S.playback = false; S.fast = false;
    nextDefenceStep("counter");
  }

  /** Skip a step the engine would not ask (no Counter in hand, no ready Blocker) — and say so in the stepper. */
  function nextDefenceStep(step) {
    const m = S.mode;
    m.step = step;
    if (step === "counter" && !S.you.hand.some((c) => C(c).counter)) { m.skipped.push("counter"); return nextDefenceStep("block"); }
    if (step === "block" && !blockers().length) { m.skipped.push("block"); return nextDefenceStep("combo"); }
    render();
  }

  async function defendCounter(c) {
    payEnergy(S.you, C(c).cost);
    S.you.hand = S.you.hand.filter((h) => h !== c); S.you.drop.push(c.id);
    const m = S.mode;
    S.busy = true; render();
    await verdictShow("calm", "NEGATED!", `Unending Awakening cancels the attack. Vegeta gets +5,000 for the turn.`);
    S.you.leader.bonus += 5000;
    S.mode = null; m.done = true;
    return oppEnd(`You counter with Unending Awakening — the attack is negated.`);
  }

  async function defendBlock(b) {
    const m = S.mode;
    b.mode = "rest"; m.guard = b.uid;
    S.narration = { text: `${C(b).name} blocks: it is now the target.`, who: "you" };
    render();
    await wait(500);
    m.step = "offense";
    S.busy = true; S.playback = true; render();
    await beat(`${OPP} adds no combo to the attack.`, "opp", 1000);
    S.busy = false; S.playback = false;
    nextDefenceStep("combo");
  }

  // A pass in a defence step: on to the next one.
  const passed = { counter: "block", block: "combo" };
  const _act = act;
  async function actWithPass(name, el) {
    if (name === "pass" && S.mode?.kind === "defend") {
      const m = S.mode;
      if (m.step === "block") {
        S.busy = true; S.playback = true; render();
        await beat(`${OPP} adds no combo to the attack.`, "opp", 1000);
        S.busy = false; S.playback = false;
      }
      return nextDefenceStep(passed[m.step]);
    }
    return _act(name, el);
  }

  async function resolveDefence() {
    const m = S.mode;
    const guard = find(m.guard);
    const combos = m.combos.map(find);
    const add = comboTotal();
    for (const c of combos) {
      if (S.you.hand.includes(c)) { S.you.hand = S.you.hand.filter((h) => h !== c); S.you.drop.push(c.id); }
      else c.mode = "rest";
    }
    guard.bonus += add;
    m.combos = [];
    S.busy = true; render();
    const gp = power(guard), ap = m.atk;
    const hit = ap >= gp;
    const isLead = guard === S.you.leader;
    if (hit && isLead) {
      const dmg = 2;
      await verdictShow("bad", "BREAK THROUGH", `${fmt(ap)} vs ${fmt(gp)}${ap === gp ? " — a tie goes to the attacker" : ""}. [Double Strike]: you take 2 damage, ${S.you.life} → ${S.you.life - dmg} life.`);
      S.you.life -= dmg; S.fx["life-you"] = 1;
      S.you.hand.push(inst("BT11-008"), inst("BT14-010"));
      S.narration = { text: "You lose 2 life. The 2 life cards go to your hand.", who: "opp" };
    } else if (hit) {
      await verdictShow("bad", "KO", `${fmt(ap)} vs ${fmt(gp)}: ${C(guard).name} is KO'd. Your life is safe.`);
      S.you.battle = S.you.battle.filter((c) => c !== guard); S.you.drop.push(guard.id);
      S.narration = { text: `${C(guard).name} is KO'd blocking. You keep your life.`, who: "opp" };
    } else {
      await verdictShow("good", "GUARDED!", `${fmt(gp)} vs ${fmt(ap)}: higher than the attacker, so the attack fails.${combos.length ? ` ${combos.length} combo card${combos.length > 1 ? "s" : ""} used.` : ""}`);
      S.narration = { text: `You hold: ${fmt(gp)} against ${fmt(ap)}.`, who: "you" };
    }
    guard.bonus -= add;
    S.mode = null;
    return oppEnd(S.narration.text);
  }

  async function oppEnd(text) {
    S.busy = true; S.playback = true; S.mode = null;
    await beat(text, "opp", 1300);
    S.phase = "End";
    await beat(`${OPP} ends the turn.`, "opp", 1100);
    S.turnOf = "you"; S.turn++; S.phase = "Charge"; S.you.energyRested = 0;
    for (const c of all(S.you)) c.mode = "active";
    S.attacked.clear();
    await bannerShow("YOUR TURN", `Turn ${S.turn}`, 1300);
    S.busy = false; S.playback = false; S.fast = false;
    S.narration = { text: "That's the end of the scripted match — keep exploring, or restart from the ☰ menu.", who: "you" };
    render();
  }

  // ── Scenes: build a state directly (the ☰ menu, or a #scene anchor) ───────────────────────────────
  function scene(name) {
    S = fresh();
    S.screen = "board";
    const strike = () => S.you.hand.find((c) => c.id === "BT6-025");
    switch (name) {
      case "setup": S.screen = "setup"; break;
      case "mulligan": S.screen = "mulligan"; break;
      case "charge": break;
      case "main": S.phase = "Main"; S.you.energy = 6; S.narration = { text: "You charge Super Saiyan Son Goku as energy. 6 ⚡ this turn.", who: "you" }; S.you.hand = S.you.hand.filter((c) => c.id !== "BT14-006"); break;
      case "inspect": scene("main"); S.sheet = { kind: "card", uid: S.opp.battle[2].uid }; break;
      case "play": scene("main"); S.sheet = { kind: "card", uid: S.you.hand.find((c) => c.id === "SD15-03").uid }; S.willPay = 0; break;
      case "notarget": scene("main"); S.sheet = { kind: "card", uid: S.you.hand.find((c) => c.id === "BT11-011").uid }; break;
      case "target": { scene("main"); const s = strike(); S.you.hand = S.you.hand.filter((c) => c !== s); payEnergy(S.you, 1); S.you.drop.push("BT6-025"); const t = koTargets(); S.mode = { kind: "target", valid: t.valid, why: t.why, picked: null }; break; }
      case "attack": scene("main"); S.mode = { kind: "attack", attacker: S.you.leader.uid }; break;
      case "bighand": case "bighandView": {
        scene("main");
        for (const id of ["BT11-008", "BT14-010", "BT6-025", "BT3-027", "BT14-006"]) S.you.hand.push(inst(id));
        S.you.deck -= 5;
        S.narration = { text: "A big hand: 10 cards. Tap any card to browse them all.", who: "you" };
        if (name === "bighandView") S.sheet = { kind: "card", uid: S.you.hand[2].uid, filter: "all" };
        break;
      }
      case "cardHalf": scene("main"); S.cardLayout = "half"; S.sheet = { kind: "card", uid: S.you.hand.find((c) => c.id === "BT6-025").uid, filter: "all" }; break;
      case "attackConfirm": scene("main"); S.mode = { kind: "attack", attacker: S.you.leader.uid, target: S.opp.leader.uid }; break;
      case "oppturn": scene("main"); render(); oppTurn(); return;
      case "counter": case "block": case "combo": {
        scene("main");
        S.turnOf = "opp"; S.turn = 7; S.phase = "Battle";
        payEnergy(S.you, 5);
        const g = inst("BT4-084"); S.opp.battle.push(g);
        for (const c of all(S.opp)) c.mode = "active";
        const apex = S.opp.battle.find((c) => c.id === "SD5-03"); apex.mode = "rest";
        S.narration = { text: `${OPP} attacks your Leader with SSB Son Goku, at the Apex.`, who: "opp" };
        S.mode = { kind: "defend", step: name, attacker: apex.uid, guard: S.you.leader.uid, atk: power(apex), combos: [], skipped: [] };
        if (name === "combo") S.mode.skipped = [];
        break;
      }
    }
    render();
  }

  // ── Input: taps through data-act; drag a hand card up to play it ──────────────────────────────────
  let drag = null, suppressClick = false;
  $app.addEventListener("click", (e) => {
    if (suppressClick) { suppressClick = false; e.preventDefault(); return; }
    const el = e.target.closest("[data-act]");
    if (!el || el.disabled) return;
    if (S.busy && !["fastForward", "speed", "menu", "closeSheet", "inspect", "inplay", "zones", "zoom", "unzoom", "sheetPrev", "sheetNext", "skin", "scene", "restart"].includes(el.dataset.act)) return;
    actWithPass(el.dataset.act, el);
  });
  $app.addEventListener("pointerdown", (e) => {
    const hc = e.target.closest(".proto-handcard");
    if (!hc || S.busy || S.mode || S.turnOf !== "you" || !["Main", "Charge"].includes(S.phase) || S.sheet) return;
    drag = { uid: hc.dataset.uid, x: e.clientX, y: e.clientY, started: false, el: null };
  });
  window.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dy = drag.y - e.clientY, dx = Math.abs(e.clientX - drag.x);
    if (!drag.started) {
      if (dy > 14 && dy > dx) {
        drag.started = true;
        const c = find(drag.uid);
        const g = document.createElement("div");
        g.className = "proto-ghost arena-dragghost";
        g.innerHTML = `<img src="${art(c.id)}" alt="">`;
        document.getElementById("board").appendChild(g);
        drag.el = g;
        document.querySelector(`.proto-handcard[data-uid="${drag.uid}"]`)?.classList.add("proto-lifted");
      } else if (dx > 14) { drag = null; return; }
      else return;
    }
    const b = document.getElementById("board").getBoundingClientRect();
    drag.el.style.left = `${e.clientX - b.left}px`;
    drag.el.style.top = `${e.clientY - b.top}px`;
    const over = e.clientY < document.querySelector(".proto-hand").getBoundingClientRect().top - 10;
    const c = find(drag.uid);
    const lane = document.querySelector(".proto-lane");
    const p = S.phase === "Main" ? playability(c) : { ok: true };
    drag.over = over;
    drag.el.toggleAttribute("data-over", over && p.ok);
    drag.el.toggleAttribute("data-bad", over && !p.ok);
    lane?.classList.toggle("proto-dropzone", over);
    if (lane) lane.dataset.drop = over ? (S.phase === "Charge" ? "Drop to charge as energy" : p.ok ? (p.tag === "warn" ? "⚠ No valid target — release to review" : `Drop to play · −${C(c).cost} ⚡`) : p.why) : "";
    lane?.toggleAttribute("data-bad", over && !p.ok);
    e.preventDefault();
  }, { passive: false });
  window.addEventListener("pointerup", () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.started) return;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 50);
    d.el?.remove();
    const c = find(d.uid);
    if (!d.over) return render();
    if (S.phase === "Charge") return act("charge", { dataset: { uid: d.uid } });
    const p = playability(c);
    // Anything that needs a second look — no target, or a target to choose — opens the card first.
    if (!p.ok || p.tag === "warn" || C(c).onPlay) { S.sheet = { kind: "card", uid: d.uid }; return render(); }
    play(c);
  });
  // Swipe the card sheet left/right for the next card; down to close.
  let sw = null;
  $app.addEventListener("touchstart", (e) => { const sh = e.target.closest(".proto-sheet-card"); if (sh) sw = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
  $app.addEventListener("touchend", (e) => {
    if (!sw) return;
    const t = e.changedTouches[0]; const dx = t.clientX - sw.x, dy = t.clientY - sw.y; sw = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) act(dx < 0 ? "sheetNext" : "sheetPrev");
    else if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5) act("closeSheet");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { if (S.zoom) act("unzoom"); else if (S.sheet) act("closeSheet"); else if (S.mode?.kind === "attack" || (S.mode?.kind === "target" && S.mode.picked)) act(S.mode.kind === "attack" ? "cancelMode" : "unpickKo"); }
    if (S.sheet?.kind === "card" && (e.key === "ArrowRight" || e.key === "ArrowLeft")) act(e.key === "ArrowRight" ? "sheetNext" : "sheetPrev");
  });
  // Short screens (a phone browser with its bars shown) get smaller cards, as the app does (#783).
  const sizeCheck = () => {
    const h = document.querySelector(".proto-device")?.clientHeight ?? innerHeight;
    const short = h < 720;
    if (S && short !== S.short) { S.short = short; render(); }
  };
  addEventListener("resize", () => { sizeCheck(); requestAnimationFrame(drawArrow); });

  S = fresh();
  const start = (location.hash || "").slice(1);
  S.screen = "setup";
  if (start && SCENES.some(([k]) => k === start)) scene(start); else render();
  sizeCheck();
  window.__proto788 = { get state() { return S; }, scene };
})();
