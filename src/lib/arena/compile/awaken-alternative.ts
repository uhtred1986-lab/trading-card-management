/** R474: do not flatten one-host OR payments into a conjunctive price. */
import type { Skill } from "../types";
import type { AwakenAlternative } from "../vm/awaken-alternative";
import { awakenAlternativeProblem } from "../vm/awaken-alternative";
import { parseFilter } from "../text/filters";

export function compileAwakenAlternative(skill: Skill): AwakenAlternative | undefined {
  if (skill.keyword?.name !== "Awaken" || skill.energyEither.length || Object.values(skill.energyCost).some(Boolean) || skill.markerCost != null || skill.burst != null || skill.spiritBoost != null) return;
  const text = skill.cost.trim().toLowerCase().replace(/\s+/g, " ").replace(/\.$/, "");
  const match = /^when your life is at (\d+) or less or you choose (\d+) cards from under (?:a|1) (<[^>]+>) card in your battle area and place them under this card$/.exec(text);
  if (!match) return;
  const filter = parseFilter(`${match[3]} card`);
  if (filter.unreadable) return;
  const result: AwakenAlternative = { version: 1, free: { kind: "life", side: "you", atMost: Number(match[1]) }, host: { side: "you", area: "battle", filter }, count: Number(match[2]) };
  return awakenAlternativeProblem(result) ? undefined : result;
}
