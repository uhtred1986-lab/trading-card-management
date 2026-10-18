/**
 * The official card Q&A (https://www.dbs-cardgame.com/us-en/rule/card_faq.php) as data for the rules-review
 * connector. `parseCardFaq` runs at pack time (`npm run rules:skill-pack`) and its result is committed as
 * `faq.generated.json`; the connector reads that module (it cannot fetch the site per request). Pure: no network.
 */
export interface FaqQa {
  q: string;
  a: string;
}
export interface FaqEntry {
  /** The heading's card name as printed on the FAQ page (a card id can appear under several names). */
  name: string;
  qa: FaqQa[];
}
export type FaqByCard = Record<string, FaqEntry[]>;

/** Pad the number part to 3 digits so `SD2-01` and `SD2-001` meet. */
export function faqKey(cardId: string): string {
  const m = /^([A-Za-z0-9]+)-(\d{1,3})([A-Za-z]?)/.exec(cardId.trim().replace(/_.*$/, ""));
  return m ? `${m[1]}-${m[2].padStart(3, "0")}${m[3]}`.toUpperCase() : cardId.trim().toUpperCase();
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", hellip: "…" };

function text(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .split("\n")
    .map((l) => l.replace(/[ \t　]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export function parseCardFaq(html: string): FaqByCard {
  const out: FaqByCard = {};
  const parts = html.split(/<h5 class="points[^"]*"[^>]*>/i);
  for (const part of parts.slice(1)) {
    const end = part.indexOf("</h5>");
    if (end < 0) continue;
    const heading = text(part.slice(0, end));
    const m = /^([A-Za-z0-9]+-\d{1,3}[A-Za-z]?)\s*(.*)$/.exec(heading);
    if (!m) continue;
    const qa: FaqQa[] = [];
    const re = /<dt>[\s\S]*?<span class="textCol">([\s\S]*?)<\/span>\s*<\/dt>\s*<dd>[\s\S]*?<span class="textCol">([\s\S]*?)<\/span>\s*<\/dd>/gi;
    for (const x of part.slice(end).matchAll(re)) qa.push({ q: text(x[1]), a: text(x[2]) });
    if (!qa.length) continue;
    const key = faqKey(m[1]);
    (out[key] ??= []).push({ name: m[2].trim(), qa });
  }
  return out;
}
