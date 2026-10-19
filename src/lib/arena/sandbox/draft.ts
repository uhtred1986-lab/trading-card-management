/**
 * Where the builder's unsaved rule waits for the sandbox: one
 * `sessionStorage` key per rule (or per development fixture). The Try it
 * panel writes it when "Play this board" is followed; the sandbox reads it on
 * every start. Nothing else reads or clears it.
 */
export function draftKey(ruleId: number | null, fixture?: string): string {
  return ruleId != null ? `arena:sandbox:draft:rule:${ruleId}` : `arena:sandbox:draft:fixture:${fixture ?? ""}`;
}

/** The sandbox page for a rule on a board. `cardId` only decorates the path: the rule row says which card. */
export function sandboxHref(ruleId: number, boardKey: string, cardId = "rule"): string {
  return `/arena/rules/card/${encodeURIComponent(cardId)}/play?${new URLSearchParams({ rule: String(ruleId), board: boardKey }).toString()}`;
}

/** Keep the rule the builder holds for the sandbox to find. Storage can be blocked: then the saved rule is played. */
export function keepDraft(ruleId: number, rule: unknown): void {
  try {
    sessionStorage.setItem(draftKey(ruleId), JSON.stringify(rule));
  } catch {
    /* the sandbox then plays the saved rule */
  }
}
