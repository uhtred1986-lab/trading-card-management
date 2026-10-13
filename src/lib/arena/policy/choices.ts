/**
 * The local opponent's constrained choices (#650, plan O2-05): which cards to
 * pick for a "choose (up to) N" question, which printed mode or replacement to
 * take, whether to pay an optional price, how to answer [Offering], and in
 * which order simultaneous Autos resolve — decided by a bounded, deterministic
 * heuristic over what the seat may know (#644) and nothing else. With the
 * shortcuts (#645), the Main Phase (#646) and the battle (#647) this answers
 * every `DECISION_WINDOWS` kind; `WINDOW_HANDLERS` says which layer answers
 * which, and the type fails to compile if a window is left out.
 *
 *   chooseCards   one compound `pick` (the whole set at once, validated by the
 *                 contract and played card by card through the engine
 *                 boundary — never a single menu entry taken for a complete
 *                 choice). Whose cards they are and what happens to them is
 *                 read off the candidates' owner/area and the resolving
 *                 skill's own sentence (the last public skill beat). A pick
 *                 that hurts the opponent or helps the seat takes as many as
 *                 the question allows, the most valuable first (`cardValue`;
 *                 rested energy first when the effect stands it up); one that
 *                 costs the seat (to the Drop, the Warp, the deck's bottom, a
 *                 KO, a Life card at 3 or fewer) takes the fewest it must, the
 *                 least valuable first. "Different names" and a 22-30-3 colour
 *                 cover are honoured while choosing.
 *   chooseMode    every option is scored and the best taken, ties to the
 *   replaceMove   first printed: a price ("Pay: …", "Pay {r} and …") is worth
 *   optionalCost  paying when it costs less than the skill is worth (1.5: an
 *   offering      energy 0.25, a card from hand 1, a marker 0.75, a Life card
 *                 its `lifeLoss` less the card gained); [Offering]'s
 *                 "drop 1 life" is taken when that life costs less than the
 *                 two cards it denies; a replacement goes where the card is
 *                 worth most (hand > field > life > energy > deck > Drop >
 *                 Warp), a substitute ("Instead: …") counting as staying put
 *                 less its price; "you may" is done unless what it does costs
 *                 the seat more than it is worth; a printed mode by what its
 *                 words do (KO, draw, power, to hand).
 *   orderPending  the earliest-triggered Auto first, never withheld.
 *   payCost       `main.ts`'s rule; the first offered payment only when that
 *                 rule reads none.
 *
 * `optionalCost` and `offering` are prompt kinds of the legacy engine only:
 * the rules engine the local runtime pins (`browser.ts`) asks an Auto's price
 * and [Offering] as `chooseMode` (glossary: [Offering]; `vm/flow.ts`'s
 * "Pay this Auto skill's cost?"), which the same scorer answers. Their
 * handlers exist so the shared contract has no unanswered kind.
 *
 * **Bounded.** At most `CHOICE_LIMITS.candidates` candidates and
 * `CHOICE_LIMITS.options` options are considered, every step counted against
 * `CHOICE_LIMITS.work`. **Deterministic.** No RNG (the policy RNG is handed back
 * untouched), no clock, no hidden card: an alias is an alias, ties go to the
 * canonical order. A question none of this reads returns null, and the policy
 * below it (`interruptingPolicy` by default) interrupts.
 *
 * Policy layer: value imports only from `src/lib/arena/policy/` (checked by
 * `scripts/verify/arena-policy-contract.mts`).
 */
import type { PlayerId } from "../types";
import { answerFor, type DecisionWindow, type MenuDecision, type PickDecision, type Policy, type PolicyInput } from "./contract";
import { cardValue, lifeLoss } from "./main";
import type { CardFacts, PolicyObservation } from "./observation";

export const CHOICE_POLICY_VERSION = 1;

export const CHOICE_LIMITS = {
  /** Candidates of a card pick considered (by canonical id). */
  candidates: 64,
  /** Options of a mode / replacement / price question considered. */
  options: 32,
  /** Scoring steps per decision. */
  work: 4096,
} as const;

/** The windows this module answers (payCost only when `main.ts`'s rule reads no payment). */
export const CHOICE_WINDOWS = ["orderPending", "chooseCards", "chooseMode", "replaceMove", "optionalCost", "offering", "payCost"] as const;

export type HandlerLayer = "shortcuts" | "main" | "combat" | "choices";

/**
 * Which layer of `localPolicy` answers each engine question (#650's coverage
 * matrix). `rulesEngine: false` marks a kind only the legacy engine asks; the
 * rules engine asks the same thing as the window named in `asked`.
 */
export const WINDOW_HANDLERS: Record<DecisionWindow, { layer: HandlerLayer; rule: string; rulesEngine: boolean; asked?: DecisionWindow }> = {
  chooseFirst: { layer: "shortcuts", rule: "takes the first turn", rulesEngine: true },
  mulligan: { layer: "shortcuts", rule: "keeps two cards costing 2 or less, else redraws", rulesEngine: true },
  charge: { layer: "shortcuts", rule: "charges the dearest / off-colour card", rulesEngine: true },
  main: { layer: "main", rule: "scored plays, activations, attacks, endMain", rulesEngine: true },
  combo: { layer: "combat", rule: "cheapest sufficient cover when the battle is worth it", rulesEngine: true },
  blocker: { layer: "combat", rule: "least expected loss, ties to not blocking", rulesEngine: true },
  counter: { layer: "combat", rule: "a negating counter against a costlier threat", rulesEngine: true },
  orderPending: { layer: "choices", rule: "earliest-triggered Auto first, never withheld", rulesEngine: true },
  chooseCards: { layer: "choices", rule: "compound pick by polarity, value, count, unique names and colour cover", rulesEngine: true },
  chooseMode: { layer: "choices", rule: "best-scored option: prices, [Offering], may, printed modes", rulesEngine: true },
  replaceMove: { layer: "choices", rule: "the destination worth most; a substitute is staying put less its price", rulesEngine: true },
  zEnergyFromCombo: { layer: "shortcuts", rule: "keeps the Z-Energy", rulesEngine: true },
  optionalCost: { layer: "choices", rule: "pays when the price is below the skill's worth", rulesEngine: false, asked: "chooseMode" },
  payCost: { layer: "main", rule: "keeps the most of the hand payable (choices: first offered payment when unread)", rulesEngine: true },
  offering: { layer: "choices", rule: "drops a life when it costs less than the two cards denied", rulesEngine: false, asked: "chooseMode" },
  empowerCarry: { layer: "shortcuts", rule: "carries the maximum", rulesEngine: true },
};

export interface ChoiceResult {
  id: string;
  /** For a pick: the cards, by the ids/aliases the decision listed. */
  cards?: string[];
  /** Why, for the log. */
  how: string;
  /** Steps spent. Never more than `CHOICE_LIMITS.work`. */
  work: number;
  /** Options or candidates considered. */
  considered: number;
  bounded: boolean;
}

class Work {
  n = 0;
  constructor(readonly limit: number) {}
  step(): boolean {
    if (this.n >= this.limit) return false;
    this.n++;
    return true;
  }
  get spent(): boolean {
    return this.n >= this.limit;
  }
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// ---------------------------------------------------------------------------------------------
// Reading the board.

interface Where {
  card: CardFacts | null;
  owner: PlayerId | null;
  area: string | null;
}

/**
 * Where a candidate lies and what it is: an alias says its owner and area; a readable id is looked
 * up on the board; a card only the question shows (a life card, a deck search) is placed by the
 * question's own words ("… in your life", "… your opponent's deck").
 */
function locate(o: PolicyObservation, id: string, reason: string): Where {
  const found = locateOnBoard(o, id);
  if (found.owner || !found.card) return found;
  const area = /\blife\b/i.test(reason) ? "life" : /\bdeck\b/i.test(reason) ? "deck" : /drop area/i.test(reason) ? "drop" : /\bwarp\b/i.test(reason) ? "warp" : /\bhand\b/i.test(reason) ? "hand" : null;
  return { ...found, owner: /opponent'?s/i.test(reason) ? (o.seat === "p1" ? "p2" : "p1") : o.seat, area };
}

function locateOnBoard(o: PolicyObservation, id: string): Where {
  const alias = /^\?(p[12]):([A-Za-z]+):/.exec(id);
  if (alias) return { card: o.prompt.mine ? (o.prompt.choices.find((c) => c.id === id) ?? null) : null, owner: alias[1] as PlayerId, area: alias[2] };
  for (const side of [o.you, o.them]) {
    const areas: [string, (CardFacts | null)[]][] = [
      ["leader", [side.leader]], ["unison", [side.unison]], ["battle", side.battle], ["combo", side.combo], ["energy", side.energy],
      ["hand", side.hand ?? []], ["life", side.lifeFaceUp], ["drop", side.dropCards], ["warp", side.warpCards], ["zEnergy", side.zEnergyCards], ["zDeck", side.zDeckFaceUp],
    ];
    for (const [area, list] of areas) for (const c of list) if (c && c.id === id) return { card: c, owner: side.player, area };
  }
  const shown = o.prompt.mine ? o.prompt.choices.find((c) => c.id === id) : undefined;
  return { card: shown ?? null, owner: null, area: null };
}

/** The text of the skill resolving now, when the seat may read it: the last public skill beat. */
function resolvingSkill(o: PolicyObservation): { text: string; owner: PlayerId } | null {
  for (let i = o.beats.list.length - 1; i >= 0; i--) {
    const b = o.beats.list[i];
    if (b.t === "skill") return b.text ? { text: b.text, owner: b.owner } : null;
    if (b.t === "phase") return null;
  }
  return null;
}

/** The words of `text` that follow `reason` up to the end of its sentence ("… and KO it"), or "" when the reason is not quoted. */
function clauseAfter(text: string, reason: string): string {
  const want = reason.replace(/\s*\(\d+ more\)\s*$/i, "").replace(/^[^:]*\]:\s*/, "").trim().toLowerCase();
  if (!want) return "";
  const at = text.toLowerCase().indexOf(want);
  if (at < 0) return "";
  const rest = text.slice(at + want.length);
  // The sentence ends at a full stop, or where a following step starts (", then shuffle your deck").
  const end = rest.search(/[.;]|,?\s+then\b/i);
  return end < 0 ? rest : rest.slice(0, end);
}

/** What happens to a chosen card that hurts its owner. */
const HARM = /\bko\b|k\.o\.|drop area|\bwarp\b|bottom of|rest mode|can'?t|cannot|\bloses?\b|-\d+\s*power|negate|discard|under (this|a|your|it)|shuffle|return/i;
/** What helps it. */
const HELP = /\+\d+\s*power|\bgains?\b|active mode|to (your|their) hand|\bplay\b|\bdraws?\b|marker|to your life/i;

// ---------------------------------------------------------------------------------------------
// Prices and option words.

/** The seat's cost of `text` read as a price; `null` when nothing in it reads as one. */
function priceOf(text: string, o: PolicyObservation): number | null {
  const t = text.toLowerCase();
  let cost = 0;
  let read = false;
  const n = (re: RegExp, fallback = 1) => {
    const m = re.exec(t);
    return m ? Number(m[1]) : fallback;
  };
  const orbs = (t.match(/\{[a-z0-9]\}/g) ?? []).length;
  if (orbs) { cost += 0.25 * orbs; read = true; }
  const energy = /(\d+)\s+energy/.exec(t);
  if (energy && /\b(rest|pay)\b/.test(t)) { cost += 0.25 * Number(energy[1]); read = true; }
  if (/\blife\b/.test(t) && /\bhand\b/.test(t)) {
    const k = n(/(\d+) cards? (?:from|in) your life/);
    cost += lifeLoss(o.you.life, k, false, false) - k;
    read = true;
  } else if (/\blife\b/.test(t) && /drop area|discard/.test(t)) {
    cost += lifeLoss(o.you.life, n(/(\d+) cards? (?:from|in) your life/), true, false);
    read = true;
  } else if (/\bhand\b/.test(t) && /drop area|discard|\bwarp\b|bottom of/.test(t)) {
    cost += n(/(\d+) cards? (?:from|in) your hand/);
    read = true;
  } else if (/\bdiscard\b/.test(t)) {
    cost += n(/discard (\d+)/);
    read = true;
  }
  const markers = /remove (\d+) markers?/.exec(t);
  if (markers) { cost += 0.75 * Number(markers[1]); read = true; }
  if (/this card/.test(t) && /rest mode/.test(t) && !/active mode/.test(t)) { cost += 0.5; read = true; }
  return read ? cost : null;
}

/** What an option's words do for the seat, read crudely: a KO, a draw, power, a card to hand. */
function effectWorth(text: string): number {
  const t = text.toLowerCase();
  let v = 0;
  if (/\bko\b/.test(t)) v += 3;
  const draw = /draws? (\d+)/.exec(t);
  if (draw) v += Number(draw[1]);
  const power = /\+(\d+)\s*power/.exec(t);
  if (power) v += Number(power[1]) / 5000;
  if (/to your hand/.test(t)) v += 1;
  if (/active mode/.test(t)) v += 0.5;
  if (/(your opponent|their).*(drop area|discard)/.test(t)) v += 1;
  return v;
}

const AREA_WORTH: [RegExp, number][] = [
  [/\bthe hand\b|your hand/, 6],
  [/battle area|unison area|leader area/, 5],
  [/\blife\b/, 4],
  [/energy area|z-energy/, 3],
  [/combo area/, 2],
  [/top of the deck/, 2],
  [/bottom of the deck/, 1],
  [/\bdeck\b|z-deck/, 1.5],
  [/the drop/, 0.5],
  [/the warp/, 0],
  [/out of the game/, -1],
];
const areaWorth = (text: string) => AREA_WORTH.find(([re]) => re.test(text.toLowerCase()))?.[1] ?? 1;

/** Skill effect worth against which a price is weighed. */
const SKILL_WORTH = 1.5;
/** An unreadable price is assumed to cost about a card. */
const UNKNOWN_PRICE = 1;
const isDecline = (label: string) => /^(don'?t|do not|decline|no\b|keep life|keep going|carry no)/i.test(label.trim());

interface Scored {
  d: MenuDecision;
  score: number;
  how: string;
}

/** One option of a mode, replacement, price or [Offering] question, scored for the seat. */
function scoreOption(o: PolicyObservation, window: string, question: string, d: MenuDecision, label: string, skill: { owner: PlayerId } | null): Scored {
  const l = label.trim();
  // The legacy engine's own kinds (never asked by the rules engine).
  if (d.type === "offering") {
    const drop = d.action.dropLife === true;
    const cost = lifeLoss(o.you.life, 1, true, false);
    return { d, score: drop ? 2 - cost : 0, how: drop ? `[Offering]: drops a life (costs ${cost.toFixed(2)}) rather than give two cards` : "[Offering]: keeps the life; the opponent draws 2" };
  }
  if (d.type === "optionalCost") {
    const pay = d.action.pay === true;
    const price = priceOf(o.prompt.mine ? (o.prompt.cost ?? l) : l, o) ?? UNKNOWN_PRICE;
    return { d, score: pay ? SKILL_WORTH - price : 0, how: pay ? `pays (${price.toFixed(2)} < ${SKILL_WORTH})` : "declines the price" };
  }
  // [Offering] on the rules engine: the general "choose one" prompt (glossary: [Offering]).
  if (/\[offering\]/i.test(question) || /deny the draw|opponent draws 2/i.test(l)) {
    const drop = /drop 1 life/i.test(l);
    const cost = lifeLoss(o.you.life, 1, true, false);
    return { d, score: drop ? 2 - cost : 0, how: drop ? `[Offering]: drops a life (costs ${cost.toFixed(2)} < 2 cards)` : "[Offering]: keeps the life; the opponent draws 2" };
  }
  // A replacement (9-10): where the card ends up.
  if (window === "replaceMove" || /instead of going to/i.test(question)) {
    const keep = /^keep going to (.*)$/i.exec(l);
    if (keep) return { d, score: areaWorth(keep[1]), how: `lets the move happen (${keep[1]})` };
    const to = /^to (.*)$/i.exec(l);
    if (to) return { d, score: areaWorth(to[1]), how: `replaces the move: ${to[1]}` };
    const instead = /^instead:\s*(.*)$/i.exec(l);
    const price = instead ? (priceOf(instead[1], o) ?? UNKNOWN_PRICE) : UNKNOWN_PRICE;
    return { d, score: 4 - price, how: `takes the substitute and stays (${(instead?.[1] ?? l).slice(0, 60)})` };
  }
  if (isDecline(l)) return { d, score: 0, how: `declines (${l.slice(0, 40)})` };
  // A price: "Pay: …" for an Auto (vm/flow.ts) or "Pay {r} and switch … to Active Mode".
  const pay = /^pay\b:?\s*(.*)$/i.exec(l);
  if (pay) {
    const price = priceOf(pay[1], o) ?? UNKNOWN_PRICE;
    const gain = /active mode/i.test(pay[1]) ? 0.5 : 0;
    return { d, score: SKILL_WORTH + gain - price, how: `pays ${pay[1].slice(0, 50)} (${price.toFixed(2)} vs ${SKILL_WORTH})` };
  }
  // "You may …" (20-16): done unless what it does costs the seat more than it is worth.
  if (window === "chooseMode" && (/optional$/i.test(question) || l === question.trim() || /^do it$/i.test(l))) {
    const price = priceOf(l, o) ?? 0;
    const mine = !skill || skill.owner === o.seat;
    return { d, score: (mine ? 1 : 0.5) - price, how: `does it (${l.slice(0, 50)})` };
  }
  // A printed mode (20-2).
  return { d, score: effectWorth(l) - (priceOf(l, o) ?? 0), how: `mode: ${l.slice(0, 60)}` };
}

function bestOption(input: PolicyInput, work: Work): ChoiceResult | null {
  const { observation: o, decisions } = input;
  const open = decisions.decisions.filter((d): d is MenuDecision => d.kind === "menu").sort(byId).slice(0, CHOICE_LIMITS.options);
  if (!open.length) return null;
  const question = o.prompt.mine ? o.prompt.question : "";
  const skill = resolvingSkill(o);
  // The engine's printed order (its option index) is the tie-break: "the first printed option".
  const ordered = [...open].sort((a, b) => Number(a.action.index ?? a.action.pay === false) - Number(b.action.index ?? b.action.pay === false) || byId(a, b));
  let best: Scored | null = null;
  let considered = 0;
  for (const d of ordered) {
    if (!work.step()) break;
    considered++;
    const s = scoreOption(o, decisions.window, question, d, d.label, skill);
    if (!best || s.score > best.score + 1e-9) best = s;
  }
  if (!best) return null;
  return { id: best.d.id, how: best.how, work: work.n, considered, bounded: work.spent };
}

// ---------------------------------------------------------------------------------------------
// Card picks.

interface Candidate {
  id: string;
  where: Where;
  value: number;
}

function pickChoice(input: PolicyInput, pick: PickDecision, work: Work): ChoiceResult | null {
  const o = input.observation;
  const reason = pick.reason;
  const skill = resolvingSkill(o);
  const clause = `${clauseAfter(skill?.text ?? "", reason)} ${/\[swap\]/i.test(reason) ? "play" : ""}`.trim();
  const words = `${reason} ${clause}`;
  const pool = [...pick.candidates].sort().slice(0, CHOICE_LIMITS.candidates);
  if (!pool.length) {
    if (!pick.upTo) return null;
    return { id: pick.id, cards: [], how: "nothing to choose: declines", work: work.n, considered: 0, bounded: false };
  }
  const located: Candidate[] = [];
  for (const id of pool) {
    if (!work.step()) break;
    const where = locate(o, id, reason);
    located.push({ id, where, value: where.card ? cardValue(where.card) : 1 });
  }
  const opponent: PlayerId = o.seat === "p1" ? "p2" : "p1";
  const owners = located.map((c) => c.where.owner ?? (/opponent'?s/i.test(reason) ? opponent : o.seat));
  const theirs = owners.filter((p) => p !== o.seat).length > owners.length / 2;
  const harmful = HARM.test(clause);
  const lifeToHand = !theirs && located.every((c) => c.where.area === "life") && /hand/i.test(words);
  const owed = pick.remaining === null ? 1 : Math.min(pick.remaining, located.length);
  // Does choosing more help the seat? Hurting the opponent or helping itself does; paying from its own cards does not.
  let generous: boolean;
  let why: string;
  if (theirs) { generous = !(HELP.test(clause) && !HARM.test(clause)); why = generous ? "targets the opponent's most valuable" : "gives the opponent its least valuable"; }
  else if (lifeToHand) { generous = o.you.life - owed > 3; why = generous ? "takes a Life card while life allows" : "keeps its life"; }
  else if (harmful) { generous = false; why = "pays with its least valuable"; }
  // A question about the seat's own hand that no readable skill sentence explains is the price of
  // something already agreed to (a replacement's substitute, an Auto's price after "Pay"): it is
  // paid in full — never dodged with an empty "up to" answer — with the least valuable cards.
  else if (!clause && located.every((c) => c.where.area === "hand")) { generous = false; why = "pays the agreed price with its least valuable"; }
  else { generous = true; why = "takes its most valuable"; }
  const agreedPrice = !theirs && !lifeToHand && !harmful && !clause && located.every((c) => c.where.area === "hand");
  const count = generous || agreedPrice ? owed : pick.upTo ? 0 : owed;
  const standsUp = /active mode/i.test(clause);
  const rank = (c: Candidate) => c.value + (standsUp && c.where.area === "energy" && c.where.card?.mode === "rest" ? 100 : 0);
  const ordered = [...located].sort((a, b) => (generous ? rank(b) - rank(a) : rank(a) - rank(b)) || byId(a, b));
  const unique = /different (card )?names/i.test(words);
  const chosen: Candidate[] = [];
  const names = new Set<string>();
  const fits = (c: Candidate) => !chosen.includes(c) && !(unique && c.where.card && names.has(c.where.card.name));
  const take = (c: Candidate) => { chosen.push(c); if (c.where.card) names.add(c.where.card.name); };
  // 22-30-3: cover each colour first, then fill.
  for (const colour of pick.cover ?? []) {
    if (chosen.length >= count || chosen.some((c) => c.where.card?.colors.includes(colour))) continue;
    const c = ordered.find((x) => fits(x) && !!x.where.card?.colors.includes(colour) && work.step());
    if (c) take(c);
  }
  for (const c of ordered) {
    if (chosen.length >= count) break;
    if (!work.step()) break;
    if (fits(c)) take(c);
  }
  if (!pick.upTo && chosen.length < count) return null;
  return { id: pick.id, cards: chosen.map((c) => c.id), how: `${why}: ${chosen.length} of ${located.length} (${pick.upTo ? "up to" : "exactly"} ${pick.remaining ?? "?"})`, work: work.n, considered: located.length, bounded: work.spent };
}

// ---------------------------------------------------------------------------------------------
// The windows.

/** The choice for this input, or null outside these windows (or when the question cannot be read). Pure. */
export function choiceDecision(input: PolicyInput): ChoiceResult | null {
  const { decisions } = input;
  if (decisions.actor !== decisions.seat || !decisions.decisions.length) return null;
  const work = new Work(CHOICE_LIMITS.work);
  const menu = decisions.decisions.filter((d): d is MenuDecision => d.kind === "menu").sort(byId);
  switch (decisions.window as DecisionWindow) {
    case "chooseCards": {
      const pick = decisions.decisions.find((d): d is PickDecision => d.kind === "pick");
      if (pick) return pickChoice(input, pick, work);
      // No compound question was described: one offered card at a time, declining last.
      const one = menu.find((d) => d.type === "choose" && Array.isArray(d.action.cards) && (d.action.cards as unknown[]).length > 0) ?? menu[0];
      return one ? { id: one.id, how: "the first offered card (no compound question)", work: 1, considered: menu.length, bounded: false } : null;
    }
    case "chooseMode":
    case "replaceMove":
    case "optionalCost":
    case "offering":
      return bestOption(input, work);
    case "orderPending": {
      const resolve = menu.filter((d) => d.type === "orderPending" && d.action.decline !== true).sort((a, b) => Number(a.action.index) - Number(b.action.index) || byId(a, b));
      const d = resolve[0];
      return d ? { id: d.id, how: `resolves the earliest-triggered Auto (choice ${Number(d.action.index) + 1})`, work: resolve.length, considered: menu.length, bounded: false } : null;
    }
    case "payCost": {
      const d = menu.find((x) => x.type === "payCost");
      return d ? { id: d.id, how: "pays with the first offered payment (no payment detail to weigh)", work: 1, considered: menu.length, bounded: false } : null;
    }
    default:
      return null;
  }
}

/** A policy that answers the constrained choices and defers everything else to `fallback`. Draws no randomness of its own. */
export function choicesThen(fallback: Policy): Policy {
  return (input, rng) => {
    const hit = choiceDecision(input);
    return hit ? { answer: answerFor(input.decisions, hit.id, hit.cards), rng } : fallback(input, rng);
  };
}
