"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { AdminDebug } from "@/lib/arena/admin-debug";
import type { NumberedBeat } from "@/lib/arena/beats";
import type { Narrator } from "@/lib/arena/narration";
import { narrate } from "@/lib/arena/narration";
import type { Snapshot } from "@/lib/arena/snapshot";
import type { CardView } from "@/lib/arena/view";
import type { FlagLine } from "@/lib/arena/review-store";

/** The shield in the board's top bar: only ever rendered for an admin. */
export function AdminShield({ onOpen, className = "" }: { onOpen: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Open match debug (admin)"
      data-arena-admin="shield"
      className={`arena-iconbtn arena-iconbtn-admin tap flex h-11 w-11 items-center justify-center ${className}`}
    >
      <svg viewBox="0 0 24 24" className="h-[21px] w-[21px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6L12 3Z" />
        <path d="m9 12 2.2 2.2L15.5 10" />
      </svg>
    </button>
  );
}

function Cell({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`arena-admin-kv ${wide ? "arena-admin-kv-wide" : ""}`}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** The player who acted in a beat, when the beat names one. */
function beatPlayer(b: NumberedBeat): string | null {
  switch (b.t) {
    case "phase":
    case "draw":
    case "damage":
      return b.player;
    case "move":
    case "token":
    case "skill":
    case "effect":
    case "ko":
      return b.owner;
    default:
      return null;
  }
}

/** Every distinct card on the board (and the viewer's hand), for the engine-reading list. */
function cardsOnBoard(snapshot: Snapshot): CardView[] {
  const { you, them } = snapshot.view;
  const seen = new Set<string>();
  const out: CardView[] = [];
  for (const c of [you.leader, you.unison, ...you.battle, ...you.combo, ...(you.hand ?? []), them.leader, them.unison, ...them.battle, ...them.combo]) {
    if (!c || c.hidden || seen.has(c.cardId)) continue;
    seen.add(c.cardId);
    out.push(c);
  }
  return out;
}

/**
 * The admin drawer (issue #350, restyled in #446; frames `*-11-admin-debug-drawer.jpg`):
 * a right-hand panel on desktop, a full-screen sheet on a phone, a dark log table
 * in both skins. It holds what a player's board no longer shows — seed, the
 * opponent's hidden hand, the beat log with Claude's reasons, and how the engine
 * reads the cards in play. The legacy engine's own fields (its name, the raw log)
 * appear only for a game that is still on it.
 */
export function AdminDrawer({
  snapshot,
  debug,
  beats,
  log,
  narrator,
  onFlag,
  onClose,
}: {
  snapshot: Snapshot;
  debug: AdminDebug | null;
  beats: NumberedBeat[];
  log: string[];
  narrator: Narrator;
  /** Flags the game's current turn (`flagThisTurn`); the server reads the turn, this only carries the note. */
  onFlag: (note: string | null) => Promise<{ error: string | null; flag: FlagLine | null; created: boolean }>;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  // The latest onClose, read by the Escape listener. The board passes an
  // inline function and re-renders on every poll; depending on it would
  // re-run the focus below each time and pull focus out of the drawer.
  const closeFn = useRef(onClose);
  useEffect(() => {
    closeFn.current = onClose;
  }, [onClose]);
  useEffect(() => {
    closeRef.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeFn.current();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const { game, view } = snapshot;
  const [flags, setFlags] = useState<FlagLine[]>(debug?.flags ?? []);
  const [note, setNote] = useState("");
  const [flagging, setFlagging] = useState(false);
  const [flagMsg, setFlagMsg] = useState<string | null>(null);
  const flagThis = async () => {
    setFlagging(true);
    setFlagMsg(null);
    try {
      const r = await onFlag(note.trim() || null);
      if (r.error || !r.flag) setFlagMsg(r.error ?? "could not flag");
      else {
        const f = r.flag;
        setFlags((cur) => (cur.some((c) => c.id === f.id) ? cur : [...cur, f].sort((a, b) => a.turn - b.turn)));
        setFlagMsg(r.created ? `Turn ${f.turn} flagged.` : `Turn ${f.turn} was already flagged.`);
        setNote("");
      }
    } catch {
      setFlagMsg("could not flag");
    } finally {
      setFlagging(false);
    }
  };
  const versus = game.mode === "versus";
  const legacy = game.engine === "legacy";
  const youIs = view.you.player;
  const them = versus ? "THEM" : "CL";
  const youTurn = view.turnPlayer === youIs;
  const decisions = debug ? [...debug.decisions].reverse() : [];

  // The turn each beat belongs to: the latest phase beat at or before it.
  const beatRows: { b: NumberedBeat; turn: number | null }[] = [];
  for (const b of beats) beatRows.push({ b, turn: b.t === "phase" ? b.turn : (beatRows[beatRows.length - 1]?.turn ?? null) });
  beatRows.reverse().splice(120);
  const readings = cardsOnBoard(snapshot);
  const waiting = snapshot.waiting;

  const head = (
    <li className="arena-admin-row arena-admin-row-head" aria-hidden>
      <span>#</span>
      <span>T</span>
      <span>side</span>
      <span>beat</span>
      <span>detail</span>
    </li>
  );

  return (
    <div role="dialog" aria-modal="true" aria-label="Match debug" data-arena-admin="drawer" className="arena-admin">
      <header className="arena-admin-head">
        <span className="arena-admin-badge">Admin</span>
        <h2>Match debug</h2>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Close match debug" className="arena-admin-close tap">
          ×
        </button>
      </header>

      <div className="arena-admin-body">
        <p className="arena-admin-sub">Visible to admins only — players never see this. Flagged turns go to the review queue with the full beat log.</p>

        <dl className="arena-admin-grid">
          <Cell label="seed">{debug?.seed ?? "—"}</Cell>
          <Cell label="turn">
            {view.turn} · {youTurn ? "you" : "them"}
          </Cell>
          <Cell label="phase / AI stage">
            {view.phase}
            {waiting ? ` · ${waiting}` : ""}
          </Cell>
          <Cell label="deck (you / them)">
            {view.you.deck} / {view.them.deck}
          </Cell>
          {legacy && <Cell label="engine · prompt">legacy · {view.prompt.kind}</Cell>}
          <Cell label="flagged">{flags.length ? flags.map((f) => `T${f.turn}`).join(" ") : "none"}</Cell>
          <Cell label={`${view.them.name}'s hand (hidden info)`} wide>
            {debug?.theirHand ? (debug.theirHand.length ? debug.theirHand.join(", ") : "empty") : "not available"}
          </Cell>
        </dl>

        <section aria-label="Flag this turn" data-arena-admin="flag" className="arena-admin-flag">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} placeholder="Optional one-line note" aria-label="Note for the flag" className="tap" />
          <button type="button" onClick={flagThis} disabled={flagging} className="arena-admin-btn tap">
            Flag turn {view.turn}
          </button>
          {flagMsg && (
            <p role="status" className="arena-admin-sub">
              {flagMsg}
            </p>
          )}
          {flags.length > 0 && (
            <ul className="arena-admin-flags">
              {flags.map((f) => (
                <li key={f.id}>
                  <Link href={`/arena/review?game=${f.gameId}&turn=${f.turn}`}>Turn {f.turn}</Link>{" "}
                  <span>
                    {f.note ?? "no note"}
                    {f.resolved ? " · resolved" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link href={`/arena/${game.id}/debug`} className="arena-admin-link">
            {versus ? "what the server decided" : "how Claude played"} →
          </Link>
        </section>

        <h3 className="arena-admin-h">{versus ? "Server decisions" : "Claude's decisions"}</h3>
        {decisions.length === 0 ? (
          <p className="arena-admin-sub">Nothing recorded yet.</p>
        ) : (
          <ol className="arena-admin-log" data-arena-admin="decisions">
            {head}
            {decisions.map((d) => (
              <li key={d.seq} className={`arena-admin-row ${d.player === youIs ? "arena-admin-you" : "arena-admin-ai"}`}>
                <span>{d.seq}</span>
                <span>T{d.turn}</span>
                <span className="arena-admin-side">{d.player === youIs ? "YOU" : them}</span>
                <span className="arena-admin-kind">{d.promptKind}</span>
                <span>
                  {d.chosenLabel ?? "—"}
                  {d.menu && d.menu.length > 1 ? ` · legal ${d.menu.length}` : ""}
                  {d.decidedBy !== "claude" ? <em className={`arena-admin-by-${d.decidedBy}`}> · {d.decidedBy}</em> : null}
                </span>
                <span className="arena-admin-why">why: {d.how}</span>
                {d.say && <span className="arena-admin-say">“{d.say}”</span>}
                {d.menu && d.menu.length > 1 && (
                  <details className="arena-admin-menu">
                    <summary>the {d.menu.length} moves that were legal</summary>
                    <ol>
                      {d.menu.map((m, i) => (
                        <li key={i} className={i === d.chosenIndex ? "arena-admin-chosen" : ""}>
                          {i}. {m}
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
              </li>
            ))}
          </ol>
        )}

        <h3 className="arena-admin-h">Beats</h3>
        {beatRows.length === 0 ? (
          <p className="arena-admin-sub">No beats in the queue.</p>
        ) : (
          <ol className="arena-admin-log" data-arena-admin="beats">
            {head}
            {beatRows.map(({ b, turn }) => {
              const p = beatPlayer(b);
              return (
                <li key={b.n} className={`arena-admin-row ${p == null ? "" : p === youIs ? "arena-admin-you" : "arena-admin-ai"}`}>
                  <span>{b.n}</span>
                  <span>{turn != null ? `T${turn}` : "—"}</span>
                  <span className="arena-admin-side">{p == null ? "" : p === youIs ? "YOU" : them}</span>
                  <span className="arena-admin-kind">{b.t}</span>
                  <span>{narrate(b, narrator, undefined, { full: true }) ?? ""}</span>
                </li>
              );
            })}
          </ol>
        )}

        <h3 className="arena-admin-h">Engine reads — cards in play</h3>
        {readings.length === 0 ? (
          <p className="arena-admin-sub">No cards on the board.</p>
        ) : (
          <ul className="arena-admin-reads" data-arena-admin="reads">
            {readings.map((c) => (
              <li key={c.cardId} className={c.referee ? "arena-admin-ref" : ""}>
                <b>{c.name}</b>
                <span>{c.referee ? "Not fully compiled — Claude rules on this card's remaining text when it resolves." : c.reading || "no effect of its own"}</span>
              </li>
            ))}
          </ul>
        )}

        {legacy && (
          <>
            <h3 className="arena-admin-h">Raw engine log (legacy)</h3>
            <ol className="arena-admin-raw">
              {log.slice(-200).map((line, i) => (
                <li key={i} className={line.startsWith("—") ? "arena-admin-raw-turn" : ""}>
                  {line}
                </li>
              ))}
              {log.length === 0 && <li>nothing has happened yet</li>}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}
