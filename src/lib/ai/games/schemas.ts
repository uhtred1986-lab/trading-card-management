/**
 * The wizard's answer shapes. The Dragon Ball one is the schema `deck.ts` always had (it reaches the
 * model as JSON schema, so it is not touched); Pokémon's differs only in the quantity ceiling, because
 * a basic-Energy swap moves a handful of cards at once.
 */
import { z } from "zod";

const swaps = (maxQuantity: number) =>
  z
    .array(
      z.object({
        outCardId: z.string().describe("Card number currently in the deck to remove"),
        outQuantity: z.number().int().min(1).max(maxQuantity),
        inCardId: z.string().describe("Card number from the CANDIDATE POOL to add"),
        inQuantity: z.number().int().min(1).max(maxQuantity),
        rationale: z.string(),
        priority: z.enum(["high", "medium", "low"]),
      }),
    )
    .max(10);

export const WizardSchema = z.object({
  assessment: z.string().describe("One paragraph on the deck's biggest gaps"),
  swaps: swaps(4),
});
export type WizardResult = z.infer<typeof WizardSchema>;

export const PokemonWizardSchema = z.object({
  assessment: z.string().describe("One paragraph on the deck's biggest gaps"),
  swaps: z
    .array(
      z.object({
        outCardId: z.string().describe("Card id currently in the deck to remove"),
        // Up to a whole deck: a deck that is still short gets "add 25 basic Energy" as one swap (seen live, 14 Nov 2026).
        outQuantity: z.number().int().min(1).max(60),
        inCardId: z.string().describe("Card id (PKM-…) from the player's cards or from a lookup, to add"),
        inName: z.string().describe("The name of the card to add, exactly as the player's list or the lookup gave it for that id"),
        inQuantity: z.number().int().min(1).max(60),
        rationale: z.string(),
        priority: z.enum(["high", "medium", "low"]),
      }),
    )
    .max(10),
});
