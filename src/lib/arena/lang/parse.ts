/**
 * A rule, read back. Table-driven from `OP_SCHEMA` / `COND_SCHEMA` and the
 * selector and filter tables in `ast.ts`, so a step or a condition the schema
 * gains is readable here without a line of new parsing.
 *
 * The parser is deliberately more forgiving than the printer: it takes the
 * positional first argument (`draw(1)`) that the printer always writes out in
 * full (`draw(n: 1)`), keyword heads in any case, and the selector parts in
 * any order. That asymmetry is what makes `parse(print(x))` an *equality*
 * rather than a fixed point — one printed form per object, several ways to
 * type it.
 *
 * The first error wins. A rule is five lines long, and a list of five
 * complaints about one missing bracket tells a person less than the first one
 * does.
 */
import { emptyFilter, parseFilter, type CardFilter } from "../engine/filters";
import { AREAS, DURATIONS, KEYWORD_NAMES, SIDES, SPECIAL_TARGETS, COND_SCHEMA, OP_SCHEMA, type Amount, type Cond, type CostRecord, type FieldType, type Op, type OpField, type Ref, type Selector } from "../engine/script";
import type { Color, KeywordSkill, Trigger } from "../engine/types";
import { FILTER_FIELDS, type FilterFieldType, type LangError, type Parsed, type Rule } from "./ast";
import { LangSyntaxError, lex, positionOf, type Token } from "./tokens";

const SELECTOR_FLAGS: Record<string, (s: Selector) => void> = {
  any: () => {},
  active: (s) => (s.mode = "active"),
  rest: (s) => (s.mode = "rest"),
  fromEnd: (s) => (s.fromEnd = true),
  ignoringBarrier: (s) => (s.ignoreBarrier = true),
  otherThanSelf: (s) => (s.notSelf = "card"),
  otherThanCopies: (s) => (s.notSelf = "copies"),
};

/** Where a selector, a condition or a value stops. */
const CLOSERS = new Set([")", "]", "}", ",", ";"]);

class Parser {
  private i = 0;
  /** The clause an error is reported against, for the editor's message. */
  clause = "WHEN";

  constructor(
    private readonly src: string,
    private readonly toks: Token[],
  ) {}

  private get tok(): Token {
    return this.toks[this.i];
  }
  private ahead(n: number): Token {
    return this.toks[Math.min(this.i + n, this.toks.length - 1)];
  }
  private fail(message: string, expected: string[] = []): never {
    throw new LangSyntaxError(message, this.tok.start, expected);
  }
  private skipNl(): void {
    while (this.tok.kind === "newline") this.i++;
  }
  /** A keyword of the language, matched whatever case it was typed in. */
  private isKw(text: string, t = this.tok): boolean {
    return t.kind === "word" && t.text.toLowerCase() === text.toLowerCase();
  }
  private isPunct(text: string, t = this.tok): boolean {
    return t.kind === "punct" && t.text === text;
  }
  private eatKw(text: string): boolean {
    if (!this.isKw(text)) return false;
    this.i++;
    return true;
  }
  private eatPunct(text: string): boolean {
    if (!this.isPunct(text)) return false;
    this.i++;
    return true;
  }
  private want(text: string): void {
    if (!this.eatPunct(text)) this.fail(`expected ${JSON.stringify(text)}`, [text]);
  }
  private word(what: string): string {
    if (this.tok.kind !== "word") this.fail(`expected ${what}`, [what]);
    return this.toks[this.i++].text;
  }
  private number(what = "a number"): number {
    if (this.tok.kind !== "number") this.fail(`expected ${what}`, [what]);
    return Number(this.toks[this.i++].text);
  }
  private string(what = "a quoted text"): string {
    if (this.tok.kind !== "string") this.fail(`expected ${what}`, [what]);
    return this.toks[this.i++].text;
  }
  /** `name:` — the mark that tells a field list from a positional value. */
  private atField(): boolean {
    return this.tok.kind === "word" && this.isPunct(":", this.ahead(1));
  }
  private atNumber(): boolean {
    return this.tok.kind === "number";
  }
  private atEnd(): boolean {
    return this.tok.kind === "eof" || this.tok.kind === "newline" || CLOSERS.has(this.tok.text);
  }

  // ── the rule ──────────────────────────────────────────────────────────────

  rule(): Rule {
    this.skipNl();
    this.clause = "WHEN";
    if (!this.eatKw("WHEN")) this.fail("a rule starts with WHEN", ["WHEN"]);
    const kind = this.kindTag();
    const trigger: Trigger[] = [];
    while (this.tok.kind === "word") {
      trigger.push(this.word("a trigger") as Trigger);
      if (!this.eatPunct("|")) break;
      this.skipNl();
    }
    this.endOfLine();

    this.clause = "COST";
    const cost = this.eatKw("COST") ? this.cost() : null;
    this.clause = "IF";
    const cond = this.eatKw("IF") ? this.condAndEnd() : null;
    this.clause = "THEN";
    if (!this.eatKw("THEN")) this.fail("a rule needs a THEN, even an empty one", ["THEN"]);
    const ops = this.ops();
    this.skipNl();
    if (this.tok.kind !== "eof") this.fail("there is more here than a rule", []);
    return { kind, trigger, cost, cond, ops };
  }

  private endOfLine(): void {
    if (this.tok.kind === "newline") {
      this.skipNl();
      return;
    }
    if (this.tok.kind === "eof") return;
    this.fail("this clause runs on past the end of its line", []);
  }

  /**
   * `[activate:main]`, `[counter:attack]`, `[auto]` — the printed skill tag,
   * read straight off the source between the brackets because it carries `:`
   * and `/`, which are punctuation everywhere else in the language.
   */
  private kindTag(): string {
    this.want("[");
    const from = this.tok.start;
    let to = from;
    while (this.tok.kind !== "eof" && !this.isPunct("]")) {
      to = this.tok.end;
      this.i++;
    }
    this.want("]");
    return this.src.slice(from, to).replace(/\s+/g, "").trim();
  }

  // ── the price ─────────────────────────────────────────────────────────────

  private cost(): CostRecord {
    const cost: CostRecord = { text: "", orbs: {}, either: [], marker: null, burst: null, spiritBoost: null, condition: null, program: null };
    if (this.tok.kind === "newline" || this.tok.kind === "eof") {
      this.endOfLine();
      return cost;
    }
    do {
      this.costItem(cost);
    } while (this.eatPunct(","));
    this.endOfLine();
    return cost;
  }

  private costItem(cost: CostRecord): void {
    if (this.isPunct("{")) {
      // `{Red}{Red}{any}` is one item; `{Red/Blue}` is an either-orb. Both
      // shapes may sit side by side without a comma, as the cards print them.
      while (this.eatPunct("{")) {
        const first = this.word("an energy colour");
        if (this.isPunct("/")) {
          const group = [first as Color];
          while (this.eatPunct("/")) group.push(this.word("an energy colour") as Color);
          cost.either.push(group);
        } else {
          cost.orbs[first] = (cost.orbs[first] ?? 0) + 1;
        }
        this.want("}");
      }
      return;
    }
    if (this.tok.kind === "number") {
      const n = this.number();
      if (!this.eatKw("marker")) this.fail("a number in a price is a marker count", ["marker"]);
      cost.marker = n;
      return;
    }
    if (this.eatKw("burst")) {
      cost.burst = this.number();
      return;
    }
    if (this.eatKw("spiritBoost")) {
      cost.spiritBoost = this.number();
      return;
    }
    if (this.eatKw("TEXT")) {
      cost.text = this.string();
      return;
    }
    if (this.eatKw("IF")) {
      cost.condition = this.cond();
      return;
    }
    if (this.eatKw("DO")) {
      cost.program = this.block();
      return;
    }
    this.fail("that is not part of a price", ["{Red}", "+1 marker", "burst N", "spiritBoost N", "TEXT", "IF", "DO"]);
  }

  // ── steps ─────────────────────────────────────────────────────────────────

  /** A program: steps until the end of the source, one per line or run together. */
  private ops(): Op[] {
    const out: Op[] = [];
    this.skipNl();
    while (this.tok.kind === "word") {
      out.push(this.op());
      this.skipNl();
    }
    return out;
  }

  private block(): Op[] {
    this.want("{");
    const out: Op[] = [];
    this.skipNl();
    while (!this.isPunct("}")) {
      if (this.tok.kind === "eof") this.fail("a block is never closed", ["}"]);
      out.push(this.op());
      this.skipNl();
      this.eatPunct(";");
      this.skipNl();
    }
    this.want("}");
    return out;
  }

  private op(): Op {
    // The name's own token, kept: an unknown step is reported where the name
    // is, not where the parser has got to by the time it finds out.
    const at = this.tok;
    const name = this.word("a step");
    const spec = OP_SCHEMA[name as Op["op"]];
    if (!spec) throw new LangSyntaxError(`the engine has no step called ${JSON.stringify(name)}`, at.start, Object.keys(OP_SCHEMA));
    return { op: name, ...this.fields(spec.fields) } as unknown as Op;
  }

  /**
   * `(field: value, …)`, with the first *required* field allowed to stand on
   * its own — `ko($t)` for `ko(target: $t)`. Only the first, and only when the
   * argument is not itself a `name:` pair, so there is never a guess to make.
   */
  private fields(fields: OpField[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const open = this.tok;
    /** A required field left out is caught here rather than by the validator, so the error can point at the call. */
    const complete = () => {
      const missing = fields.filter((f) => f.required && out[f.name] === undefined).map((f) => f.name);
      if (missing.length) throw new LangSyntaxError(`this needs ${missing.map((m) => JSON.stringify(m)).join(", ")}, which is required`, open.start, missing);
      return out;
    };
    this.want("(");
    this.skipNl();
    if (this.eatPunct(")")) return complete();
    if (!this.atField()) {
      const first = fields.find((f) => f.required) ?? fields[0];
      if (!first) this.fail("this step takes no arguments", [")"]);
      out[first.name] = this.value(first);
      this.skipNl();
      if (!this.eatPunct(",")) {
        this.want(")");
        return complete();
      }
    }
    do {
      this.skipNl();
      if (this.isPunct(")")) break;
      const name = this.word("a field name");
      const f = fields.find((x) => x.name === name);
      if (!f) this.fail(`there is no field called ${JSON.stringify(name)} here`, fields.map((x) => x.name));
      this.want(":");
      this.skipNl();
      out[name] = this.value(f);
      this.skipNl();
    } while (this.eatPunct(","));
    this.want(")");
    return complete();
  }

  private value(f: OpField): unknown {
    if (this.isKw("null")) {
      if (!f.nullable) this.fail(`${JSON.stringify(f.name)} cannot be null`, []);
      this.i++;
      return null;
    }
    return this.typed(f.type);
  }

  private typed(type: FieldType): unknown {
    if (typeof type === "object") {
      if ("enum" in type) return this.enumValue(type.enum);
      return this.list(() => (type.list === "string" ? this.text() : this.enumValue(type.list.enum)));
    }
    switch (type) {
      case "amount":
        return this.amount();
      case "ref":
        return this.ref();
      case "selector":
        return this.selector();
      case "side":
        return this.enumValue(SIDES);
      case "area":
        return this.enumValue(AREAS);
      case "duration":
        return this.enumValue(DURATIONS);
      case "cond":
        return this.cond();
      case "conds":
        return this.list(() => this.cond());
      case "ops":
        return this.block();
      case "modes":
        return this.list(() => ({ label: this.string("a label"), ops: this.block() }));
      case "string":
        return this.string();
      case "number":
        return this.number();
      case "boolean":
        return this.bool();
      case "keyword":
        return this.keyword();
      case "filter":
        return this.filter();
    }
  }

  private bool(): boolean {
    if (this.eatKw("true")) return true;
    if (this.eatKw("false")) return false;
    return this.fail("expected true or false", ["true", "false"]);
  }

  /** A bare word where one will do, a quoted text for the values that carry spaces. */
  private text(): string {
    return this.tok.kind === "string" ? this.string() : this.word("a word or a quoted text");
  }

  private enumValue<T extends string>(values: readonly T[]): T {
    const at = this.tok;
    const v = this.text();
    if (!(values as readonly string[]).includes(v)) throw new LangSyntaxError(`${JSON.stringify(v)} is not one of these`, at.start, [...values]);
    return v as T;
  }

  private list<T>(item: () => T): T[] {
    this.want("[");
    const out: T[] = [];
    this.skipNl();
    while (!this.isPunct("]")) {
      if (this.tok.kind === "eof") this.fail("a list is never closed", ["]"]);
      out.push(item());
      this.skipNl();
      if (!this.eatPunct(",")) break;
      this.skipNl();
    }
    this.want("]");
    return out;
  }

  // ── expressions ───────────────────────────────────────────────────────────

  private variable(): string {
    this.want("$");
    return this.word("a variable name");
  }

  private amount(): Amount {
    if (this.isPunct("$")) return { var: this.variable() };
    if (this.isKw("count") && this.isPunct("(", this.ahead(1))) {
      this.i += 2;
      const sel = this.selector();
      this.want(")");
      if (!this.eatPunct("*")) return { count: sel };
      return { count: sel, times: this.number() };
    }
    if (this.isKw("sumPower") && this.isPunct("(", this.ahead(1))) {
      this.i += 2;
      const v = this.variable();
      this.want(")");
      return { sumPower: { var: v } };
    }
    if (this.isKw("handUpTo") && this.isPunct("(", this.ahead(1))) {
      this.i += 2;
      const n = this.number();
      this.want(")");
      return { handUpTo: n };
    }
    return this.number("a number, $var, count(…), sumPower($v) or handUpTo(N)");
  }

  private ref(): Ref {
    if (!this.isPunct("$")) return { sel: this.selector() };
    const v = this.variable();
    if (!this.eatKw("MINUS")) return { var: v };
    return { var: v, minus: this.variable() };
  }

  // ── the selector ──────────────────────────────────────────────────────────

  private selector(): Selector {
    const sel: Selector = {};
    let parts = 0;
    for (;;) {
      if (this.atEnd() || this.isPunct("*")) break;
      this.selectorPart(sel);
      parts++;
    }
    if (!parts) this.fail("expected a selector", ["1 IN you.battle", "[self]", "any"]);
    return sel;
  }

  private selectorPart(sel: Selector): void {
    if (this.isPunct("[")) {
      this.i++;
      sel.special = this.enumValue(SPECIAL_TARGETS);
      this.want("]");
      return;
    }
    if (this.isPunct("(") || this.tok.kind === "string") {
      sel.filter = this.filter();
      return;
    }
    if (this.atNumber()) {
      sel.count = this.number();
      return;
    }
    if (this.eatKw("FROM")) {
      sel.fromVar = this.variable();
      return;
    }
    if (this.eatKw("UP")) {
      if (!this.eatKw("TO")) this.fail('expected "UP TO"', ["TO"]);
      sel.upTo = true;
      if (this.atNumber()) sel.count = this.number();
      return;
    }
    if (this.eatKw("TOP")) {
      sel.take = this.number();
      return;
    }
    if (this.eatKw("BOTTOM")) {
      sel.take = this.number();
      sel.fromEnd = true;
      return;
    }
    if (this.eatKw("OF")) {
      sel.side = this.enumValue(SIDES);
      return;
    }
    if (this.eatKw("IN")) {
      this.places(sel);
      return;
    }
    const at = this.tok;
    const w = this.text();
    const flag = SELECTOR_FLAGS[w];
    if (!flag) throw new LangSyntaxError(`${JSON.stringify(w)} says nothing about which cards`, at.start, Object.keys(SELECTOR_FLAGS));
    flag(sel);
  }

  /**
   * `IN you.battle`, `IN battle|unison`, `IN opponent.ANY(hand)`. A list of
   * one is written `ANY(hand)` because `IN hand` is the single-area field, and
   * the two are different fields on the selector.
   */
  private places(sel: Selector): void {
    if (this.tok.kind === "word" && this.isPunct(".", this.ahead(1))) {
      sel.side = this.enumValue(SIDES);
      this.want(".");
    }
    if (this.isKw("ANY") && this.isPunct("(", this.ahead(1))) {
      this.i += 2;
      const areas = [this.enumValue(AREAS)];
      while (this.eatPunct("|")) areas.push(this.enumValue(AREAS));
      this.want(")");
      sel.areas = areas;
      return;
    }
    const first = this.enumValue(AREAS);
    if (!this.isPunct("|")) {
      sel.area = first;
      return;
    }
    const areas = [first];
    while (this.eatPunct("|")) areas.push(this.enumValue(AREAS));
    sel.areas = areas;
  }

  // ── the card filter ───────────────────────────────────────────────────────

  private filter(): CardFilter {
    if (this.tok.kind === "string") return parseFilter(this.string());
    const f = emptyFilter();
    this.want("(");
    this.skipNl();
    while (!this.isPunct(")")) {
      if (this.tok.kind === "eof") this.fail("a filter is never closed", [")"]);
      const at = this.tok;
      const name = this.word("a filter field") as keyof CardFilter;
      const kind = FILTER_FIELDS[name];
      if (!kind) throw new LangSyntaxError(`a card filter has no ${JSON.stringify(name)}`, at.start, Object.keys(FILTER_FIELDS));
      this.want("=");
      (f as unknown as Record<string, unknown>)[name] = this.filterValue(kind);
      this.skipNl();
      if (!this.eatKw("AND")) break;
      this.skipNl();
    }
    this.want(")");
    return f;
  }

  private filterValue(kind: FilterFieldType): unknown {
    switch (kind) {
      case "strings":
      case "keywords":
      case "colors":
        return this.list(() => this.text());
      case "boolean":
        return this.bool();
      case "cardType":
      case "skillKind":
        return this.eatKw("null") ? null : this.text();
      case "number":
        return this.eatKw("null") ? null : this.number();
      case "tri":
        return this.eatKw("null") ? null : this.bool();
      case "powerRel": {
        if (this.eatKw("null")) return null;
        const of = this.word("self");
        const cmp = this.tok.kind === "punct" ? this.toks[this.i++].text : this.fail("expected a comparison", ["<=", "<", ">=", ">"]);
        return { of, cmp };
      }
    }
  }

  // ── keyword literals ──────────────────────────────────────────────────────

  /**
   * `[Blocker]`, `[Strike x: 2]`, `[Empower color: Red, x: 1]`. The name is
   * taken from the source rather than the tokens: half the keywords carry a
   * space or a hyphen ("Victory Strike", "Energy-Exhaust"), which the lexer
   * has already broken apart. Parameters begin at the first `name:`.
   */
  private keyword(): KeywordSkill {
    this.want("[");
    const from = this.tok.start;
    let to = from;
    while (!this.isPunct("]") && !this.atField()) {
      if (this.tok.kind === "eof") this.fail("a keyword is never closed", ["]"]);
      to = this.tok.end;
      this.i++;
    }
    const name = this.src.slice(from, to).trim();
    if (!(KEYWORD_NAMES as readonly string[]).includes(name)) throw new LangSyntaxError(`${JSON.stringify(name)} is not a keyword skill`, from, [...KEYWORD_NAMES]);
    const out: Record<string, unknown> = { name };
    while (this.atField()) {
      const param = this.word("a keyword parameter");
      this.want(":");
      out[param] = this.plain();
      if (!this.eatPunct(",")) break;
    }
    this.want("]");
    return out as unknown as KeywordSkill;
  }

  /** A keyword parameter: a number, a word, a quoted text, a list, a boolean or null. */
  private plain(): unknown {
    if (this.eatKw("null")) return null;
    if (this.isKw("true") || this.isKw("false")) return this.bool();
    if (this.atNumber()) return this.number();
    if (this.isPunct("[")) return this.list(() => this.plain());
    return this.text();
  }

  // ── conditions ────────────────────────────────────────────────────────────

  private condAndEnd(): Cond {
    const c = this.cond();
    this.endOfLine();
    return c;
  }

  cond(): Cond {
    const first = this.condAnd();
    if (!this.isKw("OR")) return first;
    const conds = [first];
    while (this.eatKw("OR")) {
      this.skipNl();
      conds.push(this.condAnd());
    }
    return { kind: "any", conds };
  }

  private condAnd(): Cond {
    const first = this.condNot();
    if (!this.isKw("AND")) return first;
    const conds = [first];
    while (this.eatKw("AND")) {
      this.skipNl();
      conds.push(this.condNot());
    }
    return { kind: "all", conds };
  }

  private condNot(): Cond {
    // `not` is both the operator and a condition kind. It is the kind only
    // when it is written like every other one — `not(cond: …)`.
    if (this.isKw("NOT") && !this.generalForm(1)) {
      this.i++;
      return { kind: "not", cond: this.condNot() };
    }
    return this.condAtom();
  }

  /** Whether the call starting `n` tokens ahead is the general `name(field: …)` form. */
  private generalForm(n: number): boolean {
    return this.isPunct("(", this.ahead(n)) && this.ahead(n + 1).kind === "word" && this.isPunct(":", this.ahead(n + 2));
  }

  private condAtom(): Cond {
    if (this.eatPunct("(")) {
      this.skipNl();
      const c = this.cond();
      this.skipNl();
      this.want(")");
      return c;
    }
    const at = this.tok;
    const name = this.word("a condition");
    const spec = COND_SCHEMA[name as Cond["kind"]];
    if (!spec) throw new LangSyntaxError(`the engine has no condition called ${JSON.stringify(name)}`, at.start, Object.keys(COND_SCHEMA));
    if (this.generalForm(0) || !COMPARABLE.has(name)) return { kind: name, ...this.fields(spec.fields) } as unknown as Cond;
    // `count(SEL) >= 2`, `life(you) <= 4` — the sugar, and the only form in
    // which one of these prints when it carries exactly one bound.
    this.want("(");
    const inner = name === "life" ? { side: this.enumValue(SIDES) } : { sel: this.selector() };
    this.want(")");
    const cmp = this.tok.kind === "punct" && (this.tok.text === ">=" || this.tok.text === "<=") ? this.toks[this.i++].text : this.fail("a comparison needs >= or <=", [">=", "<="]);
    const n = this.number();
    return { kind: name, ...inner, ...(cmp === ">=" ? { atLeast: n } : { atMost: n }) } as unknown as Cond;
  }
}

/** The condition kinds written as a comparison; the same list `print.ts` sugars. */
const COMPARABLE = new Set(["count", "life", "markers", "power"]);

function errorFrom(src: string, e: unknown, clause: string): LangError {
  const at = e instanceof LangSyntaxError ? e : null;
  const where = positionOf(src, at?.offset ?? 0);
  return { line: where.line, col: where.col, lineText: where.lineText, clause, message: at ? at.message : e instanceof Error ? e.message : "could not read this", expected: at?.expected ?? [] };
}

/** WHEN / COST / IF / THEN → a record. Never throws: the failure is the value. */
export function parseRule(src: string): Parsed<Rule> {
  // The parser is built outside the `try` so that a failure can still say
  // which clause it was in — the parser carries that, and a lexer error before
  // it exists is a WHEN error by definition, since WHEN is the first line.
  let parser: Parser | null = null;
  try {
    parser = new Parser(src, lex(src));
    return { ok: true, value: parser.rule() };
  } catch (e) {
    return { ok: false, error: errorFrom(src, e, parser?.clause ?? "WHEN") };
  }
}

/** The same, for the pieces a caller wants on their own (the tests, and later the definition files). */
export function parseCond(src: string): Parsed<Cond> {
  try {
    return { ok: true, value: new Parser(src, lex(src)).cond() };
  } catch (e) {
    return { ok: false, error: errorFrom(src, e, "IF") };
  }
}
