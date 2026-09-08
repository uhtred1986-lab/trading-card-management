/**
 * How much of the catalog's card text the compiler reads — without a database.
 *
 * `arena:coverage` needs `DATABASE_URL` and the Neon driver; this reads the
 * same catalog straight from deckplanet (the public feed the catalog sync
 * imports) and runs the same pure compiler over it, so the figure can be taken
 * on any machine and by the rules-language work as each primitive lands
 * (`docs/arena-ruleset-spec.md`). Beside the compile rate it counts which ops
 * and conditions the compiled programs actually use, and the clause shapes the
 * compiler cannot read — the evidence the language is designed against.
 *
 * `npm run arena:tally [-- --misses 60]`
 */
import { fetchDeckplanet, shapeCatalog } from "../src/lib/catalog/deckplanet";
import { cardDefFrom } from "../src/lib/arena/load";
import { parseSkills } from "../src/lib/arena/engine/cards";
import { compileSkill } from "../src/lib/arena/engine/compile";
import type { Cond, Op } from "../src/lib/arena/engine/script";

const args = process.argv.slice(2);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const missRows = Number(value("misses") ?? 45) || 45;

const raw = await fetchDeckplanet("dbs");
const shaped = shapeCatalog(raw, "dbs");
const defs = shaped.cards.map((c) => cardDefFrom(c));

const ops = new Map<string, number>();
const conds = new Map<string, number>();
const misses = new Map<string, number>();
const kinds = new Map<string, number>();
const costs = new Map<string, number>();
let skills = 0;
let compiled = 0;
let permanent = 0;
let permanentCompiled = 0;
let keywordOnly = 0;
let full = 0;
let unreadClauses = 0;

const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

function walkCond(c: Cond | null | undefined): void {
  if (!c) return;
  bump(conds, c.kind);
  if ("conds" in c) c.conds.forEach(walkCond);
  if ("cond" in c) walkCond(c.cond);
}

function walk(list: Op[] | null | undefined): void {
  for (const op of list ?? []) {
    bump(ops, op.op);
    if ("cond" in op) walkCond(op.cond);
    if ("then" in op) walk(op.then);
    if ("else" in op) walk(op.else);
    if ("ops" in op) walk(op.ops);
    if ("modes" in op) for (const m of op.modes) walk(m.ops);
  }
}

/** Numbers, names, traits and characters collapsed, so a wording is counted once. */
const shape = (clause: string) =>
  clause
    .toLowerCase()
    .replace(/\d+/g, "N")
    .replace(/<[^>]*>|\{[^}]*\}|≪[^≫]*≫/g, "…")
    .slice(0, 70);

for (const d of defs) {
  let ok = true;
  for (const text of [d.skill, d.back?.skill]) {
    if (!text) continue;
    for (const sk of parseSkills(text)) {
      bump(kinds, sk.kind);
      if (sk.cost) bump(costs, sk.cost.replace(/\d+/g, "N").replace(/\{[^}]*\}/g, "{o}").toLowerCase().slice(0, 50));
      if (!sk.effect.trim()) {
        keywordOnly++;
        continue;
      }
      const s = compileSkill(sk);
      walk(s.ops);
      if (s.price?.condition) walkCond(s.price.condition);
      if (s.price?.ops) walk(s.price.ops);
      if (sk.kind === "permanent") {
        permanent++;
        if (!s.unsupported.length) permanentCompiled++;
      } else {
        skills++;
        if (!s.unsupported.length) compiled++;
      }
      if (s.unsupported.length) {
        ok = false;
        for (const cl of s.unsupported) {
          unreadClauses++;
          bump(misses, shape(cl));
        }
      }
    }
  }
  if (ok) full++;
}

const pct = (a: number, b: number) => (b === 0 ? "—" : `${((100 * a) / b).toFixed(1)} %`);
const top = (m: Map<string, number>, n: number) =>
  [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${String(v).padStart(5)}×  ${k}`)
    .join("\n");

console.log(`cards ${defs.length}, fully compiled ${full} (${pct(full, defs.length)})`);
console.log(`resolvable skills ${skills} → ${pct(compiled, skills)} compiled | [Permanent] ${permanent} → ${pct(permanentCompiled, permanent)} read | keyword-only ${keywordOnly}`);
console.log(`unread clauses ${unreadClauses} over ${misses.size} distinct shapes`);
console.log(`\nskill kinds\n${top(kinds, 20)}`);
console.log(`\nops used (${ops.size} kinds)\n${top(ops, 60)}`);
console.log(`\nconditions used (${conds.size} kinds)\n${top(conds, 30)}`);
console.log(`\ncost shapes\n${top(costs, 25)}`);
console.log(`\nunread shapes\n${top(misses, missRows)}`);
process.exit(0);
