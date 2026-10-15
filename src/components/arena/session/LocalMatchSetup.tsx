"use client";

import { DeckDiscovery, DeckFacts } from "@/components/DeckDiscovery";
import type { DiscoveryDeck } from "@/lib/decks/discovery";
import type { PackFacts } from "./local-board";
import { MatchSetup } from "../MatchSetup";

const MISSING = "This device pack does not include deck descriptions. The leader and card list below help identify the deck.";

export function localDeckChoices(facts: PackFacts): DiscoveryDeck[] {
  return facts.decks.map((d) => {
    const list = facts.pack.decks.find((p) => p.key === d.key);
    const leaderId = list?.deck.leader;
    const leader = leaderId ? facts.pack.bundle.payload.defs[leaderId] : null;
    return { id:d.key, name:d.name, description:null, leaderName:d.leader,
      leaderId, colors:Array.isArray(leader?.colors) ? leader.colors.filter((c) => typeof c === "string") : [], group:d.isTesting ? "Testing" : d.key.startsWith("deck-") ? "Downloaded" : "Pack deck",
      mainCount:list?.deck.main.length ?? 0, note:typeof list?.source === "string" ? list.source : undefined,
    };
  });
}

function LocalCards({ facts, deckKey }: { facts: PackFacts; deckKey: string }) {
  const list = facts.pack.decks.find((d) => d.key === deckKey)?.deck;
  if (!list) return null;
  const names = new Map<string,number>();
  for (const id of list.main) names.set(id,(names.get(id) ?? 0)+1);
  return <details><summary className="tap cursor-pointer py-2 text-sm text-ki-300">See the cards</summary><ul className="space-y-1 text-sm text-space-200">{[...names].map(([id,n]) => <li key={id} className="break-words">{n}× {facts.pack.bundle.payload.defs[id]?.name ?? id} · {id}</li>)}</ul></details>;
}

export function LocalMatchSetup({ facts, mine, theirs, seat, setMine, setTheirs, setSeat, busy, pendingLabel, start }: {
  facts: PackFacts; mine:string; theirs:string; seat:"p1"|"p2";
  setMine:(id:string)=>void; setTheirs:(id:string)=>void; setSeat:(seat:"p1"|"p2")=>void;
  busy:boolean; pendingLabel:string; start:()=>void;
}) {
  const decks = localDeckChoices(facts);
  const own = decks.find((d) => d.id === mine);
  const other = decks.find((d) => d.id === theirs);
  return <section aria-label="New match" className="space-y-3">
    <h2 className="text-sm font-semibold text-space-100">New match</h2>
    <MatchSetup busy={busy} ownValid={!!own} opponentValid={!!other}
      own={<><DeckDiscovery label="Your deck" decks={decks} value={mine} onChange={setMine} disabled={busy} missingDescription={MISSING} /><LocalCards facts={facts} deckKey={mine} /></>}
      opponent={<div className="space-y-3"><p className="text-sm text-space-200">The built-in computer player runs on this device and costs nothing.</p>
        <DeckDiscovery label="Computer's deck" decks={decks} value={theirs} onChange={setTheirs} disabled={busy} missingDescription={MISSING} /><LocalCards facts={facts} deckKey={theirs} />
        <fieldset className="space-y-1"><legend className="text-sm text-space-200">Your seat</legend><div className="grid grid-cols-2 gap-2">{(["p1","p2"] as const).map((s) => <button data-setup-seat={s} key={s} type="button" aria-pressed={seat===s} onClick={()=>setSeat(s)} disabled={busy} className={`tap rounded-lg border px-3 py-2 text-sm ${seat===s ? "border-ki-500 bg-space-800 text-space-50" : "border-space-700 text-space-300"}`}>{s==="p1"?"First":"Second"}</button>)}</div></fieldset>
      </div>}
      review={<div className="space-y-4"><h3 className="text-sm font-semibold text-space-200">You play {seat==="p1"?"first":"second"} · Computer opponent · Free</h3><section className="space-y-2"><h3 className="text-sm text-space-400">Your deck</h3>{own && <DeckFacts deck={own} missingDescription={MISSING} />}</section><section className="space-y-2"><h3 className="text-sm text-space-400">Computer’s deck</h3>{other && <DeckFacts deck={other} missingDescription={MISSING} />}</section></div>}
      footer={<button type="button" className="tap w-full rounded-lg bg-ki-500 px-4 py-3 text-sm font-semibold text-space-950 disabled:opacity-40" disabled={busy || !own || !other} onClick={start}>{busy ? pendingLabel : "Start match"}</button>}
    />
  </section>;
}
