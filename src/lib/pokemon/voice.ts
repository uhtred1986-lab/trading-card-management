/**
 * Turning a spoken phrase into Pokémon search queries. Pure; covered by
 * scripts/verify/pokemon-input.mts.
 *
 * She may say a name ("Glurak ex"), the number printed at the bottom of the card ("sechs von
 * hundertfünfundsechzig"), or both, in German or English. Like the Dragon Ball `parseSpoken`, this
 * never decides: it returns *ordered interpretations*, each a query for `searchPokemon` (whose `q`
 * takes "6/165" and "Name 6/165"), and the caller keeps the first one that finds cards. Nothing here
 * is saved; the child taps the card she means.
 *
 * She may also read the code at the bottom of the card: a printed set code and the number ("MEW
 * sechs", "M E W null null sechs", "em e we null null sechs") or a collector ID with letters
 * ("SWSH062", "S W S H null sechs zwei", "TG zwölf von TG dreißig"). Those become the query
 * "MEW 6" or "SWSH062" that `searchPokemon` resolves (card-id.ts); the name reading stays among the
 * options, after the code when the code is known, because "Mew" is also a Pokémon.
 */
import { ID_PREFIXES } from "./card-id";
import { displayName, splitNameSuffix, stripAccents, titleCase, type NameSuffix } from "./names";
import type { PokemonLang } from "./types";

export interface SpokenPokemonOption {
  /** What to hand to `searchPokemon({ q })`. */
  query: string;
  name: string | null;
  number: number | null;
  size: number | null;
}

export interface SpokenPokemonParse {
  /** The text as heard, trimmed. */
  heard: string;
  lang: PokemonLang;
  /** The card's name as the source writes it in `lang` ("Glurak-ex", "Charizard ex"), or null when only a number was said. */
  name: string | null;
  /** Collector number and set size as read ("sechs von hundertfünfundsechzig" is 6 and 165). */
  number: number | null;
  size: number | null;
  /** Copies she said ("zwei mal", "3x"), or null when she did not say. */
  quantity: number | null;
  /** Best first, no duplicates; empty when nothing usable was heard. */
  options: SpokenPokemonOption[];
}

// ── Number words ─────────────────────────────────────────────────────────────

/** A lookup table with no prototype, so a spoken "constructor" is not a hit. */
const table = (o: Record<string, number>): Record<string, number> => Object.assign(Object.create(null) as Record<string, number>, o);

/** Accents are stripped before these are looked up, so "fünf" is "funf" and "zwölf" is "zwolf". */
const DE_ONES: Record<string, number> = table({ null: 0, eins: 1, zwei: 2, zwo: 2, drei: 3, vier: 4, funf: 5, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9 });
const DE_PREFIX_ONES: Record<string, number> = table({ ein: 1, ...DE_ONES });
const DE_TEENS: Record<string, number> = table({ zehn: 10, elf: 11, zwolf: 12, zwoelf: 12, dreizehn: 13, vierzehn: 14, funfzehn: 15, fuenfzehn: 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19 });
const DE_TENS: Record<string, number> = table({ zwanzig: 20, dreissig: 30, dreisig: 30, vierzig: 40, funfzig: 50, fuenfzig: 50, sechzig: 60, siebzig: 70, achtzig: 80, neunzig: 90 });

const EN_ONES: Record<string, number> = table({ zero: 0, oh: 0, nought: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 });
const EN_TEENS: Record<string, number> = table({ ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 });
const EN_TENS: Record<string, number> = table({ twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 });

/** "hundertfunfundsechzig" gives 165. Input is accent-free lower case. Null when the word is not a German number up to 999. */
function germanNumber(s: string): number | null {
  const under100 = (w: string): number | null => {
    if (w in DE_ONES && w !== "null") return DE_ONES[w];
    if (w in DE_TEENS) return DE_TEENS[w];
    if (w in DE_TENS) return DE_TENS[w];
    const m = /^(ein|zwei|drei|vier|funf|fuenf|sechs|sieben|acht|neun)und([a-z]+)$/.exec(w);
    if (m && m[2] in DE_TENS) return DE_PREFIX_ONES[m[1]] + DE_TENS[m[2]];
    return null;
  };
  if (s === "null") return 0;
  const h = /^(?:(ein|zwei|drei|vier|funf|fuenf|sechs|sieben|acht|neun)?hundert)(?:und)?([a-z]*)$/.exec(s);
  if (h) {
    const hundreds = (h[1] ? DE_PREFIX_ONES[h[1]] : 1) * 100;
    if (!h[2]) return hundreds;
    const rest = under100(h[2]);
    return rest === null ? null : hundreds + rest;
  }
  return under100(s);
}

/** Words that can be part of a spoken number (before the run is evaluated). A bare "ein" is an article, not a number. */
function isNumberWord(w: string): boolean {
  return /^\d+$/.test(w) || w in EN_ONES || w in EN_TEENS || w in EN_TENS || w === "hundred" || w === "hundert" || w === "und" || w === "and" || (w !== "ein" && w !== "eine" && germanNumber(w) !== null);
}

const isDigitWord = (w: string) => (w in DE_ONES) || (w in EN_ONES);
const digitOf = (w: string) => (w in DE_ONES ? DE_ONES[w] : EN_ONES[w]);

/** The value of one run of spoken number words, or null when it is not one number. Digit tokens never reach here. */
function evaluateRun(words: string[]): number | null {
  if (words.length === 0) return null;
  // Digit by digit: "null null sechs", "oh oh six", "one two three".
  if (words.length > 1 && words.every(isDigitWord)) return Number(words.map((w) => digitOf(w)).join(""));
  if (words.length === 1 && isDigitWord(words[0])) return digitOf(words[0]);

  // German compounds, with the words glued: "hundert fünf und sechzig" is "hundertfunfundsechzig".
  const glued = germanNumber(words.join(""));
  if (glued !== null) return glued;

  // English: "one hundred (and) sixty five", "sixty five", and the spoken shortcut "one sixty five".
  const w = words.filter((x) => x !== "and");
  if (!w.every((x) => x in EN_ONES || x in EN_TEENS || x in EN_TENS || x === "hundred")) return null;
  const colloquial = !w.includes("hundred") && w.length >= 2 && w[0] in EN_ONES && EN_ONES[w[0]] >= 1 && (w[1] in EN_TEENS || w[1] in EN_TENS);
  let total = colloquial ? EN_ONES[w[0]] * 100 : 0;
  let cur = 0;
  for (const x of colloquial ? w.slice(1) : w) {
    if (x === "hundred") cur = (cur || 1) * 100;
    else cur += EN_ONES[x] ?? EN_TEENS[x] ?? EN_TENS[x];
  }
  total += cur;
  return total;
}

/**
 * Replaces every run of spoken number words by its digits: "sechs von hundertfünfundsechzig"
 * becomes "6 von 165". Digit tokens stay as they are. A run that is not one number is left as words.
 */
function numberWordsToDigits(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length;) {
    const t = tokens[i];
    if (/^\d+$/.test(t) || !isNumberWord(t) || t === "und" || t === "and") {
      out.push(t);
      i++;
      continue;
    }
    let j = i;
    while (j < tokens.length && !/^\d+$/.test(tokens[j]) && isNumberWord(tokens[j])) j++;
    // A trailing connector belongs to the next word, not to the number.
    let end = j;
    while (end > i && (tokens[end - 1] === "und" || tokens[end - 1] === "and")) end--;
    const run = tokens.slice(i, end);
    const value = evaluateRun(run);
    // A lone "oh" is the interjection, not a zero.
    if (value === null || (run.length === 1 && run[0] === "oh")) out.push(...run);
    else out.push(String(value));
    i = end;
  }
  return out;
}

// ── Quantity ─────────────────────────────────────────────────────────────────

const COUNT_WORDS: Record<string, number> = table({
  ein: 1, eine: 1, einen: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  zwei: 2, zwo: 2, drei: 3, vier: 4, funf: 5, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10,
});
const COUNT_UNITS = new Set(["x", "mal", "stuck", "stueck", "times", "copies", "copy", "karten", "cards"]);

/** "zwei mal", "3x", "dreimal", "two copies": removes the phrase and returns the count. Numbers after "von"/"of" are never counts. */
function takeQuantity(tokens: string[]): { quantity: number | null; rest: string[] } {
  const rest: string[] = [];
  let quantity: number | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const glued = /^(\d{1,2})x$/.exec(t) ?? /^x(\d{1,2})$/.exec(t);
    if (quantity === null && glued) {
      quantity = Number(glued[1]);
      continue;
    }
    const times = /^(ein|zwei|drei|vier|funf|fuenf|sechs|sieben|acht|neun|zehn)mal$/.exec(t);
    if (quantity === null && times) {
      quantity = COUNT_WORDS[times[1]];
      continue;
    }
    const next = tokens[i + 1];
    const count = /^\d{1,2}$/.test(t) ? Number(t) : COUNT_WORDS[t];
    if (quantity === null && count !== undefined && next && COUNT_UNITS.has(next) && next !== "karten" && next !== "cards") {
      quantity = count;
      i++;
      continue;
    }
    rest.push(t);
  }
  return { quantity: quantity !== null && quantity >= 1 ? Math.min(99, quantity) : null, rest };
}

// ── Names ────────────────────────────────────────────────────────────────────

/** Fillers that are never part of a card name. */
const NOISE = new Set(["nummer", "number", "nr", "no", "bitte", "please", "karte", "card", "die", "the", "und", "and", "ahm", "ehm", "uh", "um"]);

/** How the recogniser spells the rule-box suffixes, as the last one or two name words. */
function takeSuffix(name: string[]): { words: string[]; suffix: NameSuffix | null } {
  const n = name.length;
  const last = name[n - 1];
  const prev = name[n - 2];
  const two = prev && last ? `${prev} ${last}` : "";
  // Two-word spellings first: "v max", "fau star", "g x", "e x".
  if (n >= 2 && /^(v|vau|fau|vee) ?(max|maks|macs)$/.test(two)) return { words: name.slice(0, -2), suffix: "VMAX" };
  if (n >= 2 && /^(v|vau|fau|vee) ?(star|stern)$/.test(two)) return { words: name.slice(0, -2), suffix: "VSTAR" };
  if (n >= 2 && /^(g|ge|gee|je) ?(x|ex|ecks)$/.test(two)) return { words: name.slice(0, -2), suffix: "GX" };
  if (n >= 2 && /^e ?x$/.test(two)) return { words: name.slice(0, -2), suffix: "ex" };
  if (n >= 1 && /^(vmax|vau-?max|fau-?max)$/.test(last)) return { words: name.slice(0, -1), suffix: "VMAX" };
  if (n >= 1 && /^(vstar|v-?star)$/.test(last)) return { words: name.slice(0, -1), suffix: "VSTAR" };
  if (n >= 1 && /^(gx|g-?x)$/.test(last)) return { words: name.slice(0, -1), suffix: "GX" };
  if (n >= 2 && /^(ex|eks|ecks|e-?x)$/.test(last)) return { words: name.slice(0, -1), suffix: "ex" };
  if (n >= 2 && /^(v|vau|fau|vee)$/.test(last)) return { words: name.slice(0, -1), suffix: "V" };
  // "glurak-ex" in one word.
  const glued = /^(.+?)-(ex|v|vmax|vstar|gx)$/.exec(last ?? "");
  if (glued) {
    const { suffix } = splitNameSuffix(`x ${glued[2]}`);
    return { words: [...name.slice(0, -1), glued[1]], suffix };
  }
  return { words: name, suffix: null };
}

/** The name queries to try, most likely first: how the source writes it in `lang`, the other spelling, then the bare name. */
function nameQueries(base: string, suffix: NameSuffix | null, lang: PokemonLang): string[] {
  const hyphen = displayName(base, suffix, "hyphen");
  const space = displayName(base, suffix, "space");
  const full = lang === "de" ? [hyphen, space] : [space, hyphen];
  return suffix ? [...full, base] : [base];
}

// ── Parser ───────────────────────────────────────────────────────────────────

const SEPARATORS = new Set(["von", "of", "aus", "durch", "slash", "/", "schragstrich", "schraegstrich", "strich"]);

const numberText = (number: number, size: number | null) => (size === null ? String(number) : `${number}/${size}`);

/**
 * Hand it what the recogniser heard (any alternative) and the language she spoke in. Understands a
 * name, a collector number with the set size ("sechs von hundertfünfundsechzig", "six of one sixty
 * five", "6/165", "006/165"), or both, with a count ("zwei mal"); the rule-box suffixes ex, V, VMAX,
 * VSTAR and GX in the spellings a recogniser produces.
 */
export function parseSpokenPokemon(text: string, lang: PokemonLang, opts: SpokenPokemonOptions = {}): SpokenPokemonParse {
  const { heard, quantity, rest } = prepare(text);
  // "out of" is one separator; the "out" is noise.
  const cleaned = rest.filter((t, i) => !(t === "out" && rest[i + 1] === "of"));
  const spoken = numberWordsToDigits(cleaned);

  // "6 von 165": a number, a separator, a number. Three digits at most each.
  let number: number | null = null;
  let size: number | null = null;
  let consumed = new Set<number>();
  for (let i = 0; i + 2 < spoken.length; i++) {
    if (/^\d{1,3}$/.test(spoken[i]) && SEPARATORS.has(spoken[i + 1]) && /^\d{1,3}$/.test(spoken[i + 2])) {
      number = Number(spoken[i]);
      size = Number(spoken[i + 2]);
      consumed = new Set([i, i + 1, i + 2]);
      break;
    }
  }
  let loneDigitName: string | null = null;
  const fullNameTokens = spoken.filter((t) => !NOISE.has(t) && !SEPARATORS.has(t));
  if (number === null) {
    // A lone number ("Glurak 6", "nummer 6"): the last short digit token. It could also be part of a name ("Porygon 2").
    for (let i = spoken.length - 1; i >= 0; i--) {
      if (/^\d{1,3}$/.test(spoken[i])) {
        number = Number(spoken[i]);
        consumed = new Set([i]);
        break;
      }
    }
    if (number !== null) loneDigitName = fullNameTokens.join(" ");
  }
  if (number !== null && (number < 1 || number > 999)) {
    number = null;
    size = null;
    consumed = new Set();
  }
  if (size !== null && (size < 1 || size > 999)) size = null;

  const nameTokens = spoken.filter((t, i) => !consumed.has(i) && !NOISE.has(t) && !SEPARATORS.has(t) && !/^[/]$/.test(t));
  const { words, suffix } = takeSuffix(nameTokens);
  const baseText = words.join(" ").trim();
  const base = baseText && /\p{L}/u.test(baseText) ? titleCase(baseText) : "";
  const hasName = base.length > 0;

  const options: SpokenPokemonOption[] = [];
  const seen = new Set<string>();
  const push = (query: string, name: string | null, num: number | null, sz: number | null) => {
    const key = query.toLowerCase();
    if (!query.trim() || seen.has(key)) return;
    seen.add(key);
    options.push({ query, name, number: num, size: sz });
  };

  const names = hasName ? nameQueries(base, suffix, lang) : [];
  if (hasName && number !== null) {
    // The first spelling and the bare name each get the number; the number alone is the net below them.
    push(`${names[0]} ${numberText(number, size)}`, names[0], number, size);
    if (suffix) push(`${base} ${numberText(number, size)}`, base, number, size);
  }
  if (number !== null) push(numberText(number, size), null, number, size);
  if (hasName) for (const n of names) push(n, n, null, null);
  // "Porygon 2": the digit may belong to the name.
  if (loneDigitName && /\p{L}/u.test(loneDigitName) && number !== null && size === null) push(titleCase(loneDigitName), titleCase(loneDigitName), null, null);

  const code = readSpokenCode(cleaned);
  const around = code ? codeOptions(code, opts.setCodes) : { first: [], later: [] };
  return { heard, lang, name: hasName ? names[0] : null, number, size, quantity, options: mergeOptions([...around.first, ...options, ...around.later]) };
}

export interface SpokenPokemonOptions {
  /** Printed set codes known to exist (upper case), from `findPokemonSetsByCode`. A word that is one ("MEW") is read as the code first, the name after. */
  setCodes?: ReadonlySet<string>;
}

/** The recogniser's text as folded tokens, with the count she said taken out. */
function prepare(text: string): { heard: string; quantity: number | null; rest: string[] } {
  const heard = text.trim();
  const folded = stripAccents(heard)
    .replace(/[.,!?;:"„“”'’()]/g, " ")
    .replace(/\s*\/\s*/g, " / ")
    .replace(/#/g, " ")
    .replace(/(\d)\s*(?:-|–)\s*(?=\d)/g, "$1 / ");
  const tokens = folded.split(/\s+/).filter(Boolean);
  const { quantity, rest } = takeQuantity(tokens);
  return { heard, quantity, rest };
}

/**
 * The letters of a spoken set code that is one word ("MEW sechs" gives "MEW"), so the caller can ask
 * the source whether a set has that code and hand the answer to `parseSpokenPokemon`. Null when the
 * phrase is not a code followed by a number, or the letters are a collector-ID prefix (no look-up needed).
 */
export function spokenCodeLetters(text: string): string | null {
  const { rest } = prepare(text);
  const code = readSpokenCode(rest.filter((t, i) => !(t === "out" && rest[i + 1] === "of")));
  return code && !ID_PREFIXES.has(code.letters) && !code.sizeLetters ? code.letters : null;
}

// ── Codes printed at the bottom: set code + number, collector ID ────────────

/** How a recogniser writes the names of letters, German and English (both are accepted whatever the language, she mixes them). Accent-free, lower case. */
const LETTER_NAMES: Record<string, string> = Object.assign(Object.create(null) as Record<string, string>, {
  ay: "A", be: "B", bee: "B", ce: "C", ze: "C", tse: "C", cee: "C", see: "C", de: "D", dee: "D", ee: "E", ef: "F",
  ge: "G", gee: "G", ha: "H", aitch: "H", eye: "I", jot: "J", jay: "J", ka: "K", kay: "K", el: "L", em: "M", en: "N", pe: "P", pee: "P",
  ku: "Q", cue: "Q", queue: "Q", er: "R", ar: "R", are: "R", es: "S", ess: "S", te: "T", tee: "T", you: "U", vau: "V", fau: "V", vee: "V",
  we: "W", doubleu: "W", doubleyou: "W", iks: "X", ecks: "X", eks: "X", ex: "X", ypsilon: "Y", why: "Y", zet: "Z", zee: "Z", zed: "Z",
});

/** One spoken letter at `i`: a bare letter ("m", "e"), its name ("em", "we") or "double u". */
function letterUnit(t: string[], i: number): { letter: string; used: number } | null {
  const w = t[i];
  if (w === "double" && (t[i + 1] === "u" || t[i + 1] === "you")) return { letter: "W", used: 2 };
  if (/^[a-z]$/.test(w)) return { letter: w.toUpperCase(), used: 1 };
  return w in LETTER_NAMES ? { letter: LETTER_NAMES[w], used: 1 } : null;
}

/**
 * Letters at `i`: a run of at least two spoken letters ("em e we"), or else one word of two to five
 * letters that is no number word ("mew", "swsh", "tg"). At most five letters.
 */
function takeLetters(t: string[], i: number): { letters: string; spelled: boolean; next: number } | null {
  let letters = "";
  let units = 0;
  let j = i;
  while (j < t.length && letters.length < 5) {
    const u = letterUnit(t, j);
    if (!u) break;
    letters += u.letter;
    units++;
    j += u.used;
  }
  if (units >= 2) return { letters, spelled: true, next: j };
  if (/^[a-z]{2,5}$/.test(t[i] ?? "") && !isNumberWord(t[i])) return { letters: t[i].toUpperCase(), spelled: false, next: i + 1 };
  return null;
}

/** Number words read digit by digit keep the zeros she said: "null null sechs" is "006", "null sechs zwei" is "062". Null when it is not one number of at most four digits. */
function readDigits(tokens: string[]): string | null {
  if (tokens.length === 0) return null;
  if (tokens.every((w) => /^\d+$/.test(w))) {
    const d = tokens.join("");
    return d.length <= 4 && parseInt(d, 10) >= 1 ? d : null;
  }
  if (tokens.some((w) => /^\d+$/.test(w))) return null;
  const value = evaluateRun(tokens);
  if (value === null || value < 1) return null;
  let lead = 0;
  if (tokens.every(isDigitWord)) while (lead < tokens.length && digitOf(tokens[lead]) === 0) lead++;
  const d = "0".repeat(lead) + String(value);
  return d.length <= 4 ? d : null;
}

export interface SpokenCode {
  /** Upper case: "MEW", "SWSH", "TG". */
  letters: string;
  /** With the zeros she said: "006", "62". */
  digits: string;
  size: number | null;
  /** Letters before the size ("TG30"), which only a collector ID has. */
  sizeLetters: string;
  /** The letters were spelled one by one. */
  spelled: boolean;
}

/** Fillers that may stand beside a code; "und" and "and" belong to the number words here. */
const CODE_NOISE = new Set([...NOISE].filter((w) => w !== "und" && w !== "and"));

/**
 * The whole phrase as a code and a number, or null: "MEW sechs", "M E W null null sechs", "swsh062",
 * "S W S H null sechs zwei", "TG zwölf von TG dreißig". Anything else in the phrase (a name, "ex")
 * means it is not a code.
 */
function readSpokenCode(tokens: string[]): SpokenCode | null {
  const t = tokens.filter((w) => !CODE_NOISE.has(w));
  if (t.length === 0) return null;
  const tail = (from: number): { digits: string; next: number } | null => {
    let k = from;
    while (k < t.length && !SEPARATORS.has(t[k]) && isNumberWord(t[k])) k++;
    const digits = readDigits(t.slice(from, k));
    return digits ? { digits, next: k } : null;
  };

  let letters: string;
  let spelled = false;
  let digits: string;
  let k: number;
  const glued = /^([a-z]{1,5})(\d{1,4})$/.exec(t[0]);
  if (glued && parseInt(glued[2], 10) >= 1) {
    letters = glued[1].toUpperCase();
    digits = glued[2];
    k = 1;
  } else {
    const head = takeLetters(t, 0);
    if (!head) return null;
    letters = head.letters;
    spelled = head.spelled;
    const d = tail(head.next);
    if (!d) return null;
    digits = d.digits;
    k = d.next;
  }

  let size: number | null = null;
  let sizeLetters = "";
  if (k < t.length) {
    if (!SEPARATORS.has(t[k])) return null;
    k++;
    const g = /^([a-z]{1,5})(\d{1,4})$/.exec(t[k] ?? "");
    if (g) {
      sizeLetters = g[1].toUpperCase();
      size = parseInt(g[2], 10);
      k++;
    } else {
      const sl = takeLetters(t, k);
      if (sl) {
        sizeLetters = sl.letters;
        k = sl.next;
      }
      const d = tail(k);
      if (!d) return null;
      size = parseInt(d.digits, 10);
      k = d.next;
    }
    if (k !== t.length || size === null || size < 1) return null;
  }
  return { letters, digits, size, sizeLetters, spelled };
}

/**
 * The queries a code stands for. "MEW 6" and "MEW 6/165" are a set code and a number, "SWSH062" and
 * "TG12/TG30" a collector ID (run together, the zeros as said); `searchPokemon` resolves both.
 * First, before the name readings: spelled letters (never a name), a known collector-ID prefix, and
 * a word that is a known set code. Later: the name reading of spelled letters ("Mew 6"). A word that
 * is none of these ("Eevee 6") adds nothing: the name reading stands alone.
 */
function codeOptions(c: SpokenCode, setCodes: ReadonlySet<string> | undefined): { first: SpokenPokemonOption[]; later: SpokenPokemonOption[] } {
  const number = parseInt(c.digits, 10);
  const option = (query: string): SpokenPokemonOption => ({ query, name: null, number, size: c.size });
  const setQuery = `${c.letters} ${c.digits}${c.size !== null && !c.sizeLetters ? `/${c.size}` : ""}`;
  const idQuery = `${c.letters}${c.digits}${c.size !== null ? `/${c.sizeLetters}${c.size}` : ""}`;
  const idForm = ID_PREFIXES.has(c.letters) || c.sizeLetters !== "";
  const known = setCodes?.has(c.letters) ?? false;
  const first: SpokenPokemonOption[] = [];
  if (known && !c.sizeLetters) first.push(option(setQuery));
  if (idForm) first.push(option(idQuery));
  else if (c.spelled && !known) first.push(option(setQuery));
  const later: SpokenPokemonOption[] = [];
  if (c.spelled && c.letters.length >= 3 && !c.sizeLetters) later.push(option(`${titleCase(c.letters.toLowerCase())} ${number}`));
  return { first, later };
}

/** Drops repeats of the same query (case matters: "MEW 6" is the code, "Mew 6" the name). */
function mergeOptions(all: SpokenPokemonOption[]): SpokenPokemonOption[] {
  const seen = new Set<string>();
  return all.filter((o) => {
    if (!o.query.trim() || seen.has(o.query)) return false;
    seen.add(o.query);
    return true;
  });
}
