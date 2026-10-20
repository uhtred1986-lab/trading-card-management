import { deckRules, type Game } from "@/lib/catalog/games";
import type { DeckLegality } from "@/lib/decks/legality";

/**
 * Nothing here blocks anything: an illegal or half-finished deck saves fine,
 * this just says what a judge would say about it.
 */
export function DeckIssues({ legality, game }: { legality: DeckLegality; game: Game }) {
  const RULES = deckRules(game);
  // Keywords like [Dragon Ball] carry their own limit, printed on the card.
  const rules = legality.keywordRules.length ? (
    <p className="text-[11px] text-space-400">
      Card rules in play:{" "}
      {legality.keywordRules.map((r) => (
        <span key={r.keyword} className="mr-2">
          <span className="text-space-200">[{r.keyword}]</span>{" "}
          <span className={`tabular-nums ${r.used > r.max ? "text-loss" : ""}`}>
            {r.used}/{r.max}
          </span>
          {r.unlimitedCopies ? " (any mix of copies)" : null}
        </span>
      ))}
    </p>
  ) : null;

  if (legality.status === "legal" && legality.issues.length === 0) {
    return (
      <div className="space-y-1">
        <p className="text-xs text-gain">
          Tournament-legal: one leader, {RULES.main}–{RULES.mainMax} cards, copy limits respected.
        </p>
        {rules}
      </div>
    );
  }
  const groups = [
    { severity: "illegal" as const, title: "Breaks a rule", cls: "text-loss" },
    { severity: "incomplete" as const, title: "Still to do", cls: "text-ki-300" },
    { severity: "warning" as const, title: "Worth a look", cls: "text-yellow-200" },
  ];
  return (
    <div className="space-y-1">
      {groups.map((g) => {
        const list = legality.issues.filter((i) => i.severity === g.severity);
        if (list.length === 0) return null;
        return (
          <div key={g.severity} className="text-xs">
            <span className={`font-semibold ${g.cls}`}>{g.title}:</span> <span className="text-space-300">{list.map((i) => i.message).join(" ")}</span>
          </div>
        );
      })}
      {rules}
      <p className="text-[11px] text-space-400">Saved either way — the deck is only flagged, never blocked.</p>
    </div>
  );
}
