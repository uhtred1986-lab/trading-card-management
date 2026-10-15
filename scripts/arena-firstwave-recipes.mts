#!/usr/bin/env node
/** Offline quantities/ingredient/compiler audit. Never reads a DB or private deck names/lists. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { firstWaveRecipes, recipeInput } from "./lib/arena-firstwave-recipes.mts";
import { evidenceHash, writeEvidenceFile } from "./lib/policy-evaluation-manifest.ts";
import { evaluationRunnerPin } from "./lib/evaluation-provenance.ts";
import { rulesFromCompiler } from "../src/lib/arena/draft.ts";
import { legality } from "../src/lib/decks/legality.ts";
import { parseSpecifiedCost } from "../src/lib/arena/specified-cost.ts";
import { loadSnapshot } from "./arena-deck-audit.mts";
import type { CardDef } from "../src/lib/arena/types.ts";
import type { CardScripts } from "../src/lib/arena/vm/script.ts";

const args=process.argv.slice(2),known=new Set(["--catalog","--constraints","--stored-snapshot","--out","--portal-out"]);
if(args.length%2 || args.some((a,i)=>i%2===0 && !known.has(a))) throw new Error("usage: tsx scripts/arena-firstwave-recipes.mts --catalog FILE --constraints FILE --out FILE [--stored-snapshot FILE] [--portal-out FILE]");
const flag=(name:string)=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
const catalogFile=flag("--catalog"),out=flag("--out"),portalOut=flag("--portal-out");
if(!catalogFile || !out) throw new Error("explicit local catalog and output paths are required");
const source=readFileSync(catalogFile),catalog=JSON.parse(source.toString()) as CardDef[];
if(!Array.isArray(catalog) || !catalog.every((c)=>c && typeof c.id==="string" && typeof c.name==="string")) throw new Error("catalog must be an array of public CardDefs");
const runner=evaluationRunnerPin("arena-scenario","firstwave-preparation-1");
const byId=new Map(catalog.map((c)=>[c.id,c]));
interface Constraint {id:string;game:string;limited_to:number|null;is_banned:boolean;specified_cost:string|null}
const constraintsFile=flag("--constraints"),constraintsBytes=constraintsFile?readFileSync(constraintsFile):null;
const constraints=constraintsBytes?JSON.parse(constraintsBytes.toString()) as {capturedAt:string;source:string;cards:Constraint[]}:null;
if(constraints && (!Array.isArray(constraints.cards) || !constraints.cards.every((c)=>typeof c.id==="string" && typeof c.is_banned==="boolean"))) throw new Error("invalid catalog constraints snapshot");
const currentConstraints=new Map(constraints?.cards.map((c)=>[c.id,c]) ?? []);
const recipes=firstWaveRecipes();
const used=new Set(recipes.flatMap((r)=>[r.leader,...r.main.map((x)=>x.cardId),...r.z.map((x)=>x.cardId)]));
const owners=constraints?null:JSON.parse(readFileSync("docs/arena-backlog/evidence/655/owner-specified-costs-2026-10-13.json","utf8")) as {specifiedCosts:Record<string,string>};
const defs:Record<string,CardDef>={};
for(const id of used) if(byId.has(id)) {
  const def=structuredClone(byId.get(id)!);
  const specified=constraints?currentConstraints.get(id)?.specified_cost:owners!.specifiedCosts[id];
  if(specified) def.specifiedCost=parseSpecifiedCost(specified)!;
  defs[id]=def;
}
const compiled=rulesFromCompiler(defs);
const storedPath=flag("--stored-snapshot");
// Only stored public card programs are read. Private saved deck records ignored.
const stored=storedPath?(JSON.parse(readFileSync(storedPath,"utf8")) as {context:{scripts:Record<string,CardScripts>}}).context.scripts:null;
const audited=loadSnapshot(),restrictionById=new Map(audited.cards.map((c)=>[c.id,c]));
const records=recipes.map((recipe)=>{
  const input=recipeInput(recipe),ids=[recipe.leader,...recipe.main.map((r)=>r.cardId),...recipe.z.map((r)=>r.cardId)],missing=ids.filter((id)=>!defs[id]);
  const rawRows=[{cardId:recipe.leader,quantity:1,zone:"leader"},...recipe.main.map((r)=>({...r,zone:"main"})),...recipe.z.map((r)=>({...r,zone:"z"}))];
  const lg=legality(rawRows.filter((r)=>defs[r.cardId]).map((r)=>{
    const d=defs[r.cardId],old=restrictionById.get(r.cardId),current=currentConstraints.get(r.cardId);
    return {...r,name:d.name,cardType:d.type,colors:d.colors,skill:d.skill,limitedTo:current?.limited_to ?? old?.limitedTo ?? null,isBanned:current?.is_banned ?? old?.isBanned ?? false,game:"dbs" as const};
  }),"dbs");
  const keys=ids.flatMap((id)=>defs[id]?.back?[id,`${id}#back`]:[id]);
  const freshIssues=keys.flatMap((key)=>!compiled[key]?.complete?[{card:key,unread:compiled[key]?.unsupported ?? ["no compiler result"]}]:[]);
  const storedIssues=stored?keys.flatMap((key)=>!stored[key]?.complete?[{card:key,unread:stored[key]?.unsupported ?? ["not present in cached stored programs"]}]:[]):null;
  const inputGaps=ids.flatMap((id)=>{
    const d=defs[id];if(!d)return [];
    return [...(d.type.includes("UNISON") && !d.specifiedCost?[`${id}: no recorded specified cost`]:[]),
      ...(d.type.startsWith("Z-") && d.type!=="Z-LEADER" && d.zEnergyCost===null?[`${id}: no recorded Z-Energy cost`]:[])];
  });
  const unknownRestrictions=ids.filter((id)=>constraints?!currentConstraints.has(id):!restrictionById.has(id));
  const has=(id:string)=>ids.includes(id),def=(id:string)=>defs[id];
  const deckBuildingChecks=[
    {check:"Main deck contains only Battle, Extra, or Unison cards",pass:recipe.main.every((r)=>["BATTLE","EXTRA","UNISON"].includes(def(r.cardId)?.type ?? ""))},
    {check:"Z-Deck contains only Z cards",pass:recipe.z.every((r)=>def(r.cardId)?.type.startsWith("Z-")===true)},
    {check:"No individual card quantity exceeds its captured restriction or the four-copy default",pass:[...recipe.main,...recipe.z].every((r)=>r.quantity<=(currentConstraints.get(r.cardId)?.limited_to ?? restrictionById.get(r.cardId)?.limitedTo ?? 4))},
    {check:"Ultimate cards total no more than one copy",pass:[...recipe.main,...recipe.z].reduce((n,r)=>n+(/\[ultimate\]/i.test(def(r.cardId)?.skill ?? "")?r.quantity:0),0)<=1},
    {check:"Super Combo cards total no more than four copies",pass:[...recipe.main,...recipe.z].reduce((n,r)=>n+(/\[super combo\]/i.test(def(r.cardId)?.skill ?? "")?r.quantity:0),0)<=4},
  ];
  const ingredients: {check:string;pass:boolean}[]=[];
  if(recipe.leader==="BT31-116") ingredients.push(
    {check:"Leader forbids non-white Extras; every Extra is mono-white",pass:recipe.main.every((r)=>def(r.cardId)?.type!=="EXTRA" || def(r.cardId).colors.length===1 && def(r.cardId).colors[0]==="White")},
    {check:"All five Leader-invokable cost2 white Extras are present",pass:[138,139,140,141,142].every((n)=>has(`BT31-${n}`))},
    {check:"3+ cost white Cell base, cost4 recovery target and Android under-card exist",pass:has("BT31-131") && has("BT31-130") && has("BT31-126")});
  if(recipe.leader==="BT3-082") ingredients.push(
    {check:"Fasha/Tora combo-evolution targets each have matching character bases",pass:has("BT3-098") && has("BT3-099") && has("BT3-096") && has("BT3-097")},
    {check:"5-cost yellow Bardock base supplies included EX-Evolve targets",pass:has("BT3-086") && has("BT3-084") && has("BT3-085")});
  if(recipe.leader==="BT3-108") ingredients.push(
    {check:recipe.id.endsWith("legal-control")?"Legal control has Over Realm3 and omits banned BT3-112 (return mechanic uncovered)":"Historical Over Realm3 Battle/deck-to-Warp return card is present (banned)",pass:recipe.id.endsWith("legal-control")?has("BT3-117") && !has("BT3-112"):has("BT3-112")},
    {check:"Red and blue bodies support the Leader's printed draw condition",pass:recipe.main.some((r)=>def(r.cardId)?.colors.includes("Red")) && recipe.main.some((r)=>def(r.cardId)?.colors.includes("Blue"))},
    {check:"Included Xeno-Evolve cards have matching Towa/Mira bases",pass:has("BT3-114") && has("BT3-115") && has("BT3-116") && has("BT3-117")});
  if(recipe.leader==="BT29-029") ingredients.push(
    {check:"Swap sources and blue Squadron cost5 targets exist",pass:["BT29-037","BT29-039","BT29-033","BT29-036","BT29-038"].every(has)},
    {check:"Battle-area blue Fields and return/replacement interaction exist",pass:["BT29-040","BT29-041","BT29-042"].every(has)});
  if(recipe.leader==="BT27-092") ingredients.push(
    {check:"The main deck contains black Demon Realm Race/Demon God search targets",pass:recipe.main.some((r)=>def(r.cardId)?.colors.includes("Black") && def(r.cardId)?.traits.some((t)=>["Demon Realm Race","Demon God"].includes(t)))},
    {check:"A Dark Over Realm card is included for BT27-093's printed Z-Deck reduction",pass:recipe.main.some((r)=>/\[dark over realm/i.test(def(r.cardId)?.skill ?? ""))},
    {check:"Z-Deck includes BT27-093 with its recorded Z-Energy cost3",pass:has("BT27-093") && def("BT27-093")?.zEnergyCost===3},
    {check:"Black Leader Counter and mixed-release Dark Over Realm blocker support are included",pass:has("BT27-095") && has("BT27-099") && has("BT16-117") && /dark over realm/i.test(def("BT16-117")?.skill ?? "")});
  if(recipe.leader==="BT30-001") ingredients.push(
    {check:"Spirit is reachable from the deck/drop routes printed on the Leader and BT30 support",pass:has("BT30-015") && has("BT30-007") && has("BT30-004")},
    {check:"The Leader flips to the exact Super Saiyans United name required by support skills",pass:def(recipe.leader)?.back?.name==="Super Saiyans United"},
    {check:"The list distinguishes the Leader's Spirit search, BT30-004's Z-Energy Auto and BT30-015 under-card effect",pass:has("BT30-012") && has("BT30-004") && has("BT30-015")});
  if(recipe.leader==="BT5-002") ingredients.push(
    {check:"Exactly seven Dragon Ball cards are listed",pass:lg.keywordRules.some((r)=>r.keyword==="Dragon Ball" && r.used===7)},
    {check:"Desire Extras and Shenron-trait Leader are present",pass:has("BT5-024") && has("BT5-119") && def(recipe.leader)?.traits.includes("Shenron")===true},
    {check:"BT5-119 current card text uses the errata cost limit3",pass:/energy cost of 3 or less/i.test(def("BT5-119")?.skill ?? "")});
  if(recipe.leader==="BT5-105") ingredients.push(
    {check:"The main deck supplies at least15 Saiyan cards for the named combined-Drop threshold",pass:recipe.main.reduce((n,r)=>n+(def(r.cardId)?.traits.includes("Saiyan")?r.quantity:0),0)>=15},
    {check:"BT5-111 is included with the printed black Leader/Saiyan threshold Auto",pass:has("BT5-111") && /15 or more/i.test(def("BT5-111")?.skill ?? "")});
  if(recipe.leader==="BT6-001") ingredients.push(
    {check:"Red Son Goku:Br and red Vegeta:Br Battle Cards are included as exact Veku materials",pass:recipe.main.some((r)=>def(r.cardId)?.colors.includes("Red") && def(r.cardId)?.characters.includes("Son Goku: Br")) && recipe.main.some((r)=>def(r.cardId)?.colors.includes("Red") && def(r.cardId)?.characters.includes("Vegeta: Br"))},
    {check:"The Veku targets BT6-012 and BT6-013 are included",pass:has("BT6-012") && has("BT6-013")});
  if(recipe.leader==="BT6-053") ingredients.push(
    {check:"BT6-062 has its two-card Auto and a green Broly:Br cost6 target is in the list",pass:/choose 2 cards from your hand/i.test(def("BT6-062")?.skill ?? "") && recipe.main.some((r)=>def(r.cardId)?.type==="BATTLE" && def(r.cardId)?.colors.includes("Green") && def(r.cardId)?.characters.includes("Broly: Br") && def(r.cardId)?.energyCost===6)},
    {check:"Green Frieza's Army Leader and exact recovery target P-136 are present",pass:def(recipe.leader)?.colors.includes("Green")===true && def(recipe.leader)?.traits.includes("Frieza's Army")===true && has("P-136")});
  if(recipe.leader==="BT27-045") {
    const validTargets=recipe.main.filter((r)=>{
      const d=def(r.cardId);return d?.type==="BATTLE" && d.traits.includes("Namekian") && typeof d.energyCost==="number" && d.energyCost<=4 && /\[revive/i.test(d.skill ?? "");
    });
    ingredients.push(
      {check:"Piccolo Leader is green and has the Namekian trait for the selected target package",pass:def(recipe.leader)?.colors.includes("Green")===true && def(recipe.leader)?.traits.includes("Namekian")===true},
      {check:"The list contains Namekian Revive cards costing4 or less that match the Leader's target condition",pass:validTargets.length>0 && ["BT27-128","BT27-130","BT27-131","BT27-132","BT8-119"].every((id)=>has(id))},
      {check:"The cost5 BT27-129 Nail is not counted as a Leader-playable target",pass:def("BT27-129")?.energyCost===5 && has("BT27-129")});
  }
  if(recipe.leader==="BT29-057") ingredients.push(
    {check:"Leader awakens to the exact Vegeta, Warrior Race Pride name required by its support cards",pass:def(recipe.leader)?.back?.name==="Vegeta, Warrior Race Pride"},
    {check:"BT29-064 EX-Evolve and its yellow cost3 Vegeta base BT29-065 are both listed",pass:has("BT29-064") && has("BT29-065") && def("BT29-065")?.energyCost===3},
    {check:"The list contains yellow Frieza's Army BT29-068 and the matching BT29-065 Drop target",pass:has("BT29-068") && def("BT29-068")?.traits.includes("Frieza’s Army")===true && has("BT29-065")},
    {check:"Z-Deck includes Formidable Ambition; catalog Z-Energy cost is reported separately",pass:has("BT29-061") && def("BT29-061")?.type==="Z-EXTRA"});
  if(recipe.leader==="BT30-082") ingredients.push(
    {check:"Brianne Leader has Universe 2 and Maiden Squadron traits for the leader-gated support cards",pass:def(recipe.leader)?.traits.includes("Universe 2")===true && def(recipe.leader)?.traits.includes("Maiden Squadron")===true},
    {check:"BT30-103 host skill names BT30-102 Rozie as a possible Warp target",pass:has("BT30-103") && has("BT30-102") && (def("BT30-103")?.skill ?? "").includes("Rozie, Witchy Warrior")},
    {check:"Support Broadcast is in the Z-Deck and its printed Z-Energy cost is recorded",pass:has("BT30-084") && def("BT30-084")?.zEnergyCost===1},
    {check:"Non-Maiden slots include Maiden-tagged discard fodder and generic black defense/removal without counting Universe 7 play gates",pass:has("BT30-106") && /maiden squadron/i.test(def("BT30-106")?.skill ?? "") && /all areas/i.test(def("BT30-106")?.skill ?? "") && has("BT30-085") && /blocker/i.test(def("BT30-085")?.skill ?? "") && has("BT30-088") && /deflect/i.test(def("BT30-088")?.skill ?? "")});
  if(recipe.leader==="BT31-001") ingredients.push(
    {check:"The red BT31-014 Union-Fusion target and red Son Goku/Vegeta materials are included",pass:has("BT31-014") && recipe.main.some((r)=>def(r.cardId)?.colors.includes("Red") && def(r.cardId)?.characters.includes("Son Goku")) && recipe.main.some((r)=>def(r.cardId)?.colors.includes("Red") && def(r.cardId)?.characters.includes("Vegeta"))},
    {check:"Leader has an awaken condition and its back adds the red Veku/Gogeta Union material permission",pass:/\[awaken\]/i.test(def(recipe.leader)?.skill ?? "") && !!def(recipe.leader)?.back && /red <(?:Veku|Gogeta)>/i.test(def(recipe.leader)?.back?.skill ?? "")},
    {check:"Ultimate is one copy, no red-Z-trigger package is included, and generic red interaction is present",pass:recipe.main.find((r)=>r.cardId==="BT31-149")?.quantity===1 && !has("BT31-006") && has("BT31-018") && has("BT31-017")});
  return {id:recipe.id,name:recipe.name,source:recipe.source,notes:recipe.notes,input,quantities:{leader:recipe.leader,main:recipe.main,z:recipe.z},listSha256:evidenceHash(input),
    catalogLegalityStatus:lg.status,catalogLegalityIssues:lg.issues,mainCount:lg.mainCount,zCount:lg.zCount,missingDefinitions:missing,
    restrictionEvidence:{sourceDate:constraints?.capturedAt ?? audited.source.retrieved,verifiedCards:ids.length-unknownRestrictions.length,unknownCards:unknownRestrictions,
      verdict:unknownRestrictions.length?"unverified-ban-and-limit-metadata":constraints?"current-app-catalog-only-not-independent-official-ban-list":"historical-snapshot-only-not-current-ban-list"},
    ingredients,deckBuildingChecks,freshCompilerIssues:freshIssues,cachedStoredIssues:storedIssues,inputGaps,
    qualification:"not-claimed",mechanicCoverage:"not-run",strategyCoverage:"not-run"};
});
if(JSON.stringify(evaluationRunnerPin("arena-scenario","firstwave-preparation-1"))!==JSON.stringify(runner)) throw new Error("source changed during recipe audit");
writeEvidenceFile(out,JSON.stringify({format:"arena-firstwave-preparation-v1",runner,catalogSha256:createHash("sha256").update(source).digest("hex"),
  constraints:constraintsBytes?{capturedAt:constraints!.capturedAt,source:constraints!.source,sha256:createHash("sha256").update(constraintsBytes).digest("hex")}:null,
  scope:"Authored or source-audited quantities for all16 first-wave recipes plus one legal Trunks control. One historical Trunks row intentionally remains blocked by banned BT3-112. No DB writes, actual deck links, qualification or strategic passes.",records},null,2)+"\n");
if(portalOut) {
  const catalogSha256=createHash("sha256").update(source).digest("hex");
  const constraintsSha256=constraintsBytes?createHash("sha256").update(constraintsBytes).digest("hex"):null;
  const prepared={version:2,checkedAt:constraints?.capturedAt ?? audited.source.retrieved,
    source:"Authored public proposals and audited starter quantities; current app public catalog and restrictions snapshot (not independent official banlist verification).",
    sourceCommit:runner.gitCommit,runnerDirtyTreeSha256:runner.dirtyTreeSha256,catalogSha256,constraintsSha256,
    recipes:records.map((record)=>({id:record.id,name:record.name,release:record.quantities.leader.match(/^[A-Z]+[0-9]+/)?.[0] ?? "Unknown",
      leaderId:record.quantities.leader,leaderName:defs[record.quantities.leader]?.name ?? record.quantities.leader,
      mainCount:record.mainCount,zCount:record.zCount,catalogLegality:record.catalogLegalityStatus,
      legalityIssues:record.catalogLegalityIssues,listSha256:record.listSha256,qualification:"Not run",
      compilerGapCards:[...new Set(record.freshCompilerIssues.map((issue)=>issue.card.replace(/#back$/, "")))],
      compilerGapDetails:record.freshCompilerIssues,inputGaps:record.inputGaps,ingredientChecks:record.ingredients,deckBuildingChecks:record.deckBuildingChecks,
      restrictionBasis:record.restrictionEvidence.verdict,notes:record.notes,
      cards:[...record.quantities.main.map((row)=>({...row,zone:"main"})),...record.quantities.z.map((row)=>({...row,zone:"z"}))]
        .map((row)=>({id:row.cardId,name:defs[row.cardId]?.name ?? row.cardId,quantity:row.quantity,zone:row.zone}))
    }))};
  writeEvidenceFile(portalOut,JSON.stringify(prepared,null,2)+"\n");
}
for(const row of records) console.log(`${row.id}: main${row.mainCount} z${row.zCount}; app catalog ${row.catalogLegalityStatus}; missing defs${row.missingDefinitions.length}; fresh unread${row.freshCompilerIssues.length}; stored unread/missing${row.cachedStoredIssues?.length ?? "not inspected"}; unknown restrictions${row.restrictionEvidence.unknownCards.length}; ingredient failures${row.ingredients.filter((x)=>!x.pass).length}`);
const expectedBlocked=new Set(["bt3-108-trunks-over-realm-return"]);
process.exitCode=records.some((row)=>row.missingDefinitions.length || row.restrictionEvidence.unknownCards.length || row.ingredients.some((i)=>!i.pass) || row.deckBuildingChecks.some((i)=>!i.pass) ||
  (expectedBlocked.has(row.id)?row.catalogLegalityStatus!=="illegal" || !row.catalogLegalityIssues.some((i)=>i.message.includes("banned card")):row.catalogLegalityStatus!=="legal"))?1:0;
