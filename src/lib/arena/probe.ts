/**
 * The probe: what a rule actually does, on a board built for it.
 *
 * A record says what the engine *will* play; a probe says what it *does*. It
 * builds a real game with two minimal decks, stages the one board the rule's
 * trigger needs, plays the one move under test, and answers every prompt that
 * follows with a fixed policy — so the same rule always gives the same run and
 * two runs can be compared (`digest`).
 *
 * Pure: `createGame` and `apply` and nothing else. No database, no network,
 * and **no compiler** — the programs of the cards it stages around the rule
 * are written out below, because `draft.ts` is the only module that compiles
 * card text in production.
 *
 * The words are the board's own: the log is `toBeats` → `narrate`, the same
 * pair the narration ribbon reads, so a probe and a game tell one story.
 */
import {
  apply,
  createGame,
  legalActions,
  rejectedActions,
  skillsOf,
  type Action,
  type CardDef,
  type CardScripts,
  type EngineContext,
  type GameState,
  type Op,
  type PlayerId,
  type Skill,
} from "./engine";
import type { Cond, SkillPrice, XCost } from "./engine/script";
import { parseFilter } from "./engine/filters";
import { addEffect, move } from "./engine/state";
import { sentence } from "./wording";
import { assumptionsOf, askedQuestion, boardChanges, candidatesOf, digestOf, emptyProbe, IDLE_PROMPTS, logLines, staticReading, type ProbeStep } from "./probe-report";
import type { ProbeFamily, ProbeOutcome, ProbeRule, ProbeRun, ProbeScenario, ProbeVariant } from "./probe-types";
export type { ProbeFamily, ProbeOutcome, ProbeRule, ProbeRun, ProbeScenario, ProbeVariant } from "./probe-types";

/**
 * A `card_rules` row as a rule to try. `program` is what the engine would run
 * — the row's hoisted condition already wrapped back around its steps, which
 * is `programOf` in the store; the probe never reads the table itself.
 */
export function ruleFrom(row: { side: string; skillIndex: number; kind: string; trigger: unknown; status: string; unread: string[]; cost?: unknown }, def: CardDef, program: Op[]): ProbeRule {
  const cost = row.cost as { condition?: Cond | null; program?: Op[] | null; x?: XCost } | null | undefined;
  return {
    price: { condition: cost?.condition ?? null, ops: cost?.program ?? null, ...(cost?.x ? { x: cost.x } : {}) },
    def,
    side: row.side === "back" ? "back" : "front",
    skillIndex: row.skillIndex,
    kind: row.kind,
    trigger: Array.isArray(row.trigger) ? (row.trigger as string[]) : [],
    ops: program,
    open: row.status === "open",
    unread: row.unread,
  };
}


// ── the cards the probe stages around the rule ─────────────────────────────
//
// Programs, not text: the probe never calls the compiler. `PROBE-KO` is the
// opponent's skill that a [Permanent] is measured against — it is offered a
// choice, and a card that cannot be chosen simply is not among the candidates.

const YOU: PlayerId = "p1";
const THEM: PlayerId = "p2";
const FILLER = "PROBE-CARD";
const ENERGY = "PROBE-ENERGY";
const BODY = "PROBE-BODY";
const BARRIER = "PROBE-BARRIER";
const KILLER = "PROBE-KO";
const MATCH = "PROBE-MATCH";
const LEADER = "PROBE-LEADER";
const THEIR_LEADER = "PROBE-RIVAL";

/** Names, so the log reads as a board rather than as a row of identifiers. */
const NAMES: Record<string, string> = {
  [FILLER]: "Nameless Fighter",
  [ENERGY]: "Energy Card",
  [BODY]: "Rival Fighter",
  [BARRIER]: "Barrier Fighter",
  [KILLER]: "Rival Executioner",
  [MATCH]: "Kindred Fighter",
  [LEADER]: "Your Leader",
  [THEIR_LEADER]: "Rival Leader",
};

const NO_PRICE: SkillPrice = { condition: null, ops: null };

const KO_PROGRAM: Op[] = [
  { op: "choose", sel: { side: "opponent", area: "battle", count: 1, upTo: true }, as: "t", reason: "choose a Battle Card to KO" },
  { op: "ko", target: { var: "t" } },
];

function body(id: string, o: Partial<CardDef> = {}): CardDef {
  return {
    id,
    name: NAMES[id] ?? id,
    type: "BATTLE",
    colors: ["Red"],
    energyCost: 1,
    zEnergyCost: null,
    power: 10000,
    comboCost: 1,
    comboPower: 5000,
    skill: null,
    characters: [id],
    traits: [],
    ...o,
  };
}

/** The two decks, the two leaders and the opponent's props — coloured to match the card under test. */
function propsFor(rule: ProbeRule): { defs: Record<string, CardDef>; scripts: Record<string, CardScripts> } {
  const colors = rule.def.colors.length ? rule.def.colors : (["Red"] as CardDef["colors"]);
  // The Leader is made to match the card: same colours, same characters, same
  // traits. Half the catalog's [Activate] skills are printed with "if your
  // Leader is a <Gotenks>" in front of them, and a nameless Leader answers
  // every one of them with "not met" — which is a fact about the board the
  // probe built, not about the rule it was asked to try. The input line says
  // so, because a board built in the card's favour has to be declared.
  const leader = (id: string): CardDef =>
    body(id, { type: "LEADER", colors, energyCost: null, comboCost: null, comboPower: null, power: 20000, characters: rule.def.characters, traits: rule.def.traits });
  const defs: Record<string, CardDef> = {};
  for (const d of [
    leader(LEADER),
    leader(THEIR_LEADER),
    body(FILLER, { colors }),
    body(ENERGY, { colors }),
    body(BODY, { colors }),
    body(MATCH, { colors }),
    body(BARRIER, { colors, skill: "[Barrier]" }),
    body(KILLER, { colors, energyCost: 1, skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and KO it." }),
    rule.def,
  ])
    defs[d.id] = d;
  const scripts: Record<string, CardScripts> = {
    [KILLER]: { bySkill: { 0: { ops: KO_PROGRAM, unsupported: [], price: NO_PRICE } }, complete: true, unsupported: [] },
  };
  const key = rule.side === "back" ? `${rule.def.id}#back` : rule.def.id;
  scripts[key] = {
    bySkill: { [rule.skillIndex]: rule.open ? { ops: [], unsupported: rule.unread, price: rule.price } : { ops: rule.ops, unsupported: [], price: rule.price } },
    complete: !rule.open,
    unsupported: rule.open ? rule.unread : [],
  };
  return { defs, scripts };
}

// ── which board the rule needs ─────────────────────────────────────────────

const PLAY_TRIGGERS = ["played", "youPlayed", "placed", "evolvedInto", "opponentPlayed", "overRealmPlayed"];
const BATTLE_TRIGGERS = ["attacks", "attacked", "kos", "dealtDamage", "opponentAttacks", "battleEnd", "yourLeaderAttacked", "offenseStart", "defenseStart", "damageStart", "blockerUsed", "koed"];
const COMBO_TRIGGERS = ["comboed", "youCombo", "opponentCombos"];
const MOMENT_TRIGGERS = ["turnEnd", "mainEnd", "mainStart", "chargeStart", "opponentTurnEnd", "opponentTurnStart", "opponentMainStart"];

/** The family a rule belongs to: the moment it answers to, or the way it is used. */
export function familyOf(rule: ProbeRule): ProbeFamily {
  const kind = rule.kind.toLowerCase();
  if (kind === "permanent") return "permanent";
  if (kind === "keyword") return "keyword";
  if (kind.startsWith("counter")) return "counter";
  if (kind === "activate:battle") return "activateBattle";
  if (kind.startsWith("activate")) return "activateMain";
  const t = rule.trigger;
  if (t.some((x) => PLAY_TRIGGERS.includes(x))) return "play";
  if (t.some((x) => BATTLE_TRIGGERS.includes(x))) return "attack";
  if (t.some((x) => COMBO_TRIGGERS.includes(x))) return "combo";
  if (t.some((x) => MOMENT_TRIGGERS.includes(x))) return "moment";
  return "none";
}

const TITLES: Record<ProbeFamily, string> = {
  play: "You play it · 6 energy · the opponent has two Battle Cards, one with [Barrier]",
  attack: "It attacks the opponent's Leader",
  combo: "The opponent attacks your Leader and you combo with it",
  activateMain: "Main Phase · 6 energy · the opponent has two Battle Cards, one with [Barrier]",
  activateBattle: "Mid-battle, with it attacking",
  counter: "The opponent attacks and you answer from hand",
  permanent: "In play, with the opponent activating a KO skill at it",
  keyword: "In play, with the keyword's own rule to answer for it",
  moment: "In play, and the turn is run to the moment it names",
  none: "The engine knows no moment for this wording",
};

const VARIANT_TITLES: Partial<Record<ProbeVariant, string>> = {
  noTarget: "the same board with nothing legal to point at",
  negated: "the same board with this card's skills negated",
  opponentTurn: "the same board on the opponent's turn",
  inHand: "the card in hand, where the skill is not valid",
};

const VARIANTS: Record<ProbeFamily, ProbeVariant[]> = {
  play: ["default", "noTarget", "negated"],
  attack: ["default", "negated"],
  combo: ["default"],
  activateMain: ["default", "noTarget", "negated", "opponentTurn"],
  activateBattle: ["default"],
  counter: ["default"],
  permanent: ["default", "inHand"],
  keyword: ["default"],
  moment: ["default"],
  none: ["default"],
};

/**
 * Every board this rule can be tried on, the first being the one a probe runs
 * by default.
 *
 * "Skills negated" is only offered for a card that is staged **in play**: an
 * effect on a card in hand ends the moment it is played, because the card that
 * arrives is a new card (3-1-4), so the variant would quietly be the default
 * one under another name.
 */
export function scenariosFor(rule: ProbeRule): ProbeScenario[] {
  const family = familyOf(rule);
  const inHand = stagedInHand(rule, family);
  return VARIANTS[family]
    .filter((variant) => !(variant === "negated" && inHand))
    .map((variant) => ({
      key: variant === "default" ? family : `${family}:${variant}`,
      family,
      variant,
      title: variant === "default" ? TITLES[family] : (VARIANT_TITLES[variant] ?? TITLES[family]),
    }));
}

/** Where the card is staged: the hand, when that is where the move is made from. */
function stagedInHand(rule: ProbeRule, family: ProbeFamily): boolean {
  const keyword = skillsOf(rule.def, rule.side).find((sk) => sk.index === rule.skillIndex)?.keyword?.name ?? null;
  const home = homeOf(rule.def);
  return family === "counter" || family === "combo" || (family === "keyword" && keyword != null && FROM_HAND.includes(keyword)) || (family === "play" && (home === "battle" || home === "hand"));
}

// ── staging ────────────────────────────────────────────────────────────────

/** Where a card of this type sits when its skill is valid (9-1-3). */
function homeOf(def: CardDef): "leader" | "unison" | "battle" | "hand" {
  if (def.type === "LEADER" || def.type === "Z-LEADER") return "leader";
  if (def.type === "UNISON" || def.type === "Z-UNISON") return "unison";
  if (def.type === "EXTRA" || def.type === "Z-EXTRA") return "hand";
  return "battle";
}

/** Keywords activated from the hand — the card has to be there or they are never offered. */
const FROM_HAND: string[] = ["Evolve", "Union", "Over Realm", "Arrival", "Successor", "Revive", "Aegis", "Alliance"];

function drive(ctx: EngineContext, s: GameState, actions: Action[]): GameState {
  for (const a of actions) s = apply(ctx, s, a).state;
  return s;
}

/**
 * A game in `actor`'s Main Phase with both players past a first turn, and both
 * hands emptied to the bottom of the deck so only what the probe stages is in
 * them.
 */
function opening(ctx: EngineContext, actor: PlayerId): GameState {
  let s = createGame(ctx, { seed: 7, p1: { name: "You", leader: LEADER, main: deck(FILLER) }, p2: { name: "Opponent", leader: THEIR_LEADER, main: deck(FILLER) } }).state;
  const chooser = (s.prompt as { player: PlayerId }).player;
  s = drive(ctx, s, [{ type: "chooseFirst", player: chooser, first: YOU }]);
  while (s.prompt.kind === "mulligan") s = drive(ctx, s, [{ type: "mulligan", player: s.prompt.player, redraw: false }]);
  // Turn 3 is the first turn both players have had one; the opponent's is 4.
  const until = actor === YOU ? 3 : 4;
  for (let i = 0; i < 12; i++) {
    if (s.prompt.kind === "charge") s = drive(ctx, s, [{ type: "charge", player: s.prompt.player, card: null }]);
    else if (s.prompt.kind === "main") {
      if (s.prompt.player === actor && s.turn >= until) break;
      s = drive(ctx, s, [{ type: "endMain", player: s.prompt.player }]);
    } else break;
  }
  for (const p of [YOU, THEM] as PlayerId[]) for (const id of s.players[p].hand.slice()) move(ctx, s, [], id, "deck", p, { position: "bottom" });
  return s;
}

const deck = (id: string) => Array.from({ length: 50 }, () => id);

/** A card of the probe's own from the bottom of the deck, put where the scenario wants it. */
function put(ctx: EngineContext, s: GameState, p: PlayerId, cardId: string, area: "hand" | "battle" | "energy" | "unison" | "drop"): string {
  const inst = s.players[p].deck[s.players[p].deck.length - 1];
  s.cards[inst].cardId = cardId;
  move(ctx, s, [], inst, area, p);
  return inst;
}

interface Goal {
  /** What the probe is waiting to be offered. */
  what: string;
  by: PlayerId;
  /** The prompts at which it should be on the menu; missing it there is the answer, not a reason to play on. */
  at: string[];
  /**
   * Missing it counts even when somebody else is being asked. "On the
   * opponent's turn" is the whole point of that scenario: without this the
   * probe waits politely for your next turn and answers a different question.
   */
  strict?: boolean;
  match: (a: Action) => boolean;
}

interface Staged {
  ctx: EngineContext;
  state: GameState;
  /** The instance the rule is on. */
  card: string;
  /** The card was staged in hand, where most skills are not valid (9-1-3). */
  inHand: boolean;
  skill: Skill | null;
  goals: Goal[];
  input: string[];
}

const onCard = (a: Action, id: string) => ("card" in a && a.card === id) || ("attacker" in a && a.attacker === id);

/** Whether a condition asks about markers, through `not`/`any`/`all`. */
function condMentionsMarkers(cond: Cond): boolean {
  if (cond.kind === "markers") return true;
  if (cond.kind === "not") return condMentionsMarkers(cond.cond);
  if (cond.kind === "any" || cond.kind === "all") return cond.conds.some(condMentionsMarkers);
  return false;
}

/**
 * Whether a program reads the markers on a card, through an `if`'s condition
 * or branches — a rule like this stages nothing to count without one
 * (`stage` never otherwise puts a marker on anything, see the caller).
 */
function usesMarkers(ops: Op[]): boolean {
  return ops.some((op) => {
    if (op.op === "if") return condMentionsMarkers(op.cond) || usesMarkers(op.then) || (op.else ? usesMarkers(op.else) : false);
    const amt = "amount" in op ? op.amount : "n" in op ? op.n : null;
    return !!amt && typeof amt === "object" && "markers" in amt;
  });
}

function stage(rule: ProbeRule, scenario: ProbeScenario): Staged {
  const { defs, scripts } = propsFor(rule);
  const ctx: EngineContext = { defs, scripts };
  const family = scenario.family;
  const skill = skillsOf(rule.def, rule.side).find((sk) => sk.index === rule.skillIndex) ?? null;
  const keyword = skill?.keyword?.name ?? null;
  const home = homeOf(rule.def);
  const theyAttack = family === "attack" && !rule.trigger.some((t) => ["attacks", "kos", "dealtDamage", "offenseStart", "battleEnd"].includes(t));
  const fromHand = stagedInHand(rule, family);
  const theirs = scenario.variant === "opponentTurn" || family === "permanent" || family === "combo" || family === "counter" || theyAttack || (family === "keyword" && !fromHand);
  const actor: PlayerId = theirs ? THEM : YOU;

  const s = opening(ctx, actor);
  const input: string[] = [`${actor === YOU ? "your" : "the opponent's"} Main Phase, turn ${s.turn}`];

  // The card under test, where its skill is valid — or in hand, when that is
  // where it is used from, and when the scenario is asking what happens there.
  const where = scenario.variant === "inHand" ? "hand" : fromHand ? "hand" : home;
  let card: string;
  if (where === "leader") {
    card = s.players[YOU].leader;
    s.cards[card].cardId = rule.def.id;
    if (rule.side === "back" && rule.def.type === "LEADER" && rule.def.back) s.cards[card].flipped = true;
  } else {
    card = put(ctx, s, YOU, rule.def.id, where);
  }
  input.push(`${rule.def.name} in ${where === "hand" ? "your hand" : where === "leader" ? "your Leader Area" : `your ${where === "unison" ? "Unison" : "Battle"} Area`}`);

  // A rule that reads its own markers ("for each marker on this card") is
  // otherwise staged on a card with none, which cannot tell a working
  // `markers` amount from a broken one — every board built for these cards
  // needs some to count.
  if (usesMarkers(rule.ops)) {
    s.cards[card].markers = 2;
    input.push(`${rule.def.name} has 2 markers on it`);
  }

  // Energy for both sides: the price is never what a probe is meant to fail on.
  for (let i = 0; i < 6; i++) put(ctx, s, YOU, ENERGY, "energy");
  for (let i = 0; i < 6; i++) put(ctx, s, THEM, ENERGY, "energy");
  input.push("6 energy each");
  if (rule.def.characters.length || rule.def.traits.length) input.push(`your Leader shares this card's colours${rule.def.characters.length ? `, ${rule.def.characters.join("/")}` : ""}${rule.def.traits.length ? ` and ${rule.def.traits.join("/")}` : ""}`);

  let theirBody: string | null = null;
  if (scenario.variant !== "noTarget") {
    theirBody = put(ctx, s, THEM, BODY, "battle");
    put(ctx, s, THEM, BARRIER, "battle");
    input.push("the opponent has two Battle Cards, one with [Barrier]");
  } else input.push("the opponent has nothing in play");

  if (scenario.variant === "negated") {
    addEffect(s, [], { target: card, kind: "negateSkills", value: 0, until: "turn", master: THEM });
    input.push("this card's skills are negated (9-1-5)");
  }

  const goals: Goal[] = [];
  if (family === "play" && fromHand) {
    goals.push({ what: `play ${rule.def.name}`, by: YOU, at: ["main"], match: (a) => onCard(a, card) && ["play", "playZ", "playUnison", "activate"].includes(a.type) });
  } else if (family === "play") {
    // A Leader's or Unison's "when you play a card": somebody else's card is played.
    const other = put(ctx, s, actor, FILLER, "hand");
    input.push(`a Battle Card in ${actor === YOU ? "your" : "the opponent's"} hand to play`);
    goals.push({ what: "a Battle Card is played", by: actor, at: ["main"], match: (a) => a.type === "play" && a.card === other });
  } else if (family === "attack" && !theyAttack) {
    const attacker = home === "battle" ? card : put(ctx, s, YOU, FILLER, "battle");
    // "When this card KOs a Battle Card" needs something it can KO: a rested
    // body, since 8-1-1 offers no active one, and a weak one so the clash goes
    // the attacker's way. Everything else attacks the Leader, which is the
    // move a card without a target still has.
    const kills = rule.trigger.some((t) => ["kos", "dealtDamage"].includes(t));
    if (kills && theirBody) {
      s.cards[theirBody].mode = "rest";
      ctx.defs[BODY] = body(BODY, { colors: rule.def.colors, power: 5000 });
      input.push("their Battle Card is rested and weaker, so the attack can take it");
    }
    const target = kills && theirBody ? theirBody : s.players[THEM].leader;
    goals.push({ what: `attack ${target === theirBody ? "their Battle Card" : "the opponent's Leader"}`, by: YOU, at: ["main"], match: (a) => a.type === "attack" && a.attacker === attacker && a.target === target });
  } else if (family === "attack") {
    // "When this card is attacked" needs it rested; the rest of the wordings
    // are about the Leader being attacked (8-1-1 offers no active card).
    const target = rule.trigger.some((t) => ["attacked", "koed"].includes(t)) ? card : s.players[YOU].leader;
    if (target === card) s.cards[card].mode = "rest";
    goals.push({ what: "the opponent attacks", by: THEM, at: ["main"], match: (a) => a.type === "attack" && a.target === target });
  } else if (family === "combo") {
    goals.push({ what: "the opponent attacks your Leader", by: THEM, at: ["main"], match: (a) => a.type === "attack" && a.target === s.players[YOU].leader });
    goals.push({ what: `combo with ${rule.def.name}`, by: YOU, at: ["combo"], match: (a) => a.type === "combo" && a.card === card });
  } else if (family === "counter") {
    const theirCard = put(ctx, s, THEM, FILLER, rule.kind === "counter:play" ? "hand" : "battle");
    goals.push(
      rule.kind === "counter:play"
        ? { what: "the opponent plays a Battle Card", by: THEM, at: ["main"], match: (a) => a.type === "play" && a.card === theirCard }
        : { what: "the opponent attacks", by: THEM, at: ["main"], match: (a) => a.type === "attack" && a.attacker === theirCard },
    );
    goals.push({ what: `counter with ${rule.def.name}`, by: YOU, at: ["counter"], match: (a) => a.type === "counter" && a.card === card });
  } else if (family === "activateMain" || family === "activateBattle") {
    if (family === "activateBattle") {
      const attacker = home === "battle" ? card : put(ctx, s, YOU, FILLER, "battle");
      goals.push({ what: "attack the opponent's Leader", by: YOU, at: ["main"], match: (a) => a.type === "attack" && a.attacker === attacker });
    }
    goals.push({
      what: `activate ${rule.def.name}`,
      by: YOU,
      at: family === "activateBattle" ? ["combo", "counter"] : ["main"],
      strict: scenario.variant === "opponentTurn",
      match: (a) => a.type === "activate" && a.card === card && a.skill === rule.skillIndex,
    });
  } else if (family === "permanent") {
    const killer = put(ctx, s, THEM, KILLER, "battle");
    input.push("the opponent has a card whose skill KOs one of yours");
    goals.push({ what: "the opponent activates a KO skill", by: THEM, at: ["main"], match: (a) => a.type === "activate" && a.card === killer });
  } else if (family === "keyword") {
    // [Evolve]{2}: <Nail> is offered only when a <Nail> is in play (22-5), and
    // the same is true of [Union], [Revive] and [Successor]. Staging a body
    // the keyword's own description matches is what makes the probe say what
    // the keyword *does* rather than that it was not offered.
    if (fromHand && skill) {
      const wanted = parseFilter(skill.effect || skill.cost);
      const named = put(ctx, s, YOU, MATCH, "battle");
      ctx.defs[MATCH] = body(MATCH, {
        colors: wanted.colors.length ? wanted.colors : rule.def.colors,
        characters: wanted.characters.length ? wanted.characters : wanted.charactersIncluding,
        traits: wanted.traits,
        name: wanted.characters[0] ?? wanted.names[0] ?? NAMES[MATCH],
      });
      input.push(`a Battle Card in your Battle Area that the keyword's description matches (${ctx.defs[MATCH].name})`);
      void named;
    }
    if (!fromHand) {
      goals.push({ what: "the opponent attacks your Leader", by: THEM, at: ["main"], match: (a) => a.type === "attack" && a.target === s.players[YOU].leader });
    }
    goals.push({
      what: `use ${keyword ? `[${keyword}]` : "the keyword"}`,
      by: YOU,
      at: ["main", "blocker", "combo", "counter"],
      // The keyword's own move — never an ordinary play of the same card,
      // which would say nothing about the keyword.
      match: (a) => onCard(a, card) && ["activate", "block", "counter", "combo"].includes(a.type),
    });
  } else if (family === "moment") {
    goals.push({ what: "run the turn to its end", by: actor, at: ["main"], match: (a) => a.type === "endMain" && a.player === actor });
  }

  return { ctx, state: s, card, inHand: where === "hand", skill, goals, input };
}

// ── answering, so the run is the same every time ───────────────────────────

/**
 * The probe's fixed policy. Its own side takes the offer — an optional cost is
 * paid, a choice is made, and the card the scenario is about is preferred when
 * it is among the candidates — and everything else is declined, so what is in
 * the log is the rule and not a second card's opinion of it.
 */
function answerFor(s: GameState, prefer: string): Action | null {
  const pr = s.prompt;
  switch (pr.kind) {
    case "chooseFirst":
      return { type: "chooseFirst", player: pr.player, first: YOU };
    case "mulligan":
      return { type: "mulligan", player: pr.player, redraw: false };
    case "charge":
      return { type: "charge", player: pr.player, card: null };
    case "main":
      return { type: "endMain", player: pr.player };
    case "combo":
      return { type: "pass", player: pr.player };
    case "blocker":
      return { type: "block", player: pr.player, card: null };
    case "counter":
      return { type: "counter", player: pr.player, card: null };
    case "optionalCost":
      return { type: "optionalCost", player: pr.player, pay: true };
    case "payCost":
      return { type: "payCost", player: pr.player, option: 0 };
    case "orderPending":
      return { type: "orderPending", player: pr.player, index: pr.candidates[0] };
    case "chooseMode":
      return { type: "chooseMode", player: pr.player, index: 0 };
    case "replaceMove":
      return { type: "chooseMode", player: pr.player, index: 0 };
    case "zEnergyFromCombo":
      return { type: "zEnergyFromCombo", player: pr.player, card: null };
    case "offering":
      return { type: "offering", player: pr.player, dropLife: false };
    // 22-45-3: the probe takes the maximum carry, the same reading the
    // engine gave every [Empower] before the choice existed — the most
    // informative answer for showing the interaction with a card's own
    // marker-counting skills, and never the wrong one to offer since "up to
    // Y" always permits it.
    case "empowerCarry":
      return { type: "empowerCarry", player: pr.player, amount: pr.max };
    case "chooseCards": {
      const ch = pr.choice;
      const order = ch.candidates.includes(prefer) ? [prefer, ...ch.candidates.filter((id) => id !== prefer)] : ch.candidates;
      const take = Math.min(ch.max, Math.max(ch.min, 1), order.length);
      return { type: "choose", player: pr.player, cards: order.slice(0, take) };
    }
    default:
      return null;
  }
}

// ── the probe ──────────────────────────────────────────────────────────────

const empty = (scenario: ProbeScenario, outcome: ProbeOutcome, said: string[]): ProbeRun => emptyProbe(scenario, outcome, said);

/**
 * Run one rule on one board and say what happened.
 *
 * Deterministic: one seed, two fixed decks, one fixed answering policy. The
 * only thing that varies is the rule.
 */
export function probe(rule: ProbeRule, scenario: ProbeScenario): ProbeRun {
  if (scenario.family === "none") {
    return empty(scenario, "noScenario", [
      rule.kind === "auto"
        ? "This skill names a moment the engine does not know, so there is no board on which to try it — which is also why a game never fires it."
        : "No scenario covers this kind of skill yet.",
    ]);
  }
  try {
    return runProbe(rule, scenario);
  } catch (err) {
    return empty(scenario, "error", [`the probe could not be run: ${err instanceof Error ? err.message : String(err)}`]);
  }
}

function runProbe(rule: ProbeRule, scenario: ProbeScenario): ProbeRun {
  const staged = stage(rule, scenario);
  const ctx = staged.ctx;
  let s = staged.state;
  const steps: ProbeStep[] = [];
  let goalIndex = 0;
  let testedAt = -1;
  let missed: Goal | null = null;
  let missedAt: GameState | null = null;

  for (let i = 0; i < 80 && s.phase !== "over"; i++) {
    const goal = staged.goals[goalIndex];
    const asked = "player" in s.prompt ? s.prompt.player : null;
    const hit = goal ? legalActions(ctx, s).find((l) => goal.match(l.action)) : undefined;
    if (goal && hit) {
      const ask = askedQuestion(ctx, s);
      const r = apply(ctx, s, hit.action);
      steps.push({ state: r.state, events: r.events, ask, chose: hit.label, candidates: candidatesOf(s) });
      s = r.state;
      goalIndex++;
      if (goalIndex === staged.goals.length) testedAt = steps.length - 1;
      continue;
    }
    // The move was expected here and is not on the menu: that is the answer.
    if (goal && goal.at.includes(s.prompt.kind) && (asked === goal.by || goal.strict)) {
      missed = goal;
      missedAt = s;
      break;
    }
    if (!goal && IDLE_PROMPTS.includes(s.prompt.kind as (typeof IDLE_PROMPTS)[number])) break;
    const answer = answerFor(s, staged.card);
    if (!answer) break;
    const ask = askedQuestion(ctx, s);
    const r = apply(ctx, s, answer);
    steps.push({ state: r.state, events: r.events, ask, chose: label(ctx, s, answer), candidates: candidatesOf(s) });
    s = r.state;
  }

  const from = testedAt < 0 ? steps.length : testedAt;
  const applied = logLines(ctx, steps, from);
  const result = boardChanges(ctx, steps, from);
  const assumptions = assumptionsOf(ctx, s, staged.card, rule, steps);
  const prompts = steps.filter((st) => st.ask).map((st) => ({ ask: st.ask as string, chose: st.chose }));
  const fired = steps.some((st) => st.events.some((e) => e.type === "skill" && e.card === staged.card && e.skill === rule.skillIndex));
  // Read on the board as it was staged: a [Permanent] whose card is KO'd a
  // moment later is not a [Permanent] that does nothing.
  const statics =
    scenario.family === "permanent" || scenario.family === "keyword"
      ? staticReading(ctx, staged.state, staged.card, rule, scenario.family === "keyword" ? (staged.skill?.keyword?.name ?? null) : null)
      : [];
  const koed = steps.some((st) => st.events.some((e) => e.type === "ko" && e.card === staged.card));
  const held = scenario.family === "permanent" && !koed && steps.length && !staged.inHand ? ["the opponent's KO skill could not take this card — it was never among the targets it was offered"] : [];

  let outcome: ProbeOutcome;
  if (missed) outcome = "notOffered";
  else if (rule.open) outcome = "blank";
  // A keyword line has no program, so no `skill` event ever names it: what
  // says it happened is the engine offering its move and the probe taking it.
  else if (fired || (scenario.family === "keyword" && goalIndex === staged.goals.length)) outcome = "fired";
  else if (scenario.family === "permanent" || scenario.family === "keyword") outcome = "inForce";
  else if (rule.open) outcome = "blank";
  else outcome = "didNotFire";

  const why = missed && missedAt ? refusals(ctx, missedAt, staged, missed) : [];
  const said = [...statics, ...held, ...result, ...why];
  return {
    scenario,
    input: staged.input,
    applied: missed ? [] : applied,
    result: said.length ? said : [outcome === "blank" ? "nothing happened: the skill has no program" : "nothing changed on the board"],
    assumptions,
    prompts,
    log: logLines(ctx, steps),
    outcome,
    digest: digestOf(outcome, missed ? [] : applied, said),
  };
}

/** Why the move was not on the menu, in the words a client shows. */
function refusals(ctx: EngineContext, state: GameState, staged: Staged, goal: Goal): string[] {
  const legal = legalActions(ctx, state);
  const rejected = rejectedActions(ctx, state, legal).filter((r) => goal.match(r.action));
  if (!rejected.length) return [`${goal.what} was never offered, and the engine gives no reason — it does not consider the move at all.`];
  const name = ctx.defs[state.cards[staged.card]?.cardId ?? ""]?.name ?? "this card";
  return rejected.flatMap((r) => r.why.map((w) => sentence(w, { name, reaching: r.action.type })));
}

/** What the probe answered, as the menu labelled it. */
function label(ctx: EngineContext, s: GameState, a: Action): string {
  return legalActions(ctx, s).find((l) => JSON.stringify(l.action) === JSON.stringify(a))?.label ?? a.type;
}
