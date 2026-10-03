/**
 * Which words of a quoted card filter `parseFilter` did not read.
 *
 * `parseFilter` is a set of patterns run over the description, and wording no
 * pattern knows is simply passed over — right for the compiler, which reads
 * printed card text, and wrong for the text view, which promises to refuse
 * what it cannot parse rather than guess (docs/arena-fixing-a-card.md). A rule
 * that says `"card with 5000 combo cost"` comes back as every card: there is
 * no combo-cost measure, and nothing would say so.
 *
 * The check is an accounting of words. The filter is printed back with
 * `describeFilter` — the printed form `lang/print.ts` writes and the form the
 * round-trip promise rests on (`FILTER_FIELDS` in `ast.ts`) — and every word
 * of the source must either appear in that reading or be grammar that carries
 * no measure ("a", "with", "of"). A word that is neither is one no pattern
 * turned into a field, which is exactly a measure dropped in silence. A filter
 * `printFilter` wrote in words passes by construction: its words *are* the
 * reading.
 */
import { describeFilter } from "../vm/script";
import type { CardFilter } from "../text/filters";

/** Words that never carry a measure on their own; the reading may leave them out. */
const GRAMMAR = new Set(["a", "an", "the", "of", "with", "and", "or", "card", "that", "which", "is", "are", "it", "its", "their", "has", "have", "any", "skill"]);

/**
 * The comparisons `parseFilter` reads a relative power bound from, several
 * ways to say each of `POWER_REL_WORDS`; only one of them is printed back.
 */
const COMPARISON = new Set(["less", "lower", "greater", "higher", "more", "no", "than", "equal", "to", "at", "or", "below", "above"]);

/**
 * The description cut into words: a bracketed name (`<Son Goku>`, `≪Saiyan≫`,
 * `{Majin}`, `[Blocker]`) is one word, hyphens and punctuation split the rest,
 * and spelling and plural differences that `parseFilter` does not care about
 * are evened out — on both sides, so the two only have to agree with each other.
 */
function words(text: string): string[] {
  const out: string[] = [];
  const t = text.replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  for (const m of t.matchAll(/<[^>]*>|≪[^≫]*≫|\{[^}]*\}|\[[^\]]*\]|[^\s<≪{[]+/g)) {
    const w = m[0];
    if (/^[<≪{[]/.test(w)) {
      out.push(w.toLowerCase().replace(/\s+/g, " "));
      continue;
    }
    for (let part of w.toLowerCase().replace(/(\d),(?=\d{3})/g, "$1").split(/[-–—]+/)) {
      part = part.replace(/^[^a-z0-9]+|[^a-z0-9']+$/g, "").replace(/'s$/, "");
      if (!part) continue;
      const colour = /^(multi|mono)?colou?r(?:ed|s)?$/.exec(part);
      if (colour) {
        if (colour[1]) out.push(colour[1]);
        out.push("colour");
        continue;
      }
      out.push(part.length > 3 && part.endsWith("s") && !part.endsWith("ss") ? part.slice(0, -1) : part);
    }
  }
  return out;
}

/** The words of `text` that `filter` (what `parseFilter` read from it) does not account for, in order, each once. */
export function unreadFilterWords(text: string, filter: CardFilter): string[] {
  const read = new Set([...words(describeFilter(filter)), ...words(describeFilter(filter, { plural: false })), ...words(describeFilter(filter, { plural: true }))]);
  // "Earthling Tokens": the name is read from the bare words before "token",
  // and printed back in braces.
  if (filter.token) for (const n of filter.names) for (const w of words(n)) read.add(w);
  const unread: string[] = [];
  const said = words(text);
  for (let i = 0; i < said.length; i++) {
    const w = said[i];
    // "Other than <Grand Supreme Kai>" is read (as the names it excludes, and
    // printed back as "non-"); a bare "other" — "other Field Extra" — is not,
    // and dropping it leaves the card itself among the choices.
    if (w === "other" && said[i + 1] === "than") {
      i++;
      continue;
    }
    if (read.has(w) || GRAMMAR.has(w) || (filter.powerRel && COMPARISON.has(w))) continue;
    if (!unread.includes(w)) unread.push(w);
  }
  return unread;
}
