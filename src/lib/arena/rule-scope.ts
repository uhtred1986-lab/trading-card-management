/** Energy Marker text describes global setup/payment rules, not a card skill.
 * Masters manual 1-14-3: markers are neither cards nor energy.
 */
export function isGameRuleReminder(cardType: string): boolean {
  return cardType.trim().toUpperCase() === "ENERGY MARKER";
}
