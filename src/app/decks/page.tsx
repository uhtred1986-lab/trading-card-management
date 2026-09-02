import Link from "next/link";
import { db } from "@/db";
import { listDecks, RULES } from "@/lib/decks/queries";
import { CardImage } from "@/components/CardImage";
import { ColorPill } from "@/components/ColorPill";
import { createDeckForm } from "./actions";

export const dynamic = "force-dynamic";

export default async function DecksPage() {
  const decks = await listDecks(db);
  const built = decks.filter((d) => d.isBuilt);
  const virtual = decks.filter((d) => !d.isBuilt);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-space-50">Decks</h1>
          <p className="text-sm text-space-300">
            {built.length} built · {virtual.length} virtual
          </p>
        </div>
        <form action={createDeckForm} className="flex gap-2">
          <input name="name" placeholder="New deck name" className="tap rounded-md border border-space-600 bg-space-900 px-2 py-1.5 text-sm text-space-100" />
          <button className="tap rounded-md bg-ki-500 px-3 py-1.5 text-sm font-semibold text-space-950 hover:bg-ki-400">Create</button>
        </form>
      </div>

      <p className="rounded-xl border border-space-700/70 bg-space-900/40 p-3 text-xs text-space-300">
        <span className="font-semibold text-ki-300">Built</span> decks are physical stacks: every copy they contain is reserved from your collection, and a deck can only be marked built while you own enough copies for it and every other built deck.{" "}
        <span className="font-semibold text-space-100">Virtual</span> decks are unlimited and can use any card.
      </p>

      {decks.length === 0 ? (
        <p className="rounded-xl border border-dashed border-space-700 p-8 text-center text-space-300">No decks yet — create one above.</p>
      ) : null}

      {[
        { title: "Built", rows: built },
        { title: "Virtual", rows: virtual },
      ]
        .filter((s) => s.rows.length)
        .map((section) => (
          <section key={section.title}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-space-300">{section.title}</h2>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {section.rows.map((d) => (
                <li key={d.id}>
                  <Link href={`/decks/${d.id}`} className="flex gap-3 rounded-xl border border-space-700/70 bg-space-900/60 p-2 hover:border-ki-500/50">
                    <div className="w-16 shrink-0">
                      <CardImage src={d.leader?.imageUrl} alt={d.leader?.name ?? "No leader"} sizes="64px" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-space-50">{d.name}</span>
                        {d.isBuilt ? <span className="rounded bg-ki-500 px-1.5 py-px text-[10px] font-bold uppercase text-space-950">Built</span> : null}
                      </div>
                      <div className="truncate text-xs text-space-300">{d.leader?.name ?? "No leader yet"}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {d.leader?.colors.map((c) => (
                          <ColorPill key={c} color={c} small />
                        ))}
                        <span className={`ml-auto text-xs ${d.mainCount === RULES.main ? "text-space-300" : "text-ki-300"}`}>
                          {d.mainCount}/{RULES.main}
                        </span>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
