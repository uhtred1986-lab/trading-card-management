/**
 * #970: the words of a multi-slot send/place clause, without reading any slot.
 * `splitClauses` needs to know where such a clause lies so it does not cut the
 * list at its own commas and "and"s; `compile/disjoint.ts` reads the slots. Kept
 * apart because reading a slot needs `targets.ts`, which needs `clauses.ts`.
 */

const OWNER = "(?:your|the|its owner'?s?|their owners?'?s?|their)";
const WARP = `${OWNER} warps?`;
const DROP = `${OWNER} drops?(?: area)?`;
const SRC = "((?:your|the|their|its owner'?s?) [^,;:.]+?)";

/** "send LIST from SRC to WARP", "place LIST from SRC in DROP", "place LIST in DROP from SRC". */
const SHAPES = [
  new RegExp(`^(send) (.+?) from ${SRC} to ${WARP}$`, "i"),
  new RegExp(`^(place) (.+?) from ${SRC} (?:in|into) ${DROP}$`, "i"),
  new RegExp(`^(place) (.+?) (?:in|into) ${DROP} from ${SRC}$`, "i"),
];

/** Words that make a slot something other than "N of this description": a choice bound, a back-reference, a per-area count. */
const NOT_A_PLAIN_SLOT = /\b(?:up to|any number|other than|different|each|total|chosen|that card|those|them|this card|both|all)\b|[―—–]|--/i;

/** The list cut at its commas and "and"s, outside the bracketed names. */
function items(list: string): string[] {
  const out: string[] = [];
  const closers: Record<string, string> = { "<": ">", "≪": "≫", "{": "}", "(": ")", "[": "]" };
  let close = "";
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (close) {
      if (ch === close) close = "";
      continue;
    }
    if (closers[ch]) {
      close = closers[ch];
      continue;
    }
    const m = /^(,\s+and\s+|,\s+|\s+and\s+)/i.exec(list.slice(i));
    if (m) {
      out.push(list.slice(start, i).trim());
      start = i + m[1].length;
      i = start - 1;
    }
  }
  out.push(list.slice(start).trim());
  return out;
}

export interface DisjointWords {
  verb: "send" | "place";
  source: string;
  /** Each slot as "N <description> card", the noun restored where the list said it once. */
  slots: string[];
}

/** The words of a clause of this shape, or `null`. */
export function disjointWords(clause: string): DisjointWords | null {
  const said = clause.trim().replace(/[.]$/, "");
  for (const shape of SHAPES) {
    const m = shape.exec(said);
    if (!m) continue;
    const verb = m[1].toLowerCase() as "send" | "place";
    const source = m[3].trim();
    const raw = items(m[2]);
    if (raw.length < 2 || raw.some((x) => !/^[1-9]\d?\s+\S/.test(x) || NOT_A_PLAIN_SLOT.test(x))) return null;
    // "1 blue <Son Goku> card and 1 blue <Vegeta> card with energy costs of 1": a
    // qualifier only the last slot says may hold for all of them — refused, not guessed.
    const qualified = raw.map((x) => /\b(?:with|whose|having|that)\b/i.test(x.replace(/<[^>]*>|≪[^≫]*≫|\{[^}]*\}/g, "")));
    if (qualified.some(Boolean) && !qualified.every(Boolean)) return null;
    const slots: string[] = [];
    for (const [i, item] of raw.entries()) {
      // "1 <Android 14> and 1 <Android 15> card": the noun is said once, at the end.
      if (/\bcards?\b/i.test(item)) slots.push(item);
      else if (i < raw.length - 1 && /^\d+\s+(?:[a-z-]+\s+)*(?:<[^>]+>|≪[^≫]+≫|\{[^}]+\})$/i.test(item)) slots.push(`${item} card`);
      else return null;
    }
    return { verb, source, slots };
  }
  return null;
}

/** Where in a skill's text a clause of this shape lies, for `splitClauses` to leave whole. */
export function disjointMoveSpans(text: string): [number, number][] {
  const out: [number, number][] = [];
  const start = /\b(?:send|place) (?=[1-9]\d?\s)/gi;
  for (let m = start.exec(text); m; m = start.exec(text)) {
    for (let end = m.index + 1; end <= text.length; end++) {
      const stops = end === text.length || ",:;.".includes(text[end]) || text.startsWith(" then ", end) || text.startsWith(" and ", end);
      if (!stops || !disjointWords(text.slice(m.index, end))) continue;
      out.push([m.index, end]);
      start.lastIndex = end;
      break;
    }
  }
  return out;
}
