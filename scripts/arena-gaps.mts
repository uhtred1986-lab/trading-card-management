/**
 * What the rules engine is still missing, counted rather than guessed.
 *
 * Every clause the compiler cannot read, across the whole catalog, sorted into
 * the *mechanism* it would need. A clause that needs a queue of delayed
 * effects is a different problem from one that needs a new phrase pattern, and
 * only the first is a feature. This is the evidence for what to build next.
 *
 * `npm run arena:gaps`
 */
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { DEFAULT_GAME } from "../src/lib/catalog/games";
import { cards as cardsTable } from "../src/db/schema";
import { compileCardCached, parseSkills, type CardDef } from "../src/lib/arena/engine";
import { compileCostProgram, costIsOnlyOrbs, priceCondition } from "../src/lib/arena/engine/compile";
import { emitsStatic } from "../src/lib/arena/engine/state";
import { autoTriggerMatches } from "../src/lib/arena/engine/triggers";
import type { Trigger } from "../src/lib/arena/engine/types";
import { cardDefFrom } from "../src/lib/arena/load";

/** Every moment the engine knows about, for the orphan-trigger check below. */
const TRIGGERS: Trigger[] = [
  "leaderPlaced",
  "played",
  "attacks",
  "attacked",
  "koed",
  "kos",
  "dealtDamage",
  "chargeStart",
  "mainStart",
  "mainEnd",
  "turnEnd",
  "battleEnd",
  "comboed",
  "opponentPlayed",
  "opponentAttacks",
  "opponentCombos",
  "youCombo",
  "placed",
  "removedFromBattle",
  "removedByOpponent",
  "droppedFromBattle",
  "evolvedInto",
  "opponentCounter",
  "opponentMainStart",
  "blockerUsed",
  "restedByAlliance",
  "addedToZEnergy",
  "energyToDrop",
  "unisonToDrop",
  "markerRemoved",
  "restedBySkill",
  "unionActivated",
  "overlordActivated",
  "overRealmPlayed",
  "spiritBoostPaid",
  "flippedFaceUp",
  "offenseStart",
  "defenseStart",
  "damageStart",
];

/** Ordered: the first bucket a clause matches wins, so put the specific first. */
const MECHANISMS: { key: string; needs: string; test: RegExp }[] = [
  { key: "delayed effect", needs: "a queue of effects that fire at a later timing (1-7-2-1-1)", test: /\bat the (?:end|start|beginning) of (?:your|the|their|this|your opponent's)\b|\bduring your (?:next|opponent's)\b|\buntil (?:the )?(?:end|start)\b|\bnext turn\b/ },
  { key: "replacement effect", needs: "replacing an event with another before it happens (9-10)", test: /\binstead\b|\bwould (?:be|leave|deal|receive|go)\b/ },
  { key: "prohibition", needs: "continuous rules that forbid an action (20-14)", test: /\bcan'?t\b|\bcannot\b|\bunable to\b|\bmay not\b/ },
  { key: "modal choice", needs: "choose one of several printed options (20-2)", test: /choose one[-—―]|・/ },
  { key: "count-based amount", needs: "a number read off the board (\"for each …\")", test: /\bfor each\b|\bequal to the number\b|\btimes the number\b|\bx is\b/ },
  { key: "cards under cards", needs: "a real under-stack, not a move to the Drop (23-2)", test: /\bunder (?:this|that|the) card\b|\bplace it on top of\b|\bfrom under\b/ },
  { key: "static in other areas", needs: "permanent skills that hold outside the Battle Area (9-1-3-3)", test: /\bin all areas\b|\bin your hand\b.*\bgets?\b|\bwhile (?:this|you)\b|\bduring your turn\b|\bduring your opponent's turn\b/ },
  { key: "cost change", needs: "raising or lowering a cost as a continuous effect (20-21)", test: /\b(?:reduce|increase|add) (?:the )?(?:energy |combo |skill )?cost\b|\bcosts? \d+ (?:more|less)\b/ },
  { key: "targeting protection", needs: "\"unaffected by skills\" beyond [Barrier] (20-4)", test: /\bunaffected by\b|\bnot affected by\b|\bignoring\b/ },
  { key: "reveal / look at", needs: "showing cards to a player and acting on what is seen (20-11)", test: /\breveal\b|\blook at\b|\bshow\b/ },
  { key: "search a secret area", needs: "choosing from deck or life with the reveal rules (20-12)", test: /\bfrom your deck\b|\bin your life\b|\bfrom your life\b/ },
  { key: "keyword not implemented", needs: "one of the §22 keywords the engine does not carry out", test: /\[(?:aegis|alliance|arrival|revive|successor|rejuvenate|spirit boost|empower|invoker|heroic|villainous|burst|bond|sparking|barrier|deflect|energy-exhaust)\b/i },
  { key: "skill negation", needs: "negating a named kind of skill, not all of them (9-1-5)", test: /\bnegate\b/ },
  // Only clauses that actually *do* something to energy. Merely naming an
  // energy cost is a phrasing problem, and lumping the two together inflates
  // this bucket well beyond its real size.
  { key: "energy manipulation", needs: "moving and re-orienting energy as an effect (3-8)", test: /\b(?:of|in|to|from|into) your (?:opponent's )?energy\b|\benergy (?:area|marker)\b|\bas energy\b|\benergy to (?:active|rest) mode\b/ },
  { key: "turn structure", needs: "skipping or adding phases and turns (20-13)", test: /\bskip\b|\bextra turn\b|\banother turn\b/ },
];

// The arena only plays `dbs` decks (src/lib/catalog/games.ts), so Fusion
// World text is not counted here.
const all = await db.select().from(cardsTable).where(eq(cardsTable.game, DEFAULT_GAME));
const defs: CardDef[] = all.map(cardDefFrom);

interface Bucket {
  clauses: number;
  cards: Set<string>;
  examples: { cardId: string; clause: string }[];
}
const buckets = new Map<string, Bucket>();
let unreadClauses = 0;
let unreadCards = 0;
let phrasingOnly = 0;

for (const d of defs) {
  let touched = false;
  for (const side of ["front", "back"] as const) {
    const text = side === "front" ? d.skill : d.back?.skill;
    if (!text) continue;
    const scripts = compileCardCached(d, side);
    for (const sk of parseSkills(text)) {
      const sc = scripts.bySkill[sk.index];
      if (!sc || !sc.unsupported.length) continue;
      touched = true;
      for (const clause of sc.unsupported) {
        unreadClauses++;
        const low = clause.toLowerCase();
        const hit = MECHANISMS.find((m) => m.test.test(low));
        const key = hit?.key ?? "phrasing only";
        if (!hit) phrasingOnly++;
        const b = buckets.get(key) ?? { clauses: 0, cards: new Set<string>(), examples: [] };
        b.clauses++;
        b.cards.add(d.id);
        if (b.examples.length < 3 && clause.length < 110) b.examples.push({ cardId: d.id, clause });
        buckets.set(key, b);
      }
    }
  }
  if (touched) unreadCards++;
}

console.log(`${defs.length} cards · ${unreadCards} have at least one skill the compiler cannot read · ${unreadClauses} clauses in total\n`);
console.log("What each unreadable clause would actually need:\n");
const rows = [...buckets.entries()].sort((a, b) => b[1].cards.size - a[1].cards.size);
for (const [key, b] of rows) {
  const needs = MECHANISMS.find((m) => m.key === key)?.needs ?? "a phrase pattern in the compiler, no new mechanism";
  console.log(`${String(b.cards.size).padStart(5)} cards  ${String(b.clauses).padStart(5)} clauses   ${key}`);
  console.log(`                              → ${needs}`);
  for (const e of b.examples) console.log(`                                 e.g. ${e.cardId}: "${e.clause}"`);
  console.log();
}
console.log(`${phrasingOnly} clauses need no new mechanism at all — only a pattern the compiler does not have yet.\n`);

/*
 * "Mentions it" and "is blocked only by it" are different numbers, and the
 * second is the one worth ranking by. A card that needs delayed effects *and*
 * replacement effects is not unlocked by building either one alone.
 */
const blockers = new Map<string, Set<string>>();
for (const d of defs) {
  const mine = new Set<string>();
  for (const side of ["front", "back"] as const) {
    const text = side === "front" ? d.skill : d.back?.skill;
    if (!text) continue;
    const scripts = compileCardCached(d, side);
    for (const sk of parseSkills(text)) {
      const sc = scripts.bySkill[sk.index];
      if (!sc) continue;
      for (const clause of sc.unsupported) {
        const hit = MECHANISMS.find((m) => m.test.test(clause.toLowerCase()));
        if (hit) mine.add(hit.key);
      }
    }
  }
  if (mine.size === 1) {
    const only = [...mine][0];
    blockers.set(only, (blockers.get(only) ?? new Set()).add(d.id));
  }
}
console.log("Cards whose *only* missing mechanism is this one — what building it unlocks,");
console.log("once the routine phrasing work on those same cards is also done:\n");
for (const [key, set] of [...blockers.entries()].sort((a, b) => b[1].size - a[1].size)) {
  console.log(`${String(set.size).padStart(5)} cards   ${key}`);
}

/*
 * The list that should actually drive the work.
 *
 * Sorting wordings by how often they appear turned out to be the wrong
 * question: a clause that turns up 100 times is usually sitting in a skill
 * with three other unread clauses, so reading it finishes nothing. What
 * finishes a skill is being the *last* thing in the way of it.
 *
 * So: of every skill the compiler cannot read, how many are one clause away —
 * and which wordings are that one clause?
 */
const distance = new Map<number, number>();
const lastInTheWay = new Map<string, { skills: number; cards: Set<string>; example: string }>();
let resolvable = 0;

for (const d of defs) {
  for (const side of ["front", "back"] as const) {
    const text = side === "front" ? d.skill : d.back?.skill;
    if (!text) continue;
    const scripts = compileCardCached(d, side);
    for (const sk of parseSkills(text)) {
      // [Permanent] skills are never "resolved"; they are counted separately
      // by arena:coverage, and mixing them in here hides the working list.
      if (!sk.effect.trim() || sk.kind === "permanent") continue;
      const sc = scripts.bySkill[sk.index];
      if (!sc) continue;
      resolvable++;
      distance.set(sc.unsupported.length, (distance.get(sc.unsupported.length) ?? 0) + 1);
      if (sc.unsupported.length !== 1) continue;
      const clause = sc.unsupported[0];
      const key = clause
        .toLowerCase()
        .replace(/\d+/g, "N")
        .replace(/<[^>]*>|\{[^}]*\}|≪[^≫]*≫/g, "…")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 70);
      const e = lastInTheWay.get(key) ?? { skills: 0, cards: new Set<string>(), example: `${d.id}: ${clause.replace(/\s+/g, " ")}` };
      e.skills++;
      e.cards.add(d.id);
      lastInTheWay.set(key, e);
    }
  }
}

console.log(`\n\n${resolvable} resolvable skills, by how far they are from compiling:\n`);
for (const n of [...distance.keys()].sort((a, b) => a - b)) {
  const label = n === 0 ? "read" : `${n} clause${n === 1 ? "" : "s"} in the way`;
  console.log(`${String(distance.get(n)).padStart(6)}  ${label}`);
}

console.log("\nThe wordings that are the *only* thing holding a skill back — fix these first:\n");
for (const [, e] of [...lastInTheWay.entries()].sort((a, b) => b[1].skills - a[1].skills).slice(0, 25)) {
  console.log(`${String(e.skills).padStart(5)} skills on ${String(e.cards.size).padStart(4)} cards`);
  console.log(`        e.g. ${e.example.slice(0, 110)}`);
}

/**
 * [Auto] skills that compile and can never happen, because no `Trigger` in the
 * engine matches the moment they name.
 *
 * These are worse than a gap and invisible to every other measure here: the
 * compiler reads them, the coverage counts them, and the engine sits there.
 * Fixing one is engine work (a `Trigger`, a wording in `autoTriggerMatches`,
 * and a `pendTriggers` call where the event happens) rather than a pattern.
 */
const orphan = new Map<string, { skills: number; cards: Set<string>; example: string }>();
let orphans = 0;
for (const d of defs) {
  for (const side of ["front", "back"] as const) {
    const text = side === "front" ? d.skill : d.back?.skill;
    if (!text) continue;
    const scripts = compileCardCached(d, side);
    for (const sk of parseSkills(text)) {
      if (sk.kind !== "auto" || !sk.effect.trim()) continue;
      if (scripts.bySkill[sk.index]?.unsupported.length !== 0) continue;
      if (TRIGGERS.some((t) => autoTriggerMatches(sk, t))) continue;
      orphans++;
      const said = `${sk.cost} ${sk.effect}`.toLowerCase();
      const when = /\b(?:when|at the (?:end|beginning|start))\b[^,.]*/.exec(said);
      const key = (when ? when[0] : "(names no moment)")
        .replace(/\d+/g, "N")
        .replace(/<[^>]*>|\{[^}]*\}|≪[^≫]*≫/g, "…")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 70);
      const e = orphan.get(key) ?? { skills: 0, cards: new Set<string>(), example: key };
      e.skills++;
      e.cards.add(d.id);
      orphan.set(key, e);
    }
  }
}

console.log(`\n\n${orphans} [Auto] skills compile but no trigger ever fires them — the engine reads`);
console.log("them and then waits for a moment it does not know about:\n");
for (const [, e] of [...orphan.entries()].sort((a, b) => b[1].skills - a[1].skills).slice(0, 20)) {
  console.log(`${String(e.skills).padStart(5)} skills on ${String(e.cards.size).padStart(4)} cards   ${e.example}`);
}

/**
 * The same blind spot for the other two kinds. `activatable` in `engine.ts`
 * only offers a skill when its **cost** is readable as well as its effect — a
 * price the engine cannot charge must not be waived — so an [Activate] or
 * [Counter] whose effect compiles perfectly is still never offered when the
 * text before the colon defeats `parseConditionClause`.
 *
 * This mirrors `costIsReadable`, which is not exported; keep the two together.
 */
const costReadable = (sk: ReturnType<typeof parseSkills>[number]) => {
  if (costIsOnlyOrbs(sk.cost)) return true;
  // A price that only states a condition, with or without an "if" in front.
  if (priceCondition(sk)) return true;
  // An action price is readable when it compiles; whether it can be *paid* is
  // a question about the board, which only `canPayCostProgram` can answer.
  return compileCostProgram(sk) !== null;
};

const unpayable = new Map<string, { skills: number; cards: Set<string>; example: string }>();
let unpayables = 0;
for (const d of defs) {
  for (const side of ["front", "back"] as const) {
    const text = side === "front" ? d.skill : d.back?.skill;
    if (!text) continue;
    const scripts = compileCardCached(d, side);
    for (const sk of parseSkills(text)) {
      if (!sk.kind.startsWith("activate") && !sk.kind.startsWith("counter")) continue;
      if (!sk.effect.trim() || scripts.bySkill[sk.index]?.unsupported.length !== 0) continue;
      if (costReadable(sk)) continue;
      unpayables++;
      const key = sk.cost
        .toLowerCase()
        .replace(/\d+/g, "N")
        .replace(/<[^>]*>|\{[^}]*\}|≪[^≫]*≫/g, "…")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 70);
      const e = unpayable.get(key) ?? { skills: 0, cards: new Set<string>(), example: key };
      e.skills++;
      e.cards.add(d.id);
      unpayable.set(key, e);
    }
  }
}

console.log(`\n\n${unpayables} [Activate]/[Counter] skills compile but are never offered, because the`);
console.log("engine cannot read the price before the colon and will not waive one:\n");
for (const [, e] of [...unpayable.entries()].sort((a, b) => b[1].skills - a[1].skills).slice(0, 20)) {
  console.log(`${String(e.skills).padStart(5)} skills on ${String(e.cards.size).padStart(4)} cards   ${e.example}`);
}

/**
 * And the third kind. A [Permanent] skill is never resolved; `collectStatics`
 * reads its program and emits standing effects from the ops it knows. A
 * program made of anything else compiles and then does nothing — grouped here
 * by the ops it produced, because that is what says which static kind is
 * missing.
 */
const inert = new Map<string, { skills: number; cards: Set<string>; example: string }>();
let inerts = 0;
for (const d of defs) {
  for (const side of ["front", "back"] as const) {
    const text = side === "front" ? d.skill : d.back?.skill;
    if (!text) continue;
    const scripts = compileCardCached(d, side);
    for (const sk of parseSkills(text)) {
      if (sk.kind !== "permanent" || !sk.effect.trim()) continue;
      const sc = scripts.bySkill[sk.index];
      if (!sc || sc.unsupported.length || emitsStatic(sc.ops)) continue;
      inerts++;
      const key = sc.ops.map((o) => o.op).join(" + ") || "(nothing at all — the text was a reminder)";
      const e = inert.get(key) ?? { skills: 0, cards: new Set<string>(), example: `${d.id}: ${sk.effect.replace(/\s+/g, " ").slice(0, 60)}` };
      e.skills++;
      e.cards.add(d.id);
      inert.set(key, e);
    }
  }
}

console.log(`\n\n${inerts} [Permanent] skills compile but emit no standing effect — the static layer`);
console.log("has no kind for what they say, so they read cleanly and do nothing:\n");
for (const [key, e] of [...inert.entries()].sort((a, b) => b[1].skills - a[1].skills).slice(0, 15)) {
  console.log(`${String(e.skills).padStart(5)} skills on ${String(e.cards.size).padStart(4)} cards   ${key}`);
  console.log(`        e.g. ${e.example}`);
}
process.exit(0);
