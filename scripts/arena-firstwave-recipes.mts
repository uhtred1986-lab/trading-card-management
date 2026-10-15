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

const args=process.argv.slice(2),known=new Set(["--catalog","--constraints","--stored-snapshot","--out"]);
if(args.length%2 || args.some((a,i)=>i%2===0 && !known.has(a))) throw new Error("usage: tsx scripts/arena-firstwave-recipes.mts --catalog FILE [--stored-snapshot FILE] --out FILE");
const flag=(name:string)=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
const catalogFile=flag("--catalog"),out=flag("--out");
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
const owners=JSON.parse(readFileSync("docs/arena-backlog/evidence/655/owner-specified-costs-2026-10-13.json","utf8")) as {specifiedCosts:Record<string,string>};
const defs:Record<string,CardDef>={};
for(const id of used) if(byId.has(id)) {
  const def=structuredClone(byId.get(id)!);
  const specified=constraints?currentConstraints.get(id)?.specified_cost:owners.specifiedCosts[id];
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
  return {id:recipe.id,name:recipe.name,source:recipe.source,notes:recipe.notes,input,quantities:{leader:recipe.leader,main:recipe.main,z:recipe.z},listSha256:evidenceHash(input),
    catalogLegalityStatus:lg.status,catalogLegalityIssues:lg.issues,mainCount:lg.mainCount,zCount:lg.zCount,missingDefinitions:missing,
    restrictionEvidence:{sourceDate:constraints?.capturedAt ?? audited.source.retrieved,verifiedCards:ids.length-unknownRestrictions.length,unknownCards:unknownRestrictions,
      verdict:unknownRestrictions.length?"unverified-ban-and-limit-metadata":constraints?"current-app-catalog-only-not-independent-official-ban-list":"historical-snapshot-only-not-current-ban-list"},
    ingredients,freshCompilerIssues:freshIssues,cachedStoredIssues:storedIssues,inputGaps,
    qualification:"not-claimed",mechanicCoverage:"not-run",strategyCoverage:"not-run"};
});
if(JSON.stringify(evaluationRunnerPin("arena-scenario","firstwave-preparation-1"))!==JSON.stringify(runner)) throw new Error("source changed during recipe audit");
writeEvidenceFile(out,JSON.stringify({format:"arena-firstwave-preparation-v1",runner,catalogSha256:createHash("sha256").update(source).digest("hex"),
  constraints:constraintsBytes?{capturedAt:constraints!.capturedAt,source:constraints!.source,sha256:createHash("sha256").update(constraintsBytes).digest("hex")}:null,
  scope:"Six initial quantities plus a separate legal Trunks control; all16 first-wave recipes remain the target. No DB writes, actual deck links, qualification or strategic passes.",records},null,2)+"\n");
for(const row of records) console.log(`${row.id}: main${row.mainCount} z${row.zCount}; app catalog ${row.catalogLegalityStatus}; missing defs${row.missingDefinitions.length}; fresh unread${row.freshCompilerIssues.length}; stored unread/missing${row.cachedStoredIssues?.length ?? "not inspected"}; unknown restrictions${row.restrictionEvidence.unknownCards.length}; ingredient failures${row.ingredients.filter((x)=>!x.pass).length}`);
process.exitCode=records.some((row)=>row.catalogLegalityStatus!=="legal" || row.missingDefinitions.length || row.ingredients.some((i)=>!i.pass))?1:0;
