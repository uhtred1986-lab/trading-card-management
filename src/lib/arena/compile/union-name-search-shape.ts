/**
 * #930: the words of a search for the characters the revealed card's
 * [Union-Fusion] needs (EX13-14, SD19-03), without reading any target — kept
 * apart from `union-name-search.ts` for the reason `named-set-shape.ts` is:
 * reading the target needs `targets.ts`, which needs `clauses.ts`.
 */
const MEASURE = "energy costs? (?:between \\d+ and \\d+|of \\d+(?: or (?:less|more))?)";
const SOURCE = "your (?:deck|drop(?: area)?)(?: and/or (?:your )?(?:deck|drop(?: area)?))?";
const FOR_EACH = new RegExp(
  `^for each character name required for the revealed card'?s \\[union(?:-fusion)?\\] skill, add up to (\\d+) ((?:battle )?cards?) with a matching character name and (?:an? )?(${MEASURE}) from (${SOURCE}) to your hand$`,
  "i",
);
const EACH_WITH = new RegExp(
  `^add up to (\\d+) ((?:battle )?cards?) each from (${SOURCE}) to your hand, each with a character name that matches the \\[union(?:-fusion)?\\] skill conditions of the revealed card and (?:an? )?(${MEASURE})$`,
  "i",
);

/** The words of one such clause, or `null`. */
export function unionNameSearchWords(clause: string): { n: number; noun: string; measure: string; source: string } | null {
  const t = clause.trim().replace(/[.]$/, "");
  let m = FOR_EACH.exec(t);
  if (m) return { n: Number(m[1]), noun: m[2], measure: m[3], source: m[4] };
  m = EACH_WITH.exec(t);
  if (m) return { n: Number(m[1]), noun: m[2], source: m[3], measure: m[4] };
  return null;
}

/** Where in a skill's text a clause of this shape lies, for `splitClauses` to leave whole. */
export function unionNameSearchSpans(text: string): [number, number][] {
  const out: [number, number][] = [];
  const start = /\b(?:for each character name required for the revealed card|add up to \d+ (?:battle )?cards? each from)/gi;
  for (let m = start.exec(text); m; m = start.exec(text)) {
    for (let end = m.index + 1; end <= text.length; end++) {
      const stops = end === text.length || ".;,".includes(text[end]);
      if (!stops || !unionNameSearchWords(text.slice(m.index, end))) continue;
      out.push([m.index, end]);
      start.lastIndex = end;
      break;
    }
  }
  return out;
}
