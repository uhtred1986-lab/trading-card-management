import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiRuns, cardSets, cards } from "@/db/schema";
import { hasAnthropic } from "@/lib/ai/client";
import type { SetReview } from "@/lib/ai/deck";
import { CardImage } from "@/components/CardImage";
import { reviewSetForm } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function SetReviewPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const set = await db.query.cardSets.findFirst({ where: eq(cardSets.code, code) });
  if (!set) notFound();
  const [run] = await db
    .select()
    .from(aiRuns)
    .where(sql`${aiRuns.kind} = 'set_review' and ${aiRuns.input}->>'setCode' = ${code}`)
    .orderBy(desc(aiRuns.createdAt))
    .limit(1);
  const review = (run?.output ?? null) as SetReview | null;
  const ids = review ? [...new Set([...review.standouts.map((s) => s.cardId), ...review.sleepers.map((s) => s.cardId)])] : [];
  const meta = ids.length ? await db.select({ id: cards.id, name: cards.name, imageUrl: cards.imageUrl }).from(cards).where(sql`${cards.id} in ${ids}`) : [];
  const m = new Map(meta.map((r) => [r.id, r]));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <Link href={`/cards?set=${code}`} className="text-xs text-space-300 hover:text-ki-300">
            ← {set.name}
          </Link>
          <h1 className="text-xl font-semibold text-space-50">Set review · {code}</h1>
          {run ? <p className="text-xs text-space-400">Generated {run.createdAt.toISOString().slice(0, 10)} · {run.inputTokens} in / {run.outputTokens} out tokens</p> : null}
        </div>
        <form action={reviewSetForm}>
          <input type="hidden" name="code" value={code} />
          <button disabled={!hasAnthropic()} className="tap rounded-md bg-ki-500 px-3 py-1.5 text-sm font-semibold text-space-950 hover:bg-ki-400 disabled:opacity-50">
            {review ? "Re-run review" : "Review this set with Claude"}
          </button>
        </form>
      </div>

      {!review ? (
        <p className="rounded-xl border border-dashed border-space-700 p-6 text-center text-sm text-space-300">
          {hasAnthropic() ? "No review yet. Claude reads every card in the set and picks out standouts, archetypes and sleepers." : "Set ANTHROPIC_API_KEY to enable set reviews."}
        </p>
      ) : (
        <>
          <p className="text-space-100">{review.overview}</p>
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-space-300">Standouts</h2>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {review.standouts.map((s) => (
                <li key={s.cardId}>
                  <Link href={`/cards/${encodeURIComponent(s.cardId)}`} className="flex gap-2 rounded-xl border border-space-700/70 bg-space-900/60 p-2 hover:border-ki-500/50">
                    <div className="w-14 shrink-0">
                      <CardImage src={m.get(s.cardId)?.imageUrl} alt={m.get(s.cardId)?.name ?? s.cardId} sizes="56px" />
                    </div>
                    <div className="min-w-0 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-space-50">{m.get(s.cardId)?.name ?? s.cardId}</span>
                        <span className="text-ki-400">{"★".repeat(s.rating)}</span>
                      </div>
                      <div className="font-mono text-xs text-space-400">{s.cardId}</div>
                      <p className="text-xs text-space-300">{s.why}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-space-300">Archetype impact</h2>
            <ul className="space-y-2">
              {review.archetypes.map((a) => (
                <li key={a.name} className="rounded-xl border border-space-700/70 bg-space-900/60 p-3 text-sm">
                  <div className="font-medium text-space-50">
                    {a.name} <span className="text-xs text-space-400">{a.colors.join("/")}</span>
                  </div>
                  <p className="text-space-200">{a.impact}</p>
                  <div className="mt-1 flex flex-wrap gap-1 font-mono text-xs">
                    {a.keyCards.map((k) => (
                      <Link key={k} href={`/cards/${encodeURIComponent(k)}`} className="rounded bg-space-800 px-1.5 text-space-200 hover:text-ki-300">
                        {k}
                      </Link>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </section>
          {review.sleepers.length ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-space-300">Sleepers</h2>
              <ul className="space-y-1 text-sm">
                {review.sleepers.map((s) => (
                  <li key={s.cardId}>
                    <Link href={`/cards/${encodeURIComponent(s.cardId)}`} className="font-medium text-space-50 hover:text-ki-300">
                      {m.get(s.cardId)?.name ?? s.cardId}
                    </Link>{" "}
                    <span className="font-mono text-xs text-space-400">{s.cardId}</span> <span className="text-space-300">— {s.why}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
