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
  {id:"bt27-092-mechikabura-multiple-attacks",name:"BT27 — Mechikabura / multiple attacks",leader:"BT27-092",source:"authored-proposal",
    main:rows({"BT27-101":4,"BT27-108":4,"BT27-107":4,"BT27-100":4,"BT27-102":3,"BT27-103":4,"BT27-104":4,"BT27-105":4,
      "BT27-106":4,"BT27-109":3,"BT27-110":2,"BT27-111":4,"BT27-099":2,"BT27-095":2,"BT16-117":2}),
    z:rows({"BT27-093":4}),notes:["Authored public proposal; all named counts are proposals, not an official or owner decklist.","The Leader searches black Demon Realm Race/Demon God cards; these traits are present in the main list.","The four-card Z-Battle has printed Z-Energy cost3; its printed reduction needs an Over Realm/Dark Over Realm Battle in play. Dark Over Realm cards are included.","BT27-099 is a Dark Over Realm blocker; BT27-095 is a Counter: Attack for a black Leader; BT16-117 is mixed-release Demon God/Dark Over Realm blocker-token support. These replace a main-deck Z-Extra, an SSB Vegeta-only card, and Salsa's Dark Dragon Ball-gated play mode.","Triple Attack and Deflect remain unqualified; a legal list and reusable keyword proof do not prove the deck was tested."]},
  {id:"bt30-001-super-saiyans-united-red-attacks",name:"BT30 — Super Saiyans United / red attacks",leader:"BT30-001",source:"authored-proposal",
    main:rows({"BT30-004":4,"BT30-005":4,"BT30-009":4,"BT30-011":4,"BT30-007":4,"BT30-015":4,"BT30-008":4,"BT30-010":4,
      "BT30-003":4,"BT30-006":4,"BT30-012":4,"BT30-013":4,"BT6-003":2}),z:[],
    notes:["Authored public proposal, not an official or owner decklist; 2 mixed-release BT6-003 cards fill the 50-card list.","BT30-001 awakens to the exact back name {Super Saiyans United}; support effects naming that Leader require the flipped side. BT30-007/012 and the Leader access Spirit; BT30-004 can move Spirit from Drop to Z-Energy. BT30-015 has a separate under-Son-Goku effect.","The 4-cost play and 4-Z-Energy play have distinct requirements; neither is asserted to have fired.","Dual Attack and all attached skills remain unqualified for this recipe."]},
  {id:"bt5-002-pilaf-wish-desire",name:"BT5 — Pilaf / Wish and Desire",leader:"BT5-002",source:"authored-proposal",
    main:rows({"BT5-117":4,"P-084":2,"P-176":1,"BT5-024":4,"BT5-119":4,"BT5-107":4,"BT5-106":4,"BT5-016":4,
      "BT5-015":4,"BT5-003":4,"BT5-008":2,"BT5-012":2,"BT5-014":3,"BT5-005":4,"BT5-025":4}),z:[],
    notes:["Authored public proposal; P-084 and P-176 are mixed-release Dragon Ball support; exactly 7 Dragon Ball cards are listed.","The Leader has the Shenron trait required by Oolong's Wish and World Peace. BT5-119 is interpreted through current errata: target energy cost3 or less, independent of current energy.","This list contains the threshold ingredients, not evidence that Wish/Desire resolves; the wrong-identity and six-versus-seven cases remain separate scenarios.","Counts are proposals, not official or owner quantities; current legality/compiler metadata does not qualify the recipe."]},
  {id:"bt5-105-black-masked-saiyan-warp-pressure",name:"BT5 — Black Masked Saiyan / Warp pressure",leader:"BT5-105",source:"authored-proposal",
    main:rows({"BT5-111":4,"BT5-112":4,"BT5-113":4,"BT5-114":4,"BT5-106":4,"BT10-129":3,"BT10-130":1,"BT11-127":4,
      "BT11-129":2,"BT12-127":4,"BT12-128":4,"BT12-132":4,"BT13-147":4,"BT5-115":2,"BT5-116":2}),z:[],
    notes:["Authored mixed-release Saiyan proposal, not an official or owner decklist; most main-deck cards have the Saiyan trait to support the printed 15-card Drop threshold.","The Leader's Burst 3 and BT5-106/other discard effects create Drop cards, but opponent contribution and the 15-card condition must be staged in scenarios.","BT5-114 is the only four-copy Super Combo group in this list; verify current catalog limits when regenerating.","Critical and the attack-negated/no-damage Auto remain unqualified for this recipe."]},
  {id:"bt6-001-gogeta-br-fusion",name:"BT6 — Gogeta / Br fusion",leader:"BT6-001",source:"authored-proposal",
    main:rows({"BT6-012":4,"BT6-013":4,"BT6-003":4,"BT6-004":4,"BT6-005":4,"BT6-007":4,"BT6-008":4,"BT6-009":4,
      "BT6-011":4,"BT6-015":4,"BT6-006":4,"BT6-010":4,"BT6-014":2}),z:[],
    notes:["Authored public proposal, not an official or owner decklist; the list contains red Son Goku:Br and Vegeta:Br Battle Cards as exact Union-Fusion materials.","BT6-005 and BT6-009 are the release's Veku/material searchers; BT6-012 and BT6-013 are separate Veku Union-Fusion cards.","This list intentionally includes the printed BT6-014/015 Gogeta payoffs; exact target, energy and alternative-price behavior requires scenario evidence.","Union-Fusion and the full recipe remain unqualified."]},
  {id:"bt6-053-paragus-broly-recovery",name:"BT6 — Paragus / Broly recovery",leader:"BT6-053",source:"authored-proposal",
    main:rows({"BT6-062":4,"BT6-063":4,"BT6-060":4,"BT6-061":4,"P-136":4,"BT6-059":4,"BT6-064":4,"BT6-065":4,
      "BT6-066":4,"BT6-067":4,"BT6-068":4,"BT6-069":4,"BT6-070":2}),z:[],
    notes:["Authored public proposal; P-136 is mixed-release green Broly:Br with energy cost6, the exact recovery target for BT6-062.","The recovery Auto requires the source to be skill-removed or KO'd, the green Frieza's Army Leader, exactly two hand cards if accepted, and a qualifying target in hand.","BT6-061 and BT6-060 have separate energy-cost8 text and do not satisfy BT6-062's cost6 target condition.","The 2-card payment, optional decline and target-in-hand cases remain unqualified."]},
  {id:"bt27-045-piccolo-namekian-revival",name:"BT27 — Piccolo / Namekian revival",leader:"BT27-045",source:"authored-proposal",
    main:rows({"BT27-128":4,"BT27-130":4,"BT27-131":4,"BT27-132":4,"BT27-129":4,"BT8-119":4,"BT27-062":4,"BT27-064":2,
      "BT27-125":4,"BT27-126":4,"BT27-127":4,"BT5-061":4,"BT27-061":4}),z:rows({"BT27-048":4}),
    notes:["Authored public proposal; BT27-128/130/131/132 and BT8-119 are Namekian Revive Battle Cards with energy costs4 or less, fitting the Leader's printed target condition.","BT27-129 Nail costs5: it is included as a separate Revive card but is not treated as a legal target for the Leader's cost4-or-less play.","BT27-048 is a mixed-purpose Z-Battle with recorded Z-Energy cost2; check full Z-Deck legality and distinguish its alternate effects.","The current source text for BT27-045 has an apparent malformed 'o 4' token; compiler reading and official correction/manual basis require review before any qualification."]},
  {id:"bt29-057-vegeta-saiyan-evolution",name:"BT29 — Vegeta / Saiyan evolution",leader:"BT29-057",source:"authored-proposal",
    main:rows({"BT29-064":4,"BT29-065":4,"BT29-062":4,"BT29-063":2,"BT29-066":4,"BT29-067":4,"BT29-068":3,"BT29-077":3,
      "BT29-079":3,"BT29-081":4,"BT29-080":4,"BT29-078":3,"BT29-071":4,"BT29-074":2,"BT29-075":2}),z:rows({"BT29-061":1}),
    notes:["Authored proposal; BT29-065 is a yellow Vegeta cost3 base for BT29-064 EX-Evolve and the Leader can place that named card into Drop.","BT29-064's recovery Auto needs it sent to Drop by a skill on a yellow Frieza's Army card; BT29-068 provides a possible Frieza-source interaction but its chosen Vegeta/K.O. timing must be scenario-verified.","The matching `{Vegeta, Warrior Race Pride}` names, awaken route and target `Vegeta, Back From the Brink of Death` need current text/manual review.","BT29-061 is listed in the Z-Deck for the Leader's awaken condition; its Z-Energy cost metadata needs explicit audit.","The recipe is unqualified; no passed EX-Evolve or Drop-recovery claim is made."]},
  {id:"bt30-082-brianne-maiden-stack-play",name:"BT30 — Brianne / Maiden stack play",leader:"BT30-082",source:"authored-proposal",
    main:rows({"BT30-095":4,"BT30-096":4,"BT30-097":4,"BT30-098":4,"BT30-099":4,"BT30-100":4,"BT30-101":4,"BT30-102":4,
      "BT30-103":4,"BT30-104":4,"BT30-106":4,"BT30-085":4,"BT30-088":2}),z:rows({"BT30-084":4}),
    notes:["Authored public proposal; 10 BT30 Maiden Squadron Battle Card groups include the BT30-103 Su Roas host and BT30-102 Rozie named by its skill text.","The ten other main-deck slots are BT30-106 Delivery of Love x4, BT30-085 Son Goku, Ultra Technique x4, and BT30-088 SSB Vegeta, Accepted Fate x2. Delivery of Love gains Maiden Squadron in all areas, so it can pay the Leader's discard cost; BT30-085's Deflect/Blocker/Revenge and attack Auto are not Universe 7-gated; BT30-088's Deflect and play Auto are also not Universe 7-gated. The cards' Universe 7-specific play modes are not counted as usable support here.","BT30-084 is a Z-Extra with recorded Z-Energy cost1; the opponent-two-energy / {1} activation requirements still need scenario proof.","The played-card-on-host stack, exact name source, source area and missing-name controls remain unqualified."]},
  {id:"bt31-001-gogeta-widened-fusion",name:"BT31 — Gogeta / widened fusion",leader:"BT31-001",source:"authored-proposal",
    main:rows({"BT31-014":4,"BT31-010":4,"BT31-007":4,"BT31-012":4,"BT31-011":4,"BT31-008":4,"BT31-015":4,"BT31-013":4,
      "BT31-009":4,"BT31-018":4,"BT31-149":1,"BT31-017":1,"BT31-024":4,"BT31-025":4}),z:[],
    notes:["Independent authored red Saiyan proposal; it does not reproduce private owner decks. BT31-007/008/009 provide red Son Goku cards and BT31-011/012 provide red Vegeta cards alongside multiple Union-Fusion targets.","BT31-014 requires exact red Son Goku and red Vegeta materials, opponent 3+ energy, `{r}{r}` and draw2; only the awakened BT31-001 back permission opens its additional material areas.","BT31-007/011 have Warp/hand conditions, and BT31-008/012 have a low-Warp attack restriction; those are list support constraints, not proof they resolve. BT31-006 was omitted because its value depends on a red Z-Card that this list does not include.","BT31-149 is an Ultimate and is limited to one copy here. BT31-018's generic play Auto supplies a -5000 power effect; its other abilities have Janemba/Evil Incarnate gates and are not assumed active. BT31-017 is one generic Counter: Attack copy; its life-payment discount is Janemba-specific.","The Union-Fusion, Revenge, printed payoffs and complete deck remain unqualified."]},
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
