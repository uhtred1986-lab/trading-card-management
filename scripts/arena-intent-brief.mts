/**
 * `npm run arena:intent -- --snapshot <catalog.json> <cardId> [...]` — everything worth knowing
 * before deciding how a card was meant to play, in one page, offline:
 *
 *   - the card, its set and release, and its stored rules (reading, unread clauses, status)
 *   - the official sources: its own Q&A, its errata, general Q&A on the keywords it prints
 *   - the rulings ledger entries that name it (`src/lib/arena/rulings.ts`)
 *   - the Leaders of its release and the release before that share a colour, character or trait
 *     with it, with their skills (a card is usually built for those Leaders)
 *   - cards of those two releases that name it or its characters (its intended partners)
 *   - other cards printing its unread wording, and which of them have an official answer
 *
 * The snapshot comes from `npm run arena:snapshot` (one database read, by the owner or an
 * authorised session). With no official answer, the reading that lets the card do its job with
 * those Leaders is the intent; record the decision in the ledger with basis "intent".
 */
import fs from "node:fs";
import path from "node:path";
import { RULINGS } from "../src/lib/arena/rulings";
import { faqKey } from "../src/lib/rules-review/faq";

interface SnapCard { id: string; set: string; type: string; colors: string[] | string | null; cost: string | null; name: string; characters: string[] | string | null; traits: string[] | string | null; skill: string | null; backName: string | null; backSkill: string | null }
interface SnapRule { cardId: string; side: string; skillIndex: number; kind: string; status: string; source: string; printed: string; reads: string; unread: string[] }
interface SnapSet { code: string; name: string; line: string; releasedOn: string | null; sortKey: number }
interface Snapshot { taken: string; sets: SnapSet[]; cards: SnapCard[]; rules: SnapRule[] }
interface Qa { q: string; a: string }

const args = process.argv.slice(2);
const at = args.indexOf("--snapshot");
if (at < 0 || !args[at + 1]) throw new Error("usage: arena:intent -- --snapshot <catalog.json> <cardId> [...]");
const snap = JSON.parse(fs.readFileSync(args[at + 1], "utf8")) as Snapshot;
const ids = args.filter((_, i) => i !== at && i !== at + 1);

const faq = JSON.parse(fs.readFileSync(path.resolve("src/lib/rules-review/faq.generated.json"), "utf8")) as Record<string, { name: string; qa: Qa[] }[]>;
const errata = (JSON.parse(fs.readFileSync(path.resolve("docs/rules/errata-official.json"), "utf8")) as { errata: { id: string; before: string; after: string; notes: string }[] }).errata;
const gameFaq = fs.readFileSync(path.resolve("docs/rules/game-faq.txt"), "utf8").split("\n");

const list = (v: string[] | string | null): string[] => (Array.isArray(v) ? v : v ? String(v).replace(/^\{|\}$/g, "").split(",").map((s) => s.replace(/^"|"$/g, "").trim()).filter(Boolean) : []);
const byId = new Map(snap.cards.map((c) => [c.id, c]));
const sets = [...snap.sets].sort((a, b) => a.sortKey - b.sortKey);
const setOf = new Map(sets.map((s) => [s.code, s]));
const clip = (s: string | null | undefined, n = 400) => { const t = (s ?? "").replace(/<br>|\n/g, " / ").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n) + " …" : t; };
const norm = (s: string) => s.toLowerCase().replace(/&lt;|&gt;/g, "").replace(/[<{≪][^>}≫]*[>}≫]/g, "#").replace(/\d+/g, "N").replace(/[^a-z#n ]+/g, " ").replace(/\s+/g, " ").trim();

/** The release before `code` on the same line, by the catalog's own ordering. */
function previousRelease(code: string): SnapSet | null {
  const s = setOf.get(code);
  if (!s || s.code === "P") return null;
  const same = sets.filter((x) => x.line === s.line && x.code !== "P" && /^(BT|EX|SD|TB|DB|EB|XD)/.test(x.code));
  const i = same.findIndex((x) => x.code === code);
  return i > 0 ? same[i - 1] : null;
}

for (const id of ids) {
  const c = byId.get(id);
  if (!c) { console.log(`\n# ${id}: not in the snapshot`); continue; }
  const colors = list(c.colors), chars = list(c.characters), traits = list(c.traits);
  const set = setOf.get(c.set);
  const prev = previousRelease(c.set);
  console.log(`\n# ${c.id} ${c.name} — ${c.type}, ${colors.join("/") || "no colour"}, cost ${c.cost ?? "-"}`);
  console.log(`release: ${set ? `${set.code} ${set.name} (${set.releasedOn ?? "date unknown"}, ${set.line})` : c.set}${prev ? `; previous: ${prev.code} ${prev.name}` : ""}`);
  console.log(`characters: ${chars.join(", ") || "-"}; traits: ${traits.join(", ") || "-"}`);
  console.log(`text: ${clip(c.skill, 2000)}`);
  if (c.backSkill) console.log(`back (${c.backName}): ${clip(c.backSkill, 2000)}`);

  console.log(`\n## Stored rules`);
  for (const r of snap.rules.filter((r) => r.cardId === id).sort((a, b) => a.side.localeCompare(b.side) || a.skillIndex - b.skillIndex)) {
    console.log(`- #${r.skillIndex}${r.side === "back" ? "b" : ""} [${r.kind}] ${r.status}/${r.source}: ${clip(r.reads, 600)}${r.unread.length ? `\n  UNREAD: ${r.unread.join(" | ")}` : ""}`);
  }

  console.log(`\n## Official sources`);
  for (const e of faq[faqKey(id)] ?? []) for (const qa of e.qa) console.log(`- Q: ${clip(qa.q, 500)}\n  A: ${clip(qa.a, 500)}`);
  if (!faq[faqKey(id)]) console.log(`- no card Q&A`);
  for (const e of errata.filter((e) => e.id === id)) console.log(`- ERRATA after: ${clip(e.after, 600)}${e.notes ? ` (note: ${clip(e.notes, 200)})` : ""}`);
  const kws = [...new Set((c.skill ?? "").match(/\[[A-Za-z][A-Za-z :\-]+?\]/g) ?? [])].filter((k) => !/^\[(Auto|Permanent|Activate|Counter)/i.test(k));
  for (const k of kws) {
    const hits = gameFaq.map((l, i) => [l, i] as const).filter(([l]) => /^Q\d+\./.test(l) && l.toLowerCase().includes(k.toLowerCase()));
    for (const [l, i] of hits.slice(0, 3)) console.log(`- general Q&A on ${k}: ${clip(l, 300)} → ${clip(gameFaq[i + 1], 300)}`);
  }

  console.log(`\n## Rulings ledger`);
  const own = RULINGS.filter((r) => r.cards.includes(id));
  for (const r of own) console.log(`- ${r.id} [${r.status}, ${r.basis}, ${r.confidence}]: ${r.ruling}`);
  if (!own.length) console.log(`- none names this card`);

  const releases = [c.set, prev?.code].filter(Boolean) as string[];
  const leaders = snap.cards.filter((l) => l.type.toUpperCase().includes("LEADER") && releases.includes(l.set)
    && (list(l.colors).some((x) => colors.includes(x)) || list(l.characters).some((x) => chars.includes(x)) || list(l.traits).some((x) => traits.includes(x))));
  console.log(`\n## Leaders of ${releases.join(" and ")} sharing a colour, character or trait (${leaders.length})`);
  for (const l of leaders.slice(0, 8)) {
    const why = [list(l.characters).some((x) => chars.includes(x)) && "character", list(l.traits).some((x) => traits.includes(x)) && "trait", list(l.colors).some((x) => colors.includes(x)) && "colour"].filter(Boolean).join("+");
    console.log(`- ${l.id} ${l.name} (${why}): ${clip(l.skill, 300)}${l.backSkill ? `\n  back ${l.backName}: ${clip(l.backSkill, 300)}` : ""}`);
  }

  const names = [c.name, ...chars].filter((n) => n && n.length > 2);
  const partners = snap.cards.filter((p) => p.id !== id && releases.includes(p.set) && names.some((n) => (p.skill ?? "").includes(`{${n}}`) || (p.skill ?? "").includes(`&lt;${n}&gt;`) || (p.skill ?? "").includes(`<${n}>`)));
  console.log(`\n## Cards of those releases naming it or its characters (${partners.length})`);
  for (const p of partners.slice(0, 10)) console.log(`- ${p.id} ${p.name}: ${clip(p.skill, 250)}`);

  const unread = snap.rules.filter((r) => r.cardId === id).flatMap((r) => r.unread);
  for (const clause of unread) {
    const key = norm(clause);
    if (key.split(" ").length < 4) continue;
    const same = snap.cards.filter((o) => o.id !== id && norm(`${o.skill ?? ""} ${o.backSkill ?? ""}`).includes(key));
    console.log(`\n## Other cards printing "${clip(clause, 120)}" (${same.length})`);
    for (const o of same.slice(0, 10)) console.log(`- ${o.id}${faq[faqKey(o.id)] ? ` (has official Q&A: ${faq[faqKey(o.id)].reduce((n, e) => n + e.qa.length, 0)})` : ""}`);
  }
}
