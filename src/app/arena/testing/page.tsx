import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { requireSlPage } from "@/lib/auth";
import { getTestingDashboard } from "@/lib/arena/testing/store";
import type { ActorKind, StatsFilter } from "@/lib/arena/testing/types";
import { ArenaHeader } from "@/components/arena/ArenaHeader";
import { TestingPortal } from "@/components/arena/testing/TestingPortal";

export const dynamic = "force-dynamic";

const ACTOR_KINDS: ActorKind[] = ["human", "local_ai", "opus", "other_ai"];
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function ArenaTestingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireSlPage();
  const query = await searchParams;
  const actorRaw = first(query.actor);
  const deckId = first(query.deck);
  const model = first(query.model)?.trim().slice(0, 120) || undefined;
  const validDeckId = deckId && (/^(?:recipe:)?[a-z0-9-]+$/.test(deckId) || /^actual:\d+$/.test(deckId)) ? deckId : undefined;
  const filter: StatsFilter = {
    actorKind: ACTOR_KINDS.includes(actorRaw as ActorKind) ? actorRaw as ActorKind : undefined,
    model,
    deckId: validDeckId,
  };
  const dashboard = await getTestingDashboard(db, filter);

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-3 py-4 pb-24 sm:px-6 sm:py-6">
      <ArenaHeader side="testing" />
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-space-50 sm:text-2xl">Testing &amp; stats</h1>
        <p className="max-w-3xl text-sm text-space-300">Plan coverage by release and ability, keep exact scenario evidence, and record manual test results. Server Arena games and recorded results stay separate.</p>
      </header>
      <TestingPortal dashboard={dashboard} filter={filter} requestId={randomUUID()} />
    </main>
  );
}
