import { db } from "@/db";
import { hasAnthropic } from "@/lib/ai/client";
import { parseGame } from "@/lib/catalog/games";
import { ownedLeaders } from "@/lib/leaders/queries";
import { currentScope, requireSignedInPage } from "@/lib/auth";
import { LeaderLibrary } from "@/components/LeaderLibrary";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => Array.isArray(v) ? v[0] : v || undefined;

export default async function LeadersPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireSignedInPage();
  const sp = await searchParams;
  const all = await ownedLeaders(db, { viewer: await currentScope() });
  return <LeaderLibrary all={all} game={parseGame(one(sp.game))} color={one(sp.color)} q={one(sp.q)} set={one(sp.set)} usage={one(sp.usage)} aiEnabled={hasAnthropic()} />;
}
