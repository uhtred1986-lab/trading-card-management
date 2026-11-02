/**
 * `npm run arena:errata-check -- --snapshot <catalog.json>` — does the catalog text the compiler
 * reads carry Bandai's official errata (`docs/rules/errata-official.json`)? For each errata
 * entry it compares the card's text (after `correctSkillText`, the repo's own errata layer)
 * with the official "before" and "after" text, by shared word sequences:
 *
 *   current   the text matches "after"                      nothing to do
 *   stale     the text is closer to "before" than "after"   add the fix to src/lib/catalog/errata.ts
 *   unclear   neither matches (a keyword-only or rules-note errata, or a reworded line) — read it
 *
 * Offline: reads the snapshot from `npm run arena:snapshot`.
 */
import fs from "node:fs";
import path from "node:path";
import { correctSkillText } from "../src/lib/catalog/errata";

const args = process.argv.slice(2);
const at = args.indexOf("--snapshot");
if (at < 0 || !args[at + 1]) throw new Error("usage: arena:errata-check -- --snapshot <catalog.json>");
const snap = JSON.parse(fs.readFileSync(args[at + 1], "utf8")) as { cards: { id: string; skill: string | null; backSkill: string | null }[] };
const official = (JSON.parse(fs.readFileSync(path.resolve("docs/rules/errata-official.json"), "utf8")) as { errata: { id: string; before: string; after: string; notes: string }[] }).errata;

const words = (s: string) => s.toLowerCase().replace(/&lt;|&gt;/g, " ").replace(/<br>/g, " ").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
const shingles = (s: string, n = 4) => { const w = words(s); const out = new Set<string>(); for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" ")); return out; };
const share = (part: string, whole: Set<string>) => { const p = shingles(part); if (!p.size) return 0; let hit = 0; for (const s of p) if (whole.has(s)) hit++; return hit / p.size; };

const byId = new Map(snap.cards.map((c) => [c.id, c]));
const rows: { id: string; verdict: string; after: number; before: number }[] = [];
for (const e of official) {
  const c = byId.get(e.id);
  if (!c) { rows.push({ id: e.id, verdict: "not in catalog", after: 0, before: 0 }); continue; }
  const text = [c.skill, c.backSkill].filter(Boolean).map((t) => correctSkillText(e.id, t) ?? "").join(" ");
  const have = shingles(text);
  const a = share(e.after, have), b = share(e.before, have);
  const verdict = a >= 0.8 && a >= b ? "current" : b > a + 0.15 && b >= 0.6 ? "stale" : "unclear";
  rows.push({ id: e.id, verdict, after: Math.round(a * 100), before: Math.round(b * 100) });
}
const count = (v: string) => rows.filter((r) => r.verdict === v).length;
console.log(`errata-check: ${official.length} official errata — current ${count("current")}, stale ${count("stale")}, unclear ${count("unclear")}, not in catalog ${count("not in catalog")}`);
for (const v of ["stale", "unclear", "not in catalog"]) {
  const list = rows.filter((r) => r.verdict === v);
  if (list.length) console.log(`\n${v} (${list.length}):\n${list.map((r) => `  ${r.id}  after ${r.after}%  before ${r.before}%`).join("\n")}`);
}
