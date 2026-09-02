/**
 * Claude explains the optimiser's output in plain language and applies the
 * user's soft preferences. It never does the arithmetic — see optimizer.ts.
 */
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Db } from "@/db";
import type { Plan } from "@/lib/marketplace/optimizer";
import { MODEL, anthropic, recordRun } from "./client";

export const CartExplanationSchema = z.object({
  recommendation: z.string().describe("2–4 sentences: which plan to pick and why"),
  tradeoffs: z.array(z.string()).max(5),
  warnings: z.array(z.string()).max(5).describe("Missing cards, vacationing sellers, odd prices, non-EU sellers"),
});
export type CartExplanation = z.infer<typeof CartExplanationSchema>;

function planText(label: string, p: Plan | null): string {
  if (!p) return `${label}: not possible`;
  const lines = p.sellers.map(
    (s) => `  ${s.seller} (${s.country}${s.lines.some((l) => l.listing.condition) ? "" : ""}): items €${(s.itemsCents / 100).toFixed(2)} + shipping €${(s.shippingCents / 100).toFixed(2)} — ${s.lines.map((l) => `${l.quantity}× ${l.listing.cardId} @ €${(l.listing.priceCents / 100).toFixed(2)}`).join(", ")}`,
  );
  const missing = p.missing.length ? `  missing: ${p.missing.map((m) => `${m.quantity}× ${m.cardId}`).join(", ")}` : "";
  return [`${label}: total €${(p.totalCents / 100).toFixed(2)} across ${p.sellers.length} seller(s)`, ...lines, missing].filter(Boolean).join("\n");
}

export async function explainCart(db: Db, best: Plan, fewestSellers: Plan | null, preferences: string): Promise<{ runId: number; explanation: CartExplanation }> {
  const res = await anthropic().messages.parse({
    model: MODEL,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    output_config: { effort: "low", format: zodOutputFormat(CartExplanationSchema) },
    system: "You help a Dragon Ball Super card collector in Austria choose between shopping-cart plans computed by a deterministic optimiser. Do not recompute totals; reason about the trade-offs given. Prices are EUR.",
    messages: [
      {
        role: "user",
        content: `${planText("CHEAPEST PLAN", best)}\n\n${planText("FEWEST-SELLERS PLAN", fewestSellers)}\n\nBUYER PREFERENCES: ${preferences || "none stated"}\n\nExplain which to choose.`,
      },
    ],
  });
  const { id, output } = await recordRun<CartExplanation>(db, "cart_explain", { preferences }, res);
  return { runId: id, explanation: output };
}
