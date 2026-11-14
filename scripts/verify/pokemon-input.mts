/**
 * Lane E of docs/pokemon/plan.md: adding Pokémon cards by reading aloud or by photo. No network, no
 * database, no model call: the spoken parser and the scan matcher are pure, the per-game prompt
 * is text, and the scan route's handling runs with the model, the search and the ledger stubbed.
 *
 * Covers: `parseSpokenPokemon` (German and English, number words up to 999, name + number, the
 * recogniser's spellings of ex / V / VMAX / VSTAR / GX), `matchPokemon` (exact / likely / unsure,
 * wrong set size, a German name on an English record), the 3x3 grid placement, the per-game scan
 * prompt (Dragon Ball unchanged, byte for byte, against the base commit), the speech-language
 * default, and `handlePokemonScan`.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { DBS_SCAN_SYSTEM, POKEMON_SCAN_SYSTEM, PokemonScanSchema, dbsScanInstruction, pokemonScanInstruction, scanPromptFor, type PokemonScanResult } from "../../src/lib/ai/scan-prompts.ts";
import { foldName, splitNameSuffix } from "../../src/lib/pokemon/names.ts";
import { gridCells, matchPokemon, parsePrintedNumber, pokemonScanQueries, variantFromFinish, type PokemonDetection } from "../../src/lib/pokemon/scan-match.ts";
import { handlePokemonScan, identifyPokemonCards } from "../../src/lib/pokemon/scan.ts";
import { recordFromTcgdex, type TcgdexCard } from "../../src/lib/pokemon/tcgdex.ts";
import type { PokemonHit } from "../../src/lib/pokemon/types.ts";
import { parseSpokenPokemon, spokenCodeLetters } from "../../src/lib/pokemon/voice.ts";
import { localIdCandidates, numberCandidates, parseCardIdQuery, readingOrder } from "../../src/lib/pokemon/card-id.ts";
import { SPEECH_LANG_KEY, defaultSpeechLang, readSpeechLang, rememberSpeechLang, speechLangCode } from "../../src/lib/scan/speech-lang.ts";
import { parseSpoken } from "../../src/lib/scan/voice.ts";
import type { Db } from "../../src/db/index.ts";

const FIX = path.resolve("scripts/verify/fixtures/pokemon");
const card = (id: string, lang: "de" | "en") => JSON.parse(fs.readFileSync(path.join(FIX, `card-${id}.${lang}.json`), "utf8")) as TcgdexCard;
const hitOf = (id: string): PokemonHit => recordFromTcgdex(card(id, "de"), card(id, "en")).hit;

// ── Spoken parser ────────────────────────────────────────────────────────────

{
  const p = (text: string, lang: "de" | "en" = "de") => parseSpokenPokemon(text, lang);
  const queries = (text: string, lang: "de" | "en" = "de") => p(text, lang).options.map((o) => o.query);

  // A name, with the suffix in every spelling a recogniser produces.
  assert.deepEqual(queries("Glurak ex").slice(0, 3), ["Glurak-ex", "Glurak ex", "Glurak"], "German writes the suffix with a hyphen, the bare name is the net");
  assert.deepEqual(queries("Charizard ex", "en").slice(0, 3), ["Charizard ex", "Charizard-ex", "Charizard"], "English writes it with a space");
  for (const said of ["Glurak EX", "glurak Ex", "Glurak e x", "Glurak ecks", "Glurak eks", "glurak-ex", "Glurak E.X."]) {
    assert.equal(p(said).name, "Glurak-ex", `"${said}" is Glurak-ex`);
  }
  assert.equal(p("Pikachu V").name, "Pikachu-V");
  assert.equal(p("Pikachu fau").name, "Pikachu-V", "the German letter name of V");
  assert.equal(p("Pikachu vau").name, "Pikachu-V");
  assert.equal(p("Pikachu VMAX").name, "Pikachu-VMAX");
  assert.equal(p("Pikachu v max").name, "Pikachu-VMAX");
  assert.equal(p("Pikachu fau max").name, "Pikachu-VMAX");
  assert.equal(p("Pikachu V star").name, "Pikachu-VSTAR");
  assert.equal(p("Pikachu vstar").name, "Pikachu-VSTAR");
  assert.equal(p("Glurak GX").name, "Glurak-GX");
  assert.equal(p("Glurak g x").name, "Glurak-GX");
  assert.equal(p("Glurak gee ex").name, "Glurak-GX");
  assert.equal(p("Pikachu").name, "Pikachu");
  assert.deepEqual(queries("pikachu"), ["Pikachu"], "no suffix, one query");
  assert.equal(p("mr mime").name, "Mr Mime", "words are capitalised");
  assert.equal(p("Glurak ex").heard, "Glurak ex");
  assert.equal(p("  Glurak ex  ").heard, "Glurak ex", "heard is trimmed");

  // A number with the set size, German.
  for (const said of ["sechs von hundertfünfundsechzig", "sechs von einhundertfünfundsechzig", "sechs Schrägstrich einhundertfünfundsechzig", "6 von 165", "006/165", "006 / 165", "sechs von hundert fünf und sechzig", "Nummer sechs von hundertfünfundsechzig", "null null sechs von hundertfünfundsechzig", "6 Schrägstrich 165", "sechs durch hundertfünfundsechzig"]) {
    const r = p(said);
    assert.deepEqual([r.number, r.size, r.name], [6, 165, null], `"${said}" is 6/165`);
    assert.deepEqual(r.options[0], { query: "6/165", name: null, number: 6, size: 165 }, `"${said}" asks "6/165"`);
  }
  // English.
  for (const said of ["six of one sixty five", "six of one hundred sixty five", "six of one hundred and sixty five", "6 of 165", "six out of one sixty five", "six slash one sixty five", "oh oh six of one six five", "number six of 165"]) {
    const r = p(said, "en");
    assert.deepEqual([r.number, r.size], [6, said.includes("six five") ? 165 : 165], `"${said}" is 6/165`);
  }
  // German number words up to 999.
  const num = (said: string) => p(`${said} von ${said}`).number;
  for (const [said, n] of [["eins", 1], ["zwölf", 12], ["einundzwanzig", 21], ["neunundneunzig", 99], ["hundert", 100], ["einhundert", 100], ["hundertfünf", 105], ["hundert fünf", 105], ["hundertzwölf", 112], ["zweihundertdreißig", 230], ["zweihundertdreissig", 230], ["dreihundertneunundneunzig", 399], ["neunhundertneunundneunzig", 999], ["fünfhundert", 500], ["siebenhundertachtzig", 780], ["hundert und fünf", 105]] as const) {
    assert.equal(num(said), n, `${said} is ${n}`);
  }
  assert.equal(p("sieben von zweihundertdreißig").size, 230);
  assert.equal(parseSpokenPokemon("sechs von hundertfünfundsechzig", "en").number, 6, "either language's words are read in either mode");
  // Out of range stays out.
  assert.equal(p("0 von 165").number, null, "no card 0");
  assert.equal(p("1200 von 165").size, null, "four digits is not a collector number, so there is no pair");

  // Name and number together: the precise query first, the number alone as a net, then the name.
  const both = p("Glurak ex sechs von hundertfünfundsechzig");
  assert.deepEqual([both.name, both.number, both.size], ["Glurak-ex", 6, 165]);
  assert.deepEqual(both.options.map((o) => o.query), ["Glurak-ex 6/165", "Glurak 6/165", "6/165", "Glurak-ex", "Glurak ex", "Glurak"]);
  assert.deepEqual(queries("Glurak 6/165"), ["Glurak 6/165", "6/165", "Glurak"]);
  assert.deepEqual(queries("Pikachu 25").slice(0, 2), ["Pikachu 25", "25"], "a lone number without a size");
  assert.deepEqual(queries("Charizard ex six of one sixty five", "en").slice(0, 3), ["Charizard ex 6/165", "Charizard 6/165", "6/165"]);
  assert.equal(queries("Porygon 2").includes("Porygon 2"), true, "a digit that may belong to the name is kept as a last option");
  // Never a single decision: a name always has the bare name as a fallback when it has a suffix.
  assert.ok(p("Glurak ex").options.length >= 3);
  // Nothing usable.
  assert.deepEqual(p("").options, []);
  assert.deepEqual(p("ähm bitte").options, []);

  // A count.
  assert.equal(p("zwei mal Glurak ex").quantity, 2);
  assert.equal(p("zwei mal Glurak ex").name, "Glurak-ex", "the count is not part of the name");
  assert.equal(p("Glurak dreimal").quantity, 3);
  assert.equal(p("3x Pikachu").quantity, 3);
  assert.equal(p("Pikachu 2 Stück").quantity, 2);
  assert.equal(p("two copies of Pikachu", "en").quantity, 2);
  assert.equal(p("Glurak sechs von hundertfünfundsechzig").quantity, null, "the 6 of 6/165 is not a count");
  assert.equal(p("Pikachu").quantity, null);
  assert.deepEqual([p("zwei mal sechs von hundertfünfundsechzig").number, p("zwei mal sechs von hundertfünfundsechzig").quantity], [6, 2]);
  // A spoken word that is a JS property name is just a word.
  assert.deepEqual(p("constructor").options.map((o) => o.query), ["Constructor"]);

  // The Dragon Ball parser is not touched.
  assert.equal(parseSpoken("BT eighteen zero twenty times four").options[0].cardId, "BT18-020");
}

// ── Codes printed at the bottom: set code + number, collector ID ─────────────

{
  const known = new Set(["MEW"]);
  const q = (text: string, lang: "de" | "en" = "de", setCodes?: ReadonlySet<string>) => parseSpokenPokemon(text, lang, { setCodes }).options.map((o) => o.query);

  // Typed forms (the search field and `searchPokemon` read them the same way).
  assert.deepEqual(parseCardIdQuery("MEW 6"), { letters: "MEW", digits: "6", number: 6, spaced: true, caps: true, size: null, sizeLetters: "" });
  assert.deepEqual(parseCardIdQuery("MEW 006/165"), { letters: "MEW", digits: "006", number: 6, spaced: true, caps: true, size: 165, sizeLetters: "" });
  assert.equal(parseCardIdQuery("PAL EN 001/193")?.digits, "001", "a language between code and number");
  assert.deepEqual(parseCardIdQuery("swsh062"), { letters: "SWSH", digits: "062", number: 62, spaced: false, caps: false, size: null, sizeLetters: "" });
  assert.deepEqual(parseCardIdQuery("TG12/TG30"), { letters: "TG", digits: "12", number: 12, spaced: false, caps: true, size: 30, sizeLetters: "TG" });
  assert.equal(parseCardIdQuery("Mew 6")?.caps, false, "Mew is the name, MEW the code");
  for (const not of ["Glurak", "6", "6/165", "006", "Glurak 6/165", "Porygon2", "Pikachu 25", "Glurak ex 6", "", null, "MEW 0"]) assert.equal(parseCardIdQuery(not as string | null), null, `"${not}" is no code`);
  assert.deepEqual(readingOrder(parseCardIdQuery("MEW 6")!), ["set", "id"]);
  assert.deepEqual(readingOrder(parseCardIdQuery("Mew 6")!), ["name", "set", "id"], "the name first unless it was written as a code");
  assert.deepEqual(readingOrder(parseCardIdQuery("SWSH062")!), ["id", "set"]);
  assert.deepEqual(readingOrder(parseCardIdQuery("TG12/TG30")!), ["id"]);
  assert.deepEqual(localIdCandidates("SWSH", "62"), ["SWSH62", "SWSH062"]);
  assert.deepEqual(localIdCandidates("GG", "01"), ["GG01", "GG001", "GG1"]);
  assert.deepEqual(numberCandidates("6"), ["006", "6", "06"]);
  assert.deepEqual(numberCandidates("006"), ["006", "6", "06"]);

  // A set code and a number, spoken. The code reading comes first only when the code is known; the name stays.
  assert.deepEqual(q("MEW sechs"), ["Mew 6", "6", "Mew"], "unknown code: exactly the old readings, nothing in front");
  assert.deepEqual(q("MEW sechs", "de", known), ["MEW 6", "Mew 6", "6", "Mew"], "Mew is also a Pokémon: code first, name kept");
  assert.deepEqual(q("MEW six", "en", known), ["MEW 6", "Mew 6", "6", "Mew"]);
  assert.deepEqual(q("mew null null sechs", "de", known).slice(0, 2), ["MEW 006", "Mew 6"], "the zeros she said are kept");
  assert.deepEqual(q("Nummer MEW sechs von hundertfünfundsechzig", "de", known).slice(0, 2), ["MEW 6/165", "Mew 6/165"]);
  assert.deepEqual(q("MEW 006", "en", known).slice(0, 2), ["MEW 006", "Mew 6"]);
  assert.deepEqual(q("PAL einhundertneunundneunzig", "de", new Set(["PAL"])).slice(0, 1), ["PAL 199"]);
  assert.equal(parseSpokenPokemon("MEW sechs", "de", { setCodes: known }).name, "Mew", "the name reading is still reported");
  assert.equal(parseSpokenPokemon("MEW sechs", "de", { setCodes: known }).number, 6);
  assert.equal(spokenCodeLetters("MEW sechs"), "MEW", "the caller asks the source whether a set prints it");
  assert.equal(spokenCodeLetters("SWSH null sechs zwei"), null, "a collector-ID prefix needs no look-up");
  assert.equal(spokenCodeLetters("Glurak sechs"), null);
  assert.equal(spokenCodeLetters("Glurak ex"), null);

  // Spelled letter by letter: German and English letter names, plain letters, a mix.
  for (const said of ["M E W null null sechs", "m e w null null sechs", "em e we null null sechs", "M E W oh oh six", "em ee double u zero zero six"]) {
    assert.deepEqual(q(said).slice(0, 1), ["MEW 006"], `"${said}"`);
    assert.ok(q(said).includes("Mew 6"), `"${said}" keeps the name reading behind the code`);
    assert.ok(q(said).indexOf("MEW 006") < q(said).indexOf("Mew 6"));
  }
  assert.deepEqual(q("M E W sechs").slice(0, 1), ["MEW 6"]);
  assert.deepEqual(q("es pe ha sechs").slice(0, 1), ["SPH 6"], "German letter names");
  assert.deepEqual(q("ess pee aitch six", "en").slice(0, 1), ["SPH 6"], "English letter names");

  // A collector ID with letters, run together or spelled, with the leading zeros the printed ID has.
  for (const said of ["SWSH062", "swsh062", "S W S H null sechs zwei", "es we es ha null sechs zwei", "SWSH null sechs zwei", "swsh zero six two", "S W S H 062", "SWSH 062"]) {
    assert.equal(q(said, "de")[0], "SWSH062", `"${said}"`);
  }
  assert.equal(q("SWSH zwei und sechzig")[0], "SWSH62", "no zero said, none added");
  assert.equal(q("SWSH 62")[0], "SWSH62");
  assert.equal(q("TG12")[0], "TG12");
  assert.equal(q("T G zwölf")[0], "TG12");
  assert.equal(q("T G twelve", "en")[0], "TG12");
  assert.equal(q("tee gee twelve", "en")[0], "TG12");
  assert.equal(q("TG zwölf")[0], "TG12");
  assert.equal(q("TG zwölf von TG dreißig")[0], "TG12/TG30", "the printed total of a gallery card");
  assert.equal(q("TG12 / TG30")[0], "TG12/TG30");
  assert.equal(q("TG twelve of TG thirty", "en")[0], "TG12/TG30");
  assert.equal(q("GG01")[0], "GG01");
  assert.equal(q("G G null eins")[0], "GG01");
  assert.equal(q("gee gee zero one", "en")[0], "GG01");
  assert.equal(q("SV001")[0], "SV001");
  assert.equal(q("S V null null eins")[0], "SV001");
  assert.equal(q("RC5")[0], "RC5");
  assert.equal(q("R C fünf")[0], "RC5");
  assert.equal(q("RC five", "en")[0], "RC5");

  // What is NOT a code stays what it was: names, numbers, rule-box words and names with numbers.
  assert.deepEqual(q("Eevee 6"), ["Eevee 6", "6", "Eevee"], "a word that is no known code or prefix adds nothing");
  assert.deepEqual(q("Glurak 6"), ["Glurak 6", "6", "Glurak"]);
  assert.deepEqual(q("Glurak ex"), ["Glurak-ex", "Glurak ex", "Glurak"]);
  assert.ok(!q("Glurak gee ex").some((x) => /^[A-Z]{2,5} ?\d/.test(x)), "letters inside a name phrase are not a code");
  assert.deepEqual(q("sechs von hundertfünfundsechzig"), ["6/165"]);
  assert.deepEqual(q("nummer sechs"), ["6"]);
  assert.deepEqual(q("null null sechs"), ["6"]);
  assert.deepEqual(q("einhundertneunundneunzig"), ["199"]);
  assert.deepEqual(q("Pikachu V"), ["Pikachu-V", "Pikachu V", "Pikachu"]);
  assert.deepEqual(q("Porygon 2", "de", known), q("Porygon 2"), "a known code elsewhere changes nothing");
  assert.ok(!q("Glurak sechs", "de", known).some((x) => /^[A-Z]{2,5} \d/.test(x)), "no code reading from a name");
  assert.equal(q("Glurak SWSH null sechs zwei").includes("SWSH062"), false, "a name beside a code is not a code phrase");
}

// ── Names ────────────────────────────────────────────────────────────────────

assert.deepEqual(splitNameSuffix("Glurak-ex"), { base: "Glurak", suffix: "ex" });
assert.deepEqual(splitNameSuffix("Pikachu VMAX"), { base: "Pikachu", suffix: "VMAX" });
assert.deepEqual(splitNameSuffix("Evoli"), { base: "Evoli", suffix: null });
assert.equal(foldName("Glühend-EX"), "gluhend ex");

// ── Scan matcher ─────────────────────────────────────────────────────────────

{
  const glurakEx = hitOf("sv03.5-006");
  assert.deepEqual([glurakEx.localId, glurakEx.setTotal, glurakEx.name, glurakEx.altName], ["006", 165, "Glurak-ex", "Charizard ex"], "fixture: the German record with the English name beside it");
  const mk = (over: Partial<PokemonHit> & { tcgdexId: string }): PokemonHit => ({ ...glurakEx, id: `PKM-${over.tcgdexId}`, ...over });
  const old = mk({ tcgdexId: "ecard1-6", name: "Glurak", altName: "Charizard", localId: "6", setTotal: 165, setName: "Expedition" });
  const otherSix = mk({ tcgdexId: "xy12-6", name: "Bisasam", altName: "Bulbasaur", localId: "6", setTotal: 108, setName: "Evolutionen" });
  const glurakV = mk({ tcgdexId: "swsh45-18", name: "Glurak-V", altName: "Charizard V", localId: "018", setTotal: 72 });
  const det = (over: Partial<PokemonDetection> = {}): PokemonDetection => ({ name: "Glurak-ex", language: "DE", number: "006/165", setCode: null, confidence: 0.95, ...over });

  // Exact: number, size and name agree.
  let m = matchPokemon(det(), [old, otherSix, glurakEx]);
  assert.equal(m.confidence, "exact");
  assert.equal(m.best?.tcgdexId, "sv03.5-006");
  assert.equal(m.candidates[0].hit.tcgdexId, "sv03.5-006", "best first");
  // The same card read in English against the German-first record.
  m = matchPokemon(det({ name: "Charizard ex", language: "EN" }), [glurakEx]);
  assert.equal(m.confidence, "exact", "an English name matches the record's altName");
  // "Glurak ex" and "Glurak-ex" are one name.
  assert.equal(matchPokemon(det({ name: "Glurak ex" }), [glurakEx]).confidence, "exact");
  // A leading zero or not, spaces or not.
  assert.equal(matchPokemon(det({ number: "6 / 165" }), [glurakEx]).confidence, "exact");
  // Wrong set size: likely, never exact.
  m = matchPokemon(det({ number: "006/164" }), [glurakEx]);
  assert.equal(m.confidence, "likely");
  assert.equal(m.best?.tcgdexId, "sv03.5-006");
  assert.match(m.reason, /Setgröße/);
  // No size at all.
  m = matchPokemon(det({ number: "006" }), [glurakEx]);
  assert.equal(m.confidence, "likely");
  // The model was hesitant: a full agreement drops to likely.
  assert.equal(matchPokemon(det({ confidence: 0.4 }), [glurakEx]).confidence, "likely");
  // Name agrees but the rule-box suffix does not: not exact.
  m = matchPokemon(det({ name: "Glurak" }), [glurakEx]);
  assert.notEqual(m.confidence, "exact", "Glurak is not Glurak-ex");
  // Number fits a card with another name: a digit was misread, so not a pick.
  m = matchPokemon(det({ name: "Glurak-ex", number: "006/108" }), [otherSix]);
  assert.equal(m.confidence, "unsure");
  assert.equal(m.best, null, "an unsure read has nothing preselected");
  // Several cards with the number and the name: unsure, with the candidates to tap.
  const twin = mk({ tcgdexId: "sv99-006", setTotal: 165 });
  m = matchPokemon(det(), [glurakEx, twin]);
  assert.equal(m.confidence, "unsure");
  assert.equal(m.best, null);
  assert.equal(m.candidates.length, 2);
  // A name with no number: a lone match is likely, several are unsure.
  m = matchPokemon(det({ number: null }), [glurakEx, glurakV]);
  assert.equal(m.confidence, "likely");
  assert.equal(m.best?.tcgdexId, "sv03.5-006");
  m = matchPokemon(det({ number: null, name: "Glurak" }), [old, mk({ tcgdexId: "pl4-1", name: "Glurak", localId: "1", setTotal: 130 })]);
  assert.equal(m.confidence, "unsure", "one name, many printings");
  // The number alone, name unreadable.
  m = matchPokemon(det({ name: "" }), [glurakEx, otherSix]);
  assert.equal(m.confidence, "likely");
  // Promo codes.
  assert.deepEqual(parsePrintedNumber("SWSH062"), { localId: "SWSH62", number: null, size: null });
  const promo = mk({ tcgdexId: "swshp-SWSH062", localId: "SWSH062", setTotal: null, name: "Pikachu", altName: null });
  assert.equal(matchPokemon(det({ name: "Pikachu", number: "SWSH062" }), [promo]).confidence, "likely", "no set size to agree on");
  // Nothing.
  m = matchPokemon(det(), []);
  assert.deepEqual([m.confidence, m.best, m.candidates], ["none", null, []]);
  // Duplicates from several queries count once.
  assert.equal(matchPokemon(det(), [glurakEx, glurakEx, glurakEx]).confidence, "exact");

  // Printed numbers.
  assert.deepEqual(parsePrintedNumber("006/165"), { localId: "6", number: 6, size: 165 });
  assert.deepEqual(parsePrintedNumber("#6"), { localId: "6", number: 6, size: null });
  assert.equal(parsePrintedNumber("hello"), null);
  assert.equal(parsePrintedNumber(null), null);

  // Queries: the number with its size first, then the name.
  assert.deepEqual(pokemonScanQueries({ name: "Glurak-ex", language: "DE", number: "006/165" }), ["6/165", "Glurak 6/165", "Glurak-ex", "Glurak"]);
  assert.deepEqual(pokemonScanQueries({ name: "Charizard ex", language: "EN", number: "006/165" }), ["6/165", "Charizard 6/165", "Charizard ex", "Charizard"]);
  assert.deepEqual(pokemonScanQueries({ name: "Pikachu", language: null, number: null }), ["Pikachu"]);
  assert.deepEqual(pokemonScanQueries({ name: "", language: null, number: "25" }), ["25"]);

  // Finish to variant.
  assert.equal(variantFromFinish("reverse", ["normal", "holo", "reverse"]), "reverse");
  assert.equal(variantFromFinish("reverse", ["normal"]), "normal", "a variant the card does not have is not offered");
  assert.equal(variantFromFinish("unknown", ["holo", "normal"]), "normal");
  assert.equal(variantFromFinish(null, ["holo"]), "holo");

  // The binder grid.
  const b = (x: number, y: number) => ({ box: { x, y, w: 0.3, h: 0.3 } });
  const items = [b(0.7, 0.7), b(0.0, 0.0), b(0.35, 0.0)].map((it, i) => ({ ...it, i }));
  const g = gridCells(items);
  assert.deepEqual(g.cells.map((c) => c?.i ?? null), [1, 2, null, null, null, null, null, null, 0], "by the middle of the box, row by row");
  const noBox = gridCells([{ box: null }, { box: null }].map((x, i) => ({ ...x, i })));
  assert.deepEqual(noBox.cells.map((c) => c?.i ?? null).slice(0, 3), [0, 1, null], "reading order without boxes");
  const crowd = gridCells(Array.from({ length: 11 }, (_, i) => ({ box: null, i })));
  assert.equal(crowd.extra.length, 2, "a tenth and eleventh card do not fit");
  const collide = gridCells([b(0.1, 0.1), b(0.12, 0.1)].map((x, i) => ({ ...x, i })));
  assert.deepEqual(collide.cells.slice(0, 2).map((c) => c?.i), [0, 1], "two cards in one cell: the later takes the next free one");
}

// ── Scan matcher: the code at the bottom edge ───────────────────────────────

{
  const glurakEx = hitOf("sv03.5-006");
  const mk = (over: Partial<PokemonHit> & { tcgdexId: string }): PokemonHit => ({ ...glurakEx, id: `PKM-${over.tcgdexId}`, ...over });
  const det = (over: Partial<PokemonDetection> = {}): PokemonDetection => ({ name: "Glurak-ex", language: "DE", number: "006/165", setCode: null, confidence: 0.95, ...over });

  // Queries: a letter ID is searched as printed, a set code goes in front of its number; the old queries stay behind them.
  assert.deepEqual(pokemonScanQueries({ name: "Pikachu VMAX", language: "EN", number: "SWSH062" }), ["SWSH062", "Pikachu VMAX", "Pikachu"]);
  assert.equal(pokemonScanQueries({ name: "Pikachu VMAX", language: "EN", number: "SWSH062" })[0], "SWSH062");
  assert.equal(pokemonScanQueries({ name: "Kricketune V", language: "EN", number: "TG12/TG30" })[0], "TG12/TG30");
  assert.equal(pokemonScanQueries({ name: "", language: null, number: "swsh 062" })[0], "SWSH062");
  assert.deepEqual(pokemonScanQueries({ name: "Glurak-ex", language: "DE", number: "006/165", setCode: "MEW" }), ["MEW 6", "6/165", "Glurak 6/165", "Glurak-ex", "Glurak"]);
  assert.deepEqual(pokemonScanQueries({ name: "Glurak-ex", language: "DE", number: "006/165", setCode: "MEW EN" })[0], "MEW 6", "a language beside the code is dropped");
  assert.deepEqual(pokemonScanQueries({ name: "Glurak-ex", language: "DE", number: "006/165", setCode: null }), ["6/165", "Glurak 6/165", "Glurak-ex", "Glurak"], "no code, the old queries");

  // A letter ID with the set code and the name: exact. Without the code: likely, as before.
  const promo = mk({ tcgdexId: "swshp-SWSH062", localId: "SWSH062", setTotal: null, name: "Pikachu VMAX", altName: "Pikachu VMAX", setName: "Sword & Shield Promos" });
  const otherPromo = mk({ tcgdexId: "swshp-SWSH063", localId: "SWSH063", setTotal: null, name: "Pikachu VMAX", altName: "Pikachu VMAX", setName: "Sword & Shield Promos" });
  const base = { name: "Pikachu VMAX", language: "EN" as const, number: "SWSH062" };
  assert.equal(matchPokemon(det({ ...base }), [promo, otherPromo]).confidence, "likely", "ID and name alone");
  const withCode = matchPokemon(det({ ...base, setCode: "SWSH", setIds: ["swshp"] }), [promo, otherPromo]);
  assert.equal(withCode.confidence, "exact", "ID + set code + name");
  assert.equal(withCode.best?.tcgdexId, "swshp-SWSH062");
  assert.match(withCode.reason, /Set-Kürzel/);
  assert.equal(matchPokemon(det({ ...base, setCode: "SWSH", setIds: ["swshp"], confidence: 0.4 }), [promo]).confidence, "likely", "a hesitant read never reaches exact");
  assert.equal(matchPokemon(det({ ...base, setCode: "SWSH", setIds: ["sv03.5"] }), [promo]).confidence, "likely", "a code for another set does not vouch for this card");
  assert.equal(matchPokemon(det({ ...base, name: "Raichu", setCode: "SWSH", setIds: ["swshp"] }), [promo]).confidence, "unsure", "the name still has to agree");

  // The printed code names the set when the number alone fits several: TG12 exists in four galleries.
  const tg = (set: string, name: string) => mk({ tcgdexId: `${set}-TG12`, localId: "TG12", setTotal: 30, name, altName: name, setName: set });
  const gallery = [tg("swsh9tg", "Oranguru"), tg("swsh10tg", "Hoothoot"), tg("swsh12tg", "Kricketune V"), tg("swsh11tg", "Orbeetle V")];
  const kr = matchPokemon(det({ name: "Kricketune V", language: "EN", number: "TG12/TG30", setCode: "SIT", setIds: ["swsh12tg"], confidence: 0.9 }), gallery);
  assert.equal(kr.best?.tcgdexId, "swsh12tg-TG12");
  assert.equal(kr.confidence, "exact");
  // A plain number with its code and name, when the size was not readable.
  const sixNoSize = matchPokemon(det({ number: "006", setCode: "MEW", setIds: ["sv03.5"] }), [glurakEx]);
  assert.equal(sixNoSize.confidence, "exact");
  assert.equal(matchPokemon(det({ number: "006" }), [glurakEx]).confidence, "likely", "no size and no code: as before");
  // A size that disagrees is still a warning, whatever the code says.
  assert.equal(matchPokemon(det({ number: "006/200", setCode: "MEW", setIds: ["sv03.5"] }), [glurakEx]).confidence, "likely");
}

// ── Per-game scan prompt ─────────────────────────────────────────────────────

{
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  // Hashes of the three Dragon Ball strings as they are on the base commit 8c1be8b.
  const BASE = {
    system: "99fed74bb6a27a6ca75281b2fba021966b1cf93636b040db6fb8a06ced22f527",
    single: "a4bd787dac1c9188a9605b6f82e21c0e919e5bf0c8b644f5ad9f4ee501b78b7a",
    batch: "e7e65ffa1e27c3dc09ef82632fa1dbb8bdbdcffe66eb3b55d971130d63f760ee",
  };
  for (const game of ["dbs", "fusion"] as const) {
    const single = scanPromptFor(game, "single");
    const batch = scanPromptFor(game, "batch");
    assert.equal(sha(single.system), BASE.system, `${game}: the system prompt is the base commit's, byte for byte`);
    assert.equal(sha(batch.system), BASE.system);
    assert.equal(sha(single.instruction), BASE.single, `${game}: single instruction unchanged`);
    assert.equal(sha(batch.instruction), BASE.batch, `${game}: batch instruction unchanged`);
  }
  assert.equal(DBS_SCAN_SYSTEM, scanPromptFor("dbs", "single").system);
  assert.equal(dbsScanInstruction("single"), scanPromptFor("dbs", "single").instruction);
  // And, where git has the base commit, the real text on it.
  try {
    const src = execFileSync("git", ["show", "8c1be8b:src/lib/ai/scan.ts"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const lits = [...src.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => JSON.parse(`"${x[1]}"`) as string);
    assert.ok(lits.includes(DBS_SCAN_SYSTEM), "the base commit's system text is the one now sent");
    assert.ok(lits.includes(dbsScanInstruction("single")) && lits.includes(dbsScanInstruction("batch")));
  } catch (e) {
    if (e instanceof assert.AssertionError) throw e;
    console.log("  (git history not available: compared by hash only)");
  }

  const pk = scanPromptFor("pokemon", "single");
  assert.equal(pk.system, POKEMON_SCAN_SYSTEM);
  assert.notEqual(pk.system, DBS_SCAN_SYSTEM);
  assert.match(pk.system, /Pokemon/);
  assert.doesNotMatch(pk.system, /Dragon Ball/);
  for (const word of ["language", "collector number", "set size", "set code", "regulation mark", "holo", "reverse"]) assert.match(pk.system.toLowerCase(), new RegExp(word), `the Pokémon prompt asks for the ${word}`);
  assert.match(pokemonScanInstruction("batch"), /nine/, "a binder page is up to nine");
  assert.notEqual(scanPromptFor("pokemon", "single").instruction, scanPromptFor("pokemon", "batch").instruction);
  assert.doesNotMatch(scanPromptFor("pokemon", "batch").instruction, /Dragon Ball/);

  // The schema takes a normal read and refuses a malformed one.
  const ok = PokemonScanSchema.safeParse({ cards: [{ name: "Glurak-ex", language: "DE", number: "006/165", setCode: null, regulationMark: "G", finish: "holo", confidence: 0.9, position: "only card", box: null, notes: null }], unreadable: 0 });
  assert.equal(ok.success, true);
  assert.equal(PokemonScanSchema.safeParse({ cards: [{ name: "x", language: "FR", number: null, setCode: null, regulationMark: null, finish: "normal", confidence: 1, position: "", box: null, notes: null }], unreadable: 0 }).success, false, "a language other than DE or EN is refused");
}

// ── Speech language ──────────────────────────────────────────────────────────

{
  assert.equal(defaultSpeechLang("pokemon"), "de-AT", "the Pokémon screens are German, so they listen for German");
  assert.equal(defaultSpeechLang("dbs"), "en-US");
  assert.equal(defaultSpeechLang("fusion"), "en-US");
  assert.equal(defaultSpeechLang(), "en-US", "no game known: the old default");
  assert.equal(defaultSpeechLang(null), "en-US");
  assert.equal(speechLangCode("de-AT"), "de");
  assert.equal(speechLangCode("en-US"), "en");
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  assert.equal(readSpeechLang("pokemon", storage), "de-AT", "nothing remembered: the game's default");
  assert.equal(readSpeechLang("dbs", storage), "en-US");
  rememberSpeechLang("en-US", storage);
  assert.equal(store.get(SPEECH_LANG_KEY), "en-US");
  assert.equal(readSpeechLang("pokemon", storage), "en-US", "a person's last choice wins");
  store.set(SPEECH_LANG_KEY, "fr-FR");
  assert.equal(readSpeechLang("pokemon", storage), "de-AT", "an unknown stored value is ignored");
  const blocked = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  assert.equal(readSpeechLang("pokemon", blocked), "de-AT", "blocked storage never throws");
  assert.doesNotThrow(() => rememberSpeechLang("de-AT", blocked));
}

// ── The scan route's handling, model stubbed ─────────────────────────────────

{
  const glurakEx = hitOf("sv03.5-006");
  const read = (over: Partial<PokemonScanResult["cards"][number]> = {}): PokemonScanResult["cards"][number] => ({
    name: "Glurak-ex",
    language: "DE",
    number: "006/165",
    setCode: null,
    regulationMark: "G",
    finish: "holo",
    confidence: 0.95,
    position: "only card",
    box: { x: 0.1, y: 0.1, w: 0.4, h: 0.5 },
    notes: null,
    ...over,
  });
  const searched: string[] = [];
  const search = async (q: string) => {
    searched.push(q);
    return q === "6/165" || q.startsWith("Glurak") ? [glurakEx] : [];
  };
  const recorded: { kind: string; input: unknown }[] = [];
  const stubs = (cards: PokemonScanResult["cards"], unreadable = 0) => ({
    read: (async (_p: unknown, mode: string) => {
      recorded.push({ kind: "read", input: mode });
      return [{ model: "stub", res: { parsed: { cards, unreadable } } as never }];
    }) as never,
    search,
    record: (async (_db: unknown, kind: string, input: unknown, res: { parsed: unknown }) => {
      recorded.push({ kind, input });
      return { id: 7, output: res.parsed };
    }) as never,
    available: () => true,
  });
  const jpeg = await sharp({ create: { width: 64, height: 90, channels: 3, background: "#888" } }).jpeg().toBuffer();
  const request = (mode?: string, file: BodyInit | null = new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" })) => {
    const fd = new FormData();
    if (file) fd.append("image", file as Blob, "photo.jpg");
    if (mode) fd.append("mode", mode);
    return new Request("http://x/api/pokemon/scan", { method: "POST", body: fd });
  };
  const db = {} as Db;

  // One card.
  let res = await handlePokemonScan(request("single"), db, stubs([read()]));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  let body = (await res.json()) as { detections: { confidence: string; best: { tcgdexId: string } | null; candidates: unknown[]; seen: { finish: string } }[]; unreadable: number };
  assert.equal(body.detections.length, 1);
  assert.equal(body.detections[0].confidence, "exact");
  assert.equal(body.detections[0].best?.tcgdexId, "sv03.5-006");
  assert.equal(body.detections[0].seen.finish, "holo");
  assert.deepEqual(recorded.find((r) => r.kind === "scan_identify")?.input, { mode: "single", game: "pokemon" }, "the run is recorded in the ledger as a scan, with the game");
  assert.deepEqual(searched.slice(0, 1), ["6/165"], "the number with its size is searched first");

  // The model says nothing the matcher can use: unsure, nothing preselected.
  res = await handlePokemonScan(request("single"), db, stubs([read({ name: "???", number: null, confidence: 0.3 })]));
  body = await res.json();
  assert.equal(body.detections[0].confidence, "none");
  assert.equal(body.detections[0].best, null);

  // A binder page keeps the model's order; a single read is sorted best first.
  const page = [read({ name: "???", number: null, confidence: 0.2, position: "top-left" }), read({ position: "top-middle" })];
  res = await handlePokemonScan(request("batch"), db, stubs(page, 1));
  body = await res.json();
  assert.deepEqual(body.detections.map((d) => d.confidence), ["none", "exact"], "batch order kept");
  assert.equal(body.unreadable, 1);
  res = await handlePokemonScan(request("single"), db, stubs(page));
  body = await res.json();
  assert.deepEqual(body.detections.map((d) => d.confidence), ["exact", "none"], "single: best first");
  assert.equal(recorded.some((r) => r.kind === "read" && r.input === "batch"), true, "batch mode reaches the model call");

  // The source is down for every query of a card: said so, not a crash.
  const down = await identifyPokemonCards(db, jpeg, "single", { ...stubs([read()]), search: async () => Promise.reject(new Error("down")) });
  assert.equal(down.detections[0].confidence, "none");
  assert.match(down.detections[0].reason, /nicht erreichbar/);

  // Refusals.
  res = await handlePokemonScan(request("single"), db, { ...stubs([read()]), available: () => false });
  assert.equal(res.status, 503);
  res = await handlePokemonScan(request("single", null), db, stubs([read()]));
  assert.equal(res.status, 400);
  res = await handlePokemonScan(new Request("http://x/api/pokemon/scan", { method: "POST", body: "not a form" }), db, stubs([read()]));
  assert.equal(res.status, 400);
  const failing = { ...stubs([read()]), read: (async () => Promise.reject(new Error("boom"))) as never };
  res = await handlePokemonScan(request("single"), db, failing);
  assert.equal(res.status, 502, "a failing model call is a 502 with a message, never a stack");
}

console.log("pokemon-input: ok");
