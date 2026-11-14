"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { setDeckFormatAction } from "@/app/decks/actions";
import { deletePokemonDeckAction, renamePokemonDeckAction, setPokemonBuiltAction, setPokemonDeckCardAction, wishMissingAction } from "@/app/pokemon/decks/actions";
import type { PokemonTile } from "@/lib/pokemon/client";
import { PK } from "@/lib/pokemon/copy";
import { deckProgress, type IssueLine, type IssueSummary } from "@/lib/pokemon/deck-logic";
import { POKEMON_FORMATS } from "@/lib/pokemon/types";
import type { PokemonDeckRow } from "@/lib/pokemon/views";
import type { Zone } from "@/lib/decks/queries";
import { SwapSuggestions } from "@/components/SwapSuggestions";
import type { SwapSuggestion } from "@/lib/decks/swaps";
import { PokemonDeckClaude } from "./ClaudeBuild";
import { MiniArt, StatusPill } from "./DeckParts";
import { HeartIcon } from "./icons";
import { PokemonViewer } from "./PokemonViewer";
import { useWishes } from "./useWishes";

export interface DeckRowData {
  key: string;
  cardId: string;
  zone: Zone;
  quantity: number;
  /** POKEMON / TRAINER / ENERGY, or OTHER for a card outside the three groups or outside the main deck. */
  group: string;
  tile: PokemonTile;
  /** The deck owner's copies of this card. */
  owned: number;
  /** Copies the deck is short of (the card over all its rows). */
  missing: number;
  /** Copies the owner has wished for already. */
  wishedQty: number;
  limit: number;
  flag: { severity: IssueLine["severity"]; label: string } | null;
}

export interface DeckScreenDeck {
  id: number;
  name: string;
  format: string;
  isBuilt: boolean;
  count: number;
  status: "legal" | "incomplete" | "illegal";
  /** "von Mia": shown to an SL looking at somebody else's deck. */
  ownerLabel: string | null;
}

/**
 * Ein Deck (docs/pokemon/design.md §6). The numbers come from the server (`getDeck`, `legality`); a tap on
 * − or + shows at once and is saved, then the page is read again. Nothing here blocks an edit but the one
 * thing `setDeckCard` refuses: a built deck that would need more copies than she owns.
 */
export function DeckScreen({
  deck,
  issues,
  rows,
  groupOrder,
  missingTotal,
  viewerDecks,
  viewerWishedIds,
  suggestions,
  claude,
}: {
  deck: DeckScreenDeck;
  issues: IssueSummary;
  rows: DeckRowData[];
  groupOrder: readonly string[];
  missingTotal: number;
  viewerDecks: PokemonDeckRow[];
  viewerWishedIds: string[];
  /** Claude's stored swap suggestions, by the card they would replace. */
  suggestions: Record<string, SwapSuggestion[]>;
  claude: { enabled: boolean; aiSummary: string | null; aiSummaryAt: string | null; openSuggestions: number };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const progress = deckProgress(deck.count);
  const { wished, toggle, merge, notice, say } = useWishes(viewerWishedIds);

  // Copies shown before the server has answered: valid only while the server still says what it said.
  const [shown, setShown] = useState<Record<string, { from: number; to: number }>>({});
  const qtyOf = (r: DeckRowData) => (shown[r.key]?.from === r.quantity ? shown[r.key].to : r.quantity);
  const [wishedNow, setWishedNow] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState<number | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [builtNote, setBuiltNote] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(deck.name);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const failed = () => say(typeof navigator !== "undefined" && navigator.onLine === false ? PK.common.offline : PK.decks.changeFailed);

  const dropShown = (key: string) => setShown((s) => Object.fromEntries(Object.entries(s).filter(([k]) => k !== key)));

  function setQty(r: DeckRowData, to: number) {
    const next = Math.min(99, Math.max(0, to));
    setRefusal(null);
    setShown((s) => ({ ...s, [r.key]: { from: r.quantity, to: next } }));
    start(async () => {
      try {
        const res = await setPokemonDeckCardAction(deck.id, r.cardId, r.zone, next);
        if (!res.ok) {
          dropShown(r.key);
          setRefusal(res.message);
        }
      } catch {
        dropShown(r.key);
        failed();
      }
      router.refresh();
    });
  }

  function setFormat(f: string) {
    if (f === deck.format) return;
    start(async () => {
      try {
        await setDeckFormatAction(deck.id, f);
      } catch {
        failed();
      }
      router.refresh();
    });
  }

  function wishCard(r: DeckRowData) {
    setWishedNow((w) => ({ ...w, [r.cardId]: true }));
    start(async () => {
      try {
        await wishMissingAction(deck.id, r.cardId);
      } catch {
        setWishedNow((w) => ({ ...w, [r.cardId]: false }));
        failed();
      }
      router.refresh();
    });
  }

  function wishAll() {
    setBusy("wish");
    start(async () => {
      try {
        const r = await wishMissingAction(deck.id);
        say(r.missing === 0 ? PK.decks.wishMissingNone : r.added === 0 ? PK.decks.wishMissingAlready : PK.decks.wishMissingDone(r.added));
      } catch {
        failed();
      }
      setBusy(null);
      router.refresh();
    });
  }

  function toggleBuilt() {
    setRefusal(null);
    setBuiltNote(null);
    setBusy("built");
    start(async () => {
      try {
        const r = await setPokemonBuiltAction(deck.id, !deck.isBuilt);
        if (!r.ok) setRefusal(r.message);
        else if (deck.isBuilt) setBuiltNote(PK.decks.unbuilt);
      } catch {
        setRefusal(PK.decks.builtFailed);
      }
      setBusy(null);
      router.refresh();
    });
  }

  function rename() {
    const name = newName.trim();
    if (!name) return;
    start(async () => {
      try {
        const r = await renamePokemonDeckAction(deck.id, name);
        if (r.ok) setRenaming(false);
        else say(PK.decks.renameFailed);
      } catch {
        say(PK.decks.renameFailed);
      }
      router.refresh();
    });
  }

  function remove() {
    setBusy("delete");
    start(async () => {
      try {
        await deletePokemonDeckAction(deck.id);
        router.push("/pokemon/decks");
      } catch {
        failed();
        setBusy(null);
        setConfirming(false);
      }
    });
  }

  // The card rows by group, in the order the page sorted them.
  const order = [...groupOrder, "OTHER"];
  const groups = order
    .map((g) => ({ g, items: rows.map((r, i) => ({ r, i })).filter((x) => x.r.group === g) }))
    .filter((x) => x.items.length > 0);

  const renameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renaming) renameRef.current?.focus();
  }, [renaming]);

  return (
    <div className="pk-area" aria-busy={pending}>
      <div className="pk-top">
        <h1>
          <Link href="/pokemon/decks" className="pk-back" aria-label={PK.decks.back}>
            ‹
          </Link>{" "}
          <span className="pk-name">{deck.name}</span>
        </h1>
        <span className="pk-pill" aria-label={PK.common.cardsCount(deck.count)}>
          {deck.count} / 60
        </span>
      </div>

      <div className="pk-panel">
        <div className="pk-deckhead">
          <StatusPill status={deck.status} />
          <div className="pk-chips" role="group" aria-label={PK.decks.formatLabel}>
            {POKEMON_FORMATS.map((f) => (
              <button key={f} type="button" className="pk-chip" aria-pressed={deck.format === f} onClick={() => setFormat(f)} disabled={pending && deck.format !== f}>
                {PK.decks.formatNames[f]}
              </button>
            ))}
          </div>
        </div>
        <div className="pk-bar" role="progressbar" aria-label={PK.decks.progressAria} aria-valuemin={0} aria-valuemax={60} aria-valuenow={Math.min(60, deck.count)} data-state={progress.state}>
          <i style={{ width: `${progress.pct}%` }} />
        </div>
        <p className="pk-progress">{progress.text}</p>
        {issues.lines.length > 0 ? (
          <ul className="pk-issues">
            {issues.lines.map((l) => (
              <li key={l.text} data-sev={l.severity}>
                {l.text}
              </li>
            ))}
            {issues.more > 0 ? <li className="pk-more-issues">{PK.decks.moreIssues(issues.more)}</li> : null}
          </ul>
        ) : deck.status === "legal" ? (
          <p className="pk-note">{PK.decks.legalOk}</p>
        ) : null}
        {deck.ownerLabel ? <p className="pk-note pk-owner">{deck.ownerLabel}</p> : null}
        <div style={{ marginTop: 8 }}>
          {renaming ? (
            <form
              className="pk-renamebox"
              onSubmit={(e) => {
                e.preventDefault();
                rename();
              }}
            >
              <label className="pk-field" style={{ margin: 0 }}>
                <span>{PK.decks.renameLabel}</span>
                <input ref={renameRef} className="pk-input" value={newName} maxLength={120} onChange={(e) => setNewName(e.target.value)} enterKeyHint="done" />
              </label>
              <div className="pk-buttons" style={{ margin: 0, gridTemplateColumns: "1fr 1fr" }}>
                <button type="submit" className="pk-cta" disabled={pending || !newName.trim()}>
                  {PK.decks.renameSave}
                </button>
                <button type="button" className="pk-cta pk-cta-alt" onClick={() => { setRenaming(false); setNewName(deck.name); }}>
                  {PK.common.cancel}
                </button>
              </div>
            </form>
          ) : (
            <button type="button" className="pk-linkbtn" onClick={() => setRenaming(true)}>
              {PK.decks.rename}
            </button>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="pk-panel pk-empty">
          <p>{PK.decks.emptyDeck}</p>
        </div>
      ) : (
        groups.map(({ g, items }) => (
          <section key={g} className="pk-group" aria-label={PK.decks.groups[g] ?? PK.decks.groupOther}>
            <h2 className="pk-grouphead">
              <span>{PK.decks.groups[g] ?? PK.decks.groupOther}</span>
              <span>{items.reduce((n, x) => n + qtyOf(x.r), 0)}</span>
            </h2>
            <div className="pk-panel" style={{ padding: "4px 12px", marginBottom: 0 }}>
              {items.map(({ r, i }) => {
                const q = qtyOf(r);
                const missing = r.missing;
                const isWished = wishedNow[r.cardId] || r.wishedQty >= missing;
                return (
                  <div className="pk-drow" key={r.key}>
                    <button type="button" onClick={() => setOpen(i)} aria-label={PK.decks.openCard(r.tile.name)}>
                      <MiniArt src={r.tile.imageLow} name={r.tile.name} label={r.tile.name} />
                    </button>
                    <div>
                      <b>{r.tile.name}</b>
                      <small className={missing > 0 ? "pk-warn" : "pk-ok"}>
                        {missing > 0 ? `⚠ ${PK.decks.haveMissing(r.owned, missing)}` : `✓ ${PK.decks.have(r.owned)}`}
                      </small>
                      {r.flag ? (
                        <small className="pk-flagline" data-sev={r.flag.severity}>
                          {r.flag.label}
                        </small>
                      ) : null}
                      {missing > 0 ? (
                        <button type="button" className="pk-wishbtn" aria-pressed={isWished} aria-label={PK.decks.wishCardAria(r.tile.name, missing)} onClick={() => !isWished && wishCard(r)}>
                          <HeartIcon />
                          {isWished ? PK.decks.wishedCard : PK.decks.wishCard}
                        </button>
                      ) : null}
                    </div>
                    <div className="pk-qty" role="group" aria-label={PK.decks.amount(r.tile.name, q)}>
                      <button type="button" onClick={() => setQty(r, q - 1)} aria-label={PK.decks.less} disabled={q <= 0}>
                        −
                      </button>
                      <output aria-live="polite" data-over={q > r.limit ? 1 : 0}>
                        {q}
                      </output>
                      <button type="button" onClick={() => setQty(r, q + 1)} aria-label={PK.decks.more} disabled={q >= 99}>
                        +
                      </button>
                    </div>
                    {suggestions[r.cardId]?.length ? (
                      <div className="pk-claude" style={{ gridColumn: "1 / -1" }}>
                        <SwapSuggestions deckId={deck.id} zone={r.zone} suggestions={suggestions[r.cardId]} labels={PK.swaps} />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}

      <div className="pk-buttons" style={{ marginTop: 14 }}>
        <Link href={`/pokemon/discover?deck=${deck.id}`} prefetch={false} className="pk-cta">
          {PK.decks.findCards}
        </Link>
        <button type="button" className="pk-cta pk-cta-alt" onClick={wishAll} disabled={busy === "wish"}>
          <HeartIcon />
          {PK.decks.wishMissing}
          {missingTotal > 0 ? ` (${missingTotal})` : ""}
        </button>
      </div>

      <PokemonDeckClaude deckId={deck.id} enabled={claude.enabled} aiSummary={claude.aiSummary} aiSummaryAt={claude.aiSummaryAt} openSuggestions={claude.openSuggestions} />

      <div className="pk-panel" style={{ marginTop: 12 }}>
        <button type="button" className="pk-built" aria-pressed={deck.isBuilt} onClick={toggleBuilt} disabled={busy === "built"}>
          <i aria-hidden />
          <span>
            {deck.isBuilt ? PK.decks.builtOn : PK.decks.builtOff}
            <small>{PK.decks.builtHint}</small>
          </span>
        </button>
        {refusal ? (
          <p className="pk-refusal" role="alert">
            {refusal}
          </p>
        ) : null}
        {builtNote ? (
          <p className="pk-ok-note" role="status">
            {builtNote}
          </p>
        ) : null}
      </div>

      <div style={{ marginTop: 4, marginBottom: 8 }}>
        {confirming ? (
          <div className="pk-confirm" role="alertdialog" aria-label={PK.decks.deleteDeck}>
            <p>{PK.decks.deleteSure(deck.name)}</p>
            <div className="pk-buttons">
              <button type="button" className="pk-cta pk-cta-bad" onClick={remove} disabled={busy === "delete"}>
                {busy === "delete" ? PK.decks.deleting : PK.decks.deleteYes}
              </button>
              <button type="button" className="pk-cta pk-cta-alt" onClick={() => setConfirming(false)}>
                {PK.decks.deleteNo}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="pk-linkbtn pk-linkbtn-bad" onClick={() => setConfirming(true)}>
            {PK.decks.deleteDeck}
          </button>
        )}
      </div>

      <p role="status" aria-live="polite" className={notice ? "pk-live" : "sr-only"}>
        {notice}
      </p>

      {open !== null && rows[open] ? <PokemonViewer tiles={rows.map((r) => r.tile)} startIndex={open} decks={viewerDecks} wished={wished} onToggleWish={toggle} onWishKnown={(id) => merge([id])} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
