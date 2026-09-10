import { parseFilter, type CardFilter } from "../filters";
import type { ScriptArea, Selector, Side } from "../script";
import { TWO_NAMED_CARDS } from "./clauses";

// ── target phrases ─────────────────────────────────────────────────────────

export const AREA_WORDS: [RegExp, ScriptArea][] = [
  // "In your opponent's Drop" was the one possessive this line did not admit —
  // `in your` matched, then `drop` did not follow — so "up to 1 Battle Card in
  // your opponent's Drop" fell through to the Battle Area and chose a card in
  // play instead. Every other area word here already reads the possessive.
  [/\bin (?:your|their|its owner's|an?) (?:own )?drop\b|\bdrop area\b|\bfrom your drop\b|\b(?:your |an? )?opponent'?s drop\b|\btheir drop\b/, "drop"],
  // "Your blue energy", "your opponent's rested energy": the adjectives sit
  // between the possessive and the word, and "energy cost" is not an area.
  // The adjectives between the possessive and the word include the slash of
  // "your **Red/Blue multicolor** energy", which the class did not admit — so
  // six cards that rest a multicolour energy went looking on the table for it.
  [/\benergy area\b|(?<!equal to )\b(?:your opponent's|their|your)(?: [a-z/-]+)* energy\b(?! cost)/, "energy"],
  [/\bfrom your hand\b|\bin your hand\b|\btheir hand\b|\byour hand\b|\byour opponent's hand\b/, "hand"],
  [/\bfrom your deck\b|\bin your deck\b|\byour deck\b|\byour opponent'?s deck\b|\btheir deck\b/, "deck"],
  // "Flip up to 1 card in your opponent's life face up" (BT12-069/070): the
  // possessive is what `parseTarget` reads as the side, so the area word has
  // to admit it or the phrase names no area at all.
  [/\bin your life\b|\bfrom your life\b|\byour life\b|\byour opponent'?s life\b|\btheir life\b|\blife area\b/, "life"],
  [/\bwarp\b/, "warp"],
  [/\bcombo area\b/, "combo"],
  [/\bunison area\b/, "unison"],
  [/\bz-deck\b/, "zDeck"],
  [/\bz-energy\b/, "zEnergy"],
  [/\bunder this card\b/, "under"],
  // Naming both areas is how the text says "on the table" (20-1-6), and it
  // has to be read before either area alone — otherwise "in your Battle Area
  // or Leader Area" becomes a Battle Area holding a Leader, which is nothing.
  [/\b(?:battle|leader) area or (?:battle|leader) area\b/, "play"],
  [/\bleader area\b/, "leader"],
  [/\bbattle area\b/, "battle"],
  // Noun card types when no explicit area preposition was named
  [/\bleader cards?\b|\byour leaders?\b/, "leader"],
  [/\bbattle cards?\b/, "battle"],
  [/\bunison cards?\b|\bunisons\b/, "unison"],
  // 20-1-6: an unqualified "cards" means the Leader Area and the Battle Area.
  [/\b(?:your|their|opponent's) (?:[a-z-]+ )*cards\b/, "play"],
];

/**
 * Area words as the cards print them, for the phrases that name two of them
 * ("from your deck or Drop Area"). Only used for that: the single-area case is
 * `AREA_WORDS` above, which reads far more wordings.
 */
const AREA_NAMED: Record<string, ScriptArea> = {
  hand: "hand",
  deck: "deck",
  drop: "drop",
  "drop area": "drop",
  warp: "warp",
  life: "life",
  energy: "energy",
  "energy area": "energy",
  "battle area": "battle",
  "z-deck": "zDeck",
  "z-energy": "zEnergy",
};
// "In **your opponent's** Battle Area or Drop": the possessive sits where the
// first area word was expected, so the pair went unread and the phrase fell
// through to whichever single area matched first.
const AREA_PAIR_RE = /\b(?:in|from|of|into) (?:your|their)(?: opponent'?s)? ((?:z-)?[a-z]+(?: area)?) or (?:(?:from|in) )?(?:the )?(?:your |their )?(?:opponent'?s )?((?:z-)?[a-z]+(?: area)?)\b/;

/**
 * "…in all of your areas" (3-1-1): every area a player has, rather than one of
 * them. "Removed from the game" is not an area, and the pile under a card is
 * the host's area rather than one of its own, so neither is here.
 */
const ALL_AREAS: ScriptArea[] = ["leader", "battle", "unison", "combo", "energy", "hand", "deck", "drop", "life", "warp", "zDeck", "zEnergy"];
/**
 * The phrase that names them all. Both of its words mislead the rest of
 * `parseTarget`, which is why it is taken off the phrase rather than left for
 * `AREA_WORDS`: "areas" is not an area word, so "each <Son Goku> and <Vegeta>
 * in all of your areas" fell through to the 20-1-6 default of the table and a
 * Leader's colour grant reached nothing in hand, energy or drop; and the "all"
 * in it reads as a count. The possessive is kept, because on BT2-001 it is the
 * only thing in the phrase that says whose cards these are.
 */
const ALL_AREAS_RE = /\bin all (?:of )?(your |their |its owner's )?areas\b/;

/**
 * "…in areas other than your deck, hand, or life" (BT7-125 through BT7-129,
 * one per colour): every area *except* the ones it lists. The list is the one
 * part of the phrase that must not be read as the place to look, and
 * `AREA_WORDS` is first-match-wins, so it read "your deck" — the exact inverse
 * of what the card says, and a mono-colour lock that checked the pile the
 * cards are least likely to be in. `Selector.areas` states a span, so the
 * complement is written out.
 *
 * Only "in", never "from": "when a card is placed in your life face up **from**
 * any area other than your life" (BT12-023) is a trigger saying where the card
 * came from, not a description of cards, and it is not this phrase.
 */
const AREAS_OTHER_THAN_HEAD_RE = /\bin (?:any |all )?areas? other than /i;
/** The "or" of that list is a separator, not the shortest area word there is. */
const AREA_LIST_SEP = /\s*,\s*or\s+|\s*,\s*|\s+or\s+/;
const AREA_NAME_RE = /^(?:your |their |its owner's |an? owner's |the )?(?:z-)?[a-z]+(?: area)?/i;

function parseAreasOtherThan(text: string): { matched: string; listed: ScriptArea[] } | null {
  const head = AREAS_OTHER_THAN_HEAD_RE.exec(text);
  if (!head) return null;
  const rest = text.slice(head.index + head[0].length);
  const named: string[] = [];
  let at = 0;
  while (at < rest.length) {
    while (/\s/.test(rest[at] ?? "")) at++;
    const area = AREA_NAME_RE.exec(rest.slice(at));
    if (!area) break;
    named.push(area[0]);
    at += area[0].length;
    const sep = AREA_LIST_SEP.exec(rest.slice(at));
    if (!sep || sep.index !== 0) break;
    at += sep[0].length;
  }
  if (!named.length) return null;
  const listed: (ScriptArea | null)[] = named.map((w) => AREA_NAMED[w.replace(/^(?:your |their |its owner's |an? owner's |the )/i, "").trim().toLowerCase()] ?? null);
  if (listed.some((area) => area === null)) return null;
  return { matched: text.slice(head.index, head.index + head[0].length + at), listed: listed as ScriptArea[] };
}

/**
 * "up to 2 of your opponent's Battle Cards in Rest Mode" → a selector.
 *
 * `looked` is the variable a `look` earlier in the same skill bound, for the
 * clauses that pick out of what was just looked at without saying so — see the
 * "add … to your hand" rule in `compileClause`. It is passed only once the
 * caller has established that the phrase names no area of its own, so it can
 * never overrule an area the text actually printed.
 *
 * `pool` is the weaker claim, and the ordinary one: the cards a look or a
 * reveal is holding out, which this phrase draws from **only if it says so**.
 * Until 9 Sep 2026 no caller passed either, so a phrase that did say so was
 * given the literal name `"looked"` — right after a look, and a variable
 * nothing had bound after a reveal, which is a choice with no candidates
 * (BT13-024, BT6-074).
 */
export function parseTarget(phrase: string, looked?: string, pool?: string): Selector | null {
  // "1 <Android 17> card and 1 <Hell Fighter 17> card—both green and with
  // energy costs of 1—from your deck and/or Drop", "choose up to 1 red <Son
  // Goku: Br> card and 1 red <Vegeta: Br> card from your Drop Area and add
  // them to your hand": `andJoinsTwoNamedCards` (in `splitClauses`) keeps a
  // two-named-card search whole instead of cutting it at the "and" and losing
  // one name — but nothing here can yet search for two different names from
  // one shared source. Read as a single filter, "name A or name B" is not the
  // same target as "one of A *and* one of B": it is satisfied, and stops
  // looking, the moment it finds either — a card fewer than the text promises
  // rather than a name lost outright, but still not what the card says
  // (BT20-077, BT20-079, BT24-123, EB1-32, BT19-032, BT6-012, BT7-051, and the
  // "choose … and add/send them" family beside them). Refused whole rather
  // than guessed at (ground rule 5); a two-name search is a primitive of its
  // own, not built.
  if (TWO_NAMED_CARDS.test(phrase)) return null;
  let t = phrase.toLowerCase();
  // Qualifiers this grammar does not read, and cannot afford to drop: they
  // narrow a phrase to a handful of cards by their *history* — which cards
  // this very skill moved — rather than by anything a selector can describe,
  // and every rule below would quietly hand back the whole area instead.
  // "Negate the skills of all cards **sent to Warps by this skill**" (EX21-15,
  // BT13-096) is every card in the Warp, both of them permanent.
  //
  // Refusing is ground rule 5: the clause goes to the referee, which is what
  // the card needs anyway.
  if (/\bby this skill\b|\bsent to\b/.test(t)) return null;
  // "The card on top of this card" (23-2), and the descriptions that name it:
  // "the <Majin Buu> on top of this card", "the Leader on top of this card",
  // "Battle Cards on top of this card". A pile is one card with everything
  // else beneath it, so this names exactly one card and `onTop` is it.
  //
  // Only the phrase that *ends* there is read. Every other use of the words is
  // a destination — "play up to 1 green <Piccolo> card with an energy cost of
  // 4 **on top of this card** from your deck" — where the same reading would
  // point the search at the card above instead of naming where the card goes,
  // and those stay refused with the history phrases above. That is why the
  // guard was written whole in the first place; this is the half of it that
  // has a target to be read into.
  // "The card **above** this card" is the same card in other words (BT20-017,
  // BT20-019, BT20-091, BT20-092), and read as *this card* until 9 Sep 2026 by
  // the same shortcut — BT20-091 gave itself the [Barrier] it grants upward.
  const onTop = /^(?:(?:the|a|an|each|all|any)\s+)?(.*?)\s*(?:on top of|above) this card$/i.exec(phrase.trim());
  if (onTop) {
    // What comes before the words has to be a *description* and nothing more.
    // BT21-032 prints "choose up to 1 of your opponent's Battle Cards with
    // power less than or equal to the card on top of this card, then KO it":
    // the phrase ends in these words while naming an opponent's card measured
    // against the one above, and read whole it KO'd the card on top — your own
    // <Son Goku>. A comparison or a second owner means the words are a measure
    // inside a longer phrase, not the head of it, and the clause goes to the
    // referee (ground rule 5).
    if (/\bthan\b|\bequal to\b|\bopponent|\bof (?:your|their)\b|\bup to \d/.test(onTop[1])) return null;
    const above = filterFor(onTop[1] || "card", null);
    return above === null ? null : { special: "onTop", filter: above };
  }
  if (/\bon top of\b/.test(t)) return null;
  // "From under your <Kefla> Battle Card", "from under your Leader Card", and
  // "cards under {King Kai's Planet}" — the pile under *another* card.
  // "under this card" is the existing self-hosted area and is read below.
  let underHostSel: Selector | undefined;
  if (/\bunder\b/.test(t) && !/\bunder (?:this card|it)\b/.test(t)) {
    const underHost = /\b(?:from\s+)?under\s+(.+?)\s*$/i.exec(phrase.trim());
    if (!underHost) return null;
    // Ground rule 5: if the host phrase itself is unreadable, refuse rather
    // than reading the target into the wrong card again.
    underHostSel = parseTarget(underHost[1].replace(/[,.]\s*$/, "").trim()) ?? undefined;
    if (!underHostSel) return null;
    phrase = phrase.replace(underHost[0], " ");
    t = phrase.toLowerCase();
  }
  // "Each non-Leader card under this card" is about the stack; the "this card"
  // "Each non-Leader card under this card" is about the stack; the "this card"
  // in it names the host, not the target (23-2). Read before the shortcut
  // below, which took the whole phrase for the card on top.
  //
  // The rest of the phrase is then read as usual: "**each** card under this
  // card" and "**up to 1** card from under this card" are the same area and
  // different counts, and hard-coding "all" here played every card in the pile.
  const underSelf = /\bunder (?:this card|it)\b/.test(t) && !/^this card\b/.test(t.trim());
  if (underSelf) {
    phrase = phrase.replace(/\b(?:from )?under (?:this card|it)\b/gi, " ");
    t = phrase.toLowerCase();
  }
  // "Each <Son Goku> and <Vegeta> **in all of your areas**": the phrase names
  // every area rather than one, and has to come off before anything else reads
  // the words in it. See `ALL_AREAS_RE`.
  const allAreas = ALL_AREAS_RE.test(t);
  if (allAreas) {
    phrase = phrase.replace(new RegExp(ALL_AREAS_RE.source, "gi"), (_full, poss?: string) => ` ${poss ?? ""} `);
    t = phrase.toLowerCase();
  }
  // "…in areas other than your deck, hand, or life": the same, said as a
  // complement. See `AREAS_OTHER_THAN_RE`.
  const otherThan = parseAreasOtherThan(phrase);
  let otherAreas: ScriptArea[] | null = null;
  if (otherThan) {
    otherAreas = ALL_AREAS.filter((a) => !otherThan.listed.includes(a));
    phrase = phrase.replace(otherThan.matched, " ");
    t = phrase.toLowerCase();
  }
  // "this card's power" inside a phrase is a measure, not the target.
  // "…**except for** this card" is "other than this card" said the other way,
  // and reading it as a mention rather than an exclusion sent the phrase down
  // this shortcut: BT1-086's "place all Rest Mode Battle Cards except for this
  // card in the Drop Area" came back as *self*, so the card dropped itself and
  // left every card it was aimed at standing.
  if (/\bthis card\b(?!'s)/.test(t) && !/\bother\b|\bexcept\b|\bbesides\b/.test(t)) return { special: "self" };
  if (/\bthe attack(?:ing)? card\b/.test(t)) return { special: "attacker" };
  if (/\bthe guard card\b/.test(t)) return { special: "guard" };
  // "Your opponent's Leader", "your Leader Card": a player has exactly one
  // (3-1-2), so this names a card rather than describing a search — and the
  // engine already has both of them as specials.
  //
  // Without this the phrase named no area at all: `AREA_WORDS` reads "leader
  // card**s**" and "**your** leader", and "your opponent's Leader" is neither,
  // so it fell through to the 20-1-6 default of the whole play area and the
  // clause aimed at *any one card the opponent has on the table* — a Battle
  // Card as readily as the Leader. Only the bare phrase is read this way: once
  // it says more ("your opponent's Leader in Rest Mode"), it goes on to the
  // area grammar as before, which reads the extra words.
  if (/^(?:(?:the|that|your|their|an?) )?(?:(?:the |your |an? )?opponent'?s )?leader(?: cards?)?$/.test(t.trim())) {
    return { special: /\bopponent|\btheir\b/.test(t) ? "opponentLeader" : "leader" };
  }
  // "1 Battle Card with an energy cost of 2 or less being played by your
  // opponent" is the card the [Counter: Play] is answering, and there is only
  // ever one of those — reading it as a choice asked for a card in play, which
  // is a different card entirely (9-6).
  if (/\bbeing played\b/.test(t)) {
    const being = filterFor(phrase, null);
    return being === null ? null : { special: "resolving", filter: being };
  }

  // "All **other** Battle Cards", "all other cards in your Battle Area": the
  // adjective rules out the card the skill is on, which is exactly `notSelf`.
  // Read as nothing, a clause that bounced or silenced every Battle Card did
  // it to this one too — and on the two [Permanent]s that print
  // "negate the skills of all other Battle Cards" that is the card negating
  // itself. "Other than this card" is the same thing spelled out and is read
  // below; "each other player" is a player, not a card.
  const otherAdj = /\bother\b/.test(t) && !/\bother than\b/.test(t) && !/\bother player/.test(t);

  let side: Side = "you";
  // The sets write the possessive four ways — "your opponent's", "an
  // opponent's", "the opponent's", and once "ofyour opponent's" (a typo in the
  // catalog itself) — so the word is matched with whatever leads up to it.
  //
  // The oldest sets drop the possessive altogether: "choose up to 1 opponent
  // Battle Card and KO that card" (BT1–BT3, EX01–EX02, P-006). Read as naming
  // no side, all sixteen of those chose *your own* card and KO'd, rested or
  // returned it — the wrong-effect failure ground rule 1 is about, and the
  // opposite of what the card says. Only the attributive form is read that
  // way: a bare "an opponent discards a card" is a player, not a card.
  // "Choose all of **your** Battle Cards with <Son Goku> in **their**
  // character names": the possessive in the tail belongs to the *cards*, not
  // to a player, and reading it as a player handed sixteen skills the
  // opponent's board — BT22-086 giving +5000 power to the cards it was meant
  // to be fighting. The phrase says whose cards these are once, at the front.
  // "…to **their owner's** Drop Area" is the idiom for every card going back to
  // whoever owns it (2-4), and it is printed on 113 skills. Read by the bare
  // "their" below it made the phrase say *opponent*, and worse, it said so
  // about the **source** — the possessive sits in the destination half of the
  // sentence, so "play up to 4 ≪Saiyan≫ cards from **your** Warp into their
  // owner's Drop" went looking in the opponent's Warp (BT27-015, and BT29-095,
  // BT29-108, P-710 the same way). Stripped like the name phrases beside it,
  // because it says nothing about whose cards are being chosen.
  //
  // When no area was matched (20-1-6), `owner` is scanned as a fallback. We strip
  // phrases where "their" refers to card traits, names, or owners rather than
  // the player owning the cards. Destination area phrases no longer need stripping
  // here because `areaPhrase` is structurally scoped to the source area match.
  const owner = t
    .replace(/\bin their (?:character names|card names|special traits)\b/g, " ")
    .replace(/\btheir owners?'?s?\b/g, " ");
  // "Choose **all** Battle Cards" names no owner, and a card that names none
  // is every one of them (the sets say "all other Battle Cards **you
  // control**" when they mean only yours). The default of `you` is right for
  // an unqualified singular — "choose 1 Battle Card" is your own — but wrong
  // for a sweep, and it made a board wipe clear only the caster's own side.
  //
  // Until 9 Sep 2026 this covered only the phrases saying "other", which left
  // nine sweeps reading as the caster's own board. Five of them say otherwise
  // outright: "ignoring [Barrier]" is dead text unless the choice reaches the
  // opponent, 22-16-2 defining the keyword against "the skills of cards
  // mastered by your opponent" (BT7-110, BT6-018, BT8-137, SD22-02), and
  // BT7-037's "then all players who returned cards to their decks shuffle"
  // presupposes both did. The other four carry no such tell and no Bandai Q&A
  // entry, and are the owner's ruling of 9 Sep 2026, recorded on their rows:
  // BT21-023, BT19-096, BT1-086, TB1-015. BT1-086 was the worst reading in the
  // catalog — "place all Rest Mode Battle Cards except for this card in the
  // Drop Area" read as "move this card to drop", so the card dropped itself
  // and nothing else.
  //
  // Anything printing "your", "their", "opponent" or "you control" keeps the
  // side it just read: "all Battle Cards **in your Drop Area**" (BT7-126) and
  // "all Battle Cards **in your energy**" (BT25-145) are the caster's own.
  // "All" counts only where it is the determiner of the cards — "all Battle
  // Cards", not "―all in Rest Mode―". EX25-35 prints "choose all of your
  // opponent's skill-less Battle Cards **and** Battle Cards with 15000 power
  // or less ―all in Rest Mode―", whose second half arrives here as a fragment
  // with the possessive left behind in the first; its "all" governs a
  // preposition, and taking it would sweep both boards for a rest-lock the
  // card aims at one. That clause reads wrongly either way, and the narrower
  // wrong is the one to leave standing (ground rule 5). The phrase still
  // carries the verb that chose the cards, so this cannot anchor to the front.
  const sweep = /\ball\s+(?!in\b|of\b|the following\b)[a-z]/.test(t) || /\bin all battle areas\b/.test(t);
  // A possessive inside the exclusion belongs to the card being ruled *out*,
  // not to the cards being chosen: TB1-015's "all Battle Cards with 25000 or
  // less power other than this card **or your <Caulifla>**" sweeps both boards
  // and spares one of yours, so the "your" in it must not hold the sweep to
  // your own side.
  const chosen = t.replace(
    /\b(?:other than|except for|besides) (?:copies of )?(?:this card|it)?(?:\s*(?:,|and\/or|and|or)\s*)?(?:(?:your |their |its owner's )?(?:<[^>]+>|≪[^≫]+≫|\{[^}]+\})(?:\s*(?:,|and\/or|and|or)\s*)?)*/g,
    " ",
  );

  // "Your opponent's Battle Cards or Unisons" names two areas at once, which
  // is the one such phrase the game prints often enough to be worth reading.
  const bothAreas = /\bbattle cards?\b[^.]*\b(?:or|and)\b[^.]*\bunisons?\b|\bunisons?\b[^.]*\b(?:or|and)\b[^.]*\bbattle cards?\b/.test(t);

  // "…from your deck or Drop Area", "…in your hand or Warp": a second area
  // joined by "or". `AREA_WORDS` is first-match-wins, so the second one was
  // dropped and the search quietly looked in half the places it should. The
  // catalog prints sixteen such pairs in both orders, so they are read from a
  // table of the area words rather than listed one by one.
  const tTarget = t.replace(/\b(?:for each|for every)\b.*$/, "");
  const both = AREA_PAIR_RE.exec(tTarget) ?? AREA_PAIR_RE.exec(t);
  const pair: [ScriptArea, ScriptArea] | null = both && AREA_NAMED[both[1]] && AREA_NAMED[both[2]] && AREA_NAMED[both[1]] !== AREA_NAMED[both[2]] ? [AREA_NAMED[both[1]], AREA_NAMED[both[2]]] : null;

  let area: ScriptArea | null = null;
  let areaMatch: RegExpExecArray | null = null;
  if (!allAreas && !otherAreas) {
    for (const [re, a] of AREA_WORDS) {
      const match = re.exec(tTarget);
      if (match) {
        area = a;
        areaMatch = match;
        break;
      }
    }
    if (!areaMatch) {
      for (const [re, a] of AREA_WORDS) {
        const match = re.exec(t);
        if (match) {
          area = a;
          areaMatch = match;
          break;
        }
      }
    }
  }
  // The owner is part of the phrase naming the selected area, not necessarily
  // the whole clause: destinations, measures and names routinely carry another
  // player's possessive. When an area (or area pair) is matched, the side comes
  // from the phrase up to and including that area. The whole-clause scan is kept
  // ONLY as a fallback when no area was named ("your opponent's cards", 20-1-6).
  const targetMatch = pair ? both : areaMatch;
  const areaPhrase = targetMatch && t.slice(0, targetMatch.index + targetMatch[0].length);
  const areaOwners = areaPhrase?.match(/\b(?:your opponent'?s|an opponent'?s|the opponent'?s|opponent'?s|opponent|your|their)\b/g);
  const areaOwner = areaOwners?.[areaOwners.length - 1];
  if (areaOwner) {
    if (/opponent|\btheir\b/.test(areaOwner)) side = "opponent";
    else if (areaOwner === "your") side = "you";
  } else if (!targetMatch) {
    if (/\bopponent'?s\b|\byour opponent\b|\btheir\b/.test(owner)) side = "opponent";
    else if (/\bopponent (?:rest mode |active mode |skill-less )?(?:battle|unison|extra|leader|z-battle|z-extra)s?\b/.test(t)) side = "opponent";
  }
  if (/\ball players\b|\beach player\b|\bboth players\b/.test(t)) side = "both";
  if ((otherAdj || sweep) && !/\byour\b|\btheir\b|\bopponent\b|\byou control\b/.test(chosen)) side = "both";
  // "among them" / "of those cards" keeps working on what was just looked at.
  //
  // "**From it**" is the same phrase after a reveal, and the nineteen cards
  // that reveal a hand are where it is printed: "your opponent reveals their
  // hand. Choose up to 1 card with an energy cost of 7 or less **from it** and
  // discard it" (BT16-005) named no area at all, so 20-1-6's "an unqualified
  // card is one on the table" took over and the card discarded was **your
  // own**. Only when a pool exists — with nothing held out, "it" is a pronoun
  // for a later clause to answer and there is no area here to read it as.
  const seen = looked ?? pool;
  const namesPool = /\bamong them\b|\bof those cards\b|\bfrom among them\b|\bof them\b/.test(t) || (!!seen && /\bfrom it\b/.test(t));
  const fromVar = namesPool ? (seen ?? "looked") : looked;
  // "Choose 1 of your <Majin Buu>" names no area, but 20-1-6 says an
  // unqualified card is one on the table. Without this the choice fails, and
  // then every later "it" in the same skill has nothing to point at.
  if (!allAreas && !area && !fromVar && filterFor(phrase, null)) area = "play";
  // The pile under a card is the area, and it was named by words that have
  // already been taken off the phrase.
  if (!allAreas && !area && !fromVar && !underSelf && !underHostSel) return null;

  let count = 1;
  let upTo = false;
  let m: RegExpExecArray | null;
  if ((m = /\bup to (\d+)\b/.exec(t))) {
    count = Number(m[1]);
    upTo = true;
  } else if (/\ball\b|\bevery\b|\beach\b/.test(t)) {
    count = 99;
    // A digit inside a name is part of the name, not a count: ≪Universe 6≫,
    // <Android 17>, {Ultimate Form Gohan 2}. Read as a number, "your ≪Universe
    // 6≫ cards in your hand" became six of them — the silent mis-read ground
    // rule 5 is about, and it sized every selector naming one of those.
  } else if (
    (m = /\b(\d+)\b/.exec(
      t
        .replace(/<[^>]*>|≪[^≫]*≫|\{[^}]*\}/g, " ")
        .replace(/\d+000\b/g, "")
        .replace(/energy cost (?:of )?\d+/g, "")
        .replace(/\bz-\d/g, ""),
    ))
  ) {
    count = Number(m[1]);
  } else if (/\bcards\b|\benergy\b/.test(t)) {
    // A plural with no number means all of them: "your Battle Cards get +5000 power".
    count = 99;
  }

  // "The top card of your deck", "the bottom 2 cards of their deck": a
  // position, not a choice. 20-12 only lets a player pick out of a secret area
  // when the text says to look, so reading these as a choice would hand the
  // whole deck over.
  let take: number | undefined;
  let fromEnd: boolean | undefined;
  const end = /\bthe (top|bottom) (?:(\d+) )?cards?\b/.exec(t);
  if (end) {
    take = end[2] ? Number(end[2]) : 1;
    if (end[1] === "bottom") fromEnd = true;
  }

  // Which mode the cards must be in. The sets say it two ways and only the
  // prepositional one was read: "1 of your opponent's Battle Cards **in Rest
  // Mode**" and "1 of your opponent's **Rest Mode** Battle Cards" are the same
  // card, and seventy skills print the second. Read without it, BT23-109's
  // "choose up to 1 of your opponent's Rest Mode Battle Cards and KO it" was
  // offered every Battle Card the opponent had — a KO aimed at a card that had
  // already attacked, pointed at whatever you liked.
  //
  // The mode words also name a *destination* — "switch this card **to** Rest
  // Mode", "play it **in** Rest Mode" — which is not a description of what to
  // pick. The attributive reading is therefore taken only in front of a noun,
  // where a destination never stands.
  const modeSaid = (which: "rest" | "active"): boolean =>
    new RegExp(`\\bin ${which} mode\\b|\\b${which} mode (?:[a-z-]+ )*cards?\\b`).test(t);
  const mode = modeSaid("rest") ? "rest" : modeSaid("active") ? "active" : undefined;
  // 23-5: "Hidden Mode" is a card's face-down state, not the active/rest
  // orientation `mode` reads — a card is one of Active or Rest *and*
  // separately Hidden or Revealed (`inst.hidden` is its own flag in
  // `CardInstance`, not a third value of `mode`). Same two spellings as
  // above ("1 of your **Hidden Mode** cards", "1 of your energy **in Hidden
  // Mode**"), read only when nothing else narrows the choice: a face-down
  // card has none of its front-side information (23-5-2), so a selector
  // combining Hidden Mode with a colour, character or trait cannot be
  // answered and is refused below rather than quietly widened to "any card"
  // (ground rule 5) — the catalog does not print that combination today, but
  // this is the seam where it would appear.
  const hiddenSaid = /\bin hidden mode\b|\bhidden mode (?:[a-z-]+ )*(?:cards?|energy)\b/.test(t);
  // "Choose all Battle Cards **other than this card**" — the card the phrase
  // rules out. Read as nothing it stayed among the candidates, so a clause
  // that shrank every Battle Card shrank this one too.
  const excluded = /\b(?:other than|except for|besides) (copies of )?this card\b/.exec(t);
  const notSelf = excluded ? (excluded[1] ? "copies" : "card") : otherAdj ? "card" : undefined;
  const filter = filterFor(phrase, area);
  // A description the parser could not read is not a target: the clause fails
  // and the skill goes to the referee, rather than selecting the whole area.
  if (filter === null) return null;
  // A face-down card carries none of the information `filter` would check
  // (23-5-2) — "Hidden Mode" combined with anything else is not a choice this
  // engine can answer, and refusing it beats reading "Hidden Mode" away and
  // offering every card the other measure matches (ground rule 5).
  if (hiddenSaid && filter) return null;
  const hidden = hiddenSaid || undefined;
  if (underSelf || underHostSel) return { side: "you", area: "under", underHost: underHostSel, filter, count, upTo, mode, hidden, notSelf };
  // No single `area` stands for all of them, and leaving one on would be read
  // as the place the cards must be — so the span is the only thing said.
  if (allAreas) return { side, areas: ALL_AREAS, filter, count, upTo, mode, hidden, notSelf };
  if (otherAreas) return { side, areas: otherAreas, filter, count, upTo, mode, hidden, notSelf };
  if (bothAreas) return { side, area: "battle", areas: ["battle", "unison"], filter, count, upTo, mode, hidden, fromVar, notSelf };
  if (pair) return { side, area: pair[0], areas: pair, filter, count, upTo, mode, hidden, fromVar, notSelf };
  return { side, area: area ?? undefined, filter, count, upTo, mode, hidden, fromVar, take, fromEnd, notSelf };
}

/**
 * What an [Auto]'s trigger clause said about the card it is *about*, when it
 * said more than "a card" (9-6-2).
 *
 * Only the shapes where the subject is unambiguous — the player playing a card
 * and the card being played or attacking. Anything else returns nothing, and a
 * trigger with no filter fires as it always did: an over-fire is bad, but a
 * *wrong* filter would stop a skill that should happen, which is worse.
 */
export function subjectFilterOf(trigger: string): CardFilter | undefined {
  const t = trigger
    .toLowerCase()
    .replace(/^\s*when\s+/, "")
    .replace(/[,.]\s*$/, "")
    .trim();
  const phrase =
    /^(?:your opponent|you) plays? (?:an?|1|up to \d+|\d+) (.+?)(?: (?:from|in|to|with|by) .*)?$/.exec(t)?.[1] ??
    // The word "card" stays in the phrase: taking it out of the capture let
    // the lazy group stop at "battle", and "battle" alone narrows nothing.
    /^(?:your|your opponent's) (.+?) is played\b/.exec(t)?.[1] ??
    /^(?:your|your opponent's) (.+?) attacks\b/.exec(t)?.[1] ??
    // "When your blue <Son Goku> card is KO'd" — the same question about the
    // card that just died (21-14).
    /^(?:your|your opponent's|an opponent's|one of your|one of your opponent's) (.+?) (?:is|are) ko'd\b/.exec(t)?.[1] ??
    null;
  // "A Battle Card **or** Unison Card" is two kinds, and `parseFilter` keeps
  // only one of them — which would stop the skill on the other. A filter that
  // is wrong in that direction is worse than no filter at all, so alternatives
  // are refused outright.
  if (!phrase) return undefined;
  // …but "an energy cost of 5 **or** less" is one bound, not two kinds, and
  // `parseFilter` reads it whole.
  if (/ or /.test(phrase.replace(/\b\d+ or (?:less|fewer|more|greater|higher|lower)\b/g, ""))) return undefined;
  // A trigger whose subject description cannot be read is left unfiltered
  // rather than failed: an over-fire is bad, a filter that stops a skill that
  // should happen is worse (ground rule 6).
  return filterFor(phrase, null) ?? undefined;
}


/** Only keep a filter when the phrase actually narrows the cards. */
/**
 * Three answers, and the difference between the last two is the whole point:
 * a `CardFilter` narrows the selection, `undefined` means the description said
 * nothing that narrows it, and **`null` means the description could not be
 * read** — a bracketed word that is neither a keyword nor a skill kind. Only
 * the first two may pass; `null` has to fail the clause, or "mono-blue cards
 * with a [Counter] skill" goes on choosing any mono-blue card (ground rule 5).
 */
export function filterFor(phrase: string, area: ScriptArea | null): CardFilter | null | undefined {
  const f = parseFilter(phrase);
  if (f.unreadable) return null;
  // In an area that only holds one kind of card, the type word is noise — and
  // it has to go before the question of whether anything narrows, or "your
  // Battle Cards" would count as narrowed by a word that means nothing there.
  if (area === "battle" && f.type === "BATTLE") f.type = null;
  if (area === "leader" && f.type === "LEADER") f.type = null;
  // "Play" spans both areas, so naming either type narrows nothing there.
  if (area === "play" && (f.type === "BATTLE" || f.type === "LEADER")) f.type = null;
  const narrows =
    f.type != null ||
    f.notType != null ||
    f.multiColor ||
    // "Place up to 1 red <Android 17> card from your deck under a Z-Extra":
    // being a Z-card is the only thing said about the host.
    f.z != null ||
    f.characters.length > 0 ||
    f.notCharacters.length > 0 ||
    f.traits.length > 0 ||
    f.notTraits.length > 0 ||
    f.names.length > 0 ||
    f.costMin != null ||
    f.costMax != null ||
    f.powerMin != null ||
    f.powerMax != null ||
    f.powerRel != null ||
    f.monoColor ||
    // A colour narrows an energy area as much as any other: "your blue energy"
    // is not "your energy".
    f.colors.length > 0 ||
    // A measure that says what a card must *not* be narrows just as much, and
    // leaving these off the list threw the whole filter away — so "2 non-black
    // Battle Cards" chose black ones as happily as any other.
    f.notColors.length > 0 ||
    f.notKeywords.length > 0 ||
    // Every measure has to be on this list, or a description whose *only*
    // measure is that one counts as saying nothing and the filter is thrown
    // away — the same silent widening the measures exist to prevent. These
    // four were each added without being listed here.
    f.keywords.length > 0 ||
    f.skillKind != null ||
    f.noKeywords ||
    f.notNames.length > 0 ||
    f.token ||
    f.notToken ||
    // A name asked for *in part* is a measure like any other, and these four
    // were the next ones added without being listed — so a description whose
    // only measure was one of them threw the whole filter away. "Choose up to
    // 1 of your Battle Cards **with <Son Gohan> in its character name**"
    // (BT19-130) chose any Battle Card you had: the type word is noise in the
    // Battle Area and is struck out above, which left nothing on this list at
    // all. `parseFilter` had read the name the whole time.
    f.charactersIncluding.length > 0 ||
    f.notCharactersIncluding.length > 0 ||
    f.namesIncluding.length > 0 ||
    f.notNamesIncluding.length > 0 ||
    f.faceUp;
  if (!narrows) return undefined;
  return f;
}
