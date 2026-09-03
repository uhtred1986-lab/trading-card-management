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
/** "card"/"cards" are kept: they separate a count from its finish ("1 card foiled"). */
const NOISE = /\b(?:dash|hyphen|minus|number|nummer|bindestrich|please|bitte)\b/g;
const QUANTITY = /\b(?:times|x|copies|copy|quantity|count|mal|stück|stuck)\s*(\d{1,2})\b/;

/**
 * "3 cards non-foil", "1 card foiled", "two foils". Non-foil is matched and
 * removed first, so the "foil" inside "non-foil" can't be read as a foil count.
 */
// The \b matters: without it "020 foil" reads the "20" inside the card number
// as a count. A count is always its own token.
const NON_FOIL = /\b(\d{1,2})\s*(?:cards?\s*|karten?\s*)?(?:non[\s-]*foil\w*|nonfoil\w*|nicht[\s-]*foliert\w*|regular\w*|normal\w*|plain\w*)/g;
const FOIL = /\b(\d{1,2})\s*(?:cards?\s*|karten?\s*)?(?:foiled|foils|foil|foliert\w*|holos?|shiny|shinies)/g;
const BARE_NON_FOIL = /\b(?:non[\s-]*foil\w*|nonfoil\w*|nicht[\s-]*foliert\w*)\b/;
const BARE_FOIL = /\b(?:foiled|foils|foil|foliert|holo|shiny)\b/;

/** Sums every `(count) <word>` match and returns the text with them removed. */
function takeCounts(text: string, re: RegExp): { total: number; rest: string } {
  let total = 0;
  const rest = text.replace(new RegExp(re.source, "g"), (_m, n: string) => {
    total += Number(n);
    return " ";
  });
  return { total, rest: rest.replace(/\s+/g, " ").trim() };
}

/** Lower-cases, drops filler, and turns spoken numbers into digits. */
export function normaliseSpeech(text: string): string {
  const cleaned = text.toLowerCase().replace(/[.,!?;:]/g, " ").replace(NOISE, " ");
  const words = cleaned.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (TENS[w] !== undefined) {
      const next = words[i + 1];
      /*
       * "twenty two" is one number; "twenty" alone is another. The exception is
       * a following *singular* "card": in "…zero twenty one card foiled" the
       * "one" starts the count, because 21 of something would be "21 cards".
       */
      const singularCard = words[i + 2] === "card" || words[i + 2] === "karte";
      if (next && !singularCard && ONES[next] !== undefined && ONES[next] > 0 && ONES[next] < 10) {
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
  /** Copies to store as foil / as non-foil. At least one is non-zero. */
  foil: number;
  normal: number;
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

  // Finish counts first: their digits are not part of the card number.
  const nonFoil = takeCounts(work, NON_FOIL);
  work = nonFoil.rest;
  const foiled = takeCounts(work, FOIL);
  work = foiled.rest;
  let foil = foiled.total;
  let normal = nonFoil.total;
  // "BT18-020 foil" with no count means one.
  if (foil === 0 && normal === 0) {
    if (BARE_NON_FOIL.test(work)) {
      normal = 1;
      work = work.replace(BARE_NON_FOIL, " ").replace(/\s+/g, " ").trim();
    } else if (BARE_FOIL.test(work)) {
      foil = 1;
      work = work.replace(BARE_FOIL, " ").replace(/\s+/g, " ").trim();
    }
  }
  const finishGiven = foil + normal > 0;
  work = work.replace(/\b(?:cards?|karten?)\b/g, " ").replace(/\s+/g, " ").trim();

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
    const push = (id: string, f: number, n: number) => {
      const key = `${id}:${f}:${n}`;
      if (seen.has(key)) return;
      seen.add(key);
      options.push({ cardId: id, foil: f, normal: n });
    };
    if (finishGiven) {
      // The counts are settled; only the card number is still in question.
      for (const id of cardIds(prefix, groups)) push(id, foil, normal);
    } else if (explicitQuantity !== null) {
      for (const id of cardIds(prefix, groups)) push(id, 0, explicitQuantity);
    } else {
      // Prefer reading every number as part of the card…
      for (const id of cardIds(prefix, groups)) push(id, 0, 1);
      // …then as a card followed by a count.
      const tail = Number(groups[groups.length - 1]);
      if (groups.length >= 2 && tail >= 1 && tail <= 99) {
        for (const id of cardIds(prefix, groups.slice(0, -1))) push(id, 0, tail);
      }
    }
  }
  return { heard, query: work, options };
}

/** Counts when nothing matched by number and the words are searched as a name. */
export function spokenQuantity(text: string): { foil: number; normal: number } {
  const parsed = parseSpoken(text);
  const first = parsed.options[0];
  if (first) return { foil: first.foil, normal: first.normal };
  const norm = normaliseSpeech(text);
  const nonFoil = takeCounts(norm, NON_FOIL);
  const foiled = takeCounts(nonFoil.rest, FOIL);
  if (foiled.total + nonFoil.total > 0) return { foil: foiled.total, normal: nonFoil.total };
  const qm = QUANTITY.exec(norm);
  return { foil: 0, normal: qm ? Math.max(1, Number(qm[1])) : 1 };
}
