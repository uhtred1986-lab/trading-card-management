/**
 * `npm run rules:sources` — snapshot Bandai's official rule pages into `docs/rules/`, so every
 * session reads the same published text without the network:
 *
 *   docs/rules/game-faq.txt             the general game Q&A (game_faq.php), by section
 *   docs/rules/errata-official.json     every card errata (errata-cards.php): before, after, notes
 *   docs/rules/keyword-skills.txt       the keyword page (keyword-skills.php)
 *
 * The per-card Q&A lives in `src/lib/rules-review/faq.generated.json` and the rule manual in
 * `docs/rules/rulemanual.txt`; this adds the three pages those two do not cover. Run it when
 * Bandai updates a page (the snapshot records the date), then review `git diff docs/rules/`.
 * It only reads public pages; no database, no paid call. `--dir <path>` reads saved HTML
 * (`game_faq.html`, `errata-cards.html`, `keyword-skills.html`) instead of fetching.
 */
import fs from "node:fs";
import path from "node:path";

const BASE = "https://www.dbs-cardgame.com/us-en/rule/";
const OUT = path.resolve("docs/rules");
const args = process.argv.slice(2);
const dirArg = args.indexOf("--dir") >= 0 ? args[args.indexOf("--dir") + 1] : null;

async function page(name: string): Promise<string> {
  if (dirArg) return fs.readFileSync(path.join(dirArg, `${name}.html`), "utf8");
  const res = await fetch(`${BASE}${name}.php`);
  if (!res.ok) throw new Error(`${name}.php: HTTP ${res.status}`);
  return res.text();
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function text(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|dt|dd|li|h\d|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) =>
      e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITIES[e.toLowerCase()] ?? m))
    .replace(/[ \t　]+/g, " ")
    .split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
}
const between = (s: string, a: RegExp): string => s.match(a)?.[1] ?? "";
/** The page body: from the first match of `start` to the footer, without the site navigation. */
function body(s: string, start: RegExp): string {
  const from = s.search(start);
  if (from < 0) throw new Error(`page layout changed: no ${start}`);
  const rest = s.slice(from);
  const to = rest.search(/\n(?:▴ Page Top|Click here, too!)/);
  return to < 0 ? rest : rest.slice(0, to);
}

interface Errata { id: string; title: string; before: string; after: string; notes: string }
function errata(html: string): Errata[] {
  const out: Errata[] = [];
  for (const m of html.matchAll(/<li id="([A-Z]+[0-9]*-[0-9]{2,3}[a-z]?)"[^>]*>([\s\S]*?)<\/li>/g)) {
    const body = m[2];
    out.push({
      id: m[1],
      title: text(between(body, /<dt class="title">([\s\S]*?)<\/dt>/)),
      before: text(between(body, /<div class="beforeCol">\s*<b>Before<\/b>([\s\S]*?)<\/div>/)),
      after: text(between(body, /<div class="afterCol">\s*<b>After<\/b>([\s\S]*?)<\/div>/)),
      notes: text(between(body, /<dl class="errataNotes">\s*<dt>Errata Notes<\/dt>([\s\S]*?)<\/dl>/)),
    });
  }
  return out;
}

const today = new Date().toISOString().slice(0, 10);
const head = (name: string) => `Snapshot of ${BASE}${name}.php taken ${today} by scripts/rules-sources.mts. Do not edit; re-run the script.\n\n`;

const faq = text(await page("game_faq"));
fs.writeFileSync(path.join(OUT, "game-faq.txt"), head("game_faq") + body(faq, /[^\n]+\nQ1\./) + "\n");

const kw = text(await page("keyword-skills"));
fs.writeFileSync(path.join(OUT, "keyword-skills.txt"), head("keyword-skills") + body(kw, /\(last updated[^\n]*\)/) + "\n");

const er = errata(await page("errata-cards"));
if (er.length < 50) throw new Error(`errata-cards.php: parsed only ${er.length} entries; the page layout changed`);
fs.writeFileSync(path.join(OUT, "errata-official.json"), JSON.stringify({ source: `${BASE}errata-cards.php`, taken: today, errata: er }, null, 2) + "\n");

console.log(`rules-sources: game-faq ${faq.length} chars, keyword-skills ${kw.length} chars, errata ${er.length} entries`);
