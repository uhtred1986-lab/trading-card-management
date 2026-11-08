"use client";

import { DeckDiscovery, DeckFacts } from "@/components/DeckDiscovery";
import type { DiscoveryDeck } from "@/lib/decks/discovery";
import type { PackFacts } from "./local-board";
import { useRef } from "react";
import { JourneyDeckPicker } from "../PlayPicker";
import { MatchSetup } from "../MatchSetup";
import { Panel } from "@/components/ui";
import type { LocalDifficulty } from "@/lib/arena/local/protocol";

/** The two skills the owner asked for (8 Nov 2026), in the player's words. */
export const DIFFICULTY_CHOICES: { value: LocalDifficulty; label: string; hint: string }[] = [
  { value: "normal", label: "Normal", hint: "Thinks ahead, guessing the cards it cannot see." },
  { value: "hard", label: "Hard", hint: "Thinks ahead and knows which cards are in your deck (never your hand or their order)." },
];

const MISSING = "This device pack does not include deck descriptions. The leader and card list below help identify the deck.";

export function localDeckChoices(facts: PackFacts): DiscoveryDeck[] {
  return facts.decks.map((d) => {
    const list = facts.pack.decks.find((p) => p.key === d.key);
    const leaderId = list?.deck.leader;
    const leader = leaderId ? facts.pack.bundle.payload.defs[leaderId] : null;
    return { id:d.key, name:d.name, description:null, leaderName:d.leader,
      leaderId, leaderImage: leaderId ? facts.pack.bundle.payload.art[leaderId]?.front : null, colors:Array.isArray(leader?.colors) ? leader.colors.filter((c) => typeof c === "string") : [], group:d.isTesting ? "Testing" : d.key.startsWith("deck-") ? "Downloaded" : "Pack deck",
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

export function LocalMatchSetup({ facts, mine, theirs, seat, setMine, setTheirs, setSeat, difficulty = "normal", setDifficulty, busy, pendingLabel, start, artUrls }: {
  artUrls?: ReadonlyMap<string, string>;
  facts: PackFacts; mine:string; theirs:string; seat:"p1"|"p2";
  setMine:(id:string)=>void; setTheirs:(id:string)=>void; setSeat:(seat:"p1"|"p2")=>void;
  difficulty?: LocalDifficulty; setDifficulty?: (d: LocalDifficulty) => void;
  busy:boolean; pendingLabel:string; start:()=>void;
}) {
  const setup = useRef<HTMLDivElement>(null);
  const decks = localDeckChoices(facts).map((deck) => ({ ...deck, leaderImage: deck.leaderImage ? artUrls?.get(deck.leaderImage) ?? deck.leaderImage : null }));
  const own = decks.find((d) => d.id === mine);
  const other = decks.find((d) => d.id === theirs);
  return <section aria-label="New match" className="space-y-3">
    <Panel className="journey-picker-panel"><JourneyDeckPicker decks={decks} value={mine} onChange={setMine} disabled={busy} onContinue={() => {
      const mobile = setup.current?.querySelector<HTMLButtonElement>("[data-match-setup-open]");
      if (mobile && getComputedStyle(mobile).display !== "none") mobile.click();
      else { setup.current?.scrollIntoView({ block: "start" }); setup.current?.focus(); }
    }} /></Panel>
    <div ref={setup} tabIndex={-1} className="journey-setup space-y-3 outline-none">
    <div className="hidden sm:block"><p className="journey-eyebrow">LOCAL PRACTICE</p><h2 className="text-xl font-semibold text-space-100">Your next match</h2></div>
    <MatchSetup busy={busy} ownValid={!!own} opponentValid={!!other}
      own={<><DeckDiscovery label="Your deck" decks={decks} value={mine} onChange={setMine} disabled={busy} missingDescription={MISSING} /><LocalCards facts={facts} deckKey={mine} /></>}
      opponent={<div className="space-y-3"><p className="text-sm text-space-200">The built-in computer player runs on this device.</p>
        <DeckDiscovery label="Computer's deck" decks={decks} value={theirs} onChange={setTheirs} disabled={busy} missingDescription={MISSING} /><LocalCards facts={facts} deckKey={theirs} />
        <fieldset className="space-y-1"><legend className="text-sm text-space-200">Your seat</legend><div className="grid grid-cols-2 gap-2">{(["p1","p2"] as const).map((s) => <button data-setup-seat={s} key={s} type="button" aria-pressed={seat===s} onClick={()=>setSeat(s)} disabled={busy} className={`tap rounded-lg border px-3 py-2 text-sm ${seat===s ? "border-ki-500 bg-space-800 text-space-50" : "border-space-700 text-space-300"}`}>{s==="p1"?"First":"Second"}</button>)}</div></fieldset>
        {setDifficulty && <fieldset className="space-y-1"><legend className="text-sm text-space-200">Computer’s skill</legend><div className="grid grid-cols-2 gap-2">{DIFFICULTY_CHOICES.map((d) => <button data-setup-difficulty={d.value} key={d.value} type="button" aria-pressed={difficulty===d.value} onClick={()=>setDifficulty(d.value)} disabled={busy} className={`tap rounded-lg border px-3 py-2 text-sm ${difficulty===d.value ? "border-ki-500 bg-space-800 text-space-50" : "border-space-700 text-space-300"}`}>{d.label}</button>)}</div><p className="text-xs text-space-400">{DIFFICULTY_CHOICES.find((d) => d.value === difficulty)?.hint}</p></fieldset>}
      </div>}
      review={<div className="space-y-4"><h3 className="text-sm font-semibold text-space-200">You play {seat==="p1"?"first":"second"} · Computer opponent{setDifficulty ? ` (${DIFFICULTY_CHOICES.find((d) => d.value === difficulty)?.label ?? ""})` : ""}</h3><section className="space-y-2"><h3 className="text-sm text-space-400">Your deck</h3>{own && <DeckFacts deck={own} missingDescription={MISSING} />}</section><section className="space-y-2"><h3 className="text-sm text-space-400">Computer’s deck</h3>{other && <DeckFacts deck={other} missingDescription={MISSING} />}</section></div>}
      footer={<button type="button" className="tap w-full rounded-lg bg-ki-500 px-4 py-3 text-sm font-semibold text-space-950 disabled:opacity-40" disabled={busy || !own || !other} onClick={start}>{busy ? pendingLabel : "Start match"}</button>}
    />
    </div>
  </section>;
}
