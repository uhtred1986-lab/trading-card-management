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
import { db } from "../src/db";
import { cards as cardsTable } from "../src/db/schema";
import { compileCardCached, parseSkills, type CardDef } from "../src/lib/arena/engine";
import { cardDefFrom } from "../src/lib/arena/load";

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

const all = await db.select().from(cardsTable);
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
process.exit(0);
