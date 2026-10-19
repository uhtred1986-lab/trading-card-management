import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { SandboxPlay } from "@/components/arena/rules/tryit/SandboxPlay";
import { PageHeader } from "@/components/ui";
import { requireSlPage } from "@/lib/auth";
import { LIGHTING_COOKIE, lightingFrom } from "@/lib/arena/lighting";
import { SKIN_COOKIE, skinFrom } from "@/lib/arena/skin";
import { STAGING_COOKIE, stagingFrom } from "@/lib/arena/staging";

export const dynamic = "force-dynamic";

/**
 * Play-test sandbox (Rules PR 5): `?rule=<ruleId>&board=<key>`. The card in
 * the path only names the page; the rule row says which card and skill. The
 * builder's unsaved rule is not in the URL (it can be long): the Try it row's
 * link leaves it in `sessionStorage`, and with none the saved rule is played.
 */
export default async function SandboxPage({ params, searchParams }: { params: Promise<{ cardId: string }>; searchParams: Promise<{ rule?: string; board?: string }> }) {
  await requireSlPage();
  const q = await searchParams;
  const cardId = (await params).cardId;
  const ruleId = Number(q.rule);
  if (!Number.isSafeInteger(ruleId) || ruleId < 1) notFound();
  const jar = await cookies();
  return (
    <div className="space-y-3">
      <PageHeader title="Play-test" eyebrow="Rules" description="Play the board against the local AI, with your edit installed. Nothing is saved." />
      <SandboxPlay
        ruleId={ruleId}
        boardKey={q.board ?? null}
        backHref={`/arena/rules/card/${cardId}?skill=${ruleId}&edit=1`}
        skin={skinFrom(jar.get(SKIN_COOKIE)?.value)}
        staging={stagingFrom(jar.get(STAGING_COOKIE)?.value)}
        lighting={lightingFrom(jar.get(LIGHTING_COOKIE)?.value)}
      />
    </div>
  );
}
