/**
 * The viewer-side half of `view.ts` (#641): the pieces of a board view that the
 * rules engine's projection (`vm/view.ts`) and `snapshot.ts` share. `view.ts`
 * re-exports every name here, so existing callers are unchanged; the
 * browser-safe entry (`browser.ts`) imports from here.
 *
 * Checked by `scripts/verify/arena-browser-boundary.mts`.
 */
import type { AbilityAvailability, ActionCost, LegalAction, PlayerId, RejectedAction, Requirement, Skill } from "./types";
import type { AbilityView, PermanentView, Tappable } from "./view";
import type { EngineState } from "./engines";
import type { GameDefinition } from "./rulesets/types";
import { vmRevealedTo } from "./vm/view";
import { rulesetFor } from "./rulesets";

const MANUAL_KEYWORDS = new Set([
  "Awaken", "Wish", "Evolve", "Union", "Over Realm", "Swap", "Arrival", "Successor",
  "Aegis", "Rejuvenate", "Overlord", "Field", "Z-Awaken",
]);

/** Serialize the engine's existing line identity and offer evidence without making a legality decision. */
export function abilityViews(input: {
  card: string;
  skills: Skill[];
  copied: Set<number>;
  zone: string;
  owner: PlayerId;
  controller: PlayerId;
  viewer: PlayerId;
  used: number[];
  pending: Set<number>;
  availability: AbilityAvailability[];
  decisionActor?: PlayerId | null;
  permanents: PermanentView[];
}): AbilityView[] {
  const bySkill = new Map(input.availability.filter((row) => row.card === input.card).map((row) => [row.skill, row]));
  return input.skills.map((skill) => {
    const evidence = bySkill.get(skill.index);
    const category: AbilityView["category"] = skill.kind.startsWith("activate:") || (skill.kind === "keyword" && !!skill.keyword && MANUAL_KEYWORDS.has(skill.keyword.name))
      ? "manual"
      : skill.kind === "auto" ? "automatic"
        : skill.kind === "permanent" ? "passive"
          : skill.kind.startsWith("counter:") ? "counter" : "keyword";
    const max = skill.oncePerTurn ? 1 : skill.limit;
    const used = input.used.filter((index) => index === skill.index).length;
    const offered = (evidence?.offers ?? []).map((offer) => offer.cost ? { label: offer.label, cost: offer.cost } : null);
    const costPreview: AbilityView["costPreview"] = category === "passive" || category === "keyword"
      ? { state: "notApplicable" }
      : offered.length > 0 && offered.every((offer): offer is { label: string; cost: ActionCost } => offer !== null)
        ? { state: "known", offers: offered }
        : category === "automatic" && !input.pending.has(skill.index)
          ? { state: "notApplicable" }
          : { state: "incomplete" };
    const permanent = input.permanents.find((row) => row.index === skill.index);
    const availability = evidence?.state ?? "notEvaluated";
    const notEvaluatedReason = evidence?.notEvaluatedReason ?? (availability === "notEvaluated" && category === "manual"
      ? input.decisionActor !== input.viewer || input.decisionActor !== input.controller ? "notDecisionActor" : "unsupported"
      : undefined);
    return {
      skillIndex: skill.index,
      kind: skill.kind,
      category,
      text: skill.raw,
      tags: skill.tags,
      zone: input.zone,
      owner: input.owner,
      controller: input.controller,
      origin: input.copied.has(skill.index) ? "copied" : "printed",
      ...(skill.kind.startsWith("activate:") ? { timing: skill.kind.slice("activate:".length) } : {}),
      ...(max != null ? { limit: { max, used, remaining: Math.max(0, max - used) } } : {}),
      availability,
      ...(notEvaluatedReason ? { notEvaluatedReason } : {}),
      ...(evidence?.why ? { why: evidence.why } : {}),
      costPreview,
      ...(category === "automatic" ? { pending: input.pending.has(skill.index) } : {}),
      ...(permanent ? { permanentState: permanent.state } : {}),
    };
  });
}

const cardIdOf = (a: LegalAction["action"]): string | null => {
  const x = a as { card?: string | null; attacker?: string; cards?: string[] };
  if (typeof x.card === "string") return x.card;
  if (typeof x.attacker === "string") return x.attacker;
  if (Array.isArray(x.cards) && x.cards.length === 1) return x.cards[0];
  return null;
};

export function tappable(legal: LegalAction[], rejected: RejectedAction[] = []): Tappable {
  const out: Tappable = { byCard: {}, bare: [], attackTargets: {} };
  if (rejected.length) {
    const why: Record<string, Requirement[]> = {};
    for (const r of rejected) {
      const card = cardIdOf(r.action);
      if (!card) continue;
      const list = (why[card] ??= []);
      // The same requirement can fall out of two moves on one card ("you
      // have already charged" from both a play and a charge); once is enough.
      for (const q of r.why) if (!list.some((x) => JSON.stringify(x) === JSON.stringify(q))) list.push(q);
    }
    out.whyByCard = why;
  }
  legal.forEach((l, i) => {
    if (l.action.type === "attack") {
      const t = (out.attackTargets[l.action.attacker] ??= {});
      t[l.action.target] = i;
      (out.byCard[l.action.attacker] ??= []).push(i);
      return;
    }
    const card = cardIdOf(l.action);
    if (card) (out.byCard[card] ??= []).push(i);
    else out.bare.push(i);
  });
  return out;
}

/**
 * Every card instance whose identity `viewer` is allowed to know right now.
 *
 * A card is identifiable when it sits in an area either player may read
 * (3-1-3) — both leaders and Unisons, everything in play, the Energy, Combo
 * and Z-Energy Areas, the *whole* Drop (3-4-3) and Warp (3-10-2), the cards
 * removed from the game (20-10-3) — or in a secret area that is the viewer's
 * own to read (their hand, 3-3-2; their Z-Deck, 3-12-2), or it has been turned
 * face up (3-9-2-1); and it is not itself face-down (23-5-2). The cards under
 * a readable card are face up too (23-2-2). A card being searched for is in,
 * because the search sheet shows it to the searcher and to nobody else. The
 * opponent's hand, both decks and face-down life never are.
 *
 * It exists so `beats.ts` can ask the same question about a card that has
 * since left the board, without a second set of reveal rules growing up beside
 * this one. See `maskBeats`. The board draws only the top of a Drop, but the
 * area is open, so a card KO'd under another stays named in its beat (#458).
 *
 * The reading is `vmRevealedTo` (`vm/view.ts`): the same rule, read off the
 * zone declarations' `visibility` (#458).
 */
export function revealedTo(s: EngineState, viewer: PlayerId, pinnedDefinition?: GameDefinition): Set<string> {
  const loaded = pinnedDefinition ? null : rulesetFor(s.game);
  const definition = pinnedDefinition ?? (loaded?.ok ? loaded.definition : null);
  if (!definition) throw new Error(`the ${s.game} ruleset did not load, so no board can say what is hidden: ${loaded && !loaded.ok ? loaded.errors[0]?.message ?? "no reason given" : "no pinned definition"}`);
  return vmRevealedTo(definition, s, viewer);
}

/**
 * Whose turn it is to answer — the board is drawn from this player's side.
 */
export function viewerOf(s: EngineState): PlayerId {
  const pr = s.prompt;
  return "player" in pr && pr.player ? pr.player : s.turnPlayer;
}
