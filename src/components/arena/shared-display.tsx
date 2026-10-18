"use client";
import { CardReader } from "./CardReader";

import { useEffect, useRef, useState } from "react";
import { useArenaAdmin } from "./admin-context";
import type { Spotlight } from "@/lib/arena/games";
import type { BoardView, CardView } from "@/lib/arena/view";
import { CardDetail, ChipRow, type InspectorChip } from "./shared-sheets";

export type { InspectorChip };
import { DEFAULT_NARRATOR, plainText, type Narrator } from "./shared-model";
import { newestFirst, type StoryLine } from "@/lib/arena/story";
import { cardImage } from "@/lib/catalog/card-image";
import { useCardEndpoints } from "./stage/use-card-endpoints";

export function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-1 rounded bg-space-950/50 px-1.5 py-0.5">
      <dt className="text-space-500">{label}</dt>
      <dd className="arena-num text-space-100">{value}</dd>
    </div>
  );
}

/**
 * The cards a report could be about: everything either player can see. Hidden
 * cards are left out, because naming one would say more than the board does.
 */
export function cardsOnTable(view: BoardView): { cardId: string; name: string }[] {
  const out: { cardId: string; name: string }[] = [];
  for (const side of [view.you, view.them]) {
    for (const c of [side.leader, side.unison, ...side.battle, ...side.combo, ...side.energy, ...(side.hand ?? [])]) {
      if (c && !c.hidden) out.push({ cardId: c.cardId, name: c.name });
    }
  }
  return out;
}

const STEP_LABELS: Record<string, string> = {
  "phase:charge": "Charge Phase",
  "phase:main": "Main Phase",
  "phase:mainEnd": "Main Phase",
  "phase:end": "End Phase",
  "battle:declared": "Attack!",
  "battle:offense": "Offense Step",
  "battle:defense": "Defense Step",
  "battle:damage": "Damage Step",
};

/**
 * The phase and battle-step banner. It appears at once, stays for `ms` (the
 * same number its phase beat is given, so the banner and the story agree) and
 * is gone, whatever the game is waiting for afterwards.
 *
 * While a story is playing, the banner follows the story rather than the live
 * board: the board already shows where the turn ended up, so a step change read
 * off it announced the wrong phase, late. `cue` is the phase the beat on screen
 * names (`phase:main`); `playing` silences the board-driven path, which takes
 * over again when the story ends (a battle step the story stopped on is
 * announced then, for the decision it leaves).
 *
 * `hold` is a turn banner being on screen or still due: the phase waits for it
 * and plays straight after, so the two never stack (issue #344).
 */
export function StepBanner({ step, hold = false, ms = 1000, playing = false, cue = null }: { step: string; hold?: boolean; ms?: number; playing?: boolean; cue?: { n: number; key: string } | null }) {
  const [shown, setShown] = useState<{ key: number; text: string } | null>(null);
  const prev = useRef<string | null>(null);
  const due = useRef<string | null>(null);
  const wasPlaying = useRef(false);
  const cueSeen = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (prev.current !== step) {
      const first = prev.current === null;
      prev.current = step;
      due.current = first || playing ? null : (STEP_LABELS[step] ?? null);
    }
    if (wasPlaying.current && !playing && step.startsWith("battle:")) due.current = STEP_LABELS[step] ?? null;
    wasPlaying.current = playing;
    // The phase the story is on right now plays at once, even while a later turn
    // banner is still due: that one is for a beat further on.
    let text: string | null = null;
    if (cue && cueSeen.current !== cue.n) {
      cueSeen.current = cue.n;
      text = STEP_LABELS[cue.key] ?? null;
    }
    if (!text && !hold && due.current) {
      text = due.current;
      due.current = null;
    }
    if (!text) return;
    setShown({ key: Date.now(), text });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(null), ms);
  }, [step, hold, playing, cue, ms]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  if (!shown) return null;
  return (
    // A compact chip under the top bar, not a scene in the middle of the board:
    // phases come often, and the cards stay visible while it names the phase.
    <div className="pointer-events-none fixed inset-x-0 top-[3.75rem] z-30 flex justify-center px-2" aria-hidden data-step-banner={shown.text}>
      <p key={shown.key} style={{ animationDuration: `${ms}ms` }} className="arena-banner arena-notice arena-impact select-none rounded-full px-4 py-1.5 text-base font-black uppercase italic tracking-wide text-space-50 sm:text-xl">
        {shown.text}
      </p>
    </div>
  );
}

/**
 * A skill firing, shown as a card: its art, its name and a short tag, centred under the top bar for
 * about two seconds. The rules text is one tap away ("read") and shown from the start only to an SL;
 * a player does not need a paragraph to know which card just did something. Never draggable, never
 * blocks the board: only the small controls take taps.
 */
export function SkillSpotlight({ spotlight }: { spotlight: (Spotlight & { imageUrl: string | null }) | null }) {
  const admin = useArenaAdmin();
  const [shown, setShown] = useState<(Spotlight & { imageUrl: string | null }) | null>(null);
  const [expanded, setExpanded] = useState(false);
  const seen = useRef<number | null>(null);

  useEffect(() => {
    if (!spotlight || seen.current === spotlight.seq) return;
    seen.current = spotlight.seq;
    setShown(spotlight);
    setExpanded(false);
  }, [spotlight]);

  const shownSeq = shown?.seq;
  useEffect(() => {
    if (shownSeq == null || expanded) return;
    const timer = setTimeout(() => setShown(null), admin ? 4000 : 2200);
    return () => clearTimeout(timer);
  }, [shownSeq, expanded, admin]);

  if (!shown) return null;
  const showText = expanded || admin;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[3.75rem] z-40 flex justify-center px-2 sm:top-16" aria-live="polite" data-skill-spotlight={shown.seq}>
      <div className={`arena-drop arena-float pointer-events-auto relative flex w-[min(19rem,100%)] gap-2 rounded-xl border-l-4 bg-space-900/95 p-2 pr-8 backdrop-blur ${shown.unread && admin ? "border-dbs-yellow" : "border-ki-500"}`}>
        <button
          type="button"
          onClick={() => {
            setShown(null);
          }}
          className="tap absolute right-0 top-0 flex h-11 w-9 items-center justify-center text-space-400 hover:text-space-50"
          aria-label="Dismiss"
        >
          ×
        </button>
        {shown.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- transient overlay, art already loaded by the board.
          <img src={cardImage(shown.imageUrl, "thumb")} alt="" className="card-aspect h-16 shrink-0 rounded object-cover sm:h-20" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-space-50">{shown.name}</p>
          <span className="mt-0.5 inline-block rounded bg-ki-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ki-300">{shown.label}</span>
          {showText ? (
            <p className={`mt-1 whitespace-pre-wrap text-[11px] leading-snug text-space-200 sm:text-xs ${expanded ? "max-h-48 overflow-y-auto pr-1" : "line-clamp-3"}`}>{plainText(shown.text)}</p>
          ) : (
            <button type="button" onClick={() => setExpanded(true)} className="tap mt-0.5 block text-[10px] font-semibold uppercase tracking-wide text-ki-300 hover:text-ki-400">
              read
            </button>
          )}
          {shown.unread && admin && <p className="mt-1 text-[10px] font-semibold text-dbs-yellow">The referee ruled on this card&apos;s text.</p>}
        </div>
      </div>
    </div>
  );
}

export function AttackBeam({ from, to, hostRef }: { from: string; to: string; hostRef: React.RefObject<HTMLDivElement | null> }) {
  const endpoints = useCardEndpoints(from, to, hostRef);
  if (!endpoints) return null;
  const { from: a, to: b } = endpoints;
  const line = { x1: a.x + a.w / 2, y1: a.y + a.h / 2, x2: b.x + b.w / 2, y2: b.y + b.h / 2 };
  const cx = (line.x1 + line.x2) / 2;
  const cy = (line.y1 + line.y2) / 2 - Math.max(40, Math.abs(line.x2 - line.x1) / 5);
  const d = `M ${line.x1} ${line.y1} Q ${cx} ${cy} ${line.x2} ${line.y2}`;
  return (
    <svg data-attack-beam={`${from}:${to}`} className="pointer-events-none absolute inset-0 z-20 h-full w-full overflow-visible" aria-hidden>
      <path d={d} fill="none" stroke="var(--color-ki-500)" strokeOpacity={0.25} strokeWidth={12} strokeLinecap="round" />
      <path d={d} fill="none" stroke="var(--color-ki-300)" strokeWidth={3} strokeLinecap="round" />
      <circle cx={line.x2} cy={line.y2} r={7} fill="var(--color-ki-400)" fillOpacity={0.35} />
      <circle cx={line.x2} cy={line.y2} r={3.5} fill="var(--color-ki-300)" />
    </svg>
  );
}

export function CardPreview({ card, box, narrator = DEFAULT_NARRATOR }: { card: CardView; box: DOMRect; narrator?: Narrator }) {
  const width = 300;
  const gap = 14;
  const toRight = box.right + gap;
  const left = toRight + width < window.innerWidth ? toRight : Math.max(gap, box.left - gap - width);
  const lower = box.top + box.height / 2 > window.innerHeight / 2;
  const edge = lower ? { bottom: gap } : { top: Math.max(gap, box.top - 40) };

  return (
    <div
      className="arena-float pointer-events-none fixed z-40 hidden max-h-[calc(100dvh-1.75rem)] overflow-hidden rounded-2xl border border-space-600 bg-space-900/95 p-3 backdrop-blur sm:block"
      style={{ left, width, ...edge }}
      aria-hidden
    >
      {card.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- transient overlay; the board has already loaded this URL.
        <img src={cardImage(card.imageUrl, "medium")} alt="" className="card-aspect mb-2 w-full rounded-lg object-cover" />
      )}
      <CardDetail card={card} withName narrator={narrator} />
    </div>
  );
}

/**
 * The narration log's rows (#350), newest first, a turn heading whenever the
 * turn changes. Children of an `<ol>`; empty reads as "nothing has happened yet".
 */
export function StoryList({ story }: { story: StoryLine[] }) {
  const rows = newestFirst(story);
  if (rows.length === 0) return <li>nothing has happened yet</li>;
  return (
    <>
      {rows.map((l, i) => (
        <li key={l.n}>
          {(i === 0 || rows[i - 1].turn !== l.turn) && <span className="mb-0.5 mt-1.5 block text-[10px] font-semibold uppercase tracking-widest text-space-400">Turn {l.turn}</span>}
          <span className={l.mine ? "text-space-100" : "text-space-300"}>{l.text}</span>
        </li>
      ))}
    </>
  );
}

export function NarrationRibbon({ text, n, mine, live }: { text: string; n: number; mine: boolean; live: boolean }) {
  return (
    <div className={`flex items-center gap-2 border-b border-space-700/80 px-3 py-1 text-[11.5px] leading-snug sm:px-5 sm:py-1.5 ${live ? "text-space-100" : "text-space-300"}`} aria-live="polite">
      <span className={`shrink-0 font-semibold uppercase tracking-[0.22em] ${mine ? "text-ki-300" : "text-space-500"}`}>{live ? "NOW" : "LAST"}</span>
      <span key={n} className="arena-drop min-w-0 flex-1 truncate">
        {text}
      </span>
    </div>
  );
}

/**
 * The docked card review (desktop, lg and up; `docs/arena-backlog/rd-05`).
 *
 * It draws whatever it is given and owns no state: the stage decides which
 * card is on it (hover, pin, row hover) and what its actions are, so a pager
 * for the phone (rd-06) can hand the same pieces to a different frame.
 * `actions` is an `ActionRows` list; `stats` is `StatTiles`.
 */
export function DockedInspector({
  card,
  where,
  chips,
  stats,
  actions,
  basicActions,
  pinned,
  onUnpin,
  narrator = DEFAULT_NARRATOR,
  battle,
}: {
  card: CardView | null;
  /** "Claude's battle area", "Your hand". */
  where: string | null;
  chips: InspectorChip[];
  stats: React.ReactNode;
  actions: React.ReactNode;
  basicActions?: React.ReactNode;
  pinned: boolean;
  onUnpin: () => void;
  narrator?: Narrator;
  battle?: Parameters<typeof CardDetail>[0]["battle"];
}) {
  // The board hands it a card whenever there is one on the table (the last
  // hovered, else your first hand card), so this is a table with no cards.
  if (!card) {
    return (
      <div className="flex h-full flex-col justify-center gap-2 p-4 text-center text-sm text-space-300" data-arena-inspector="empty">
        <b className="arena-impact text-lg text-space-50">Hover any card to review it</b>
        Yours or the opponent&apos;s, in hand or in play — it shows here. No clicks needed.
      </div>
    );
  }
  return (
    <div className="space-y-2 p-3 lg:px-5 lg:py-4" data-arena-inspector={card.id}>
      {basicActions}
      <div data-desktop-reader><CardReader key={`${card.id}:${card.flipped}`} card={card} showAbilities direction="next" docked /></div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-space-200">{where}</p>
        {pinned && (
          <button
            type="button"
            onClick={onUnpin}
            className="tap min-h-11 shrink-0 rounded-full border border-space-500 px-3 py-2 text-xs uppercase tracking-wider text-space-200 hover:border-ki-400 hover:text-ki-300"
          >
            pinned · esc
          </button>
        )}
      </div>
      <h3 className="text-lg font-black italic leading-tight text-space-50">{card.name}</h3>
      <ChipRow chips={chips} />
      {stats}
      <div className="space-y-1.5">{actions}</div>
      <details><summary className="tap min-h-11 cursor-pointer py-3 text-sm">More card details</summary><CardDetail card={card} narrator={narrator} battle={battle} figures={false} /></details>
    </div>
  );
}

/** One row of the In play list: art swatch, name, state, power. */
export interface InPlayRow {
  card: CardView;
  /** "Leader · 2 life · standing", "Rested". */
  note: string;
}

export interface InPlaySide {
  name: string;
  rows: InPlayRow[];
  /** Battle cards only, as in the reference frame: "2 in battle · 32,000 power". */
  battleCount: number;
  battlePower: number;
}

/**
 * Every card on both boards, the leader first. A row is hover-and-focus
 * reviewable (it fills the inspector and outlines the card on the board) and a
 * click pins it.
 */
export function InPlayList({
  sides,
  inspected,
  onReview,
  onPin,
}: {
  sides: InPlaySide[];
  inspected: string | null;
  /** The pointer or focus is on a row (id), or left it (null). */
  onReview: (id: string | null) => void;
  onPin: (id: string) => void;
}) {
  return (
    <div className="space-y-3 p-2">
      {sides.map((side) => (
        <div key={side.name} role="group" aria-label={`${side.name} in play`}>
          <p className="flex items-baseline justify-between gap-2 px-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-space-300">
            <span>{side.name}</span>
            <span className="font-normal normal-case tracking-normal">
              {side.battleCount} in battle · {side.battlePower.toLocaleString("en")} power
            </span>
          </p>
          <ul className="mt-1 space-y-1">
            {side.rows.map(({ card, note }) => (
              <li key={card.id}>
                <button
                  type="button"
                  data-arena-row={card.id}
                  onClick={() => onPin(card.id)}
                  onPointerEnter={(e) => e.pointerType === "mouse" && onReview(card.id)}
                  onPointerLeave={(e) => e.pointerType === "mouse" && onReview(null)}
                  onFocus={() => onReview(card.id)}
                  onBlur={() => onReview(null)}
                  aria-label={`${card.name}, ${note}`}
                  className={`flex w-full items-center gap-2 rounded-lg border px-1.5 py-1 text-left hover:border-ki-400 ${inspected === card.id ? "border-ki-400 bg-space-800" : "border-space-700 bg-space-800/50"}`}
                >
                  {card.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a list swatch; the board has already loaded this URL.
                    <img src={cardImage(card.imageUrl, "thumb")} alt="" className="card-aspect w-7 shrink-0 rounded-[3px] object-cover" />
                  ) : (
                    <span className="card-aspect w-7 shrink-0 rounded-[3px] bg-space-700" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-space-50">{card.name}</span>
                    <span className="block truncate text-[10px] text-space-300">{note}</span>
                  </span>
                  <span className="shrink-0 arena-num text-xs tabular-nums text-ki-300">{card.power != null ? card.power.toLocaleString("en") : ""}</span>
                </button>
              </li>
            ))}
            {side.rows.length === 0 && <li className="px-1 text-[11px] text-space-400">nothing in play</li>}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * The inspector over two tabs — In play, and the log. The log is the narration
 * log (#350): the sentences the story told, newest first, under their turn.
 */
export function InspectorColumn({
  inspector,
  inPlay,
  story,
  tab,
  onTab,
}: {
  inspector: React.ReactNode;
  inPlay: React.ReactNode;
  story: StoryLine[];
  /** Which tab is open; the board owns it so its bar's log button can open the log. */
  tab: "play" | "log";
  onTab: (tab: "play" | "log") => void;
}) {
  const setTab = onTab;
  return (
    // The board's right-hand column (#444): its full height, the card over the tabs.
    <div className="arena-sidecol flex h-full flex-col overflow-hidden" aria-label="Card review">
      {/* The card over the tabs. The tab panel has a fixed height, so the tabs never move when a
          taller card fills the sheet, or a row under the pointer would slide away from it. */}
      {/* The sheet is the size container the docked reader measures its scan against. */}
      <div className="arena-sidecol-sheet min-h-0 flex-1 overflow-y-auto [container-type:size]">{inspector}</div>
      <div role="tablist" className="arena-sidecol-tabs flex shrink-0 gap-2 p-2.5 text-sm font-semibold">
        {(
          [
            ["play", "In play"],
            ["log", "Battle log"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`arena-tab tap flex-1 rounded-xl px-2 py-1.5 ${tab === k ? "arena-tab-on text-space-50" : "text-space-300 hover:text-space-50"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="h-[clamp(120px,22dvh,240px)] shrink-0 overflow-y-auto">
        {tab === "play" ? (
          inPlay
        ) : (
          <ol className="space-y-0.5 p-2 text-xs leading-relaxed text-space-300">
            <StoryList story={story} />
          </ol>
        )}
      </div>
    </div>
  );
}
