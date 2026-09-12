import { parseFilter } from "../filters";
import type { Cond, Ref, Selector } from "../script";
import { compileAction, joints } from "./prices";
import { filterFor, parseTarget } from "./targets";

/**
 * A price, or the head of one, read as the one or more conditions it states.
 *
 * Cut at every joint first and read the pieces: the patterns below all end in
 * a greedy tail, so "your Leader Card is red, you have 2 or more energy" read
 * whole is one condition about a leader that is "red, you have 2 or more
 * energy" — and the second requirement is gone. The whole is only read when
 * the pieces do not, which is what keeps "a red and blue card" together.
 */
export function allConditions(head: string): { cond: Cond; subject?: Ref }[] | null {
  const parts = joints(head);
  if (parts.length) {
    const conds: { cond: Cond; subject?: Ref }[] = [];
    let from = 0;
    for (const j of [...parts, { at: head.length, len: 0 }]) {
      const got = parseConditionClause(
        head
          .slice(from, j.at)
          .replace(/[\s,]+$/, "")
          .trim(),
        true,
      );
      if (!got) {
        conds.length = 0;
        break;
      }
      conds.push(got);
      from = j.at + j.len;
    }
    if (conds.length) return conds;
  }
  // The pieces did not read, so the whole is tried after all: plenty of single
  // conditions carry an "and" or a comma of their own — "you and your opponent
  // have a total of 8 or less life", "at least 1 <Recoome>, <Jeice>, <Burter>,
  // and <Guldo> card in play" — and cutting those up loses 291 skills to save
  // the few the `charged` guard already refuses.
  const whole = parseConditionClause(head, true);
  return whole ? [whole] : null;
}

/**
 * True when a piece of price text reads as an *action* the player takes to pay
 * (4-3-3) rather than something that has to be true (9-1-3).
 *
 * Asked one level deep only: a probe runs the whole compiler, which asks
 * questions about conditions of its own, and a probe inside a probe would be
 * answering one nobody asked.
 */
let probing = false;
function readsAsAction(said: string): boolean {
  if (probing || !said) return false;
  probing = true;
  try {
    return (
      compileAction(said, {
        kind: "activate:main",
        index: 0,
        tags: [],
        keyword: null,
        cost: "",
        effect: said,
        raw: said,
        oncePerTurn: false,
        limit: null,
        bond: null,
        sparking: null,
        burst: null,
        spiritBoost: null,
        markerCost: null,
        energyCost: {},
        energyEither: [],
      }) !== null
    );
  } finally {
    probing = false;
  }
}

const COLOR_NAMES_PATTERN = "(?:an?\\s+)?(?:red|blue|green|yellow|black|colorless)";
const AREA_NAMES_PATTERN = "(?:(?:your|your opponent's|the|an?)\\s+)?(?:hand|deck|drop|warp|life|battle|unison|energy|leader|combo|play|z-deck|z-energy|zdeck|zenergy)(?: area)?";

export function splitDisjunction(text: string): string[] {
  const regex = /(?:,\s+)?\bor\b/gi;
  let match: RegExpExecArray | null;
  const splitIndices: { start: number; end: number }[] = [];

  while ((match = regex.exec(text)) !== null) {
    const before = text.slice(0, match.index).trim();
    const after = text.slice(match.index + match[0].length).trim();

    if (/\d+\s*$/i.test(before) && /^(?:more|less|fewer)\b/i.test(after)) {
      continue;
    }
    if (new RegExp(COLOR_NAMES_PATTERN + "$", "i").test(before) && new RegExp("^" + COLOR_NAMES_PATTERN, "i").test(after)) {
      continue;
    }
    if (new RegExp(AREA_NAMES_PATTERN + "$", "i").test(before) && new RegExp("^" + AREA_NAMES_PATTERN, "i").test(after)) {
      continue;
    }
    splitIndices.push({ start: match.index, end: match.index + match[0].length });
  }

  if (splitIndices.length === 0) return [text];

  const parts: string[] = [];
  let lastIndex = 0;
  for (const idx of splitIndices) {
    parts.push(text.slice(lastIndex, idx.start).trim());
    lastIndex = idx.end;
  }
  parts.push(text.slice(lastIndex).trim());
  return parts.filter((p) => p.length > 0);
}

export function parseConditionClause(clause: string, allowBare = false): { cond: Cond; subject?: Ref } | null {
  const trimmed = clause.toLowerCase().trim();
  // "During your turn" is a condition too, and reads as one everywhere else in
  // the text. The delay phrases ("during your opponent's *next* turn") are
  // matched before this is reached, so they are not caught here.
  const t = trimmed.replace(/^(?:if|when|while|during)\s+/, "");
  // "if your Leader Card is yellow and your life is at 4 or less" splits on the
  // "and", so the second half arrives without a condition word in front of it.
  // It only counts as a condition when it continues one (9-1-3).
  if (t === trimmed && !allowBare) return null;
  // "If your Leader is a green <Broly> card **and** you have 2 or more
  // energy" — two conditions in one price. Every pattern below has a greedy
  // tail that would swallow the second and drop it in silence, which is worse
  // than failing: the skill would be offered without its second requirement.
  // A body clause never arrives here compound, because `splitClauses` has
  // already broken it at the "and".
  if (/ and /.test(t)) {
    const conds: Cond[] = [];
    const raw = clause.trim().split(/ and /i);
    let charged = false;
    for (const [i, part] of t.split(/ and /).entries()) {
      const got = parseConditionClause(part.trim(), true);
      if (!got) {
        conds.length = 0;
        // A part the compiler reads as something the player *does* is a price
        // to charge, not a claim to check (4-3-3). Falling through to the
        // patterns below would let one of their greedy tails swallow it, and
        // the skill would then be offered without ever paying for it —
        // 914 skills read that way, including BT31-132's "and you remove this
        // card in your Drop from the game". `splitPrice` reads such a price in
        // two; here the clause is simply not a condition.
        charged = readsAsAction((raw[i] ?? part).replace(/[\s,]+$/, "").trim());
        break;
      }
      conds.push(got.cond);
    }
    if (conds.length > 1) return { cond: { kind: "all", conds } };
    if (charged) return null;
  }
  // Several conditions joined by "or"; "or" binds loosest.
  // Every part has to read, or the whole condition is a gap.
  const JOIN = /(?=you |your |there |it'?s |it is |this card |all )/;
  const alternatives = t.split(new RegExp(`,? or ${JOIN.source}`));
  if (alternatives.length > 1) {
    const conds = alternatives.map((part) => parseConditionClause(part.trim(), true)?.cond ?? null);
    if (conds.every((x) => x)) return { cond: { kind: "any", conds: conds as Cond[] } };
  }
  let m: RegExpExecArray | null;
  // "If your Leader Card is a <Baby> card, it gets +10000 power" — the leader is
  // both the condition's subject and what "it" then refers to.
  if ((m = /^your leader(?: card)? is (.+)$/.exec(t))) {
    const parts = splitDisjunction(m[1]);
    if (parts.length > 1) {
      const conds = parts.map((part) => ({
        kind: "leaderMatches" as const,
        filter: parseFilter(part),
      }));
      return { cond: { kind: "any", conds }, subject: { sel: { special: "leader" } } };
    }
    const filter = parseFilter(m[1]);
    return { cond: { kind: "leaderMatches", filter }, subject: { sel: { special: "leader" } } };
  }
  // "If your opponent's Leader Card is red or blue" — the same test, other side.
  if ((m = /^your opponent's leader(?: card)? is (.+)$/.exec(t))) {
    const parts = splitDisjunction(m[1]);
    if (parts.length > 1) {
      const conds = parts.map((part) => ({
        kind: "leaderMatches" as const,
        side: "opponent" as const,
        filter: parseFilter(part),
      }));
      return { cond: { kind: "any", conds }, subject: { sel: { special: "opponentLeader" } } };
    }
    return { cond: { kind: "leaderMatches", side: "opponent", filter: parseFilter(m[1]) }, subject: { sel: { special: "opponentLeader" } } };
  }
  // Life, both sides and both directions. "Or more" reads the other bound of
  // the same condition, which the engine has always had and the compiler used
  // to leave to the referee.
  // The two life counts against each other, rather than against a number.
  if (/^your life is (?:less than or equal to|at or below|no more than) your opponent's life$/.test(t)) return { cond: { kind: "lifeVsOpponent", atMost: true } };
  if (/^your life is (?:greater than or equal to|at or above|no less than) your opponent's life$/.test(t)) return { cond: { kind: "lifeVsOpponent", atLeast: true } };
  const lifeBound = (n: string, dir: string) => (/less|fewer/.test(dir) ? { atMost: Number(n) } : { atLeast: Number(n) });
  if ((m = /^your life is (?:at )?(\d+) or (less|fewer|more)$/.exec(t))) return { cond: { kind: "life", side: "you", ...lifeBound(m[1], m[2]) } };
  if ((m = /^your opponent's life is (?:at )?(\d+) or (less|fewer|more)$/.exec(t))) return { cond: { kind: "life", side: "opponent", ...lifeBound(m[1], m[2]) } };
  // "If you have 2 or less life" — the same sentence with the subject moved.
  if ((m = /^you have (\d+) or (less|fewer|more) life$/.exec(t))) return { cond: { kind: "life", side: "you", ...lifeBound(m[1], m[2]) } };
  if ((m = /^your opponent has (\d+) or (less|fewer|more) life$/.exec(t))) return { cond: { kind: "life", side: "opponent", ...lifeBound(m[1], m[2]) } };
  // Whose turn it is (7-1). The engine has carried this condition since the
  // beginning and the compiler has never once emitted it.
  if (/^(?:it's |it is )?your turn$/.test(t) || /^during your turn$/.test(t)) return { cond: { kind: "isTurnPlayer" } };
  if (/^(?:it's |it is )?your opponent's turn$/.test(t) || /^during your opponent's turn$/.test(t)) return { cond: { kind: "isTurnPlayer", who: "opponent" } };

  // "If the Battle Card being played has an energy cost of 7 or less" — a
  // [Counter: Play] asking about the card it is answering (9-6). The card is
  // not in play yet, so it can only be named, never chosen.
  if ((m = /^the (?:battle |extra |unison )?card being played (?:has|is) (.+)$/.exec(t))) {
    const filter = filterFor(m[1], null);
    if (!filter) return null;
    return { cond: { kind: "count", sel: { special: "resolving", filter }, atLeast: 1 }, subject: { sel: { special: "resolving" } } };
  }

  // "If this card is under a yellow ≪Heroic≫ Battle Card" (23-2): the same
  // question as the target it guards, asked the other way up — the card on top
  // of this one is a yellow ≪Heroic≫ Battle Card. Written the moment `onTop`
  // existed to say it, because these thirteen [Permanent]s print the condition
  // and the grant as one sentence: read the grant alone and the card above
  // gains [Double Strike] whatever it is, which is a wider skill than the one
  // printed. The area a stack stands in is the area of the card on top
  // (23-2-2-2), so "in a Battle Area" narrows nothing and comes off.
  if ((m = /^this card is under (.+?)(?: in (?:a|an|the|your|your opponent's) [a-z- ]*area)?$/.exec(t))) {
    const above = filterFor(m[1], null);
    if (above === null) return null;
    return { cond: { kind: "count", sel: { special: "onTop", filter: above }, atLeast: 1 }, subject: { sel: { special: "onTop", filter: above } } };
  }
  // A card's own mode as a condition (1-10).
  if ((m = /^this card is in (rest|active) mode$/.exec(t))) {
    return { cond: { kind: "count", sel: { special: "self", mode: m[1] as "rest" | "active" }, atLeast: 1 }, subject: { sel: { special: "self" } } };
  }
  // "If you added a card to your hand", "if you chose to add 1 or more cards
  // to your hand", "if you played a card" — about an earlier step of the same
  // skill (20-16), which the interpreter remembers.
  if (/^you (?:chose to )?add(?:ed)? (?:a card|1 or more cards?|any cards?|cards?) to your hand$/.test(t)) return { cond: { kind: "did", what: "addToHand" } };
  // "If you chose **not** to add any cards to your hand" — the other half of
  // the same question (20-16), and the half that decides whether the rest of
  // the skill happens at all.
  if (/^you (?:chose not to|did ?n'?o?t|didn'?t) add (?:a card|1 or more cards?|any cards?|cards?) to your hand$/.test(t)) {
    return { cond: { kind: "not", cond: { kind: "did", what: "addToHand" } } };
  }
  if (/^you (?:chose to )?play(?:ed)? (?:a|1 or more|any|one or more) (?:battle )?cards?(?: this way)?$/.test(t)) return { cond: { kind: "did", what: "play" } };
  if (/^you negated (?:a|your opponent's) leader(?: card)?'s attack(?: with this skill)?$/.test(t)) return { cond: { kind: "did", what: "negateLeaderAttack" } };
  if (/^you negated (?:an|the|that) attack(?: with this skill)?$/.test(t)) return { cond: { kind: "did", what: "negateAttack" } };
  if (/^you ko'?d (?:a|1 or more|any|one or more) (?:battle )?cards?(?: (?:this way|with this skill))?$/.test(t)) return { cond: { kind: "did", what: "ko" } };
  if (/^you (?:drew|draw) (?:a|1 or more|any) cards?(?: with this skill)?$/.test(t)) return { cond: { kind: "did", what: "draw" } };
  if (/^you (?:did not|didn'?t|do not|don'?t) draw (?:a|any) cards?(?: with this skill)?$/.test(t)) return { cond: { kind: "not", cond: { kind: "did", what: "draw" } } };
  // "If your opponent's Leader Card's back is facing up" — awakened (22-2).
  if ((m = /^(your|your opponent's) leader(?: card)?'s back is facing up$/.exec(t))) {
    return { cond: { kind: "leaderFlipped", ...(m[1] === "your" ? {} : { side: "opponent" as const }) } };
  }
  // "If this card's power is 30000 or more".
  if ((m = /^this card'?s power is (\d+) or (more|less)$/.exec(t))) {
    return { cond: { kind: "power", sel: { special: "self" }, ...(m[2] === "more" ? { atLeast: Number(m[1]) } : { atMost: Number(m[1]) }) }, subject: { sel: { special: "self" } } };
  }
  // The same question in the two word orders the sets print beside it: "if
  // **this card has 20000 power or more**" (BT20-090, BT20-107, BT20-108,
  // BT28-003, EX25-31) and "if **your opponent's Leader Card has 10000 or less
  // power**" (BT1-015). The measure moves in front of the noun or behind it,
  // and the verb is "has" rather than "is" — three small differences from the
  // phrase above, and none of them changes what is being asked. Seven skills
  // went unread for them, and an unread condition takes its clause with it:
  // BT28-003 and EX25-31 are [Permanent]s whose whole text is the condition
  // and the grant, so neither read at all.
  //
  // Only the three subjects the grammar can already name. "**Its** power is
  // 20000 or more" (BT3-001) and "**that card** has 25000 power or less"
  // (EX09-01) are the same measure of a card an earlier clause named, and a
  // condition is parsed with no antecedent to resolve them against; "**you or
  // your opponent's** Leader Card has 15000 or more power" (BT3-026) asks
  // about either Leader, which `power` states of one selector at a time. Those
  // five stay unread (ground rule 5).
  if ((m = /^(this card|your leader(?: card)?|your opponent's leader(?: card)?) has (?:(\d+) or (more|less) power|(\d+) power or (more|less))$/.exec(t))) {
    const n = Number(m[2] ?? m[4]);
    const bound = (m[3] ?? m[5]) === "more" ? { atLeast: n } : { atMost: n };
    const sel: Selector = m[1] === "this card" ? { special: "self" } : m[1].startsWith("your opponent") ? { special: "opponentLeader" } : { special: "leader" };
    return { cond: { kind: "power", sel, ...bound }, subject: { sel } };
  }
  // "If your Leader Card has ≪Saiyan≫ in its special trait", "… has {Son Goku}
  // in its card name", "… has <Vegeta> in its character name".
  if ((m = /^your leader(?: card)? has (.+) in its (?:special traits?|card name|character names?)$/.exec(t))) {
    return { cond: { kind: "leaderMatches", filter: parseFilter(m[1]) }, subject: { sel: { special: "leader" } } };
  }
  // "If this card has 3 or more markers on it" (13-2).
  if ((m = /^this card has (\d+) or (more|less|fewer) markers?(?: on it)?$/.exec(t))) {
    return { cond: { kind: "markers", sel: { special: "self" }, ...(m[2] === "more" ? { atLeast: Number(m[1]) } : { atMost: Number(m[1]) }) }, subject: { sel: { special: "self" } } };
  }
  // "If **all** of your opponent's energy is in Rest Mode" (XD1-01): the whole
  // set against the part of it the description picks out. Read as two
  // selectors so that the description can be a mode as easily as a colour.
  if ((m = /^all of (.+?) (?:is|are) (.+)$/.exec(t))) {
    const whole = parseTarget(m[1]);
    const part = parseTarget(`${m[1]} ${m[2]}`);
    if (whole && part) {
      for (const sel of [whole, part]) {
        delete sel.count;
        delete sel.upTo;
      }
      // A description `parseTarget` did not take in leaves the two selectors
      // identical, and the condition would then always hold. That is worse
      // than a gap, so it stays a gap.
      if (JSON.stringify(whole) !== JSON.stringify(part)) return { cond: { kind: "every", sel: whole, matching: part }, subject: { sel: whole } };
    }
  }
  // "If one of your yellow Battle Cards **is being attacked**" (BT4-085), "if
  // this card is attacking": one end of the battle rather than either (8-1).
  // "One of" is the article, not a count — the condition asks whether any of
  // them is there.
  if ((m = /^(?:if )?(.+?) (is|isn't|is not) (being attacked|attacking)$/.exec(t))) {
    const sel: Selector | null = m[1] === "this card" ? { special: "self" } : parseTarget(m[1].replace(/^(?:one|any) of /, ""));
    if (sel) {
      delete sel.count;
      delete sel.upTo;
      const role = m[3] === "being attacked" ? "guard" : "attacker";
      return { cond: { kind: "inBattle", sel, role, ...(m[2] === "is" ? {} : { not: true }) }, subject: { sel } };
    }
  }
  // "If this card is in a battle", "if this card isn't in a battle", "if your
  // <Son Goku> card is in a battle" (8-1).
  if ((m = /^(this card|.+?) (is|isn't|is not) in a battle$/.exec(t))) {
    const sel: Selector | null = m[1] === "this card" ? { special: "self" } : parseTarget(m[1]);
    if (sel) {
      delete sel.count;
      delete sel.upTo;
      return { cond: { kind: "inBattle", sel, ...(m[2] === "is" ? {} : { not: true }) }, subject: { sel } };
    }
  }
  // "If this card participated in a battle during your opponent's turn"
  // (BT3-103): the past tense of the clause above it, and a different
  // question — the card is asked at the end of a battle, when nothing is an
  // attack or guard card any more (8-1-2-2), so what it reads is the card's
  // own memory of the turn. The turn half is one of the conditions the
  // compiler already has, and the two are asked together rather than folded
  // into the memory, which would have to store whose turn it was as well.
  if ((m = /^(this card|.+?) (?:participated|took part) in a battle(?: during (your|your opponent's) turn)?$/.exec(t))) {
    const sel: Selector | null = m[1] === "this card" ? { special: "self" } : parseTarget(m[1]);
    if (sel) {
      delete sel.count;
      delete sel.upTo;
      const was: Cond = { kind: "battled", sel };
      const turn: Cond | null = m[2] ? { kind: "isTurnPlayer", ...(m[2] === "your" ? {} : { who: "opponent" as const }) } : null;
      return { cond: turn ? { kind: "all", conds: [was, turn] } : was, subject: { sel } };
    }
  }
  // "If your Leader's back side is {Name}", "… is a black <Goku> card" (22-2-5).
  if ((m = /^your leader(?: card)?'s back side is (.+)$/.exec(t))) {
    const parts = splitDisjunction(m[1]);
    if (parts.length > 1) {
      const conds = parts.map((part) => ({
        kind: "leaderMatches" as const,
        filter: parseFilter(part),
        back: true,
      }));
      return { cond: { kind: "any", conds }, subject: { sel: { special: "leader" } } };
    }
    return { cond: { kind: "leaderMatches", filter: parseFilter(m[1]), back: true }, subject: { sel: { special: "leader" } } };
  }
  // "If {Son Goku, Hero} is in play in your Unison Area", "if your <Vegeta>
  // card is in play", "if a <Bulma> card is in your Combo Area" — the card
  // first, then where it has to be: a count of at least one.
  if ((m = /^(.+?) (is|isn't|is not) in (?:play(?: in your (\w+) area)?|your (\w+) area)$/.exec(t))) {
    const sel = parseTarget(m[1]);
    const areaWord = (m[3] ?? m[4])?.toLowerCase();
    const area = areaWord === "unison" ? "unison" : areaWord === "battle" ? "battle" : areaWord === "combo" ? "combo" : areaWord === "leader" ? "leader" : areaWord ? null : "play";
    if (sel && area) {
      delete sel.count;
      delete sel.upTo;
      const counted: Selector = { ...sel, area, side: sel.side ?? "you" };
      return { cond: m[2] === "is" ? { kind: "count", sel: counted, atLeast: 1 } : { kind: "count", sel: counted, atMost: 0 }, subject: { sel } };
    }
  }
  // "If you don't have a Unison in play", "if you don't have any Battle Cards in play".
  //
  // And the same sentence about the other player: "if **your opponent doesn't
  // have** a Unison Card in play". The positive form is read by
  // `parseCountCondition` for either player, but the negative auxiliary was
  // only ever read for "you" — so BT29-047's "if your Leader is a green
  // <Lucifer> card **and your opponent doesn't have a Unison in play**" lost
  // the second half of its condition and offered the play in exactly the
  // situation the card forbids. BT10-003 and BT15-062b lost theirs too, though
  // those only cost a gap.
  if ((m = /^(?:(you) don'?t|(your opponent) does\s?n'?o?t) have (?:an?|any) (.+?)(?: in play)?$/.exec(t))) {
    const whose = m[1] ? "your" : "your opponent's";
    const what = m[3];
    const sel = parseTarget(`${whose} ${what}`) ?? parseTarget(`${whose} ${what} card`);
    if (sel) {
      delete sel.count;
      delete sel.upTo;
      return { cond: { kind: "count", sel, atMost: 0 } };
    }
  }
  const counted = parseCountCondition(t);
  if (counted) return { cond: counted };
  // Several conditions joined; "and" binds tightly.
  const both = t.split(new RegExp(`,? and ${JOIN.source}`));
  if (both.length > 1) {
    const conds = both.map((part) => parseConditionClause(part, true)?.cond ?? null);
    return conds.every((x) => x) ? { cond: { kind: "all", conds: conds as Cond[] } } : null;
  }
  return null;
}

/**
 * "If you have 2 or more Battle Cards in play in Rest Mode", "if there are 5
 * or more cards in your Warp", "if there are no cards in your opponent's
 * Combo Area" — one shape, many areas, and the target phrase after the number
 * is the same grammar every other clause uses.
 */
function parseCountCondition(t: string): Cond | null {
  // "a Battle Card" and a bare plural both mean "at least one"; "no" means none.
  // The sets print the contraction as readily as the long form — "**if
  // there's** a Blue/Yellow multicolor card in your energy" — and only "there
  // is" was read. Seven skills say it, and what it cost was not the condition
  // but the whole skill: BT15-146's combo-cost reduction was simply always on
  // until a refused condition started taking its clause with it, and is now
  // simply refused. Nothing else about those sentences was ever the problem —
  // "blue/yellow multicolor card" reads perfectly well.
  //
  // "You have **only** 3 or less cards other than this card in your hand" is
  // the same kind of miss one word further along: the adverb sits where the
  // number is expected, so no count was read at all and the whole tail became
  // the description — which then failed and left `atLeast: 1`, turning a gate
  // that asks for a nearly empty hand into one that holds almost always
  // (BT2-032, BT2-006).
  const m = /^(?:you have|your opponent has|there(?: (?:are|is)|'s|'re)) (?:only )?(?:(no)|(?:an?|any) |(\d+) or (more|less|fewer) )?(.+)$/.exec(t);
  if (!m) return null;
  const [, none, num, dir, rest] = m;
  // "you have" / "your opponent has" says whose cards, which the phrase after
  // the number usually does not repeat.
  const mine = /^you have/.test(t);
  const theirs = /^your opponent has/.test(t);

  const parts = splitDisjunction(rest);
  if (parts.length > 1) {
    const trailingAreaMatch = /\s+(in (?:play(?: in (?:a|an|the|your|your opponent's) [a-z- ]*area)?|(?:a|an|the|your|your opponent's) [a-z- ]+? area|(?:your|your opponent's) (?:drop|warp|hand|energy|deck|life|combo|battle|unison|z-deck|z-energy)|play))$/i.exec(parts[parts.length - 1]);
    const trailingArea = trailingAreaMatch ? trailingAreaMatch[1] : null;

    const conds: Cond[] = [];
    for (let i = 0; i < parts.length; i++) {
      let part = parts[i];
      if (trailingArea && !/\bin (?:play|your|your opponent's)/i.test(part)) {
        part = `${part} ${trailingArea}`;
      }
      const phrase = mine ? `your ${part}` : theirs ? `your opponent's ${part}` : part;
      const sel = parseTarget(phrase);
      if (!sel) return null;
      delete sel.count;
      delete sel.upTo;
      if (none) conds.push({ kind: "count", sel, atMost: 0 });
      else if (!num) conds.push({ kind: "count", sel, atLeast: 1 });
      else conds.push({ kind: "count", sel, ...(dir === "more" ? { atLeast: Number(num) } : { atMost: Number(num) }) });
    }
    return { kind: "any", conds };
  }

  const phrase = mine ? `your ${rest}` : theirs ? `your opponent's ${rest}` : rest;
  const sel = parseTarget(phrase);
  if (!sel) return null;
  // A count reads the whole area, not one card out of it.
  delete sel.count;
  delete sel.upTo;
  if (none) return { kind: "count", sel, atMost: 0 };
  if (!num) return { kind: "count", sel, atLeast: 1 };
  return { kind: "count", sel, ...(dir === "more" ? { atLeast: Number(num) } : { atMost: Number(num) }) };
}
