/**
 * Refresh the data behind the claude.ai rules-review skill (`skills/dbs-rules-review/`).
 *
 * Offline: the public deckplanet feed through the same loader `arena:readings`
 * uses, the compiler, and a grep of src/lib/arena. NO database.
 *
 *   npm run rules:skill-pack
 *
 * Writes skills/dbs-rules-review/data/{open-rules.json, open-rules.md,
 * assumptions.md, silent.md, meta.json} and src/lib/rules-review/
 * assumptions.generated.json (the MCP route's `list_assumptions` cannot grep
 * source at runtime, so it reads this committed module) and src/lib/rules-review/
 * faq.generated.json (the official card Q&A page, parsed per card id; the one network
 * call besides deckplanet — if the page cannot be fetched the committed file is kept).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fetchDeckplanet, shapeCatalog } from "../src/lib/catalog/deckplanet";
import { cardDefFrom } from "../src/lib/arena/load";
import { parseSkills } from "../src/lib/arena/text/cards";
import { compileSkill } from "../src/lib/arena/compile";
import { KNOWN_SILENT, readsAsNothingSilently } from "../src/lib/arena/compile/silent";
import { describeScript } from "../src/lib/arena/vm/script";
import { familyOf, flat, truncate } from "../src/lib/rules-review/wording";
import { parseCardFaq } from "../src/lib/rules-review/faq";

const OUT = path.resolve("skills/dbs-rules-review/data");
const ASSUMPTIONS_MODULE = path.resolve("src/lib/rules-review/assumptions.generated.json");
fs.mkdirSync(OUT, { recursive: true });

// ── open rules and silent skills ───────────────────────────────────────────
const raw = await fetchDeckplanet("dbs");
const shaped = shapeCatalog(raw, "dbs");
const setOf = new Map<string, string>();
for (const c of shaped.cards as unknown as { number?: string; id?: string; setCode?: string }[]) {
  const id = c.number ?? c.id;
  if (id && c.setCode) setOf.set(id, c.setCode);
}
const defs = shaped.cards.map((c) => cardDefFrom(c)).sort((a, b) => a.id.localeCompare(b.id));

interface OpenRule {
  key: string;
  card: string;
  side: "front" | "back";
  name: string;
  set: string;
  kind: string;
  printed: string;
  reading: string;
  unread: string[];
  family: string;
}
interface SilentRule {
  key: string;
  name: string;
  printed: string;
  known: boolean;
}
const open: OpenRule[] = [];
const silent: SilentRule[] = [];
let skillsTotal = 0;
for (const d of defs) {
  const set = setOf.get(d.id) ?? d.id.split("-")[0];
  for (const [face, name, text] of [
    ["front", d.name, d.skill],
    ["back", d.back?.name ?? d.name, d.back?.skill],
  ] as const) {
    if (!text) continue;
    for (const sk of parseSkills(text)) {
      if (!sk.effect.trim()) continue;
      skillsTotal++;
      const s = compileSkill(sk);
      const key = `${d.id}${face === "back" ? "b" : ""}#${sk.index}`;
      if (readsAsNothingSilently(sk, s)) silent.push({ key, name, printed: flat(sk.raw), known: KNOWN_SILENT.has(key) });
      if (!s.unsupported.length) continue;
      const unread = s.unsupported.map(flat);
      open.push({
        key,
        card: d.id,
        side: face,
        name,
        set,
        kind: sk.kind,
        printed: flat(sk.raw),
        reading: describeScript(s.ops, { permanent: sk.kind === "permanent" }) || "(nothing)",
        unread,
        family: familyOf(unread[0]),
      });
    }
  }
}

const families = new Map<string, OpenRule[]>();
for (const r of open) (families.get(r.family) ?? families.set(r.family, []).get(r.family)!).push(r);
const sortedFamilies = [...families.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

fs.writeFileSync(
  path.join(OUT, "open-rules.json"),
  JSON.stringify({ families: sortedFamilies.map(([family, rules]) => ({ family, count: rules.length, rules })) }, null, 1),
);

let md = `# Open rules: skills with an unread clause\n\n${open.length} skills in ${sortedFamilies.length} wording families, largest first. ` +
  `Numbers, <names>, card ids and colours are blanked in the family label. Printed text is cut at 260 characters here; the full text is in open-rules.json.\n\n` +
  `Index of families: ${sortedFamilies.slice(0, 60).map(([, r], i) => `${i + 1}=${r.length}`).join(" ")}${sortedFamilies.length > 60 ? " ..." : ""}\n`;
sortedFamilies.forEach(([family, rules], i) => {
  md += `\n## Family ${i + 1} (${rules.length} skills): ${family}\n`;
  for (const r of rules) {
    md += `- ${r.key} [${r.side}] ${r.name} (${r.set}) ${r.kind}\n  printed: ${truncate(r.printed)}\n  reads: ${truncate(r.reading, 200)}\n  unread: ${r.unread.map((u) => truncate(u, 200)).join(" | ")}\n`;
  }
});
fs.writeFileSync(path.join(OUT, "open-rules.md"), md);

let smd = `# Skills that read as nothing, silently\n\n${silent.length} skills compile to an empty program with no unread clause, so no count sees them (#1005). ` +
  `"known" = on the KNOWN_SILENT list in src/lib/arena/compile/silent.ts (found, not yet fixed).\n\n`;
for (const s of silent) smd += `- ${s.key}${s.known ? " (known)" : " (NEW)"} ${s.name}\n  printed: ${truncate(s.printed, 400)}\n`;
fs.writeFileSync(path.join(OUT, "silent.md"), smd);

// ── labelled best guesses in the source ────────────────────────────────────
interface Assumption {
  id: number;
  file: string;
  line: number;
  assumption: string;
  sources: string[];
  cards: string[];
}
const CARD_ID = /\b(?:BT|EX|DB|SD|TB|FB|FS|XD|UB|P|BS|DBS)\d{0,2}-\d{2,3}[a-z]?\b/g;
const GUESS = /best[- ]guess|labell?ed guess/i;
const SOURCE = [
  /\bowner'?s? (?:ruling|guidance|decision)[^.;)]{0,60}/gi,
  /\b\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* 2026/g,
  /\b(?:manual |rule )?\d{1,2}-\d{1,2}(?:-\d{1,2}){0,3}\b/g,
  /#\d{2,4}\b/g,
  /\bno (?:official )?(?:ruling|rule|errata|Q&A)[^.;)]{0,50}/gi,
  /\b(?:card )?Q&A[^.;)]{0,40}/g,
];
const isComment = (l: string) => /^\s*(\/\/|\*|\/\*|--|#)/.test(l);
const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(ts|mts|rules)$/.test(e.name) ? [p] : [];
  });
const assumptions: Assumption[] = [];
for (const file of walk("src/lib/arena").sort()) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const rel = file.split(path.sep).join("/");
  let last = -100;
  lines.forEach((l, i) => {
    if (!GUESS.test(l)) return;
    let ctx: string;
    if (isComment(l)) {
      if (i - last <= 3) return; // same comment block as the previous hit
      let a = i;
      let b = i;
      while (a > 0 && isComment(lines[a - 1])) a--;
      while (b < lines.length - 1 && isComment(lines[b + 1])) b++;
      last = b;
      ctx = lines.slice(a, b + 1).map((x) => x.replace(/^\s*(\/\/+|\/?\*+\/?|--)\s?/, "")).join(" ");
    } else {
      // A string (glossary entry, rules file): a window around the match.
      const m = GUESS.exec(l)!;
      ctx = l.slice(Math.max(0, m.index - 700), m.index + 500);
    }
    ctx = flat(ctx);
    const m = GUESS.exec(ctx)!;
    const sentences = ctx.split(/(?<=[.!?])\s+/);
    let at = 0;
    let hit = 0;
    sentences.forEach((s, k) => {
      if (at <= m.index && m.index < at + s.length + 1) hit = k;
      at += s.length + 1;
    });
    const assumption = truncate(sentences.slice(Math.max(0, hit - 1), hit + 2).join(" "), 420);
    const sources = new Set<string>();
    for (const re of SOURCE) for (const x of ctx.matchAll(re)) sources.add(flat(x[0]));
    const cardsHere = [...new Set(ctx.match(CARD_ID) ?? [])].slice(0, 40);
    assumptions.push({ id: assumptions.length + 1, file: rel, line: i + 1, assumption, sources: [...sources].slice(0, 8), cards: cardsHere });
  });
}
fs.writeFileSync(ASSUMPTIONS_MODULE, JSON.stringify(assumptions, null, 1) + "\n");
let amd = `# Labelled best guesses in the arena code\n\n${assumptions.length} places where the code or glossary says "best guess". ` +
  `Each is an assumption the owner has not (yet) had ruled by a rule source. Card ids are those named in the surrounding comment; the list is not exhaustive.\n`;
for (const a of assumptions) {
  amd += `\n## A${a.id}  ${a.file}:${a.line}\n- assumption: ${a.assumption}\n- cards: ${a.cards.join(", ") || "(none named)"}\n- source cited: ${a.sources.join("; ") || "(none)"}\n`;
}
fs.writeFileSync(path.join(OUT, "assumptions.md"), amd);

// ── official card FAQ ─────────────────────────────────────────────────────
const FAQ_MODULE = path.resolve("src/lib/rules-review/faq.generated.json");
const FAQ_URL = "https://www.dbs-cardgame.com/us-en/rule/card_faq.php";
let faqCards = 0;
try {
  const res = await fetch(FAQ_URL, { headers: { "user-agent": "Mozilla/5.0 (dbs-card-companion rules pack)" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const faq = parseCardFaq(await res.text());
  faqCards = Object.keys(faq).length;
  if (faqCards < 500) throw new Error(`only ${faqCards} cards parsed; the page layout probably changed`);
  fs.writeFileSync(FAQ_MODULE, JSON.stringify(Object.fromEntries(Object.entries(faq).sort(([a], [b]) => a.localeCompare(b)))) + "\n");
} catch (e) {
  console.warn(`FAQ not refreshed (${(e as Error).message}); keeping ${FAQ_MODULE}`);
}

// ── meta ───────────────────────────────────────────────────────────────────
let sha = "unknown";
try {
  sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
} catch {}
const meta = {
  generatedAt: new Date().toISOString(),
  gitSha: sha,
  counts: { skills: skillsTotal, openSkills: open.length, families: sortedFamilies.length, assumptions: assumptions.length, silent: silent.length, silentKnown: silent.filter((s) => s.known).length, faqCards },
  largestFamilies: sortedFamilies.slice(0, 10).map(([family, r]) => ({ family, count: r.length })),
};
fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
console.log(JSON.stringify(meta.counts));
