/**
 * What a phone screen shows, measured in the page, beside what the engine knows — the evidence
 * for the UX review of `scripts/arena-phone-run.mts` (`docs/arena-phone-ux-review.md`).
 *
 *  - `SCREEN_FACTS`: evaluated in the page at each shot. The game-state overview the board draws
 *    (turn pill, phase chip, both players' life and energy, the prompt bar) and whether each is on
 *    the first screen and not covered; every visible control smaller than the 44 px tap target
 *    (`CLAUDE.md` Conventions); text under 11 css px; text cut off; sideways scroll; an open sheet.
 *    The caller adds `lowContrast` from the contrast walk of `arena:contrast`.
 *  - `truthOf`: the same moment from the snapshot (whose turn, phase, life, energy, hands, decks,
 *    the battle, the question, the log lines since the last shot) for the reviewer to compare.
 *  - `checksOf`: the objective findings one shot gives. The judgement calls are the reviewer's.
 *
 * Read-only: nothing here taps, scrolls or changes the page.
 */
import type { Snapshot } from "../../src/lib/arena/snapshot-core.ts";

export interface Box { x: number; y: number; w: number; h: number }
export interface Overview { text: string; onFirstScreen: boolean; covered: boolean | null; present: boolean }
export interface ScreenFacts {
  vw: number; vh: number; dpr: number; scrollY: number; pageHeight: number; sideways: boolean;
  overview: Record<"turn" | "phase" | "youLife" | "themLife" | "youResources" | "themResources" | "prompt" | "decision" | "stakes", Overview>;
  dialog: { open: boolean; title: string; text: string };
  smallTargets: Array<{ label: string; w: number; h: number }>;
  tinyText: Array<{ text: string; px: number }>;
  clipped: string[];
  visibleText: string;
  cardsOnScreen: number;
  brokenImages: number;
  /** Text on screen under its WCAG 1.4.3 contrast need (`scripts/lib/contrast-audit.mts`), when the caller ran that walk. */
  lowContrast?: Array<{ text: string; ratio: number; need: number }>;
}

/** An expression: the `ScreenFacts` of the page as it is now. */
export const SCREEN_FACTS = `(() => {
  const vw = innerWidth, vh = innerHeight;
  const shown = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return null;
    }
    return r;
  };
  const inView = (r) => r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
  const coveredAt = (el, r) => {
    const x = Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), y = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
    const hit = document.elementFromPoint(x, y);
    return !(hit && (hit === el || el.contains(hit) || hit.contains(el)));
  };
  const ov = (el, text) => {
    if (!el) return { text: "", onFirstScreen: false, covered: null, present: false };
    const r = shown(el);
    const t = (text ?? el.innerText ?? el.getAttribute("aria-label") ?? "").replace(/\\s+/g, " ").trim().slice(0, 240);
    if (!r) return { text: t, onFirstScreen: false, covered: null, present: true };
    // "First screen": in the viewport at the top of the page, i.e. without scrolling.
    const top = r.top + scrollY, firstScreen = top < vh && top + r.height > 0 && r.left < vw && r.right > 0;
    return { text: t, onFirstScreen: firstScreen, covered: inView(r) ? coveredAt(el, r) : null, present: true };
  };
  const lifeOf = (who) => {
    const all = [...document.querySelectorAll('[role=img][aria-label]')].filter((e) => /life/i.test(e.getAttribute("aria-label") ?? ""));
    const them = all.filter((e) => e.querySelector("[data-them]"));
    const you = all.filter((e) => !them.includes(e));
    return (who === "them" ? them : you)[0] ?? null;
  };
  const turn = document.querySelector("[data-turn]");
  const phase = document.querySelector('ol[aria-label="Phase"] li[aria-current="step"]');
  const youRes = document.querySelector('[data-player-resources="p1"]'), themRes = document.querySelector('[data-player-resources="p2"]');
  const overview = {
    turn: ov(turn),
    phase: ov(phase),
    youLife: ov(lifeOf("you"), lifeOf("you")?.getAttribute("aria-label")),
    themLife: ov(lifeOf("them"), lifeOf("them")?.getAttribute("aria-label")),
    youResources: ov(youRes),
    themResources: ov(themRes),
    prompt: ov(document.querySelector(".arena-bar")),
    decision: ov(document.querySelector("[data-decision-summary]")),
    stakes: ov(document.querySelector("[data-battle-stakes]")),
  };
  const dlg = [...document.querySelectorAll("dialog[open], [role=dialog], [role=alertdialog]")].find((d) => shown(d));
  const dialog = dlg ? { open: true, title: (dlg.querySelector("h2, h3")?.textContent ?? "").trim().slice(0, 120), text: (dlg.innerText ?? "").replace(/\\s+/g, " ").trim().slice(0, 600) } : { open: false, title: "", text: "" };
  const label = (el) => ((el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || el.tagName.toLowerCase()) + "").replace(/\\s+/g, " ").trim().slice(0, 60);
  const smallTargets = [];
  for (const el of document.querySelectorAll('button, a[href], [role=button], select, input:not([type=hidden]), summary')) {
    if (el.disabled) continue;
    const r = shown(el);
    if (!r || !inView(r)) continue;
    if (r.width < 43.5 || r.height < 43.5) smallTargets.push({ label: label(el), w: Math.round(r.width), h: Math.round(r.height) });
  }
  const tiny = new Map();
  const clipped = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const parts = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent.replace(/\\s+/g, " ").trim();
    if (!text) continue;
    const el = n.parentElement;
    if (!el || el.closest("script, style, noscript, [aria-hidden=true]")) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || !inView(r) || !shown(el)) continue;
    parts.push(text);
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px < 11 && !tiny.has(text)) tiny.set(text.slice(0, 60), Math.round(px * 10) / 10);
    for (let e = el, i = 0; e && i < 3; e = e.parentElement, i++) {
      const cs = getComputedStyle(e);
      const cut = (e.scrollWidth > e.clientWidth + 1 && (cs.overflowX === "hidden" || cs.textOverflow === "ellipsis")) || (e.scrollHeight > e.clientHeight + 1 && cs.webkitLineClamp !== "none" && cs.webkitLineClamp !== "");
      if (cut) { clipped.add((e.innerText ?? "").replace(/\\s+/g, " ").trim().slice(0, 100)); break; }
    }
  }
  const imgs = [...document.querySelectorAll("img")].filter((i) => { const r = shown(i); return r && inView(r); });
  return {
    vw, vh, dpr: devicePixelRatio, scrollY: Math.round(scrollY), pageHeight: document.documentElement.scrollHeight,
    sideways: document.documentElement.scrollWidth > vw + 1,
    overview, dialog,
    smallTargets: smallTargets.slice(0, 40),
    tinyText: [...tiny].slice(0, 40).map(([text, px]) => ({ text, px })),
    clipped: [...clipped].filter(Boolean).slice(0, 20),
    visibleText: parts.join(" · ").slice(0, 3000),
    cardsOnScreen: [...document.querySelectorAll("[data-arena-card]")].filter((c) => { const r = shown(c); return r && inView(r); }).length,
    brokenImages: imgs.filter((i) => !(i.complete && i.naturalWidth > 0)).length,
  };
})()`;

export interface Truth {
  revision: number; turn: number; turnPlayer: "you" | "them"; phase: string; step: string | null;
  asked: "you" | "them" | "referee" | null; question: string; hint: string | null; kind: string;
  you: { name: string; life: number; energyReady: number; energyTotal: number; hand: number; deck: number; drop: number; battle: string[] };
  them: { name: string; life: number; energyReady: number; energyTotal: number; hand: number; deck: number; drop: number; battle: string[] };
  battle: { attacker: string; guard: string; attackPower: number; guardPower: number; step: string } | null;
  legalMoves: number; newLog: string[]; over: string | null;
}

/** The moment as the engine has it, from the viewer's seat. `logFrom` is the log length at the previous shot. */
export function truthOf(s: Snapshot, logFrom: number): Truth {
  const v = s.view;
  const nameOf = (id: string) => [v.you.leader, v.them.leader, ...v.you.battle, ...v.them.battle].find((c) => c?.id === id)?.name ?? id;
  const side = (x: typeof v.you) => ({
    name: x.name, life: x.life, energyReady: x.activeEnergy, energyTotal: x.energy.length, hand: x.handCount, deck: x.deck, drop: x.drop,
    battle: x.battle.map((c) => `${c.name}${c.power != null ? ` ${c.power}` : ""}${c.mode === "rest" ? " (rested)" : ""}`),
  });
  const actor = s.decision?.actor ?? v.prompt.player;
  return {
    revision: s.game.revision, turn: v.turn, turnPlayer: v.turnPlayer === v.you.player ? "you" : "them",
    phase: v.phase, step: v.battle?.step ?? null,
    asked: actor == null ? (s.waiting === "referee" ? "referee" : null) : actor === v.you.player ? "you" : "them",
    question: v.prompt.question, hint: v.prompt.hint, kind: v.prompt.kind,
    you: side(v.you), them: side(v.them),
    battle: v.battle ? { attacker: nameOf(v.battle.attacker), guard: nameOf(v.battle.guard), attackPower: v.battle.attackPower, guardPower: v.battle.guardPower, step: v.battle.step } : null,
    legalMoves: s.legal.length, newLog: s.log.slice(logFrom), over: v.over ? `${v.over.winner ?? "draw"}: ${v.over.reason}` : null,
  };
}

export interface Finding { kind: string; severity: "major" | "minor"; detail: string }

/**
 * The objective findings of one shot. `decision`: the player is being asked something now (the
 * overview must be readable without scrolling, the question must be on screen).
 */
export function checksOf(f: ScreenFacts, t: Truth | null, o: { decision: boolean }): Finding[] {
  const out: Finding[] = [];
  if (f.sideways) out.push({ kind: "sideways-scroll", severity: "major", detail: `the page is wider than the screen (${f.vw} px)` });
  if (f.brokenImages) out.push({ kind: "broken-image", severity: "major", detail: `${f.brokenImages} image(s) on screen did not load` });
  for (const s of f.smallTargets) out.push({ kind: "small-tap-target", severity: "minor", detail: `"${s.label}" is ${s.w}x${s.h} px (44 px wanted)` });
  for (const s of f.tinyText) out.push({ kind: "tiny-text", severity: "minor", detail: `"${s.text}" at ${s.px} px` });
  for (const c of f.clipped) out.push({ kind: "clipped-text", severity: "minor", detail: `"${c}" is cut off` });
  for (const c of f.lowContrast ?? []) out.push({ kind: "low-contrast", severity: c.ratio < 3 ? "major" : "minor", detail: `"${c.text}" at ${c.ratio}:1 (${c.need}:1 needed)` });
  if (o.decision && !f.dialog.open) {
    const need: Array<[keyof ScreenFacts["overview"], string]> = [["turn", "whose turn"], ["phase", "the phase"], ["youLife", "your life"], ["themLife", "the opponent's life"], ["prompt", "the prompt bar"]];
    for (const [k, what] of need) {
      const x = f.overview[k];
      if (!x.present) out.push({ kind: "overview-missing", severity: "major", detail: `${what} is not drawn` });
      else if (!x.onFirstScreen) out.push({ kind: "overview-needs-scroll", severity: "major", detail: `${what} is not on the first screen (needs scrolling)` });
      else if (x.covered) out.push({ kind: "overview-covered", severity: "major", detail: `${what} is covered by something else` });
    }
    if (t) {
      const text = f.visibleText;
      if (!new RegExp(`\\b${t.you.life}\\b`).test(`${text} ${f.overview.youLife.text}`)) out.push({ kind: "truth-not-shown", severity: "minor", detail: `your life (${t.you.life}) is not readable as a number on screen` });
      if (!new RegExp(`\\b${t.them.life}\\b`).test(`${text} ${f.overview.themLife.text}`)) out.push({ kind: "truth-not-shown", severity: "minor", detail: `the opponent's life (${t.them.life}) is not readable as a number on screen` });
    }
  }
  return out;
}
