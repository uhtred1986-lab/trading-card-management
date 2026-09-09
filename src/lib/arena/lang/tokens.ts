/**
 * The rules language, lexed.
 *
 * One token stream for the whole language — a card's rule today, a game's
 * definition later — so the parser never reads characters and an error can
 * always say where it is. Tokens carry their source offsets because two things
 * need the raw text back: a keyword literal whose name has spaces and hyphens
 * (`[Energy-Exhaust]`, `[Warrior of Universe 7]`), and the `{line, col}` of an
 * error.
 *
 * Newlines are tokens rather than whitespace: a program's steps are separated
 * by them, and a rule's clauses each start on their own line.
 */

export type TokenKind = "word" | "number" | "string" | "punct" | "newline" | "eof";

export interface Token {
  kind: TokenKind;
  /** The word, the punctuation, or the string's *decoded* body. */
  text: string;
  start: number;
  end: number;
}

/**
 * Two-character operators come first so `>=` never lexes as `>` then `=`.
 * `*` multiplies an amount ("+5000 power for each"), `/` separates the colours
 * of an either-orb, and `$` opens a variable.
 */
const PUNCT2 = [">=", "<="];
const PUNCT1 = "(){}[],:|/.$*;=<>+-";

export class LangSyntaxError extends Error {
  constructor(
    message: string,
    readonly offset: number,
    readonly expected: string[] = [],
  ) {
    super(message);
    this.name = "LangSyntaxError";
  }
}

/** Where an offset falls in the source, 1-based, for an error a person reads. */
export function positionOf(src: string, offset: number): { line: number; col: number; lineText: string } {
  const upto = src.slice(0, Math.max(0, Math.min(offset, src.length)));
  const line = upto.split("\n").length;
  const col = offset - (upto.lastIndexOf("\n") + 1) + 1;
  const lineText = src.split("\n")[line - 1] ?? "";
  return { line, col, lineText };
}

/**
 * A `--` comment runs to the end of the line. Nothing in the language prints
 * one, but a person editing a rule by hand wants somewhere to put a note, and
 * a comment that the printer would silently eat on the next save is worse than
 * none — so `printRule` never emits one and `parseRule` never keeps one.
 */
export function lex(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\n") {
      out.push({ kind: "newline", text: "\n", start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\r") {
      i++;
      continue;
    }
    if (ch === "-" && src[i + 1] === "-") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let body = "";
      while (j < src.length && src[j] !== '"') {
        if (src[j] === "\\" && j + 1 < src.length) {
          body += src[j + 1] === "n" ? "\n" : src[j + 1];
          j += 2;
          continue;
        }
        body += src[j];
        j++;
      }
      if (j >= src.length) throw new LangSyntaxError("a quoted text is never closed", i, ['"']);
      out.push({ kind: "string", text: body, start: i, end: j + 1 });
      i = j + 1;
      continue;
    }
    // A number, and the sign in front of it — "-1 marker", "+5000 power". A
    // bare `-` between two words is part of neither and stays punctuation.
    if (/[0-9]/.test(ch) || ((ch === "-" || ch === "+") && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = ch === "-" || ch === "+" ? i + 1 : i;
      while (j < src.length && /[0-9]/.test(src[j])) j++;
      out.push({ kind: "number", text: src.slice(i, j), start: i, end: j });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      out.push({ kind: "word", text: src.slice(i, j), start: i, end: j });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (PUNCT2.includes(two)) {
      out.push({ kind: "punct", text: two, start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (PUNCT1.includes(ch)) {
      out.push({ kind: "punct", text: ch, start: i, end: i + 1 });
      i++;
      continue;
    }
    throw new LangSyntaxError(`there is no ${JSON.stringify(ch)} in the language`, i);
  }
  out.push({ kind: "eof", text: "", start: src.length, end: src.length });
  return out;
}
