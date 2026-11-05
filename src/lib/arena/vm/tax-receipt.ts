/** R456: a paid tax belongs to one immutable rule instance, not a card ID. */
export function canonicalTaxValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(item => item === undefined ? "null" : canonicalTaxValue(item)).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).filter(key => (value as Record<string, unknown>)[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonicalTaxValue((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
export function taxReceiptIdentity(key: string, rule: unknown, source: { card: string; cardId: string; epoch: number } | null): string {
  // A timed effect retains its identity even if its originating card moves.
  // Standing/own rules must distinguish a fresh source occurrence and a
  // changed rule occupying the same ordinal in the current static list.
  return canonicalTaxValue({ version: 1, key, rule, source: key.startsWith("effect:") ? null : source });
}
