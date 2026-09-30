import Link from "next/link";
import { reviewFlagAction } from "@/app/arena/actions";
import type { FlaggedGame, FlagLine } from "@/lib/arena/review-store";
import type { Review, ReviewBeat } from "@/lib/arena/review";
import type { CardView, SideView } from "@/lib/arena/view";

/** Everything the screen draws, so the page can hand it real rows or a fixture. */
export interface ReviewScreenData {
  games: FlaggedGame[];
  /** Whether resolved flags are listed too. */
  showAll: boolean;
  game: FlaggedGame | null;
  flags: FlagLine[];
  review: Review | null;
  /** Why there is no board, when there is not. */
  why: string | null;
  decisions: { seq: number; player: string; promptKind: string; chosenLabel: string | null; how: string; model: string | null }[];
  drifted: boolean;
  /** The move open on the right (0-based index into the game's actions). */
  beat: number | null;
  /** Fixture mode: buttons are drawn but nothing is written. */
  fixture: boolean;
}

/** A link back to this screen with some of its state changed. */
export function reviewHref(q: { game?: number | null; turn?: number | null; beat?: number | null; all?: boolean; fixture?: boolean }): string {
  const p = new URLSearchParams();
  if (q.fixture) p.set("fixture", "1");
  if (q.game) p.set("game", String(q.game));
  if (q.turn != null) p.set("turn", String(q.turn));
  if (q.beat != null) p.set("beat", String(q.beat));
  if (q.all) p.set("all", "1");
  const s = p.toString();
  return s ? `/arena/review?${s}` : "/arena/review";
}

const panel = "rounded-xl border border-space-700/70 bg-space-900/60";
const label = "text-[10px] font-semibold uppercase tracking-widest text-space-300";

function modeLabel(mode: string): string {
  return mode === "sparring" ? "Practice" : mode === "tournament" ? "Tournament" : mode === "versus" ? "1 v 1" : "Hot-seat";
}

function outcome(g: FlaggedGame): string {
  if (g.status === "abandoned") return "abandoned";
  if (g.status !== "over") return "in progress";
  return g.winner === "p1" ? `${g.p1Name} won` : g.winner === "p2" ? `${g.p2Name} won` : "drawn";
}

function Chip({ c }: { c: CardView }) {
  return (
    <span
      title={`${c.name}${c.power != null ? ` · ${c.power.toLocaleString("en")}` : ""}${c.mode === "rest" ? " · rested" : ""}`}
      className={`relative flex h-16 w-11 shrink-0 flex-col justify-end overflow-hidden rounded-md border border-space-600 bg-space-800 bg-cover bg-center text-[9px] font-bold text-space-50 ${c.mode === "rest" ? "rotate-6 opacity-70" : ""}`}
      style={c.imageUrl ? { backgroundImage: `url(${c.imageUrl})` } : undefined}
    >
      {!c.imageUrl && <span className="px-0.5 leading-tight">{c.name.slice(0, 14)}</span>}
      {c.power != null && <span className="bg-space-950/80 px-0.5 text-center">{Math.round(c.power / 1000)}k</span>}
    </span>
  );
}

function Side({ side, name }: { side: SideView; name: string }) {
  const cards = [side.leader, side.unison, ...side.battle].filter((c): c is CardView => !!c);
  return (
    <div className="flex items-center gap-3">
      <div className="w-16 shrink-0 text-xs font-semibold text-space-100">{name}</div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {cards.map((c) => (
          <Chip key={c.id} c={c} />
        ))}
        {cards.length === 0 && <span className="text-xs text-space-400">no cards in play</span>}
      </div>
      <div className="shrink-0 text-right font-mono text-[11px] leading-tight text-space-300">
        <div>life {side.life}</div>
        <div>hand {side.handCount}</div>
        <div>
          energy {side.activeEnergy}/{side.energy.length}
        </div>
      </div>
    </div>
  );
}

/** What was decided, for the selected move. */
function BeatDetail({ b, data, gameId }: { b: ReviewBeat; data: ReviewScreenData; gameId: number }) {
  const d = b.decision;
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-bold leading-tight text-space-50">{b.label}</h2>
        <p className="text-xs text-space-300">
          {b.who} · move #{b.n} · turn {b.turn} · {b.kind}
        </p>
      </div>

      <section>
        <h3 className={label}>Legal moves ({b.offered.length})</h3>
        <ol className="mt-1 max-h-64 space-y-1 overflow-y-auto rounded-lg border border-space-700 bg-space-950/70 p-2 text-sm">
          {b.offered.map((m, i) => (
            <li key={i} aria-current={i === b.chosenIndex ? "true" : undefined} className={`flex gap-2 rounded px-2 py-1 ${i === b.chosenIndex ? "border border-ki-500/60 bg-ki-500/10 text-space-50" : "text-space-200"}`}>
              <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${i === b.chosenIndex ? "bg-ki-300" : "bg-space-500"}`} />
              <span>{m}</span>
              {i === b.chosenIndex && <span className="ml-auto shrink-0 text-[10px] font-bold uppercase tracking-wider text-ki-300">picked</span>}
            </li>
          ))}
          {b.chosenIndex === null && <li className="text-xs text-dbs-yellow">This move is not on the replayed menu: a deck was edited since the game, so the replay has drifted.</li>}
        </ol>
      </section>

      {b.refused.length > 0 && (
        <section>
          <h3 className={label}>Refused ({b.refused.length})</h3>
          <ul className="mt-1 space-y-1 rounded-lg border border-space-700 bg-space-950/70 p-2 text-xs">
            {b.refused.map((r, i) => (
              <li key={i}>
                <span className="text-space-100">{r.label}</span>
                {r.why.map((w, j) => (
                  <span key={j} className="block text-space-300">
                    {w}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className={label}>Why</h3>
        <div className="mt-1 rounded-lg border border-space-700 bg-space-950/70 p-3 text-sm leading-relaxed text-space-100">
          {d ? (
            <>
              <p>{d.how}</p>
              {d.say && <p className="mt-1 italic text-ki-300">“{d.say}”</p>}
            </>
          ) : (
            <p className="text-space-300">No decision was recorded for this move: a player made it, so nothing was decided for them. Above is what the engine offered and refused.</p>
          )}
        </div>
      </section>

      {d && (
        <dl className="grid grid-cols-3 overflow-hidden rounded-lg border border-space-700 bg-space-950/70 text-xs">
          <div className="border-r border-space-700 p-2">
            <dt className="text-[10px] uppercase tracking-wider text-space-400">decided by</dt>
            <dd className="mt-0.5 font-semibold text-space-50">{d.decidedBy === "rule" ? "a rule, free" : d.decidedBy === "fallback" ? `${d.model ?? "claude"} · off the list` : (d.model ?? "claude")}</dd>
          </div>
          <div className="border-r border-space-700 p-2">
            <dt className="text-[10px] uppercase tracking-wider text-space-400">tokens</dt>
            <dd className="mt-0.5 font-mono font-semibold text-space-50">{d.inputTokens || d.outputTokens ? `${d.inputTokens.toLocaleString("en")} in · ${d.outputTokens.toLocaleString("en")} out` : "—"}</dd>
          </div>
          <div className="p-2">
            <dt className="text-[10px] uppercase tracking-wider text-space-400">latency</dt>
            <dd className="mt-0.5 font-mono font-semibold text-space-50">{d.latencyMs ? `${d.latencyMs.toLocaleString("en")} ms` : "—"}</dd>
          </div>
        </dl>
      )}

      {b.cardId && (
        <Link href={`/arena/rules?game=${gameId}&q=${encodeURIComponent(b.cardId)}`} className="tap inline-flex items-center rounded-lg border border-space-600 px-3 py-2 text-sm font-semibold text-space-50 hover:border-ki-500">
          Open {b.cardName ?? b.cardId} in the rules workbench →
        </Link>
      )}
      {data.fixture && b.cardId && <p className="text-[11px] text-space-400">Sample data: the workbench link is real, the card id is made up.</p>}
    </div>
  );
}

/** The reviewer's note and Resolve, stored on the flag's own row. */
function FlagPanel({ flag, fixture }: { flag: FlagLine; fixture: boolean }) {
  const save = reviewFlagAction.bind(null, flag.id);
  return (
    <form action={fixture ? undefined : save} className="space-y-2 rounded-xl border border-loss/40 bg-loss/5 p-3">
      <h3 className={label}>Flag on turn {flag.turn}</h3>
      <p className="text-sm text-space-100">{flag.note ? `“${flag.note}”` : <span className="text-space-300">No note when flagged.</span>}</p>
      <p className="text-[11px] text-space-400">
        flagged by {flag.flaggedBy ?? "the owner"}
        {flag.resolved ? " · resolved" : ""}
      </p>
      <label className={`${label} block`} htmlFor={`reviewer-note-${flag.id}`}>
        Reviewer note
      </label>
      <textarea
        id={`reviewer-note-${flag.id}`}
        name="reviewerNote"
        defaultValue={flag.reviewerNote ?? ""}
        rows={3}
        maxLength={2000}
        placeholder="What should change: the rule record, the wording, or nothing?"
        className="w-full rounded-lg border border-space-700 bg-space-950 p-2 text-sm text-space-50 placeholder:text-space-400"
      />
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="intent" value="save" disabled={fixture} className="tap rounded-lg border border-space-600 px-3 py-2 text-sm font-semibold text-space-50 disabled:opacity-60">
          Save note
        </button>
        {flag.resolved ? (
          <button type="submit" name="intent" value="reopen" disabled={fixture} className="tap rounded-lg border border-space-600 px-3 py-2 text-sm font-semibold text-space-50 disabled:opacity-60">
            Reopen
          </button>
        ) : (
          <button type="submit" name="intent" value="resolve" disabled={fixture} className="tap rounded-lg bg-loss px-3 py-2 text-sm font-bold text-space-950 disabled:opacity-60">
            Resolve
          </button>
        )}
      </div>
    </form>
  );
}

export function ReviewScreen({ data }: { data: ReviewScreenData }) {
  const { game, review, flags } = data;
  const fx = data.fixture;
  const flagged = new Map(flags.map((f) => [f.turn, f]));
  const turn = review?.turn ?? null;
  const flag = turn != null ? flagged.get(turn) : undefined;
  const beats = review?.beats ?? [];
  const selected = beats.find((b) => b.index === data.beat) ?? beats.find((b) => b.index === flag?.beatIndex) ?? beats[0] ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight text-space-50">Arena · Match review</h1>
        <span className="rounded border-2 border-loss px-2 py-0.5 text-[11px] font-black uppercase tracking-widest text-space-50">Admin only</span>
        <span className="text-xs text-space-300">Hidden from players.</span>
        <nav aria-label="Which flags" className="ml-auto flex gap-1 rounded-lg bg-space-900 p-1 text-sm">
          <Link href={reviewHref({ game: game?.id, fixture: fx })} aria-current={!data.showAll ? "page" : undefined} className={`tap flex items-center rounded-md px-3 ${!data.showAll ? "bg-loss/20 text-space-50" : "text-space-300"}`}>
            Open
          </Link>
          <Link href={reviewHref({ game: game?.id, all: true, fixture: fx })} aria-current={data.showAll ? "page" : undefined} className={`tap flex items-center rounded-md px-3 ${data.showAll ? "bg-loss/20 text-space-50" : "text-space-300"}`}>
            All flagged
          </Link>
        </nav>
      </div>
      {fx && <p className="text-xs text-dbs-yellow">Sample data (dev fixture, no database): the shape of what the review reads. Buttons do nothing here.</p>}

      {data.games.length === 0 ? (
        <p className={`${panel} border-dashed p-6 text-center text-sm text-space-300`}>{data.showAll ? "Nothing has been flagged yet." : "Nothing is waiting for review."} Flag a turn from the shield on a game&apos;s board.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)_22rem]">
          <aside aria-label="Games with flags" className="space-y-2">
            <h2 className={label}>Matches</h2>
            <ul className="space-y-2">
              {data.games.map((g) => (
                <li key={g.id}>
                  <Link
                    href={reviewHref({ game: g.id, all: data.showAll, fixture: fx })}
                    aria-current={g.id === game?.id ? "true" : undefined}
                    className={`block rounded-xl border p-3 ${g.id === game?.id ? "border-loss/70 bg-loss/10" : "border-space-700 bg-space-900/60 hover:border-space-500"}`}
                  >
                    <span className="block text-sm font-bold text-space-50">
                      {g.p1Name} vs {g.p2Name} · #{g.id}
                    </span>
                    <span className="mt-0.5 flex text-[11px] text-space-300">
                      <span>
                        {modeLabel(g.mode)} · {g.turn} turns · {outcome(g)}
                      </span>
                      <span className="ml-auto shrink-0 font-semibold text-space-100">
                        {g.flags} flag{g.flags === 1 ? "" : "s"}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </aside>

          <main className="min-w-0 space-y-3">
            {game && (
              <>
                <nav aria-label="Turns" className="flex flex-wrap items-center gap-2">
                  {(review?.turns ?? flags.map((f) => f.turn)).map((t) => {
                    const f = flagged.get(t);
                    const on = t === turn;
                    return f ? (
                      <Link
                        key={t}
                        href={reviewHref({ game: game.id, turn: t, all: data.showAll, fixture: fx })}
                        aria-current={on ? "true" : undefined}
                        aria-label={`Turn ${t}, flagged${f.resolved ? ", resolved" : ""}`}
                        className={`tap relative flex h-11 min-w-12 items-center justify-center rounded-lg border px-3 text-sm font-bold ${on ? "border-loss bg-loss/15 text-space-50" : "border-loss/50 text-space-100 hover:bg-loss/10"}`}
                      >
                        T{t}
                        <span aria-hidden className={`absolute right-1 top-1 h-2 w-2 rounded-full ${f.resolved ? "bg-space-400" : "bg-loss"}`} />
                      </Link>
                    ) : (
                      <span key={t} aria-disabled="true" className="flex h-11 min-w-12 items-center justify-center rounded-lg border border-dashed border-space-700 px-3 text-sm font-bold text-space-400 opacity-50">
                        T{t}
                      </span>
                    );
                  })}
                  <span className="ml-auto text-xs text-space-400">Flagged turns only</span>
                </nav>

                {data.why && <p className={`${panel} p-3 text-sm text-dbs-yellow`}>{data.why}</p>}
                {data.drifted && !data.why && <p className={`${panel} p-3 text-xs text-dbs-yellow`}>{review?.drift ?? "A deck was edited since this game, so the replay differs from what was played in places."} The moves below are the saved ones; the menus are rebuilt and may not match what the game offered.</p>}

                {review?.board && (
                  <section aria-label="Board at the start of the turn" className={`${panel} space-y-2 p-3`}>
                    <h3 className={label}>Board at the start of turn {turn}</h3>
                    <Side side={review.board.them} name={review.board.them.name} />
                    <Side side={review.board.you} name={review.board.you.name} />
                  </section>
                )}

                {beats.length > 0 ? (
                  <ol aria-label={`Moves of turn ${turn}`} className="space-y-1.5">
                    {beats.map((b) => {
                      const on = b.index === selected?.index;
                      const marked = flag?.beatIndex === b.index;
                      return (
                        <li key={b.index}>
                          <Link
                            href={reviewHref({ game: game.id, turn: turn, beat: b.index, all: data.showAll, fixture: fx })}
                            aria-current={on ? "true" : undefined}
                            className={`flex items-baseline gap-3 rounded-lg border px-3 py-2 text-sm ${on ? "border-loss/70 bg-loss/10" : "border-space-800 bg-space-900/60 hover:border-space-600"}`}
                          >
                            <span className="w-8 shrink-0 font-mono text-xs text-space-300">#{b.n}</span>
                            <span className={`w-16 shrink-0 truncate text-xs font-bold ${b.player === "p1" ? "text-dbs-yellow" : "text-ki-300"}`}>{b.who}</span>
                            <span className="w-16 shrink-0 font-mono text-xs text-dbs-yellow">{b.kind}</span>
                            <span className="min-w-0 flex-1 text-space-100">
                              {b.label}
                              {b.story[0] && b.story[0] !== b.label && <span className="block truncate text-[11px] text-space-400">{b.story.join(" · ")}</span>}
                            </span>
                            {marked && <span role="img" aria-label="flagged here" className="h-2.5 w-2.5 shrink-0 self-center rounded-full bg-loss" />}
                          </Link>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  data.decisions.length > 0 && (
                    <section aria-label="Recorded decisions" className={`${panel} p-3`}>
                      <h3 className={label}>Decisions recorded for this turn</h3>
                      <ol className="mt-1 space-y-1 text-xs text-space-200">
                        {data.decisions.map((d) => (
                          <li key={d.seq}>
                            <span className="font-mono text-space-400">#{d.seq}</span> {d.player} · {d.promptKind} · chose {d.chosenLabel ?? "—"} <span className="text-space-400">({d.how})</span>
                          </li>
                        ))}
                      </ol>
                    </section>
                  )
                )}
              </>
            )}
          </main>

          <aside aria-label="Selected move" className="space-y-3">
            {selected && game ? <BeatDetail b={selected} data={data} gameId={game.id} /> : <p className="text-sm text-space-300">Pick a flagged turn to see its moves.</p>}
            {flag && <FlagPanel flag={flag} fixture={fx} />}
          </aside>
        </div>
      )}
    </div>
  );
}
