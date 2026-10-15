/** Public proposed quantities, not copies of private saved decks or passed qualifications. */
import { DECKS, loadSnapshot, resolveDeck } from "../arena-deck-audit.mts";
import type { DeckInput } from "../../src/lib/arena/types";

export interface RecipeRow {cardId:string;quantity:number}
export interface FirstWaveRecipe {
  id:string; name:string; leader:string; main:RecipeRow[]; z:RecipeRow[];
  source:"authored-proposal"|"audited-starter";
  notes:string[];
}
const rows=(values:Record<string,number>):RecipeRow[]=>Object.entries(values).map(([cardId,quantity])=>({cardId,quantity}));
export const AUTHORED_FIRSTWAVE_RECIPES:FirstWaveRecipe[]=[
  {id:"bt31-116-white-cell-reveal-evolve",name:"BT31 — White Cell / reveal-evolve",leader:"BT31-116",source:"authored-proposal",
    main:rows({"BT31-128":3,"BT31-129":4,"BT31-130":4,"BT31-131":4,"BT31-132":4,"BT31-133":4,"BT31-126":4,"BT31-127":4,
      "BT31-138":4,"BT31-139":4,"BT31-140":4,"BT31-141":3,"BT31-142":4}),z:rows({"BT31-119":4}),
    notes:["New public proposal, not the owner's saved White Cell list.","All Extras are white and cost2; Cell/Android bases support absorption and evolution.","Dende is a generic on-play draw body; its Hyperbolic Time Chamber under-card skill has no matching Leader here.","Four Creeping Terror Z-Battles have recorded Z-Energy cost1; quantity and remaining costs still need full qualification."]},
  {id:"bt3-082-bardock-great-ape-cleanup",name:"BT3 — Bardock / Great Ape cleanup",leader:"BT3-082",source:"authored-proposal",
    main:rows({"BT3-097":4,"BT3-096":4,"BT3-099":4,"BT3-098":4,"BT3-095":4,"BT3-086":4,"BT3-085":2,"BT3-084":2,
      "BT3-088":4,"BT3-101":4,"BT3-104":4,"BT15-102":4,"BT3-094":4,"BT3-093":2}),z:[],
    notes:["Fasha/Tora have actual matching bases; 5-cost Bardock supplies both EX-Evolve targets.","BT15-102 is mixed-release yellow Super Combo support; no banned/restricted status is inferred from this design.","Ingredient presence does not prove the combo-cleanup evolution trigger fired."]},
  {id:"bt3-108-trunks-over-realm-return",name:"BT3 — Trunks / Over Realm return",leader:"BT3-108",source:"authored-proposal",
    main:rows({"BT3-112":4,"BT3-110":4,"BT3-111":4,"BT3-113":4,"BT3-115":4,"BT3-117":4,"BT3-119":4,"BT3-120":4,
      "BT3-122":4,"BT3-121":2,"BT3-114":2,"BT3-116":2,"BT4-015":4,"BT4-028":4}),z:[],
    notes:["BLOCKED historical recipe: app catalog captured2026-10-15 marks BT3-112 banned. Do not assemble this as a legal deck.","Red/blue skill-less support enables the front Leader's draw condition after milling or development.","Towa/Mira bases supply the included Xeno-Evolve targets; Over Realm shares its once-per-turn budget.","Battle/deck-to-Warp return belongs in a historical targeted rules scenario, not a current legal-deck qualification."]},
  {id:"bt29-029-cooler-squadron-return-loop",name:"BT29 — Cooler / Squadron return loop",leader:"BT29-029",source:"authored-proposal",
    main:rows({"BT29-031":4,"BT29-032":4,"BT29-033":4,"BT29-034":4,"BT29-035":4,"BT29-036":4,"BT29-037":4,"BT29-038":4,
      "BT29-039":4,"BT29-040":4,"BT29-041":4,"BT29-042":4,"BT4-028":2}),z:[],
    notes:["Blue 1-cost Swap sources, 5-cost Armored Squadron targets and blue Field Extras provide the named return-loop ingredients.","BT4-028 is mixed-release skill-less blue support; this deliberately omits optional BT29-030 while its missing Z-Energy input is unresolved.","The original-Battle-holder watcher and replacement destination need their own fired-event evidence."]},
];

/** Resolve existing public audited starter quantities, preserving the SD15 amendment. */
export function firstWaveRecipes():FirstWaveRecipe[] {
  const catalog=loadSnapshot().cards;
  const starters=DECKS.map((spec):FirstWaveRecipe=>{
    const resolved=resolveDeck(spec,catalog);
    if(resolved.problems.length) throw new Error(`audited starter cannot resolve: ${resolved.problems.join("; ")}`);
    return {id:spec.key==="A"?"sd15-01-pride-of-the-saiyans-starter-control":"sd5-01-crimson-saiyan-starter-control",
      name:spec.key==="A"?"SD15 — Pride of the Saiyans / starter control":"SD5 — Crimson Saiyan / starter control",
      leader:resolved.rows.find((r)=>r.zone==="leader")!.card.id,main:resolved.rows.filter((r)=>r.zone==="main").map((r)=>({cardId:r.card.id,quantity:r.quantity})),z:[],
      source:"audited-starter",notes:[spec.source,...(spec.amended?[spec.amended.decision]:[]),"Historical audited quantities, not current strategic qualification."]};
  });
  const trunks=AUTHORED_FIRSTWAVE_RECIPES.find((r)=>r.leader==="BT3-108")!;
  const legalTrunks:FirstWaveRecipe={...trunks,id:"bt3-108-trunks-over-realm-legal-control",name:"BT3 — Trunks / legal Over Realm control",
    main:trunks.main.filter((r)=>r.cardId!=="BT3-112").map((r)=>({...r,quantity:["BT3-114","BT3-116"].includes(r.cardId)?4:r.quantity})),
    notes:["Separate legal-control proposal; deliberately omits banned BT3-112, retaining the blocked original recipe for evidence.",
      "Adds two Towa and two Mira Xeno-Evolve finishers, preserving50cards and their matching bases.","Supports Over Realm but does not cover Unrelenting Assault Trunks' historical Warp-return mechanic."]};
  return [...AUTHORED_FIRSTWAVE_RECIPES,...starters,legalTrunks];
}
export function recipeInput(recipe:FirstWaveRecipe):DeckInput {
  const expand=(rs:RecipeRow[])=>rs.flatMap((row)=>Array.from({length:row.quantity},()=>row.cardId));
  return {name:recipe.name,leader:recipe.leader,main:expand(recipe.main),...(recipe.z.length?{z:expand(recipe.z)}:{})};
}
