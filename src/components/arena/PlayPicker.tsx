"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { DeckDiscovery, DeckFacts } from "@/components/DeckDiscovery";
import type { DiscoveryDeck } from "@/lib/decks/discovery";
import { MatchSetup } from "./MatchSetup";
import { SubmitButton } from "@/components/SubmitButton";
import { DeckPreviewSheet } from "./DeckPreviewSheet";
import { CardImage } from "@/components/CardImage";
import { Panel } from "@/components/ui";
import "./journey-entry.css";

export interface PlayDeck {
  id: number;
  name: string;
  isTesting?: boolean;
  description?: string | null;
  colors?: string[];
  leaderId?: string | null;
  isBuilt?: boolean;
  leaderName: string | null;
  leaderImage: string | null;
  mainCount: number;
  /** Rule readiness (`readiness.ts`): open rows lock; printed coverage and runtime support remain separate. */
  ready: {
    open: number; incomplete: number; draft: number; corrected: number; confirmed: number; native: number; plain: number;
    unsupportedSkills: number; unknownSkills: number;
    confirmedSupportedSkills: number; confirmedUnsupportedSkills: number; confirmedUnknownSkills: number;
    openCards: { id: string; name: string }[];
  };
}

const RING = "○";
const HALF = "◐";
const DOT = "●";

type Opponent = "sparring" | "tournament" | "versus" | "hotseat";

/**
 * The Play form (#356): your deck, the opponent, one button.
 *
 * Three hidden inputs are the whole contract with `startGameForm`: `deck`,
 * `opponent` and `claudeDeck`. The engine and the debug record are not asked
 * about. The readiness strip sits under the deck; a deck with an open rule is
 * Locked here and refused again by the server (#357). The Continue strip
 * (ah-05) goes above the form.
 */
export function PlayPicker({
  decks,
  initialDeck,
  initialClaudeDeck,
  canVersus,
  versusNote,
  action,
  showTestingDecks,
  testingToggleHref,
  hiddenTestingDeckName,
}: {
  decks: PlayDeck[];
  initialDeck: number;
  initialClaudeDeck: number;
  costs: { sparring: string; tournament: string };
  canVersus: boolean;
  versusNote: string;
  action: (formData: FormData) => void | Promise<void>;
  showTestingDecks: boolean;
  testingToggleHref: string;
  hiddenTestingDeckName: string | null;
}) {
  const setup = useRef<HTMLDivElement>(null);
  const [deckId, setDeckId] = useState(initialDeck);
  const [claudeDeck, setClaudeDeck] = useState(initialClaudeDeck);
  const [friend, setFriend] = useState(false);
  const [friendKind, setFriendKind] = useState<"versus" | "hotseat">(canVersus ? "versus" : "hotseat");
  const [claudeKind, setClaudeKind] = useState<"sparring" | "tournament">("sparring");

  const opponent: Opponent = friend ? friendKind : claudeKind;
  const index = Math.max(0, decks.findIndex((d) => d.id === deckId));
  const deck = decks[index];
  const needsOtherDeck = opponent !== "versus";
  const locked = (d: PlayDeck) => d.ready.open > 0;
  const readyDecks = decks.filter((d) => !locked(d));
  const isLocked = locked(deck);
  // "Next ready deck" walks forward from the current position and wraps.
  const nextReady = decks.map((_, i) => decks[(index + 1 + i) % decks.length]).find((d) => !locked(d));
  const other = decks.find((d) => d.id === claudeDeck);
  const otherLocked = needsOtherDeck && !!other && locked(other);
  const invite = opponent === "versus";

  const chip = (on: boolean, off = false) =>
    `tap rounded-lg border px-3 py-2 text-left text-sm ${off ? "cursor-not-allowed opacity-50" : ""} ${on ? "border-ki-500 bg-space-800 text-space-50" : "border-space-600 bg-space-900 text-space-200"}`;

  const choices: DiscoveryDeck[] = decks.map((d) => ({
    id: String(d.id), name: d.name, description: d.description ?? null,
    colors: d.colors ?? [], leaderId: d.leaderId, leaderName: d.leaderName, leaderImage: d.leaderImage,
    group: d.isBuilt ? "Built" : "Virtual", mainCount: d.mainCount, locked: locked(d), note: d.isTesting ? "Testing deck" : undefined,
  }));
  const own = <section aria-label="Your deck" className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-space-400">Testing decks are {showTestingDecks ? "shown" : "hidden by default"}.</p>
      <Link href={testingToggleHref} className="tap rounded-md border border-space-700 px-2.5 py-1.5 text-xs text-space-300 hover:border-ki-500/60 hover:text-space-50" aria-label={showTestingDecks ? "Hide testing decks" : "Show testing decks"}>
        {showTestingDecks ? "Hide testing decks" : "Show testing decks"}
      </Link>
    </div>
    {hiddenTestingDeckName ? <p className="text-xs text-space-400">The link points to testing deck <span className="font-medium text-space-200">{hiddenTestingDeckName}</span>. It stays hidden until you show testing decks above.</p> : null}
    <DeckDiscovery label="Your deck" decks={choices} value={String(deckId)} onChange={(id) => setDeckId(Number(id))} />
    <DeckPreviewSheet deckId={deck.id} deckName={deck.name} />
    <Link href={`/decks/${deck.id}`} className="tap inline-flex min-h-10 items-center text-xs font-medium text-ki-300 hover:text-ki-200">Open selected deck details →</Link>
    <details><summary className="tap cursor-pointer py-2 text-sm text-space-300">Rule readiness{isLocked ? " — locked" : ""}</summary><Readiness deck={deck} /></details>
    <p className="text-xs text-space-400">Masters decks only. Fusion World uses different rules.</p>
  </section>;
  const opponentSection = <div className="space-y-3">
      <section aria-label="Opponent" className="space-y-2">
        <h2 className="text-xs uppercase tracking-widest text-space-400">Opponent</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {/* The built-in computer has its own setup on this device (#896); it costs no AI tokens. */}
          <Link href="/arena/offline" data-opponent-computer className={`${chip(false)} block`}>
            <span className="block font-medium">Built-in computer · Free</span>
            <span className="block text-[11px] text-space-400">On this device, no AI tokens →</span>
          </Link>
          <button type="button" aria-pressed={!friend && claudeKind === "sparring"} onClick={() => { setFriend(false); setClaudeKind("sparring"); }} className={chip(!friend && claudeKind === "sparring")}>
            <span className="block font-medium">Claude · Sparring</span>
            <span className="block text-[11px] text-space-400">Practice and learn · uses AI tokens</span>
          </button>
          <button type="button" aria-pressed={!friend && claudeKind === "tournament"} onClick={() => { setFriend(false); setClaudeKind("tournament"); }} className={chip(!friend && claudeKind === "tournament")}>
            <span className="block font-medium">Claude · Tournament</span>
            <span className="block text-[11px] text-space-400">A competitive match · uses AI tokens</span>
          </button>
          <button type="button" aria-pressed={friend} onClick={() => setFriend(true)} className={chip(friend)}>
            <span className="block font-medium">A friend</span>
            <span className="block text-[11px] text-space-400">Play together</span>
          </button>
        </div>
        {friend && (
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" disabled={!canVersus} aria-pressed={friendKind === "versus"} onClick={() => setFriendKind("versus")} className={chip(friendKind === "versus", !canVersus)}>
              <span className="block font-medium">On their device</span>
              <span className="block text-[11px] text-space-400">{canVersus ? "1 v 1. They join and pick their own deck." : versusNote}</span>
            </button>
            <button type="button" aria-pressed={friendKind === "hotseat"} onClick={() => setFriendKind("hotseat")} className={chip(friendKind === "hotseat")}>
              <span className="block font-medium">Pass-and-play here</span>
              <span className="block text-[11px] text-space-400">Both sides on this device.</span>
            </button>
          </div>
        )}
      </section>

    {needsOtherDeck && <>
      <DeckDiscovery label={friend ? "Second player's deck" : "Claude's deck"} decks={choices} value={String(claudeDeck)} onChange={(id) => setClaudeDeck(Number(id))} readyOnly disableLocked />
      {other && <DeckPreviewSheet deckId={other.id} deckName={other.name} />}
    </>}
  </div>;
  const footer = <>
      <div className="space-y-2">
        {isLocked ? (
          <>
            {/* Computer: Rules is one click away. */}
            <Link href={`/arena/rules?deck=${deck.id}&state=open`} className="tap hidden w-full items-center justify-center rounded-lg bg-loss px-4 py-3 text-sm font-bold uppercase tracking-wider text-space-950 sm:flex">
              Fix {deck.ready.open} card{deck.ready.open === 1 ? "" : "s"} to play
            </Link>
            {/* Phone: Rules is made for the computer, so move to a deck that can be played. */}
            <button type="button" disabled={!nextReady} onClick={() => nextReady && setDeckId(nextReady.id)} className="tap w-full rounded-lg bg-ki-500 px-4 py-3 text-sm font-bold uppercase tracking-wider text-space-950 disabled:opacity-40 sm:hidden">
              Pick a ready deck
            </button>
            <p className="text-center text-[11px] text-space-400 sm:hidden">
              {readyDecks.length} of your {decks.length} decks {readyDecks.length === 1 ? "is" : "are"} ready.
            </p>
          </>
        ) : otherLocked ? (
          <button type="button" disabled className="tap w-full rounded-lg bg-space-700 px-4 py-3 text-sm font-bold uppercase tracking-wider text-space-300 opacity-70">
            Choose a ready deck for {friend ? "the second player" : "Claude"}
          </button>
        ) : (
          <SubmitButton pendingLabel={invite ? "Opening…" : "Flipping…"} className="tap w-full rounded-lg bg-ki-500 px-4 py-3 text-sm font-bold uppercase tracking-wider text-space-950">
            {invite ? "Invite a friend" : "Start match →"}
          </SubmitButton>
        )}
        <p className={`text-center text-[11px] text-space-400 ${isLocked || otherLocked ? "hidden" : ""}`}>{invite ? "They get a waiting room and choose their own deck." : "The coin flip comes first, then each side may mulligan once."}</p>
      </div>
  </>;
  return <div className="journey-entry space-y-5">
    <Panel className="journey-picker-panel"><JourneyDeckPicker decks={choices} value={String(deckId)} onChange={(id) => setDeckId(Number(id))} onContinue={() => {
      const mobile = setup.current?.querySelector<HTMLButtonElement>("[data-match-setup-open]");
      if (mobile && getComputedStyle(mobile).display !== "none") mobile.click();
      else { setup.current?.scrollIntoView({ block: "start" }); setup.current?.focus(); }
    }} /></Panel>
    <div ref={setup} tabIndex={-1} className="journey-setup space-y-3 outline-none">
    <div className="hidden sm:block"><p className="journey-eyebrow">MATCH SETUP</p><h2 className="text-xl font-semibold text-space-50">Your next match</h2><p className="text-sm text-space-300">Choose your opponent, then start.</p></div>
    <MatchSetup action={action} own={own} opponent={opponentSection} ownValid={!isLocked} opponentValid={!otherLocked && (!needsOtherDeck || !!other)}
    fields={<><input type="hidden" name="deck" value={deckId} /><input type="hidden" name="opponent" value={opponent} /><input type="hidden" name="claudeDeck" value={claudeDeck} /></>}
    review={<div className="space-y-4"><section className="space-y-2"><h3 className="text-sm font-semibold text-space-300">You play</h3><DeckFacts deck={choices[index]} /></section>
      <section className="space-y-2"><h3 className="text-sm font-semibold text-space-300">{invite ? "Friend on their device" : friend ? "Second player" : `Claude · ${claudeKind === "sparring" ? "Sparring" : "Tournament"}`}</h3>
      {invite ? <p className="text-sm text-space-200">Your friend chooses their own deck after joining.</p> : other && <DeckFacts deck={choices.find((d) => d.id === String(other.id))!} />}</section></div>}
    footer={footer} /></div></div>;
}
/**
 * The stacked bar and the four counts. Each state also differs in shape (ring,
 * half, filled), so the bar never relies on hue alone (spec §3).
 */
function Readiness({ deck }: { deck: PlayDeck }) {
  const r = deck.ready;
  const cells = [
    { key: "open", label: "open", n: r.open, glyph: RING, bar: "bg-loss", text: "text-loss" },
    { key: "incomplete", label: "incomplete", n: r.incomplete, glyph: "◌", bar: "bg-loss/60", text: "text-loss" },
    { key: "draft", label: "draft", n: r.draft, glyph: HALF, bar: "bg-dbs-blue", text: "text-dbs-blue" },
    { key: "corrected", label: "corrected", n: r.corrected, glyph: DOT, bar: "bg-ki-500", text: "text-ki-300" },
    { key: "confirmed", label: "confirmed", n: r.confirmed, glyph: DOT, bar: "bg-gain", text: "text-gain" },
  ];
  const total = cells.reduce((n, c) => n + c.n, 0);
  return (
    <div className="space-y-1.5 rounded-lg bg-space-900/50 p-2 text-xs" aria-label="Rule readiness and runtime support">
      <div className="flex h-2 overflow-hidden rounded-full bg-space-800" aria-hidden>
        {cells.map((c) => c.n > 0 && <span key={c.key} className={c.bar} style={{ width: `${(c.n / Math.max(1, total)) * 100}%` }} />)}
      </div>
      <p className="flex flex-wrap gap-x-3 gap-y-0.5">
        {cells.map((c) => (
          <span key={c.key} className={c.n > 0 ? c.text : "text-space-500"}>
            <span aria-hidden>{c.glyph}</span> {c.n} {c.label}
          </span>
        ))}
        {r.native > 0 && <span className="text-space-400">{r.native} native keyword only</span>}
        {r.plain > 0 && <span className="text-space-500">{r.plain} no skill text</span>}
      </p>
      <p className="text-space-300">
        Confirmed skills: {r.confirmedSupportedSkills} supported · {r.confirmedUnsupportedSkills} unsupported · {r.confirmedUnknownSkills} support unknown.
        {r.incomplete > 0 && <span className="text-loss"> {r.incomplete} card{r.incomplete === 1 ? " has" : "s have"} missing printed-skill records.</span>}
      </p>
      {r.unsupportedSkills > 0 && <p className="text-loss">{r.unsupportedSkills} current skill record{r.unsupportedSkills === 1 ? " has" : "s have"} a known runtime gap.</p>}
      {r.unknownSkills > r.confirmedUnknownSkills && <p className="text-ki-300">{r.unknownSkills - r.confirmedUnknownSkills} additional skill{r.unknownSkills - r.confirmedUnknownSkills === 1 ? " has" : "s have"} runtime support not yet verified.</p>}
      {r.open > 0 ? (
        <div className="rounded-md border border-loss/60 bg-loss/10 p-2 text-loss">
          <p className="font-semibold">
            {r.open} card{r.open === 1 ? " has" : "s have"} no rule yet
          </p>
          <p className="mt-0.5 text-space-200">
            {/* Computer: each name links into Rules. */}
            <span className="hidden sm:inline">
              {r.openCards.map((c, i) => (
                <span key={c.id}>
                  {i > 0 && ", "}
                  <Link href={`/arena/rules?deck=${deck.id}&state=open&q=${encodeURIComponent(c.id)}`} className="underline hover:text-space-50">
                    {c.name}
                  </Link>
                </span>
              ))}
            </span>
            {/* Phone: no link, Rules is for the computer. */}
            <span className="sm:hidden">{r.openCards.map((c) => c.name).join(", ")}</span>
          </p>
          <p className="mt-1 text-space-300 sm:hidden">The engine would play them as blank. Check them here, then this deck unlocks.</p>
          {/* The phone's rule review (#472), scoped to this deck: open skills first. */}
          <Link href={`/arena/rules/review?deck=${deck.id}`} className="tap mt-2 flex w-full items-center justify-center rounded-lg border border-loss/70 bg-loss/15 px-3 text-sm font-bold text-space-50 hover:bg-loss/25">
            Review {r.open} card{r.open === 1 ? "" : "s"} now
          </Link>
        </div>
      ) : (
        <p className="text-gain">
          All open rules are cleared
          {r.draft > 0 && (
            <span className="text-space-400">
              {" "}
              · {r.draft} draft{r.draft === 1 ? "" : "s"} not yet checked, they play as read.
            </span>
          )}
        </p>
      )}
    </div>
  );
}

/** The visible entry uses the same selection as the setup form; it never starts a match. */
export function JourneyDeckPicker({ decks, value, onChange, onContinue, disabled = false }: {
  decks: DiscoveryDeck[]; value: string; onChange: (id: string) => void; onContinue: () => void; disabled?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(6);
  const selected = decks.find((d) => d.id === value);
  const query = search.trim().toLowerCase();
  const filtered = decks.filter((d) => [d.name, d.leaderName, d.leaderId, d.description, ...d.colors].filter(Boolean).join(" ").toLowerCase().includes(query));
  return <section aria-label="Choose a deck to play" className="space-y-4">
    <div><p className="journey-eyebrow">DRAGON BALL · MASTERS ARENA</p><h2 className="text-2xl font-semibold text-space-50">Ready to play?</h2><p className="mt-1 text-sm text-space-300">Your cards. Your next match.</p></div>
    {selected && <div className="journey-deck-hero">
      <div className="journey-hero-art"><CardImage src={selected.leaderImage} alt={selected.leaderName ?? "Leader image unavailable"} sizes="140px" /></div>
      <div className="min-w-0 space-y-2"><p className="journey-eyebrow">SELECTED DECK</p><h3 className="break-words text-xl font-semibold text-space-50">{selected.name}</h3><p className="break-words text-sm text-space-200">{selected.leaderName ?? "No leader yet"}</p><p className="text-xs text-space-300">{selected.colors.join(" / ")}{selected.colors.length ? " · " : ""}{selected.mainCount} main cards · Masters</p><span className={`journey-status ${selected.locked ? "text-loss" : "text-gain"}`}>{selected.locked ? "Open rules need review" : selected.locked === false ? "Ready to play" : "Device deck"}</span></div>
      <button type="button" disabled={disabled} onClick={onContinue} className="journey-play tap">{selected.locked ? "Review selected deck" : "Play selected deck →"}</button>
    </div>}
    <div className="flex items-center justify-between gap-3"><h3 className="font-semibold text-space-100">Your decks</h3><span className="text-xs text-space-400">{decks.length} available</span></div>
    <label className="block"><span className="sr-only">Find a deck</span><input type="search" placeholder="Find a deck or leader…" value={search} disabled={disabled} onChange={(e) => { setSearch(e.target.value); setLimit(6); }} className="tap w-full rounded-xl border border-space-600 bg-space-900 px-4 py-3 text-sm text-space-100" /></label>
    <ul className="journey-decks">{filtered.slice(0, limit).map((d) => <li key={d.id}><button data-deck-choice={d.id} type="button" disabled={disabled} aria-pressed={d.id === value} onClick={() => onChange(d.id)} className="journey-deck tap">
      <span className="journey-tile-art"><CardImage src={d.leaderImage} alt="" sizes="64px" /></span><span className="min-w-0 flex-1"><strong className="block break-words text-sm text-space-50">{d.name}</strong><span className="mt-1 block break-words text-xs text-space-300">{d.leaderName ?? "No leader yet"} · {d.mainCount} cards</span><span className="mt-2 block text-xs text-space-300">{d.id === value ? "✓ Selected" : d.locked ? "Rules to review" : d.colors.join(" / ") || d.group}</span></span><span aria-hidden className="text-ki-300">›</span>
    </button></li>)}</ul>
    {!filtered.length && <p role="status" className="text-sm text-space-300">No decks match. Try another name or leader.</p>}
    {filtered.length > limit && <button type="button" onClick={() => setLimit(limit + 6)} className="tap w-full rounded-lg border border-space-600 p-3 text-sm text-ki-300">Show more decks</button>}
  </section>;
}
