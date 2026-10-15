"use client";
import { useState } from "react";
import { PlayPicker, type PlayDeck } from "@/components/arena/PlayPicker";
import { DeckDiscovery } from "@/components/DeckDiscovery";
import { DeckBuilder } from "@/components/DeckBuilder";
import { NewDeckWithClaude } from "@/components/NewDeckWithClaude";
import { LocalMatchSetup } from "@/components/arena/session/LocalMatchSetup";
import type { PackFacts } from "@/components/arena/session/local-board";
export const setupDecks: PlayDeck[] = Array.from({length: 16}, (_, i) => ({
  id: i + 1, name: `Deck ${i + 1}: ${i % 2 ? "Shenron Wish — patient control and Dragon Ball recursion" : "Bardock’s Crew — a long deck name that must stay readable"}`,
  description: i===4 ? null : i%2 ? "Patient control: recover Dragon Balls and rebuild your hand before a late finish. Keep resources available for the opponent’s threats." : "Aggressive red strategy: pressure early, build a Saiyan board, then finish with a coordinated attack. ".repeat(4),
  colors: i%2 ? ["Blue","Yellow"] : ["Red"], isBuilt:i<8, leaderId:i%2?"SD5-01":"SD15-01",
  leaderName: i % 2 ? "Shenron, the Eternal Dragon" : "Bardock, the Resolute Warrior", leaderImage: null, mainCount: 50,
  ready: {open:i === 2 ? 1 : 0, incomplete:0,draft:0,corrected:0,confirmed:1,native:0,plain:0,unsupportedSkills:0,unknownSkills:0,confirmedSupportedSkills:1,confirmedUnsupportedSkills:0,confirmedUnknownSkills:0,openCards:[]}
}));
export function SetupPreview({ view = "online", local }: {view?:string;local?:PackFacts}) {
 const [submitted,setSubmitted]=useState<string>("");
 const [mine,setMine]=useState(local?.decks[0]?.key ?? ""); const [theirs,setTheirs]=useState(local?.decks[1]?.key ?? ""); const [seat,setSeat]=useState<"p1"|"p2">("p1");
 return <div data-setup-preview ref={(el)=>{if(el) el.dataset.ready="true";}} className="space-y-4">
   <p className="text-xs text-space-400">Development fixtures · no deck writes, AI calls or match starts</p>
   {view==="library" ? <DeckDiscovery label="Browse decks" decks={setupDecks.map((d)=>({id:String(d.id),name:d.name,description:d.description??null,colors:d.colors??[],leaderId:d.leaderId,leaderName:d.leaderName,group:d.isBuilt?"Built":"Virtual",mainCount:50,href:`/decks/${d.id}`,status:"legal"}))} />
   : view==="builder" ? <><DeckBuilder deckId={-1} game="dbs" /><NewDeckWithClaude enabled={false} /></>
   : view==="local" && local ? <LocalMatchSetup facts={local} mine={mine} theirs={theirs} seat={seat} setMine={setMine} setTheirs={setTheirs} setSeat={setSeat} busy={false} pendingLabel="" start={()=>setSubmitted(JSON.stringify({mine,theirs,seat}))} />
   : <PlayPicker decks={setupDecks} initialDeck={1} initialClaudeDeck={2} costs={{sparring:"~12¢ a game",tournament:"~25¢ a game"}} canVersus={true} versusNote="" action={(data)=>setSubmitted(JSON.stringify(Object.fromEntries(data)))} />}
   <output data-setup-submitted>{submitted}</output>
 </div>;
}
