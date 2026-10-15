import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { requireSlPage } from "@/lib/auth";
import { getTestingDashboard, listImportedEvaluationRuns } from "@/lib/arena/testing/store";
import type { ActorKind, StatsFilter } from "@/lib/arena/testing/types";
import { ArenaHeader } from "@/components/arena/ArenaHeader";
import { TestingPortal } from "@/components/arena/testing/TestingPortal";
import { PageHeader } from "@/components/ui";

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
  const [dashboard, importedRuns] = await Promise.all([getTestingDashboard(db, filter), listImportedEvaluationRuns(db)]);

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-3 py-4 pb-24 sm:px-6 sm:py-6">
      <ArenaHeader side="testing" />
      <PageHeader title="Testing & stats" eyebrow="Arena operations" description="Plan coverage by release and ability, keep exact scenario evidence, and record manual test results. Server Arena games and recorded results stay separate." />
      <TestingPortal dashboard={dashboard} filter={filter} requestId={randomUUID()} importedRuns={importedRuns} />
    </main>
  );
}
