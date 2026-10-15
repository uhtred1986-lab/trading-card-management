/** #828: real search-before-limit SQL, scoped leader descriptions and compound discovery filters. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../src/db/schema.ts";
import type { Db } from "../../src/db/index.ts";
import { quickSearch } from "../../src/lib/catalog/queries.ts";
import { ownedLeaders } from "../../src/lib/leaders/queries.ts";
import { filterDecks, emptyDeckFilters, type DiscoveryDeck } from "../../src/lib/decks/discovery.ts";
import { readPack } from "../../src/components/arena/session/local-board.ts";

const choices:DiscoveryDeck[]=[
 {id:"1",name:"Red rush",description:"Early Saiyan pressure",leaderName:"Bardock",leaderId:"SD15-01",colors:["Red"],group:"Built",mainCount:50,locked:false},
 {id:"2",name:"Wish",description:"Patient recovery",leaderName:"Shenron",leaderId:"SD5-01",colors:["Blue","Yellow"],group:"Virtual",mainCount:50,locked:false},
 {id:"3",name:"Red rush two",description:null,leaderName:"Bardock",leaderId:"SD15-01",colors:["Red"],group:"Virtual",mainCount:50,locked:true},
];
const f=emptyDeckFilters();
assert.deepEqual(filterDecks(choices,{...f,q:"  PATIENT shenron ",color:"Yellow",group:"Virtual"}).map(d=>d.id),["2"]);
assert.deepEqual(filterDecks(choices,{...f,q:"sd15-01",readyOnly:true}).map(d=>d.id),["1"]);
assert.deepEqual(filterDecks(choices,{...f,leader:"SD15-01",group:"Virtual"}).map(d=>d.id),["3"]);
assert.equal(filterDecks(choices,{...f,q:"no result"}).length,0);
assert.deepEqual(choices.map(d=>d.id),["1","2","3"],"filtering never mutates selection data or order");
const client=new PGlite();
const db=drizzle(client,{schema}) as unknown as Db;
try{
 for(const file of fs.readdirSync("drizzle").filter(f=>f.endsWith('.sql')).sort()) for(const sql of fs.readFileSync(path.join("drizzle",file),"utf8").split('--> statement-breakpoint')) if(sql.trim())await client.exec(sql);
 await db.insert(schema.cardSets).values({code:"TEST828",name:"Discovery test",line:"masters"});
 const card=(id:string,name:string,color:string,game="dbs",cardType="LEADER")=>({id,name,setCode:"TEST828",colors:[color],game,cardType,rarity:"Leader[L]",rarityCode:"L",searchText:`${id} ${name}`.toLowerCase()});
 await db.insert(schema.cards).values([
  ...Array.from({length:20},(_,i)=>card(`TEST828-${i}`,`Shared leader A${i}`,"Red")),
  card("TEST828-BLUE","Shared leader Z","Blue"),card("TEST828-FUSION","Shared leader Fusion","Blue","fusion"),
  card("TEST828-BATTLE","Shared battle","Blue","dbs","BATTLE"),
 ]);
 assert.equal((await quickSearch(db,"Shared",12,"LEADER","dbs")).length,12);
 assert.deepEqual((await quickSearch(db,"Shared",12,"LEADER","dbs","Blue")).map(c=>c.id),["TEST828-BLUE"],"colour/type/game narrow SQL before the capped result set");
 assert.deepEqual((await quickSearch(db,"Shared",15,"BATTLE","dbs","Blue")).map(c=>c.id),["TEST828-BATTLE"]);
 // A player's linked strategy notes remain scoped even when the same leader is used by another player.
 await db.insert(schema.cardPrints).values({id:"TEST828-BLUE",cardId:"TEST828-BLUE",rarity:"L",label:"Standard",isBase:true});
 await db.insert(schema.ownedCards).values({printId:"TEST828-BLUE",cardId:"TEST828-BLUE",owner:"alice"});
 const [a]=await db.insert(schema.decks).values({name:"Alice control",description:"Patient recovery",owner:"alice"}).returning();
 const [b]=await db.insert(schema.decks).values({name:"Bob private deck",description:"Private Bob notes",owner:"bob"}).returning();
 await db.insert(schema.deckCards).values([{deckId:a.id,cardId:"TEST828-BLUE",zone:"leader",quantity:1},{deckId:b.id,cardId:"TEST828-BLUE",zone:"leader",quantity:1}]);
 const leaders=await ownedLeaders(db,{viewer:"alice"});
 assert.equal(leaders.length,1);assert.deepEqual(leaders[0].decks.map(d=>[d.name,d.description]),[["Alice control","Patient recovery"]]);
}finally{await client.close();}
const facts=readPack({id:"fixture",hash:"hash",compatibility:{runtimeRevision:"828"},qualification:{playable:true},decks:[{key:"a",name:"My deck",deck:{leader:"LEADER-1",main:[]}}],bundle:{payload:{defs:{"LEADER-1":{name:"Resolved leader"}}}}});
assert.equal(facts.decks[0].leader,"Resolved leader","pack leader IDs resolve through definitions");
assert.throws(() => readPack({id:"bad",hash:"hash",compatibility:{runtimeRevision:"828"},qualification:{playable:true},decks:[{key:"a",deck:{leader:"x",main:[]}}]}),/invalid deck list|missing card definitions/,"a malformed pack is refused before metadata is rendered");
console.log("deck-discovery-828 ok: compound filters, pre-limit SQL, scoped descriptions and pack leader names");
