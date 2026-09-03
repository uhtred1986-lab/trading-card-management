/**
 * Turning a spoken phrase — "BT eighteen zero twenty times four" — into card
 * number candidates and a quantity. Pure; covered by scripts/verify-rules.ts.
 *
 * Speech is ambiguous in exactly the place it hurts: "eighteen oh twenty" could
 * be BT18-020, or BT18-02 twenty times. So this never decides — it returns
 * *ordered interpretations* and the caller keeps the first whose card number
 * actually exists in the catalog. The database is the tie-breaker.
 */

const ONES: Record<string, number> = {
  zero: 0, oh: 0, o: 0, nought: 0,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
/** Words that carry no meaning here — "card number BT18 dash 020". */
const NOISE = /\b(?:dash|hyphen|minus|number|card|nummer|bindestrich|karte|please|bitte)\b/g;
const QUANTITY = /\b(?:times|x|copies|copy|quantity|count|mal|stück|stuck)\s*(\d{1,2})\b/;

/** Lower-cases, drops filler, and turns spoken numbers into digits. */
export function normaliseSpeech(text: string): string {
  const cleaned = text.toLowerCase().replace(/[.,!?;:]/g, " ").replace(NOISE, " ");
  const words = cleaned.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (TENS[w] !== undefined) {
      const next = words[i + 1];
      // "twenty two" is one number; "twenty" alone is another.
      if (next && ONES[next] !== undefined && ONES[next] > 0 && ONES[next] < 10) {
        out.push(String(TENS[w] + ONES[next]));
        i++;
        continue;
      }
      out.push(String(TENS[w]));
      continue;
    }
    if (ONES[w] !== undefined) {
      out.push(String(ONES[w]));
      continue;
    }
    out.push(w);
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

export interface SpokenInterpretation {
  cardId: string;
  quantity: number;
}

export interface SpokenParse {
  heard: string;
  /** Normalised, quantity phrase removed — used for the name-search fallback. */
  query: string;
  /** Best guess first; the caller keeps the first that exists. */
  options: SpokenInterpretation[];
}

/** Set codes that carry no set number of their own: "P-181". */
const SINGLE_GROUP = new Set(["p", "pr"]);

function cardIds(prefix: string, groups: string[]): string[] {
  const ids = new Set<string>();
  const add = (setDigits: string, cardDigits: string) => {
    if (!cardDigits) return;
    const bases = new Set<string>();
    if (setDigits) {
      bases.add(`${prefix}${setDigits}`);
      bases.add(`${prefix}${Number(setDigits)}`); // "08" → BT8
      bases.add(`${prefix}${setDigits.padStart(2, "0")}`); // EX1 → EX01
    } else {
      bases.add(prefix);
    }
    for (const base of bases) {
      for (const card of new Set([cardDigits, cardDigits.padStart(2, "0"), cardDigits.padStart(3, "0")])) {
        ids.add(`${base}-${card}`);
      }
    }
  };

  const joined = groups.join("");
  if (SINGLE_GROUP.has(prefix.toLowerCase())) {
    add("", joined);
    if (groups.length >= 1) add("", groups[0]);
  } else {
    // "bt 18 020" — first group is the set, the rest the card.
    if (groups.length >= 2) add(groups[0], groups.slice(1).join(""));
    // Dictated digit by digit: split the whole run after the prefix.
    for (const n of [1, 2]) if (joined.length > n) add(joined.slice(0, n), joined.slice(n));
    // A prefix that needs no set number after all.
    add("", joined);
  }
  return [...ids];
}

export function parseSpoken(text: string): SpokenParse {
  const heard = text.trim();
  const normalised = normaliseSpeech(text);
  let work = normalised;
  let explicitQuantity: number | null = null;
  const qm = QUANTITY.exec(work);
  if (qm) {
    explicitQuantity = Math.max(1, Number(qm[1]));
    work = `${work.slice(0, qm.index)} ${work.slice(qm.index + qm[0].length)}`.replace(/\s+/g, " ").trim();
  }

  const raw = work.match(/[a-z]+\d+|[a-z]+|\d+/g) ?? [];
  // "b t 18" → "bt 18": spelled-out prefixes arrive as separate letters.
  const tokens: string[] = [];
  for (let i = 0; i < raw.length; ) {
    if (/^[a-z]$/.test(raw[i])) {
      let run = "";
      while (i < raw.length && /^[a-z]$/.test(raw[i])) run += raw[i++];
      tokens.push(run);
    } else tokens.push(raw[i++]);
  }

  const at = tokens.findIndex((t) => /^[a-z]/.test(t));
  const options: SpokenInterpretation[] = [];
  if (at >= 0) {
    let prefix = tokens[at];
    const groups: string[] = [];
    const merged = /^([a-z]+)(\d+)$/.exec(prefix);
    if (merged) {
      prefix = merged[1];
      groups.push(merged[2]);
    }
    for (const t of tokens.slice(at + 1)) if (/^\d+$/.test(t)) groups.push(t);
    prefix = prefix.toUpperCase();

    const seen = new Set<string>();
    const push = (id: string, quantity: number) => {
      const key = `${id}:${quantity}`;
      if (seen.has(key)) return;
      seen.add(key);
      options.push({ cardId: id, quantity });
    };
    if (explicitQuantity !== null) {
      for (const id of cardIds(prefix, groups)) push(id, explicitQuantity);
    } else {
      // Prefer reading every number as part of the card…
      for (const id of cardIds(prefix, groups)) push(id, 1);
      // …then as a card followed by a count.
      const tail = Number(groups[groups.length - 1]);
      if (groups.length >= 2 && tail >= 1 && tail <= 99) {
        for (const id of cardIds(prefix, groups.slice(0, -1))) push(id, tail);
      }
    }
  }
  return { heard, query: work, options };
}

/** Quantity when nothing matched by number and the words are searched as a name. */
export function spokenQuantity(text: string): number {
  const qm = QUANTITY.exec(normaliseSpeech(text));
  return qm ? Math.max(1, Number(qm[1])) : 1;
}
