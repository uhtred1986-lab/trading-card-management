import { notFound } from "next/navigation";
import { RuleBuilder } from "@/components/arena/rules/RuleBuilder";
import { ACTION_BAR_ID, RuleRecord, type RecordProps } from "@/components/arena/rules/RuleRecord";
import type { Rule } from "@/lib/arena/lang";
import { openingFocus } from "@/lib/arena/lang/blocks";
import { emptyFilter } from "@/lib/arena/text/filters";
import { requireSlPage } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Dev-only: the block builder on a fixture rule, with no database behind it,
 * so a review can see and shoot the builder in a session that keeps off Neon
 * (the way `/arena/preview` shows the board). Saving answers with the server
 * action's own refusal, since there is no row. Production answers 404.
 *
 * `?rule=tidecaller` (an open card: the IF unread and empty), `frost` (an
 * empty THEN), `worked` (`docs/arena-rules-language.md` §4, every clause
 * filled); `?focus=ops[0]` opens on any block by its `RulePath`.
 */
const FIXTURES: Record<string, { rule: Rule; card: { cardId: string; name: string; printed: string; unread: string[] } }> = {
  tidecaller: {
    rule: { kind: "auto", trigger: ["attacks"], cost: null, cond: null, ops: [{ op: "draw", n: 1 }] },
    card: { cardId: "BT21-044", name: "Tidecaller Oracle", printed: "[Auto] When this card attacks, if there are 3 or more blue cards in your drop area, draw 1 card.", unread: ["if there are 3 or more blue cards in your drop area"] },
  },
  frost: {
    rule: { kind: "activate:main", trigger: [], cost: null, cond: null, ops: [] },
    card: { cardId: "BT22-061", name: "Frost Sigil", printed: "[Activate: Main] Choose 1 of your opponent's Battle Cards with an energy cost of 4 or less, and switch its position.", unread: ["Choose 1 of your opponent's Battle Cards with an energy cost of 4 or less, and switch its position."] },
  },
  worked: {
    rule: {
      kind: "activate:main",
      trigger: [],
      cost: { text: "", orbs: { Red: 1, any: 1 }, either: [], marker: null, burst: null, spiritBoost: null, condition: { kind: "leaderColor", color: "Red" }, program: null },
      cond: { kind: "life", side: "you", atMost: 4 },
      ops: [
        { op: "choose", sel: { count: 1, side: "opponent", area: "battle", filter: { ...emptyFilter(), type: "BATTLE", costMax: 3 } }, as: "t" },
        { op: "ko", target: { var: "t" } },
      ],
    },
    card: { cardId: "§4", name: "A price, a condition and a choice", printed: "[Activate: Main] {R}{1} If your Leader is red and your life is 4 or less: KO 1 of your opponent's Battle Cards with an energy cost of 3 or less.", unread: [] },
  },
};

/** `?record=1`: the same fixture as the workbench's record pane draws it, so the shared block editor can be seen in the record column too. */
function recordOf(fx: (typeof FIXTURES)[string]): RecordProps {
  return {
    id: 0,
    cardId: fx.card.cardId,
    name: fx.card.name,
    setCode: fx.card.cardId.split("-")[0],
    side: "front",
    skillIndex: 0,
    kind: fx.rule.kind,
    tag: fx.rule.kind,
    permanent: fx.rule.kind === "permanent",
    printed: fx.card.printed,
    trigger: fx.rule.trigger,
    cost: fx.rule.cost,
    cond: fx.rule.cond,
    ops: fx.rule.ops,
    unread: fx.card.unread,
    status: fx.card.unread.length ? "open" : "draft",
    source: "compiler",
    version: 1,
    explanation: null,
    brief: null,
    timesSeen: 0,
    pattern: null,
    reads: "",
    decks: [],
    siblings: { count: 0, ids: [] },
    compilerDiff: null,
    mechanism: null,
    specifiedCost: null,
  };
}

export default async function BuildPreviewPage({ searchParams }: { searchParams: Promise<{ rule?: string; focus?: string; record?: string }> }) {
  await requireSlPage();
  if (process.env.NODE_ENV === "production") notFound();
  const q = await searchParams;
  const fx = FIXTURES[q.rule ?? "tidecaller"] ?? FIXTURES.tidecaller;
  const focus = openingFocus(fx.rule, q.focus ?? null, fx.card.unread);
  if (q.record === "1")
    return (
      <div className="mx-auto max-w-3xl">
        <RuleRecord {...recordOf(fx)} />
        <div id={ACTION_BAR_ID} className="mt-3 rounded-xl border border-space-700/70" />
      </div>
    );
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-2 text-lg font-semibold text-space-50">Build the rule · preview</h1>
      <RuleBuilder ruleId={0} initialRule={fx.rule} focusPath={focus ?? undefined} card={fx.card} backHref="/arena/rules" canSave={false} />
    </div>
  );
}
