import Link from "next/link";
import type { RuleHealth } from "@/lib/arena/rules-store";
import { HealthChip } from "@/components/arena/rules/SkillPanel";

/**
 * A card's rule health as a chip that opens its Card rules page. SL only: the caller decides
 * (players never see rules UI) and passes nothing for a card the arena does not read.
 */
export function HealthBadge({ cardId, health }: { cardId: string; health: RuleHealth | undefined }) {
  if (!health) return null;
  return (
    <Link href={`/arena/rules/card/${encodeURIComponent(cardId)}`} className="inline-flex" title="Open this card's rules">
      <HealthChip health={health} />
    </Link>
  );
}
