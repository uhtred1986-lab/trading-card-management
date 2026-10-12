/**
 * A keyword's own line doing something of its own: the `DO` of a `DEFINE
 * KEYWORD`, and the two fields that say when it runs (Stage 7's groundwork).
 *
 * About fifteen keywords are not hooks at all. [Overlord] is a move a player
 * makes; [Offering] is something that happens when its card is played. The
 * legacy engine has each as a `case` in `activatable`/`whyNotActivate`/
 * `activate` or in `keywordTriggers`/`resolveKeywordOrText`; here each is one
 * paragraph of `keywords.rules`:
 *
 *   `offer: "<skill kind>"` — the line is **a move**. `vm/activate.ts` lists it
 *   among the candidates of the action whose `skills:` takes lines of that
 *   family, gates it like any line of that kind plus the keyword's own
 *   `REFUSE` lines, charges its printed price, and queues `DO` in place of the
 *   card's record.
 *
 *   `at: [<moment>, …]` — the line **answers to moments**. `vm/triggers.ts`
 *   pends it the way it pends an [Auto] whose record names that moment, and
 *   `vm/flow.ts`'s checkpoint runs `DO` when it resolves.
 *
 * This module is only the reading both halves share: which declaration a line
 * carries, and its program with the printed keyword's parameters bound. It is
 * a leaf — no interpreter, no state — so `activate.ts`, `triggers.ts` and
 * `flow.ts` can all import it without importing each other.
 *
 * Pure and client-safe: no database, no network, no `fs`.
 */
import { printedDescription, printedNames } from "../text/cards";
import type { Cond, Op, Selector } from "./script";
import type { Color, Skill } from "../types";
import { bindKeywordCond, bindKeywordParams, type GameDefinition, type KeywordDef } from "../rulesets";
import { RulesetBroken } from "./errors";

/** The declaration of the keyword a line *is* — a line printed as nothing but its keyword tag (22-1-1), never a printed [Activate] that also carries one. */
function declarationOf(game: GameDefinition, sk: Skill): KeywordDef | undefined {
  if (sk.kind !== "keyword" || !sk.keyword) return undefined;
  const def = game.keywords[sk.keyword.name];
  return def?.do ? def : undefined;
}

/**
 * The keyword this line is a move of, when its declaration says `offer:`.
 *
 * One printed shape besides the bare tag is the keyword's move too: a line
 * whose printed kind *is* the kind the move is offered as —
 * "[Union-Absorb][Activate: Main] …" (22-13-6-2) is the [Union] activation
 * itself, printed with the tag of the window it is used in, not a second
 * [Activate] that happens to carry a keyword.
 */
export function keywordMoveOf(game: GameDefinition, sk: Skill): KeywordDef | undefined {
  const def = declarationOf(game, sk) ?? (sk.keyword && sk.kind !== "keyword" ? game.keywords[sk.keyword.name] : undefined);
  return def?.do && def.offer !== undefined && (sk.kind === "keyword" || sk.kind === def.offer) ? def : undefined;
}

/** The keyword this line answers to `trigger` as, when its declaration names that moment in `at:`. */
export function keywordMomentOf(game: GameDefinition, sk: Skill, trigger?: string): KeywordDef | undefined {
  const def = declarationOf(game, sk);
  if (!def?.at) return undefined;
  return trigger === undefined || def.at.includes(trigger) ? def : undefined;
}

/**
 * The keyword's `DO`, with its parameters filled in from the line as printed —
 * `[Swap 3]` runs its body with `x` bound to 3. The `KeywordSkill` the card
 * parser hands back carries exactly the fields `TAKES` declares, which
 * `scripts/verify/rulesets.ts` holds equal.
 */
export function keywordProgram(game: GameDefinition, def: KeywordDef, sk: Skill): Op[] {
  const ops = bindKeywordParams(def.do ?? [], def.takes, (sk.keyword ?? {}) as Record<string, unknown>, game);
  return def.name === "Aegis" ? continueAegisPayment(game, ops) : ops;
}

/** 22-30-3: the declared hand-card payment and 22-30-5 effect are separate
 * stages so an additional skill cost can be determined between them (#595). */
export function aegisPrograms(game: GameDefinition, def: KeywordDef, sk: Skill): { payment: Op[]; effect: Op[] } {
  if (def.name !== "Aegis") throw new RulesetBroken(game.id, "Aegis payment stages requested for another keyword");
  const ops = bindKeywordParams(def.do ?? [], def.takes, (sk.keyword ?? {}) as Record<string, unknown>, game);
  const payment = ops[1];
  const before = continueAegisPayment(game, ops, []);
  if (payment?.op !== "if") throw new RulesetBroken(game.id, "Aegis no longer declares its payment/effect boundary");
  return { payment: before, effect: [...payment.then.slice(1), ...ops.slice(2)] };
}

/**
 * 22-30-3: Aegis's declared body names the colours, asks for cards, and says
 * what happens after their cost is paid. Turn only its broad set choice into
 * a continuation over that declaration: one first card, then (when needed)
 * only the still-missing colour. The interpreter persists each choice in the
 * ScriptFrame, so this generated program survives a save/reload without a
 * separate Aegis state shape.
 */
function continueAegisPayment(game: GameDefinition, ops: Op[], after?: Op[]): Op[] {
  const first = ops[0];
  const payment = ops[1];
  if (first?.op !== "choose" || payment?.op !== "if" || payment.cond.kind !== "covers") {
    throw new RulesetBroken(game.id, `Aegis no longer declares its payment as a choose followed by a covers check`);
  }
  const colors = [...new Set(payment.cond.colors)];
  const declaredColors = first.sel.filter?.colors;
  if (!colors.length || !declaredColors || !colors.every((c) => declaredColors.includes(c)) || declaredColors.some((c) => !colors.includes(c))) {
    throw new RulesetBroken(game.id, `Aegis must choose cards for every colour declared by its covers check`);
  }
  const paymentMove = payment.then[0];
  if (paymentMove?.op !== "moveTo" || !("var" in paymentMove.target) || paymentMove.target.var !== first.as) {
    throw new RulesetBroken(game.id, `Aegis must move its declared choice as the card payment`);
  }
  const selectedCovers = (variable: string, color: Color): Cond => ({ kind: "covers", sel: { fromVar: variable }, colors: [color] });
  // Every card in the skill cost is required once activation is accepted.
  // Keep the VM's normal behavior of silently taking a sole forced candidate;
  // a choice among multiple eligible cards remains a mandatory one-card pick.
  const selectOne = (sel: Selector): Selector => ({ ...sel, count: 1, upTo: false });
  const selectColor = (color: Color): Selector => {
    if (!first.sel.filter) throw new RulesetBroken(game.id, `Aegis payment selector must carry its declared colour filter`);
    return {
      ...selectOne(first.sel),
      filter: { ...first.sel.filter, colors: [color] },
    };
  };
  const chooseFor = (color: Color, as: string): Op => ({
    ...first,
    sel: selectColor(color),
    as,
    reason: `[Aegis]: choose a card to cover ${color}`,
  });
  const afterPayment = after ?? [...payment.then.slice(1), ...ops.slice(2)];
  const collectCards = (variables: string[]): Op[] => [
    ...variables.map((variable) => ({ ...paymentMove, target: { var: variable } })),
    ...afterPayment,
  ];
  const completeColors = (index: number, variables: string[]): Op[] => {
    if (index === colors.length) return collectCards(variables);
    const color = colors[index];
    const variable = `${first.as}:color:${index}`;
    const choose = chooseFor(color, variable);
    const afterChoice: Op = {
      op: "if",
      cond: { kind: "chose", var: variable },
      then: completeColors(index + 1, [...variables, variable]),
    };
    if (!variables.length) return [choose, afterChoice];
    return [{
      op: "if",
      cond: { kind: "any", conds: variables.map((picked) => selectedCovers(picked, color)) },
      then: completeColors(index + 1, variables),
      else: [choose, afterChoice],
    }];
  };
  // Keep the declaration's initial choice broad: the player may start with
  // any one of the printed colours, including a multicolour card. Continue
  // only for colours that selection did not cover. The declaration still
  // establishes the source pool, named colours, payment move and effect.
  const firstAs = `${first.as}:first`;
  const firstChoice: Op = {
    ...first,
    sel: {
      ...selectOne(first.sel),
      filter: { ...first.sel.filter!, colors },
    },
    as: firstAs,
  };
  const continueAfterFirst: Op = {
    op: "if",
    cond: { kind: "chose", var: firstAs },
    then: [
      {
        op: "if",
        cond: { kind: "covers", sel: { fromVar: firstAs }, colors },
        then: collectCards([firstAs]),
        else: completeColors(0, [firstAs]),
      },
    ],
  };
  return [firstChoice, continueAfterFirst];
}

/** The keyword's `AFTER` — what a move runs once the line's printed effect has — bound the way its `DO` is (#155). */
export function keywordAfterProgram(game: GameDefinition, def: KeywordDef, sk: Skill): Op[] {
  return def.after ? bindKeywordParams(def.after, def.takes, (sk.keyword ?? {}) as Record<string, unknown>, game) : [];
}

/** A `REFUSE … UNLESS` of the keyword's move, with its parameters filled in from the line as printed (`$variant`, `$x`), the way its `DO` is. */
export function keywordRefusalCond(game: GameDefinition, def: KeywordDef, sk: Skill, cond: Cond): Cond {
  return bindKeywordCond(cond, def.takes, (sk.keyword ?? {}) as Record<string, unknown>, game);
}

/**
 * The words a keyword's move shows — its `label:` and the text of a `REFUSE`'s
 * requirement — with the line's own words put in: `{card}` is the card's name,
 * `{line}` the description the line prints ("<Nail>"), `{names}` the
 * characters it names in ‹…› joined by "and", `{back}` the name its other face
 * prints (a Leader's awakened side), and `{<param>}` a parameter the
 * keyword `TAKES`, as printed (`{variant}` is "Xeno-Evolve", `{x}` is 3), and
 * `{<param>?<words>}` the words only when a boolean parameter is set. The
 * legacy engine builds each of these sentences by hand per keyword; here the
 * declaration writes it once.
 */
export function keywordWords(text: string, def: KeywordDef, sk: Skill, card: string, back?: string): string {
  const values = (sk.keyword ?? {}) as Record<string, unknown>;
  // `{<param>?<words>}` — the words when a boolean parameter is set, nothing
  // when it is not: "{dark?Dark }Over Realm" (#157).
  text = text.replace(/\{(\w+)\?([^{}]*)\}/g, (whole, name: string, words: string) => (def.takes?.some((p) => p.name === name) ? (values[name] === true ? words : "") : whole));
  return text.replace(/\{(\w+)(:and)?\}/g, (whole, name: string, and?: string) => {
    if (name === "card") return card;
    // The name the card's other face prints — a Leader's awakened side (#155).
    if (name === "back" && back !== undefined) return back;
    if (name === "line") return printedDescription(sk);
    if (name === "names") return printedNames(sk).join(" and ");
    if (def.takes?.some((p) => p.name === name) && values[name] !== undefined) {
      // A list parameter ([Arrival]'s colours) is written as printed,
      // "Red/Blue" — or "Red and Blue" as `{colors:and}`.
      const v = values[name];
      return Array.isArray(v) ? v.join(and ? " and " : "/") : String(v);
    }
    return whole;
  });
}

/**
 * The names a keyword's own move is announced under for `keywordActivated`:
 * the keyword, and — when the card prints a variant of it — the variant as
 * printed, so "when this card's [Union-Absorb] is activated" (22-13-5) hears
 * an Absorb and "when you activate a [Union] skill" hears every [Union].
 */
export function keywordMomentNames(def: KeywordDef, sk: Skill): string[] {
  const variant = (sk.keyword as { variant?: unknown } | null)?.variant;
  if (typeof variant !== "string" || variant === def.name) return [def.name];
  return [def.name, variant.includes(def.name) ? variant : `${def.name}-${variant}`];
}
